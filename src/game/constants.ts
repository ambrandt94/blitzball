/** Tunable Phase 0 greybox constants — plan defaults where Input was unanswered. */

export const ARENA_RADIUS = 28;

export const FIXED_DT = 1 / 60;

export const PLAYER = {
  radius: 0.55,
  maxSpeed: 14,
  accel: 42,
  drag: 3.2,
  sprintMult: 1.35,
  carrierSpeedMult: 0.82,
  carrierTurnMult: 0.72,
  turnRate: 10,
  /** How fast the body slerps toward swim velocity (1/seconds). */
  bodyTurnRate: 7,
  /** Below this speed the body eases back to aim instead of velocity. */
  bodyIdleSpeed: 1.8,
  /** Paddle cycles per second at full sprint. */
  swimAnimRate: 1.7,
  /** Paddle / kick swing in radians at full speed. */
  swimAnimAmount: 0.7,
  /** Swim speed while holding aim/strafe, relative to normal. */
  strafeSpeedMult: 0.62,
  claimRadius: 1.65,
  claimFacingDot: 0.15,
  reclaimCoyote: 0.18,
  tackleCooldown: 0.55,
};

export const BALL = {
  radius: 0.42,
  drag: 1.1,
  restitution: 0.72,
  holdLag: 8.5,
  holdOffset: 0.85,
  passSpeed: 22,
  shootSpeedMin: 18,
  shootSpeedMax: 38,
  chargeTime: 0.85,
  claimCooldown: 0.12,
};

export const WALL = {
  /** Incidence angle (radians from normal) below this = "straight hit" escape chance. */
  escapeAngle: 0.45,
  escapeSpeed: 26,
  escapeRestitution: 0.15,
  bankRestitution: 0.78,
  slideFriction: 0.08,
};

export const GOAL = {
  /** Distance of goal center from origin along ±Z (goal axis). */
  distance: 24.5,
  rimRadius: 2.4,
  depth: 1.2,
};

export const CAMERA = {
  chaseDistance: 5.2,
  chaseHeight: 1.6,
  lookAhead: 4.0,
  /** Offset follow rate (1/seconds). High enough that look stays with the mouse. */
  lag: 14,
  zoomOutDistance: 18,
  zoomOutHeight: 4.5,
  fov: 62,
  zoomOutFov: 82,
  /**
   * Camera may sit this far inside the shell. Must be smaller than the player
   * radius so a swimmer pressed to the wall is still inside the camera volume
   * and the chase ray can stay behind them.
   */
  wallClearance: 0.35,
};

export const INPUT = {
  bufferMs: 100,
  mouseSensitivity: 0.0022,
  gamepadLookSens: 2.8,
  stickDeadzone: 0.14,
  aimAssistCone: 0.22,
  aimAssistStrength: 0.35,
};

export const MATCH = {
  teamSize: 3,
  resetDelay: 1.4,
  kickoffSeparation: 6,
};
