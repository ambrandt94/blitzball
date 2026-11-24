import * as THREE from 'three';
import {
  ARENA_RADIUS,
  BALL,
  CAMERA,
  GOAL,
  MATCH,
  PLAYER,
  SHOT_ARC,
} from '../game/constants';
import type {
  ActionPose,
  AimCursorKind,
  AimCursorState,
  BallState,
  ChargeState,
  InputIntent,
  MatchState,
  PlayerState,
  TeamId,
  Tunables,
} from '../game/types';
import { DummyAI } from '../ai/DummyAI';
import { TeammateAI } from '../ai/TeammateAI';
import {
  authoritativeUp,
  chaseCameraPosition,
  clampMagnitude,
  damp,
  goalCenter,
  lookBasis,
  rotateToward,
  stabilizeUp,
} from './math';
import { clampAimMarker, quadraticPoint, quadraticVelocity, shapedControl } from './shotArc';
import { constrainPlayerToSphere, resolveSphereWall } from './wallPhysics';

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
    position: pos,
    velocity: new THREE.Vector3(),
    facing,
    up: new THREE.Vector3(0, 1, 0),
    sprinting: false,
    hasBall: false,
    tackleCooldown: 0,
    reclaimGrace: 0,
    burstTime: 0,
    burstCooldown: 0,
    burstPuff: 0,
    burstDir: new THREE.Vector3(0, 0, 1),
    catchStance: false,
    active,
    actionPose: 'none',
    actionPoseTime: 0,
  };
}

export class Simulation {
  players: PlayerState[] = [];
  ball: BallState;
  match: MatchState;
  charge: ChargeState = { active: false, kind: null, amount: 0 };
  /** Ghost trail samples while charging (beginner aid) or aiming an arc. */
  chargeGhost: THREE.Vector3[] = [];
  /**
   * Live aim while shoot is held. The marker stays put until the keys or the
   * wheel move it. Mouse look is stored as a control-point bend instead of yaw.
   */
  readonly shotAim = {
    active: false,
    target: new THREE.Vector3(),
    /** Control-point offset along camera right, world units. */
    bendRight: 0,
    /** Control-point offset along camera up, world units. */
    bendUp: 0,
    /** Teammate the marker is stuck to, or null for a free aim. */
    lockId: null as number | null,
  };
  /** Triangle-wave phase for shot power. 0..1 fills, 1..2 empties. */
  private powerPhase = 0;
  /** Marker was steered after the hold began, so do not snap back onto a teammate. */
  private shotAimManual = false;
  /** Added to Arc aim distance by the mouse wheel. */
  private aimDistanceBias = 0;
  /** Smoothed lateral camera shift. Positive sits on the aim's right shoulder. */
  shoulderLateral = 0;
  /**
   * Where a loose ball will settle, or the end of its arc.
   * Hidden while anyone is holding the ball.
   */
  readonly catchBeacon = {
    visible: false,
    position: new THREE.Vector3(),
  };
  /** Right-click aim cursor. Hidden unless strafe is held. */
  readonly aimCursor: AimCursorState = {
    visible: false,
    kind: 'air',
    position: new THREE.Vector3(),
    team: null,
  };
  private strafing = false;
  yaw = 0;
  pitch = 0;
  zoomOutLatched = false;
  humanId = 0;
  /** Seconds remaining before play is live (kickoff / after goal). */
  kickoffLock = 0;
  private ai: DummyAI;
  private teammate: TeammateAI;
  private tmp = {
    moveWorld: new THREE.Vector3(),
    camFwd: new THREE.Vector3(),
    camRight: new THREE.Vector3(),
    camUp: new THREE.Vector3(),
    holdTarget: new THREE.Vector3(),
    aim: new THREE.Vector3(),
    faceTarget: new THREE.Vector3(),
    upHint: new THREE.Vector3(),
    side: new THREE.Vector3(),
    predictPos: new THREE.Vector3(),
    predictVel: new THREE.Vector3(),
    burstLaunch: new THREE.Vector3(),
  };

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
      const sep = MATCH.kickoffSeparation;
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
        const zSign = p.team === 0 ? -1 : 1;
        const z = zSign * MATCH.kickoffSeparation;
        const side = p.id === this.humanId ? 0 : p.team === 0 ? -MATCH.kickoffSeparation * 0.85 : 0;
        const lift = p.team === 0 && p.id !== this.humanId ? 1.5 : 0;
        p.position.set(side, lift, z + (p.id === this.humanId ? 0 : zSign * MATCH.kickoffSeparation * 0.4));
        p.velocity.set(0, 0, 0);
        p.facing.set(0, 0, p.team === 0 ? 1 : -1);
        p.up.copy(authoritativeUp(this.tunables.goalAxisUp));
        p.hasBall = false;
        p.tackleCooldown = 0;
        p.reclaimGrace = 0;
        p.burstTime = 0;
        p.burstCooldown = 0;
        p.burstPuff = 0;
        p.catchStance = false;
        p.actionPose = 'none';
        p.actionPoseTime = 0;
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
    this.powerPhase = 0;
    this.match.resetTimer = 0;
    this.kickoffLock = 2.2;
    this.match.statusMessage = 'Face-off…';
    this.orientHumanCamera();
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
    if (this.tunables.zoomHoldMode) return intent.zoomOut;
    return this.zoomOutLatched || intent.zoomOut;
  }

  step(dt: number, intent: InputIntent): void {
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
      this.ball.claimLock = 0.35;
      this.kickoffLock = 0.8;
      this.match.statusMessage = 'Ball reset';
    }

    const human = this.getHuman();
    // Look is applied once per rendered frame via applyFrameLook. Mouse deltas
    // are not per physics tick — applying them here doubled look on long frames
    // and dropped it on frames that did not step.
    // Human may always move; ball actions gated during kickoff lock.
    this.movePlayer(human, intent, dt, true);

    const live = this.kickoffLock <= 0 && this.match.resetTimer <= 0;

    for (const p of this.players) {
      if (!p.active || p.role !== 'ai') continue;
      const onDefense = p.team !== human.team;
      if (onDefense && !this.tunables.defenseActive) {
        p.velocity.set(0, 0, 0);
        continue;
      }
      if (!live) {
        p.velocity.multiplyScalar(0.9);
        continue;
      }
      if (onDefense) {
        const aiIntent = this.ai.think(p, this.ball, this.players, this.tunables);
        this.movePlayer(p, aiIntent, dt, false);
        this.resolveAiActions(p, aiIntent, dt);
      } else {
        const mateIntent = this.teammate.think(
          p,
          this.ball,
          this.players,
          this.tunables,
          human,
          intent.callForPass,
          dt,
        );
        this.movePlayer(p, mateIntent, dt, false);
        this.resolveTeammate(p, mateIntent);
      }
    }

    if (live) this.updatePossession(human, intent, dt);
    this.updateBall(dt);
    if (live) this.checkGoals();

    for (const p of this.players) {
      if (p.tackleCooldown > 0) p.tackleCooldown -= dt;
      if (p.reclaimGrace > 0) p.reclaimGrace -= dt;
      if (p.burstCooldown > 0) p.burstCooldown = Math.max(0, p.burstCooldown - dt);
      if (p.burstTime > 0) p.burstTime = Math.max(0, p.burstTime - dt);
      if (p.burstPuff > 0) p.burstPuff = Math.max(0, p.burstPuff - dt * 3.2);
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
    if (this.ball.claimLock > 0) this.ball.claimLock -= dt;

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
   * Start the shot hold before mouse look is consumed. The press and the
   * drag land in the same sample; applying look first turns the camera and
   * the arc never sees that delta.
   */
  armShotAim(intent: InputIntent): void {
    if (this.kickoffLock > 0 || this.match.resetTimer > 0) return;
    const human = this.getHuman();
    if (!human.hasBall || !intent.shootHeld) return;
    if (!this.shotAim.active) this.beginShotAim();
  }

  applyFrameLook(intent: InputIntent): void {
    const sx = this.tunables.mouseLookInvertX ? -1 : 1;
    const sy = this.tunables.mouseLookInvertY ? -1 : 1;
    // While a shot is held the view stays put so the marker doesn't swim,
    // and the same mouse deltas bend the Bezier control point instead.
    if (this.shotAim.active) {
      this.shotAim.bendRight += intent.lookDelta.x * sx * this.tunables.arcBendSpeed;
      this.shotAim.bendUp += -intent.lookDelta.y * sy * this.tunables.arcBendSpeed;
      this.clampStoredBend();
      if (this.charge.kind === 'shoot') this.updateChargeGhost(this.getHuman());
      return;
    }
    this.yaw += intent.lookDelta.x * sx;
    this.pitch -= intent.lookDelta.y * sy;
    const maxPitch = Math.PI / 2 - 0.08;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -maxPitch, maxPitch);
  }

  /** Mouse-wheel aim range. Call once per rendered frame, not per physics step. */
  nudgeAimDistance(delta: number): void {
    if (delta === 0) return;
    const before = this.aimDistanceBias;
    this.aimDistanceBias = THREE.MathUtils.clamp(this.aimDistanceBias + delta, -40, 48);
    const applied = this.aimDistanceBias - before;
    if (applied === 0 || !this.shotAim.active) return;
    this.breakShotLock();
    this.shotAim.target.addScaledVector(this.cameraBasis().forward, applied);
    this.clampShotTarget();
    if (this.charge.kind === 'shoot') this.updateChargeGhost(this.getHuman());
  }

  /** Latch zoom-out when Dev is in toggle mode. Call once per press, not per step. */
  noteZoomToggle(intent: InputIntent): void {
    if (!this.tunables.zoomHoldMode && intent.zoomTogglePressed) {
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

    const moveLocal = intent.move.clone();
    if (moveLocal.lengthSq() > 1) moveLocal.normalize();

    // Human: camera-relative stick. AI: intent.move is already a world-space wish (xyz).
    // Idle fallback: camera look for the human, the move wish for AI.
    const wish = this.tmp.moveWorld;
    const aimDir = this.tmp.faceTarget;
    if (isHuman) {
      const basis = this.cameraBasis();
      wish
        .copy(basis.right)
        .multiplyScalar(moveLocal.x)
        .add(basis.forward.clone().multiplyScalar(moveLocal.z))
        .add(basis.up.clone().multiplyScalar(intent.up));
      aimDir.copy(basis.forward);
    } else {
      wish.set(moveLocal.x, intent.up !== 0 ? intent.up : moveLocal.y, moveLocal.z);
      if (wish.lengthSq() > 1e-6) aimDir.copy(wish).normalize();
      else aimDir.copy(player.facing);
    }
    if (wish.lengthSq() > 1) wish.normalize();

    // Shot hold spends WASD on the marker. Coast to a stop instead of swimming.
    // shotAim stays active through the release frame, which is sampled with
    // the button already up, so that frame does not get a swim step either.
    const aimingShot = isHuman && player.hasBall && (intent.shootHeld || this.shotAim.active);
    if (aimingShot) wish.set(0, 0, 0);

    const canBurst =
      isHuman &&
      intent.burst &&
      !player.hasBall &&
      !aimingShot &&
      player.burstCooldown <= 0 &&
      this.kickoffLock <= 0 &&
      this.match.resetTimer <= 0;
    if (canBurst) {
      const dir = player.burstDir;
      if (wish.lengthSq() > 1e-6) dir.copy(wish).normalize();
      else if (aimDir.lengthSq() > 1e-8) dir.copy(aimDir).normalize();
      else dir.set(0, 0, 1);
      this.tmp.burstLaunch.copy(dir).multiplyScalar(Math.max(4, this.tunables.burstSpeed));
      player.velocity.lerp(this.tmp.burstLaunch, 0.88);
      player.burstTime = Math.max(0.05, this.tunables.burstDuration);
      player.burstCooldown = Math.max(0.05, this.tunables.burstCooldown);
      player.burstPuff = 1;
      this.playPose(player, 'burst', player.burstTime + 0.06);
    }

    const bursting = player.burstTime > 0 && player.burstDir.lengthSq() > 1e-6;
    if (bursting) wish.copy(player.burstDir).normalize();

    // Strafe glues facing to the camera. A shot hold does too, so the ball
    // stays in front of the chest, but it does not take the strafe speed tax.
    // A lunge ignores that tax so the catch or tackle still closes.
    const aimLocked = isHuman && intent.strafe;
    player.catchStance = aimLocked && !player.hasBall && !bursting && !aimingShot;
    player.sprinting = intent.sprint && !player.hasBall && !bursting;
    let maxSpeed = Math.max(4, this.tunables.playerMaxSpeed);
    const accel = bursting ? this.tunables.playerAccel * 1.65 : this.tunables.playerAccel;
    if (player.hasBall) maxSpeed *= PLAYER.carrierSpeedMult;
    if (player.sprinting) maxSpeed *= Math.max(1, this.tunables.sprintMult);
    if (aimLocked && !bursting) maxSpeed *= this.tunables.strafeSpeedMult;
    if (bursting) maxSpeed = Math.max(4, this.tunables.burstSpeed);

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
   * Face velocity while swimming, including pitch. Nearly still, ease back to aim.
   * `aimLocked` (right-click strafe) keeps the nose on the camera aim.
   */
  private steerBody(player: PlayerState, aim: THREE.Vector3, dt: number, aimLocked = false): void {
    const speed = player.velocity.length();
    const target = this.tmp.aim;
    target.copy(aim);
    if (target.lengthSq() < 1e-8) target.copy(player.facing);
    else target.normalize();

    if (!aimLocked && speed > 1e-4) {
      const swim = this.tmp.upHint.copy(player.velocity).normalize();
      const follow = THREE.MathUtils.smoothstep(speed, this.tunables.bodyIdleSpeed * 0.35, this.tunables.bodyIdleSpeed);
      target.lerp(swim, follow);
      if (target.lengthSq() < 1e-8) target.copy(swim);
      else target.normalize();
    }

    let rate = this.tunables.bodyTurnRate;
    if (player.hasBall) rate *= PLAYER.carrierTurnMult;
    rotateToward(player.facing, target, rate, dt);
    this.alignBodyUp(player, dt);
  }

  /** Pitch with facing. Twist eases toward world up and freezes near the pole instead of flipping. */
  private alignBodyUp(player: PlayerState, dt: number): void {
    stabilizeUp(player.up, player.facing, authoritativeUp(this.tunables.goalAxisUp), 6, dt);
  }

  private playPose(player: PlayerState, pose: ActionPose, seconds: number): void {
    player.actionPose = pose;
    player.actionPoseTime = Math.max(player.actionPoseTime, seconds);
  }

  private resolveTeammate(player: PlayerState, intent: InputIntent): void {
    if (intent.claim) this.tryClaim(player);
    if (intent.pass && player.hasBall) this.passToHuman(player);
  }

  /** Lead the human a little so the return pass is catchable. */
  private passToHuman(player: PlayerState): void {
    const human = this.getHuman();
    const aim = human.position.clone().addScaledVector(human.velocity, 0.28).sub(player.position);
    if (aim.lengthSq() < 0.25) aim.copy(player.facing);
    else aim.normalize();
    this.placeRelease(player, aim);
    const dist = Math.max(3, player.position.distanceTo(human.position));
    const passSpeed = Math.max(4, this.tunables.passSpeed);
    const speed = Math.min(passSpeed, Math.max(passSpeed * 0.45, dist * this.tunables.ballDrag * 1.25));
    this.releaseBall(aim.multiplyScalar(speed).addScaledVector(player.velocity, 0.15));
    this.playPose(player, 'pass', 0.28);
    this.match.statusMessage = 'Pass back';
  }

  private resolveAiActions(player: PlayerState, intent: InputIntent, _dt: number): void {
    if (intent.claim) this.tryClaim(player);
    if (!player.hasBall) return;
    // Dummy AI fires a medium shot without sharing the human charge meter.
    if (intent.shoot || (!intent.shootHeld && Math.random() < 0.0)) {
      this.releaseShot(player, 0.55 + Math.random() * 0.35);
    } else if (intent.pass) {
      this.releasePass(player, 0.55);
    }
  }

  private updatePossession(human: PlayerState, intent: InputIntent, dt: number): void {
    // Charge shoot / pass for human
    if (human.hasBall) {
      if (intent.drop) {
        this.clearShotAim();
        const toss = this.lookForward(human);
        this.placeRelease(human, toss);
        this.releaseBall(toss.multiplyScalar(4).add(human.velocity));
        human.reclaimGrace = PLAYER.reclaimCoyote;
        this.match.statusMessage = 'Ball dropped';
      } else if (intent.shootHeld) {
        // Snap before placing the marker or the preview, so both start in the hand.
        if (!this.shotAim.active) this.beginShotAim();
        this.stickBallToHand(human);
        this.slideShotTarget(intent, dt);
        this.acquireTeammate();
        this.charge.active = true;
        this.charge.kind = 'shoot';
        this.advanceShotPower(dt);
        // Stay in the carry pose. A shoot windup pulls the arms off the ball.
        human.actionPose = 'hold';
        human.actionPoseTime = 0;
        this.updateChargeGhost(human);
        this.match.statusMessage = this.shotAim.lockId !== null
          ? 'Teammate locked — mouse bends the arc, release throws'
          : 'Aiming — power cycles, WASD moves the marker, mouse bends the arc';
      } else if (this.charge.active && this.charge.kind === 'shoot') {
        this.releaseShot(human, this.charge.amount);
        this.charge = { active: false, kind: null, amount: 0 };
        this.chargeGhost = [];
      } else if (intent.passHeld && !intent.shootHeld) {
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
      }
    } else {
      if (this.shotAim.active || this.charge.active) this.clearShotAim();
      if (intent.claim) this.tryClaim(human);
    }

    // Auto-claim attempt when very close and facing (soft, not vacuum)
    if (!human.hasBall && this.ball.possession === 'free' && this.ball.claimLock <= 0) {
      if (this.canClaim(human)) {
        // Soft magnetic help only when already nearly claiming
        const dist = human.position.distanceTo(this.ball.position);
        if (dist < this.tunables.claimRadius * 0.55) this.tryClaim(human);
      }
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
        if (dist < PLAYER.claimRadius * 1.1 && intent.claim) {
          const toOwner = owner.position.clone().sub(human.position).normalize();
          if (this.lookForward(human).dot(toOwner) > 0.2) {
            this.stripBall(human, owner);
            human.tackleCooldown = PLAYER.tackleCooldown;
          }
        }
      }
    }
  }

  private canClaim(player: PlayerState): boolean {
    if (this.ball.claimLock > 0) return false;
    if (player.reclaimGrace > 0 && this.ball.lastOwnerId === player.id) return false;
    const dist = player.position.distanceTo(this.ball.position);
    if (dist > this.tunables.claimRadius) return false;
    const toBall = this.ball.position.clone().sub(player.position);
    if (toBall.lengthSq() < 1e-6) return true;
    toBall.normalize();
    return this.lookForward(player).dot(toBall) >= PLAYER.claimFacingDot;
  }

  /** Where this player is aiming. Humans aim with the camera, even before the body catches up. */
  private lookForward(player: PlayerState): THREE.Vector3 {
    if (player.role === 'human') return this.cameraBasis().forward.clone();
    return player.facing.clone();
  }

  private tryClaim(player: PlayerState): void {
    if (this.ball.possession === 'held' && this.ball.ownerId !== player.id) return;
    if (!this.canClaim(player)) return;
    this.giveBall(player);
    this.match.statusMessage =
      player.role === 'human'
        ? 'You have the ball'
        : player.team === this.getHuman().team
          ? 'Teammate has the ball'
          : 'AI claimed the ball';
  }

  private giveBall(player: PlayerState): void {
    for (const p of this.players) {
      if (!p.hasBall) continue;
      p.hasBall = false;
      if (p.actionPose === 'hold') p.actionPose = 'none';
    }
    player.hasBall = true;
    this.ball.possession = 'held';
    this.ball.ownerId = player.id;
    this.ball.lastOwnerId = player.id;
    this.ball.velocity.set(0, 0, 0);
    this.playPose(player, 'claim', 0.34);
  }

  private stripBall(tacker: PlayerState, owner: PlayerState): void {
    owner.hasBall = false;
    owner.reclaimGrace = PLAYER.reclaimCoyote;
    this.giveBall(tacker);
    this.ball.claimLock = 0.05;
    this.match.statusMessage = 'Strip!';
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
    this.powerPhase = 0;
    this.charge = { active: false, kind: null, amount: 0 };
    this.chargeGhost = [];
  }

  /** Empty → full → empty while the shot button is held. Release keeps the current value. */
  private advanceShotPower(dt: number): void {
    const rate = Math.max(0, this.tunables.shotPowerRate);
    this.powerPhase = (this.powerPhase + dt * rate) % 2;
    this.charge.amount = this.powerPhase <= 1 ? this.powerPhase : 2 - this.powerPhase;
  }

  private aimDistance(): number {
    return THREE.MathUtils.clamp(
      this.tunables.arcAimDistance + this.aimDistanceBias,
      SHOT_ARC.minRange,
      ARENA_RADIUS - BALL.radius - 0.5,
    );
  }

  private markerLimit(): number {
    return ARENA_RADIUS - BALL.radius - 0.3;
  }

  /**
   * Place the marker and the default hand-side curve on this frame.
   * The body snaps to the camera so the ball does not swing into the pose.
   */
  private beginShotAim(): void {
    const human = this.getHuman();
    const basis = this.cameraBasis();
    human.facing.copy(basis.forward);
    human.up.copy(basis.up);
    this.stickBallToHand(human);
    this.shotAim.active = true;
    this.shotAim.bendRight = 0;
    this.shotAim.bendUp = 0;
    this.shotAim.lockId = null;
    this.shotAimManual = false;
    this.powerPhase = 0;
    this.charge.active = true;
    this.charge.kind = 'shoot';
    this.charge.amount = 0;
    const raw = this.tmp.holdTarget.copy(this.ball.position).addScaledVector(basis.forward, this.aimDistance());
    this.clampShotTarget(raw);
  }

  private breakShotLock(): void {
    this.shotAimManual = true;
    this.shotAim.lockId = null;
  }

  /**
   * Slide the marker on the view plane. A/D strafe it. W/S raise and lower it
   * (not forward/back). Space/C do the same vertical slide. The wheel owns range.
   */
  private slideShotTarget(intent: InputIntent, dt: number): void {
    const basis = this.cameraBasis();
    const wish = this.tmp.moveWorld
      .copy(basis.right)
      .multiplyScalar(intent.move.x)
      .addScaledVector(basis.up, intent.move.z + intent.up);
    if (wish.lengthSq() > 1) wish.normalize();
    if (wish.lengthSq() > 1e-8) {
      this.breakShotLock();
      this.shotAim.target.addScaledVector(wish, Math.max(0, this.tunables.arcAimSpeed) * dt);
    }
    if (this.shotAim.lockId === null) this.clampShotTarget();
  }

  /** Snap the marker onto a teammate standing on the look ray. Steering the marker lets go. */
  private acquireTeammate(): void {
    if (!this.shotAim.active || this.shotAimManual) return;
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
    const human = this.getHuman();
    const origin = human.position;
    const dir = this.cameraBasis().forward;
    if (dir.lengthSq() < 1e-8) return null;
    const pad = PLAYER.radius + Math.max(0, this.tunables.teammateLockRadius);
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

  private clampShotTarget(from?: THREE.Vector3): void {
    clampAimMarker(
      this.shotAim.target,
      from ?? this.shotAim.target,
      this.ball.position,
      SHOT_ARC.minRange,
      this.markerLimit(),
    );
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

  /** Bezier that would fly if the shot were released at the current charge. */
  private plannedArc(charge: number): { p0: THREE.Vector3; p1: THREE.Vector3; p2: THREE.Vector3; duration: number } {
    const limit = this.markerLimit();
    const p0 = this.ball.position.clone();
    if (p0.length() > limit) p0.setLength(limit);
    const p2 = this.shotAim.target.clone();
    const power = THREE.MathUtils.clamp(charge, 0, 1);
    // Hand curve and resting height are full on the first frame. Power only
    // adds a small loft on top, so the preview does not ease in from a tall lob.
    const height = Math.max(0, this.tunables.arcHeight + this.tunables.shotPowerAngle * power);
    const basis = this.cameraBasis();
    const p1 = shapedControl(
      new THREE.Vector3(),
      p0,
      p2,
      basis.right,
      basis.up,
      height,
      this.shotAim.bendRight,
      this.shotAim.bendUp,
      this.tunables.arcBendLimit,
      limit,
      this.tunables.arcHandCurve,
    );
    const straight = Math.max(0.5, p0.distanceTo(p2));
    const via = p0.distanceTo(p1) + p1.distanceTo(p2);
    const length = Math.max(straight, (straight + via) * 0.5);
    const speed = THREE.MathUtils.lerp(this.shotSpeedMin(), this.shotSpeedMax(), charge);
    const duration = Math.max(SHOT_ARC.minDuration, length / speed);
    return { p0, p1, p2, duration };
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

  private releaseShot(player: PlayerState, charge: number): void {
    if (player.role === 'human') {
      this.releaseArcShot(player, charge);
      return;
    }
    const aim = this.getAimDirection(player, false);
    this.placeRelease(player, aim);
    const speed = THREE.MathUtils.lerp(this.shotSpeedMin(), this.shotSpeedMax(), charge);
    const impulse = aim.clone().multiplyScalar(speed).add(player.velocity.clone().multiplyScalar(0.35));
    this.releaseBall(impulse);
    this.playPose(player, 'shoot', 0.3);
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
    const arc = this.plannedArc(charge);
    this.releaseBall();
    this.ball.position.copy(arc.p0);
    this.ball.arc = {
      p0: arc.p0,
      p1: arc.p1,
      p2: arc.p2,
      elapsed: 0,
      duration: arc.duration,
      receiverId: this.shotAim.lockId,
    };
    quadraticVelocity(this.ball.velocity, arc.p0, arc.p1, arc.p2, 0, arc.duration);
    const thrownToMate = this.shotAim.lockId !== null;
    this.shotAim.active = false;
    this.shotAim.bendRight = 0;
    this.shotAim.bendUp = 0;
    this.shotAim.lockId = null;
    this.shotAimManual = false;
    this.powerPhase = 0;
    this.playPose(player, 'shoot', 0.3);
    this.match.statusMessage = thrownToMate ? 'Throw to teammate' : charge > 0.7 ? 'High power!' : 'Arc shot';
  }

  /** Carry point: in front of the chest, along facing. No lag. */
  private stickBallToHand(owner: PlayerState): void {
    this.ball.position
      .copy(owner.position)
      .addScaledVector(owner.facing, BALL.holdOffset)
      .addScaledVector(owner.up, 0.15);
    this.ball.velocity.copy(owner.velocity);
  }

  /** Put a released ball just outside the body along `aim` so the carrier doesn't block it. */
  private placeRelease(player: PlayerState, aim: THREE.Vector3): void {
    const gap = PLAYER.radius + BALL.radius + 0.2;
    this.ball.position.copy(player.position).addScaledVector(aim, gap);
  }

  private releasePass(player: PlayerState, charge: number): void {
    const isHuman = player.role === 'human';
    let aim = this.getAimDirection(player, isHuman).clone();
    // Prefer teammate in cone
    let best: PlayerState | null = null;
    let bestDot = 0.55;
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
    if (best) aim = best.position.clone().sub(player.position).normalize();
    this.placeRelease(player, aim);
    const speed = Math.max(4, this.tunables.passSpeed) * (0.65 + 0.35 * charge);
    this.releaseBall(aim.clone().multiplyScalar(speed).add(player.velocity.clone().multiplyScalar(0.25)));
    this.playPose(player, 'pass', 0.28);
    this.match.statusMessage = best ? 'Pass' : 'Pass (no target)';
  }

  private updateChargeGhost(player: PlayerState): void {
    if (!this.tunables.showChargeGhost) {
      this.chargeGhost = [];
      return;
    }
    if (this.charge.kind === 'shoot' && this.shotAim.active) {
      const arc = this.plannedArc(this.charge.amount);
      const samples: THREE.Vector3[] = [];
      const point = new THREE.Vector3();
      for (let i = 0; i <= SHOT_ARC.samples; i++) {
        quadraticPoint(point, arc.p0, arc.p1, arc.p2, i / SHOT_ARC.samples);
        samples.push(point.clone());
      }
      this.chargeGhost = samples;
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
    if (this.ball.arc) {
      const scripted = this.advanceArc(dt);
      if (scripted) return;
    }

    if (this.ball.possession === 'held' && this.ball.ownerId !== null) {
      const owner = this.players[this.ball.ownerId];
      if (!owner) return;
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

    this.ball.velocity.multiplyScalar(Math.exp(-this.tunables.ballDrag * dt));
    this.ball.position.addScaledVector(this.ball.velocity, dt);

    const hit = resolveSphereWall(this.ball.position, this.ball.velocity, BALL.radius, {
      escapeSpeed: this.tunables.wallEscapeSpeed,
      escapeAngle: this.tunables.wallEscapeAngle,
      allowEscape: true,
    });
    this.ball.position.copy(hit.position);
    this.ball.velocity.copy(hit.velocity);
    if (hit.escaped) {
      this.match.statusMessage = 'Ball flew out — reset';
      this.match.resetTimer = MATCH.resetDelay;
      this.ball.velocity.set(0, 0, 0);
      this.ball.position.set(0, 0, 0);
    }

    // Soft player bump when free
    for (const p of this.players) {
      if (!p.active) continue;
      const sep = PLAYER.radius + BALL.radius;
      const delta = this.ball.position.clone().sub(p.position);
      const dist = delta.length();
      if (dist < sep && dist > 1e-5) {
        const n = delta.multiplyScalar(1 / dist);
        this.ball.position.copy(p.position).addScaledVector(n, sep);
        const vn = this.ball.velocity.dot(n) - p.velocity.dot(n);
        if (vn < 0) {
          this.ball.velocity.addScaledVector(n, -vn * 1.2);
        }
      }
    }
  }

  /**
   * Step the lob. Returns true while the ball is still on the curve.
   * A sphere hit or another swimmer drops it into free physics with the
   * curve's tangent speed, so banks and catches still work.
   */
  private advanceArc(dt: number): boolean {
    const arc = this.ball.arc;
    if (!arc) return false;
    // A catch already took the ball. Leave it in their hands instead of riding the rest of the curve.
    if (this.ball.possession === 'held') {
      this.ball.arc = null;
      return false;
    }
    arc.elapsed += dt;
    const t = arc.elapsed / arc.duration;
    const receiver = arc.receiverId !== null ? this.players[arc.receiverId] : undefined;
    if (receiver?.active) {
      const dest = this.tmp.moveWorld.copy(receiver.position).addScaledVector(receiver.up, 0.15);
      const delta = dest.sub(arc.p2);
      const follow = 1 - Math.exp(-8 * dt);
      arc.p2.addScaledVector(delta, follow);
      arc.p1.addScaledVector(delta, follow);
    }
    if (t >= 1) {
      this.ball.position.copy(arc.p2);
      quadraticVelocity(this.ball.velocity, arc.p0, arc.p1, arc.p2, 1, arc.duration).multiplyScalar(0.35);
      this.ball.arc = null;
      if (receiver?.active && this.ball.position.distanceTo(receiver.position) < 6) {
        this.deliverToTeammate(receiver);
      }
      return false;
    }
    const pos = quadraticPoint(this.tmp.holdTarget, arc.p0, arc.p1, arc.p2, t);
    const vel = quadraticVelocity(this.tmp.aim, arc.p0, arc.p1, arc.p2, t, arc.duration);
    if (receiver?.active && pos.distanceTo(receiver.position) < PLAYER.radius + BALL.radius + 0.55) {
      this.ball.position.copy(pos);
      this.deliverToTeammate(receiver);
      return false;
    }
    const limit = ARENA_RADIUS - BALL.radius;
    const blocked =
      pos.length() > limit ||
      this.players.some((p) => {
        if (!p.active) return false;
        if (p.id === this.ball.lastOwnerId && arc.elapsed < 0.22) return false;
        if (p.id === arc.receiverId) return false;
        return p.position.distanceTo(pos) < PLAYER.radius + BALL.radius;
      });
    this.ball.position.copy(pos);
    this.ball.velocity.copy(vel);
    if (blocked) {
      this.ball.arc = null;
      return false;
    }
    return true;
  }

  private deliverToTeammate(player: PlayerState): void {
    this.ball.arc = null;
    this.ball.velocity.set(0, 0, 0);
    this.giveBall(player);
    this.stickBallToHand(player);
    this.match.statusMessage = 'Teammate caught it';
  }

  private checkGoals(): void {
    if (this.match.resetTimer > 0) return;
    if (this.ball.possession === 'held') return;

    // Team 0 (blue) scores in +Z goal; team 1 (orange) in -Z. Strict rim = hit volume.
    for (const scoringTeam of [0, 1] as const) {
      const goalZ = scoringTeam === 0 ? GOAL.distance : -GOAL.distance;
      const radial = Math.hypot(this.ball.position.x, this.ball.position.y);
      const zOk =
        scoringTeam === 0
          ? this.ball.position.z > goalZ - GOAL.depth && this.ball.position.z < goalZ + 0.5
          : this.ball.position.z < goalZ + GOAL.depth && this.ball.position.z > goalZ - 0.5;
      if (zOk && radial <= GOAL.rimRadius) {
        this.match.score[scoringTeam] += 1;
        this.match.statusMessage = scoringTeam === 0 ? 'Blue scores!' : 'Orange scores!';
        this.match.resetTimer = MATCH.resetDelay;
        this.releaseBall();
        this.ball.velocity.set(0, 0, 0);
        this.ball.position.set(0, 0, 0);
        break;
      }
    }
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
    const span = Math.max(0.25, this.tunables.shoulderOffset);
    const shoulder01 = THREE.MathUtils.clamp(Math.abs(this.shoulderLateral) / span, 0, 1);
    const dist = zoom ? CAMERA.zoomOutDistance : CAMERA.chaseDistance;
    // A little extra height as the camera slides onto the shoulder.
    const height = (zoom ? CAMERA.zoomOutHeight : CAMERA.chaseHeight) + 0.3 * shoulder01;
    const position = chaseCameraPosition(
      new THREE.Vector3(),
      human.position,
      basis.forward,
      basis.worldUp,
      dist,
      height,
      ARENA_RADIUS - CAMERA.wallClearance,
      basis.right,
      this.shoulderLateral,
    );
    // Look further down the aim ray once the camera is off to the side, so the
    // swimmer sits on the opposite edge and the look ray stays near center.
    const ahead = THREE.MathUtils.lerp(CAMERA.lookAhead * 0.35, CAMERA.lookAhead * 2.4, shoulder01);
    const target = human.position
      .clone()
      .addScaledVector(basis.forward, ahead)
      .addScaledVector(basis.worldUp, 0.4 * (1 - shoulder01 * 0.65));
    return {
      position,
      target,
      // Pitched basis up, not world up. World up is parallel to the look
      // direction at the pole, and lookAt's cross product flips there.
      up: basis.up,
      fov: zoom ? CAMERA.zoomOutFov : CAMERA.fov,
    };
  }

  /**
   * Ease the shoulder camera and place the strafe cursor. Call once per
   * rendered frame, after look and physics, so the marker matches this picture.
   */
  updateAimPresentation(intent: InputIntent, dt: number): void {
    this.strafing = intent.strafe;
    this.updateShoulder(Math.max(0, dt));
    this.updateAimCursor();
    this.updateCatchBeacon();
  }

  private shotSpeedMin(): number {
    return Math.max(4, Math.min(this.tunables.shootSpeedMin, this.tunables.shootSpeedMax));
  }

  private shotSpeedMax(): number {
    return Math.max(this.shotSpeedMin(), this.tunables.shootSpeedMax);
  }

  /** Loose ball: hide while held. Arc flights point at the end of the curve. */
  private updateCatchBeacon(): void {
    if (this.ball.possession === 'held') {
      this.catchBeacon.visible = false;
      return;
    }
    this.catchBeacon.visible = true;
    if (this.ball.arc) {
      this.catchBeacon.position.copy(this.ball.arc.p2);
      const shell = ARENA_RADIUS - BALL.radius - 0.15;
      if (this.catchBeacon.position.length() > shell) this.catchBeacon.position.setLength(shell);
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

  private updateShoulder(dt: number): void {
    const desired = this.strafing ? this.shoulderSign(this.getHuman()) * this.tunables.shoulderOffset : 0;
    const rate = Math.max(0, this.tunables.shoulderTransition);
    const alpha = 1 - Math.exp(-rate * dt);
    this.shoulderLateral += (desired - this.shoulderLateral) * alpha;
    if (!this.strafing && Math.abs(this.shoulderLateral) < 0.01) this.shoulderLateral = 0;
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

  private updateAimCursor(): void {
    // The reticle stays up through a shot hold so a teammate under it reads as locked.
    if (!this.strafing && !this.shotAim.active) {
      this.aimCursor.visible = false;
      return;
    }

    const human = this.getHuman();
    const origin = this.tmp.side.copy(human.position);
    const dir = this.tmp.aim.copy(this.cameraBasis().forward);
    if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
    else dir.normalize();

    const ox = origin.x;
    const oy = origin.y;
    const oz = origin.z;
    const dx = dir.x;
    const dy = dir.y;
    const dz = dir.z;

    let bestT = Infinity;
    let kind: AimCursorKind = 'air';
    let team: TeamId | null = null;
    const consider = (t: number | null, nextKind: AimCursorKind, nextTeam: TeamId | null): void => {
      if (t === null || t >= bestT) return;
      bestT = t;
      kind = nextKind;
      team = nextTeam;
    };

    for (const p of this.players) {
      if (!p.active || p.role === 'stub' || p.id === human.id) continue;
      consider(
        this.raySphereT(ox, oy, oz, dx, dy, dz, p.position.x, p.position.y, p.position.z, PLAYER.radius + 0.12, 0.45),
        'player',
        p.team,
      );
    }

    const holding = this.ball.possession === 'held' && this.ball.ownerId === human.id;
    if (!holding) {
      consider(
        this.raySphereT(
          ox,
          oy,
          oz,
          dx,
          dy,
          dz,
          this.ball.position.x,
          this.ball.position.y,
          this.ball.position.z,
          BALL.radius + 0.1,
          0.45,
        ),
        'ball',
        null,
      );
    }

    const mouth = GOAL.rimRadius + 0.35;
    for (const scoringTeam of [0, 1] as const) {
      const goalZ = scoringTeam === 0 ? GOAL.distance : -GOAL.distance;
      if (Math.abs(dz) < 1e-5) continue;
      const t = (goalZ - oz) / dz;
      if (t <= 0.45) continue;
      const x = ox + dx * t;
      const y = oy + dy * t;
      if (x * x + y * y <= mouth * mouth) consider(t, 'goal', scoringTeam);
    }

    // Shell sits just inside the glass so the marker is not buried in the wall.
    const wallT = this.raySphereT(ox, oy, oz, dx, dy, dz, 0, 0, 0, ARENA_RADIUS - 0.45, 0.02);
    const cursorDist = THREE.MathUtils.clamp(this.tunables.aimCursorDistance, 4, ARENA_RADIUS - 1);

    let t: number;
    if (Number.isFinite(bestT) && (wallT === null || bestT <= wallT + 0.02)) {
      t = bestT;
    } else if (wallT !== null && wallT <= cursorDist) {
      t = wallT;
      kind = 'wall';
      team = null;
    } else {
      t = wallT !== null ? Math.min(cursorDist, wallT) : cursorDist;
      kind = 'air';
      team = null;
    }

    const point = this.aimCursor.position.copy(origin).addScaledVector(dir, t);
    const limit = ARENA_RADIUS - 0.4;
    if (point.length() > limit) {
      point.setLength(limit);
      if (kind === 'air') kind = 'wall';
    }
    this.aimCursor.visible = true;
    this.aimCursor.kind = kind;
    this.aimCursor.team = team;
  }
}
