import * as THREE from 'three';

const _seg = new THREE.Vector3();
const _vel = new THREE.Vector3();

/** Point on the quadratic Bezier p0, p1, p2 at parameter t in [0, 1]. */
export function quadraticPoint(
  out: THREE.Vector3,
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  t: number,
): THREE.Vector3 {
  const u = 1 - t;
  return out.copy(p0).multiplyScalar(u * u).addScaledVector(p1, 2 * u * t).addScaledVector(p2, t * t);
}

/** World velocity along the Bezier if `t` advances by `1 / duration` per second. */
export function quadraticVelocity(
  out: THREE.Vector3,
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  t: number,
  duration: number,
): THREE.Vector3 {
  out.copy(p1).sub(p0).multiplyScalar(2 * (1 - t));
  _vel.copy(p2).sub(p1).multiplyScalar(2 * t);
  out.add(_vel);
  if (duration > 1e-4) out.multiplyScalar(1 / duration);
  return out;
}

/**
 * Control point: chord midpoint, pushed along the part of `up` that is
 * perpendicular to the chord. That reads as a lob "over" the aim line.
 */
export function arcControl(
  out: THREE.Vector3,
  origin: THREE.Vector3,
  target: THREE.Vector3,
  up: THREE.Vector3,
  heightFrac: number,
): THREE.Vector3 {
  out.copy(origin).lerp(target, 0.5);
  _seg.copy(target).sub(origin);
  const len = _seg.length();
  if (len < 1e-4 || heightFrac === 0) return out;
  _seg.multiplyScalar(1 / len);
  const arch = _vel.copy(up).addScaledVector(_seg, -up.dot(_seg));
  if (arch.lengthSq() < 1e-6) {
    arch.set(1, 0, 0).addScaledVector(_seg, -_seg.x);
    if (arch.lengthSq() < 1e-6) arch.set(0, 1, 0);
  }
  arch.normalize();
  return out.addScaledVector(arch, len * heightFrac);
}

/** Pull `end` toward `origin` until it lies inside a sphere of radius `limit`. */
export function clampEndInside(
  out: THREE.Vector3,
  origin: THREE.Vector3,
  end: THREE.Vector3,
  limit: number,
): THREE.Vector3 {
  if (end.length() <= limit) return out.copy(end);
  if (origin.length() >= limit) return out.copy(end).setLength(Math.max(0, limit));
  _seg.copy(end).sub(origin);
  const a = _seg.lengthSq();
  if (a < 1e-8) return out.copy(origin);
  const b = 2 * origin.dot(_seg);
  const c = origin.lengthSq() - limit * limit;
  const disc = Math.max(0, b * b - 4 * a * c);
  const root = Math.sqrt(disc);
  let t = 1;
  for (const cand of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
    if (cand >= 0 && cand <= 1) t = Math.min(t, cand);
  }
  return out.copy(origin).addScaledVector(_seg, t);
}
