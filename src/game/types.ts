import type * as THREE from 'three';

export type TeamId = 0 | 1;

export type PlayerRole = 'human' | 'ai' | 'stub';

export type PossessionState = 'free' | 'held';

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
}

export interface BallState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  possession: PossessionState;
  ownerId: number | null;
  lastOwnerId: number | null;
  claimLock: number;
  trail: THREE.Vector3[];
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
  claim: boolean;
  drop: boolean;
  pass: boolean;
  shoot: boolean;
  shootHeld: boolean;
  passHeld: boolean;
  zoomOut: boolean;
  zoomTogglePressed: boolean;
  resetBall: boolean;
  toggleDev: boolean;
}
