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

const _tip = new THREE.Vector3(0, 0, 1);
const _aimed = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

/** Short-arc turn of a unit direction. Pitch is included; the path does not cut through zero. */
export function rotateToward(current: THREE.Vector3, target: THREE.Vector3, lambda: number, dt: number): void {
  if (target.lengthSq() < 1e-8) return;
  _aimed.copy(target).normalize();
  if (current.lengthSq() < 1e-8) {
    current.copy(_aimed);
    return;
  }
  current.normalize();
  const dot = THREE.MathUtils.clamp(current.dot(_aimed), -1, 1);
  if (dot > 0.9995) {
    current.copy(_aimed);
    return;
  }
  const alpha = 1 - Math.exp(-lambda * dt);
  _qa.setFromUnitVectors(_tip, current);
  _qb.setFromUnitVectors(_tip, _aimed);
  _qa.slerp(_qb, alpha);
  current.copy(_tip).applyQuaternion(_qa).normalize();
}
