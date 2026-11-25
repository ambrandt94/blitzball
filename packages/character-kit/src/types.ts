/** cf-kit/1 bands, low to high. A higher band wins a conflict. */
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

/**
 * One wardrobe.json garment, plus its registry id.
 * `displaces` and `incompatible` are the same list. A document may use either name.
 */
export interface GarmentDef {
  id: string;
  slot: string;
  band: string;
  layer: number;
  kind?: string;
  label: string;
  file: string;
  material: string;
  texture?: string;
  mask?: string;
  hides: string[];
  hiddenBy: string[];
  displaces: string[];
  incompatible: string[];
  wornOver: string[];
  nodes: string[];
  /** Hide token (`blitzball/trunks:leg_L`) to the mesh node name. */
  segments: Record<string, string>;
  shellOffsetM?: number | [number, number];
}

export interface LookDef {
  id: string;
  file: string;
  garments: string[];
  materials: string[];
}

/** wardrobe.json. Garment ids in the file are unprefixed; loadKit adds the project prefix. */
export interface WardrobeManifest {
  format?: string;
  base?: {
    file?: string;
    segments?: Record<string, string>;
  };
  bands?: string[];
  slots?: Record<string, { band?: string; region?: string; layer?: number }>;
  garments?: Record<string, WardrobeGarment>;
  looks?: Record<string, { file?: string; garments?: string[]; materials?: string[] }>;
  tint?: {
    material?: string;
    how?: string;
    mask?: string;
  };
}

/** Fields a wardrobe garment may carry. `incompatible` is an alias of `displaces`. */
export interface WardrobeGarment {
  slot?: string;
  band?: string;
  layer?: number;
  kind?: string;
  label?: string;
  file?: string;
  material?: string;
  texture?: string;
  mask?: string;
  hides?: string[];
  hiddenBy?: string[];
  displaces?: string[];
  incompatible?: string[];
  wornOver?: string[];
  nodes?: string[];
  segments?: Record<string, string>;
  shellOffsetM?: number | [number, number];
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
