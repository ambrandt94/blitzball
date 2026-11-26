import { isOutfitId, type OutfitId } from '../characters/outfits';

export type PlayMode = 'match' | 'practice' | 'dummy';

export interface PlayerProfile {
  name: string;
  /** Skin tone index on the human ramp. */
  tone: number;
  hair: string;
  hairColor: string;
  outfit: OutfitId;
  teamColor: string;
  mode: PlayMode;
  /** Show the controls card before the next match. */
  showControls: boolean;
  /** They have finished the first-time path at least once. */
  returning: boolean;
}

export const SKIN_TONES = [
  { id: 0, label: 'Fair' },
  { id: 1, label: 'Light' },
  { id: 2, label: 'Tan' },
  { id: 3, label: 'Brown' },
  { id: 4, label: 'Deep' },
] as const;

export const HAIR_STYLES = [
  { id: 'buzz_cut', label: 'Buzz' },
  { id: 'short_crop', label: 'Crop' },
  { id: 'arc_bob', label: 'Bob' },
  { id: 'ponytail', label: 'Ponytail' },
  { id: 'long_straight', label: 'Long' },
] as const;

export const HAIR_COLORS = [
  { id: 'black', label: 'Black' },
  { id: 'brown', label: 'Brown' },
  { id: 'auburn', label: 'Auburn' },
  { id: 'blonde', label: 'Blonde' },
  { id: 'ginger', label: 'Ginger' },
] as const;

export const TEAM_COLORS = [
  { id: '#1c6fe0', label: 'Blue' },
  { id: '#1aa6a0', label: 'Teal' },
  { id: '#e2b43a', label: 'Gold' },
  { id: '#e06a4a', label: 'Coral' },
  { id: '#7a5ad6', label: 'Violet' },
  { id: '#f2f4f8', label: 'White' },
] as const;

export const PLAY_MODES: { id: PlayMode; label: string; detail: string }[] = [
  { id: 'match', label: '3v3 match', detail: 'You, two teammates, and a full side with goalies.' },
  { id: 'practice', label: 'Practice', detail: 'Free swim. Just you and the ball.' },
  { id: 'dummy', label: 'Vs dummy', detail: 'One opponent who chases the ball and does not play a match.' },
];

const STORAGE_KEY = 'blitzball.player';

export function defaultPlayerProfile(): PlayerProfile {
  return {
    name: 'Player',
    tone: 2,
    hair: 'arc_bob',
    hairColor: 'brown',
    outfit: 'onepiece',
    teamColor: '#1c6fe0',
    mode: 'match',
    showControls: true,
    returning: false,
  };
}

function outfitOf(value: unknown): OutfitId | null {
  return typeof value === 'string' && isOutfitId(value) ? value : null;
}

export function parsePlayerProfile(raw: string | null): PlayerProfile | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const base = defaultPlayerProfile();
  const outfit = outfitOf(record.outfit) ?? base.outfit;
  const mode = record.mode === 'match' || record.mode === 'practice' || record.mode === 'dummy' ? record.mode : base.mode;
  const tone = typeof record.tone === 'number' && record.tone >= 0 && record.tone <= 4 ? Math.round(record.tone) : base.tone;
  const hair = HAIR_STYLES.some((style) => style.id === record.hair) ? (record.hair as string) : base.hair;
  const hairColor = HAIR_COLORS.some((color) => color.id === record.hairColor) ? (record.hairColor as string) : base.hairColor;
  const teamColor = TEAM_COLORS.some((color) => color.id === record.teamColor) ? (record.teamColor as string) : base.teamColor;
  const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim().slice(0, 18) : base.name;
  return {
    name,
    tone,
    hair,
    hairColor,
    outfit,
    teamColor,
    mode,
    showControls: record.showControls !== false,
    returning: record.returning === true,
  };
}

export function loadPlayerProfile(store: Pick<Storage, 'getItem'> = localStorage): PlayerProfile {
  try {
    return parsePlayerProfile(store.getItem(STORAGE_KEY)) ?? defaultPlayerProfile();
  } catch {
    return defaultPlayerProfile();
  }
}

export function savePlayerProfile(profile: PlayerProfile, store: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore quota and private-mode failures.
  }
}

export function randomPlayerProfile(profile: PlayerProfile, seed = Math.random()): PlayerProfile {
  const pick = <T>(list: readonly T[], n: number): T => list[Math.floor(n * list.length) % list.length]!;
  const a = Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
  const b = Math.abs(Math.sin(seed * 78.233) * 24634.6345) % 1;
  const c = Math.abs(Math.sin(seed * 39.425) * 13928.992) % 1;
  const d = Math.abs(Math.sin(seed * 93.989) * 28461.1) % 1;
  const outfits = ['onepiece', 'trunks', 'boardshorts'] as const;
  return {
    ...profile,
    tone: pick(SKIN_TONES, a).id,
    hair: pick(HAIR_STYLES, b).id,
    hairColor: pick(HAIR_COLORS, c).id,
    outfit: pick(outfits, d),
    teamColor: pick(TEAM_COLORS, (a + c) % 1).id,
  };
}
