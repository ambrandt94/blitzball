import * as THREE from 'three';

const _seg = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _chord = new THREE.Vector3();
const _axisUp = new THREE.Vector3();
const _axisRight = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _end = new THREE.Vector3();

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

/**
 * Control point for an aimed lob.
 *
 * The resting lob is `heightFrac` of the chord, pushed along `up`.
 * `bendRight` / `bendUp` are extra world-unit offsets along camera right / up
 * (the mouse). `handFrac` is a chord-fraction bias along camera right (the
 * throwing hand) and shares the mouse cap. Both are taken perpendicular to the
 * chord, so the bend changes
 * the curve without moving the target. Mouse bend is capped at
 * `maxBendFrac` × chord, then the point is pulled toward the chord midpoint
 * until it lies inside the sphere of radius `limit`. A sphere is convex, so
 * endpoints and a control point inside it keep the whole quadratic inside.
 */
export function shapedControl(
  out: THREE.Vector3,
  origin: THREE.Vector3,
  target: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3,
  heightFrac: number,
  bendRight: number,
  bendUp: number,
  maxBendFrac: number,
  limit: number,
  handFrac = 0,
): THREE.Vector3 {
  _mid.copy(origin).lerp(target, 0.5);
  _chord.copy(target).sub(origin);
  const len = _chord.length();
  if (len < 1e-4) {
    if (limit > 0 && _mid.length() > limit) _mid.setLength(limit);
    return out.copy(_mid);
  }
  _chord.multiplyScalar(1 / len);

  _axisUp.copy(up).addScaledVector(_chord, -up.dot(_chord));
  if (_axisUp.lengthSq() < 1e-6) {
    _axisUp.set(0, 1, 0).addScaledVector(_chord, -_chord.y);
    if (_axisUp.lengthSq() < 1e-6) _axisUp.set(1, 0, 0).addScaledVector(_chord, -_chord.x);
  }
  _axisUp.normalize();

  _axisRight.copy(right).addScaledVector(_chord, -right.dot(_chord));
  _axisRight.addScaledVector(_axisUp, -_axisRight.dot(_axisUp));
  if (_axisRight.lengthSq() < 1e-6) _axisRight.crossVectors(_chord, _axisUp);
  _axisRight.normalize();

  // Hand bias is part of the same capped offset as the mouse, so a strong
  // bend still owns the shape. With no mouse input the bias is the whole curve.
  let br = bendRight + handFrac * len;
  let bu = bendUp;
  const mouseLen = Math.hypot(br, bu);
  const maxMouse = Math.max(0, maxBendFrac) * len;
  if (mouseLen > maxMouse && mouseLen > 1e-8) {
    const scale = maxMouse / mouseLen;
    br *= scale;
    bu *= scale;
  }

  _offset.copy(_axisUp).multiplyScalar(len * heightFrac + bu).addScaledVector(_axisRight, br);
  return pullTowardMid(out, _mid, _offset, limit);
}

/**
 * Keep a marker inside the arena and at least `minDist` from the hand.
 * Past the shell it rides the sphere; too close, it is pushed out along
 * the hand→marker ray (then pulled back to the shell if that ray exits).
 */
export function clampAimMarker(
  out: THREE.Vector3,
  point: THREE.Vector3,
  hand: THREE.Vector3,
  minDist: number,
  limit: number,
): THREE.Vector3 {
  _end.copy(point);
  if (limit > 0 && _end.length() > limit) _end.setLength(limit);
  _seg.copy(_end).sub(hand);
  const dist = _seg.length();
  if (dist < minDist) {
    if (dist < 1e-5) _seg.set(0, 0, 1);
    else _seg.multiplyScalar(1 / dist);
    _end.copy(hand).addScaledVector(_seg, minDist);
    if (limit > 0 && _end.length() > limit) clampEndInside(_end, hand, _end, limit);
  }
  return out.copy(_end);
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

/** Largest scale in [0, 1] that keeps `mid + offset * s` inside the sphere. */
function pullTowardMid(
  out: THREE.Vector3,
  mid: THREE.Vector3,
  offset: THREE.Vector3,
  limit: number,
): THREE.Vector3 {
  if (!(limit > 0)) return out.copy(mid).add(offset);
  if (mid.length() > limit) mid.setLength(limit);
  const a = offset.lengthSq();
  if (a < 1e-10) return out.copy(mid);
  _end.copy(mid).add(offset);
  if (_end.length() <= limit) return out.copy(_end);
  const b = 2 * mid.dot(offset);
  const c = mid.lengthSq() - limit * limit;
  const disc = Math.max(0, b * b - 4 * a * c);
  const root = Math.sqrt(disc);
  let s = 1;
  let hit = false;
  for (const cand of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
    if (cand >= 0 && cand <= 1) {
      s = Math.min(s, cand);
      hit = true;
    }
  }
  if (!hit) s = 0;
  return out.copy(mid).addScaledVector(offset, s);
}
