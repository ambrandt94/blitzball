import type * as THREE from 'three';

export type TeamId = 0 | 1;

/** How a held throw turns into shot power. `meter` is the default. */
export type PowerMode = 'meter' | 'tap' | 'hold' | 'target' | 'pull';

export type PlayerRole = 'human' | 'ai' | 'stub';

/** `chaser` is the slow test opponent. `normal` uses teammate or defense AI. */
export type BotBehavior = 'normal' | 'chaser';

/** Active bots on each side, in slot order. Home does not include the human. */
export interface RosterSpec {
  home: BotBehavior[];
  away: BotBehavior[];
}

export type PossessionState = 'free' | 'held';

/** Short pose. `hold` lasts while carrying; the others are timed. */
export type ActionPose = 'none' | 'claim' | 'hold' | 'pass' | 'shoot' | 'burst';

export interface Tunables {
  goalAxisUp: boolean;
  /** True: V and LB zoom while held. False: those inputs toggle. Middle mouse always toggles. */
  zoomHoldMode: boolean;
  /** When true, flip yaw so mouse-right looks left (non-standard). */
  mouseLookInvertX: boolean;
  /** When true, flip pitch so mouse-up looks down (flight-sim style). */
  mouseLookInvertY: boolean;
  wallEscapeSpeed: number;
  wallEscapeAngle: number;
  claimRadius: number;
  /** Forward length of the catch mitt. */
  catchReach: number;
  /** Multiplier on catch reach while the off-ball catch stance is held. */
  catchStanceReach: number;
  /** Multiplier on catch width while the off-ball catch stance is held. */
  catchStanceWidth: number;
  /** Pull toward the hands for a ball just outside the stance mitt. */
  catchPull: number;
  holdLag: number;
  playerAccel: number;
  /** Cruise top speed. Sprint and the carrier tax scale this. */
  playerMaxSpeed: number;
  /** Sprint multiplier on cruise speed. */
  sprintMult: number;
  /** Loose pass speed at a full charge. */
  passSpeed: number;
  shootSpeedMin: number;
  shootSpeedMax: number;
  /** Peak speed of the off-ball shoulder check. */
  burstSpeed: number;
  /** Seconds the check can still hit someone. */
  burstDuration: number;
  /** Seconds before another check. */
  burstCooldown: number;
  ballDrag: number;
  aimAssist: number;
  showChargeGhost: boolean;
  showDebugStats: boolean;
  /** Body slerp toward velocity, radians-worth of rate (1/seconds). */
  bodyTurnRate: number;
  /** Speed under which facing falls back to aim / camera. */
  bodyIdleSpeed: number;
  /** Paddle cycles per second at full speed. */
  swimAnimRate: number;
  /** Arm/leg swing in radians at full speed. */
  swimAnimAmount: number;
  swimAnim: boolean;
  /** Speed multiplier while right-click strafe/aim is held. */
  strafeSpeedMult: number;
  /** Look-ray distance from the hand to the marker when an aim starts. */
  arcAimDistance: number;
  /** World units per second WASD slides the aim marker. */
  arcAimSpeed: number;
  /** World units of Bezier-control bend per radian of mouse while aiming. */
  arcBendSpeed: number;
  /** Cap on mouse bend as a fraction of the hand→marker chord. */
  arcBendLimit: number;
  /** Resting lob height as a fraction of the hand→marker chord. */
  arcHeight: number;
  /**
   * Optional side bias toward the throwing hand, as a fraction of the chord.
   * The default is 0, so a click with no mouse movement throws straight.
   */
  arcHandCurve: number;
  /** How fast the shot power meter sweeps, in full-scales per second. Hold mode fills at this rate. */
  shotPowerRate: number;
  /**
   * `meter` oscillates, `tap` counts clicks after release, `hold` fills until you let go.
   * `target` sets power from the landing distance. `pull` sets it from a backward drag.
   */
  powerMode: PowerMode;
  /** Seconds after release that tap mode still accepts power clicks. */
  tapWindow: number;
  /** Taps that reach full power. Zero taps stays a soft touch. */
  tapMax: number;
  /** Extra loft at full power, as a fraction of the chord. Mouse bend stays the larger shape control. */
  shotPowerAngle: number;
  /** Extra radius on the look ray for snapping a shot onto a teammate. */
  teammateLockRadius: number;
  /**
   * World units past the aim marker a shot will still carry into a goal.
   * Zero keeps the ball on the marker.
   */
  shotCarry: number;
  /** When false, the opposing team holds its spots and does not chase or tackle. */
  defenseActive: boolean;
  /**
   * One slow enemy chases the ball and, once they have it, wanders.
   * They never pass or shoot. Other AI is parked.
   */
  soloOpponent: boolean;
  /** Shell radius. Changing it rebuilds the sphere, goals, and dressing. */
  arenaRadius: number;
  /** Seconds the teammate holds the ball before passing it back. */
  teammatePassDelay: number;
  /** World-unit shift of the over-the-shoulder camera while strafing. */
  shoulderOffset: number;
  /** Ease rate for that shift (1/seconds). Higher is snappier. */
  shoulderTransition: number;
  /** Stadium sunbeams. Off hides them; strength scales what is left at the shell. */
  showSunbeams: boolean;
  /** 0 hides the shafts. 1 is the tuned rim brightness. */
  sunbeamIntensity: number;
}

/** Yellow landing dot. RMB places it on the straight throw; a shot hold slides it with power. */
export interface LandingMarkerState {
  visible: boolean;
  position: THREE.Vector3;
  /** Teammate the point is on, or null for a free aim along the look. */
  lockId: number | null;
  /** Hand → marker distance, world units. */
  distance: number;
  /** Min and max landing spots for the current aim. Shown while a throw is held. */
  showReach: boolean;
  minPosition: THREE.Vector3;
  maxPosition: THREE.Vector3;
  /** 1 after a power tap, decays. The view pulses the marker from this. */
  pulse: number;
  /** Target mode asked for a spot past full power. The marker draws dim and red. */
  outOfReach: boolean;
}

export interface PlayerState {
  id: number;
  team: TeamId;
  role: PlayerRole;
  /** `chaser` drifts after the ball and never passes or shoots. */
  aiBehavior: BotBehavior;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Forward facing (normalized). */
  facing: THREE.Vector3;
  /** World-up relative basis when goal-axis mode is off; otherwise goal-axis up. */
  up: THREE.Vector3;
  sprinting: boolean;
  hasBall: boolean;
  /** Hand that cradles a held ball. Defaults to the right. */
  throwArm: 'right' | 'left';
  tackleCooldown: number;
  reclaimGrace: number;
  /**
   * Set when this player releases a pass or shot. While set, they cannot
   * pick that ball back up. Cleared once it has left them, or after selfCatchMax.
   */
  selfCatchLock: boolean;
  /** Seconds since that release. */
  selfCatchTime: number;
  /** Seconds left in the shoulder-check hit window. */
  burstTime: number;
  /** Seconds before another check can start. */
  burstCooldown: number;
  /** 1 when a check just started, decays for the extra bubble puff. */
  burstPuff: number;
  /** World direction locked at the moment of the check. */
  burstDir: THREE.Vector3;
  /** Bitmask of player ids this check has already hit. */
  checkMask: number;
  /** Seconds of ragdoll left from a shoulder check. Steering is ignored. */
  knockTime: number;
  /** Seconds of reduced swim control after a check. */
  staggerTime: number;
  /** 1 on a fresh hit, decays. The view flashes the body from this. */
  hitFlash: number;
  /** Bubbles the view still owes this swimmer for a hit. */
  hitBurst: number;
  /** Right-click held with empty hands: arms reach to catch. */
  catchStance: boolean;
  /** Stub slots reserved for future 3v3 AI. */
  active: boolean;
  actionPose: ActionPose;
  /** Seconds left on a one-shot pose (claim / pass / shoot). */
  actionPoseTime: number;
  /** Full length of the current timed pose. The view plays a throw across it. */
  actionPoseDuration: number;
  /** Power captured when a pass or shot started. 0..1. */
  throwPosePower: number;
  /** Curve captured at release, about -1..1, so the follow-through can keep the wrist twist. */
  throwCurveRight: number;
  throwCurveUp: number;
}

export interface BallState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  possession: PossessionState;
  ownerId: number | null;
  lastOwnerId: number | null;
  claimLock: number;
  trail: THREE.Vector3[];
  /** Scripted underwater lob. Null when the ball is free or held. */
  arc: BallArc | null;
}

/** Quadratic Bezier flight. `elapsed / duration` is the curve parameter. */
export interface BallArc {
  p0: THREE.Vector3;
  p1: THREE.Vector3;
  p2: THREE.Vector3;
  elapsed: number;
  duration: number;
  /** Teammate the arc is delivering to, or null for a free shot. */
  receiverId: number | null;
  /** World units left to travel on `carryDir` after the curve reaches `p2`. */
  carryLeft: number;
  /** Unit direction of that follow-through. Null when `carryLeft` is 0. */
  carryDir: THREE.Vector3 | null;
  carrySpeed: number;
}

export interface MatchState {
  score: [number, number];
  statusMessage: string;
  resetTimer: number;
  paused: boolean;
}

export interface ChargeState {
  active: boolean;
  kind: 'shoot' | 'pass' | null;
  amount: number; // 0..1
}

export interface InputIntent {
  move: THREE.Vector3; // camera-relative desired thrust, magnitude 0..1
  lookDelta: { x: number; y: number };
  up: number; // -1..1 vertical
  sprint: boolean;
  /** Right mouse held: body stays on the camera aim and swim speed drops. */
  strafe: boolean;
  claim: boolean;
  drop: boolean;
  pass: boolean;
  shoot: boolean;
  shootHeld: boolean;
  /** Right-click press. Cancels a held throw, including the tap window. */
  aimCancel: boolean;
  /**
   * Off-ball primary click. Same edge as shoot; the sim shoulder-checks only
   * when this player is not holding the ball.
   */
  burst: boolean;
  passHeld: boolean;
  zoomOut: boolean;
  /** Keyboard or gamepad edge. Toggles only when zoom hold mode is off. */
  zoomTogglePressed: boolean;
  /** Middle mouse press. Always toggles the wide camera. */
  middleZoomPressed: boolean;
  /** Wheel notches, in world units. Positive lengthens the arc aim. */
  aimRangeDelta: number;
  /** Ask the teammate to pass now, or to cut harder if they don't have it. */
  callForPass: boolean;
  resetBall: boolean;
  toggleDev: boolean;
}
