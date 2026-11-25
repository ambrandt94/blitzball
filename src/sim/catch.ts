import * as THREE from 'three';

const _to = new THREE.Vector3();
const _radial = new THREE.Vector3();
const _sample = new THREE.Vector3();

/**
 * Forward catch capsule: a mitt along `forward`, not a sphere buried in the chest.
 * `reach` is how far the mitt extends from the body. `radius` is its width.
 */
export function inCatchVolume(
  origin: THREE.Vector3,
  forward: THREE.Vector3,
  point: THREE.Vector3,
  reach: number,
  radius: number,
): boolean {
  const length = forward.length();
  if (length < 1e-8 || radius <= 0) return false;
  _to.copy(point).sub(origin);
  const inv = 1 / length;
  const along = _to.dot(forward) * inv;
  if (along < -0.08) return false;
  _radial.copy(_to);
  _radial.x -= forward.x * inv * along;
  _radial.y -= forward.y * inv * along;
  _radial.z -= forward.z * inv * along;
  const end = Math.max(0.12, reach);
  const clamped = THREE.MathUtils.clamp(along, 0.12, end);
  return Math.hypot(along - clamped, _radial.length()) <= radius;
}

/**
 * Front cone. `radius` is the reach from the body. `halfAngle` is the angle
 * from the aim axis to the edge of the mitt, in radians.
 */
export function inCatchCone(
  origin: THREE.Vector3,
  forward: THREE.Vector3,
  point: THREE.Vector3,
  radius: number,
  halfAngle: number,
): boolean {
  if (radius <= 0) return false;
  _to.copy(point).sub(origin);
  const dist = _to.length();
  if (dist > radius || dist < 1e-5) return false;
  const forwardLen = forward.length();
  if (forwardLen < 1e-8) return false;
  const along = _to.dot(forward) / (forwardLen * dist);
  return along >= Math.cos(Math.max(0, halfAngle));
}

/** True if any sample of the segment passes through the ready cone. */
export function segmentHitsCone(
  origin: THREE.Vector3,
  forward: THREE.Vector3,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  halfAngle: number,
): boolean {
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    _sample.copy(from).lerp(to, i / steps);
    if (inCatchCone(origin, forward, _sample, radius, halfAngle)) return true;
  }
  return false;
}

/**
 * 0 at or below `threshold`. Rises toward 0.9 as the ball gets much faster,
 * so a soft pass sticks and a hard shot can pop out of the hands.
 */
export function fumbleChance(speed: number, threshold: number): number {
  if (!(threshold > 0) || speed <= threshold) return 0;
  const over = (speed - threshold) / threshold;
  return Math.min(0.9, over * over);
}

/** True if any sample of the segment passes through the mitt. Fast passes don't tunnel. */
export function segmentHitsCatch(
  origin: THREE.Vector3,
  forward: THREE.Vector3,
  from: THREE.Vector3,
  to: THREE.Vector3,
  reach: number,
  radius: number,
): boolean {
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    _sample.copy(from).lerp(to, i / steps);
    if (inCatchVolume(origin, forward, _sample, reach, radius)) return true;
  }
  return false;
}
