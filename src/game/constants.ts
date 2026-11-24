/** Tunable Phase 0 greybox constants — plan defaults where Input was unanswered. */

/** Playable sphere. About 20% larger than the first tuned arena (56). */
export let ARENA_RADIUS = 68;

/** Dressing, sunbeams, and kickoff spacing were laid out at this radius. */
export const ARENA_REFERENCE = 56;

/** Clamp and publish a new shell radius. Importers see the update on the next read. */
export function setArenaRadius(radius: number): number {
  ARENA_RADIUS = Math.min(100, Math.max(40, radius));
  return ARENA_RADIUS;
}

export const FIXED_DT = 1 / 60;

export const PLAYER = {
  radius: 0.55,
  /** Cruise top speed. Lower than the first greybox so paths across the sphere stay readable. */
  maxSpeed: 18,
  /** High on purpose: time-to-speed stays short so the lower cap still feels snappy. */
  accel: 110,
  drag: 3.5,
  sprintMult: 1.38,
  carrierSpeedMult: 0.82,
  carrierTurnMult: 0.72,
  turnRate: 12,
  /** How fast the body slerps toward swim velocity (1/seconds). */
  bodyTurnRate: 9,
  /** Below this speed the body eases back to aim instead of velocity. */
  bodyIdleSpeed: 3.6,
  /** Paddle cycles per second at full sprint. */
  swimAnimRate: 1.7,
  /** Paddle / kick swing in radians at full speed. */
  swimAnimAmount: 0.7,
  /** Swim speed while holding aim/strafe, relative to normal. */
  strafeSpeedMult: 0.62,
  /**
   * Off-ball shoulder check. A strong thrust in the swim direction (or facing,
   * if you are not steering) with a short hit window, then a longer cooldown.
   */
  burstSpeed: 40,
  burstDuration: 0.26,
  burstCooldown: 0.9,
  /** Speed a checked swimmer is thrown, along the check. */
  checkKnock: 21,
  /** Seconds of reduced control after the knock ends. */
  checkStagger: 0.55,
  /** Seconds the knock ignores steering before the stagger takes over. */
  checkKnockTime: 0.28,
  /** Speed the ball leaves a checked carrier. */
  checkPop: 15,
  /** Restitution of the idle body-to-body bounce. */
  checkBounce: 0.34,
  /**
   * Width of the catch mitt. The old auto-claim used 0.55 × 1.65 = 0.91, which
   * is inside the 0.97 body+ball contact, so touching the ball bounced it away.
   */
  claimRadius: 1.35,
  /**
   * How far in front of the chest the mitt extends, along look (camera for the human).
   * Straight-ahead grab reach is about this plus `claimRadius`.
   */
  claimReach: 2.65,
  /** Extra mitt length while right-click catch stance is held. */
  catchStanceReach: 1.55,
  /** Extra mitt width while right-click catch stance is held. */
  catchStanceWidth: 1.42,
  /** Acceleration toward the hands when the ball is just outside the stance mitt. */
  catchPull: 22,
  /** Brief reach bonus after pressing claim, so a slightly early E still connects. */
  claimPressReach: 1.18,
  claimPressWidth: 1.15,
  claimBuffer: 0.16,
  claimFacingDot: 0.2,
  reclaimCoyote: 0.18,
  /**
   * After a pass or shot, the thrower cannot reclaim until this long has
   * passed and the ball is outside the mitt. The global claim lock (0.12s)
   * ends while a pass is still inside the forward mitt, and the departure
   * sweep would grab it on the way out.
   */
  selfCatchGrace: 0.24,
  /** Hard cap so a ball that never clears the mitt does not stay uncatchable. */
  selfCatchMax: 1.35,
  /** Added to mitt length + width. The ball has left once it is past this. */
  selfCatchClearance: 1.15,
  tackleCooldown: 0.55,
  /** Strip range. Kept off the catch radius so a bigger mitt does not lengthen tackles. */
  tackleRange: 1.85,
};

/**
 * Underwater shots are not gravity arcs. The ball stays in the hand while
 * aiming and flies a quadratic Bezier from that hand to the marker.
 * `height` is a small resting lob as a fraction of the chord, along camera up.
 * `handCurve` bends that lob toward the throwing (screen-right) hand from the
 * first frame of the hold. Mouse bend is added on top, in world units, capped
 * at `bendLimit` × chord. `powerRate` oscillates the shot meter; `powerAngle`
 * is the extra loft at the top of that meter.
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
  height: 0.06,
  /** Fraction of the chord, toward camera-right / the right hand. */
  handCurve: 0.12,
  /** Empty-to-full sweeps per second. A full up-and-down cycle is two sweeps. */
  powerRate: 1.15,
  /** Extra loft, fraction of the chord, at power 1. */
  powerAngle: 0.08,
  /** Added to the player radius when the look ray acquires a teammate. */
  teammateLockRadius: 1.15,
  minDuration: 0.28,
  samples: 22,
  /** Marker cannot sit closer than this to the ball. */
  minRange: 4,
  /**
   * How far past the aim marker a shot still carries into a goal it is aimed
   * or bent toward. The curve itself is unchanged until that extension.
   */
  carry: 34,
};

export const BALL = {
  radius: 0.42,
  drag: 1.1,
  restitution: 0.72,
  holdLag: 8.5,
  holdOffset: 0.85,
  /** A little under the first greybox so passes and shots are easier to read and meet. */
  passSpeed: 36,
  shootSpeedMin: 30,
  shootSpeedMax: 62,
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
  /** Circumradius of the triangular frame. The three corners sit on the shell. */
  rimRadius: 12.2,
  /** How far each bowed side pulls in, as a fraction of the straight midpoint. */
  bow: 0.16,
  /** Tube radius of the ornate frame. */
  rimTube: 0.5,
  /**
   * Scoring triangle as a fraction of `rimRadius`. Inscribed inside the bows
   * and the corner pieces, so the posts are solid and the opening is the hole.
   */
  scoreScale: 0.72,
  /** Shallow tunnel from the mouth plane out toward the shell. */
  pocketDepth: 3.5,
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
  /** Chase distance while reaching for a catch. Farther back so both arms and the ball read. */
  catchDistance: 7.9,
  catchHeight: 2.15,
  /** Look-at distance while reaching. Short, so the hands and the space in front of them sit in frame. */
  catchLookAhead: 3.6,
  /** Ease rate for the catch framing, in 1/seconds. */
  catchTransition: 7,
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
