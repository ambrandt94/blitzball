/** Playback rate for the fixed-step sim. 1 is real time. */
export const TIME_SCALE_MIN = 0.05;
export const TIME_SCALE_MAX = 2;
export const TIME_SCALE_DEFAULT = 1;

export function clampTimeScale(value: number): number {
  if (!Number.isFinite(value)) return TIME_SCALE_DEFAULT;
  return Math.min(TIME_SCALE_MAX, Math.max(TIME_SCALE_MIN, value));
}

/**
 * How many fixed physics steps this rendered frame should run.
 * The step size stays `fixedDt` at every scale, so swept collisions and the
 * integrated result do not change. Scale only changes how fast sim time accumulates.
 * While paused, wall time is ignored. `stepOnce` runs exactly one step.
 */
export function takeFixedSteps(
  accum: number,
  frameDt: number,
  scale: number,
  fixedDt: number,
  maxSteps: number,
  paused: boolean,
  stepOnce: boolean,
): { accum: number; steps: number } {
  if (paused) {
    return { accum, steps: stepOnce ? 1 : 0 };
  }
  const rate = clampTimeScale(scale);
  let time = accum + Math.max(0, frameDt) * rate;
  let steps = 0;
  const cap = Math.max(1, maxSteps);
  while (time >= fixedDt && steps < cap) {
    time -= fixedDt;
    steps++;
  }
  return { accum: time, steps };
}
