/**
 * Placement for the Model Forge stadium kit, in kit metres.
 * The water sphere in that kit is radius 68 with its centre at y = 70
 * (the bottom sits just above the pool). Gameplay keeps the sphere at the
 * origin, so the whole kit is scaled by arenaRadius/68 and shifted down.
 *
 * Polar convention from models/README.md:
 *   position (r cos φ, h, -r sin φ), rotation.y = φ
 * Ring pieces use r = 0, h = 0 and rotation only. They are authored on +X.
 */

export const KIT_SPHERE_RADIUS = 68;
export const KIT_SPHERE_CENTER_Y = 70;
export const KIT_WEDGE_DEG = 15;
export const KIT_WEDGE_COUNT = 24;

export interface StadiumTransform {
  scale: number;
  offsetY: number;
}

export function stadiumTransform(arenaRadius: number): StadiumTransform {
  const scale = arenaRadius / KIT_SPHERE_RADIUS;
  return { scale, offsetY: -KIT_SPHERE_CENTER_Y * scale };
}

export interface KitPlacement {
  /** Radians, right-handed, 0 on +X, positive toward -Z. */
  phi: number;
  r: number;
  h: number;
}

const DEG = Math.PI / 180;

export function standPlacements(): KitPlacement[] {
  const out: KitPlacement[] = [];
  for (let k = 0; k < KIT_WEDGE_COUNT; k++) out.push({ phi: KIT_WEDGE_DEG * k * DEG, r: 0, h: 0 });
  return out;
}

/** Walls where the index is not a gate, and the four outward gates. */
export function wallPlacements(): { phi: number; gate: boolean }[] {
  const out: { phi: number; gate: boolean }[] = [];
  for (let k = 0; k < KIT_WEDGE_COUNT; k++) {
    out.push({ phi: KIT_WEDGE_DEG * k * DEG, gate: k % 6 === 0 });
  }
  return out;
}

/** Eight towers flanking the gates. Local +X (the door) faces out. */
export function towerPlacements(): KitPlacement[] {
  const out: KitPlacement[] = [];
  const flank = 7.5 * DEG;
  for (let m = 0; m < 4; m++) {
    const base = 90 * m * DEG;
    out.push({ phi: base - flank, r: 192, h: 0 });
    out.push({ phi: base + flank, r: 192, h: 0 });
  }
  return out;
}

export function crystalPlacements(): KitPlacement[] {
  const out: KitPlacement[] = [];
  for (let m = 0; m < 4; m++) out.push({ phi: (45 + 90 * m) * DEG, r: 88, h: 0 });
  return out;
}

export function bannerPlacements(): KitPlacement[] {
  const out: KitPlacement[] = [];
  for (let k = 0; k < KIT_WEDGE_COUNT; k++) {
    out.push({ phi: KIT_WEDGE_DEG * k * DEG, r: 189.7, h: 75 });
  }
  return out;
}

/**
 * Seat rows from models/stands_rows.json. One wedge, authored on +X.
 * Rows 0–7 tier 0, then 8 each. Radius is the seat line, height the tread.
 */
export const STAND_ROWS: { radius: number; height: number; tier: number }[] = [
  [111.3, 6],
  [113, 7],
  [115, 8],
  [117, 9],
  [119, 10],
  [121, 11],
  [123, 12],
  [125, 13],
  [131.3, 20],
  [133, 21],
  [135, 22],
  [137, 23],
  [139, 24],
  [141, 25],
  [143, 26],
  [145, 27],
  [151.3, 34],
  [153, 35],
  [155, 36],
  [157, 37],
  [159, 38],
  [161, 39],
  [163, 40],
  [165, 41],
  [171.3, 48],
  [173, 49],
  [175, 50],
  [177, 51],
  [179, 52],
  [181, 53],
  [183, 54],
  [185, 55],
].map(([radius, height], index) => ({ radius: radius!, height: height!, tier: Math.floor(index / 8) }));

export type CrowdDensity = 'off' | 'low' | 'high';

export interface CrowdSlot {
  x: number;
  y: number;
  z: number;
  /** Sprite id 0–31 in the crowd atlas. */
  sprite: number;
  /** 1 if this spectator cheers on their own, between goals. */
  lively: number;
}

const TEAM_A = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const TEAM_B = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
const TEAM_N = [24, 25, 26, 27, 28, 29, 30, 31];

function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Idle-frame UV rect in three.js flipY space: [u, v, width, height].
 * Cheer is the atlas row below, so the shader subtracts 0.25 from v.
 */
export function crowdSpriteUv(id: number): [number, number, number, number] {
  const col = ((id % 16) + 16) % 16;
  const row = Math.floor(id / 16) * 2;
  const w = 1 / 16;
  const h = 1 / 4;
  return [col * w, 1 - (row + 1) * h, w, h];
}

/**
 * Team sections follow the goals. Orange (team 1, −Z, artist Team A rust)
 * and blue (team 0, +Z, artist Team B teal). Neutrals hold the sidelines
 * and a few seats inside each block.
 *
 * z = −r sin φ, so sin φ > 0 is the orange end.
 */
function spriteFor(phi: number, salt: number): { sprite: number; lively: number } {
  const side = Math.sin(phi);
  let pool = Math.abs(side) < 0.22 ? TEAM_N : side > 0 ? TEAM_A : TEAM_B;
  if (pool !== TEAM_N && hash01(salt + 4.2) < 0.1) pool = TEAM_N;
  const sprite = pool[Math.floor(hash01(salt) * pool.length)] ?? 0;
  return { sprite, lively: hash01(salt + 19) > 0.84 ? 1 : 0 };
}

/**
 * Thousands of bottom-centre seats. High keeps every row at about 2 m spacing.
 * Low skips every other row and sits them further apart.
 */
export function buildCrowdSlots(density: CrowdDensity): CrowdSlot[] {
  if (density === 'off') return [];
  const spacing = density === 'high' ? 2 : 3.3;
  const stride = density === 'high' ? 1 : 2;
  const wedge = KIT_WEDGE_DEG * DEG;
  const slots: CrowdSlot[] = [];
  for (let w = 0; w < KIT_WEDGE_COUNT; w++) {
    const phi0 = w * wedge;
    for (let r = 0; r < STAND_ROWS.length; r += stride) {
      const row = STAND_ROWS[r]!;
      const arc = row.radius * wedge;
      const count = Math.max(2, Math.floor(arc / spacing));
      for (let i = 0; i < count; i++) {
        const across = (i + 0.5) / count - 0.5;
        const phi = phi0 + across * wedge;
        const jitter = (hash01(w * 17.3 + r * 3.1 + i * 9.7) - 0.5) * 0.22;
        const radius = row.radius - 0.4 + jitter;
        const picked = spriteFor(phi, w * 1000 + r * 40 + i);
        slots.push({
          x: radius * Math.cos(phi),
          y: row.height + 0.06,
          z: -radius * Math.sin(phi),
          sprite: picked.sprite,
          lively: picked.lively,
        });
      }
    }
  }
  return slots;
}
