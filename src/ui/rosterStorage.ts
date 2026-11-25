import { ROSTER } from '../game/constants';
import type { BotBehavior, MatchPresetId, RosterSpec } from '../game/types';

export const ROSTER_KEY = 'blitzball.roster';

const HOME_BOT_MAX = ROSTER.maxSwimmers - 1;
const AWAY_BOT_MAX = ROSTER.maxSwimmers;
const PRESETS: MatchPresetId[] = ['1v1', '1v1-goalies', '3v3', '4v4', '5v5', 'custom'];

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
  const record = data as RosterSpec & { preset?: unknown };
  const home = parseSide(record.home, HOME_BOT_MAX);
  const away = parseSide(record.away, AWAY_BOT_MAX);
  if (!home || !away) return null;
  const preset = PRESETS.includes(record.preset as MatchPresetId) ? (record.preset as MatchPresetId) : 'custom';
  return {
    home,
    away,
    preset,
    withGoalies: record.withGoalies === true,
    goalieSkill: num(record.goalieSkill),
    goalieSkillHome: num(record.goalieSkillHome),
    goalieSkillAway: num(record.goalieSkillAway),
    goalieHomeOverride: record.goalieHomeOverride === true,
    goalieAwayOverride: record.goalieAwayOverride === true,
  };
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseSide(value: unknown, max: number): BotBehavior[] | null {
  if (!Array.isArray(value)) return null;
  const out: BotBehavior[] = [];
  for (const item of value) {
    if (item !== 'normal' && item !== 'chaser' && item !== 'goalie') return null;
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
    localStorage.setItem(ROSTER_KEY, JSON.stringify(spec));
  } catch {
    // Ignore quota and private-mode failures.
  }
}
