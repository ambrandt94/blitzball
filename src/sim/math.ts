import * as THREE from 'three';
import { GOAL } from '../game/constants';

/** Goal axis is ±Z; "goal-up" treats +Y as up when looking toward goals in a stadium sense,
 * but for sphere sports we use the axis connecting goals as the navigational pole.
 * Goal-axis up = world +Z as the vertical reference for camera/UI. */
export const GOAL_AXIS = new THREE.Vector3(0, 0, 1);

export function authoritativeUp(goalAxisUp: boolean): THREE.Vector3 {
  return goalAxisUp ? GOAL_AXIS.clone() : new THREE.Vector3(0, 1, 0);
}

export function orthonormalBasis(
  forward: THREE.Vector3,
  upHint: THREE.Vector3,
): { forward: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3 } {
  const forwardN = forward.clone().normalize();
  let up = upHint.clone().normalize();
  // If forward nearly parallel to up, pick an alternate.
  if (Math.abs(forwardN.dot(up)) > 0.98) {
    up = Math.abs(up.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  }
  const right = new THREE.Vector3().crossVectors(forwardN, up).normalize();
  up = new THREE.Vector3().crossVectors(right, forwardN).normalize();
  return { forward: forwardN, right, up };
}

export function goalCenter(team: 0 | 1): THREE.Vector3 {
  // Team 0 shoots toward +Z, team 1 toward -Z.
  const z = team === 0 ? GOAL.distance : -GOAL.distance;
  return new THREE.Vector3(0, 0, z);
}

export function clampMagnitude(v: THREE.Vector3, max: number): THREE.Vector3 {
  if (v.lengthSq() > max * max) v.setLength(max);
  return v;
}

export function damp(current: THREE.Vector3, target: THREE.Vector3, lambda: number, dt: number): void {
  current.lerp(target, 1 - Math.exp(-lambda * dt));
}

const _aimed = new THREE.Vector3();
const _hint = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qFrom = new THREE.Quaternion();
const _chase = new THREE.Vector3();

/**
 * Shortest-arc step of a direction.
 *
 * The turn is the partial rotation that takes `current` onto `target`.
 * Building both orientations from a fixed pole (`setFromUnitVectors(+Z, dir)`)
 * and slerping those quaternions is a different rotation: the pole's antipode
 * is a branch cut, and two nearby directions on either side of it can map to
 * quaternions nearly 180° apart. A full yaw crosses that cut.
 */
export function rotateToward(current: THREE.Vector3, target: THREE.Vector3, lambda: number, dt: number): void {
  if (target.lengthSq() < 1e-8) return;
  _aimed.copy(target).normalize();
  if (current.lengthSq() < 1e-8) {
    current.copy(_aimed);
    return;
  }
  current.normalize();
  const dot = THREE.MathUtils.clamp(current.dot(_aimed), -1, 1);
  const alpha = 1 - Math.exp(-lambda * dt);
  if (dot > 0.9995 || alpha <= 0) {
    if (dot > 0.9995) current.copy(_aimed);
    return;
  }
  if (dot < -0.9995) {
    // Opposite directions have no unique shortest arc. Spin on a stable axis.
    _axis.set(0, 1, 0);
    if (Math.abs(current.dot(_axis)) > 0.9) _axis.set(1, 0, 0);
    _axis.cross(current).normalize();
    _q.setFromAxisAngle(_axis, Math.PI * alpha);
    current.applyQuaternion(_q).normalize();
    return;
  }
  _q.setFromUnitVectors(current, _aimed);
  _qFrom.identity().slerp(_q, alpha);
  current.applyQuaternion(_qFrom).normalize();
}

/**
 * Keep `previous` perpendicular to `forward` and ease it toward `preferred`
 * along the short arc. Near the pole (`preferred` parallel to `forward`) the
 * twist is left alone so it does not flip.
 */
export function stabilizeUp(
  previous: THREE.Vector3,
  forward: THREE.Vector3,
  preferred: THREE.Vector3,
  lambda: number,
  dt: number,
): void {
  const fwd = _chase.copy(forward);
  if (fwd.lengthSq() < 1e-8) return;
  fwd.normalize();

  _hint.copy(preferred).addScaledVector(fwd, -preferred.dot(fwd));
  previous.addScaledVector(fwd, -previous.dot(fwd));
  if (previous.lengthSq() < 1e-8) {
    if (_hint.lengthSq() > 1e-8) previous.copy(_hint);
    else previous.set(0, 1, 0).addScaledVector(fwd, -fwd.y);
    if (previous.lengthSq() < 1e-8) previous.set(1, 0, 0);
  }
  previous.normalize();

  // ~8° of the pole: the rejected up is too small to define a twist.
  if (_hint.lengthSq() < 0.02) return;
  _hint.normalize();
  // Projecting world up flips as forward crosses the pole (the hint jumps
  // to the opposite hemisphere in one frame). Following that at full rate
  // whips the body and the camera. Roll upright slowly instead.
  const align = previous.dot(_hint);
  const rate = align < 0 ? Math.min(lambda, 1.2) : lambda;
  rotateToward(previous, _hint, rate, dt);
  previous.addScaledVector(fwd, -previous.dot(fwd));
  if (previous.lengthSq() < 1e-8) previous.copy(_hint);
  else previous.normalize();
}

/**
 * Chase position along the behind-the-player ray, pulled in until it fits
 * inside the sphere.
 *
 * A radial `setLength` clamp projects through the origin. Near the wall that
 * slides the camera off the chase ray and through the swimmer, and the view
 * basis whips as the look ray skims past them. The offset here is a straight
 * ray from an interior player, so it leaves the sphere at most once.
 */
export function chaseCameraPosition(
  out: THREE.Vector3,
  player: THREE.Vector3,
  forward: THREE.Vector3,
  worldUp: THREE.Vector3,
  distance: number,
  height: number,
  limit: number,
): THREE.Vector3 {
  const place = (d: number): THREE.Vector3 => {
    const h = distance > 1e-6 ? height * (d / distance) : 0;
    return _aimed.copy(player).addScaledVector(forward, -d).addScaledVector(worldUp, h);
  };
  const inside = (d: number): boolean => place(d).lengthSq() <= limit * limit;
  if (inside(distance)) return out.copy(place(distance));
  let lo = 0;
  let hi = distance;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) * 0.5;
    if (inside(mid)) lo = mid;
    else hi = mid;
  }
  return out.copy(place(lo));
}

/** Yaw around `worldUp`, then pitch. Continuous in both angles, including a full turn. */
export function lookBasis(
  yaw: number,
  pitch: number,
  goalAxisUp: boolean,
): { forward: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3; worldUp: THREE.Vector3 } {
  const worldUp = authoritativeUp(goalAxisUp);
  const worldForward = new THREE.Vector3();
  if (Math.abs(worldUp.z) < 0.9) worldForward.set(0, 0, 1);
  else worldForward.set(0, 1, 0);
  worldForward.sub(worldUp.clone().multiplyScalar(worldForward.dot(worldUp))).normalize();
  // forward × up is screen-right for this chase camera (world -X when
  // looking along +Z with world-Y up). Positive yaw turns toward it.
  const worldRight = new THREE.Vector3().crossVectors(worldForward, worldUp).normalize();
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const flatFwd = worldForward.clone().multiplyScalar(cy).addScaledVector(worldRight, sy).normalize();
  const right = new THREE.Vector3().crossVectors(flatFwd, worldUp).normalize();
  const forward = flatFwd.clone().multiplyScalar(cp).addScaledVector(worldUp, sp).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  return { forward, right, up, worldUp };
}
