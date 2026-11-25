import { outfitFromSaved } from '../characters/forge';
import { DEFAULT_OUTFIT, type OutfitId } from '../characters/outfits';

const STORAGE_KEY = 'blitzball.characters';

export interface CharacterSettings {
  human: OutfitId;
  team: [OutfitId, OutfitId];
}

export function defaultCharacterSettings(): CharacterSettings {
  return { human: DEFAULT_OUTFIT, team: ['trunks', 'boardshorts'] };
}

export function parseCharacterSettings(raw: string | null): CharacterSettings | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (typeof record.human !== 'string') return null;
  const human = outfitFromSaved(record.human);
  if (!human) return null;
  if (!Array.isArray(record.team) || record.team.length < 2) return null;
  const blue = record.team[0];
  const orange = record.team[1];
  if (typeof blue !== 'string' || typeof orange !== 'string') return null;
  const home = outfitFromSaved(blue);
  const away = outfitFromSaved(orange);
  if (!home || !away) return null;
  return { human, team: [home, away] };
}

export function loadCharacterSettings(): CharacterSettings {
  try {
    if (typeof localStorage === 'undefined') return defaultCharacterSettings();
    return parseCharacterSettings(localStorage.getItem(STORAGE_KEY)) ?? defaultCharacterSettings();
  } catch {
    return defaultCharacterSettings();
  }
}

export function saveCharacterSettings(settings: CharacterSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore quota and private-mode failures.
  }
}
