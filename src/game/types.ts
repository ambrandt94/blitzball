import type * as THREE from 'three';

export type TeamId = 0 | 1;

/** How a held throw turns into shot power. `meter` is the default. */
export type PowerMode = 'meter' | 'tap' | 'hold' | 'target' | 'pull';

export type WaterStyle = 'trailbound' | 'classic';
export type WaterPreset = 'Mockup' | 'Clearer' | 'Deeper';
export type WaterQuality = 'high' | 'low' | 'basic';
export type StadiumDetail = 'off' | 'low' | 'high';
export type CrowdDensity = 'off' | 'low' | 'high';

/** Chase look-ahead when ball cam is off. `aim` looks down the camera. */
export type LookAheadMode = 'aim' | 'move' | 'ball';

/** Saved camera framing. `custom` is any hand edit after a preset. */
export type CameraPresetId = 'close' | 'default' | 'broadcast' | 'ball' | 'cinematic' | 'custom';

export type PlayerRole = 'human' | 'ai' | 'stub';

/** `chaser` is the slow test opponent. `goalie` guards the crease. `normal` is a field bot. */
export type BotBehavior = 'normal' | 'chaser' | 'goalie';

/** Field-player counts. Goalies are extra. `custom` is a hand-edited roster. */
export type MatchPresetId = '1v1' | '1v1-goalies' | '3v3' | '4v4' | '5v5' | 'custom';

/** Active bots on each side, in slot order. Home does not include the human. */
export interface RosterSpec {
  home: BotBehavior[];
  away: BotBehavior[];
  preset?: MatchPresetId;
  /** Used by 3v3, 4v4, and 5v5. Ignored by the 1v1 presets. */
  withGoalies?: boolean;
  goalieSkill?: number;
  goalieSkillHome?: number;
  goalieSkillAway?: number;
  goalieHomeOverride?: boolean;
  goalieAwayOverride?: boolean;
}

export type PossessionState = 'free' | 'held';

/** Short pose. `hold` lasts while carrying; the others are timed. */
export type ActionPose = 'none' | 'claim' | 'hold' | 'pass' | 'shoot' | 'kick' | 'burst';

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
  /** How far catch-ready reaches, in world units. */
  catchReadyRadius: number;
  /** Half-angle of the catch-ready cone, in radians off the aim. */
  catchReadyCone: number;
  /** Ball speed where a catch-ready reception starts to fumble. */
  fumbleSpeed: number;
  /** Speed a deflect slap gives the ball along the aim. */
  deflectStrength: number;
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
  /** Peak speed of a full power tackle. */
  burstSpeed: number;
  /** Seconds a full power tackle can still hit someone. */
  burstDuration: number;
  /** Seconds before another check after a full power tackle. */
  burstCooldown: number;
  /** Peak speed of a quick-click shoulder check. */
  lightBurstSpeed: number;
  /** Seconds a tap can still hit someone. */
  lightBurstDuration: number;
  /** Seconds before another check after a tap. */
  lightBurstCooldown: number;
  /** Knockback of a tap, along the check. */
  lightKnock: number;
  /** Holds at or under this stay a tap. Longer holds become a power tackle. */
  tackleTapTime: number;
  /** Seconds of hold that fill the power tackle. */
  tackleChargeTime: number;
  /** Chance a power tackle knocks the ball loose, from a short charge to full. */
  tacklePopMin: number;
  tacklePopMax: number;
  /** Seconds of self-stagger after a full power tackle. */
  tackleSelfStagger: number;
  /** Knockback of a full power tackle, along the check. */
  checkKnock: number;
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
  /**
   * How far the landing slides opposite the mouse bend, as a fraction of that bend.
   * Zero keeps the end on the aim ray. Throws and kicks both use it.
   */
  curveAimOffset: number;
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
  /** 0–100. Team 0 (blue) field players: aim, timing, and lane judgment. */
  fieldSkillA: number;
  /** 0–100. Team 1 (orange) field players. */
  fieldSkillB: number;
  /** Draw each field player's intent and the line to its target. */
  showAiIntent: boolean;
  /** Shell radius. Changing it rebuilds the sphere, goals, and dressing. */
  arenaRadius: number;
  /** Seconds the teammate holds the ball before passing it back. */
  teammatePassDelay: number;
  /** World-unit shift of the over-the-shoulder camera while strafing. */
  shoulderOffset: number;
  /** Ease rate for that shift (1/seconds). Higher is snappier. */
  shoulderTransition: number;
  /** Seconds to settle into the upright aim tread, and back to the swim. */
  aimPostureBlend: number;
  /** Critically damped rate for clip weights and pose layers. Higher is snappier. */
  blendStiffness: number;
  /** Radians of body roll at full lateral speed. */
  bankAmount: number;
  /** Kick landing distance relative to a throw of the same power. */
  kickRange: number;
  /** Kick flight speed relative to a throw of the same power. */
  kickSpeed: number;
  /** How much of the throw's curve a kick keeps. */
  kickCurve: number;
  /** Extra seconds after release before the foot meets the ball. */
  kickWindup: number;
  /** Half-angle of the first-time volley, in radians off the aim. */
  volleyCone: number;
  /** Radians of aim error at full approach speed. */
  volleySpread: number;
  /** Scales throw speed. Kicks are measured against this. */
  throwSpeedScale: number;
  /** Chase camera distance behind the swimmer. */
  camDistance: number;
  /** Camera height above the chase line, in world units. */
  camHeight: number;
  /** Extra pitch of the camera boom, in radians. Positive lifts the camera. */
  camPitch: number;
  /** Chase field of view. Wide view adds the built-in zoom-out gap on top. */
  camFov: number;
  /** How quickly the chase camera catches its pose (1/seconds). Higher is stiffer. */
  camLag: number;
  /** Where the chase look-ahead points when ball cam is off. */
  lookAhead: LookAheadMode;
  /** After the mouse rests, ease the view back behind the body. */
  camRecenter: boolean;
  /** Seconds of still look before auto-recenter starts. */
  camRecenterDelay: number;
  /** Look at the ball instead of down the aim. */
  ballCam: boolean;
  /** Camera distance while V or middle-click wide view is on. */
  wideDistance: number;
  /** Keep the chase camera inside the shell. Off lets a long follow sit outside. */
  camShell: boolean;
  /** Named camera setup. `custom` means the sliders no longer match a preset. */
  cameraPreset: CameraPresetId;
  /** Stadium sunbeams. Off hides them; strength scales what is left at the shell. */
  showSunbeams: boolean;
  /** 0 hides the shafts. 1 is the tuned rim brightness. */
  sunbeamIntensity: number;
  /** Trailbound v2 shell, or the earlier smooth shader. */
  waterStyle: WaterStyle;
  /** v2 look. Clearer keeps swimmers upright through the lens. */
  waterPreset: WaterPreset;
  /** Off uses the shader's flat tint instead of a background render. */
  waterRefraction: boolean;
  /** High is a full refraction target. Low is half res. Basic skips the shader. */
  waterQuality: WaterQuality;
  /** 1 is native. 2 and 3 render smaller and upscale with hard pixels. */
  waterPixelScale: number;
  /** Caustic web frames per second. */
  causticFps: number;
  /** Caustic drift in tiles per second. */
  causticScroll: number;
  /** Diagonal light bands across the water view. */
  showLightBands: boolean;
  /** Mid water colour. `#2E8A84` is the Clearer body. */
  waterTint: string;
  /** Darkest water step. */
  waterDeep: string;
  /** Inside distance haze. */
  waterFog: string;
  /** Instanced colosseum. Off hides it. Low drops towers, banners, and halos. */
  stadiumDetail: StadiumDetail;
  /** Instanced spectator billboards. */
  crowdDensity: CrowdDensity;
  /** 0–100. Reaction, prediction, speed, and catch chance for both goalies. */
  goalieSkill: number;
  /** Used when the home override is on. */
  goalieSkillHome: number;
  /** Used when the away override is on. */
  goalieSkillAway: number;
  goalieHomeOverride: boolean;
  goalieAwayOverride: boolean;
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
  /** Hold-tackle. A harder knock than a tap. */
  burstStrong: boolean;
  /** Seconds before another check can start. */
  burstCooldown: number;
  /** 1 when a check just started, decays for the extra bubble puff. */
  burstPuff: number;
  /** World direction locked at the moment of the check. */
  burstDir: THREE.Vector3;
  /** Speed cap of the lunge that is playing. 0 uses the power-tackle speed. */
  burstSpeedCap: number;
  /** Knockback of the lunge that is playing. 0 uses the power-tackle knock. */
  burstKnock: number;
  /** Ball pop speed of the lunge that is playing. 0 uses the default pop. */
  burstPop: number;
  /** Chance this lunge knocks a held ball loose. */
  burstPopChance: number;
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
  /** Right-click held with empty hands: squared up, not yet reaching. */
  catchStance: boolean;
  /** Squared up and reaching. Passes in the cone stick; a click deflects. */
  catchReady: boolean;
  /** Seconds left on the deflect slap. The view pushes the hands out. */
  deflectTime: number;
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
  /** 0..1 while this player is winding up a pass, throw, or kick. */
  windup: number;
  windupKind: 'none' | 'shoot' | 'pass' | 'kick';
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
  kind: 'shoot' | 'pass' | 'kick' | null;
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
  /** F pressed, or gamepad B. A kick while squared up with the ball, otherwise a volley. */
  kick: boolean;
  kickHeld: boolean;
  /** Gamepad RB held long enough for a power tackle. */
  burstPower: boolean;
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
