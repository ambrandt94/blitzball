import { createCharacterKit } from '../../packages/character-kit/src/index.ts';
import type { CharacterKit, WardrobeManifest } from '../../packages/character-kit/src/index.ts';

export const BLITZBALL_OUTFITS = [
  { id: 'onepiece', label: 'One-piece', slots: { torso_inner: 'onepiece' } },
  { id: 'trunks', label: 'Trunks', slots: { smallclothes: 'trunks' } },
  { id: 'boardshorts', label: 'Board shorts', slots: { smallclothes: 'trunks', legs: 'boardshorts' } },
  {
    id: 'boardshorts_asym',
    label: 'Asymmetric board shorts',
    slots: { smallclothes: 'trunks', legs: 'boardshorts_asym' },
  },
] as const;

export type OutfitId = (typeof BLITZBALL_OUTFITS)[number]['id'];

export const DEFAULT_OUTFIT: OutfitId = 'onepiece';

export function isOutfitId(value: string): value is OutfitId {
  return BLITZBALL_OUTFITS.some((outfit) => outfit.id === value);
}

/** Human swimmers only. Outfits are the four Character Forge swim looks. */
export function createBlitzballKit(manifest: WardrobeManifest): CharacterKit {
  const kit = createCharacterKit();
  kit.setBands(['under', 'base', 'mid', 'armor', 'outer']);
  kit.registerRace({ id: 'human', label: 'Human' });
  kit.registerWardrobe(manifest);
  for (const outfit of BLITZBALL_OUTFITS) {
    kit.registerOutfit({ id: outfit.id, label: outfit.label, race: 'human', slots: { ...outfit.slots } });
  }
  return kit;
}
