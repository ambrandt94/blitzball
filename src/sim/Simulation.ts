import * as THREE from 'three';
import {
  ARENA_RADIUS,
  ARENA_REFERENCE,
  BALL,
  CAMERA,
  MATCH,
  PLAYER,
  ROSTER,
  SHOT_ARC,
  setArenaRadius,
} from '../game/constants';
import type {
  ActionPose,
  BallState,
  BotBehavior,
  ChargeState,
  InputIntent,
  LandingMarkerState,
  MatchState,
  PlayerState,
  RosterSpec,
  Tunables,
} from '../game/types';
import { createPowerStrategy, type PowerStrategy, type PowerTuning } from './shotPower';
import { DummyAI } from '../ai/DummyAI';
import type { AiDelivery, AiMark } from '../ai/FieldAI';
import { GoalieAI, goalieSkill01, goalieSwimSpeed } from '../ai/GoalieAI';
import { TeammateAI } from '../ai/TeammateAI';
import {
  authoritativeUp,
  chaseCameraPosition,
  clampMagnitude,
  damp,
  goalCenter,
  lookBasis,
  rotateBy,
  rotateToward,
  pullInsideSphere,
  stabilizeUp,
  transportUp,
} from './math';
import { fumbleChance, inCatchCone, inCatchVolume, segmentHitsCatch, segmentHitsCone } from './catch';
import {
  containInNet,
  inGoalPocket,
  goalPlaneZ,
  pointInsidePocket,
  rayHitsMouth,
  resolveGoalRim,
  segmentScores,
} from './goal';
import { FOCUS_FULL_SWIPE, bigFocusRadius } from './focusCircle';
import { clampAimMarker, quadraticPoint, quadraticVelocity, shapedControl } from './shotArc';
import { KICK_SWEET, KICK_SWING_TIME, kickFootPoint, kickFootSpeed, kickQuality } from './kick';
import { throwPoseSeconds } from '../render/throwPose';
import { PULL_FULL_TRAVEL, TARGET_DISTANCE_SPEED } from './shotPower';
import { constrainPlayerToSphere, resolveSphereWall } from './wallPhysics';

/** Fresh catches ease into the palm instead of popping onto the hand bone. */
const CARRY_BLEND_SECONDS = 0.08;

function makePlayer(
  id: number,
  team: 0 | 1,
  role: PlayerState['role'],
  pos: THREE.Vector3,
  active: boolean,
): PlayerState {
  const facing = team === 0 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 0, -1);
  return {
    id,
    team,
    role,
    aiBehavior: 'normal',
    position: pos,
    velocity: new THREE.Vector3(),
    facing,
    up: new THREE.Vector3(0, 1, 0),
    turnOmega: 0,
    sprinting: false,
    hasBall: false,
    throwArm: 'right',
    tackleCooldown: 0,
    reclaimGrace: 0,
    selfCatchLock: false,
    selfCatchTime: 0,
    burstTime: 0,
    burstStrong: false,
    burstCooldown: 0,
    burstPuff: 0,
    burstDir: new THREE.Vector3(0, 0, 1),
    burstSpeedCap: 0,
    burstKnock: 0,
    burstPop: 0,
    burstPopChance: 1,
    checkMask: 0,
    knockTime: 0,
    staggerTime: 0,
    hitFlash: 0,
    hitBurst: 0,
    catchStance: false,
    catchReady: false,
    deflectTime: 0,
    active,
    actionPose: 'none',
    actionPoseTime: 0,
    actionPoseDuration: 0,
    throwPosePower: 0,
    throwCurveRight: 0,
    throwCurveUp: 0,
    windup: 0,
    windupKind: 'none',
  };
}

export class Simulation {
  players: PlayerState[] = [];
  ball: BallState;
  match: MatchState;
  charge: ChargeState = { active: false, kind: null, amount: 0 };
  /** What each field player is trying to do, for the debug overlay. */
  aiIntents: AiMark[] = [];
  /** Ball has left the hand and is waiting on the foot. */
  private aiKick: { active: boolean; time: number; playerId: number; spec: AiDelivery | null } = {
    active: false,
    time: 0,
    playerId: -1,
    spec: null,
  };
  private kickSwing = {
    active: false,
    time: 0,
    power: 0,
    playerId: -1,
    aim: new THREE.Vector3(),
    bendRight: 0,
    bendUp: 0,
  };
  /** Leg swing that strikes a free ball. Separate from the aimed drop-kick. */
  private strike = {
    active: false,
    u: 0,
    power: 0,
    playerId: -1,
    squared: false,
    aim: new THREE.Vector3(),
    struck: false,
    bestDist: Infinity,
    bestU: 0,
  };
  private kickCharging = false;
  private kickCharge = 0;
  private kickSquared = false;
  private kickRecover = 0;
  /** The look sample that opened the hold is the curve origin, not a bend. */
  private holdLookPending = false;
  /** What the view uses to cock and swing the kicking leg. */
  readonly kickVisual = { playerId: -1, power: 0, swinging: false };
  /** Ghost trail samples while charging (beginner aid) or aiming an arc. */
  chargeGhost: THREE.Vector3[] = [];
  /**
   * Live aim while a throw is held. The locked value is the aim direction.
   * The marker is rebuilt every step from the hand, that direction, and power,
   * so it drifts with the swimmer and slides as power changes.
   * Mouse look is stored as a control-point bend instead of yaw.
   */
  readonly shotAim = {
    active: false,
    target: new THREE.Vector3(),
    /** Control-point offset along camera right, world units. Starts at 0 on each press. */
    bendRight: 0,
    /** Control-point offset along camera up, world units. Starts at 0 on each press. */
    bendUp: 0,
    /** Teammate the marker is stuck to, or null for a free aim. */
    lockId: null as number | null,
  };
  /** Aim direction captured when the throw button went down. World space, unit length. */
  private lockedAim = new THREE.Vector3(0, 0, 1);
  /** Active power mode for the throw that is held right now. */
  private power: PowerStrategy = createPowerStrategy('meter');
  /** HUD snapshot. Taps and the window are only live in tap mode. */
  readonly throwReadout = {
    taps: 0,
    tapMax: 0,
    window: 0,
    /** Increments on each power tap so the view can flash and click. */
    feedback: 0,
  };
  /** Marker was steered after the hold began, so do not snap back onto a teammate. */
  private shotAimManual = false;
  /** Added to Arc aim distance by the mouse wheel. */
  private aimDistanceBias = 0;
  /** Smoothed lateral camera shift. Positive sits on the aim's right shoulder. */
  shoulderLateral = 0;
  /**
   * Where a loose ball will settle, or the end of its arc (including a goal carry).
   * Hidden while anyone is holding the ball.
   */
  readonly catchBeacon = {
    visible: false,
    position: new THREE.Vector3(),
  };
  /** 0..1. Off-ball right-click eases the camera back so the reach is readable. */
  catchFrame = 0;
  /** Human is holding strafe without the ball. */
  catchStance = false;
  /**
   * Landing dot for a carried ball. Right-click puts it on the straight throw
   * and leaves the curve hidden. A shot hold keeps that dot on the locked arc.
   */
  readonly landingMarker: LandingMarkerState = {
    visible: false,
    position: new THREE.Vector3(),
    straightPosition: new THREE.Vector3(),
    focusRadius: 0,
    lockId: null,
    distance: 0,
    showReach: false,
    minPosition: new THREE.Vector3(),
    maxPosition: new THREE.Vector3(),
    pulse: 0,
    outOfReach: false,
  };
  /** Where the landing dot is drawn. Target mode can place this past full power. */
  private markerShown = new THREE.Vector3();
  /** Chosen landing distance in target mode. May sit past full reach. */
  private targetReach = 0;
  /** Accumulated backward drag in pull mode, in look-delta units. */
  private pullTravel = 0;
  /**
   * Set when a throw is cancelled while the button is still down, so letting
   * go does not fire and the held button does not start a new aim.
   */
  private shotBlocked = false;
  /** Slingshot band from the hand back along the aim. Only pull mode draws it. */
  readonly pullBand = {
    visible: false,
    from: new THREE.Vector3(),
    to: new THREE.Vector3(),
  };
  /** Right-click aim is held. The view reads this; movement already slowed in the step. */
  strafing = false;
  /** Seconds of extra reach left after a claim press. */
  private claimLatch = 0;
  /** Ball position at the start of this step's integration, for sweep catches and goal crossings. */
  private ballFrom = new THREE.Vector3();
  /** Ball position after integration, before the wall pulls it back. */
  private ballPreWall = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  zoomOutLatched = false;
  humanId = 0;
  /** Seconds remaining before play is live (kickoff / after goal). */
  kickoffLock = 0;
  /** 0..1 impact shake. The view reads it; the sim decays it. */
  cameraShake = 0;
  /** Off-ball tackle charge. Hidden unless the button is held. */
  readonly tackleCharge = { active: false, amount: 0 };
  private tackleArmed = false;
  private tackleHold = 0;
  /** Seconds the ball is outside the shell before the throw-in. */
  breachTime = 0;
  readonly breachPoint = new THREE.Vector3();
  readonly breachNormal = new THREE.Vector3(1, 0, 0);
  /** 0..1, how close the loose ball is to the glass. */
  nearShell = 0;
  /** Contact on the shell for the ripple and the splash ring. */
  readonly shellPoint = new THREE.Vector3();
  /** 1 on a fresh wall or rim hit, decays. */
  impactPulse = 0;
  /** Bubbles the view still owes for a splash, breach, or goal. */
  splashBurst = 0;
  /** Seconds of the goal celebration still to play. The ball stays in the net. */
  goalCelebrate = 0;
  goalTeam: 0 | 1 | null = null;
  /** Tracks the test-opponent toggle so the roster is parked once per change. */
  private soloApplied = false;
  /** Set once the roster UI edits bots. The solo toggle no longer overwrites them. */
  private manualRoster = false;
  private ai: DummyAI;
  private teammate: TeammateAI;
  private goalie: GoalieAI;
  private tmp = {
    moveWorld: new THREE.Vector3(),
    camFwd: new THREE.Vector3(),
    camRight: new THREE.Vector3(),
    camUp: new THREE.Vector3(),
    holdTarget: new THREE.Vector3(),
    aim: new THREE.Vector3(),
    faceTarget: new THREE.Vector3(),
    upHint: new THREE.Vector3(),
    prevFacing: new THREE.Vector3(),
    side: new THREE.Vector3(),
    predictPos: new THREE.Vector3(),
    predictVel: new THREE.Vector3(),
    burstLaunch: new THREE.Vector3(),
  };
  /**
   * Palm center in the carrier's body basis (right, up, facing), written by the
   * view after the mixer and pose offsets. Missing means the procedural offset.
   */
  private carryPalm = new Map<number, THREE.Vector3>();
  /** 0 at the catch, 1 once the ball has settled into the palm. */
  private carryBlend = 1;
  private carryFrom = new THREE.Vector3();
  private palmRight = new THREE.Vector3();
  private palmUp = new THREE.Vector3();
  private palmForward = new THREE.Vector3();
  private palmDelta = new THREE.Vector3();

  tunables: Tunables;

  constructor(tunables: Tunables) {
    this.tunables = tunables;
    this.ball = this.createBall();
    this.match = {
      score: [0, 0],
      statusMessage: 'Swim, claim the ball, shoot the orange goal',
      resetTimer: 0,
      paused: false,
    };
    this.ai = new DummyAI();
    this.teammate = new TeammateAI();
    this.goalie = new GoalieAI();
    this.resetKickoff(true);
  }

  private createBall(): BallState {
    return {
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      possession: 'free',
      ownerId: null,
      lastOwnerId: null,
      claimLock: 0,
      trail: [],
      arc: null,
    };
  }

  resetKickoff(full = false): void {
    if (full) {
      this.players = [];
      const sep = MATCH.kickoffSeparation * (ARENA_RADIUS / ARENA_REFERENCE);
      const flank = sep * 0.85;
      // Team 0 (blue): human, one passing teammate, one stub. Attack +Z.
      this.players.push(makePlayer(0, 0, 'human', new THREE.Vector3(0, 0, -sep), true));
      this.players.push(makePlayer(1, 0, 'ai', new THREE.Vector3(-flank, 2, -sep - sep * 0.45), true));
      this.players.push(makePlayer(2, 0, 'stub', new THREE.Vector3(flank, -1.5, -sep - sep * 0.45), false));
      // Team 1 (orange): one defender who holds unless Defense chases is on, plus stubs.
      this.players.push(makePlayer(3, 1, 'ai', new THREE.Vector3(0, 0, sep), true));
      this.players.push(makePlayer(4, 1, 'stub', new THREE.Vector3(-flank, -1.5, sep + sep * 0.4), false));
      this.players.push(makePlayer(5, 1, 'stub', new THREE.Vector3(flank, 1.5, sep + sep * 0.4), false));
      this.humanId = 0;
      this.match.score = [0, 0];
    } else {
      for (const p of this.players) {
        if (!p.active) continue;
        this.placeOnSide(p);
        p.hasBall = false;
        p.tackleCooldown = 0;
        p.reclaimGrace = 0;
        p.selfCatchLock = false;
        p.selfCatchTime = 0;
        p.burstTime = 0;
        p.burstStrong = false;
        p.burstCooldown = 0;
        p.burstPuff = 0;
        p.burstSpeedCap = 0;
        p.burstKnock = 0;
        p.burstPop = 0;
        p.burstPopChance = 1;
        p.checkMask = 0;
        p.knockTime = 0;
        p.staggerTime = 0;
        p.hitFlash = 0;
        p.hitBurst = 0;
        p.catchStance = false;
        p.catchReady = false;
        p.deflectTime = 0;
        p.actionPose = 'none';
        p.actionPoseTime = 0;
        p.actionPoseDuration = 0;
        p.throwPosePower = 0;
        p.throwCurveRight = 0;
        p.throwCurveUp = 0;
        p.windup = 0;
        p.windupKind = 'none';
      }
    }

    this.ball.position.set(0, 0, 0);
    this.ball.velocity.set(0, 0, 0);
    this.ball.possession = 'free';
    this.ball.ownerId = null;
    this.ball.lastOwnerId = null;
    this.ball.claimLock = 0.55;
    this.ball.trail = [];
    this.ball.arc = null;
    this.charge = { active: false, kind: null, amount: 0 };
    this.chargeGhost = [];
    this.shotAim.active = false;
    this.shotAim.bendRight = 0;
    this.shotAim.bendUp = 0;
    this.shotAim.lockId = null;
    this.shotAimManual = false;
    this.power.reset();
    this.shotBlocked = false;
    this.pullTravel = 0;
    this.targetReach = 0;
    this.pullBand.visible = false;
    this.landingMarker.outOfReach = false;
    this.syncThrowReadout();
    this.match.resetTimer = 0;
    this.kickoffLock = 2.2;
    this.match.statusMessage = 'Face-off…';
    this.cameraShake = 0;
    this.tackleArmed = false;
    this.tackleHold = 0;
    this.tackleCharge.active = false;
    this.tackleCharge.amount = 0;
    this.breachTime = 0;
    this.nearShell = 0;
    this.impactPulse = 0;
    this.splashBurst = 0;
    this.goalCelebrate = 0;
    this.goalTeam = null;
    this.orientHumanCamera();
    this.soloApplied = !this.tunables.soloOpponent;
    this.syncSoloRoster();
  }

  /** Dev toggle. Parks every AI but one slow enemy, or restores the practice pair. */
  setSoloOpponent(on: boolean): void {
    this.manualRoster = false;
    this.tunables.soloOpponent = on;
    this.soloApplied = !on;
    this.syncSoloRoster();
  }

  maxSwimmers(): number {
    return ROSTER.maxSwimmers;
  }

  /** Active swimmers on a side, including the human. */
  swimmerCount(team: 0 | 1): number {
    return this.players.filter((p) => p.team === team && p.active && p.role !== 'stub').length;
  }

  /** Bots currently on the field. The default drill reports the away bot as a test chaser. */
  exportRoster(): RosterSpec {
    const side = (team: 0 | 1): BotBehavior[] =>
      this.players
        .filter((p) => p.active && p.role === 'ai' && p.team === team)
        .sort((a, b) => a.id - b.id)
        .map((p) => this.behaviorOf(p));
    return { home: side(0), away: side(1) };
  }

  listBots(): { id: number; team: 0 | 1; behavior: BotBehavior; name: string }[] {
    const out: { id: number; team: 0 | 1; behavior: BotBehavior; name: string }[] = [];
    for (const team of [0, 1] as const) {
      const bots = this.players
        .filter((p) => p.active && p.role === 'ai' && p.team === team)
        .sort((a, b) => a.id - b.id);
      bots.forEach((p, index) => {
        out.push({ id: p.id, team, behavior: this.behaviorOf(p), name: `Bot ${index + 1}` });
      });
    }
    return out;
  }

  /**
   * Spawn one bot on `team`. Reuses an inactive slot before growing the list.
   * Returns false at the six-swimmer cap.
   */
  addBot(team: 0 | 1, behavior: BotBehavior = 'normal'): boolean {
    if (behavior !== 'normal' && behavior !== 'chaser' && behavior !== 'goalie') return false;
    if (this.swimmerCount(team) >= ROSTER.maxSwimmers) return false;
    this.adoptManualRoster();
    const slot = this.players.find((p) => p.team === team && p.role !== 'human' && !p.active);
    if (slot) {
      this.wakeBot(slot, behavior);
      return true;
    }
    const id = this.players.length;
    const created = makePlayer(id, team, 'ai', new THREE.Vector3(), false);
    this.players.push(created);
    this.wakeBot(created, behavior);
    return true;
  }

  /**
   * Despawn one bot. A ball they are holding is left loose where it is.
   * The human cannot be removed.
   */
  removeBot(id: number): boolean {
    const player = this.players.find((p) => p.id === id);
    if (!player || player.role !== 'ai' || !player.active) return false;
    this.adoptManualRoster();
    this.benchBot(player);
    return true;
  }

  setBotBehavior(id: number, behavior: BotBehavior): void {
    if (behavior !== 'normal' && behavior !== 'chaser' && behavior !== 'goalie') return;
    const player = this.players.find((p) => p.id === id && p.role === 'ai' && p.active);
    if (!player) return;
    this.adoptManualRoster();
    player.aiBehavior = behavior;
  }

  /** Replace the on-field bots. Used when a saved roster loads. */
  applyRoster(spec: RosterSpec): void {
    this.manualRoster = true;
    for (const p of this.players) {
      if (p.role === 'human') continue;
      if (p.active || p.hasBall || this.ball.ownerId === p.id) this.benchBot(p);
    }
    for (const behavior of spec.home) {
      if (!this.addBot(0, behavior)) break;
    }
    for (const behavior of spec.away) {
      if (!this.addBot(1, behavior)) break;
    }
  }

  private behaviorOf(player: PlayerState): BotBehavior {
    if (player.aiBehavior === 'goalie') return 'goalie';
    if (
      !this.manualRoster &&
      this.tunables.soloOpponent &&
      player.team !== this.getHuman().team &&
      player.role === 'ai'
    ) {
      return 'chaser';
    }
    return player.aiBehavior === 'chaser' ? 'chaser' : 'normal';
  }

  /** Keep the current field, then stop the solo toggle from parking or waking bots. */
  private adoptManualRoster(): void {
    if (this.manualRoster) return;
    for (const p of this.players) {
      if (p.role !== 'ai' || !p.active) continue;
      p.aiBehavior = this.behaviorOf(p);
    }
    this.manualRoster = true;
  }

  private wakeBot(player: PlayerState, behavior: BotBehavior): void {
    player.role = 'ai';
    player.aiBehavior = behavior;
    player.active = true;
    player.hasBall = false;
    player.sprinting = false;
    player.tackleCooldown = 0;
    player.reclaimGrace = 0;
    player.selfCatchLock = false;
    player.selfCatchTime = 0;
    player.burstTime = 0;
    player.burstCooldown = 0;
    player.burstPuff = 0;
    player.checkMask = 0;
    player.knockTime = 0;
    player.staggerTime = 0;
    player.hitFlash = 0;
    player.hitBurst = 0;
    player.catchStance = false;
    player.actionPose = 'none';
    player.actionPoseTime = 0;
    player.actionPoseDuration = 0;
    player.throwPosePower = 0;
    player.throwCurveRight = 0;
    player.throwCurveUp = 0;
    this.placeOnSide(player);
  }

  private benchBot(player: PlayerState): void {
    if (this.ball.possession === 'held' && this.ball.ownerId === player.id) this.releaseBall();
    if (this.ball.arc?.receiverId === player.id) this.ball.arc.receiverId = null;
    if (this.shotAim.lockId === player.id) this.shotAim.lockId = null;
    this.carryPalm.delete(player.id);
    player.active = false;
    player.hasBall = false;
    player.sprinting = false;
    player.velocity.set(0, 0, 0);
    player.burstTime = 0;
    player.burstCooldown = 0;
    player.burstPuff = 0;
    player.checkMask = 0;
    player.knockTime = 0;
    player.staggerTime = 0;
    player.hitFlash = 0;
    player.hitBurst = 0;
    player.catchStance = false;
    player.actionPose = 'none';
    player.actionPoseTime = 0;
    player.actionPoseDuration = 0;
    player.throwPosePower = 0;
    player.throwCurveRight = 0;
    player.throwCurveUp = 0;
  }

  /** Line the side up on its half so a new bot does not pop out of another swimmer. */
  private placeOnSide(player: PlayerState): void {
    const sep = MATCH.kickoffSeparation * (ARENA_RADIUS / ARENA_REFERENCE);
    const zSign = player.team === 0 ? -1 : 1;
    if (player.role === 'human') {
      player.position.set(0, 0, zSign * sep);
    } else if (player.aiBehavior === 'goalie') {
      const ownZ = goalPlaneZ(player.team === 0 ? 1 : 0);
      const inward = ownZ > 0 ? -1 : 1;
      player.position.set(0, 0.25, ownZ + inward * 6);
    } else {
      const mates = this.players
        .filter((p) => p.team === player.team && p.active && p.role === 'ai')
        .sort((a, b) => a.id - b.id);
      const index = Math.max(0, mates.findIndex((p) => p.id === player.id));
      const col = index % 3;
      const row = Math.floor(index / 3);
      player.position.set(
        (col - 1) * sep * 0.42,
        (row === 0 ? 1 : -1) * (1.2 + row),
        zSign * (sep * 0.95 + row * sep * 0.22),
      );
    }
    player.velocity.set(0, 0, 0);
    player.facing.set(0, 0, player.team === 0 ? 1 : -1);
    player.up.copy(authoritativeUp(this.tunables.goalAxisUp));
    constrainPlayerToSphere(player.position, player.velocity, PLAYER.radius);
  }

  private syncSoloRoster(): void {
    if (this.manualRoster) return;
    const on = this.tunables.soloOpponent;
    if (on === this.soloApplied) return;
    this.soloApplied = on;
    if (on) this.parkForDrill();
    else this.restorePracticeAi();
  }

  private parkForDrill(): void {
    let kept = false;
    for (const p of this.players) {
      if (p.role !== 'ai') continue;
      if (!kept && p.team !== this.getHuman().team) {
        kept = true;
        p.active = true;
        continue;
      }
      if (p.hasBall && this.ball.ownerId === p.id) {
        p.hasBall = false;
        this.ball.possession = 'free';
        this.ball.ownerId = null;
        this.ball.claimLock = 0.25;
      }
      p.active = false;
      p.velocity.set(0, 0, 0);
    }
  }

  private restorePracticeAi(): void {
    for (const p of this.players) {
      if (p.role === 'ai') p.active = true;
    }
  }

  /**
   * Resize the shell. Goals are derived from the radius, so they stay on it.
   * Swimmers, the ball, and the current aim scale with the sphere.
   */
  resizeArena(radius: number): void {
    const prev = ARENA_RADIUS;
    const next = setArenaRadius(radius);
    this.tunables.arenaRadius = next;
    if (Math.abs(next - prev) < 1e-3 || prev < 1e-3) return;
    const ratio = next / prev;
    for (const p of this.players) {
      p.position.multiplyScalar(ratio);
      constrainPlayerToSphere(p.position, p.velocity, PLAYER.radius);
    }
    this.ball.position.multiplyScalar(ratio);
    const arc = this.ball.arc;
    if (arc) {
      arc.p0.multiplyScalar(ratio);
      arc.p1.multiplyScalar(ratio);
      arc.p2.multiplyScalar(ratio);
    }
    this.shotAim.target.multiplyScalar(ratio);
    for (const sample of this.ball.trail) sample.multiplyScalar(ratio);
  }

  /** Point chase cam toward the attack goal / ball so the sphere reads immediately. */
  private orientHumanCamera(): void {
    if (this.tunables.goalAxisUp) {
      // Z is up: look "north" toward +Z (attack goal / ball from southern spawn).
      this.yaw = 0;
      this.pitch = 0.72;
    } else {
      // World Y up: look along +Z toward attack goal.
      this.yaw = 0;
      this.pitch = -0.12;
    }
  }

  orientAfterUpToggle(): void {
    this.orientHumanCamera();
  }

  getHuman(): PlayerState {
    return this.players[this.humanId]!;
  }

  isZoomOut(intent: InputIntent): boolean {
    return this.zoomOutLatched || intent.zoomOut;
  }

  step(dt: number, intent: InputIntent): void {
    this.syncSoloRoster();
    if (this.match.resetTimer > 0) {
      this.match.resetTimer -= dt;
      if (this.match.resetTimer <= 0) this.resetKickoff(false);
    }

    if (this.kickoffLock > 0) {
      this.kickoffLock -= dt;
      if (this.kickoffLock <= 0) this.match.statusMessage = 'Play on';
      else this.match.statusMessage = `Face-off… ${this.kickoffLock.toFixed(1)}s`;
    }

    if (intent.resetBall) {
      this.releaseBall();
      this.ball.position.set(0, 0, 0);
      this.ball.velocity.set(0, 0, 0);
      this.breachTime = 0;
      this.goalCelebrate = 0;
      this.ball.claimLock = 0.35;
      this.kickoffLock = 0.8;
      this.match.statusMessage = 'Ball reset';
    }

    const human = this.getHuman();
    this.noteCatchStance(intent);
    if (intent.claim) this.claimLatch = PLAYER.claimBuffer;
    // A goal holds the swimmers in slow motion so the ball can settle in the net.
    const motion = this.goalCelebrate > 0 ? dt * 0.28 : dt;
    // Look is applied once per rendered frame via applyFrameLook. Mouse deltas
    // are not per physics tick — applying them here doubled look on long frames
    // and dropped it on frames that did not step.
    // Human may always move; ball actions gated during kickoff lock.
    this.movePlayer(human, intent, motion, true);

    const live = this.kickoffLock <= 0 && this.match.resetTimer <= 0;

    for (const p of this.players) {
      if (!p.active || p.role !== 'ai') continue;
      const onDefense = p.team !== human.team;
      if (p.aiBehavior === 'goalie') {
        if (!live) {
          p.velocity.multiplyScalar(0.9);
          continue;
        }
        const keeper = this.goalie.think(p, this.ball, this.tunables, motion);
        this.movePlayer(p, keeper, motion, false);
        this.faceGoalieToShot(p, motion);
        if (this.goalie.diving(p.id) && p.actionPose !== 'claim') this.playPose(p, 'burst', 0.32);
        this.resolveGoalie(p, keeper);
        continue;
      }
      const chaser = this.manualRoster ? p.aiBehavior === 'chaser' : onDefense && this.tunables.soloOpponent;
      if (chaser) {
        if (!live) {
          p.velocity.multiplyScalar(0.9);
          continue;
        }
        const drill = this.ai.thinkDrill(p, this.ball, this.tunables, dt);
        this.movePlayer(p, drill, motion, false);
        if (drill.claim) this.tryClaim(p);
        continue;
      }
      if (onDefense && !this.tunables.defenseActive) {
        p.velocity.set(0, 0, 0);
        continue;
      }
      if (!live) {
        p.velocity.multiplyScalar(0.9);
        continue;
      }
      if (onDefense) {
        const aiIntent = this.ai.think(p, this.ball, this.players, this.tunables, motion);
        this.movePlayer(p, aiIntent, motion, false);
        this.resolveAiActions(p, aiIntent);
      } else {
        const mateIntent = this.teammate.think(
          p,
          this.ball,
          this.players,
          this.tunables,
          human,
          intent.callForPass,
          motion,
        );
        this.movePlayer(p, mateIntent, motion, false);
        this.resolveTeammate(p, mateIntent);
      }
    }
    if (live) {
      this.aiIntents = [...this.ai.marks(), ...this.teammate.marks()];
    }

    if (live) this.updatePossession(human, intent, motion);
    this.tickKickSwing(motion);
    this.tickStrike(motion);
    this.tickAiKick(motion);
    this.updateBall(motion);
    if (live) {
      this.resolveCatches();
      this.resolveGoalieContacts();
      this.separateBallFromPlayers();
      this.checkGoals();
    }
    this.resolveBodies(dt);

    for (const p of this.players) {
      if (p.tackleCooldown > 0) p.tackleCooldown -= dt;
      if (p.reclaimGrace > 0) p.reclaimGrace -= dt;
      if (p.selfCatchLock) p.selfCatchTime += dt;
      if (p.knockTime > 0) p.knockTime = Math.max(0, p.knockTime - dt);
      if (p.staggerTime > 0) p.staggerTime = Math.max(0, p.staggerTime - dt);
      if (p.hitFlash > 0) p.hitFlash = Math.max(0, p.hitFlash - dt * 2.4);
      if (p.burstCooldown > 0) p.burstCooldown = Math.max(0, p.burstCooldown - dt);
      if (p.burstTime > 0) p.burstTime = Math.max(0, p.burstTime - dt);
      if (p.burstPuff > 0) p.burstPuff = Math.max(0, p.burstPuff - dt * 3.2);
      if (p.deflectTime > 0) p.deflectTime = Math.max(0, p.deflectTime - dt);
      if (p.actionPoseTime > 0) {
        p.actionPoseTime -= dt;
        if (p.actionPoseTime <= 0) {
          p.actionPoseTime = 0;
          p.actionPose = p.hasBall ? 'hold' : 'none';
        }
      } else if (p.hasBall && p.actionPose === 'none') {
        p.actionPose = 'hold';
      } else if (!p.hasBall && p.actionPose === 'hold') {
        p.actionPose = 'none';
      }
    }
    if (this.cameraShake > 0) this.cameraShake = Math.max(0, this.cameraShake - dt * 2.6);
    if (this.impactPulse > 0) this.impactPulse = Math.max(0, this.impactPulse - dt * 1.8);
    if (this.goalCelebrate > 0) this.goalCelebrate = Math.max(0, this.goalCelebrate - dt);
    if (this.ball.claimLock > 0) this.ball.claimLock -= dt;
    this.refreshSelfCatchLocks();
    if (!intent.claim && this.claimLatch > 0) this.claimLatch = Math.max(0, this.claimLatch - dt);

    if (this.ball.trail.length > 28) this.ball.trail.shift();
    this.ball.trail.push(this.ball.position.clone());
  }

  /**
   * Apply pointer and right-stick look once per rendered frame.
   *
   * Mouse-right is +movementX and must turn the view to screen-right.
   * Do not port Three.js PointerLockControls (`euler.y -= movementX`) here.
   * That line looks right only because a positive camera euler yaw turns left.
   * This sim never writes `camera.rotation`. Positive yaw rotates toward
   * `forward × up`, which is already screen-right: with the chase cam looking
   * along +Z, that vector is world -X, the swimmer's right and the right edge
   * of the picture (world +X sits on the left edge). `yaw += dx` aims the
   * camera, the body, and W-swim that way. `yaw -= dx` aimed all three left,
   * which is the inversion. Pitch stays `pitch -= dy` because +movementY is
   * mouse-down. Each invert toggle multiplies one axis, once.
   */
  /**
   * Start the shot hold before mouse look is consumed. The sample that opens
   * the hold is the curve's origin: it does not bend the arc or turn the camera.
   */
  armShotAim(intent: InputIntent): void {
    if (this.kickoffLock > 0 || this.match.resetTimer > 0) return;
    if (this.shotBlocked) return;
    if (intent.aimCancel) return;
    if (this.kickSwing.active) return;
    const human = this.getHuman();
    if (!human.hasBall) return;
    const kick = intent.strafe && intent.kickHeld;
    const shoot = intent.shootHeld && !kick;
    if (!kick && !shoot) return;
    if (!this.shotAim.active) {
      this.beginShotAim();
      this.holdLookPending = true;
    }
    this.charge.kind = kick ? 'kick' : 'shoot';
  }

  applyFrameLook(intent: InputIntent): void {
    const sx = this.tunables.mouseLookInvertX ? -1 : 1;
    const sy = this.tunables.mouseLookInvertY ? -1 : 1;
    // While a shot is held the view stays put so the marker doesn't swim,
    // and the same mouse deltas bend the Bezier control point instead.
    if (this.shotAim.active) {
      if (this.holdLookPending) {
        this.holdLookPending = false;
        if (this.charge.kind === 'shoot' || this.charge.kind === 'kick') {
          this.refreshShotTarget();
          this.updateChargeGhost(this.getHuman());
        }
        return;
      }
      const mode = this.tunables.powerMode;
      if (mode === 'target') {
        // Horizontal bends the arc. Vertical, and the wheel, slide the landing spot.
        this.shotAim.bendRight += intent.lookDelta.x * sx * this.tunables.arcBendSpeed;
        this.nudgeTargetReach(-intent.lookDelta.y * sy * TARGET_DISTANCE_SPEED);
      } else if (mode === 'pull') {
        // Sideways drift is the curve. Dragging down, toward the player, is the pull.
        this.shotAim.bendRight += intent.lookDelta.x * sx * this.tunables.arcBendSpeed;
        this.nudgePull(intent.lookDelta.y * sy);
      } else {
        this.shotAim.bendRight += intent.lookDelta.x * sx * this.tunables.arcBendSpeed;
        this.shotAim.bendUp += -intent.lookDelta.y * sy * this.tunables.arcBendSpeed;
      }
      this.clampStoredBend();
      if (this.charge.kind === 'shoot' || this.charge.kind === 'kick') {
        this.refreshShotTarget();
        this.updateChargeGhost(this.getHuman());
      }
      return;
    }
    this.yaw += intent.lookDelta.x * sx;
    this.pitch -= intent.lookDelta.y * sy;
    // Pitch is not clamped at the horizon. Stopping 8° short of vertical
    // made "swim straight up" stick, and the next look rolled the wrong way.
  }

  /** Mouse-wheel aim range. Call once per rendered frame, not per physics step. */
  nudgeAimDistance(delta: number): void {
    if (delta === 0) return;
    if (this.tunables.powerMode === 'target' && this.shotAim.active) {
      this.nudgeTargetReach(delta);
      return;
    }
    const before = this.aimDistanceBias;
    this.aimDistanceBias = THREE.MathUtils.clamp(this.aimDistanceBias + delta, -40, 48);
    const applied = this.aimDistanceBias - before;
    if (applied === 0 || !this.shotAim.active) return;
    this.breakShotLock();
    this.refreshShotTarget();
    if (this.charge.kind === 'shoot' || this.charge.kind === 'kick') this.updateChargeGhost(this.getHuman());
  }

  /**
   * Middle mouse always toggles the wide camera. V and the gamepad toggle
   * only when Dev is not in hold mode. Call once per press, not per step.
   */
  noteZoomToggle(intent: InputIntent): void {
    const keyToggles = !this.tunables.zoomHoldMode && intent.zoomTogglePressed;
    if (intent.middleZoomPressed || keyToggles) {
      this.zoomOutLatched = !this.zoomOutLatched;
    }
  }

  private cameraBasis(): { forward: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3; worldUp: THREE.Vector3 } {
    return lookBasis(this.yaw, this.pitch, this.tunables.goalAxisUp);
  }

  private movePlayer(
    player: PlayerState,
    intent: InputIntent,
    dt: number,
    isHuman: boolean,
  ): void {
    if (!player.active) return;

    if (player.knockTime > 0) {
      player.velocity.multiplyScalar(Math.exp(-1.15 * dt));
      clampMagnitude(player.velocity, PLAYER.checkKnock * 1.2);
      this.steerBody(player, player.facing, dt, false);
      player.position.addScaledVector(player.velocity, dt);
      constrainPlayerToSphere(player.position, player.velocity, PLAYER.radius);
      return;
    }

    const moveLocal = intent.move.clone();
    if (moveLocal.lengthSq() > 1) moveLocal.normalize();

    // Human: camera-relative stick. AI: intent.move is already a world-space wish (xyz).
    // Idle fallback: camera look for the human, the move wish for AI.
    const wish = this.tmp.moveWorld;
    const aimDir = this.tmp.faceTarget;
    if (isHuman) {
      const basis = this.cameraBasis();
      // Horizon frame: strafe and look-forward stay camera-relative, but
      // ascend/descend is always the stable world up. basis.up rolls past
      // vertical and would swim downward when the player asked to rise.
      wish
        .copy(basis.right)
        .multiplyScalar(moveLocal.x)
        .add(basis.forward.clone().multiplyScalar(moveLocal.z))
        .add(basis.worldUp.clone().multiplyScalar(intent.up));
      aimDir.copy(basis.forward);
    } else {
      wish.set(moveLocal.x, intent.up !== 0 ? intent.up : moveLocal.y, moveLocal.z);
      if (wish.lengthSq() > 1e-6) aimDir.copy(wish).normalize();
      else aimDir.copy(player.facing);
    }
    if (wish.lengthSq() > 1) wish.normalize();

    // The throw hold keeps the camera locked. WASD still swims, just slowly.
    // shotAim stays active through the release frame.
    const aimingShot =
      isHuman && player.hasBall && (intent.shootHeld || (this.shotAim.active && this.charge.kind !== 'kick'));
    const tackle = intent.burst || intent.burstPower;
    if (isHuman && player.catchReady && tackle && !player.hasBall && !aimingShot) {
      this.tryDeflect(player);
    } else if (isHuman) {
      this.updateTackle(player, intent, wish, dt, aimingShot);
    } else if (
      player.role === 'ai' &&
      tackle &&
      !player.hasBall &&
      !player.catchReady &&
      player.burstCooldown <= 0 &&
      this.kickoffLock <= 0 &&
      this.match.resetTimer <= 0
    ) {
      this.fireTackle(player, wish, intent.burstPower ? 'power' : 'light', intent.burstPower ? 1 : 0);
    }

    const bursting = player.burstTime > 0 && player.burstDir.lengthSq() > 1e-6;
    if (bursting) wish.copy(player.burstDir).normalize();

    // Strafe glues facing to the camera. A shot hold does too, so the ball
    // stays in front of the chest, but it does not take the strafe speed tax.
    // A lunge ignores that tax so the catch or tackle still closes.
    const aimLocked = isHuman && intent.strafe;
    player.catchStance = aimLocked && !player.hasBall && !bursting && !aimingShot;
    if (!player.catchStance || player.hasBall) player.catchReady = false;
    else if (intent.claim) {
      player.catchReady = !player.catchReady;
      this.match.statusMessage = player.catchReady ? 'Catch ready' : 'Squared up';
    }
    if (!isHuman) this.trackIncomingPass(player, dt);
    player.sprinting = intent.sprint && !player.hasBall && !bursting;
    let maxSpeed = Math.max(4, this.tunables.playerMaxSpeed);
    let accel = bursting ? this.tunables.playerAccel * 1.65 : this.tunables.playerAccel;
    if (player.hasBall) maxSpeed *= PLAYER.carrierSpeedMult;
    if (player.sprinting) maxSpeed *= Math.max(1, this.tunables.sprintMult);
    if (!isHuman && player.aiBehavior === 'goalie' && !bursting) {
      maxSpeed = goalieSwimSpeed(goalieSkill01(this.tunables, player.team));
    }
    if (aimingShot) maxSpeed *= PLAYER.throwSwimMult;
    else if (aimLocked && !bursting) maxSpeed *= this.tunables.strafeSpeedMult;
    if (bursting) maxSpeed = Math.max(4, player.burstSpeedCap > 0 ? player.burstSpeedCap : this.tunables.burstSpeed);
    if (player.staggerTime > 0 && !bursting) {
      maxSpeed *= 0.16;
      accel *= 0.22;
    }

    if (wish.lengthSq() > 1e-6) {
      const targetVel = wish.multiplyScalar(maxSpeed);
      player.velocity.lerp(targetVel, 1 - Math.exp(-accel * dt / maxSpeed));
    } else {
      // Water drag when coasting. A lunge sheds speed more slowly so the click reads.
      const drag = bursting ? PLAYER.drag * 0.35 : PLAYER.drag;
      player.velocity.multiplyScalar(Math.exp(-drag * dt));
    }

    this.steerBody(player, aimDir, dt, aimLocked || aimingShot);

    clampMagnitude(player.velocity, maxSpeed * (bursting ? 1.02 : 1.15));
    player.position.addScaledVector(player.velocity, dt);
    constrainPlayerToSphere(player.position, player.velocity, PLAYER.radius);
  }

  /**
   * Off-ball left click. A release inside the tap window is a light check.
   * Holding fills a power tackle and the mouse-up fires it. A one-frame
   * `burst` without the button held is the light check, so headless clicks
   * still lunge.
   */
  private updateTackle(
    player: PlayerState,
    intent: InputIntent,
    wish: THREE.Vector3,
    dt: number,
    aimingShot: boolean,
  ): void {
    const ready =
      !player.hasBall &&
      !aimingShot &&
      !this.shotAim.active &&
      !this.power.capturing() &&
      player.burstCooldown <= 0 &&
      this.kickoffLock <= 0 &&
      this.match.resetTimer <= 0;

    if (this.tackleArmed && (player.hasBall || aimingShot || this.shotAim.active)) {
      this.clearTackleCharge();
      return;
    }

    if (this.tackleArmed && !intent.tackleHeld) {
      const held = this.tackleHold;
      this.clearTackleCharge();
      const tap = Math.max(0.04, this.tunables.tackleTapTime);
      if (held <= tap) this.fireTackle(player, wish, 'light', 0);
      else {
        const span = Math.max(0.05, this.tunables.tackleChargeTime - tap);
        const intensity = THREE.MathUtils.clamp((held - tap) / span, 0, 1);
        this.fireTackle(player, wish, 'power', intensity);
      }
      return;
    }

    if (!this.tackleArmed && intent.burst && intent.tackleHeld && ready) {
      this.tackleArmed = true;
      this.tackleHold = 0;
    }

    if (this.tackleArmed && intent.tackleHeld) {
      this.tackleHold += dt;
      const full = Math.max(0.05, this.tunables.tackleChargeTime);
      this.tackleCharge.active = true;
      this.tackleCharge.amount = THREE.MathUtils.clamp(this.tackleHold / full, 0, 1);
      return;
    }

    if (!this.tackleArmed && intent.burst && !intent.tackleHeld && ready) {
      this.fireTackle(player, wish, 'light', 0);
    }
  }

  private clearTackleCharge(): void {
    this.tackleArmed = false;
    this.tackleHold = 0;
    this.tackleCharge.active = false;
    this.tackleCharge.amount = 0;
  }

  private fireTackle(player: PlayerState, wish: THREE.Vector3, kind: 'light' | 'power', intensity: number): void {
    const dir = player.burstDir;
    if (wish.lengthSq() > 1e-6) dir.copy(wish).normalize();
    else if (player.facing.lengthSq() > 1e-8) dir.copy(player.facing).normalize();
    else dir.set(0, 0, 1);

    const lightSpeed = Math.max(4, this.tunables.lightBurstSpeed);
    const powerSpeed = Math.max(lightSpeed, this.tunables.burstSpeed);
    const lightWindow = Math.max(0.05, this.tunables.lightBurstDuration);
    const powerWindow = Math.max(lightWindow, this.tunables.burstDuration);
    const lightCooldown = Math.max(0.05, this.tunables.lightBurstCooldown);
    const powerCooldown = Math.max(lightCooldown, this.tunables.burstCooldown);
    const lightKnock = Math.max(1, this.tunables.lightKnock);
    const powerKnock = Math.max(lightKnock, this.tunables.checkKnock);
    const lightPop = PLAYER.checkPop * 0.72;
    const t = THREE.MathUtils.clamp(intensity, 0, 1);
    const speed = kind === 'light' ? lightSpeed : THREE.MathUtils.lerp(lightSpeed, powerSpeed, Math.max(0.2, t));
    const window = kind === 'light' ? lightWindow : THREE.MathUtils.lerp(lightWindow, powerWindow, t);
    const cooldown = kind === 'light' ? lightCooldown : THREE.MathUtils.lerp(lightCooldown + 0.2, powerCooldown, t);

    player.checkMask = 0;
    player.burstSpeedCap = speed;
    player.burstKnock = kind === 'light' ? lightKnock : THREE.MathUtils.lerp(lightKnock, powerKnock, t);
    player.burstPop = kind === 'light' ? lightPop : THREE.MathUtils.lerp(lightPop, PLAYER.checkPop, t);
    const popMin = THREE.MathUtils.clamp(this.tunables.tacklePopMin, 0, 1);
    const popMax = THREE.MathUtils.clamp(Math.max(popMin, this.tunables.tacklePopMax), 0, 1);
    player.burstPopChance = kind === 'light' ? 1 : THREE.MathUtils.lerp(popMin, popMax, t);
    this.tmp.burstLaunch.copy(dir).multiplyScalar(speed);
    player.velocity.lerp(this.tmp.burstLaunch, 0.88);
    player.burstTime = window;
    player.burstCooldown = cooldown;
    player.burstPuff = kind === 'light' ? 0.55 : 0.7 + 0.3 * t;
    if (kind === 'power') {
      const recover = Math.max(0, this.tunables.tackleSelfStagger) * (0.35 + 0.65 * t);
      player.staggerTime = Math.max(player.staggerTime, recover);
    }
    this.playPose(player, 'burst', player.burstTime + 0.06);
  }

  /**
   * Face velocity while swimming, including pitch. Nearly still, ease back to aim.
   * `aimLocked` (right-click strafe) keeps the nose on the camera aim.
   */
  private steerBody(player: PlayerState, aim: THREE.Vector3, dt: number, aimLocked = false): void {
    const speed = player.velocity.length();
    const target = this.tmp.aim;
    target.copy(aim);
    if (target.lengthSq() < 1e-8 || !Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.z)) {
      target.copy(player.facing);
    }
    if (target.lengthSq() < 1e-8) target.set(0, 0, 1);
    else target.normalize();

    if (!aimLocked && speed > 1e-4) {
      const swim = this.tmp.upHint.copy(player.velocity).normalize();
      const follow = THREE.MathUtils.smoothstep(speed, this.tunables.bodyIdleSpeed * 0.35, this.tunables.bodyIdleSpeed);
      target.lerp(swim, follow);
      if (target.lengthSq() < 1e-8) target.copy(swim);
      else target.normalize();
    }

    let speedCap = Math.max(0.2, this.tunables.bodyTurnRate);
    if (player.hasBall) speedCap *= PLAYER.carrierTurnMult;
    const smooth = Math.max(0.04, this.tunables.turnSmooth);
    this.tmp.prevFacing.copy(player.facing);
    const dot = THREE.MathUtils.clamp(player.facing.dot(target), -1, 1);
    const theta = Math.acos(dot);
    const response = theta < 1e-4 ? 0 : Math.min(speedCap, theta / smooth);
    const follow = 1 - Math.exp(-dt / smooth);
    player.turnOmega += (response - player.turnOmega) * follow;
    if (player.turnOmega < 0) player.turnOmega = 0;
    const step = Math.min(theta, player.turnOmega * dt);
    player.turnOmega = dt > 0 ? step / dt : 0;
    rotateBy(player.facing, target, step);
    transportUp(player.up, this.tmp.prevFacing, player.facing);
    this.alignBodyUp(player, dt);
  }

  /** Pitch with facing. Twist eases back to the horizon, and holds still only at the pole. */
  private alignBodyUp(player: PlayerState, dt: number): void {
    stabilizeUp(player.up, player.facing, authoritativeUp(this.tunables.goalAxisUp), 6, dt);
  }

  private playPose(player: PlayerState, pose: ActionPose, seconds: number): void {
    const switching = player.actionPose !== pose;
    player.actionPose = pose;
    player.actionPoseTime = Math.max(player.actionPoseTime, seconds);
    if (switching || player.actionPoseDuration < player.actionPoseTime) {
      player.actionPoseDuration = player.actionPoseTime;
    }
  }

  /** Remember the power and the curve so the follow-through matches the throw that just left the hand. */
  private rememberThrow(player: PlayerState, power: number): void {
    player.throwPosePower = THREE.MathUtils.clamp(power, 0, 1);
    const aimed = player.id === this.humanId && this.shotAim.active;
    player.throwCurveRight = aimed ? THREE.MathUtils.clamp(this.shotAim.bendRight / 22, -1, 1) : 0;
    player.throwCurveUp = aimed ? THREE.MathUtils.clamp(this.shotAim.bendUp / 22, -1, 1) : 0;
  }

  private resolveTeammate(player: PlayerState, intent: InputIntent): void {
    if (intent.claim) this.tryClaim(player);
    const spec = this.teammate.takeDelivery(player.id);
    if (spec && player.hasBall) this.releaseAiDelivery(player, spec);
  }

  private resolveGoalie(player: PlayerState, intent: InputIntent): void {
    if (intent.pass && player.hasBall) this.goalieDistribute(player);
  }

  /** Hands stay toward an incoming shot so the short reach volume faces the ball. */
  private faceGoalieToShot(player: PlayerState, dt: number): void {
    if (player.hasBall || this.ball.possession === 'held') return;
    const to = this.tmp.faceTarget.copy(this.ball.position).sub(player.position);
    if (to.lengthSq() < 0.2) return;
    const intoGoal = -this.goalieInward(player.team).z;
    if (this.ball.velocity.z * intoGoal < 3 && !this.ball.arc) return;
    rotateToward(player.facing, to.normalize(), 5.5, dt);
  }

  /** Pass to a field teammate, or clear up the pool when nobody is there. */
  private goalieDistribute(player: PlayerState): void {
    let best: PlayerState | null = null;
    let bestDist = 46;
    for (const mate of this.players) {
      if (!mate.active || mate.team !== player.team || mate.id === player.id || mate.aiBehavior === 'goalie') continue;
      const dist = mate.position.distanceTo(player.position);
      if (dist < bestDist) {
        bestDist = dist;
        best = mate;
      }
    }
    const inward = this.goalieInward(player.team);
    const aim = best ? best.position.clone().sub(player.position) : inward.clone();
    if (aim.lengthSq() < 0.16) aim.copy(inward);
    else aim.normalize();
    this.releaseAtHand(player, aim);
    const speed = Math.max(12, this.tunables.passSpeed * (best ? 0.7 : 0.88));
    this.noteThrow(player);
    this.releaseBall(aim.multiplyScalar(speed));
    this.playPose(player, 'pass', 0.4);
    this.match.statusMessage = best ? 'Goalie pass' : 'Cleared';
  }

  /** Direction from this team's goal back toward center court. */
  private goalieInward(team: 0 | 1): THREE.Vector3 {
    const ownZ = goalPlaneZ(team === 0 ? 1 : 0);
    return new THREE.Vector3(0, 0, ownZ > 0 ? -1 : 1);
  }

  /**
   * A save is contact with a short reach volume swept along this step's motion.
   * Nothing pulls or teleports the ball. The edge of that reach, or a hard
   * shot, parries. A clean catch is a slower ball near the chest.
   */
  private resolveGoalieContacts(): void {
    if (this.ball.possession === 'held' || this.ball.claimLock > 0) return;
    const reach = Math.max(0.45, this.tunables.goalieReach);
    for (const player of this.players) {
      if (!player.active || player.aiBehavior !== 'goalie' || player.hasBall) continue;
      const closest = this.segmentClosest(player.position, this.ballFrom, this.ball.position);
      if (closest > reach) continue;
      const speed = this.ball.velocity.length();
      // The frame the ball arrives only touches the near side of the volume.
      // Stretch is how far the path misses the chest, not that first contact.
      const miss = this.pathMiss(player.position, this.ballFrom, this.ball.position);
      const stretch = THREE.MathUtils.clamp(miss / reach, 0, 1);
      if (this.goalieShouldParry(stretch, speed)) {
        this.parryFromGoalie(player, speed);
        return;
      }
      this.ball.arc = null;
      this.giveBall(player);
      this.match.statusMessage = 'Goalie save';
      return;
    }
  }

  /** Perpendicular distance from `point` to the line through this step. */
  private pathMiss(point: THREE.Vector3, from: THREE.Vector3, to: THREE.Vector3): number {
    const ab = this.tmp.predictVel.copy(to).sub(from);
    const len2 = ab.lengthSq();
    if (len2 < 1e-10) return point.distanceTo(to);
    const t = this.tmp.side.copy(point).sub(from).dot(ab) / len2;
    return this.tmp.predictPos.copy(from).addScaledVector(ab, t).distanceTo(point);
  }

  /** Distance from `point` to the closest spot on the segment. */
  private segmentClosest(point: THREE.Vector3, from: THREE.Vector3, to: THREE.Vector3): number {
    const ab = this.tmp.predictVel.copy(to).sub(from);
    const len2 = ab.lengthSq();
    const t = len2 > 1e-8 ? THREE.MathUtils.clamp(this.tmp.side.copy(point).sub(from).dot(ab) / len2, 0, 1) : 0;
    return this.tmp.predictPos.copy(from).addScaledVector(ab, t).distanceTo(point);
  }

  /**
   * Near the chest and not particularly fast, it sticks. A stretch or a
   * heater is a parry. Difficulty shifts that line toward parries.
   */
  private goalieShouldParry(stretch: number, speed: number): boolean {
    const difficulty = THREE.MathUtils.clamp(this.tunables.goalieCatchDifficulty, 0, 1);
    const soft = speed < 16 + (1 - difficulty) * 8;
    if (stretch < 0.72 && soft && difficulty < 0.9) return false;
    if (stretch > 0.84 || speed > 28 + (1 - difficulty) * 10) return true;
    const chance = THREE.MathUtils.clamp(stretch * 0.45 + speed / 48 + difficulty * 0.4, 0, 0.9);
    return Math.random() < chance;
  }

  /** Knock the ball back along the goalie's facing. The position stays where contact happened. */
  private parryFromGoalie(player: PlayerState, speed: number): void {
    const facing = player.facing.clone();
    if (facing.lengthSq() < 1e-6) facing.copy(this.goalieInward(player.team));
    else facing.normalize();
    const closing = -this.ball.velocity.dot(facing);
    if (closing > 0) this.ball.velocity.addScaledVector(facing, closing);
    const pop = Math.max(7, Math.min(16, speed * 0.28));
    this.ball.velocity.addScaledVector(facing, pop);
    this.ball.arc = null;
    this.ball.claimLock = 0.22;
    this.playPose(player, 'burst', 0.28);
    this.match.statusMessage = 'Parry';
  }

  private resolveAiActions(player: PlayerState, intent: InputIntent): void {
    if (intent.claim) this.tryClaim(player);
    const spec = this.ai.takeDelivery(player.id);
    if (spec && player.hasBall) this.releaseAiDelivery(player, spec);
  }

  private updatePossession(human: PlayerState, intent: InputIntent, dt: number): void {
    // Charge shoot / pass for human
    if (human.hasBall) {
      const kickCharge = this.charge.kind === 'kick' && this.throwInProgress() && !this.kickSwing.active;
      if (kickCharge && !intent.strafe) {
        this.cancelAimedThrow(human, intent.kickHeld);
      } else if (intent.aimCancel && this.throwInProgress()) {
        this.cancelAimedThrow(human, this.charge.kind === 'kick' ? intent.kickHeld : intent.shootHeld);
      } else if (this.shotBlocked) {
        if (!intent.shootHeld && !intent.kickHeld) this.shotBlocked = false;
      } else if (intent.drop) {
        this.clearShotAim();
        const toss = this.lookForward(human);
        this.releaseAtHand(human, toss);
        this.releaseBall(toss.multiplyScalar(4).add(human.velocity));
        human.reclaimGrace = PLAYER.reclaimCoyote;
        this.match.statusMessage = 'Ball dropped';
      } else if (
        !this.shotBlocked &&
        intent.strafe &&
        (intent.kickHeld || (this.charge.kind === 'kick' && this.power.capturing()))
      ) {
        if (!this.shotAim.active) this.beginShotAim();
        this.charge.kind = 'kick';
        this.sustainThrow(human, intent, dt);
      } else if (this.charge.active && this.charge.kind === 'kick') {
        this.finishThrowHold(human);
      } else if (intent.shootHeld || this.power.capturing()) {
        this.sustainThrow(human, intent, dt);
      } else if (this.charge.active && this.charge.kind === 'shoot') {
        this.finishThrowHold(human);
      } else if (intent.passHeld && !intent.shootHeld && !intent.strafe) {
        this.charge.active = true;
        this.charge.kind = 'pass';
        this.charge.amount = Math.min(1, this.charge.amount + dt / (BALL.chargeTime * 0.7));
        this.playPose(human, 'pass', 0.2);
        this.updateChargeGhost(human);
      } else if (this.charge.active && this.charge.kind === 'pass') {
        this.releasePass(human, Math.max(0.35, this.charge.amount));
        this.charge = { active: false, kind: null, amount: 0 };
        this.chargeGhost = [];
      } else if (intent.pass) {
        this.releasePass(human, 0.45);
      } else if (!intent.strafe) {
        this.updateLooseKick(human, intent, dt);
      }
    } else {
      if (!this.kickSwing.active && (this.shotAim.active || this.charge.active)) this.clearShotAim();
      this.updateLooseKick(human, intent, dt);
      // While squared up, E toggles catch-ready instead of grabbing.
      if (intent.claim && !(intent.strafe && !human.hasBall)) this.tryClaim(human);
    }

    // Tackle / strip when AI has ball
    if (
      this.ball.possession === 'held' &&
      this.ball.ownerId !== null &&
      this.ball.ownerId !== human.id &&
      human.tackleCooldown <= 0
    ) {
      const owner = this.players[this.ball.ownerId];
      if (owner) {
        const dist = human.position.distanceTo(owner.position);
        if (dist < PLAYER.tackleRange && intent.claim) {
          const toOwner = owner.position.clone().sub(human.position).normalize();
          if (this.lookForward(human).dot(toOwner) > PLAYER.claimFacingDot) {
            this.stripBall(human, owner);
            human.tackleCooldown = PLAYER.tackleCooldown;
          }
        }
      }
    }
  }

  private canTake(player: PlayerState): boolean {
    if (!player.active || player.role === 'stub' || player.hasBall) return false;
    if (this.ball.claimLock > 0) return false;
    if (player.reclaimGrace > 0 && this.ball.lastOwnerId === player.id) return false;
    // Passes and shots only. A drop still uses the short reclaim grace.
    if (player.selfCatchLock && this.ball.lastOwnerId === player.id) return false;
    return true;
  }

  /** Mitt size. A fresh claim press widens it. Catch-ready uses the cone instead. */
  private catchScales(player: PlayerState): { reach: number; radius: number } {
    let reach = Math.max(0.2, this.tunables.catchReach);
    let radius = Math.max(0.2, this.tunables.claimRadius);
    if (player.id === this.humanId && this.claimLatch > 0 && !player.catchReady) {
      reach *= PLAYER.claimPressReach;
      radius *= PLAYER.claimPressWidth;
    }
    return { reach, radius };
  }

  private pointInReach(player: PlayerState, point: THREE.Vector3): boolean {
    const { reach, radius } = this.catchScales(player);
    return inCatchVolume(player.position, this.lookForward(player), point, reach, radius);
  }

  private sweptReach(player: PlayerState): boolean {
    const forward = this.lookForward(player);
    if (player.catchReady) {
      const radius = Math.max(0.4, this.tunables.catchReadyRadius);
      const cone = Math.max(0.05, this.tunables.catchReadyCone);
      return (
        inCatchCone(player.position, forward, this.ball.position, radius, cone) ||
        segmentHitsCone(player.position, forward, this.ballFrom, this.ball.position, radius, cone)
      );
    }
    const { reach, radius } = this.catchScales(player);
    return (
      inCatchVolume(player.position, forward, this.ball.position, reach, radius) ||
      segmentHitsCatch(player.position, forward, this.ballFrom, this.ball.position, reach, radius)
    );
  }

  /** Where this player is aiming. Humans aim with the camera, even before the body catches up. */
  private lookForward(player: PlayerState): THREE.Vector3 {
    if (player.role === 'human') return this.cameraBasis().forward.clone();
    return player.facing.clone();
  }

  private tryClaim(player: PlayerState): void {
    if (this.ball.possession === 'held' && this.ball.ownerId !== player.id) return;
    if (!this.canTake(player) || !this.pointInReach(player, this.ball.position)) return;
    this.takeBall(player);
  }

  /**
   * Loose-ball pickup after the ball has moved. The mitt is a forward capsule, and the
   * segment from the previous position is tested so a pass cannot step through it.
   * Human wins a tie. Catch stance uses the wider mitt.
   */
  private resolveCatches(): void {
    if (this.ball.possession !== 'free' || this.ball.claimLock > 0) return;
    const ready = this.players.some((player) => player.catchReady);
    if (this.ball.arc && !ready) return;
    const human = this.getHuman();
    if (this.canTake(human) && this.sweptReach(human)) {
      this.takeBall(human);
      return;
    }
    for (const player of this.players) {
      if (player.id === human.id || player.aiBehavior === 'goalie') continue;
      if (!this.canTake(player) || !this.sweptReach(player)) continue;
      this.takeBall(player);
      return;
    }
  }

  /** Catch-ready keeps a soft pass and can pop a ball that arrives too hard. */
  private takeBall(player: PlayerState): void {
    if (player.catchReady) {
      const chance = fumbleChance(this.ball.velocity.length(), this.tunables.fumbleSpeed);
      if (chance > 0 && Math.random() < chance) {
        this.popFumble(player);
        return;
      }
    }
    this.giveBall(player);
    this.match.statusMessage =
      player.role === 'human'
        ? 'You have the ball'
        : player.team === this.getHuman().team
          ? 'Teammate has the ball'
          : 'AI claimed the ball';
  }

  /** The hands met the ball and lost it. It stays free. */
  private popFumble(player: PlayerState): void {
    const away = this.tmp.side.copy(this.ball.position).sub(player.position);
    if (away.lengthSq() < 1e-6) away.copy(this.lookForward(player));
    else away.normalize();
    const speed = this.ball.velocity.length();
    this.ball.arc = null;
    this.ball.velocity.copy(away).multiplyScalar(Math.max(8, speed * 0.55));
    this.ball.claimLock = 0.28;
    player.hitFlash = 0.7;
    player.deflectTime = 0.12;
    this.match.statusMessage = 'Fumble!';
  }

  /**
   * Catch-ready slap. The ball leaves along the aim and nobody claims it.
   * A miss still plays the hand so the click reads.
   */
  private tryDeflect(player: PlayerState): void {
    player.deflectTime = 0.18;
    const dist = player.position.distanceTo(this.ball.position);
    const reach = Math.max(1.2, this.tunables.catchReadyRadius);
    if (dist > reach) return;
    if (this.ball.possession === 'held' && this.ball.ownerId !== null && this.ball.ownerId !== player.id) {
      const owner = this.players[this.ball.ownerId];
      if (owner) {
        owner.hasBall = false;
        if (owner.actionPose === 'hold') owner.actionPose = 'none';
      }
    }
    const aim = this.lookForward(player);
    if (aim.lengthSq() < 1e-8) aim.copy(player.facing);
    else aim.normalize();
    this.ball.possession = 'free';
    this.ball.ownerId = null;
    this.ball.arc = null;
    this.ball.velocity.copy(aim).multiplyScalar(Math.max(4, this.tunables.deflectStrength));
    this.ball.claimLock = 0.35;
    this.ball.position.copy(player.position).addScaledVector(aim, Math.min(Math.max(dist, 0.4), 1.15));
    this.match.statusMessage = 'Deflect!';
  }

  /** An AI receiver squares up when a pass is closing on them. */
  private trackIncomingPass(player: PlayerState, dt: number): void {
    if (!player.active || player.role === 'stub' || player.hasBall) {
      player.catchReady = false;
      return;
    }
    if (this.ball.possession !== 'free' || this.ball.lastOwnerId === player.id) {
      player.catchReady = false;
      return;
    }
    const to = this.tmp.side.copy(player.position).sub(this.ball.position);
    const dist = to.length();
    const window = Math.max(14, this.tunables.catchReadyRadius * 2.4);
    const speed = this.ball.velocity.length();
    const closing = dist > 1e-4 ? this.ball.velocity.dot(to) / dist : 0;
    if (dist > window || speed < 3 || closing < 3) {
      player.catchReady = false;
      return;
    }
    player.catchReady = true;
    player.catchStance = true;
    to.multiplyScalar(1 / dist);
    rotateToward(player.facing, to, Math.max(2, this.tunables.bodyTurnRate), dt);
  }

  /** Don't launch the ball off a chest that was about to catch it. */
  private separateBallFromPlayers(): void {
    if (this.ball.possession !== 'free' || this.ball.arc) return;
    const sep = PLAYER.radius + BALL.radius;
    for (const player of this.players) {
      if (!player.active) continue;
      // A pass, shot, drop, or check leaves from the palm, which overlaps the
      // body sphere. Pushing it out here would pop it off the hand.
      if (
        player.id === this.ball.lastOwnerId &&
        (player.selfCatchLock || player.reclaimGrace > 0 || this.ball.claimLock > 0.15)
      ) {
        continue;
      }
      const delta = this.ball.position.clone().sub(player.position);
      const dist = delta.length();
      if (dist >= sep || dist <= 1e-5) continue;
      const normal = delta.multiplyScalar(1 / dist);
      this.ball.position.copy(player.position).addScaledVector(normal, sep);
      const vn = this.ball.velocity.dot(normal) - player.velocity.dot(normal);
      if (vn >= 0) continue;
      const forward = player.id === this.humanId ? this.cameraBasis().forward : player.facing;
      const soft = normal.dot(forward) > 0.15;
      this.ball.velocity.addScaledVector(normal, -vn * (soft ? 0.28 : 1.15));
    }
  }

  /** Drift a near miss into the outstretched hands. Only while the catch stance is held. */
  private pullCatch(human: PlayerState, dt: number): void {
    if (!human.catchReady || this.ball.possession !== 'free' || this.ball.arc) return;
    if (this.ball.claimLock > 0) return;
    if (human.reclaimGrace > 0 && this.ball.lastOwnerId === human.id) return;
    if (human.selfCatchLock && this.ball.lastOwnerId === human.id) return;
    if (this.kickoffLock > 0 || this.match.resetTimer > 0) return;
    const pull = Math.max(0, this.tunables.catchPull);
    if (pull <= 0) return;
    const reach = Math.max(0.4, this.tunables.catchReadyRadius) * 1.15;
    const cone = Math.max(0.05, this.tunables.catchReadyCone);
    const forward = this.lookForward(human);
    if (!inCatchCone(human.position, forward, this.ball.position, reach, cone)) return;
    const hands = this.tmp.holdTarget
      .copy(human.position)
      .addScaledVector(forward, Math.min(1.1, Math.max(0.4, this.tunables.catchReadyRadius) * 0.35))
      .addScaledVector(human.up, 0.18);
    const toHands = this.tmp.side.copy(hands).sub(this.ball.position);
    const dist = toHands.length();
    if (dist < 0.08) return;
    toHands.multiplyScalar(1 / dist);
    const falloff = 1 - THREE.MathUtils.smoothstep(dist, reach * 0.35, reach);
    this.ball.velocity.addScaledVector(toHands, pull * Math.max(0.25, falloff) * dt);
    const closing = this.ball.velocity.dot(toHands);
    if (closing < 0) this.ball.velocity.addScaledVector(toHands, -closing * 0.45);
  }

  private giveBall(player: PlayerState): void {
    for (const p of this.players) {
      if (!p.hasBall) continue;
      p.hasBall = false;
      if (p.actionPose === 'hold') p.actionPose = 'none';
    }
    player.hasBall = true;
    player.catchReady = false;
    this.ball.possession = 'held';
    this.ball.ownerId = player.id;
    this.ball.lastOwnerId = player.id;
    this.ball.arc = null;
    this.ball.velocity.set(0, 0, 0);
    this.carryFrom.copy(this.ball.position);
    this.carryBlend = 0;
    this.playPose(player, 'claim', 0.34);
  }

  private stripBall(tacker: PlayerState, owner: PlayerState): void {
    owner.hasBall = false;
    owner.reclaimGrace = PLAYER.reclaimCoyote;
    this.giveBall(tacker);
    this.ball.claimLock = 0.05;
    this.match.statusMessage = 'Strip!';
  }

  /** Bar this thrower from the ball until it has cleared their mitt. */
  private noteThrow(player: PlayerState): void {
    player.selfCatchLock = true;
    player.selfCatchTime = 0;
  }

  /**
   * The release sweep still intersects the mitt on the frame the ball leaves it.
   * Wait out a short grace, then require both ends of the step to sit past the
   * mitt so the next sweep cannot pick the throw up. Other players are unaffected.
   */
  private ballClearOfThrower(player: PlayerState): boolean {
    const { reach, radius } = this.catchScales(player);
    const clear = reach + radius + PLAYER.selfCatchClearance;
    return (
      this.ball.position.distanceTo(player.position) >= clear &&
      this.ballFrom.distanceTo(player.position) >= clear
    );
  }

  private refreshSelfCatchLocks(): void {
    for (const player of this.players) {
      if (!player.selfCatchLock) continue;
      const stillTheirs = this.ball.possession !== 'held' && this.ball.lastOwnerId === player.id;
      if (!stillTheirs || player.selfCatchTime >= PLAYER.selfCatchMax) {
        player.selfCatchLock = false;
        player.selfCatchTime = 0;
        continue;
      }
      if (player.selfCatchTime >= PLAYER.selfCatchGrace && this.ballClearOfThrower(player)) {
        player.selfCatchLock = false;
        player.selfCatchTime = 0;
      }
    }
  }

  private releaseBall(impulse?: THREE.Vector3): void {
    const ownerId = this.ball.ownerId;
    if (ownerId !== null) {
      const owner = this.players[ownerId];
      if (owner) owner.hasBall = false;
    }
    this.ball.possession = 'free';
    this.ball.ownerId = null;
    this.ball.claimLock = BALL.claimCooldown;
    this.ball.arc = null;
    if (impulse) this.ball.velocity.copy(impulse);
  }

  private clearShotAim(): void {
    this.shotAim.active = false;
    this.shotAim.bendRight = 0;
    this.shotAim.bendUp = 0;
    this.shotAim.lockId = null;
    this.shotAimManual = false;
    this.holdLookPending = false;
    this.power.reset();
    this.charge = { active: false, kind: null, amount: 0 };
    this.chargeGhost = [];
    this.pullBand.visible = false;
    this.landingMarker.outOfReach = false;
    this.syncThrowReadout();
  }

  /** A held throw or an open tap window. Right-click drops it without releasing. */
  private throwInProgress(): boolean {
    return (
      this.shotAim.active ||
      this.power.capturing() ||
      (this.charge.active && (this.charge.kind === 'shoot' || this.charge.kind === 'kick'))
    );
  }

  private cancelAimedThrow(human: PlayerState, buttonStillDown: boolean): void {
    this.clearShotAim();
    this.pullTravel = 0;
    this.targetReach = 0;
    this.shotBlocked = buttonStillDown;
    if (human.hasBall) {
      human.actionPose = 'hold';
      human.actionPoseTime = 0;
    }
    this.match.statusMessage = 'Throw cancelled';
  }

  private powerTuning(): PowerTuning {
    return {
      mode: this.tunables.powerMode,
      rate: Math.max(0, this.tunables.shotPowerRate),
      tapWindow: Math.max(0.05, this.tunables.tapWindow),
      tapMax: Math.max(1, this.tunables.tapMax),
    };
  }

  private syncThrowReadout(): void {
    const tuning = this.powerTuning();
    this.throwReadout.taps = this.power.taps();
    this.throwReadout.tapMax = this.power.mode === 'tap' ? this.power.maxTaps(tuning) : 0;
    this.throwReadout.window = this.power.windowLeft();
  }

  private throwStatus(): string {
    if (this.power.capturing()) {
      const max = this.power.maxTaps(this.powerTuning());
      return `Tap for power ${this.power.taps()}/${max}`;
    }
    if (this.shotAim.lockId !== null) {
      return 'Teammate locked — mouse bends the arc, release throws';
    }
    if (this.power.mode === 'tap') return 'Aim locked — release, then tap for power';
    if (this.power.mode === 'hold') return 'Hold to charge — release throws';
    if (this.power.mode === 'target') return 'Mouse up/down sets distance, left/right bends — release throws';
    if (this.power.mode === 'pull') return 'Drag down to pull, sideways bends — release throws';
    return 'Throwing — power slides the marker, mouse bends the arc';
  }

  /**
   * Keep aiming while the button is down, and keep aiming through a tap window.
   * Clicks in that window add power. They do not start a check or a new aim.
   */
  private sustainThrow(human: PlayerState, intent: InputIntent, dt: number): void {
    const kick = this.charge.kind === 'kick';
    if (!this.shotAim.active) this.beginShotAim();
    this.stickBallToHand(human);
    this.acquireTeammate();
    this.charge.active = true;
    this.charge.kind = kick ? 'kick' : 'shoot';
    const tuning = this.powerTuning();
    let fired = false;
    const edge = kick ? intent.kick : intent.shoot;
    const held = kick ? intent.kickHeld : intent.shootHeld;
    if (this.power.capturing()) {
      if (edge) {
        fired = this.power.tap(tuning);
        this.landingMarker.pulse = 1;
        this.throwReadout.feedback += 1;
      }
      if (!fired) fired = this.power.tick(dt, tuning);
    } else if (held) {
      this.power.hold(dt, tuning);
    }
    this.charge.amount = this.power.amount();
    this.syncThrowReadout();
    if (fired) {
      if (this.charge.kind === 'kick') this.startKickSwing(human);
      else this.fireAimedShot(human);
      return;
    }
    // Stay in the hold pose so the ball remains in the palm. The view cocks
    // that hand from the live power without leaving the carry.
    human.actionPose = 'hold';
    human.actionPoseTime = 0;
    this.refreshShotTarget();
    this.updateChargeGhost(human);
    this.match.statusMessage = this.throwStatus();
  }

  /** Button came up. Meter and hold throw now. Tap opens the window instead. */
  private finishThrowHold(human: PlayerState): void {
    const fireNow = this.power.release(this.powerTuning());
    this.charge.amount = this.power.amount();
    this.syncThrowReadout();
    const kick = this.charge.kind === 'kick';
    if (fireNow) {
      if (kick) this.startKickSwing(human);
      else this.fireAimedShot(human);
      return;
    }
    this.charge.active = true;
    this.charge.kind = kick ? 'kick' : 'shoot';
    human.actionPose = 'hold';
    human.actionPoseTime = 0;
    this.refreshShotTarget();
    this.updateChargeGhost(human);
    this.match.statusMessage = this.throwStatus();
  }

  private fireAimedShot(human: PlayerState): void {
    const amount = this.power.amount();
    this.releaseShot(human, amount);
    this.charge = { active: false, kind: null, amount: 0 };
    this.chargeGhost = [];
    this.syncThrowReadout();
  }

  private aimDistance(): number {
    const drag = Math.max(0.05, this.tunables.ballDrag);
    const dragScale = BALL.drag / drag;
    const delivery = this.kickingDelivery()
      ? Math.max(1, this.tunables.kickRange)
      : Math.max(0.2, this.tunables.throwSpeedScale);
    // The wheel bias is already world units, so it is added after the scale.
    return THREE.MathUtils.clamp(
      this.tunables.arcAimDistance * dragScale * delivery + this.aimDistanceBias,
      SHOT_ARC.minRange,
      ARENA_RADIUS - BALL.radius - 0.5,
    );
  }

  private markerLimit(): number {
    return ARENA_RADIUS - BALL.radius - 0.3;
  }

  /**
   * Start a throw. Curve accumulators reset so a click with no mouse movement
   * is straight. The body snaps to the camera so the ball does not swing.
   * The aim direction locks here; the landing point is rebuilt from the body.
   */
  private beginShotAim(): void {
    const human = this.getHuman();
    const basis = this.cameraBasis();
    human.facing.copy(basis.forward);
    human.up.copy(basis.up);
    this.stickBallToHand(human);
    this.lockedAim.copy(basis.forward);
    if (this.lockedAim.lengthSq() < 1e-8) this.lockedAim.set(0, 0, 1);
    else this.lockedAim.normalize();
    this.shotAim.active = true;
    this.shotAim.bendRight = 0;
    this.shotAim.bendUp = 0;
    this.shotAim.lockId = null;
    this.shotAimManual = false;
    this.power = createPowerStrategy(this.tunables.powerMode);
    this.power.begin();
    this.charge.active = true;
    this.charge.kind = 'shoot';
    this.seedAimPower();
    this.charge.amount = this.power.amount();
    this.syncThrowReadout();
    this.acquireTeammate();
    this.refreshShotTarget();
  }

  /**
   * Target mode starts on the current aim point. Pull mode starts as a soft toss.
   * Other modes keep whatever their strategy begins at.
   */
  private seedAimPower(): void {
    const mode = this.tunables.powerMode;
    if (mode === 'pull') {
      this.pullTravel = 0;
      this.power.setAmount(0);
      return;
    }
    if (mode !== 'target') return;
    const minD = SHOT_ARC.minRange;
    const maxD = this.maxFlightDistance();
    this.targetReach = THREE.MathUtils.clamp(this.straightAimDistance(), minD, maxD);
    const span = Math.max(0.001, maxD - minD);
    this.power.setAmount((this.targetReach - minD) / span);
  }

  /** Distance from the hand to the straight-throw aim point, after the shell clamp. */
  private straightAimDistance(): number {
    const human = this.getHuman();
    const hand = this.lookCarryPoint(human, this.tmp.holdTarget);
    const raw = this.tmp.predictPos.copy(hand).addScaledVector(this.cameraBasis().forward, this.maxFlightDistance());
    const out = this.tmp.predictVel;
    clampAimMarker(out, raw, hand, SHOT_ARC.minRange, this.markerLimit());
    return Math.max(SHOT_ARC.minRange, out.distanceTo(hand));
  }

  /** Slide the chosen landing distance. Past full power the marker goes red and the throw clamps. */
  private nudgeTargetReach(delta: number): void {
    if (!this.shotAim.active || delta === 0) return;
    this.breakShotLock();
    const minD = SHOT_ARC.minRange;
    const maxD = this.maxFlightDistance();
    const past = maxD + 24;
    this.targetReach = THREE.MathUtils.clamp(this.targetReach + delta, minD, past);
    const span = Math.max(0.001, maxD - minD);
    this.power.setAmount((this.targetReach - minD) / span);
    this.charge.amount = this.power.amount();
    this.refreshShotTarget();
    if (this.charge.kind === 'shoot' || this.charge.kind === 'kick') this.updateChargeGhost(this.getHuman());
  }

  /** Mouse-down lengthens the pull. Mouse-up gives some of it back. */
  private nudgePull(delta: number): void {
    if (!this.shotAim.active || delta === 0) return;
    const full = Math.max(0.2, PULL_FULL_TRAVEL);
    this.pullTravel = THREE.MathUtils.clamp(this.pullTravel + delta, 0, full);
    this.power.setAmount(this.pullTravel / full);
    this.charge.amount = this.power.amount();
    this.refreshShotTarget();
    if (this.charge.kind === 'shoot' || this.charge.kind === 'kick') this.updateChargeGhost(this.getHuman());
  }

  /** Landing distance for a power in 0..1, from a short lob out to the aim range. */
  private kickingDelivery(): boolean {
    return this.charge.kind === 'kick' || this.kickSwing.active;
  }

  /** Farthest this delivery can send the ball, after drag, throw scale, and kick range. */
  private maxFlightDistance(): number {
    return Math.max(SHOT_ARC.minRange, this.aimDistance());
  }

  private shotReach(power: number): number {
    const minD = SHOT_ARC.minRange;
    const maxD = this.maxFlightDistance();
    return THREE.MathUtils.lerp(minD, maxD, THREE.MathUtils.clamp(power, 0, 1));
  }

  /** Where this delivery leaves from. Kicks start at the foot; throws leave the hand. */
  private releaseOrigin(player: PlayerState, out: THREE.Vector3): THREE.Vector3 {
    if (this.kickingDelivery()) return this.footPoint(player, out);
    return out.copy(this.ball.position);
  }

  /** Point `distance` from `origin` along the locked aim, kept inside the shell. */
  private pointFrom(origin: THREE.Vector3, out: THREE.Vector3, distance: number): void {
    const raw = this.tmp.predictPos.copy(origin).addScaledVector(this.lockedAim, distance);
    clampAimMarker(out, raw, origin, SHOT_ARC.minRange, this.markerLimit());
  }

  /**
   * Slide a landing opposite the mouse bend so the ball arcs out and comes back.
   * `curveAimOffset` 0 leaves the spot on the aim ray. Kicks use `kickCurve`, same as the arc.
   */
  /**
   * Signed bend inside the big focus ring. Each axis is in -cap..cap, and the
   * pair is pulled back so a diagonal lands on the ring instead of outside it.
   * A kick keeps `kickCurve` of the throw. Cap is 1 at the default bend limit,
   * and never more than the ring.
   */
  private bendFraction(): { right: number; up: number } {
    const curve = this.kickingDelivery() ? Math.max(0, this.tunables.kickCurve) : 1;
    const speed = Math.max(1, this.tunables.arcBendSpeed);
    const full = speed * FOCUS_FULL_SWIPE;
    const cap = Math.min(1, Math.max(0, this.tunables.arcBendLimit) / Math.max(0.05, SHOT_ARC.bendLimit));
    let right = (this.shotAim.bendRight * curve) / full;
    let up = (this.shotAim.bendUp * curve) / full;
    const len = Math.hypot(right, up);
    if (len > cap && len > 1e-8) {
      const scale = cap / len;
      right *= scale;
      up *= scale;
    }
    return { right, up };
  }

  /** Camera-to-marker distance used to size the big ring the same way the view does. */
  private focusRadius(origin: THREE.Vector3, straight: THREE.Vector3): number {
    const ahead = origin.distanceTo(straight);
    const follow = Math.max(1.5, this.tunables.camDistance);
    const camDist = Math.hypot(follow + ahead, this.tunables.camHeight);
    return bigFocusRadius(camDist);
  }

  private applyCurveAimOffset(origin: THREE.Vector3, target: THREE.Vector3): void {
    const slider = THREE.MathUtils.clamp(this.tunables.curveAimOffset, 0, 1);
    if (slider <= 1e-4 || this.shotAim.lockId !== null) return;
    const chord = this.tmp.predictPos.copy(target).sub(origin);
    const chordLen = chord.length();
    if (chordLen < 1e-3) return;
    chord.multiplyScalar(1 / chordLen);
    const frac = this.bendFraction();
    if (frac.right * frac.right + frac.up * frac.up < 1e-8) return;
    const basis = this.cameraBasis();
    const axisUp = this.tmp.predictVel.copy(basis.up).addScaledVector(chord, -basis.up.dot(chord));
    if (axisUp.lengthSq() < 1e-6) return;
    axisUp.normalize();
    const axisRight = this.tmp.aim.copy(basis.right).addScaledVector(chord, -basis.right.dot(chord));
    axisRight.addScaledVector(axisUp, -axisRight.dot(axisUp));
    if (axisRight.lengthSq() < 1e-6) axisRight.crossVectors(chord, axisUp);
    if (axisRight.lengthSq() < 1e-6) return;
    axisRight.normalize();
    // Opposite the bend, and never past the focus circle.
    const radius = this.focusRadius(origin, target) * slider;
    target.addScaledVector(axisRight, -frac.right * radius);
    target.addScaledVector(axisUp, -frac.up * radius);
    clampAimMarker(target, target, origin, SHOT_ARC.minRange, this.markerLimit());
  }

  /** Point `distance` from the hand along the locked aim, kept inside the shell. */
  private pointAlongAim(out: THREE.Vector3, distance: number): void {
    this.pointFrom(this.ball.position, out, distance);
  }

  /**
   * Rebuild the landing point from the current hand, the locked aim, and power.
   * A teammate lock keeps the marker on them. Min and max stays on the aim
   * so the reach rings show the envelope of this curve.
   */
  private refreshShotTarget(): void {
    const power = THREE.MathUtils.clamp(this.charge.amount, 0, 1);
    if (this.kickingDelivery()) this.shotAim.lockId = null;
    const minD = SHOT_ARC.minRange;
    const maxD = this.maxFlightDistance();
    const origin = this.releaseOrigin(this.getHuman(), this.tmp.side);
    this.pointFrom(origin, this.landingMarker.minPosition, minD);
    this.pointFrom(origin, this.landingMarker.maxPosition, maxD);
    const aimingTarget = this.tunables.powerMode === 'target' && this.shotAim.active;
    if (this.shotAim.lockId === null) {
      this.pointFrom(origin, this.shotAim.target, this.shotReach(power));
      this.landingMarker.straightPosition.copy(this.shotAim.target);
      this.landingMarker.focusRadius = this.focusRadius(origin, this.shotAim.target);
      this.applyCurveAimOffset(origin, this.shotAim.target);
      if (aimingTarget) {
        this.pointFrom(origin, this.markerShown, this.targetReach);
        this.landingMarker.straightPosition.copy(this.markerShown);
        this.landingMarker.focusRadius = this.focusRadius(origin, this.markerShown);
        this.applyCurveAimOffset(origin, this.markerShown);
      } else {
        this.markerShown.copy(this.shotAim.target);
      }
    } else {
      this.markerShown.copy(this.shotAim.target);
      this.landingMarker.straightPosition.copy(this.shotAim.target);
      this.landingMarker.focusRadius = this.focusRadius(origin, this.shotAim.target);
    }
    this.landingMarker.outOfReach = aimingTarget && this.shotAim.lockId === null && this.targetReach > maxD + 0.35;
    this.landingMarker.distance = origin.distanceTo(this.markerShown);
    this.syncPullBand();
  }

  /** A short band from the hand back along the aim. Length follows the pull. */
  private syncPullBand(): void {
    const show =
      this.shotAim.active &&
      this.tunables.powerMode === 'pull' &&
      (this.charge.kind === 'shoot' || this.charge.kind === 'kick');
    this.pullBand.visible = show;
    if (!show) return;
    const len = 0.4 + THREE.MathUtils.clamp(this.charge.amount, 0, 1) * 2.2;
    this.pullBand.from.copy(this.ball.position);
    this.pullBand.to.copy(this.ball.position).addScaledVector(this.lockedAim, -len);
  }

  private breakShotLock(): void {
    this.shotAimManual = true;
    this.shotAim.lockId = null;
  }

  /**
   * 0 leaves the cursor, preview, and pass pick where he pointed.
   * 1 is the full teammate snap. The checkbox wins over the strength slider.
   */
  private teammateSnapScale(): number {
    if (!this.tunables.snapAimToTeammates) return 0;
    return THREE.MathUtils.clamp(this.tunables.snapAimStrength, 0, 1);
  }

  /** Snap the marker onto a teammate standing on the look ray at the moment the throw starts. */
  private acquireTeammate(): void {
    if (!this.shotAim.active || this.shotAimManual) return;
    if (this.teammateSnapScale() <= 1e-4) {
      this.shotAim.lockId = null;
      return;
    }
    const hit = this.teammateOnLook();
    if (hit) this.shotAim.lockId = hit.id;
    const id = this.shotAim.lockId;
    if (id === null) return;
    const mate = this.players[id];
    if (!mate || !mate.active || mate.team !== this.getHuman().team) {
      this.shotAim.lockId = null;
      return;
    }
    const limit = this.markerLimit();
    this.shotAim.target.copy(mate.position).addScaledVector(mate.up, 0.15);
    if (this.shotAim.target.length() > limit) this.shotAim.target.setLength(limit);
  }

  private teammateOnLook(): PlayerState | null {
    const scale = this.teammateSnapScale();
    if (scale <= 1e-4) return null;
    const human = this.getHuman();
    const origin = human.position;
    const dir = this.cameraBasis().forward;
    if (dir.lengthSq() < 1e-8) return null;
    const pad = (PLAYER.radius + Math.max(0, this.tunables.teammateLockRadius)) * scale;
    let best: PlayerState | null = null;
    let bestT = Infinity;
    for (const p of this.players) {
      if (!p.active || p.id === human.id || p.team !== human.team || p.role === 'stub') continue;
      const t = this.raySphereT(
        origin.x,
        origin.y,
        origin.z,
        dir.x,
        dir.y,
        dir.z,
        p.position.x,
        p.position.y,
        p.position.z,
        pad,
        0.4,
      );
      if (t !== null && t < bestT) {
        bestT = t;
        best = p;
      }
    }
    return best;
  }

  private clampStoredBend(): void {
    const max = ARENA_RADIUS * 1.5;
    const m = Math.hypot(this.shotAim.bendRight, this.shotAim.bendUp);
    if (m > max && m > 1e-8) {
      const scale = max / m;
      this.shotAim.bendRight *= scale;
      this.shotAim.bendUp *= scale;
    }
  }

  /**
   * Bezier that would fly if the shot were released at the current charge.
   * Aimed at a goal, the end point moves through the hoop into the net so the
   * bend finishes inside the goal instead of dying on the marker. A curve whose
   * chord misses but whose exit tangent enters the mouth keeps that shape and
   * carries on along the tangent.
   */
  private plannedArc(charge: number): {
    p0: THREE.Vector3;
    p1: THREE.Vector3;
    p2: THREE.Vector3;
    duration: number;
    carryLeft: number;
    carryDir: THREE.Vector3 | null;
    carrySpeed: number;
  } {
    const limit = this.markerLimit();
    const p0 = this.ball.position.clone();
    if (p0.length() > limit) p0.setLength(limit);
    let p2 = this.shotAim.target.clone();
    const power = THREE.MathUtils.clamp(charge, 0, 1);
    const carryBudget = Math.max(0, this.tunables.shotCarry);
    let retargeted = false;
    if (this.shotAim.lockId === null && carryBudget > 0) {
      const chord = p2.clone().sub(p0);
      const chordLen = chord.length();
      if (chordLen > 0.5) {
        const hit = rayHitsMouth(p0, chord, 1.25);
        if (hit && Math.abs(hit.t - chordLen) <= carryBudget) {
          p2 = pointInsidePocket(hit.team, hit.point);
          retargeted = true;
        }
      }
    }
    // Loft scales with the vertical bend (and with an explicit hand-curve
    // slider). Zero mouse input stays on the chord at every distance and
    // charge. There is no threshold where a lob switches on.
    const frac = this.bendFraction();
    const vertical = Math.min(1, Math.abs(frac.up));
    const handBlend = Math.min(1, Math.abs(this.tunables.arcHandCurve) / 0.12);
    const loft = Math.max(vertical, handBlend) * Math.max(0, this.tunables.arcHeight + this.tunables.shotPowerAngle * power);
    const radius = this.focusRadius(p0, p2);
    const basis = this.cameraBasis();
    const p1 = shapedControl(
      new THREE.Vector3(),
      p0,
      p2,
      basis.right,
      basis.up,
      loft,
      frac.right * radius,
      frac.up * radius,
      this.tunables.arcBendLimit,
      limit,
      this.tunables.arcHandCurve,
    );
    const straight = Math.max(0.5, p0.distanceTo(p2));
    const via = p0.distanceTo(p1) + p1.distanceTo(p2);
    const length = Math.max(straight, (straight + via) * 0.5);
    const kickBoost = this.kickingDelivery() ? Math.max(1, this.tunables.kickSpeed) : 1;
    const speed = THREE.MathUtils.lerp(this.shotSpeedMin(), this.shotSpeedMax(), power) * kickBoost;
    const duration = Math.max(SHOT_ARC.minDuration, length / speed);

    let carryLeft = 0;
    let carryDir: THREE.Vector3 | null = null;
    if (!retargeted && this.shotAim.lockId === null && carryBudget > 0) {
      const exit = p2.clone().sub(p1);
      const hit = rayHitsMouth(p2, exit, 0.4);
      if (hit && hit.t <= carryBudget) {
        const dest = pointInsidePocket(hit.team, hit.point);
        carryDir = dest.sub(p2);
        carryLeft = carryDir.length();
        if (carryLeft > 0.2) carryDir.multiplyScalar(1 / carryLeft);
        else {
          carryLeft = 0;
          carryDir = null;
        }
      }
    }
    return { p0, p1, p2, duration, carryLeft, carryDir, carrySpeed: speed };
  }

  private getAimDirection(player: PlayerState, isHuman: boolean): THREE.Vector3 {
    const aim = this.tmp.aim;
    if (isHuman) {
      aim.copy(this.cameraBasis().forward);
    } else {
      const targetGoal = goalCenter(player.team);
      aim.copy(targetGoal).sub(player.position).normalize();
    }

    // Light aim assist toward opponent goal
    const assist = this.tunables.aimAssist;
    if (assist > 0) {
      const goal = goalCenter(player.team);
      const toGoal = goal.clone().sub(player.position).normalize();
      if (aim.dot(toGoal) > 1 - 0.5) {
        aim.lerp(toGoal, assist * 0.5).normalize();
      }
    }
    return aim;
  }

  /** Drop the ball onto the foot, then launch. The extra beat is the windup. */
  private startKickSwing(human: PlayerState): void {
    const power = this.power.amount();
    this.kickSwing.active = true;
    this.kickSwing.time = Math.max(0.05, this.tunables.kickWindup);
    this.kickSwing.power = power;
    this.kickSwing.playerId = human.id;
    this.kickSwing.aim.copy(this.lockedAim);
    this.kickSwing.bendRight = this.shotAim.bendRight;
    this.kickSwing.bendUp = this.shotAim.bendUp;
    const drop = human.up.clone().multiplyScalar(-2.4).addScaledVector(human.velocity, 0.15);
    this.releaseAtHand(human, this.lockedAim);
    this.noteThrow(human);
    this.releaseBall(drop);
    this.ball.claimLock = Math.max(this.ball.claimLock, this.kickSwing.time + 0.25);
    this.rememberThrow(human, power);
    this.playPose(human, 'kick', this.kickSwing.time + 0.36);
    this.clearShotAim();
    this.match.statusMessage = 'Kick!';
  }

  private footPoint(player: PlayerState, out: THREE.Vector3): THREE.Vector3 {
    const forward = player.facing.clone();
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, 1);
    else forward.normalize();
    return out.copy(player.position).addScaledVector(forward, 0.62).addScaledVector(player.up, -0.1);
  }

  /**
   * Charge while C or B is held, swing on release. Squared-up with the ball
   * stays on the aimed drop-kick and never comes through here.
   */
  private updateLooseKick(human: PlayerState, intent: InputIntent, dt: number): void {
    if (this.kickSwing.active || this.strike.active) return;
    if (this.kickRecover > 0) return;
    if (intent.kickHeld) {
      this.kickCharging = true;
      this.kickSquared = intent.strafe;
      const fill = Math.max(0.18, this.tunables.kickWindup + 0.22);
      this.kickCharge = Math.min(1, this.kickCharge + dt / fill);
      this.kickVisual.playerId = human.id;
      this.kickVisual.power = this.kickCharge;
      this.kickVisual.swinging = false;
      return;
    }
    if (!this.kickCharging) return;
    const power = Math.max(0.35, this.kickCharge);
    const squared = this.kickSquared;
    this.kickCharging = false;
    this.kickCharge = 0;
    this.kickSquared = false;
    this.startStrike(human, power, squared);
  }

  /** Release a held ball onto the foot path and swing. A whiff recovers briefly. */
  private startStrike(human: PlayerState, power: number, squared: boolean): void {
    this.strike.active = true;
    this.strike.u = 0;
    this.strike.power = power;
    this.strike.playerId = human.id;
    this.strike.squared = squared;
    this.strike.struck = false;
    this.strike.bestDist = Infinity;
    this.strike.bestU = 0;
    const aim = this.strike.aim;
    if (squared) {
      aim.copy(this.cameraBasis().forward);
      if (aim.lengthSq() < 1e-8) aim.copy(human.facing);
    } else {
      aim.copy(human.facing);
    }
    if (aim.lengthSq() < 1e-8) aim.set(0, 0, 1);
    else aim.normalize();
    if (human.hasBall) {
      const meet = kickFootPoint(this.tmp.predictPos, human.position, human.facing, human.up, KICK_SWEET);
      this.releaseAtHand(human, aim);
      this.releaseBall(human.velocity);
      this.ball.position.copy(meet);
      this.ball.velocity.copy(human.velocity);
      this.ball.arc = null;
      this.ball.claimLock = 0.05;
    }
    this.kickVisual.playerId = human.id;
    this.kickVisual.power = power;
    this.kickVisual.swinging = true;
    this.playPose(human, 'kick', KICK_SWING_TIME + 0.08);
    this.match.statusMessage = power > 0.75 ? 'Winding up…' : 'Kick!';
  }

  private tickStrike(dt: number): void {
    if (!this.strike.active) {
      if (this.kickRecover > 0) this.kickRecover = Math.max(0, this.kickRecover - dt);
      return;
    }
    const player = this.players[this.strike.playerId];
    if (!player || !player.active) {
      this.strike.active = false;
      this.kickVisual.swinging = false;
      return;
    }
    const duration = KICK_SWING_TIME;
    const prev = this.strike.u;
    this.strike.u = Math.min(1, prev + dt / duration);
    const sweet = KICK_SWEET;
    const width = Math.max(0.04, this.tunables.kickSweet);
    const window = Math.max(width * 1.8, 0.16);
    const open = sweet - window;
    const close = sweet + window;
    const inWindow = this.strike.u >= open && this.strike.u <= close;
    if (!this.strike.struck && this.ball.possession === 'free' && (inWindow || (prev < close && this.strike.u > close))) {
      const sampleU = THREE.MathUtils.clamp(this.strike.u, open, close);
      const foot = kickFootPoint(this.tmp.predictPos, player.position, player.facing, player.up, sampleU);
      const dist = foot.distanceTo(this.ball.position);
      if (dist < this.strike.bestDist) {
        this.strike.bestDist = dist;
        this.strike.bestU = sampleU;
      } else if (this.strike.bestDist <= Math.max(0.2, this.tunables.kickReach)) {
        // The foot is past its closest point. That moment is the contact.
        kickFootPoint(this.tmp.predictPos, player.position, player.facing, player.up, this.strike.bestU);
        this.connectStrike(player, this.tmp.predictPos, this.strike.bestU);
      }
    }
    if (
      !this.strike.struck &&
      this.strike.u >= close &&
      this.strike.bestDist <= Math.max(0.2, this.tunables.kickReach)
    ) {
      kickFootPoint(this.tmp.predictPos, player.position, player.facing, player.up, this.strike.bestU);
      this.connectStrike(player, this.tmp.predictPos, this.strike.bestU);
    }
    if (this.strike.u < 1) return;
    this.strike.active = false;
    this.kickVisual.swinging = false;
    this.kickVisual.playerId = -1;
    this.kickVisual.power = 0;
    if (!this.strike.struck) {
      this.kickRecover = 0.34;
      this.match.statusMessage = 'Whiff';
    }
  }

  private connectStrike(player: PlayerState, foot: THREE.Vector3, u: number): void {
    this.strike.struck = true;
    const width = Math.max(0.04, this.tunables.kickSweet);
    const quality = kickQuality(u, KICK_SWEET, width);
    const clean = quality > 0.72;
    const dir = this.tmp.aim.copy(player.facing);
    if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
    else dir.normalize();
    if (this.strike.squared && this.strike.aim.lengthSq() > 1e-6) {
      dir.lerp(this.strike.aim, 0.6).normalize();
    }
    const swing = kickFootSpeed(u, KICK_SWING_TIME);
    const charge = 0.4 + 0.6 * THREE.MathUtils.clamp(this.strike.power, 0, 1);
    const kickSpeed = swing * 0.9 + Math.max(4, this.tunables.kickPower) * charge;
    const scale = 0.16 + 0.84 * quality;
    this.ball.arc = null;
    this.ball.position.copy(foot);
    // The foot's own speed is what timing changes. The swimmer's momentum always carries.
    this.ball.velocity.copy(player.velocity).addScaledVector(dir, kickSpeed * scale);
    this.ball.claimLock = 0.4;
    this.ball.lastOwnerId = player.id;
    this.kickRecover = clean ? 0.12 : 0.22;
    this.playPose(player, 'kick', 0.28);
    this.match.statusMessage = clean ? 'Clean strike!' : 'Scuffed kick';
  }

  private tickKickSwing(dt: number): void {
    if (!this.kickSwing.active) return;
    const player = this.players[this.kickSwing.playerId];
    if (!player) {
      this.kickSwing.active = false;
      return;
    }
    const foot = this.footPoint(player, this.tmp.predictPos);
    const pull = foot.sub(this.ball.position);
    this.ball.velocity.copy(pull).multiplyScalar(10);
    this.kickSwing.time -= dt;
    if (this.kickSwing.time > 0) return;
    this.launchKick(player);
  }

  private launchKick(player: PlayerState): void {
    const power = THREE.MathUtils.clamp(this.kickSwing.power, 0, 1);
    this.kickSwing.active = false;
    const foot = this.footPoint(player, this.tmp.predictPos);
    this.ball.position.copy(foot);
    this.lockedAim.copy(this.kickSwing.aim);
    if (this.lockedAim.lengthSq() < 1e-8) this.lockedAim.copy(player.facing);
    if (this.lockedAim.lengthSq() < 1e-8) this.lockedAim.set(0, 0, 1);
    this.lockedAim.normalize();
    this.shotAim.active = true;
    this.shotAim.lockId = null;
    this.shotAim.bendRight = this.kickSwing.bendRight;
    this.shotAim.bendUp = this.kickSwing.bendUp;
    this.charge.kind = 'kick';
    this.charge.amount = power;
    this.pointAlongAim(this.shotAim.target, this.shotReach(power));
    this.applyCurveAimOffset(this.ball.position, this.shotAim.target);
    const arc = this.plannedArc(power);
    this.ball.arc = {
      p0: arc.p0,
      p1: arc.p1,
      p2: arc.p2,
      elapsed: 0,
      duration: arc.duration,
      receiverId: null,
      carryLeft: arc.carryLeft,
      carryDir: arc.carryDir,
      carrySpeed: arc.carrySpeed,
    };
    quadraticVelocity(this.ball.velocity, arc.p0, arc.p1, arc.p2, 0, arc.duration);
    this.ball.claimLock = BALL.claimCooldown;
    this.shotAim.active = false;
    this.shotAim.bendRight = 0;
    this.shotAim.bendUp = 0;
    this.charge.kind = null;
    this.charge.amount = 0;
    this.match.statusMessage = power > 0.7 ? 'Big kick!' : 'Kick!';
  }

  /** Field AI shot or pass. Same Bezier as a human throw, with a kick dropping to the foot first. */
  private releaseAiDelivery(player: PlayerState, spec: AiDelivery): void {
    player.windup = 0;
    player.windupKind = 'none';
    if (spec.kick && !this.kickSwing.active && !this.aiKick.active) {
      this.armAiKick(player, spec);
      return;
    }
    this.scriptArc(player, spec, spec.kick);
  }

  private armAiKick(player: PlayerState, spec: AiDelivery): void {
    const aim = spec.point.clone().sub(player.position);
    if (aim.lengthSq() < 1e-8) aim.copy(player.facing);
    else aim.normalize();
    this.releaseAtHand(player, aim);
    this.noteThrow(player);
    this.releaseBall(player.up.clone().multiplyScalar(-2.2));
    this.ball.claimLock = Math.max(this.ball.claimLock, this.tunables.kickWindup + 0.3);
    this.rememberThrow(player, spec.power);
    this.playPose(player, 'kick', this.tunables.kickWindup + 0.36);
    this.aiKick = { active: true, time: Math.max(0.05, this.tunables.kickWindup), playerId: player.id, spec };
    this.match.statusMessage = 'Kick!';
  }

  private tickAiKick(dt: number): void {
    if (!this.aiKick.active || !this.aiKick.spec) return;
    const player = this.players[this.aiKick.playerId];
    if (!player) {
      this.aiKick.active = false;
      return;
    }
    const foot = this.footPoint(player, this.tmp.predictPos);
    this.ball.velocity.copy(foot.sub(this.ball.position)).multiplyScalar(8);
    this.aiKick.time -= dt;
    if (this.aiKick.time > 0) return;
    const spec = this.aiKick.spec;
    this.aiKick.active = false;
    this.aiKick.spec = null;
    this.ball.position.copy(this.footPoint(player, this.tmp.predictPos));
    this.scriptArc(player, spec, true);
  }

  private scriptArc(player: PlayerState, spec: AiDelivery, fromFoot: boolean): void {
    const limit = ARENA_RADIUS - BALL.radius - 0.35;
    const aim = spec.point.clone().sub(fromFoot ? this.ball.position : player.position);
    if (aim.lengthSq() < 1e-8) aim.copy(player.facing);
    else aim.normalize();
    if (!fromFoot) this.releaseAtHand(player, aim);
    const p0 = fromFoot ? this.ball.position.clone() : this.carriedPoint(player, new THREE.Vector3());
    const p2 = spec.point.clone();
    if (p2.length() > limit) p2.setLength(limit);
    const forward = player.facing.clone();
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, 1);
    else forward.normalize();
    const right = new THREE.Vector3().crossVectors(player.up, forward);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    else right.normalize();
    const height = spec.kind === 'pass' ? 0.02 : Math.max(0, this.tunables.arcHeight);
    const p1 = shapedControl(
      new THREE.Vector3(),
      p0,
      p2,
      right,
      player.up,
      height,
      spec.bendRight,
      spec.bendUp,
      this.tunables.arcBendLimit,
      limit,
      0,
    );
    const power = THREE.MathUtils.clamp(spec.power, 0, 1);
    const kickBoost = spec.kick ? Math.max(1, this.tunables.kickSpeed) : 1;
    const speed = THREE.MathUtils.lerp(this.shotSpeedMin(), this.shotSpeedMax(), power) * kickBoost;
    const length = Math.max(0.5, p0.distanceTo(p2));
    const duration = Math.max(SHOT_ARC.minDuration, length / Math.max(4, speed));
    if (!fromFoot) {
      this.noteThrow(player);
      this.releaseBall();
    }
    this.ball.position.copy(p0);
    this.ball.arc = {
      p0,
      p1,
      p2,
      elapsed: 0,
      duration,
      receiverId: spec.receiverId,
      carryLeft: 0,
      carryDir: null,
      carrySpeed: speed,
    };
    quadraticVelocity(this.ball.velocity, p0, p1, p2, 0, duration);
    this.ball.claimLock = BALL.claimCooldown;
    this.rememberThrow(player, power);
    const pose = spec.kick ? 'kick' : spec.kind === 'pass' ? 'pass' : 'shoot';
    this.playPose(player, pose, throwPoseSeconds(power, spec.kind === 'pass'));
    player.throwCurveRight = THREE.MathUtils.clamp(spec.bendRight / 22, -1, 1);
    player.throwCurveUp = THREE.MathUtils.clamp(spec.bendUp / 22, -1, 1);
    this.match.statusMessage = spec.kind === 'pass' ? 'Pass' : spec.kick ? 'Kick!' : 'Shot';
  }

  private releaseShot(player: PlayerState, charge: number): void {
    if (player.role === 'human') {
      this.releaseArcShot(player, charge);
      return;
    }
    const aim = this.getAimDirection(player, false);
    this.releaseAtHand(player, aim);
    const speed = THREE.MathUtils.lerp(this.shotSpeedMin(), this.shotSpeedMax(), charge);
    const impulse = aim.clone().multiplyScalar(speed).add(player.velocity.clone().multiplyScalar(0.35));
    this.noteThrow(player);
    this.releaseBall(impulse);
    this.rememberThrow(player, charge);
    this.playPose(player, 'shoot', throwPoseSeconds(charge));
    this.match.statusMessage = charge > 0.7 ? 'Charged shot!' : 'Shot';
  }

  /**
   * Launch the underwater lob. The ball is parameterized on the Bezier, so it
   * arrives on the marker instead of hoping a dragged impulse gets there.
   * There is no gravity in the water sim — the curve is the whole flight.
   */
  private releaseArcShot(player: PlayerState, charge: number): void {
    this.stickBallToHand(player);
    if (!this.shotAim.active) this.beginShotAim();
    this.charge.amount = THREE.MathUtils.clamp(charge, 0, 1);
    this.refreshShotTarget();
    const arc = this.plannedArc(charge);
    this.noteThrow(player);
    this.releaseBall();
    this.ball.position.copy(arc.p0);
    this.ball.arc = {
      p0: arc.p0,
      p1: arc.p1,
      p2: arc.p2,
      elapsed: 0,
      duration: arc.duration,
      receiverId: this.shotAim.lockId,
      carryLeft: arc.carryLeft,
      carryDir: arc.carryDir,
      carrySpeed: arc.carrySpeed,
    };
    quadraticVelocity(this.ball.velocity, arc.p0, arc.p1, arc.p2, 0, arc.duration);
    const thrownToMate = this.shotAim.lockId !== null;
    this.rememberThrow(player, charge);
    this.shotAim.active = false;
    this.shotAim.bendRight = 0;
    this.shotAim.bendUp = 0;
    this.shotAim.lockId = null;
    this.shotAimManual = false;
    this.power.reset();
    this.playPose(player, 'shoot', throwPoseSeconds(charge));
    this.match.statusMessage = thrownToMate ? 'Throw to teammate' : charge > 0.7 ? 'High power!' : 'Arc shot';
  }

  /** Carry point: the rig's palm when the view has reported one, otherwise the chest offset. */
  private stickBallToHand(owner: PlayerState): void {
    this.carriedPoint(owner, this.ball.position);
    this.ball.velocity.copy(owner.velocity);
  }

  /**
   * Passes, shots, drops, and checks leave from the palm when a rig reported
   * one. The procedural swimmer keeps the offset just outside the body.
   */
  private releaseAtHand(player: PlayerState, aim: THREE.Vector3): void {
    if (this.carryPalm.has(player.id)) {
      this.stickBallToHand(player);
      return;
    }
    this.placeRelease(player, aim);
  }

  /** Put a released ball just outside the body along `aim` so the carrier doesn't block it. */
  private placeRelease(player: PlayerState, aim: THREE.Vector3): void {
    const gap = PLAYER.radius + BALL.radius + 0.2;
    this.ball.position.copy(player.position).addScaledVector(aim, gap);
  }

  /**
   * The view calls this after the mixer and the pose offsets, once per swimmer
   * that has a rig. The ball then tracks that palm, including through the
   * catch blend. Procedural swimmers never call it and keep the chest offset.
   */
  setCarryPalm(playerId: number, worldPoint: THREE.Vector3): void {
    const player = this.players[playerId];
    if (!player || !this.writePalmLocal(player, worldPoint)) return;
    if (this.ball.possession !== 'held' || this.ball.ownerId !== playerId) return;
    this.ball.position.copy(this.carriedPoint(player, this.tmp.holdTarget));
    const tail = this.ball.trail[this.ball.trail.length - 1];
    if (tail) tail.copy(this.ball.position);
  }

  /** Drop a rig's palm so the procedural offset takes over again. */
  clearCarryPalm(playerId: number): void {
    this.carryPalm.delete(playerId);
  }

  private writePalmLocal(player: PlayerState, worldPoint: THREE.Vector3): boolean {
    if (!this.prepareBodyAxes(player)) return false;
    let local = this.carryPalm.get(player.id);
    const fresh = !local;
    if (!local) {
      local = new THREE.Vector3();
      this.carryPalm.set(player.id, local);
    }
    this.palmDelta.copy(worldPoint).sub(player.position);
    local.set(this.palmDelta.dot(this.palmRight), this.palmDelta.dot(this.palmUp), this.palmDelta.dot(this.palmForward));
    if (fresh && this.ball.possession === 'held' && this.ball.ownerId === player.id && this.carryBlend >= 1) {
      this.carryFrom.copy(this.ball.position);
      this.carryBlend = 0;
    }
    return true;
  }

  private prepareBodyAxes(player: PlayerState): boolean {
    this.palmForward.copy(player.facing);
    if (this.palmForward.lengthSq() < 1e-8) return false;
    this.palmForward.normalize();
    this.palmUp.copy(player.up).addScaledVector(this.palmForward, -player.up.dot(this.palmForward));
    if (this.palmUp.lengthSq() < 1e-6) {
      this.palmUp.set(0, 1, 0).addScaledVector(this.palmForward, -this.palmForward.y);
      if (this.palmUp.lengthSq() < 1e-6) this.palmUp.set(1, 0, 0);
    }
    this.palmUp.normalize();
    this.palmRight.crossVectors(this.palmUp, this.palmForward).normalize();
    return true;
  }

  private readPalmWorld(player: PlayerState, local: THREE.Vector3, out: THREE.Vector3): boolean {
    if (!this.prepareBodyAxes(player)) return false;
    out
      .copy(player.position)
      .addScaledVector(this.palmRight, local.x)
      .addScaledVector(this.palmUp, local.y)
      .addScaledVector(this.palmForward, local.z);
    return true;
  }

  /** Palm center, or the chest offset when this swimmer has no rig sample. */
  private carriedPoint(owner: PlayerState, out: THREE.Vector3): THREE.Vector3 {
    const local = this.carryPalm.get(owner.id);
    if (local && this.readPalmWorld(owner, local, out)) {
      if (this.carryBlend < 1) {
        const t = this.carryBlend;
        const eased = t * t * (3 - 2 * t);
        out.lerp(this.carryFrom, 1 - eased);
      }
      return out;
    }
    return out
      .copy(owner.position)
      .addScaledVector(owner.facing, BALL.holdOffset)
      .addScaledVector(owner.up, 0.15);
  }

  /** Look-ray carry point. A reported palm replaces the fixed chest offset. */
  private lookCarryPoint(player: PlayerState, out: THREE.Vector3): THREE.Vector3 {
    if (this.carryPalm.has(player.id) && this.ball.possession === 'held' && this.ball.ownerId === player.id) {
      return this.carriedPoint(player, out);
    }
    const basis = this.cameraBasis();
    return out.copy(player.position).addScaledVector(basis.forward, BALL.holdOffset).addScaledVector(basis.up, 0.15);
  }

  private releasePass(player: PlayerState, charge: number): void {
    const isHuman = player.role === 'human';
    let aim = this.getAimDirection(player, isHuman).clone();
    const snap = isHuman ? this.teammateSnapScale() : 1;
    // Prefer a teammate in the cone. A human with snap off, or strength at 0, keeps the pointed aim.
    let best: PlayerState | null = null;
    let bestDot = 1 - 0.45 * snap;
    if (snap > 1e-4) {
      for (const t of this.players) {
        if (t.team !== player.team || t.id === player.id || !t.active) continue;
        const to = t.position.clone().sub(player.position);
        if (to.lengthSq() < 1) continue;
        to.normalize();
        const d = aim.dot(to);
        if (d > bestDot) {
          bestDot = d;
          best = t;
        }
      }
    }
    if (best) aim = best.position.clone().sub(player.position).normalize();
    this.releaseAtHand(player, aim);
    const speed = Math.max(4, this.tunables.passSpeed) * (0.65 + 0.35 * charge);
    this.noteThrow(player);
    this.releaseBall(aim.clone().multiplyScalar(speed).add(player.velocity.clone().multiplyScalar(0.25)));
    this.rememberThrow(player, charge);
    this.playPose(player, 'pass', throwPoseSeconds(charge, true));
    this.match.statusMessage = best ? 'Pass' : 'Pass (no target)';
  }

  /**
   * Arc the held kick would launch. The flight starts at the foot, with half
   * the throw bend (`kickCurve`), the same way `launchKick` builds it.
   * Throw previews use the ball where it is, which is the hand.
   */
  private previewArc(player: PlayerState): {
    p0: THREE.Vector3;
    p1: THREE.Vector3;
    p2: THREE.Vector3;
    duration: number;
    carryLeft: number;
    carryDir: THREE.Vector3 | null;
    carrySpeed: number;
  } {
    if (this.charge.kind !== 'kick') return this.plannedArc(this.charge.amount);
    const savedBall = this.ball.position.clone();
    this.ball.position.copy(this.footPoint(player, this.tmp.side));
    const arc = this.plannedArc(this.charge.amount);
    this.ball.position.copy(savedBall);
    return arc;
  }

  private sampleArc(arc: {
    p0: THREE.Vector3;
    p1: THREE.Vector3;
    p2: THREE.Vector3;
    carryLeft: number;
    carryDir: THREE.Vector3 | null;
  }): THREE.Vector3[] {
    const samples: THREE.Vector3[] = [];
    const point = new THREE.Vector3();
    for (let i = 0; i <= SHOT_ARC.samples; i++) {
      quadraticPoint(point, arc.p0, arc.p1, arc.p2, i / SHOT_ARC.samples);
      samples.push(point.clone());
    }
    if (arc.carryLeft > 0.2 && arc.carryDir) {
      for (let i = 1; i <= 8; i++) {
        samples.push(arc.p2.clone().addScaledVector(arc.carryDir, arc.carryLeft * (i / 8)));
      }
    }
    return samples;
  }

  /** Straight distance from where the ball leaves to where the preview ends. */
  private noteFlightDistance(ghost: THREE.Vector3[]): void {
    if (this.shotAim.lockId !== null || ghost.length < 2) return;
    const origin = ghost[0]!;
    const end = ghost[ghost.length - 1]!;
    this.landingMarker.distance = origin.distanceTo(end);
  }

  private updateChargeGhost(player: PlayerState): void {
    if (!this.tunables.showChargeGhost) {
      this.chargeGhost = [];
      return;
    }
    if ((this.charge.kind === 'shoot' || this.charge.kind === 'kick') && this.shotAim.active) {
      this.chargeGhost = this.sampleArc(this.previewArc(player));
      this.noteFlightDistance(this.chargeGhost);
      return;
    }
    const isHuman = player.role === 'human';
    const aim = this.getAimDirection(player, isHuman).clone();
    const speed =
      this.charge.kind === 'pass'
        ? Math.max(4, this.tunables.passSpeed) * (0.65 + 0.35 * this.charge.amount)
        : THREE.MathUtils.lerp(this.shotSpeedMin(), this.shotSpeedMax(), this.charge.amount);
    const samples: THREE.Vector3[] = [];
    const pos = this.ball.position.clone();
    const vel = aim.multiplyScalar(speed).add(player.velocity.clone().multiplyScalar(0.3));
    for (let i = 0; i < 18; i++) {
      vel.multiplyScalar(Math.exp(-this.tunables.ballDrag * (1 / 30)));
      pos.addScaledVector(vel, 1 / 30);
      const hit = resolveSphereWall(pos.clone(), vel.clone(), BALL.radius, {
        escapeSpeed: this.tunables.wallEscapeSpeed,
        escapeAngle: this.tunables.wallEscapeAngle,
        allowEscape: false,
      });
      pos.copy(hit.position);
      vel.copy(hit.velocity);
      samples.push(pos.clone());
    }
    this.chargeGhost = samples;
  }

  private updateBall(dt: number): void {
    this.ballFrom.copy(this.ball.position);
    if (this.breachTime > 0) {
      this.stepBreach(dt);
      this.ballPreWall.copy(this.ball.position);
      this.noteShellProximity();
      return;
    }
    if (this.ball.arc) {
      const scripted = this.advanceArc(dt);
      this.ballPreWall.copy(this.ball.position);
      if (scripted) return;
      // A shot that has reached the net should not take a free-flight step back out of it.
      if (inGoalPocket(this.ball.position) || segmentScores(this.ballFrom, this.ball.position) !== null) return;
    }

    if (this.ball.possession === 'held' && this.ball.ownerId !== null) {
      const owner = this.players[this.ball.ownerId];
      if (!owner) return;
      if (this.carryPalm.has(owner.id)) {
        // The view writes the palm after the pose. Stick to it, easing in for
        // the first fraction of a second so a catch does not pop.
        this.carryBlend = Math.min(1, this.carryBlend + dt / CARRY_BLEND_SECONDS);
        this.stickBallToHand(owner);
        return;
      }
      this.carryBlend = 1;
      if (this.shotAim.active && owner.id === this.humanId) {
        // The carry lag is enough to leave the ball hanging in the water
        // while the body coasts. During an aim it stays on the hold point.
        this.stickBallToHand(owner);
        return;
      }
      const holdTarget = this.tmp.holdTarget
        .copy(owner.position)
        .add(owner.facing.clone().multiplyScalar(BALL.holdOffset))
        .add(owner.up.clone().multiplyScalar(0.15));
      damp(this.ball.position, holdTarget, this.tunables.holdLag, dt);
      this.ball.velocity.copy(owner.velocity);
      return;
    }

    const human = this.getHuman();
    this.pullCatch(human, dt);
    this.ball.velocity.multiplyScalar(Math.exp(-this.tunables.ballDrag * dt));
    this.ball.position.addScaledVector(this.ball.velocity, dt);
    this.ballPreWall.copy(this.ball.position);
    this.resolveBallEnvironment();
    this.noteShellProximity();
  }

  /** The ball has left the sphere. It arcs out, then is thrown back in from that spot. */
  private stepBreach(dt: number): void {
    this.ball.velocity.y -= 8 * dt;
    this.ball.velocity.multiplyScalar(Math.exp(-0.65 * dt));
    this.ball.position.addScaledVector(this.ball.velocity, dt);
    this.breachTime = Math.max(0, this.breachTime - dt);
    if (this.breachTime > 0) return;
    const n = this.breachNormal;
    this.ball.position.copy(n).multiplyScalar(Math.max(2, ARENA_RADIUS - BALL.radius - 1.15));
    this.ball.velocity.copy(n).multiplyScalar(-18);
    this.ball.arc = null;
    this.ball.claimLock = Math.max(this.ball.claimLock, 0.45);
    this.splashBurst = Math.max(this.splashBurst, 16);
    this.impactPulse = 1;
    this.shellPoint.copy(n).multiplyScalar(ARENA_RADIUS);
    this.match.statusMessage = 'Throw-in';
  }

  private noteShellProximity(): void {
    const limit = ARENA_RADIUS - BALL.radius;
    const gap = limit - this.ball.position.length();
    const pocket = inGoalPocket(this.ball.position) || this.goalCelebrate > 0;
    this.nearShell = pocket || this.ball.possession === 'held' ? 0 : THREE.MathUtils.clamp(1 - gap / 3.4, 0, 1);
    if (this.breachTime > 0) this.nearShell = 1;
    if (this.ball.position.lengthSq() > 1e-4) {
      this.shellPoint.copy(this.ball.position).normalize().multiplyScalar(ARENA_RADIUS);
    }
  }

  /** Hoop, net, then the sphere. A ball already through the mouth is not bounced off the glass. */
  private resolveBallEnvironment(): void {
    if (this.ball.possession === 'held') return;
    const crossed = segmentScores(this.ballFrom, this.ball.position) !== null || inGoalPocket(this.ball.position);
    if (crossed) {
      if (inGoalPocket(this.ball.position)) containInNet(this.ball.position, this.ball.velocity);
      return;
    }
    const rim = resolveGoalRim(this.ball.position, this.ball.velocity);
    if (rim) {
      this.impactPulse = 1;
      this.splashBurst = Math.max(this.splashBurst, 12);
      this.shellPoint.copy(rim.point);
      this.match.statusMessage = 'Off the frame';
      return;
    }

    const hit = resolveSphereWall(this.ball.position, this.ball.velocity, BALL.radius, {
      escapeSpeed: this.tunables.wallEscapeSpeed,
      escapeAngle: this.tunables.wallEscapeAngle,
      allowEscape: true,
    });
    this.ball.position.copy(hit.position);
    this.ball.velocity.copy(hit.velocity);
    if (hit.escaped) {
      const dist = this.ball.position.length() || 1;
      this.breachNormal.copy(this.ball.position).multiplyScalar(1 / dist);
      this.breachPoint.copy(this.breachNormal).multiplyScalar(ARENA_RADIUS);
      this.breachTime = 0.7;
      this.impactPulse = 1;
      this.splashBurst = Math.max(this.splashBurst, 28);
      this.shellPoint.copy(this.breachPoint);
      this.match.statusMessage = 'Out of bounds';
      return;
    }
    if (hit.bounced) {
      this.impactPulse = 1;
      this.splashBurst = Math.max(this.splashBurst, 10);
      if (this.ball.position.lengthSq() > 1e-4) {
        this.shellPoint.copy(this.ball.position).normalize().multiplyScalar(ARENA_RADIUS);
      }
    }
  }

  /**
   * Step the lob. Returns true while the ball is still on the curve or its
   * goal follow-through. A sphere hit outside the net, or another swimmer,
   * drops it into free physics with the curve's tangent speed.
   */
  private advanceArc(dt: number): boolean {
    const arc = this.ball.arc;
    if (!arc) return false;
    // A catch already took the ball. Leave it in their hands instead of riding the rest of the curve.
    if (this.ball.possession === 'held') {
      this.ball.arc = null;
      return false;
    }
    if (arc.elapsed >= arc.duration && arc.carryLeft > 0 && arc.carryDir) {
      return this.stepArcCarry(arc, dt);
    }
    arc.elapsed += dt;
    const t = arc.elapsed / arc.duration;
    const receiver = arc.receiverId !== null ? this.players[arc.receiverId] : undefined;
    if (receiver?.active && t < 1) {
      const dest = this.tmp.moveWorld.copy(receiver.position).addScaledVector(receiver.up, 0.15);
      const delta = dest.sub(arc.p2);
      const follow = 1 - Math.exp(-8 * dt);
      arc.p2.addScaledVector(delta, follow);
      arc.p1.addScaledVector(delta, follow);
    }
    if (t >= 1) {
      this.ball.position.copy(arc.p2);
      quadraticVelocity(this.ball.velocity, arc.p0, arc.p1, arc.p2, 1, arc.duration);
      arc.elapsed = arc.duration;
      if (arc.carryLeft > 0 && arc.carryDir) {
        const leftover = Math.max(0, (t - 1) * arc.duration);
        return this.stepArcCarry(arc, Math.max(leftover, dt * 0.35));
      }
      this.ball.velocity.multiplyScalar(0.35);
      this.ball.arc = null;
      if (receiver?.active && this.ball.position.distanceTo(receiver.position) < 6) {
        this.deliverToTeammate(receiver);
      }
      return false;
    }
    const pos = quadraticPoint(this.tmp.holdTarget, arc.p0, arc.p1, arc.p2, t);
    quadraticVelocity(this.ball.velocity, arc.p0, arc.p1, arc.p2, t, arc.duration);
    if (receiver?.active && pos.distanceTo(receiver.position) < PLAYER.radius + BALL.radius + 0.55) {
      this.ball.position.copy(pos);
      this.deliverToTeammate(receiver);
      return false;
    }
    const limit = ARENA_RADIUS - BALL.radius;
    const outsideGlass = pos.length() > limit && !inGoalPocket(pos);
    const blocked =
      outsideGlass ||
      this.players.some((p) => {
        if (!p.active) return false;
        if (p.id === this.ball.lastOwnerId && arc.elapsed < 0.22) return false;
        if (p.id === arc.receiverId) return false;
        return p.position.distanceTo(pos) < PLAYER.radius + BALL.radius;
      });
    this.ball.position.copy(pos);
    if (blocked) {
      this.ball.arc = null;
      return false;
    }
    return true;
  }

  /** Straight follow-through after the bend, at the exit speed, into the net. */
  private stepArcCarry(arc: NonNullable<BallState['arc']>, dt: number): boolean {
    const dir = arc.carryDir;
    if (!dir || arc.carryLeft <= 0) {
      this.ball.arc = null;
      return false;
    }
    const speed = Math.max(10, arc.carrySpeed);
    const step = Math.min(arc.carryLeft, speed * Math.max(0, dt));
    this.ball.position.addScaledVector(dir, step);
    arc.carryLeft -= step;
    this.ball.velocity.copy(dir).multiplyScalar(speed);
    const inside = this.ball.position.length() <= ARENA_RADIUS - BALL.radius + 0.4 || inGoalPocket(this.ball.position);
    if (arc.carryLeft > 0.04 && inside) return true;
    this.ball.arc = null;
    return false;
  }

  private deliverToTeammate(player: PlayerState): void {
    this.ball.arc = null;
    this.ball.velocity.set(0, 0, 0);
    this.giveBall(player);
    this.stickBallToHand(player);
    this.match.statusMessage = 'Teammate caught it';
  }

  /** Sphere push-apart, then shoulder checks that connected this step. */
  private resolveBodies(dt: number): void {
    const live = this.players.filter((p) => p.active && p.role !== 'stub');
    const reach = PLAYER.radius * 2;
    const hits: { checker: PlayerState; target: PlayerState; dir: THREE.Vector3 }[] = [];
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i]!;
        const b = live[j]!;
        const ab = this.checkConnect(a, b, dt, reach);
        if (ab) hits.push(ab);
        const ba = this.checkConnect(b, a, dt, reach);
        if (ba) hits.push(ba);
      }
    }
    this.separateBodies(live, reach);
    for (const hit of hits) this.applyCheck(hit.checker, hit.target, hit.dir);
  }

  private checkConnect(
    checker: PlayerState,
    target: PlayerState,
    dt: number,
    reach: number,
  ): { checker: PlayerState; target: PlayerState; dir: THREE.Vector3 } | null {
    if (checker.burstTime <= 0) return null;
    if ((checker.checkMask & (1 << target.id)) !== 0) return null;
    if (!this.bodiesTouch(checker, target, dt, reach)) return null;
    const dir = checker.burstDir.clone();
    if (dir.lengthSq() < 1e-6) dir.copy(target.position).sub(checker.position);
    if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
    else dir.normalize();
    return { checker, target, dir };
  }

  private bodiesTouch(a: PlayerState, b: PlayerState, dt: number, reach: number): boolean {
    if (a.position.distanceTo(b.position) <= reach + 0.06) return true;
    const prev = a.position.clone().addScaledVector(a.velocity, -Math.max(0, dt));
    const ab = a.position.clone().sub(prev);
    const ab2 = ab.lengthSq();
    if (ab2 < 1e-8) return false;
    let t = b.position.clone().sub(prev).dot(ab) / ab2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    return prev.addScaledVector(ab, t).distanceTo(b.position) <= reach;
  }

  private separateBodies(live: PlayerState[], reach: number): void {
    const normal = new THREE.Vector3();
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i]!;
        const b = live[j]!;
        normal.copy(b.position).sub(a.position);
        let dist = normal.length();
        if (dist >= reach) continue;
        if (dist < 1e-5) {
          normal.set(1, 0, 0);
          dist = 1e-5;
        } else normal.multiplyScalar(1 / dist);
        const push = (reach - dist) * 0.5;
        a.position.addScaledVector(normal, -push);
        b.position.addScaledVector(normal, push);
        const rel = b.velocity.dot(normal) - a.velocity.dot(normal);
        if (rel < 0) {
          const impulse = -rel * (1 + PLAYER.checkBounce) * 0.5;
          a.velocity.addScaledVector(normal, -impulse);
          b.velocity.addScaledVector(normal, impulse);
        }
      }
    }
  }

  private applyCheck(checker: PlayerState, target: PlayerState, dir: THREE.Vector3): void {
    checker.checkMask |= 1 << target.id;
    const knock = checker.burstKnock > 0 ? checker.burstKnock : Math.max(4, this.tunables.checkKnock);
    const popSpeed = checker.burstPop > 0 ? checker.burstPop : PLAYER.checkPop;
    target.velocity.copy(dir).multiplyScalar(knock * (checker.burstStrong ? 1.15 : 1));
    target.knockTime = PLAYER.checkKnockTime;
    target.staggerTime = PLAYER.checkStagger;
    target.hitFlash = 1;
    target.hitBurst = 16;
    target.catchStance = false;
    target.catchReady = false;
    checker.hitFlash = 1;
    checker.hitBurst = 12;
    checker.velocity.addScaledVector(dir, -3.2);
    if (checker.id === this.humanId || target.id === this.humanId) this.cameraShake = 1;
    if (target.id === this.humanId && this.shotAim.active) this.clearShotAim();
    if (target.hasBall && this.ball.ownerId === target.id && Math.random() < checker.burstPopChance) {
      const fromPalm = this.carryPalm.has(target.id);
      if (fromPalm) this.stickBallToHand(target);
      this.releaseBall(dir.clone().multiplyScalar(popSpeed));
      if (!fromPalm) {
        this.ball.position.copy(target.position).addScaledVector(dir, PLAYER.radius + BALL.radius + 0.4);
      }
      this.ball.claimLock = 0.45;
      target.actionPose = 'none';
      target.actionPoseTime = 0;
    }
    this.match.statusMessage = checker.burstSpeedCap > this.tunables.lightBurstSpeed + 1 ? 'Power tackle!' : 'Shoulder check!';
  }

  private checkGoals(): void {
    if (this.match.resetTimer > 0) return;
    if (this.ball.possession === 'held') return;

    // Team 0 (blue) scores in the +Z hoop; team 1 (orange) in the -Z hoop.
    const scoringTeam =
      segmentScores(this.ballFrom, this.ballPreWall) ??
      (inGoalPocket(this.ball.position, 0) ? 0 : inGoalPocket(this.ball.position, 1) ? 1 : null);
    if (scoringTeam === null) return;
    this.match.score[scoringTeam] += 1;
    this.match.statusMessage = 'GOAL';
    this.match.resetTimer = 2.15;
    this.goalCelebrate = 2.15;
    this.goalTeam = scoringTeam;
    this.splashBurst = Math.max(this.splashBurst, 26);
    this.impactPulse = 1;
    this.releaseBall();
    this.ball.arc = null;
    // Leave the ball in the tunnel. containInNet has already caught it; it settles there.
    this.ball.velocity.multiplyScalar(0.45);
  }

  cameraZoomOut(intent: InputIntent): boolean {
    return this.isZoomOut(intent);
  }

  getCameraPose(intent: InputIntent): {
    position: THREE.Vector3;
    target: THREE.Vector3;
    up: THREE.Vector3;
    fov: number;
  } {
    const human = this.getHuman();
    const basis = this.cameraBasis();
    const zoom = this.isZoomOut(intent);
    const catch01 = this.catchFrame;
    const span = Math.max(0.25, this.tunables.shoulderOffset);
    // Catch framing is centered. The throwing shoulder only eases in once the ball is in hand.
    const shoulder01 = THREE.MathUtils.clamp(Math.abs(this.shoulderLateral) / span, 0, 1) * (1 - catch01);
    const follow = Math.max(1.5, this.tunables.camDistance);
    const catchExtra = Math.max(0, CAMERA.catchDistance - CAMERA.chaseDistance);
    const dist = zoom ? Math.max(follow, this.tunables.wideDistance) : follow + catch01 * catchExtra;
    const height =
      (zoom ? CAMERA.zoomOutHeight : this.tunables.camHeight + catch01 * (CAMERA.catchHeight - CAMERA.chaseHeight)) +
      0.3 * shoulder01;
    const shellLimit = this.tunables.camShell ? ARENA_RADIUS - CAMERA.wallClearance : ARENA_RADIUS * 8;
    const position = chaseCameraPosition(
      new THREE.Vector3(),
      human.position,
      basis.forward,
      basis.worldUp,
      dist,
      height,
      shellLimit,
      basis.right,
      this.shoulderLateral * (1 - catch01),
    );
    const pitch = this.tunables.camPitch;
    if (Math.abs(pitch) > 1e-4) {
      const offset = position.clone().sub(human.position);
      offset.applyAxisAngle(basis.right, pitch);
      const end = human.position.clone().add(offset);
      if (this.tunables.camShell) pullInsideSphere(position, human.position, end, shellLimit);
      else position.copy(end);
    }
    // On-ball aim looks down the throw. Off-ball, look just past the hands so
    // the reach and the ball in front of it share the frame.
    const shoulderAhead = THREE.MathUtils.lerp(CAMERA.lookAhead * 0.35, CAMERA.lookAhead * 2.4, shoulder01);
    const ahead = THREE.MathUtils.lerp(shoulderAhead, CAMERA.catchLookAhead, catch01);
    const target = human.position
      .clone()
      .addScaledVector(basis.forward, ahead)
      .addScaledVector(basis.worldUp, 0.4 * (1 - shoulder01 * 0.65) * (1 - catch01 * 0.75));
    if (!zoom && this.tunables.ballCam) {
      target.lerp(this.ball.position, 0.82);
    } else if (!zoom && this.tunables.lookAhead === 'move' && human.velocity.lengthSq() > 4) {
      target.addScaledVector(human.velocity.clone().normalize(), follow * 0.35);
    } else if (!zoom && this.tunables.lookAhead === 'ball') {
      const toBall = this.ball.position.clone().sub(human.position);
      const len = toBall.length();
      if (len > 0.5) target.addScaledVector(toBall, Math.min(1, (follow * 0.45) / len));
    }
    const chaseFov = THREE.MathUtils.clamp(this.tunables.camFov, 30, 110);
    return {
      position,
      target,
      // Pitched basis up, not world up. World up is parallel to the look
      // direction at the pole, and lookAt's cross product flips there.
      up: basis.up,
      fov: zoom ? chaseFov + (CAMERA.zoomOutFov - CAMERA.fov) : chaseFov,
    };
  }

  /**
   * Ease the shoulder camera and place the strafe cursor. Call once per
   * rendered frame, after look and physics, so the marker matches this picture.
   */
  updateAimPresentation(intent: InputIntent, dt: number, worldDt = dt): void {
    this.noteCatchStance(intent);
    this.strafing = intent.strafe;
    this.updateShoulder(Math.max(0, dt));
    this.updateRecenter(intent, Math.max(0, dt));
    if (this.landingMarker.pulse > 0) {
      this.landingMarker.pulse = Math.max(0, this.landingMarker.pulse - Math.max(0, worldDt) * 4.2);
    }
    this.updateLandingMarker();
    this.updateCatchBeacon();
  }

  private shotSpeedMin(): number {
    const scale = Math.max(0.2, this.tunables.throwSpeedScale);
    return Math.max(4, Math.min(this.tunables.shootSpeedMin, this.tunables.shootSpeedMax)) * scale;
  }

  private shotSpeedMax(): number {
    const scale = Math.max(0.2, this.tunables.throwSpeedScale);
    return Math.max(this.shotSpeedMin(), this.tunables.shootSpeedMax * scale);
  }

  /** Loose ball: hide while held. Arc flights point at the end of the curve. */
  private updateCatchBeacon(): void {
    if (this.ball.possession === 'held') {
      this.catchBeacon.visible = false;
      return;
    }
    this.catchBeacon.visible = true;
    if (this.ball.arc) {
      // A carried shot ends in the dome, past the shell. Leave that point alone.
      this.catchBeacon.position.copy(this.ball.arc.p2);
      if (this.ball.arc.carryLeft > 0 && this.ball.arc.carryDir) {
        this.catchBeacon.position.addScaledVector(this.ball.arc.carryDir, this.ball.arc.carryLeft);
      }
      return;
    }
    this.predictSettle(this.catchBeacon.position);
  }

  /**
   * Drag the current free velocity forward, banking off the shell, until the
   * ball is slow enough to meet. Player bumps are left out — they are not
   * something you can swim toward ahead of time.
   */
  private predictSettle(out: THREE.Vector3): void {
    const pos = this.tmp.predictPos.copy(this.ball.position);
    const vel = this.tmp.predictVel.copy(this.ball.velocity);
    if (vel.lengthSq() < 2.25) {
      out.copy(pos);
      return;
    }
    const dt = 1 / 30;
    const drag = Math.exp(-Math.max(0, this.tunables.ballDrag) * dt);
    const limit = ARENA_RADIUS - BALL.radius;
    for (let i = 0; i < 72; i++) {
      if (vel.lengthSq() < 2.25) break;
      vel.multiplyScalar(drag);
      pos.addScaledVector(vel, dt);
      const dist = pos.length();
      if (dist > limit && dist > 1e-6) {
        pos.multiplyScalar(limit / dist);
        const nx = pos.x / limit;
        const ny = pos.y / limit;
        const nz = pos.z / limit;
        const vn = vel.x * nx + vel.y * ny + vel.z * nz;
        if (vn > 0) {
          const bounce = vn * 1.62;
          vel.x -= nx * bounce;
          vel.y -= ny * bounce;
          vel.z -= nz * bounce;
        }
      }
    }
    const shell = limit - 0.15;
    if (pos.length() > shell) pos.setLength(shell);
    out.copy(pos);
  }

  private noteCatchStance(intent: InputIntent): void {
    const human = this.getHuman();
    this.catchStance = intent.strafe && !human.hasBall && !this.shotAim.active;
  }

  /**
   * +1 is the aim's right shoulder. A held ball clearly on the other side of
   * the look ray flips the camera so you sight over that hand. Empty hands,
   * and a ball sitting on the center line, stay on the right.
   */
  private shoulderSign(player: PlayerState): number {
    if (!player.hasBall || this.ball.ownerId !== player.id) return 1;
    const right = this.cameraBasis().right;
    const lateral = this.tmp.side.copy(this.ball.position).sub(player.position).dot(right);
    if (Math.abs(lateral) < 0.45) return 1;
    return Math.sign(lateral);
  }

  /** Tracks how long the mouse has been still, for auto-recenter. */
  private lookIdle = 0;

  private updateRecenter(intent: InputIntent, dt: number): void {
    if (!this.tunables.camRecenter || this.shotAim.active || this.power.capturing()) {
      this.lookIdle = 0;
      return;
    }
    const looking = Math.abs(intent.lookDelta.x) + Math.abs(intent.lookDelta.y) > 1e-5;
    if (looking) {
      this.lookIdle = 0;
      return;
    }
    this.lookIdle += dt;
    if (this.lookIdle < Math.max(0, this.tunables.camRecenterDelay)) return;
    const human = this.getHuman();
    const basis = this.cameraBasis();
    const flat = human.facing.clone().addScaledVector(basis.worldUp, -human.facing.dot(basis.worldUp));
    if (flat.lengthSq() < 1e-6) return;
    flat.normalize();
    const yawErr = Math.atan2(basis.right.dot(flat), basis.forward.dot(flat));
    const alpha = 1 - Math.exp(-4 * dt);
    this.yaw += yawErr * alpha;
    this.pitch += (0 - this.pitch) * alpha * 0.35;
  }

  private updateShoulder(dt: number): void {
    const human = this.getHuman();
    const onBallAim = this.strafing && human.hasBall && !this.catchStance;
    const desired = onBallAim ? this.shoulderSign(human) * this.tunables.shoulderOffset : 0;
    const rate = Math.max(0, this.tunables.shoulderTransition);
    const alpha = 1 - Math.exp(-rate * dt);
    this.shoulderLateral += (desired - this.shoulderLateral) * alpha;
    if (!onBallAim && Math.abs(this.shoulderLateral) < 0.01) this.shoulderLateral = 0;

    const catchAlpha = 1 - Math.exp(-Math.max(0, CAMERA.catchTransition) * dt);
    const catchTarget = this.catchStance ? 1 : 0;
    this.catchFrame += (catchTarget - this.catchFrame) * catchAlpha;
    if (catchTarget === 0 && this.catchFrame < 0.01) this.catchFrame = 0;
  }

  /** Nearest t past `minT` on a sphere. The far root is used when the ray starts inside. */
  private raySphereT(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    minT: number,
  ): number | null {
    const lx = ox - cx;
    const ly = oy - cy;
    const lz = oz - cz;
    const b = lx * dx + ly * dy + lz * dz;
    const c = lx * lx + ly * ly + lz * lz - radius * radius;
    const disc = b * b - c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    const near = -b - s;
    if (near > minT) return near;
    const far = -b + s;
    if (far > minT) return far;
    return null;
  }

  /**
   * Straight-throw point the right-click marker uses, and the point a shot
   * hold locks before the mouse bends it. Along the look from the carry pose,
   * inside the shell, and on a teammate when the ray meets one.
   */
  private placeStraightLanding(out: THREE.Vector3): number | null {
    const human = this.getHuman();
    const basis = this.cameraBasis();
    const hand = this.lookCarryPoint(human, this.tmp.holdTarget);
    const raw = this.tmp.predictPos.copy(hand).addScaledVector(basis.forward, this.maxFlightDistance());
    clampAimMarker(out, raw, hand, SHOT_ARC.minRange, this.markerLimit());
    const mate = this.teammateOnLook();
    if (!mate) return null;
    const limit = this.markerLimit();
    out.copy(mate.position).addScaledVector(mate.up, 0.15);
    if (out.length() > limit) out.setLength(limit);
    return mate.id;
  }

  private updateLandingMarker(): void {
    const human = this.getHuman();
    const holding = this.ball.possession === 'held' && this.ball.ownerId === human.id;
    if (this.shotAim.active && holding) {
      this.refreshShotTarget();
      if (this.charge.kind === 'shoot' || this.charge.kind === 'kick') this.updateChargeGhost(human);
      this.landingMarker.visible = true;
      this.landingMarker.position.copy(this.markerShown);
      this.landingMarker.lockId = this.shotAim.lockId;
      this.landingMarker.showReach = this.shotAim.lockId === null;
      return;
    }
    this.landingMarker.showReach = false;
    // Off-ball reach has no aim mark. Right-click with the ball shows the
    // straight landing point and does not build a curve.
    this.landingMarker.outOfReach = false;
    this.pullBand.visible = false;
    if (!(this.strafing && holding)) {
      this.landingMarker.visible = false;
      this.landingMarker.lockId = null;
      this.landingMarker.distance = 0;
      return;
    }
    this.landingMarker.lockId = this.placeStraightLanding(this.landingMarker.position);
    this.landingMarker.straightPosition.copy(this.landingMarker.position);
    this.landingMarker.visible = true;
    const hand = this.lookCarryPoint(human, this.tmp.predictVel);
    this.landingMarker.focusRadius = this.focusRadius(hand, this.landingMarker.position);
    this.landingMarker.distance = this.landingMarker.position.distanceTo(hand);
  }
}
