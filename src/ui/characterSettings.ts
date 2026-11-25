import { DEFAULT_OUTFIT, isOutfitId, type OutfitId } from '../characters/blitzball';

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
  if (typeof record.human !== 'string' || !isOutfitId(record.human)) return null;
  if (!Array.isArray(record.team) || record.team.length < 2) return null;
  const blue = record.team[0];
  const orange = record.team[1];
  if (typeof blue !== 'string' || typeof orange !== 'string') return null;
  if (!isOutfitId(blue) || !isOutfitId(orange)) return null;
  return { human: record.human, team: [blue, orange] };
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
