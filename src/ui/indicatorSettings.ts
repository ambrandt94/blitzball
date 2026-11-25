const STORAGE_KEY = 'blitzball.indicators';

export interface IndicatorSettings {
  /** Yellow and white rings around swimmers. */
  rings: boolean;
  /** Pulsing bubble and ring around the ball. */
  ballBubble: boolean;
  /** The Y / team button sprite above the ball. */
  prompt: boolean;
  /** Nested triangles and crest inside the goal. The frame stays. */
  goalTarget: boolean;
  /** Catch beacon, catch-ready marks, and other floating debug marks. */
  beacons: boolean;
  /** Full-strength gizmos. Off keeps anything that is showing small and faint. */
  bold: boolean;
}

export function defaultIndicatorSettings(): IndicatorSettings {
  return {
    rings: false,
    ballBubble: false,
    prompt: false,
    goalTarget: true,
    beacons: false,
    bold: false,
  };
}

export function cleanIndicatorSettings(): IndicatorSettings {
  return defaultIndicatorSettings();
}

export function debugIndicatorSettings(): IndicatorSettings {
  return {
    rings: true,
    ballBubble: true,
    prompt: true,
    goalTarget: true,
    beacons: true,
    bold: true,
  };
}

export function parseIndicatorSettings(raw: string | null): IndicatorSettings | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const base = defaultIndicatorSettings();
  const next = { ...base };
  for (const key of Object.keys(base) as (keyof IndicatorSettings)[]) {
    if (typeof record[key] === 'boolean') next[key] = record[key];
  }
  return next;
}

export function loadIndicatorSettings(): IndicatorSettings {
  try {
    if (typeof localStorage === 'undefined') return defaultIndicatorSettings();
    return parseIndicatorSettings(localStorage.getItem(STORAGE_KEY)) ?? defaultIndicatorSettings();
  } catch {
    return defaultIndicatorSettings();
  }
}

export function saveIndicatorSettings(settings: IndicatorSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore quota and private-mode failures.
  }
}
