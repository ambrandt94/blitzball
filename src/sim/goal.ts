import * as THREE from 'three';
import { ARENA_RADIUS, BALL, GOAL } from '../game/constants';

const CORNER_ANGLES = [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6] as const;

/** Local XY of a frame corner. Point-down equilateral, circumradius `GOAL.rimRadius`. */
export function goalCornerXY(index: 0 | 1 | 2): { x: number; y: number } {
  const a = CORNER_ANGLES[index];
  return { x: Math.cos(a) * GOAL.rimRadius, y: Math.sin(a) * GOAL.rimRadius };
}

/** Scoring vertex, inset from the frame so the posts themselves are solid. */
export function goalMouthVertex(index: 0 | 1 | 2): { x: number; y: number } {
  const c = goalCornerXY(index);
  return { x: c.x * GOAL.scoreScale, y: c.y * GOAL.scoreScale };
}

/** World position of a frame corner. Its length is the inner shell. */
export function goalCornerWorld(team: 0 | 1, index: 0 | 1 | 2, out = new THREE.Vector3()): THREE.Vector3 {
  const c = goalCornerXY(index);
  return out.set(c.x, c.y, goalPlaneZ(team));
}

/**
 * Bowed side of the frame. `inset` pulls the centerline toward the mouth
 * (negative pushes it out). `scale` shrinks the whole side toward the centroid.
 */
export function goalFrameCurve(
  index: 0 | 1 | 2,
  inset = 0,
  z = 0,
  scale = 1,
): THREE.QuadraticBezierCurve3 {
  const next = ((index + 1) % 3) as 0 | 1 | 2;
  const a = insetCorner(index, inset, z, scale);
  const b = insetCorner(next, inset, z, scale);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const pull = 1 - GOAL.bow;
  const control = new THREE.Vector3(mid.x * pull, mid.y * pull, z);
  return new THREE.QuadraticBezierCurve3(a, control, b);
}

function insetCorner(index: 0 | 1 | 2, inset: number, z: number, scale: number): THREE.Vector3 {
  const c = goalCornerXY(index);
  const len = Math.hypot(c.x, c.y) || 1;
  const k = Math.max(0.2, len - inset) / len;
  return new THREE.Vector3(c.x * k * scale, c.y * k * scale, z);
}

/** Mouth plane on the +Z end. Frame corners sit on the inner shell. */
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

/** Inradius of the scoring triangle. The opening itself is the triangle, not this circle. */
export function scoreRadius(): number {
  return GOAL.rimRadius * GOAL.scoreScale * 0.5;
}

function scoreScaleAt(depth: number): number {
  const t = Math.min(1, Math.max(0, depth / Math.max(0.2, GOAL.pocketDepth)));
  return GOAL.scoreScale * (1 - t * 0.38);
}

function pointInScaled(x: number, y: number, scale: number): boolean {
  const a = goalCornerXY(0);
  const b = goalCornerXY(1);
  const c = goalCornerXY(2);
  const ax = a.x * scale;
  const ay = a.y * scale;
  const bx = b.x * scale;
  const by = b.y * scale;
  const cx = c.x * scale;
  const cy = c.y * scale;
  const v0x = cx - ax;
  const v0y = cy - ay;
  const v1x = bx - ax;
  const v1y = by - ay;
  const v2x = x - ax;
  const v2y = y - ay;
  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-8) return false;
  const inv = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * inv;
  const v = (dot00 * dot12 - dot01 * dot02) * inv;
  return u >= -1e-4 && v >= -1e-4 && u + v <= 1 + 1e-4;
}

/** True when the mouth-plane point sits in the triangular opening. */
export function pointInGoalMouth(x: number, y: number): boolean {
  return pointInScaled(x, y, GOAL.scoreScale);
}

function clampToScore(point: THREE.Vector3, scale: number): void {
  for (let i = 0; i < 12; i++) {
    if (pointInScaled(point.x, point.y, scale)) return;
    point.x *= 0.84;
    point.y *= 0.84;
  }
}

/** Signed distance past the mouth, positive into the net. */
export function pocketDepthOf(point: THREE.Vector3, team: 0 | 1): number {
  return (point.z - goalPlaneZ(team)) * goalOutward(team);
}

/** Shallow triangular tunnel behind the frame. `team` limits the test to one mouth. */
export function inGoalPocket(point: THREE.Vector3, team?: 0 | 1): boolean {
  const teams: Array<0 | 1> = team === undefined ? [0, 1] : [team];
  for (const t of teams) {
    const depth = pocketDepthOf(point, t);
    if (depth < -0.2 || depth > GOAL.pocketDepth + 0.08) continue;
    if (pointInScaled(point.x, point.y, scoreScaleAt(Math.max(0, depth)))) return true;
  }
  return false;
}

function bezierPoint(index: 0 | 1 | 2, t: number): { x: number; y: number } {
  const next = ((index + 1) % 3) as 0 | 1 | 2;
  const a = goalCornerXY(index);
  const b = goalCornerXY(next);
  const mx = (a.x + b.x) * 0.5;
  const my = (a.y + b.y) * 0.5;
  const cx = mx * (1 - GOAL.bow);
  const cy = my * (1 - GOAL.bow);
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * cx + t * t * b.x,
    y: u * u * a.y + 2 * u * t * cy + t * t * b.y,
  };
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const ab2 = abx * abx + aby * aby || 1;
  let t = ((px - ax) * abx + (py - ay) * aby) / ab2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const dx = px - (ax + abx * t);
  const dy = py - (ay + aby * t);
  return Math.hypot(dx, dy);
}

/** Distance from a mouth-plane point to the bowed frame centerline. */
function distToFrame(x: number, y: number): number {
  let best = Infinity;
  for (let edge = 0; edge < 3; edge++) {
    let prev = bezierPoint(edge as 0 | 1 | 2, 0);
    for (let step = 1; step <= 8; step++) {
      const next = bezierPoint(edge as 0 | 1 | 2, step / 8);
      best = Math.min(best, distToSegment(x, y, prev.x, prev.y, next.x, next.y));
      prev = next;
    }
  }
  return best;
}

function distToCorner(x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const c = goalCornerXY(i as 0 | 1 | 2);
    best = Math.min(best, Math.hypot(x - c.x, y - c.y));
  }
  return best;
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
  let best: { team: 0 | 1; t: number; point: THREE.Vector3 } | null = null;
  for (const team of [0, 1] as const) {
    if (Math.abs(dz) < 1e-5) continue;
    const z = goalPlaneZ(team);
    const t = (z - origin.z) / dz;
    if (t < minT) continue;
    const x = origin.x + dx * t;
    const y = origin.y + dy * t;
    if (!pointInGoalMouth(x, y)) continue;
    if (!best || t < best.t) best = { team, t, point: new THREE.Vector3(x, y, z) };
  }
  return best;
}

/** A point inside the tunnel, just through `through` (a point on the mouth). */
export function pointInsidePocket(team: 0 | 1, through: THREE.Vector3): THREE.Vector3 {
  const depth = GOAL.pocketDepth * 0.45;
  const point = through.clone();
  point.z = goalPlaneZ(team) + goalOutward(team) * depth;
  clampToScore(point, scoreScaleAt(depth));
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
    if (pointInGoalMouth(x, y)) return team;
  }
  return null;
}

/** Keep a ball that has entered the tunnel from leaving through the back. */
export function containInNet(position: THREE.Vector3, velocity: THREE.Vector3): void {
  for (const team of [0, 1] as const) {
    if (!inGoalPocket(position, team)) continue;
    const outward = goalOutward(team);
    const plane = goalPlaneZ(team);
    const depth = Math.min(GOAL.pocketDepth * 0.92, Math.max(0, pocketDepthOf(position, team)));
    clampToScore(position, scoreScaleAt(depth));
    position.z = plane + outward * depth;
    if (velocity.z * outward > 0) velocity.z *= 0.15;
    velocity.multiplyScalar(0.62);
    return;
  }
}

/**
 * Bank off the frame. The triangular opening is not solid.
 * Returns true when the ball was pushed off a post or a corner.
 */
export function resolveGoalRim(position: THREE.Vector3, velocity: THREE.Vector3): boolean {
  const tube = GOAL.rimTube + BALL.radius;
  for (const team of [0, 1] as const) {
    const depth = pocketDepthOf(position, team);
    if (depth < -(tube + 0.35) || depth > GOAL.pocketDepth + 0.2) continue;
    if (pointInScaled(position.x, position.y, scoreScaleAt(Math.max(0, depth)) * 0.96)) continue;
    const onFrame = distToFrame(position.x, position.y) <= tube + 0.06;
    const onCorner = distToCorner(position.x, position.y) <= 1.2 + BALL.radius;
    if (!onFrame && !onCorner) continue;

    const outward = goalOutward(team);
    const plane = goalPlaneZ(team);
    position.z = plane - outward * (BALL.radius * 0.45);
    if (velocity.z * outward > 0) velocity.z *= -0.42;
    return true;
  }
  return false;
}
