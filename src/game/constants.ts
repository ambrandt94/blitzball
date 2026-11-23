/** Tunable Phase 0 greybox constants — plan defaults where Input was unanswered. */

export const ARENA_RADIUS = 56;

export const FIXED_DT = 1 / 60;

export const PLAYER = {
  radius: 0.55,
  maxSpeed: 28,
  accel: 84,
  drag: 3.2,
  sprintMult: 1.35,
  carrierSpeedMult: 0.82,
  carrierTurnMult: 0.72,
  turnRate: 10,
  /** How fast the body slerps toward swim velocity (1/seconds). */
  bodyTurnRate: 7,
  /** Below this speed the body eases back to aim instead of velocity. */
  bodyIdleSpeed: 3.6,
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

/**
 * Underwater shots are not gravity arcs. The ball stays in the hand while
 * aiming and flies a quadratic Bezier from that hand to the marker.
 * `height` is the resting lob as a fraction of the chord, along camera up.
 * Mouse bend is added on top, in world units, capped at `bendLimit` × chord.
 * `chargeFlatten` scales the resting lob down as the charge fills.
 */
export const SHOT_ARC = {
  /** Look-ray distance to the marker when the aim starts. */
  aimDistance: 32,
  /** How fast A/D, W/S, and Space/C slide the marker, world units per second. */
  aimSpeed: 22,
  /** World units of control-point bend per radian of mouse. */
  bendSpeed: 42,
  /** Max mouse bend as a fraction of the origin→target chord. */
  bendLimit: 0.85,
  height: 0.34,
  chargeFlatten: 0.55,
  minDuration: 0.28,
  samples: 22,
  /** Marker cannot sit closer than this to the ball. */
  minRange: 4,
};

export const BALL = {
  radius: 0.42,
  drag: 1.1,
  restitution: 0.72,
  holdLag: 8.5,
  holdOffset: 0.85,
  passSpeed: 44,
  shootSpeedMin: 36,
  shootSpeedMax: 76,
  chargeTime: 0.85,
  claimCooldown: 0.12,
};

export const WALL = {
  /** Incidence angle (radians from normal) below this = "straight hit" escape chance. */
  escapeAngle: 0.45,
  escapeSpeed: 52,
  escapeRestitution: 0.15,
  bankRestitution: 0.78,
  slideFriction: 0.08,
};

export const GOAL = {
  /** Distance of goal center from origin along ±Z (goal axis). */
  distance: 49,
  rimRadius: 3.6,
  depth: 2,
};

export const CAMERA = {
  chaseDistance: 5.2,
  chaseHeight: 1.6,
  lookAhead: 6,
  /** Offset follow rate (1/seconds). High enough that look stays with the mouse. */
  lag: 14,
  zoomOutDistance: 34,
  zoomOutHeight: 8,
  fov: 62,
  zoomOutFov: 82,
  /**
   * Camera may sit this far inside the shell. Must be smaller than the player
   * radius so a swimmer pressed to the wall is still inside the camera volume
   * and the chase ray can stay behind them.
   */
  wallClearance: 0.35,
  /** Lateral shift while right-click aim is held. Positive is the aim's right shoulder. */
  shoulderOffset: 1.55,
  /** How fast the shoulder shift eases in and out, in 1/seconds. */
  shoulderTransition: 6.5,
  /**
   * Strafe cursor distance along the look ray when it does not hit a player,
   * the ball, a goal, or the shell first.
   */
  aimCursorDistance: 18,
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
  kickoffSeparation: 12,
};

/** Practice partner. Offsets are in world units from the human at kickoff. */
export const PRACTICE = {
  openSide: 14,
  openForward: 10,
  passDelay: 1.15,
};
