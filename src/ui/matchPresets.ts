import type { BotBehavior, MatchPresetId, RosterSpec } from '../game/types';

/** How many field players a preset puts on each side, including you on home. */
export function fieldPlayers(preset: Exclude<MatchPresetId, 'custom'>): number {
  if (preset === '1v1' || preset === '1v1-goalies') return 1;
  if (preset === '3v3') return 3;
  if (preset === '4v4') return 4;
  return 5;
}

/** 3v3 and up can drop the goalie. The two 1v1 entries already say if one is included. */
export function presetAllowsGoalieToggle(preset: MatchPresetId): boolean {
  return preset === '3v3' || preset === '4v4' || preset === '5v5';
}

export function presetUsesGoalies(preset: Exclude<MatchPresetId, 'custom'>, withGoalies: boolean): boolean {
  if (preset === '1v1') return false;
  if (preset === '1v1-goalies') return true;
  return withGoalies;
}

/** Home omits you. A goalie, when included, is the last bot on each side. */
export function matchRoster(preset: Exclude<MatchPresetId, 'custom'>, withGoalies: boolean): RosterSpec {
  const field = fieldPlayers(preset);
  const goalie = presetUsesGoalies(preset, withGoalies);
  const home: BotBehavior[] = Array.from({ length: Math.max(0, field - 1) }, () => 'normal');
  const away: BotBehavior[] = Array.from({ length: field }, () => 'normal');
  if (goalie) {
    home.push('goalie');
    away.push('goalie');
  }
  return { home, away, preset, withGoalies: goalie };
}
