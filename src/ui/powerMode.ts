import type { PowerMode } from '../game/types';

export const POWER_MODE_KEY = 'blitzball.powerMode';
export const POWER_MODE_VERSION_KEY = 'blitzball.powerModeVersion';
/** Bumped once so a saved meter (the old default) becomes hold, then later choices stick. */
export const POWER_MODE_HOLD_VERSION = 'hold-1';

const MODES: readonly PowerMode[] = ['meter', 'tap', 'hold', 'target', 'pull'];

export interface PowerModeStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isMode(value: string | null): value is PowerMode {
  return MODES.includes(value as PowerMode);
}

/**
 * Hold is the default. The first time this runs, any older saved mode is
 * replaced with hold. After that, the saved choice is kept.
 */
export function resolvePowerMode(store: PowerModeStore): { mode: PowerMode; migrated: boolean } {
  const version = store.getItem(POWER_MODE_VERSION_KEY);
  if (version !== POWER_MODE_HOLD_VERSION) {
    store.setItem(POWER_MODE_VERSION_KEY, POWER_MODE_HOLD_VERSION);
    store.setItem(POWER_MODE_KEY, 'hold');
    return { mode: 'hold', migrated: true };
  }
  const saved = store.getItem(POWER_MODE_KEY);
  if (isMode(saved)) return { mode: saved, migrated: false };
  return { mode: 'hold', migrated: false };
}
