import * as THREE from 'three';
import { goalMouthZ } from './goal';

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
  // Team 0 shoots toward +Z, team 1 toward -Z. The center is the hoop, on the shell.
  const z = team === 0 ? goalMouthZ() : -goalMouthZ();
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
const _fromF = new THREE.Vector3();
const _toF = new THREE.Vector3();

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
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.z)) return;
  if (target.lengthSq() < 1e-8) return;
  _aimed.copy(target).normalize();
  if (current.lengthSq() < 1e-8) {
    current.copy(_aimed);
    return;
  }
  current.normalize();
  const dot = THREE.MathUtils.clamp(current.dot(_aimed), -1, 1);
  const alpha = 1 - Math.exp(-Math.max(0, lambda) * dt);
  if (dot > 0.9995 || alpha <= 0) {
    if (dot > 0.9995) current.copy(_aimed);
    return;
  }
  const theta = Math.acos(dot);
  // Hard cap so a target that flips across the seam cannot spin the body in one frame.
  const step = Math.min(theta * alpha, Math.max(0.35, lambda) * Math.max(0, dt));
  const t = theta > 1e-6 ? step / theta : 0;
  if (dot < -0.9995) {
    // Opposite directions have no unique shortest arc. Spin on a stable axis.
    _axis.set(0, 1, 0);
    if (Math.abs(current.dot(_axis)) > 0.9) _axis.set(1, 0, 0);
    _axis.cross(current).normalize();
    _q.setFromAxisAngle(_axis, Math.PI * t);
    current.applyQuaternion(_q).normalize();
    return;
  }
  _q.setFromUnitVectors(current, _aimed);
  _qFrom.identity().slerp(_q, t);
  current.applyQuaternion(_qFrom).normalize();
}

/**
 * Keep `previous` perpendicular to `forward` and ease it toward `preferred`
 * along the short arc, including when the body is upside down.
 *
 * Near the pole the rejected up is too small to trust, and it flips as
 * `forward` crosses that pole. Leave the twist alone there. Everywhere else,
 * roll back toward upright at the capped rate so an inversion cannot stick.
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
  const maxStep = Math.max(0, lambda) * Math.max(0, dt);
  rotateBy(previous, _hint, maxStep);
  previous.addScaledVector(fwd, -previous.dot(fwd));
  if (previous.lengthSq() < 1e-8) previous.copy(_hint);
  else previous.normalize();
}

/** Rotate `current` toward `target` by at most `radians`, along the short arc. */
export function rotateBy(current: THREE.Vector3, target: THREE.Vector3, radians: number): void {
  if (!(radians > 0)) return;
  if (target.lengthSq() < 1e-8 || current.lengthSq() < 1e-8) return;
  _aimed.copy(target).normalize();
  current.normalize();
  const dot = THREE.MathUtils.clamp(current.dot(_aimed), -1, 1);
  const theta = Math.acos(dot);
  if (theta < 1e-5) {
    current.copy(_aimed);
    return;
  }
  const step = Math.min(theta, radians);
  const t = step / theta;
  if (dot < -0.9995) {
    _axis.set(0, 1, 0);
    if (Math.abs(current.dot(_axis)) > 0.9) _axis.set(1, 0, 0);
    _axis.cross(current).normalize();
    _q.setFromAxisAngle(_axis, Math.PI * t);
    current.applyQuaternion(_q).normalize();
    return;
  }
  _q.setFromUnitVectors(current, _aimed);
  _qFrom.identity().slerp(_q, t);
  current.applyQuaternion(_qFrom).normalize();
}

/**
 * Up on the picture: world up projected off the view. Too close to the pole
 * that projection flips, so `fallback` (the up we already have) is kept.
 * Returns whether the horizon itself was stable enough to follow.
 */
export function screenUp(
  forward: THREE.Vector3,
  worldUp: THREE.Vector3,
  fallback: THREE.Vector3,
  out: THREE.Vector3,
): boolean {
  const fwd = _fromF.copy(forward);
  if (fwd.lengthSq() < 1e-8) {
    out.copy(fallback);
    return false;
  }
  fwd.normalize();
  out.copy(worldUp).addScaledVector(fwd, -worldUp.dot(fwd));
  if (out.lengthSq() < 0.04) {
    out.copy(fallback).addScaledVector(fwd, -fallback.dot(fwd));
    if (out.lengthSq() < 1e-8) out.set(0, 1, 0).addScaledVector(fwd, -fwd.y);
    if (out.lengthSq() < 1e-8) out.set(1, 0, 0);
    else out.normalize();
    return false;
  }
  out.normalize();
  return true;
}

/** Error `x` and velocity `v` of a critically damped spring toward 0. */
export function critDampScalar(x: number, v: number, omega: number, dt: number): { x: number; v: number } {
  const w = Math.max(0, omega);
  if (!(dt > 0) || w === 0) return { x, v };
  const exp = Math.exp(-w * dt);
  const b = v + w * x;
  const x1 = (x + b * dt) * exp;
  const v1 = (b - w * (x + b * dt)) * exp;
  return { x: x1, v: v1 };
}

/** Critically damped spring of `current` toward `target`. `vel` is world units per second. */
export function critDampVec(
  current: THREE.Vector3,
  vel: THREE.Vector3,
  target: THREE.Vector3,
  omega: number,
  dt: number,
): void {
  const px = critDampScalar(current.x - target.x, vel.x, omega, dt);
  const py = critDampScalar(current.y - target.y, vel.y, omega, dt);
  const pz = critDampScalar(current.z - target.z, vel.z, omega, dt);
  current.set(target.x + px.x, target.y + py.x, target.z + pz.x);
  vel.set(px.v, py.v, pz.v);
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
  right?: THREE.Vector3,
  lateral = 0,
): THREE.Vector3 {
  const place = (d: number): THREE.Vector3 => {
    const scale = distance > 1e-6 ? d / distance : 0;
    const h = height * scale;
    const lat = lateral * scale;
    _aimed.copy(player).addScaledVector(forward, -d).addScaledVector(worldUp, h);
    // Side offset shrinks with the pull-in, so the camera stays on the ray
    // from the swimmer and cannot pop through the shell.
    if (right && lat !== 0) _aimed.addScaledVector(right, lat);
    return _aimed;
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

/**
 * Pull `end` toward `origin` until it lies inside a sphere at the origin.
 * The slide stays on the segment, so the chase camera does not jump sideways
 * the way a radial setLength does when the boom meets the shell.
 */
export function pullInsideSphere(
  out: THREE.Vector3,
  origin: THREE.Vector3,
  end: THREE.Vector3,
  limit: number,
): THREE.Vector3 {
  if (end.lengthSq() <= limit * limit) return out.copy(end);
  if (origin.lengthSq() > limit * limit) return out.copy(end).setLength(Math.max(0.05, limit));
  _chase.copy(end).sub(origin);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) * 0.5;
    _aimed.copy(origin).addScaledVector(_chase, mid);
    if (_aimed.lengthSq() <= limit * limit) lo = mid;
    else hi = mid;
  }
  return out.copy(origin).addScaledVector(_chase, lo);
}

/**
 * Carry `up` along the same rotation that takes `fromForward` to `toForward`.
 * This is how the body stays continuous through straight up, straight down,
 * and inverted flight. Rebuilding up from a fixed pole flips at that pole.
 */
export function transportUp(up: THREE.Vector3, fromForward: THREE.Vector3, toForward: THREE.Vector3): void {
  _fromF.copy(fromForward);
  _toF.copy(toForward);
  if (_fromF.lengthSq() < 1e-8 || _toF.lengthSq() < 1e-8) return;
  _fromF.normalize();
  _toF.normalize();
  const dot = THREE.MathUtils.clamp(_fromF.dot(_toF), -1, 1);
  if (dot < 0.9995) {
    if (dot < -0.9995) {
      _axis.set(0, 1, 0);
      if (Math.abs(_fromF.dot(_axis)) > 0.9) _axis.set(1, 0, 0);
      _axis.cross(_fromF).normalize();
      _q.setFromAxisAngle(_axis, Math.PI);
    } else {
      _q.setFromUnitVectors(_fromF, _toF);
    }
    up.applyQuaternion(_q);
  }
  up.addScaledVector(_toF, -up.dot(_toF));
  if (up.lengthSq() < 1e-8) {
    up.set(0, 1, 0).addScaledVector(_toF, -_toF.y);
    if (up.lengthSq() < 1e-8) up.set(1, 0, 0);
  }
  up.normalize();
}

/** Camera pitch stops here so the horizon cannot roll through vertical. */
export const LOOK_PITCH_LIMIT = (85 * Math.PI) / 180;

export function clampLookPitch(pitch: number): number {
  return THREE.MathUtils.clamp(pitch, -LOOK_PITCH_LIMIT, LOOK_PITCH_LIMIT);
}

/**
 * Chase boom behind `forward`, raised along `up`, then pitched by `angle`.
 * If that point leaves the sphere, slide it toward the player along the same
 * line. The look direction does not change, so the frame cannot flip.
 */
export function chaseBoom(
  out: THREE.Vector3,
  player: THREE.Vector3,
  forward: THREE.Vector3,
  up: THREE.Vector3,
  distance: number,
  height: number,
  angle: number,
  limit: number,
): THREE.Vector3 {
  const fwd = _fromF.copy(forward);
  if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, 1);
  else fwd.normalize();
  const camUp = _toF.copy(up);
  if (camUp.lengthSq() < 1e-8) camUp.set(0, 1, 0);
  else camUp.normalize();
  const right = _axis.crossVectors(fwd, camUp);
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  else right.normalize();
  const boom = _chase.copy(fwd).multiplyScalar(-Math.max(0.2, distance)).addScaledVector(camUp, height);
  if (Math.abs(angle) > 1e-5) boom.applyAxisAngle(right, angle);
  out.copy(player).add(boom);
  if (!(limit > 0) || out.lengthSq() <= limit * limit) return out;
  return pullInsideSphere(out, player, out, limit);
}

/** Yaw around `worldUp`, then pitch. Pitch past ±90° is not used for the chase camera. */
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
