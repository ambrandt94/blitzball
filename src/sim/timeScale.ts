/** Playback rate for the fixed-step sim. 1 is real time. */
export const TIME_SCALE_MIN = 0.05;
export const TIME_SCALE_MAX = 2;
export const TIME_SCALE_DEFAULT = 1;
/** Real seconds to blend between 1x and the flight scale. */
export const FLIGHT_EASE_SECONDS = 0.1;
/** Below this, a free ball with no arc has settled. */
export const BALL_SETTLE_SPEED = 1.5;

export interface ScaleEase {
  value: number;
  from: number;
  to: number;
  left: number;
}

export function createScaleEase(value = TIME_SCALE_DEFAULT): ScaleEase {
  return { value, from: value, to: value, left: 0 };
}

export function clampTimeScale(value: number): number {
  if (!Number.isFinite(value)) return TIME_SCALE_DEFAULT;
  return Math.min(TIME_SCALE_MAX, Math.max(TIME_SCALE_MIN, value));
}

/** A held or settled ball is not in flight. An arc or a moving free ball is. */
export function ballInFlight(ball: {
  possession: string;
  arc: unknown;
  velocity: { length(): number };
}): boolean {
  if (ball.possession === 'held') return false;
  if (ball.arc) return true;
  return ball.velocity.length() > BALL_SETTLE_SPEED;
}

/**
 * Slider value, unless flight-only is on and the ball is held, resting, or still.
 * That case stays at 1x.
 */
export function playbackScale(setScale: number, flightOnly: boolean, inFlight: boolean): number {
  if (flightOnly && !inFlight) return TIME_SCALE_DEFAULT;
  return clampTimeScale(setScale);
}

/** Blend `state.value` toward `target` across `FLIGHT_EASE_SECONDS` of real time. */
export function stepScaleEase(state: ScaleEase, target: number, realDt: number): void {
  const goal = clampTimeScale(target);
  const dt = Math.max(0, realDt);
  if (Math.abs(goal - state.to) > 1e-4) {
    state.from = state.value;
    state.to = goal;
    state.left = FLIGHT_EASE_SECONDS;
  }
  if (state.left <= dt) {
    state.value = state.to;
    state.left = 0;
    return;
  }
  state.left -= dt;
  const done = 1 - state.left / FLIGHT_EASE_SECONDS;
  state.value = state.from + (state.to - state.from) * done;
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
