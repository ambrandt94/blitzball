import { LAYER_BANDS } from './types';
import type {
  GarmentDef,
  HidePlan,
  LayerBand,
  Loadout,
  LookDef,
  OutfitDef,
  RaceDef,
  SlotDef,
  WardrobeManifest,
} from './types';

const HEX = /^#[0-9a-fA-F]{6}$/;

function asList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function garmentFromManifest(id: string, raw: Partial<GarmentDef> & { file?: string }): GarmentDef | null {
  if (!raw.file) return null;
  const displaces = asList(raw.displaces);
  const incompatibilities = asList(raw.incompatibilities);
  return {
    id,
    slot: raw.slot ?? id,
    band: raw.band ?? 'base',
    layer: typeof raw.layer === 'number' ? raw.layer : 0,
    label: raw.label ?? id,
    file: raw.file,
    material: raw.material ?? 'TeamTint',
    mask: raw.mask,
    hides: asList(raw.hides),
    displaces,
    incompatibilities,
    wornOver: asList(raw.wornOver),
    nodes: asList(raw.nodes),
    segments: raw.segments ?? {},
  };
}

export interface CharacterKit {
  registerRace(race: RaceDef): void;
  registerSlot(slot: SlotDef): void;
  registerGarment(garment: GarmentDef): void;
  registerOutfit(outfit: OutfitDef): void;
  registerLook(look: LookDef): void;
  setBands(bands: readonly string[]): void;
  setBase(file: string, segments: Record<string, string>): void;
  /** Slots, garments, looks, and the base file from a wardrobe.json document. */
  registerWardrobe(manifest: WardrobeManifest): void;
  race(id: string): RaceDef | null;
  races(): RaceDef[];
  slot(id: string): SlotDef | null;
  garment(id: string): GarmentDef | null;
  outfit(id: string): OutfitDef | null;
  outfits(): OutfitDef[];
  look(id: string): LookDef | null;
  baseFile(): string;
  baseSegments(): Record<string, string>;
  loadoutFromOutfit(outfitId: string, colors?: Record<string, string>): Loadout;
  resolve(loadout: Loadout): HidePlan;
  serialize(loadout: Loadout): string;
  parse(raw: string): Loadout | null;
}

export function createCharacterKit(): CharacterKit {
  const races = new Map<string, RaceDef>();
  const slots = new Map<string, SlotDef>();
  const garments = new Map<string, GarmentDef>();
  const outfits = new Map<string, OutfitDef>();
  const looks = new Map<string, LookDef>();
  let bands: string[] = [...LAYER_BANDS];
  let baseFile = '';
  let baseSegments: Record<string, string> = {};

  function bandRank(band: string): number {
    const index = bands.indexOf(band);
    return index < 0 ? bands.length : index;
  }

  function conflicts(a: GarmentDef, b: GarmentDef): boolean {
    return (
      a.displaces.includes(b.id) ||
      b.displaces.includes(a.id) ||
      a.incompatibilities.includes(b.id) ||
      b.incompatibilities.includes(a.id) ||
      (a.slot === b.slot && a.id !== b.id)
    );
  }

  function prefer(a: GarmentDef, b: GarmentDef): GarmentDef {
    const bandDelta = bandRank(a.band) - bandRank(b.band);
    if (bandDelta !== 0) return bandDelta > 0 ? a : b;
    if (a.layer !== b.layer) return a.layer > b.layer ? a : b;
    return a;
  }

  const kit: CharacterKit = {
    registerRace(race) {
      races.set(race.id, race);
    },
    registerSlot(slot) {
      slots.set(slot.id, slot);
    },
    registerGarment(garment) {
      garments.set(garment.id, garment);
    },
    registerOutfit(outfit) {
      outfits.set(outfit.id, outfit);
    },
    registerLook(look) {
      looks.set(look.id, look);
    },
    setBands(next) {
      bands = [...next];
    },
    setBase(file, segments) {
      baseFile = file;
      baseSegments = { ...segments };
    },
    registerWardrobe(manifest) {
      if (manifest.bands && manifest.bands.length > 0) bands = [...manifest.bands];
      if (manifest.base?.file) baseFile = manifest.base.file;
      if (manifest.base?.segments) baseSegments = { ...manifest.base.segments };
      for (const [id, slot] of Object.entries(manifest.slots ?? {})) {
        kit.registerSlot({
          id,
          band: slot.band ?? 'base',
          layer: typeof slot.layer === 'number' ? slot.layer : 0,
          region: slot.region,
        });
      }
      for (const [id, raw] of Object.entries(manifest.garments ?? {})) {
        const garment = garmentFromManifest(id, raw);
        if (garment) kit.registerGarment(garment);
      }
      for (const [id, look] of Object.entries(manifest.looks ?? {})) {
        if (!look.file) continue;
        kit.registerLook({
          id,
          file: look.file,
          garments: asList(look.garments),
          materials: asList(look.materials),
        });
      }
    },
    race(id) {
      return races.get(id) ?? null;
    },
    races() {
      return [...races.values()];
    },
    slot(id) {
      return slots.get(id) ?? null;
    },
    garment(id) {
      return garments.get(id) ?? null;
    },
    outfit(id) {
      return outfits.get(id) ?? null;
    },
    outfits() {
      return [...outfits.values()];
    },
    look(id) {
      return looks.get(id) ?? null;
    },
    baseFile() {
      return baseFile;
    },
    baseSegments() {
      return { ...baseSegments };
    },
    loadoutFromOutfit(outfitId, colors = {}) {
      const outfit = outfits.get(outfitId);
      const slotsOut: Record<string, string | null> = {};
      for (const id of slots.keys()) slotsOut[id] = null;
      if (outfit) {
        for (const [slotId, garmentId] of Object.entries(outfit.slots)) {
          if (garments.has(garmentId)) slotsOut[slotId] = garmentId;
        }
      }
      const kept: Record<string, string> = {};
      for (const [id, color] of Object.entries(colors)) {
        if (HEX.test(color)) kept[id] = color.toLowerCase();
      }
      return { v: 1, race: outfit?.race ?? '', outfit: outfit ? outfitId : null, slots: slotsOut, colors: kept };
    },
    resolve(loadout) {
      return resolveLoadout(loadout, garments, baseSegments, looks, conflicts, prefer);
    },
    serialize(loadout) {
      return JSON.stringify(loadout);
    },
    parse(raw) {
      return parseLoadout(raw, garments, races, outfits);
    },
  };
  return kit;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((id, index) => id === right[index]);
}

function resolveLoadout(
  loadout: Loadout,
  garments: Map<string, GarmentDef>,
  baseSegments: Record<string, string>,
  looks: Map<string, LookDef>,
  conflicts: (a: GarmentDef, b: GarmentDef) => boolean,
  prefer: (a: GarmentDef, b: GarmentDef) => GarmentDef,
): HidePlan {
  const chosen: GarmentDef[] = [];
  for (const garmentId of Object.values(loadout.slots)) {
    if (!garmentId) continue;
    const garment = garments.get(garmentId);
    if (garment && !chosen.some((item) => item.id === garment.id)) chosen.push(garment);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const garment of [...chosen]) {
      for (const underId of garment.wornOver) {
        const under = garments.get(underId);
        if (!under || chosen.some((item) => item.id === under.id)) continue;
        chosen.push(under);
        grew = true;
      }
    }
  }
  const kept: GarmentDef[] = [];
  for (const garment of chosen) {
    const rival = kept.find((item) => conflicts(item, garment));
    if (!rival) {
      kept.push(garment);
      continue;
    }
    const winner = prefer(garment, rival);
    const loser = winner === garment ? rival : garment;
    const index = kept.indexOf(loser);
    if (index >= 0) kept.splice(index, 1);
    if (!kept.includes(winner)) kept.push(winner);
  }

  const hiddenGarments: string[] = [];
  const hiddenBodyNodes: string[] = [];
  const hiddenGarmentNodes: { garmentId: string; nodeName: string }[] = [];
  const wornIds = kept.map((item) => item.id);
  for (const garment of kept) {
    for (const hide of garment.hides) {
      if (hide.startsWith('body:')) {
        const node = baseSegments[hide];
        if (node && !hiddenBodyNodes.includes(node)) hiddenBodyNodes.push(node);
        continue;
      }
      const split = hide.indexOf(':');
      if (split < 0) {
        if (wornIds.includes(hide) && !hiddenGarments.includes(hide)) hiddenGarments.push(hide);
        continue;
      }
      const garmentId = hide.slice(0, split);
      const target = garments.get(garmentId);
      const nodeName = target?.segments[hide];
      if (!nodeName || !wornIds.includes(garmentId)) continue;
      if (!hiddenGarmentNodes.some((item) => item.garmentId === garmentId && item.nodeName === nodeName)) {
        hiddenGarmentNodes.push({ garmentId, nodeName });
      }
    }
  }
  const visible = wornIds.filter((id) => !hiddenGarments.includes(id));
  let bakedFile: string | null = null;
  for (const look of looks.values()) {
    if (sameSet(look.garments, wornIds) || sameSet(look.garments, visible)) {
      bakedFile = look.file;
      break;
    }
  }
  return { worn: wornIds, visible, hiddenGarments, hiddenBodyNodes, hiddenGarmentNodes, bakedFile };
}

function parseLoadout(
  raw: string,
  garments: Map<string, GarmentDef>,
  races: Map<string, RaceDef>,
  outfits: Map<string, OutfitDef>,
): Loadout | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (record.v !== 1 || typeof record.race !== 'string') return null;
  if (races.size > 0 && !races.has(record.race)) return null;
  const outfit = typeof record.outfit === 'string' && outfits.has(record.outfit) ? record.outfit : null;
  const slots: Record<string, string | null> = {};
  if (record.slots && typeof record.slots === 'object') {
    for (const [slotId, garmentId] of Object.entries(record.slots as Record<string, unknown>)) {
      if (garmentId === null) {
        slots[slotId] = null;
        continue;
      }
      if (typeof garmentId === 'string' && garments.has(garmentId)) slots[slotId] = garmentId;
    }
  }
  const colors: Record<string, string> = {};
  if (record.colors && typeof record.colors === 'object') {
    for (const [id, color] of Object.entries(record.colors as Record<string, unknown>)) {
      if (typeof color === 'string' && HEX.test(color) && garments.has(id)) colors[id] = color.toLowerCase();
    }
  }
  return { v: 1, race: record.race, outfit, slots, colors };
}

export function isLayerBand(value: string): value is LayerBand {
  return (LAYER_BANDS as readonly string[]).includes(value);
}
