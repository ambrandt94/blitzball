export const BLITZBALL_OUTFITS = [
  { id: 'onepiece', label: 'One-piece' },
  { id: 'trunks', label: 'Trunks' },
  { id: 'boardshorts', label: 'Board shorts' },
  { id: 'boardshorts_asym', label: 'Asymmetric board shorts' },
] as const;

export type OutfitId = (typeof BLITZBALL_OUTFITS)[number]['id'];

export const DEFAULT_OUTFIT: OutfitId = 'onepiece';

export function isOutfitId(value: string): value is OutfitId {
  return BLITZBALL_OUTFITS.some((outfit) => outfit.id === value);
}
