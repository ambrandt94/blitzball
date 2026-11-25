/**
 * Procedural wetsuit poses. The GLB swimmer layers the same catch / hold / throw
 * ideas on bones after the animation mixer; these numbers stay so the fallback
 * mesh and `rotationCheck` keep their contract.
 */
export interface LimbPose {
  yL: number;
  yR: number;
  zL: number;
  zR: number;
  xLegL: number;
  xLegR: number;
}

/** Arms stick out along local X. Positive yaw on the left arm (negative on the right) swings the hand forward. */
export function swimLimbPose(wave: number, amp: number): LimbPose {
  return {
    yL: 0.35 + wave * amp,
    yR: -0.35 - wave * amp,
    zL: 0.5,
    zR: -0.5,
    xLegL: -wave * amp * 0.9,
    xLegR: wave * amp * 0.9,
  };
}

/**
 * Ready to catch: both hands forward and up, spread in front of the chest.
 * Negative z on the left pivot (positive on the right) lifts that hand.
 */
export const CATCH_LIMBS: LimbPose = {
  yL: 1.48,
  yR: -1.48,
  zL: -0.72,
  zR: 0.72,
  xLegL: 0,
  xLegR: 0,
};

/** Cradle once the ball is in the hands. Lower and closer than the reach. */
export const HOLD_LIMBS: LimbPose = {
  yL: 1.05,
  yR: -1.05,
  zL: 0.55,
  zR: -0.55,
  xLegL: 0,
  xLegR: 0,
};

function lerpPose(a: LimbPose, b: LimbPose, t: number): LimbPose {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  const mix = (from: number, to: number) => from + (to - from) * u;
  return {
    yL: mix(a.yL, b.yL),
    yR: mix(a.yR, b.yR),
    zL: mix(a.zL, b.zL),
    zR: mix(a.zR, b.zR),
    xLegL: mix(a.xLegL, b.xLegL),
    xLegR: mix(a.xLegR, b.xLegR),
  };
}

/**
 * Swim is the base. Catch reach eases in over it, then the hold cradle eases over the reach
 * so a grab closes the hands instead of popping.
 */
export function blendLimbPose(swim: LimbPose, catchBlend: number, holdBlend: number): LimbPose {
  const hold = holdBlend < 0 ? 0 : holdBlend > 1 ? 1 : holdBlend;
  const reach = (catchBlend < 0 ? 0 : catchBlend > 1 ? 1 : catchBlend) * (1 - hold);
  const catching: LimbPose = {
    ...CATCH_LIMBS,
    xLegL: swim.xLegL * 0.45,
    xLegR: swim.xLegR * 0.45,
  };
  const holding: LimbPose = {
    ...HOLD_LIMBS,
    xLegL: swim.xLegL * 0.35,
    xLegR: swim.xLegR * 0.35,
  };
  return lerpPose(lerpPose(swim, catching, reach), holding, hold);
}
