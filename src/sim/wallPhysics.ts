import * as THREE from 'three';
import { ARENA_RADIUS, WALL } from '../game/constants';

export interface WallHitResult {
  escaped: boolean;
  /** True when this call reflected an outward velocity off the shell. */
  bounced: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
}

/**
 * Sphere wall. A hit reflects off the outward normal. Grazes keep their
 * tangent (the curve); every bounce gives a little speed back to the water.
 * A hard straight shot is allowed to leave so the breach can play out.
 * The ball is not pulled back inside on that path.
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
  if (dist <= limit || dist < 1e-6) {
    return { escaped: false, bounced: false, position, velocity };
  }

  const normal = position.clone().multiplyScalar(1 / dist);
  const vn = velocity.dot(normal);
  const speed = velocity.length();
  const outward = Math.max(0, vn);
  const angleFromNormal = speed > 1e-4 ? Math.acos(THREE.MathUtils.clamp(outward / speed, 0, 1)) : Math.PI / 2;

  if (opts.allowEscape && outward >= opts.escapeSpeed * 0.55 && angleFromNormal < opts.escapeAngle) {
    return { escaped: true, bounced: false, position, velocity };
  }

  position.copy(normal).multiplyScalar(limit);
  if (vn > 0.02) {
    const graze = THREE.MathUtils.clamp(angleFromNormal / (Math.PI / 2), 0, 1);
    const restitution = THREE.MathUtils.lerp(0.74, WALL.bankRestitution, graze);
    velocity.addScaledVector(normal, -(1 + restitution) * vn);
    // A small loss on the whole vector. The tangent, and the spin it reads as, stays.
    velocity.multiplyScalar(THREE.MathUtils.lerp(0.96, 0.99, graze));
  }
  return { escaped: false, bounced: vn > 0.02, position, velocity };
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
