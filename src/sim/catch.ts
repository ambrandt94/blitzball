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
