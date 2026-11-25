export { LAYER_BANDS } from './types';
export { createCharacterKit, isLayerBand, qualifyId } from './kit';
export type { CharacterKit, KitRegistry, LoadKitOptions } from './kit';
export {
  applyHidePlan,
  attachGarment,
  installTeamTint,
  loadCharacter,
  loadTintMask,
  nearestMaterials,
  nearestTexture,
  tintMaterialsFor,
} from './assemble';
export type { CharacterAsset, LoadCharacterOptions } from './assemble';
export type {
  GarmentDef,
  HidePlan,
  LayerBand,
  Loadout,
  LookDef,
  OutfitDef,
  RaceDef,
  SlotDef,
  WardrobeGarment,
  WardrobeManifest,
} from './types';
