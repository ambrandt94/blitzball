/**
 * Playtest water controls. Colours are the Clearer palette the sphere already
 * paints (sphere_palette.json). A grade of 1 leaves that picture untouched.
 * Caustic playback is four times slower than the old 6 fps frame step.
 */

export const WATER_TINT_DEFAULT = '#2E8A84';
export const WATER_DEEP_DEFAULT = '#163A48';
export const WATER_FOG_DEFAULT = '#1F6066';

/** Old Clearer web stepped at 6 fps. 1.5 is that loop, four times slower. */
export const CAUSTIC_FPS_DEFAULT = 1.5;
export const CAUSTIC_FPS_MIN = 0;
export const CAUSTIC_FPS_MAX = 8;

/** Screen-space diagonal bands. Off, because they streak the whole view. */
export const LIGHT_BANDS_DEFAULT = false;

/**
 * The ray-traced sphere is the play radius. The mesh is larger so the dithered
 * halo has triangles. The pool disc has to sit outside that mesh.
 */
export const WATER_HALO_SCALE = 1.07;
export const BASIN_DISC_Y = -0.6;
export const BASIN_CLEARANCE = 0.5;

const HEX = /^#[0-9a-fA-F]{6}$/;
const STORAGE_KEY = 'blitzball.waterColors';

export interface WaterColors {
  tint: string;
  deep: string;
  fog: string;
}

export function defaultWaterColors(): WaterColors {
  return {
    tint: WATER_TINT_DEFAULT,
    deep: WATER_DEEP_DEFAULT,
    fog: WATER_FOG_DEFAULT,
  };
}

/** Shared palette. Presets differ by shading, then write these into the pickers. */
export const PRESET_WATER_COLORS: Record<'Mockup' | 'Clearer' | 'Deeper', WaterColors> = {
  Mockup: defaultWaterColors(),
  Clearer: defaultWaterColors(),
  Deeper: defaultWaterColors(),
};

export function colorsForPreset(name: string): WaterColors {
  const found = PRESET_WATER_COLORS[name as keyof typeof PRESET_WATER_COLORS];
  return found ? { ...found } : defaultWaterColors();
}

export function hexToRgb01(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** sRGB scale that is 1 when `picked` is the reference colour. */
export function gradeMul(picked: string, ref: string): [number, number, number] {
  const a = hexToRgb01(picked);
  const b = hexToRgb01(ref);
  return [a[0] / Math.max(b[0], 1e-4), a[1] / Math.max(b[1], 1e-4), a[2] / Math.max(b[2], 1e-4)];
}

/**
 * Continuous frame position in `[0, frames)`. The shader cross-fades
 * `floor` and the next frame. A non-positive speed holds frame 0.
 */
export function causticPhase(timeSec: number, fps: number, frames = 4): number {
  if (!(fps > 0) || !(frames > 0)) return 0;
  const wrapped = (timeSec * fps) % frames;
  return wrapped < 0 ? wrapped + frames : wrapped;
}

/**
 * Kit-space drop for the pool bowl. The disc is authored at `BASIN_DISC_Y`;
 * after the drop its plane is `BASIN_CLEARANCE` metres below the halo mesh.
 */
export function basinBowlDrop(centerY: number, radius: number): number {
  const meshBottom = centerY - radius * WATER_HALO_SCALE;
  const target = meshBottom - BASIN_CLEARANCE;
  return Math.max(0, BASIN_DISC_Y - target);
}

function validHex(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

export function parseWaterColors(raw: unknown): WaterColors {
  const base = defaultWaterColors();
  if (!raw || typeof raw !== 'object') return base;
  const data = raw as Record<string, unknown>;
  if (validHex(data.tint)) base.tint = data.tint;
  if (validHex(data.deep)) base.deep = data.deep;
  if (validHex(data.fog)) base.fog = data.fog;
  return base;
}

export function loadWaterColors(): WaterColors {
  try {
    if (typeof localStorage === 'undefined') return defaultWaterColors();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultWaterColors();
    return parseWaterColors(JSON.parse(raw));
  } catch {
    return defaultWaterColors();
  }
}

export function saveWaterColors(colors: WaterColors): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
  } catch {
    // Ignore quota and private-mode failures.
  }
}
