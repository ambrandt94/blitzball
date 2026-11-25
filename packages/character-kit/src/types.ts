/** Character Forge runtime_v2 bands, low to high. */
export const LAYER_BANDS = ['under', 'base', 'mid', 'armor', 'outer'] as const;

export type LayerBand = (typeof LAYER_BANDS)[number];

export interface RaceDef {
  id: string;
  label: string;
}

export interface SlotDef {
  id: string;
  band: string;
  layer: number;
  region?: string;
}

export interface GarmentDef {
  id: string;
  slot: string;
  band: string;
  layer: number;
  label: string;
  file: string;
  material: string;
  mask?: string;
  hides: string[];
  /** Other garments that must not be worn with this one. */
  displaces: string[];
  incompatibilities: string[];
  /** Pulled in automatically when this piece is worn. */
  wornOver: string[];
  nodes: string[];
  /** Hide token (`trunks:leg_L`) to the mesh node name. */
  segments: Record<string, string>;
}

export interface LookDef {
  id: string;
  file: string;
  garments: string[];
  materials: string[];
}

/** wardrobe.json, plus the fields a project may omit. */
export interface WardrobeManifest {
  base?: {
    file?: string;
    segments?: Record<string, string>;
  };
  bands?: string[];
  slots?: Record<string, { band?: string; region?: string; layer?: number }>;
  garments?: Record<string, Partial<GarmentDef> & { file?: string }>;
  looks?: Record<string, { file?: string; garments?: string[]; materials?: string[] }>;
}

export interface OutfitDef {
  id: string;
  label: string;
  race: string;
  /** Slot id to garment id. Empty slots are left off. */
  slots: Record<string, string>;
}

/** Shareable character setup. Colors are `#rrggbb` per garment id. */
export interface Loadout {
  v: 1;
  race: string;
  outfit: string | null;
  slots: Record<string, string | null>;
  colors: Record<string, string>;
}

export interface HidePlan {
  worn: string[];
  /** Garments that still have at least one visible mesh. */
  visible: string[];
  hiddenGarments: string[];
  hiddenBodyNodes: string[];
  hiddenGarmentNodes: { garmentId: string; nodeName: string }[];
  /** Prebaked file when one matches this worn set, otherwise null. */
  bakedFile: string | null;
}
