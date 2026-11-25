/**
 * Procedural throw poses for the swimmer rig. Targets are in the swimmer
 * group's space for a right-handed throw: -X is the throw side, +Z is forward,
 * +Y is up. A left-handed throw mirrors X and the chest yaw.
 *
 * `release` below 0 is the live windup. 0..1 plays the snap, the follow-through,
 * then eases the pose weight back to the swim or tread clip.
 */

export interface ThrowSample {
  handX: number;
  handY: number;
  handZ: number;
  offX: number;
  offY: number;
  offZ: number;
  poleX: number;
  poleY: number;
  poleZ: number;
  chestYaw: number;
  /** Positive pitches the chest forward. */
  lean: number;
  armWeight: number;
  offWeight: number;
  palmX: number;
  palmY: number;
  palmZ: number;
}

const HOLD = { x: -0.16, y: 0.2, z: 0.5 };
const LOW_WIND = { x: -0.22, y: 0.1, z: 0.36 };
const HIGH_WIND = { x: -0.06, y: 0.52, z: 0.2 };
const LOW_RELEASE = { x: -0.12, y: 0.18, z: 0.55 };
const HIGH_RELEASE = { x: -0.04, y: 0.36, z: 0.58 };
const LOW_FOLLOW = { x: -0.08, y: 0.14, z: 0.58 };
const HIGH_FOLLOW = { x: 0.22, y: 0.24, z: 0.5 };
const PASS_DIRECT = { x: -0.08, y: 0.22, z: 0.58 };

const LOW_OFF_W = { x: 0.18, y: 0.16, z: 0.28 };
const HIGH_OFF_W = { x: 0.26, y: 0.4, z: 0.42 };
const LOW_OFF_F = { x: 0.16, y: 0.14, z: 0.2 };
const HIGH_OFF_F = { x: 0.22, y: 0.28, z: 0.08 };

const LOW_POLE = { x: -0.5, y: -0.84, z: 0.18 };
const HIGH_POLE = { x: -0.18, y: 0.88, z: -0.78 };
const RELEASE_POLE = { x: -0.22, y: 0.42, z: 0.62 };
const FOLLOW_POLE = { x: 0.12, y: -0.12, z: 0.72 };

interface V3 {
  x: number;
  y: number;
  z: number;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function smooth(t: number): number {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerp3(a: V3, b: V3, t: number): V3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

function addCurve(hand: V3, curveRight: number, curveUp: number, amount: number): V3 {
  return {
    x: hand.x - curveRight * 0.08 * amount,
    y: hand.y + curveUp * 0.07 * amount,
    z: hand.z + curveRight * 0.03 * amount,
  };
}

/** Soft throws are short. A full shot uses the long end of the follow-through. */
export function throwPoseSeconds(power: number, pass = false): number {
  const p = clamp01(power);
  return pass ? 0.25 + 0.1 * p : 0.25 + 0.2 * p;
}

/**
 * `release` < 0 is the charging windup. Otherwise it is how far the release
 * and follow-through have played, 0 at the let-go and 1 back in the stroke.
 */
export function sampleThrowPose(
  power: number,
  release: number,
  pass: boolean,
  curveRight: number,
  curveUp: number,
  throwRight: boolean,
): ThrowSample {
  const shaped = smooth(clamp01(power));
  const shown = pass ? shaped * 0.42 : shaped;
  const cr = Math.max(-1, Math.min(1, curveRight));
  const cu = Math.max(-1, Math.min(1, curveUp));
  const curveAmount = 0.35 + 0.65 * shown;

  const wind = lerp3(LOW_WIND, HIGH_WIND, shown);
  const through = lerp3(LOW_RELEASE, HIGH_RELEASE, shown);
  const follow = lerp3(LOW_FOLLOW, HIGH_FOLLOW, shown);
  const windup = pass ? lerp3(wind, PASS_DIRECT, 0.62) : wind;
  const depth = pass ? 0.22 + 0.4 * shown : 0.3 + 0.7 * shown;
  const cocked = lerp3(HOLD, windup, depth);

  let hand = cocked;
  let off = lerp3(LOW_OFF_W, HIGH_OFF_W, shown);
  let pole = lerp3(LOW_POLE, HIGH_POLE, shown);
  let yaw = lerp(-0.06, -0.42, shown) * (pass ? 0.4 : 1);
  let lean = lerp(0.0, -0.14, shown) * (pass ? 0.35 : 1);
  let armWeight = 1;
  let offWeight = pass ? 0.16 : lerp(0.1, 1, shown);

  if (release >= 0) {
    const t = clamp01(release);
    const snapEnd = 0.4;
    const followEnd = 0.74;
    const offFollow = lerp3(LOW_OFF_F, HIGH_OFF_F, shown);
    if (t < snapEnd) {
      const u = smooth(t / snapEnd);
      hand = lerp3(cocked, through, u);
      off = lerp3(off, lerp3(LOW_OFF_F, HIGH_OFF_F, shown * 0.35), u);
      pole = lerp3(pole, RELEASE_POLE, u);
      yaw = lerp(yaw, lerp(0.02, 0.16, shown), u);
      lean = lerp(lean, lerp(0.02, 0.1, shown), u);
    } else if (t < followEnd) {
      const u = smooth((t - snapEnd) / (followEnd - snapEnd));
      hand = lerp3(through, follow, u);
      off = lerp3(lerp3(LOW_OFF_W, HIGH_OFF_W, shown), offFollow, u);
      pole = lerp3(RELEASE_POLE, FOLLOW_POLE, u);
      yaw = lerp(lerp(0.02, 0.16, shown), lerp(0.06, 0.34, shown), u);
      lean = lerp(lerp(0.02, 0.1, shown), lerp(0.04, 0.22, shown), u);
    } else {
      const u = smooth((t - followEnd) / (1 - followEnd));
      hand = follow;
      off = offFollow;
      pole = FOLLOW_POLE;
      yaw = lerp(0.06, 0.34, shown);
      lean = lerp(0.04, 0.22, shown);
      armWeight = 1 - u;
    }
  }

  hand = addCurve(hand, cr, cu, curveAmount);
  pole = {
    x: pole.x - cr * 0.22,
    y: pole.y + cu * 0.18,
    z: pole.z,
  };
  const palm = {
    x: -0.92 - cr * 0.5,
    y: 0.18 + cu * 0.62,
    z: 0.24 + cu * 0.12,
  };
  const palmLen = Math.hypot(palm.x, palm.y, palm.z) || 1;
  const sign = throwRight ? 1 : -1;

  return {
    handX: hand.x * sign,
    handY: hand.y,
    handZ: hand.z,
    offX: off.x * sign,
    offY: off.y,
    offZ: off.z,
    poleX: pole.x * sign,
    poleY: pole.y,
    poleZ: pole.z,
    chestYaw: yaw * sign,
    lean,
    armWeight,
    offWeight: offWeight * armWeight,
    palmX: (palm.x / palmLen) * sign,
    palmY: palm.y / palmLen,
    palmZ: palm.z / palmLen,
  };
}
