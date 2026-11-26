import type { WaterPreset } from '../game/types';
import type { WaterColors } from '../render/waterSettings';

export type WaterLookId = 'lagoon' | 'classic' | 'deep' | 'murky' | 'twilight' | 'crystal' | 'custom';

export interface WaterLook {
  id: Exclude<WaterLookId, 'custom'>;
  label: string;
  /** Shader shading family. Colour is separate. */
  shader: WaterPreset;
  colors: WaterColors;
}

export const WATER_LOOKS: readonly WaterLook[] = [
  {
    id: 'lagoon',
    label: 'Clear Lagoon',
    shader: 'Clearer',
    colors: { tint: '#3ec8c0', deep: '#0e4a58', fog: '#1a8a90', clarity: 0.86, fogStart: 14 },
  },
  {
    id: 'classic',
    label: 'Classic Blitz Sphere',
    shader: 'Clearer',
    colors: { tint: '#2E8A84', deep: '#163A48', fog: '#1F6066', clarity: 0.68, fogStart: 8 },
  },
  {
    id: 'deep',
    label: 'Deep Ocean',
    shader: 'Deeper',
    colors: { tint: '#0c3a58', deep: '#041820', fog: '#062838', clarity: 0.28, fogStart: 4 },
  },
  {
    id: 'murky',
    label: 'Murky Green',
    shader: 'Mockup',
    colors: { tint: '#3a6a28', deep: '#14240e', fog: '#2a4a18', clarity: 0.35, fogStart: 5 },
  },
  {
    id: 'twilight',
    label: 'Twilight',
    shader: 'Deeper',
    colors: { tint: '#3a2a68', deep: '#120818', fog: '#2a1848', clarity: 0.5, fogStart: 7 },
  },
  {
    id: 'crystal',
    label: 'Crystal',
    shader: 'Clearer',
    colors: { tint: '#b8e8f0', deep: '#6aa8c0', fog: '#d8f4f8', clarity: 0.95, fogStart: 22 },
  },
];

export function waterLookById(id: string): WaterLook | null {
  return WATER_LOOKS.find((look) => look.id === id) ?? null;
}

export function cycleWaterLook(id: string, step: number): WaterLook {
  const index = WATER_LOOKS.findIndex((look) => look.id === id);
  const start = index < 0 ? 0 : index;
  const next = (start + step + WATER_LOOKS.length) % WATER_LOOKS.length;
  return WATER_LOOKS[next]!;
}

const CUSTOM_KEY = 'blitzball.waterLookCustom';

export interface SavedWaterLook {
  shader: WaterPreset;
  colors: WaterColors;
}

export function saveCustomWaterLook(look: SavedWaterLook, store: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    store.setItem(CUSTOM_KEY, JSON.stringify(look));
  } catch {
    // Ignore quota and private-mode failures.
  }
}

export function loadCustomWaterLook(store: Pick<Storage, 'getItem'> = localStorage): SavedWaterLook | null {
  try {
    const raw = store.getItem(CUSTOM_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<SavedWaterLook>;
    if (!data.colors || (data.shader !== 'Mockup' && data.shader !== 'Clearer' && data.shader !== 'Deeper')) return null;
    return { shader: data.shader, colors: data.colors };
  } catch {
    return null;
  }
}
