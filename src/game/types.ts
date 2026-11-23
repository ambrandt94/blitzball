import type * as THREE from 'three';

export type TeamId = 0 | 1;

export type PlayerRole = 'human' | 'ai' | 'stub';

export type PossessionState = 'free' | 'held';

/** Short greybox pose. `hold` lasts while carrying; the others are timed. */
export type ActionPose = 'none' | 'claim' | 'hold' | 'pass' | 'shoot';

export interface Tunables {
  goalAxisUp: boolean;
  zoomHoldMode: boolean; // true = hold V/LB; false = toggle
  /** When true, flip yaw so mouse-right looks left (non-standard). */
  mouseLookInvertX: boolean;
  /** When true, flip pitch so mouse-up looks down (flight-sim style). */
  mouseLookInvertY: boolean;
  wallEscapeSpeed: number;
  wallEscapeAngle: number;
  claimRadius: number;
  holdLag: number;
  playerAccel: number;
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
  /** Look-ray distance from the locked shot origin to the aim marker. */
  arcAimDistance: number;
  /** Lob height as a fraction of the origin→target chord. */
  arcHeight: number;
  /** How much a full charge flattens the lob (0 = no flatten, 1 = flat). */
  arcChargeFlatten: number;
  /** When false, the opposing team holds its spots and does not chase or tackle. */
  defenseActive: boolean;
  /** Seconds the teammate holds the ball before passing it back. */
  teammatePassDelay: number;
  /** World-unit shift of the over-the-shoulder camera while strafing. */
  shoulderOffset: number;
  /** Ease rate for that shift (1/seconds). Higher is snappier. */
  shoulderTransition: number;
  /** Fallback distance of the right-click aim cursor. */
  aimCursorDistance: number;
}

export type AimCursorKind = 'air' | 'wall' | 'player' | 'ball' | 'goal';

/** World-space marker for the right-click look ray. */
export interface AimCursorState {
  visible: boolean;
  kind: AimCursorKind;
  position: THREE.Vector3;
  /** Team tint for a player or the goal they score in. Null for air, wall, and ball. */
  team: TeamId | null;
}

export interface PlayerState {
  id: number;
  team: TeamId;
  role: PlayerRole;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Forward facing (normalized). */
  facing: THREE.Vector3;
  /** World-up relative basis when goal-axis mode is off; otherwise goal-axis up. */
  up: THREE.Vector3;
  sprinting: boolean;
  hasBall: boolean;
  tackleCooldown: number;
  reclaimGrace: number;
  /** Stub slots reserved for future 3v3 AI. */
  active: boolean;
  actionPose: ActionPose;
  /** Seconds left on a one-shot pose (claim / pass / shoot). */
  actionPoseTime: number;
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
  passHeld: boolean;
  zoomOut: boolean;
  zoomTogglePressed: boolean;
  /** Wheel notches, in world units. Positive lengthens the arc aim. */
  aimRangeDelta: number;
  /** Ask the teammate to pass now, or to cut harder if they don't have it. */
  callForPass: boolean;
  resetBall: boolean;
  toggleDev: boolean;
}
