import * as THREE from 'three';
import { ARENA_RADIUS, WALL } from '../game/constants';

export interface WallHitResult {
  escaped: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
}

/**
 * Sphere wall model:
 * - Hard straight hits (near-normal incidence + high speed) can "fly out" (treated as escape → reset later)
 *   or get a weak rebound.
 * - Angled contact banks / rides the edge with higher restitution along the tangent.
 */
export function resolveSphereWall(
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  radius: number,
  opts: {
    escapeSpeed: number;
    escapeAngle: number;
    allowEscape: boolean;
  },
): WallHitResult {
  const limit = ARENA_RADIUS - radius;
  const dist = position.length();
  if (dist <= limit) {
    return { escaped: false, position, velocity };
  }

  const normal = position.clone().normalize();
  // Push back inside.
  position.copy(normal).multiplyScalar(limit);

  const vn = velocity.dot(normal);
  if (vn >= 0) {
    // Moving outward or sliding — apply bank/slide.
  }

  const speed = velocity.length();
  // Angle from normal: 0 = straight into wall, π/2 = grazing.
  const into = Math.max(0, -vn);
  const angleFromNormal = speed > 1e-4 ? Math.acos(THREE.MathUtils.clamp(into / speed, 0, 1)) : Math.PI / 2;

  if (opts.allowEscape && into >= opts.escapeSpeed * 0.55 && angleFromNormal < opts.escapeAngle) {
    // Hard straight hit — escape (ball flies "out" of play).
    return { escaped: true, position, velocity };
  }

  // Reflect with energy based on angle: steeper = more loss; graze = bank.
  const t = THREE.MathUtils.clamp(angleFromNormal / (Math.PI / 2), 0, 1);
  const restitution = THREE.MathUtils.lerp(WALL.escapeRestitution, WALL.bankRestitution, t);
  const reflected = velocity.clone().sub(normal.clone().multiplyScalar(2 * vn));
  // Kill a bit of tangential energy on hard hits; preserve on banks.
  const tangent = reflected.clone().sub(normal.clone().multiplyScalar(reflected.dot(normal)));
  const normalComp = normal.clone().multiplyScalar(-Math.abs(vn) * restitution);
  const slideKeep = THREE.MathUtils.lerp(1 - WALL.slideFriction, 1, t);
  velocity.copy(normalComp).add(tangent.multiplyScalar(slideKeep));

  return { escaped: false, position, velocity };
}

export function constrainPlayerToSphere(
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  radius: number,
): void {
  const limit = ARENA_RADIUS - radius;
  const dist = position.length();
  if (dist <= limit) return;
  const normal = position.clone().normalize();
  position.copy(normal).multiplyScalar(limit);
  const vn = velocity.dot(normal);
  if (vn > 0) {
    // Cancel the outward part only. Reflecting it (the old restitution push)
    // reversed swim direction on contact. Bodies slerp toward velocity, so
    // that reversal whipped facing around every time you met the wall.
    velocity.addScaledVector(normal, -vn);
  }
}
