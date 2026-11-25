import * as THREE from 'three';

/** Seconds from the start of the swing to the follow-through. */
export const KICK_SWING_TIME = 0.34;
/** Phase of the swing where the foot is fastest. */
export const KICK_SWEET = 0.5;

function smooth(u: number): number {
  const t = THREE.MathUtils.clamp(u, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Foot offset in the swimmer's facing / up frame. `u` is 0 at the cock and 1 at the end. */
export function kickFootLocal(u: number): { forward: number; down: number } {
  const t = smooth(u);
  return {
    forward: 0.12 + 1.05 * t,
    down: 0.3 - 0.06 * Math.sin(THREE.MathUtils.clamp(u, 0, 1) * Math.PI),
  };
}

/** How fast the foot is moving through its arc, in metres per second, ignoring the body. */
export function kickFootSpeed(u: number, duration: number): number {
  const span = Math.max(0.05, duration);
  const du = 0.01;
  const a = kickFootLocal(Math.max(0, u - du));
  const b = kickFootLocal(Math.min(1, u + du));
  const rate = Math.hypot(b.forward - a.forward, b.down - a.down) / (2 * du);
  return rate / span;
}

export function kickFootPoint(
  out: THREE.Vector3,
  position: THREE.Vector3,
  facing: THREE.Vector3,
  up: THREE.Vector3,
  u: number,
): THREE.Vector3 {
  const local = kickFootLocal(u);
  const fwd = _fwd.copy(facing);
  if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, 1);
  else fwd.normalize();
  const lift = _up.copy(up);
  if (lift.lengthSq() < 1e-8) lift.set(0, 1, 0);
  else lift.normalize();
  return out.copy(position).addScaledVector(fwd, local.forward).addScaledVector(lift, -local.down);
}

/** 1 on the sweet spot, falling off across `width` (phase units). */
export function kickQuality(u: number, sweet: number, width: number): number {
  const w = Math.max(0.02, width);
  const x = (u - sweet) / w;
  return Math.exp(-x * x);
}

const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
