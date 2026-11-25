import type { PowerMode } from '../game/types';

/** Knobs the strategies read. The sim owns the current tunables. */
export interface PowerTuning {
  mode: PowerMode;
  /** Full-scale sweeps per second. Meter oscillates at this rate; hold fills at this rate. */
  rate: number;
  /** Seconds the tap window stays open after the aim button comes up. */
  tapWindow: number;
  /** Clicks inside that window that reach full power. */
  tapMax: number;
}

/**
 * Shot power, separate from aim and swim.
 * `release` / `tap` / `tick` return true when the throw should fire now.
 */
export interface PowerStrategy {
  readonly mode: PowerMode;
  begin(): void;
  /** Aim button is held. */
  hold(dt: number, tuning: PowerTuning): void;
  /** Aim button came up. False means the shot waits (tap window). */
  release(tuning: PowerTuning): boolean;
  /** Extra click while this strategy is capturing. True fires immediately. */
  tap(tuning: PowerTuning): boolean;
  /** Advance a post-release window. True fires because the window closed. */
  tick(dt: number, tuning: PowerTuning): boolean;
  /** 0..1 power the shot will use. */
  amount(): number;
  /**
   * Target and pull write power from the mouse. Meter, tap, and hold ignore it
   * so a stray write cannot fight their own clocks.
   */
  setAmount(value: number): void;
  /** Extra clicks belong here, not to a shoulder check or a new aim. */
  capturing(): boolean;
  taps(): number;
  maxTaps(tuning: PowerTuning): number;
  /** Seconds left in the tap window, otherwise 0. */
  windowLeft(): number;
  reset(): void;
}

/** Zero taps. A lob, not a dead ball. */
export const TAP_SOFT = 0.12;

/** World units of landing distance per unit of look delta in target mode. */
export const TARGET_DISTANCE_SPEED = 42;
/** Look-delta units of backward drag that fill pull mode. */
export const PULL_FULL_TRAVEL = 1.15;

export function createPowerStrategy(mode: PowerMode): PowerStrategy {
  if (mode === 'tap') return new TapPower();
  if (mode === 'hold') return new HoldPower();
  if (mode === 'target') return new TargetPower();
  if (mode === 'pull') return new PullPower();
  return new MeterPower();
}

/** Empty → full → empty while the button is held. Release keeps the value. */
class MeterPower implements PowerStrategy {
  readonly mode = 'meter' as const;
  /** 0..1 fills, 1..2 empties. */
  private phase = 0;
  private value = 0;

  begin(): void {
    this.phase = 0;
    this.value = 0;
  }

  hold(dt: number, tuning: PowerTuning): void {
    const rate = Math.max(0, tuning.rate);
    this.phase = (this.phase + dt * rate) % 2;
    this.value = this.phase <= 1 ? this.phase : 2 - this.phase;
  }

  release(): boolean {
    return true;
  }

  tap(): boolean {
    return false;
  }

  tick(): boolean {
    return false;
  }

  amount(): number {
    return this.value;
  }

  setAmount(): void {}

  capturing(): boolean {
    return false;
  }

  taps(): number {
    return 0;
  }

  maxTaps(): number {
    return 0;
  }

  windowLeft(): number {
    return 0;
  }

  reset(): void {
    this.begin();
  }
}

/** Charge rises while the button is held and stops at full. Release throws. */
class HoldPower implements PowerStrategy {
  readonly mode = 'hold' as const;
  private value = 0;

  begin(): void {
    this.value = 0;
  }

  hold(dt: number, tuning: PowerTuning): void {
    const rate = Math.max(0, tuning.rate);
    this.value = Math.min(1, this.value + dt * rate);
  }

  release(): boolean {
    return true;
  }

  tap(): boolean {
    return false;
  }

  tick(): boolean {
    return false;
  }

  amount(): number {
    return this.value;
  }

  setAmount(): void {}

  capturing(): boolean {
    return false;
  }

  taps(): number {
    return 0;
  }

  maxTaps(): number {
    return 0;
  }

  windowLeft(): number {
    return 0;
  }

  reset(): void {
    this.begin();
  }
}

/**
 * The hold only aims. Release opens a short window; each click adds power.
 * No clicks is a soft touch. Filling the taps throws immediately.
 */
class TapPower implements PowerStrategy {
  readonly mode = 'tap' as const;
  private count = 0;
  private value = TAP_SOFT;
  private left = 0;
  private open = false;

  begin(): void {
    this.count = 0;
    this.value = TAP_SOFT;
    this.left = 0;
    this.open = false;
  }

  hold(): void {
    // Aim and curve only. Power waits for the taps.
  }

  release(tuning: PowerTuning): boolean {
    this.open = true;
    this.count = 0;
    this.value = TAP_SOFT;
    this.left = Math.max(0.05, tuning.tapWindow);
    return false;
  }

  tap(tuning: PowerTuning): boolean {
    if (!this.open) return false;
    const max = this.maxTaps(tuning);
    this.count = Math.min(max, this.count + 1);
    const span = 1 - TAP_SOFT;
    this.value = this.count >= max ? 1 : TAP_SOFT + span * (this.count / max);
    if (this.count >= max) {
      this.open = false;
      this.left = 0;
      return true;
    }
    return false;
  }

  tick(dt: number): boolean {
    if (!this.open) return false;
    this.left -= dt;
    if (this.left > 0) return false;
    this.open = false;
    this.left = 0;
    return true;
  }

  amount(): number {
    return this.value;
  }

  setAmount(): void {}

  capturing(): boolean {
    return this.open;
  }

  taps(): number {
    return this.count;
  }

  maxTaps(tuning: PowerTuning): number {
    return Math.max(1, Math.round(tuning.tapMax));
  }

  windowLeft(): number {
    return this.open ? Math.max(0, this.left) : 0;
  }

  reset(): void {
    this.begin();
  }
}

/** Power is whatever throw reaches the chosen landing distance. Release throws there. */
class TargetPower implements PowerStrategy {
  readonly mode = 'target' as const;
  private value = 0;

  begin(): void {
    this.value = 0;
  }

  hold(): void {}

  release(): boolean {
    return true;
  }

  tap(): boolean {
    return false;
  }

  tick(): boolean {
    return false;
  }

  amount(): number {
    return this.value;
  }

  setAmount(value: number): void {
    this.value = Math.min(1, Math.max(0, value));
  }

  capturing(): boolean {
    return false;
  }

  taps(): number {
    return 0;
  }

  maxTaps(): number {
    return 0;
  }

  windowLeft(): number {
    return 0;
  }

  reset(): void {
    this.begin();
  }
}

/** Dragging back fills power. A short drag stays a soft toss. Release throws. */
class PullPower implements PowerStrategy {
  readonly mode = 'pull' as const;
  private value = 0;

  begin(): void {
    this.value = 0;
  }

  hold(): void {}

  release(): boolean {
    return true;
  }

  tap(): boolean {
    return false;
  }

  tick(): boolean {
    return false;
  }

  amount(): number {
    return this.value;
  }

  setAmount(value: number): void {
    this.value = Math.min(1, Math.max(0, value));
  }

  capturing(): boolean {
    return false;
  }

  taps(): number {
    return 0;
  }

  maxTaps(): number {
    return 0;
  }

  windowLeft(): number {
    return 0;
  }

  reset(): void {
    this.begin();
  }
}
