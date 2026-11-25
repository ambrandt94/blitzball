import { ROSTER } from '../game/constants';
import type { BotBehavior, RosterSpec } from '../game/types';

export const ROSTER_KEY = 'blitzball.roster';

const HOME_BOT_MAX = ROSTER.maxSwimmers - 1;
const AWAY_BOT_MAX = ROSTER.maxSwimmers;

/** Parse a saved roster. Invalid JSON or behaviors are rejected. Extra slots are clipped to the cap. */
export function parseRoster(raw: string | null | undefined): RosterSpec | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const record = data as { home?: unknown; away?: unknown };
  const home = parseSide(record.home, HOME_BOT_MAX);
  const away = parseSide(record.away, AWAY_BOT_MAX);
  if (!home || !away) return null;
  return { home, away };
}

function parseSide(value: unknown, max: number): BotBehavior[] | null {
  if (!Array.isArray(value)) return null;
  const out: BotBehavior[] = [];
  for (const item of value) {
    if (item !== 'normal' && item !== 'chaser') return null;
    if (out.length < max) out.push(item);
  }
  return out;
}

export function loadRoster(): RosterSpec | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return parseRoster(localStorage.getItem(ROSTER_KEY));
  } catch {
    return null;
  }
}

export function saveRoster(spec: RosterSpec): void {
  try {
    localStorage.setItem(ROSTER_KEY, JSON.stringify({ home: spec.home, away: spec.away }));
  } catch {
    // Ignore quota and private-mode failures.
  }
}
