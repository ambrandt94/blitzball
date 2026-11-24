import * as THREE from 'three';
import { ARENA_RADIUS, BALL, GOAL } from '../game/constants';

/** Mouth plane on the +Z end. The hoop's centerline sits on the inner shell. */
export function goalMouthZ(): number {
  const shell = ARENA_RADIUS - 0.2;
  const radial = GOAL.rimRadius;
  return Math.sqrt(Math.max(1, shell * shell - radial * radial));
}

export function goalPlaneZ(team: 0 | 1): number {
  return goalMouthZ() * (team === 0 ? 1 : -1);
}

export function goalOutward(team: 0 | 1): number {
  return team === 0 ? 1 : -1;
}

/** Opening the ball can pass through. The ring tube itself is solid. */
export function scoreRadius(): number {
  return Math.max(0.5, GOAL.rimRadius - BALL.radius * 0.25);
}

/** Signed distance past the mouth, positive into the net. */
export function pocketDepthOf(point: THREE.Vector3, team: 0 | 1): number {
  return (point.z - goalPlaneZ(team)) * goalOutward(team);
}

/** Rounded net behind the hoop. `team` limits the test to one mouth. */
export function inGoalPocket(point: THREE.Vector3, team?: 0 | 1): boolean {
  const teams: Array<0 | 1> = team === undefined ? [0, 1] : [team];
  const radius = GOAL.rimRadius + 0.08;
  for (const t of teams) {
    const depth = pocketDepthOf(point, t);
    if (depth < -0.15 || depth > GOAL.rimRadius + 0.2) continue;
    const radial = Math.hypot(point.x, point.y);
    const d = Math.max(0, depth);
    if (radial * radial + d * d <= radius * radius && radial <= GOAL.rimRadius + 0.02) return true;
  }
  return false;
}

/**
 * First mouth the ray enters. `dir` need not be normalized.
 * `t` is world units along `dir`.
 */
export function rayHitsMouth(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  minT = 0.35,
): { team: 0 | 1; t: number; point: THREE.Vector3 } | null {
  const len = dir.length();
  if (len < 1e-8) return null;
  const dx = dir.x / len;
  const dy = dir.y / len;
  const dz = dir.z / len;
  const radius = scoreRadius();
  let best: { team: 0 | 1; t: number; point: THREE.Vector3 } | null = null;
  for (const team of [0, 1] as const) {
    if (Math.abs(dz) < 1e-5) continue;
    const z = goalPlaneZ(team);
    const t = (z - origin.z) / dz;
    if (t < minT) continue;
    const x = origin.x + dx * t;
    const y = origin.y + dy * t;
    if (x * x + y * y > radius * radius) continue;
    if (!best || t < best.t) best = { team, t, point: new THREE.Vector3(x, y, z) };
  }
  return best;
}

/** A point inside the dome, just through `through` (a point on the mouth). */
export function pointInsidePocket(team: 0 | 1, through: THREE.Vector3): THREE.Vector3 {
  const depth = GOAL.rimRadius * 0.42;
  const point = through.clone();
  point.z = goalPlaneZ(team) + goalOutward(team) * depth;
  const radial = Math.hypot(point.x, point.y);
  const maxR = Math.sqrt(Math.max(0.25, GOAL.rimRadius * GOAL.rimRadius - depth * depth)) * 0.8;
  if (radial > maxR && radial > 1e-4) {
    const scale = maxR / radial;
    point.x *= scale;
    point.y *= scale;
  }
  return point;
}

/** Team whose mouth this segment crosses, or whose net contains either end. */
export function segmentScores(from: THREE.Vector3, to: THREE.Vector3): 0 | 1 | null {
  for (const team of [0, 1] as const) {
    if (inGoalPocket(from, team) || inGoalPocket(to, team)) return team;
    const plane = goalPlaneZ(team);
    const dz = to.z - from.z;
    if (Math.abs(dz) < 1e-6) continue;
    const u = (plane - from.z) / dz;
    if (u < 0 || u > 1) continue;
    const x = from.x + (to.x - from.x) * u;
    const y = from.y + (to.y - from.y) * u;
    const radius = scoreRadius();
    if (x * x + y * y <= radius * radius) return team;
  }
  return null;
}

/** Keep a ball that has entered the dome from leaving through the back of the net. */
export function containInNet(position: THREE.Vector3, velocity: THREE.Vector3): void {
  for (const team of [0, 1] as const) {
    if (!inGoalPocket(position, team)) continue;
    const outward = goalOutward(team);
    const plane = goalPlaneZ(team);
    const depth = Math.max(0, pocketDepthOf(position, team));
    const radial = Math.hypot(position.x, position.y);
    const radius = Math.max(0.4, GOAL.rimRadius - BALL.radius * 0.35);
    if (depth * depth + radial * radial > radius * radius) {
      const len = Math.hypot(depth, radial) || 1;
      const scale = (radius - 0.05) / len;
      const nextDepth = depth * scale;
      const nextRadial = radial * scale;
      position.z = plane + outward * nextDepth;
      if (radial > 1e-4) {
        position.x *= nextRadial / radial;
        position.y *= nextRadial / radial;
      }
    }
    const outwardSpeed = velocity.z * outward;
    if (outwardSpeed > 0) velocity.z -= outward * outwardSpeed;
    velocity.multiplyScalar(0.55);
    return;
  }
}

/**
 * Bank off the hoop itself. The opening (inside `scoreRadius`) is not solid.
 * Returns true when the ball was pushed out of the ring.
 */
export function resolveGoalRim(position: THREE.Vector3, velocity: THREE.Vector3): boolean {
  for (const team of [0, 1] as const) {
    const depth = pocketDepthOf(position, team);
    const band = GOAL.rimTube + BALL.radius;
    if (depth < -band || depth > band) continue;
    const radial = Math.hypot(position.x, position.y);
    const inner = scoreRadius();
    const outer = GOAL.rimRadius + GOAL.rimTube + BALL.radius * 0.45;
    if (radial <= inner || radial >= outer) continue;

    const outward = goalOutward(team);
    const plane = goalPlaneZ(team);
    position.z = plane - outward * (BALL.radius * 0.4);
    if (velocity.z * outward > 0) velocity.z *= -0.42;

    const ring = GOAL.rimRadius;
    if (radial > 0.05) {
      const target = radial < ring ? Math.max(0.2, inner - 0.08) : outer + 0.08;
      const scale = target / radial;
      position.x *= scale;
      position.y *= scale;
    }
    return true;
  }
  return false;
}
