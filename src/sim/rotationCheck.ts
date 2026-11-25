/**
 * Headless checks for the rotation snaps. Run with:
 *   npx tsx src/sim/rotationCheck.ts
 */
import * as THREE from 'three';
import { ARENA_RADIUS, BALL, CAMERA, GOAL, PLAYER, ROSTER, SHOT_ARC, setArenaRadius } from '../game/constants';
import type { InputIntent } from '../game/types';
import { PrimaryClickGate } from '../input/primaryClickGate';
import { fitBallModel } from '../render/blitzball';
import { aimPosturePitch, spring1, stepAimPosture, updateSwimmerRig, wantsAimPosture, type SwimmerRig } from '../render/swimmerModel';
import { blendLimbPose, swimLimbPose } from '../render/limbs';
import { sampleThrowPose, throwPoseSeconds } from '../render/throwPose';
import { defaultTunables } from '../ui/DevPanel';
import { applyCameraPreset, cameraSettingsBlob, noteCameraEdit, parseCameraSettings } from '../ui/cameraSettings';
import { parseRoster } from '../ui/rosterStorage';
import { matchRoster } from '../ui/matchPresets';
import { Simulation } from './Simulation';
import { goalCornerWorld, goalFrameCurve, goalMouthVertex, goalMouthZ, goalPlaneZ, inGoalPocket, pointInGoalMouth, resolveGoalRim, segmentScores } from './goal';
import { lookBasis, rotateToward, stabilizeUp, transportUp } from './math';
import { arcControl, clampAimMarker, quadraticPoint, shapedControl } from './shotArc';
import { constrainPlayerToSphere, resolveSphereWall } from './wallPhysics';

function fail(message: string): never {
  throw new Error(message);
}

function deg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function angle(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
}

function blankIntent(zoom = false): InputIntent {
  return {
    move: new THREE.Vector3(),
    lookDelta: { x: 0, y: 0 },
    up: 0,
    sprint: false,
    strafe: false,
    claim: false,
    drop: false,
    pass: false,
    shoot: false,
    shootHeld: false,
    kick: false,
    kickHeld: false,
    burstPower: false,
    aimCancel: false,
    burst: false,
    passHeld: false,
    zoomOut: zoom,
    zoomTogglePressed: false,
    middleZoomPressed: false,
    resetBall: false,
    toggleDev: false,
    aimRangeDelta: 0,
    callForPass: false,
  };
}

function viewAxes(position: THREE.Vector3, target: THREE.Vector3, up: THREE.Vector3): {
  forward: THREE.Vector3;
  right: THREE.Vector3;
} {
  const m = new THREE.Matrix4().lookAt(position, target, up);
  return {
    right: new THREE.Vector3(m.elements[0], m.elements[1], m.elements[2]),
    forward: new THREE.Vector3(-m.elements[8], -m.elements[9], -m.elements[10]),
  };
}

function checkRotateToward(): void {
  const facing = new THREE.Vector3(0, 0, 1);
  const dt = 1 / 60;
  let maxStep = 0;
  for (let i = 1; i <= 720; i++) {
    const a = (i / 720) * Math.PI * 2;
    const target = new THREE.Vector3(Math.sin(a), 0.15 * Math.sin(a * 2), Math.cos(a)).normalize();
    const before = facing.clone();
    const sep = angle(before, target);
    rotateToward(facing, target, 7, dt);
    const step = angle(before, facing);
    maxStep = Math.max(maxStep, step);
    if (step > sep + 0.02) {
      fail(`rotateToward left the short arc (step ${deg(step).toFixed(2)}°, separation ${deg(sep).toFixed(2)}°)`);
    }
  }
  if (maxStep > (3 * Math.PI) / 180) fail(`full-turn facing step ${deg(maxStep).toFixed(2)}°`);

  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const eps = 0.03;
    const current = new THREE.Vector3(Math.cos(a) * eps, Math.sin(a) * eps, -1).normalize();
    const target = new THREE.Vector3(Math.cos(a + 0.5) * eps, Math.sin(a + 0.5) * eps, -1).normalize();
    const before = current.clone();
    const sep = angle(before, target);
    rotateToward(current, target, 7, dt);
    const step = angle(before, current);
    if (step > sep + 0.02) fail('antipodal pair left the short arc');
    if (step > (3 * Math.PI) / 180) fail(`antipode step ${deg(step).toFixed(2)}°`);
  }
}

function checkUpPole(): void {
  const up = new THREE.Vector3(0, 1, 0);
  const facing = new THREE.Vector3();
  const world = new THREE.Vector3(0, 1, 0);
  let maxStep = 0;
  for (let i = 0; i <= 180; i++) {
    const a = (i / 180) * Math.PI;
    facing.set(0, Math.sin(a), Math.cos(a));
    const before = up.clone();
    stabilizeUp(up, facing, world, 6, 1 / 60);
    const step = angle(before, up);
    if (!Number.isFinite(step)) fail('up vector collapsed at the pole');
    maxStep = Math.max(maxStep, step);
  }
  if (maxStep > (8 * Math.PI) / 180) fail(`body up snapped ${deg(maxStep).toFixed(1)}° crossing the pole`);
}

/**
 * Pitch through straight up, straight down, and inverted, in open water and
 * against the shell. A frame whose look or body up jumps more than a few
 * degrees is the disorienting snap.
 */
function checkVerticalLook(): void {
  const spots = [
    new THREE.Vector3(0, 0, 12),
    new THREE.Vector3(0, 0, ARENA_RADIUS - PLAYER.radius - 0.4),
    new THREE.Vector3(0, ARENA_RADIUS - PLAYER.radius - 0.4, 2),
  ];
  for (const spot of spots) {
    const sim = new Simulation(defaultTunables());
    sim.kickoffLock = 0;
    sim.tunables.camPitch = -0.18;
    sim.tunables.camRecenter = false;
    const human = sim.getHuman();
    human.position.copy(spot);
    let prevLook: THREE.Vector3 | null = null;
    let prevRight: THREE.Vector3 | null = null;
    let maxLook = 0;
    let maxRight = 0;
    for (let i = -130; i <= 130; i++) {
      sim.pitch = (i * Math.PI) / 180;
      sim.yaw = 0.4;
      const pose = sim.getCameraPose(blankIntent());
      const look = pose.target.clone().sub(pose.position);
      if (look.lengthSq() < 1e-8) fail(`camera sat on its target at pitch ${i}`);
      look.normalize();
      const back = pose.position.clone().sub(pose.target).normalize();
      const right = new THREE.Vector3().crossVectors(pose.up, back);
      if (right.lengthSq() < 1e-8) fail(`camera up parallel to the view at pitch ${i}`);
      right.normalize();
      if (pose.position.length() > ARENA_RADIUS - CAMERA.wallClearance + 0.08) {
        fail(`camera left the shell at pitch ${i} (${pose.position.length().toFixed(2)})`);
      }
      if (prevLook && prevRight) {
        maxLook = Math.max(maxLook, angle(prevLook, look));
        maxRight = Math.max(maxRight, angle(prevRight, right));
      }
      prevLook = look;
      prevRight = right;
    }
    const where = `r=${spot.length().toFixed(1)}`;
    if (maxLook > (4 * Math.PI) / 180) {
      fail(`look jumped ${deg(maxLook).toFixed(2)}° per 1° of pitch (${where})`);
    }
    if (maxRight > (8 * Math.PI) / 180) {
      fail(`horizon rolled ${deg(maxRight).toFixed(2)}° per 1° of pitch (${where})`);
    }
  }

  const up = new THREE.Vector3(0, 1, 0);
  const facing = new THREE.Vector3(0, 0, 1);
  let maxTransport = 0;
  for (let i = 0; i <= 220; i++) {
    const a = (i / 180) * Math.PI;
    const next = new THREE.Vector3(0, Math.sin(a), Math.cos(a));
    const before = up.clone();
    transportUp(up, facing, next);
    facing.copy(next);
    maxTransport = Math.max(maxTransport, angle(before, up));
  }
  if (maxTransport > (4 * Math.PI) / 180) {
    fail(`transported up snapped ${deg(maxTransport).toFixed(2)}° through inverted flight`);
  }

  for (const start of [new THREE.Vector3(0, 2, 8), new THREE.Vector3(0, 4, ARENA_RADIUS - PLAYER.radius - 1.2)]) {
    const sim = new Simulation(defaultTunables());
    sim.kickoffLock = 0;
    sim.tunables.camRecenter = false;
    const human = sim.getHuman();
    human.position.copy(start);
    human.velocity.set(0, 0, 0);
    human.facing.set(0, 0, 1);
    human.up.set(0, 1, 0);
    sim.yaw = 0;
    sim.pitch = 0;
    const intent = blankIntent();
    intent.move.set(0, 0, 1);
    let prevF = human.facing.clone();
    let prevU = human.up.clone();
    let prevLook: THREE.Vector3 | null = null;
    let maxF = 0;
    let maxU = 0;
    let maxL = 0;
    for (let i = 0; i < 220; i++) {
      sim.pitch = Math.min(2.4, sim.pitch + 0.02);
      sim.step(1 / 60, intent);
      maxF = Math.max(maxF, angle(prevF, human.facing));
      maxU = Math.max(maxU, angle(prevU, human.up));
      prevF.copy(human.facing);
      prevU.copy(human.up);
      const pose = sim.getCameraPose(intent);
      const look = pose.target.clone().sub(pose.position).normalize();
      if (prevLook) maxL = Math.max(maxL, angle(prevLook, look));
      prevLook = look;
    }
    if (maxF > (20 * Math.PI) / 180) fail(`facing snapped ${deg(maxF).toFixed(1)}° swimming through vertical`);
    if (maxU > (20 * Math.PI) / 180) fail(`body up snapped ${deg(maxU).toFixed(1)}° swimming through vertical`);
    if (maxL > (20 * Math.PI) / 180) fail(`camera look snapped ${deg(maxL).toFixed(1)}° swimming through vertical`);
  }
}

function checkCamera(goalAxisUp: boolean, zoom: boolean): void {
  const sim = new Simulation(defaultTunables());
  sim.tunables.goalAxisUp = goalAxisUp;
  sim.orientAfterUpToggle();
  const human = sim.getHuman();
  const shell = ARENA_RADIUS - PLAYER.radius - 0.05;
  const spots = [new THREE.Vector3(0, 0, shell), new THREE.Vector3(0, shell, 0)];
  for (const spot of spots) {
    human.position.copy(spot);
    let prev: { forward: THREE.Vector3; right: THREE.Vector3 } | null = null;
    let maxFwd = 0;
    let maxRight = 0;
    for (let i = 0; i <= 360; i++) {
      sim.yaw = (i * Math.PI) / 180;
      sim.pitch = goalAxisUp ? 0.4 : -0.2;
      const pose = sim.getCameraPose(blankIntent(zoom));
      const look = pose.target.clone().sub(pose.position);
      if (look.lengthSq() < 1e-8) fail('camera sat on its look target');
      look.normalize();
      const intoLook = pose.position.clone().sub(human.position).dot(look);
      if (intoLook > 0.15) {
        const label = `${goalAxisUp ? 'goal-up' : 'world-up'} zoom=${zoom} yaw=${i}`;
        fail(`camera crossed in front of the swimmer (${label}, intoLook ${intoLook.toFixed(2)})`);
      }
      if (pose.position.length() > ARENA_RADIUS - CAMERA.wallClearance + 1e-3) {
        fail('chase camera left the sphere');
      }
      const axes = viewAxes(pose.position, pose.target, pose.up);
      if (prev) {
        maxFwd = Math.max(maxFwd, angle(prev.forward, axes.forward));
        maxRight = Math.max(maxRight, angle(prev.right, axes.right));
      }
      prev = axes;
    }
    const where = `${goalAxisUp ? 'goal-up' : 'world-up'} zoom=${zoom}`;
    if (maxFwd > (3 * Math.PI) / 180) fail(`view jumped ${deg(maxFwd).toFixed(2)}° per 1° of yaw (${where})`);
    if (maxRight > (4 * Math.PI) / 180) {
      fail(`horizon rolled ${deg(maxRight).toFixed(2)}° per 1° of yaw (${where})`);
    }
  }
}

function checkWall(): void {
  const position = new THREE.Vector3(0, 0, ARENA_RADIUS - PLAYER.radius + 0.25);
  const velocity = new THREE.Vector3(4, 6, 14);
  const tangent = velocity.clone();
  const beforeNormal = position.clone().normalize();
  tangent.addScaledVector(beforeNormal, -tangent.dot(beforeNormal));
  constrainPlayerToSphere(position, velocity, PLAYER.radius);
  const normal = position.clone().normalize();
  if (velocity.dot(normal) > 1e-4) fail('wall left an outward speed');
  const kept = velocity.clone().addScaledVector(normal, -velocity.dot(normal));
  if (kept.distanceTo(tangent) > 1e-3) fail('wall changed the tangent slide');

  const sim = new Simulation(defaultTunables());
  sim.kickoffLock = 0;
  const human = sim.getHuman();
  human.position.set(0, 0, ARENA_RADIUS - PLAYER.radius - 0.05);
  human.velocity.set(0, 0, PLAYER.maxSpeed);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  sim.yaw = 0;
  sim.pitch = -0.1;
  const intent = blankIntent();
  intent.move.set(0, 0, 1);
  let maxStep = 0;
  for (let i = 0; i < 45; i++) {
    const before = human.facing.clone();
    sim.step(1 / 60, intent);
    maxStep = Math.max(maxStep, angle(before, human.facing));
  }
  if (maxStep > (12 * Math.PI) / 180) {
    fail(`body whipped ${deg(maxStep).toFixed(1)}° in one step while held on the wall`);
  }
}

function holdPoint(sim: Simulation): THREE.Vector3 {
  const human = sim.getHuman();
  return human.position
    .clone()
    .addScaledVector(human.facing, BALL.holdOffset)
    .addScaledVector(human.up, 0.15);
}

function aimingSim(): { sim: Simulation; human: ReturnType<Simulation['getHuman']>; hold: InputIntent } {
  const sim = new Simulation(defaultTunables());
  sim.setSoloOpponent(false);
  sim.kickoffLock = 0;
  for (const p of sim.players) {
    if (p.id !== sim.humanId) p.active = false;
  }
  const human = sim.getHuman();
  human.position.set(0, 1, -6);
  human.velocity.set(0, 0, 0);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  human.hasBall = true;
  human.actionPose = 'hold';
  sim.ball.possession = 'held';
  sim.ball.ownerId = human.id;
  sim.ball.lastOwnerId = human.id;
  sim.ball.velocity.set(0, 0, 0);
  sim.yaw = 0;
  sim.pitch = 0;
  sim.ball.position.copy(holdPoint(sim));
  const hold = blankIntent();
  hold.shootHeld = true;
  return { sim, human, hold };
}

function checkArcHand(): void {
  const { sim, human, hold } = aimingSim();
  // Camera looks off the body's facing so the carry pose has to turn.
  // WASD still swims, but only at the throw creep.
  sim.yaw = 0.7;
  human.velocity.set(0, 0, 6);
  hold.move.set(1, 0, 0);
  hold.up = 1;
  const startBall = sim.ball.position.clone();
  const startPlayer = human.position.clone();
  for (let i = 0; i < 30; i++) sim.step(1 / 60, hold);
  if (!sim.shotAim.active) fail('shot aim did not lock');
  if (human.actionPose !== 'hold') fail(`aim pose was ${human.actionPose}, ball would leave the hands`);
  const creep = PLAYER.maxSpeed * PLAYER.carrierSpeedMult * PLAYER.throwSwimMult;
  const speed = human.velocity.length();
  if (speed > creep * 1.3) fail(`throw swim was not slowed (${speed.toFixed(2)} > ${creep.toFixed(2)})`);
  if (speed < creep * 0.45) fail(`throw swim did not creep (${speed.toFixed(2)})`);
  const carried = sim.ball.position.distanceTo(holdPoint(sim));
  if (carried > 0.05) fail(`ball left the hand by ${carried.toFixed(2)}`);
  if (sim.ball.position.distanceTo(startBall) < 0.2) {
    fail('ball froze in the water instead of moving with the hold pose');
  }
  if (human.position.distanceTo(startPlayer) < 0.15) fail('player did not move while throwing');
}

function checkArcBend(): void {
  const { sim, hold } = aimingSim();
  sim.tunables.shotCarry = 0;
  sim.step(1 / 60, hold);
  if (sim.chargeGhost.length < 4) fail('arc preview missing');
  const start = sim.chargeGhost[0];
  if (!start || start.distanceTo(sim.ball.position) > 0.05) fail('preview does not start on the ball');
  const target = sim.shotAim.target.clone();
  const yaw = sim.yaw;
  const pitch = sim.pitch;
  const mid = sim.chargeGhost[Math.floor(sim.chargeGhost.length / 2)]!.clone();
  const look = blankIntent();
  look.lookDelta.x = 0.4;
  look.lookDelta.y = -0.3;
  sim.applyFrameLook(look);
  if (Math.abs(sim.yaw - yaw) > 1e-6 || Math.abs(sim.pitch - pitch) > 1e-6) {
    fail('mouse still turned the camera while aiming');
  }
  if (sim.shotAim.target.distanceTo(target) > 0.02) fail('mouse moved the aim point');
  const expectRight = 0.4 * sim.tunables.arcBendSpeed;
  const expectUp = 0.3 * sim.tunables.arcBendSpeed;
  if (Math.abs(sim.shotAim.bendRight - expectRight) > 0.05) {
    fail(`side bend ${sim.shotAim.bendRight.toFixed(2)} != ${expectRight.toFixed(2)}`);
  }
  if (Math.abs(sim.shotAim.bendUp - expectUp) > 0.05) {
    fail(`up bend ${sim.shotAim.bendUp.toFixed(2)} != ${expectUp.toFixed(2)}`);
  }
  const bent = sim.chargeGhost[Math.floor(sim.chargeGhost.length / 2)];
  if (!bent || bent.distanceTo(mid) < 1) fail('arc preview did not change shape');
  const last = sim.chargeGhost[sim.chargeGhost.length - 1];
  if (!last || last.distanceTo(sim.shotAim.target) > 0.05) fail('preview does not end on the marker');
}

function checkArcMarker(): void {
  const { sim, human, hold } = aimingSim();
  sim.tunables.shotPowerRate = 0;
  sim.step(1 / 60, hold);
  const playerBefore = human.position.clone();
  const before = sim.shotAim.target.clone();
  hold.move.set(1, 0, 0);
  const frames = 30;
  for (let i = 0; i < frames; i++) sim.step(1 / 60, hold);
  const playerDelta = human.position.clone().sub(playerBefore);
  const markDelta = sim.shotAim.target.clone().sub(before);
  if (playerDelta.length() < 0.2) fail('WASD did not creep the swimmer during the throw');
  if (markDelta.distanceTo(playerDelta) > 0.55) {
    fail(`marker did not drift with the swimmer (${markDelta.distanceTo(playerDelta).toFixed(2)})`);
  }
  const start = sim.chargeGhost[0];
  const end = sim.chargeGhost[sim.chargeGhost.length - 1];
  if (!start || start.distanceTo(sim.ball.position) > 0.08) fail('curve left the ball while drifting');
  if (!end || end.distanceTo(sim.shotAim.target) > 0.08) fail('curve left the marker while drifting');

  const wheel = aimingSim();
  wheel.sim.tunables.powerMode = 'hold';
  wheel.sim.tunables.shotPowerRate = 6;
  for (let i = 0; i < 20; i++) wheel.sim.step(1 / 60, wheel.hold);
  if (wheel.sim.charge.amount < 0.99) fail('hold mode did not fill');
  for (let i = 0; i < 15; i++) wheel.sim.step(1 / 60, wheel.hold);
  if (wheel.sim.charge.amount < 0.99) fail('hold mode oscillated after it filled');
  const forward = lookBasis(wheel.sim.yaw, wheel.sim.pitch, false).forward;
  const ranged = wheel.sim.shotAim.target.clone();
  wheel.sim.nudgeAimDistance(6);
  const delta = wheel.sim.shotAim.target.clone().sub(ranged);
  const along = delta.dot(forward);
  if (Math.abs(along - 6) > 0.15) fail(`wheel range slid ${along.toFixed(2)} instead of 6`);
  if (delta.addScaledVector(forward, -along).length() > 0.08) fail('wheel moved the marker off the aim');
}

function checkArcFlight(): void {
  const { sim, hold } = aimingSim();
  sim.tunables.shotCarry = 0;
  sim.step(1 / 60, hold);
  const look = blankIntent();
  look.lookDelta.x = 0.15;
  look.lookDelta.y = -0.2;
  sim.applyFrameLook(look);
  sim.step(1 / 60, hold);
  const target = sim.shotAim.target.clone();
  const last = sim.chargeGhost[sim.chargeGhost.length - 1];
  if (!last || last.distanceTo(target) > 0.05) fail('preview does not end on the marker');
  const release = blankIntent();
  sim.step(1 / 60, release);
  if (!sim.ball.arc) fail('release did not start the arc');
  let guard = 0;
  while (sim.ball.arc && guard < 500) {
    sim.step(1 / 60, release);
    guard++;
  }
  if (sim.ball.arc) fail('arc did not finish');
  const miss = sim.ball.position.distanceTo(target);
  if (miss > 2) fail(`arc missed the marker by ${miss.toFixed(2)}`);
}

function checkArcClamp(): void {
  const { sim, hold } = aimingSim();
  sim.tunables.shotCarry = 0;
  sim.step(1 / 60, hold);
  sim.shotAim.bendRight = 900;
  sim.shotAim.bendUp = -900;
  sim.step(1 / 60, hold);
  const limit = ARENA_RADIUS - BALL.radius;
  for (const p of sim.chargeGhost) {
    if (p.length() > limit + 0.05) fail(`preview left the arena (${p.length().toFixed(2)})`);
  }
  hold.move.set(1, 0, 1);
  hold.move.normalize();
  for (let i = 0; i < 240; i++) sim.step(1 / 60, hold);
  if (sim.shotAim.target.length() > limit + 0.05) {
    fail(`marker left the arena (${sim.shotAim.target.length().toFixed(2)})`);
  }
  if (sim.shotAim.target.distanceTo(sim.ball.position) < SHOT_ARC.minRange - 0.05) {
    fail('marker collapsed into the ball');
  }
  for (const p of sim.chargeGhost) {
    if (p.length() > limit + 0.05) fail(`bent preview left the arena (${p.length().toFixed(2)})`);
  }
}

function checkShapeMath(): void {
  const origin = new THREE.Vector3(1, 2, 3);
  const target = new THREE.Vector3(1, 2, 23);
  const right = new THREE.Vector3(1, 0, 0);
  const up = new THREE.Vector3(0, 0.7, 0.3).normalize();
  const resting = arcControl(new THREE.Vector3(), origin, target, up, 0.34);
  const shaped = shapedControl(new THREE.Vector3(), origin, target, right, up, 0.34, 0, 0, 0.85, 80);
  if (resting.distanceTo(shaped) > 1e-3) fail('resting lob does not match the old arc control');

  const bent = shapedControl(new THREE.Vector3(), origin, target, right, up, 0.34, 8, -5, 0.85, 80);
  if (bent.x < resting.x + 4) fail('right bend did not push the control point right');
  if (bent.y > resting.y - 2) fail('down bend did not lower the control point');

  const insideOrigin = new THREE.Vector3(0, 0, 0);
  const insideTarget = new THREE.Vector3(0, 0, 10);
  const shell = 14;
  const wild = shapedControl(
    new THREE.Vector3(),
    insideOrigin,
    insideTarget,
    right,
    new THREE.Vector3(0, 1, 0),
    0.8,
    500,
    500,
    1.5,
    shell,
  );
  if (wild.length() > shell + 0.02) fail(`control point left the sphere (${wild.length().toFixed(2)})`);
  const sample = new THREE.Vector3();
  for (let i = 0; i <= 24; i++) {
    quadraticPoint(sample, insideOrigin, wild, insideTarget, i / 24);
    if (sample.length() > shell + 0.05) fail(`curve sample left the sphere (${sample.length().toFixed(2)})`);
  }

  const far = clampAimMarker(new THREE.Vector3(), new THREE.Vector3(0, 0, 100), new THREE.Vector3(), 4, 40);
  if (Math.abs(far.length() - 40) > 0.02) fail(`far marker was not clamped (${far.length().toFixed(2)})`);
  const near = clampAimMarker(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 4, 40);
  if (near.length() < 3.95) fail(`near marker stayed inside the hand (${near.length().toFixed(2)})`);
}

function checkPractice(): void {
  const sim = new Simulation(defaultTunables());
  sim.setSoloOpponent(false);
  if (sim.tunables.defenseActive) fail('defense should start holding position');
  const mate = sim.players.find((p) => p.team === 0 && p.role === 'ai' && p.active);
  const defense = sim.players.find((p) => p.team === 1 && p.active);
  if (!mate || !defense) fail('practice roster is missing the teammate or the defender');
  const held = defense.position.clone();
  sim.kickoffLock = 0;
  sim.ball.possession = 'free';
  sim.ball.ownerId = null;
  sim.ball.lastOwnerId = sim.humanId;
  sim.ball.claimLock = 0;
  sim.ball.velocity.set(0, 0, 0);
  sim.ball.position.copy(mate.position).add(new THREE.Vector3(1.1, 0, 0.4));
  const intent = blankIntent();
  let received = false;
  for (let i = 0; i < 100; i++) {
    sim.step(1 / 60, intent);
    if (mate.hasBall) received = true;
  }
  if (defense.position.distanceTo(held) > 0.15) fail('frozen defense left its spot');
  if (!received && mate.position.distanceTo(sim.ball.position) > 2.5) {
    fail('teammate did not come receive the pass');
  }

  const passSim = new Simulation(defaultTunables());
  passSim.setSoloOpponent(false);
  passSim.kickoffLock = 0;
  passSim.tunables.fieldSkillA = 100;
  const passer = passSim.players.find((p) => p.team === 0 && p.role === 'ai' && p.active);
  const marker = passSim.players.find((p) => p.team === 1 && p.active);
  if (!passer || !marker) fail('practice roster is missing the teammate or the defender');
  passer.hasBall = true;
  passer.position.set(0, 0, -16);
  passer.velocity.set(0, 0, 0);
  passer.facing.set(0, 0, 1);
  passer.up.set(0, 1, 0);
  marker.position.set(-5.2, 0, -16);
  marker.velocity.set(0, 0, 0);
  passSim.getHuman().position.set(4, 0, 14);
  passSim.getHuman().velocity.set(0, 0, 0);
  passSim.getHuman().up.set(0, 1, 0);
  passSim.ball.possession = 'held';
  passSim.ball.ownerId = passer.id;
  passSim.ball.lastOwnerId = passer.id;
  passSim.ball.arc = null;
  passSim.ball.velocity.set(0, 0, 0);
  passSim.ball.position.copy(passer.position).add(new THREE.Vector3(0, 0.15, 0.6));
  let passed = false;
  for (let i = 0; i < 140; i++) {
    const before: string = passSim.ball.possession;
    passSim.step(1 / 60, intent);
    const now: string = passSim.ball.possession;
    if (before === 'held' && now === 'free' && passSim.ball.lastOwnerId === passer.id) {
      const toHuman = passSim.getHuman().position.clone().sub(passer.position);
      if (toHuman.lengthSq() > 0.01 && passSim.ball.velocity.dot(toHuman.normalize()) < 2) {
        fail('pass back was not aimed at the human');
      }
      passed = true;
      break;
    }
  }
  if (!passed) fail('teammate did not pass back');

  sim.tunables.defenseActive = true;
  const start = defense.position.clone();
  sim.ball.possession = 'free';
  sim.ball.ownerId = null;
  sim.ball.velocity.set(0, 0, 0);
  sim.ball.position.copy(defense.position).add(new THREE.Vector3(0, 0, -5));
  mate.active = false;
  for (let i = 0; i < 80; i++) sim.step(1 / 60, intent);
  if (defense.position.distanceTo(start) < 0.4) fail('defense toggle did not let them chase');
}

function checkStrafe(): void {
  const sim = new Simulation(defaultTunables());
  sim.kickoffLock = 0;
  const human = sim.getHuman();
  human.position.set(0, 0, 0);
  human.velocity.set(8, 0, 0);
  human.facing.set(1, 0, 0);
  human.up.set(0, 1, 0);
  sim.yaw = 0;
  sim.pitch = 0;
  const intent = blankIntent();
  intent.strafe = true;
  intent.move.set(1, 0, 0);
  for (let i = 0; i < 40; i++) sim.step(1 / 60, intent);
  if (human.facing.dot(new THREE.Vector3(0, 0, 1)) < 0.85) {
    fail(`strafe facing stayed on velocity (${human.facing.toArray().map((n) => n.toFixed(2)).join(',')})`);
  }
  const cap = PLAYER.maxSpeed * sim.tunables.strafeSpeedMult * 1.2;
  if (human.velocity.length() > cap) fail(`strafe speed ${human.velocity.length().toFixed(2)} exceeded ${cap.toFixed(2)}`);
}

function shoulderMeasure(sim: Simulation): number {
  const human = sim.getHuman();
  const basis = lookBasis(sim.yaw, sim.pitch, sim.tunables.goalAxisUp);
  const pose = sim.getCameraPose(blankIntent());
  return pose.position.clone().sub(human.position).dot(basis.right);
}

function checkShoulder(): void {
  const sim = new Simulation(defaultTunables());
  sim.kickoffLock = 0;
  const human = sim.getHuman();
  human.position.set(0, 0, 0);
  human.velocity.set(0, 0, 0);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  sim.yaw = 0;
  sim.pitch = 0;
  human.hasBall = true;
  sim.ball.possession = 'held';
  sim.ball.ownerId = human.id;
  sim.ball.position.set(0, 0.15, 0.85);
  const strafe = blankIntent();
  strafe.strafe = true;
  const full = sim.tunables.shoulderOffset;

  sim.updateAimPresentation(strafe, 1 / 60);
  let lat = shoulderMeasure(sim);
  if (Math.abs(lat - sim.shoulderLateral) > 0.08) fail('chase pose ignored the shoulder offset');
  if (lat > full * 0.35) fail(`shoulder snapped in to ${lat.toFixed(2)}`);
  if (lat < full * 0.02) fail(`shoulder did not start (${lat.toFixed(2)})`);

  for (let i = 0; i < 120; i++) sim.updateAimPresentation(strafe, 1 / 60);
  lat = shoulderMeasure(sim);
  if (lat < full * 0.85) fail(`shoulder did not settle on the right (${lat.toFixed(2)})`);

  let prev: THREE.Vector3 | null = null;
  for (let i = 0; i <= 72; i++) {
    sim.yaw = (i * 5 * Math.PI) / 180;
    const pose = sim.getCameraPose(blankIntent());
    if (pose.position.length() > ARENA_RADIUS - CAMERA.wallClearance + 1e-3) {
      fail('settled shoulder camera left the arena');
    }
    const axes = viewAxes(pose.position, pose.target, pose.up);
    if (prev) {
      const step = angle(prev, axes.forward);
      if (step > (12 * Math.PI) / 180) fail(`shoulder view jumped ${deg(step).toFixed(1)}°`);
    }
    prev = axes.forward;
  }
  sim.yaw = 0;

  sim.updateAimPresentation(blankIntent(), 1 / 60);
  const eased = shoulderMeasure(sim);
  if (eased < full * 0.6) fail(`shoulder popped out to ${eased.toFixed(2)}`);
  if (eased > full * 0.995) fail('shoulder did not ease out');

  const left = new Simulation(defaultTunables());
  left.kickoffLock = 0;
  const leftHuman = left.getHuman();
  leftHuman.position.set(0, 0, 0);
  leftHuman.facing.set(0, 0, 1);
  leftHuman.up.set(0, 1, 0);
  leftHuman.hasBall = true;
  left.ball.possession = 'held';
  left.ball.ownerId = leftHuman.id;
  left.yaw = 0;
  left.pitch = 0;
  const right = lookBasis(0, 0, false).right;
  left.ball.position.copy(right).multiplyScalar(-3);
  for (let i = 0; i < 120; i++) left.updateAimPresentation(strafe, 1 / 60);
  if (shoulderMeasure(left) > -full * 0.8) {
    fail(`camera stayed off the ball's side (${shoulderMeasure(left).toFixed(2)})`);
  }

  const empty = new Simulation(defaultTunables());
  empty.kickoffLock = 0;
  empty.getHuman().position.set(0, 0, 0);
  empty.getHuman().facing.set(0, 0, 1);
  empty.getHuman().up.set(0, 1, 0);
  empty.ball.position.copy(right).multiplyScalar(-3);
  empty.yaw = 0;
  empty.pitch = 0;
  for (let i = 0; i < 120; i++) empty.updateAimPresentation(strafe, 1 / 60);
  if (Math.abs(shoulderMeasure(empty)) > 0.45) {
    fail(`off-ball strafe kept a throwing shoulder (${shoulderMeasure(empty).toFixed(2)})`);
  }
  if (empty.catchFrame < 0.85) fail(`catch camera did not ease in (${empty.catchFrame.toFixed(2)})`);
  const catchPose = empty.getCameraPose(blankIntent());
  const catchDist = catchPose.position.distanceTo(empty.getHuman().position);
  if (catchDist < CAMERA.chaseDistance + 1.4) {
    fail(`catch camera stayed on the throw framing (${catchDist.toFixed(2)})`);
  }
  const catchAhead = catchPose.target.clone().sub(empty.getHuman().position).dot(new THREE.Vector3(0, 0, 1));
  if (catchAhead > 6) fail(`catch camera looked past the hands (${catchAhead.toFixed(2)})`);

  const cradled = new Simulation(defaultTunables());
  cradled.kickoffLock = 0;
  const cradle = cradled.getHuman();
  cradle.position.set(0, 0, 0);
  cradle.facing.set(0, 0, 1);
  cradle.up.set(0, 1, 0);
  cradle.hasBall = true;
  cradled.ball.possession = 'held';
  cradled.ball.ownerId = cradle.id;
  cradled.ball.position.set(0, 0.15, 0.8);
  cradled.yaw = 0;
  cradled.pitch = 0;
  for (let i = 0; i < 120; i++) cradled.updateAimPresentation(strafe, 1 / 60);
  if (shoulderMeasure(cradled) < full * 0.8) fail('centered hold left the default shoulder');

  const pinned = new Simulation(defaultTunables());
  pinned.kickoffLock = 0;
  const swimmer = pinned.getHuman();
  swimmer.position.set(0, 0, ARENA_RADIUS - PLAYER.radius - 0.05);
  swimmer.facing.set(0, 0, -1);
  swimmer.up.set(0, 1, 0);
  pinned.yaw = Math.PI;
  pinned.pitch = 0.15;
  for (let i = 0; i < 120; i++) pinned.updateAimPresentation(strafe, 1 / 60);
  const pose = pinned.getCameraPose(blankIntent());
  if (pose.position.length() > ARENA_RADIUS - CAMERA.wallClearance + 1e-2) {
    fail(`shoulder camera left the arena near the wall (${pose.position.length().toFixed(2)})`);
  }
  const look = pose.target.clone().sub(pose.position).normalize();
  const into = pose.position.clone().sub(swimmer.position).dot(look);
  if (into > 0.25) fail(`shoulder camera crossed in front of the swimmer (${into.toFixed(2)})`);
}

function parkOthers(sim: Simulation): void {
  for (const p of sim.players) {
    if (p.id === sim.humanId) continue;
    p.position.set(24, 18, -20);
  }
  sim.ball.position.set(0, 22, -16);
  sim.ball.possession = 'free';
  sim.ball.ownerId = null;
}

function checkStraightAimMarker(): void {
  const sim = new Simulation(defaultTunables());
  sim.setSoloOpponent(false);
  sim.kickoffLock = 0;
  const human = sim.getHuman();
  human.position.set(0, 0, 0);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  sim.yaw = 0;
  sim.pitch = 0;
  parkOthers(sim);
  const mate = sim.players.find((p) => p.team === 0 && p.role === 'ai' && p.active);
  if (!mate) fail('missing teammate for the landing marker');
  mate.position.set(0, 0, 12);
  const strafe = blankIntent();
  strafe.strafe = true;

  sim.updateAimPresentation(strafe, 1 / 60);
  if (sim.landingMarker.visible) fail('off-ball strafe showed a landing marker on a teammate');
  if (sim.chargeGhost.length > 0 || sim.shotAim.active) fail('off-ball strafe showed a curve');
  sim.ball.position.set(0, 0, 9);
  sim.ball.possession = 'free';
  sim.ball.ownerId = null;
  sim.updateAimPresentation(strafe, 1 / 60);
  if (sim.landingMarker.visible) fail('off-ball strafe showed a landing marker on the ball');
  sim.yaw = 1.1;
  sim.pitch = 0.35;
  sim.updateAimPresentation(strafe, 1 / 60);
  if (sim.landingMarker.visible) fail('off-ball strafe showed an open-water landing marker');

  human.hasBall = true;
  sim.ball.possession = 'held';
  sim.ball.ownerId = human.id;
  sim.ball.position.set(0, 0, 1.2);
  sim.yaw = 0;
  sim.pitch = 0;
  mate.position.set(0, 0, 12);
  sim.updateAimPresentation(strafe, 1 / 60);
  if (!sim.landingMarker.visible) fail('landing marker hidden while holding and strafing');
  if (sim.shotAim.active || sim.chargeGhost.length > 0) fail('right-click aim drew a curve');
  if (sim.landingMarker.lockId !== mate.id) fail('straight aim missed the teammate');
  if (sim.landingMarker.position.distanceTo(mate.position) > PLAYER.radius + 0.5) {
    fail('landing marker was not on the teammate');
  }

  mate.position.set(24, 18, -20);
  sim.updateAimPresentation(strafe, 1 / 60);
  if (sim.landingMarker.lockId !== null) fail('open look stuck to a teammate');
  if (sim.chargeGhost.length > 0) fail('open look drew a curve');
  const forward = lookBasis(0, 0, false).forward;
  const up = lookBasis(0, 0, false).up;
  const hand = human.position.clone().addScaledVector(forward, BALL.holdOffset).addScaledVector(up, 0.15);
  const along = sim.landingMarker.position.clone().sub(hand);
  const reach = along.length();
  if (along.normalize().dot(forward) < 0.98) fail('straight marker left the look ray');
  if (Math.abs(reach - sim.tunables.arcAimDistance) > 0.75) {
    fail(`marker distance ${reach.toFixed(2)} was not the straight throw`);
  }
  if (sim.landingMarker.position.distanceTo(sim.ball.position) < 8) fail('held ball stole the landing marker');

  human.position.set(50, 0, 0);
  sim.yaw = -Math.PI / 2;
  sim.pitch = 0;
  sim.updateAimPresentation(strafe, 1 / 60);
  if (!sim.landingMarker.visible) fail('near-wall aim hid the marker');
  if (sim.chargeGhost.length > 0 || sim.shotAim.active) fail('near-wall aim drew a curve');
  if (sim.landingMarker.position.length() > ARENA_RADIUS - BALL.radius) fail('marker left the arena');
  const outward = lookBasis(sim.yaw, sim.pitch, false).forward;
  const fromHand = sim.landingMarker.position.clone().sub(human.position.clone().addScaledVector(outward, BALL.holdOffset));
  if (fromHand.normalize().dot(outward) < 0.9) fail('wall marker left the look ray');

  sim.updateAimPresentation(blankIntent(), 1 / 60);
  if (sim.landingMarker.visible) fail('landing marker stayed up after releasing strafe');
}

function quietRoster(sim: Simulation): void {
  for (const p of sim.players) {
    if (p.id !== sim.humanId) p.active = false;
  }
}

function checkCatch(): void {
  const sim = new Simulation(defaultTunables());
  sim.kickoffLock = 0;
  quietRoster(sim);
  const human = sim.getHuman();
  human.position.set(0, 0, 0);
  human.velocity.set(0, 0, 0);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  sim.yaw = 0;
  sim.pitch = 0;
  sim.ball.possession = 'free';
  sim.ball.ownerId = null;
  sim.ball.lastOwnerId = null;
  sim.ball.claimLock = 0;
  sim.ball.velocity.set(0, 0, 0);
  sim.ball.position.set(0.55, 0.35, 2.2);
  const idle = blankIntent();
  for (let i = 0; i < 6; i++) sim.step(1 / 60, idle);
  if (!human.hasBall) fail('swim pickup missed a ball in front of the chest');

  human.hasBall = false;
  sim.ball.possession = 'free';
  sim.ball.ownerId = null;
  sim.ball.claimLock = 0;
  sim.ball.velocity.set(0, 0, 0);
  sim.ball.position.set(0, 0, -1.6);
  for (let i = 0; i < 8; i++) sim.step(1 / 60, idle);
  if (human.hasBall) fail('grabbed a ball behind the swimmer');

  sim.ball.position.set(2.3, 0, 0.2);
  sim.ball.claimLock = 0;
  for (let i = 0; i < 8; i++) sim.step(1 / 60, idle);
  if (human.hasBall) fail('grabbed a ball out to the side');

  sim.ball.position.set(0.15, 0.1, 5.4);
  sim.ball.velocity.set(0, 0, -360);
  sim.ball.claimLock = 0;
  sim.step(1 / 60, idle);
  if (!human.hasBall) fail('a pass tunneled through the mitt');

  const wide = new Simulation(defaultTunables());
  wide.kickoffLock = 0;
  quietRoster(wide);
  const swimmer = wide.getHuman();
  swimmer.position.set(0, 0, 0);
  swimmer.velocity.set(0, 0, 0);
  swimmer.facing.set(0, 0, 1);
  swimmer.up.set(0, 1, 0);
  wide.yaw = 0;
  wide.pitch = 0;
  wide.ball.possession = 'free';
  wide.ball.ownerId = null;
  wide.ball.lastOwnerId = null;
  wide.ball.claimLock = 0;
  wide.ball.velocity.set(0, 0, 0);
  wide.ball.position.set(0, 0, 5.2);
  for (let i = 0; i < 6; i++) wide.step(1 / 60, blankIntent());
  if (swimmer.hasBall) fail('normal mitt reached a ball that belongs to the catch stance');

  const squared = blankIntent();
  squared.strafe = true;
  wide.ball.claimLock = 0;
  wide.step(1 / 60, squared);
  if (swimmer.hasBall) fail('square up caught a ball without catch-ready');
  const stance = blankIntent();
  stance.strafe = true;
  stance.claim = true;
  wide.step(1 / 60, stance);
  if (!swimmer.hasBall) fail('catch-ready did not take the ball in front of the hands');

  const pull = new Simulation(defaultTunables());
  pull.kickoffLock = 0;
  quietRoster(pull);
  const reacher = pull.getHuman();
  reacher.position.set(0, 0, 0);
  reacher.velocity.set(0, 0, 0);
  reacher.facing.set(0, 0, 1);
  reacher.up.set(0, 1, 0);
  pull.yaw = 0;
  pull.pitch = 0;
  pull.ball.possession = 'free';
  pull.ball.ownerId = null;
  pull.ball.lastOwnerId = null;
  pull.ball.claimLock = 0;
  pull.ball.velocity.set(0, 0, 0);
  pull.ball.position.set(2.15, 0, 3.2);
  const still = blankIntent();
  for (let i = 0; i < 20; i++) pull.step(1 / 60, still);
  if (reacher.hasBall || pull.ball.position.x < 1.9) fail('the ball drifted in without the catch stance');
  const armCatch = blankIntent();
  armCatch.strafe = true;
  armCatch.claim = true;
  pull.step(1 / 60, armCatch);
  const reaching = blankIntent();
  reaching.strafe = true;
  for (let i = 0; i < 45; i++) pull.step(1 / 60, reaching);
  if (!reacher.hasBall && pull.ball.position.x > 1.55) {
    fail(`catch stance did not draw the ball in (${pull.ball.position.x.toFixed(2)})`);
  }
}

/**
 * A return pass has to reach the player. The passer used to turn back into
 * the enlarged mitt and take the ball before it arrived.
 */
/** A slow pass into a squared-up catch-ready mitt is caught. */
function checkKick(): void {
  const setup = () => {
    const sim = new Simulation(defaultTunables());
    sim.kickoffLock = 0;
    sim.setSoloOpponent(false);
    quietRoster(sim);
    sim.tunables.powerMode = 'hold';
    sim.tunables.shotPowerRate = 40;
    sim.tunables.arcHandCurve = 0;
    sim.tunables.shotPowerAngle = 0;
    const human = sim.getHuman();
    human.position.set(0, 0, 0);
    human.velocity.set(0, 0, 0);
    human.facing.set(-1, 0, 0);
    human.up.set(0, 1, 0);
    human.hasBall = true;
    // Along -X so the chord is not swallowed by a goal-pocket retarget.
    sim.yaw = Math.PI / 2;
    sim.pitch = 0;
    sim.ball.possession = 'held';
    sim.ball.ownerId = human.id;
    sim.ball.lastOwnerId = human.id;
    sim.ball.claimLock = 0;
    sim.ball.arc = null;
    sim.ball.velocity.set(0, 0, 0);
    sim.ball.position.set(0, 0.2, 0.8);
    return sim;
  };

  const throwSim = setup();
  const throwing = blankIntent();
  throwing.shootHeld = true;
  for (let i = 0; i < 8; i++) {
    throwSim.armShotAim(throwing);
    throwSim.step(1 / 60, throwing);
  }
  const releaseThrow = blankIntent();
  throwSim.step(1 / 60, releaseThrow);
  const thrown = throwSim.ball.arc;
  if (!thrown) fail('equal-power throw did not launch');
  const throwTravel = thrown.p0.distanceTo(thrown.p2);

  const kickSim = setup();
  const charging = blankIntent();
  charging.strafe = true;
  charging.kickHeld = true;
  for (let i = 0; i < 8; i++) {
    kickSim.armShotAim(charging);
    kickSim.step(1 / 60, charging);
  }
  const releaseKick = blankIntent();
  releaseKick.strafe = true;
  kickSim.step(1 / 60, releaseKick);
  if (kickSim.getHuman().hasBall) fail('kick release kept the ball in the hand');
  let kicked = kickSim.ball.arc;
  for (let i = 0; i < 20 && !kicked; i++) {
    kickSim.step(1 / 60, releaseKick);
    kicked = kickSim.ball.arc;
  }
  if (!kicked) fail('kick did not launch from the foot');
  const kickTravel = kicked.p0.distanceTo(kicked.p2);
  if (kickTravel < throwTravel * 1.12) {
    fail(`kick range ${kickTravel.toFixed(1)} was not past the throw ${throwTravel.toFixed(1)}`);
  }
  if (kicked.carrySpeed < thrown.carrySpeed * 1.12) {
    fail(`kick speed ${kicked.carrySpeed.toFixed(1)} was not past the throw ${thrown.carrySpeed.toFixed(1)}`);
  }

  const cancel = setup();
  for (let i = 0; i < 4; i++) {
    cancel.armShotAim(charging);
    cancel.step(1 / 60, charging);
  }
  const stop = blankIntent();
  stop.strafe = false;
  stop.kickHeld = true;
  stop.aimCancel = true;
  cancel.step(1 / 60, stop);
  if (!cancel.getHuman().hasBall) fail('cancelling a kick dropped the ball');
  if (cancel.ball.arc) fail('cancelled kick still launched');
  if (cancel.ball.velocity.length() > 8) fail('cancelled kick launched the ball');

  const volley = setup();
  volley.yaw = 0;
  const human = volley.getHuman();
  human.facing.set(0, 0, 1);
  human.hasBall = false;
  volley.ball.possession = 'free';
  volley.ball.ownerId = null;
  volley.ball.lastOwnerId = null;
  volley.ball.claimLock = 0;
  volley.ball.arc = null;
  volley.ball.position.set(0, 0.1, 1.15);
  volley.ball.velocity.set(0, 0, -2);
  const flick = blankIntent();
  flick.kickHeld = true;
  volley.step(1 / 60, flick);
  if (human.hasBall || volley.ball.possession !== 'free') fail('volley took possession');
  if (volley.ball.velocity.z < 8) fail(`volley did not send the ball along the aim (${volley.ball.velocity.z.toFixed(1)})`);
}

function checkCatchReadyPass(): void {
  const sim = new Simulation(defaultTunables());
  sim.kickoffLock = 0;
  quietRoster(sim);
  const human = sim.getHuman();
  human.position.set(0, 0, 0);
  human.velocity.set(0, 0, 0);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  sim.yaw = 0;
  sim.pitch = 0;
  sim.ball.possession = 'free';
  sim.ball.ownerId = null;
  sim.ball.lastOwnerId = 3;
  sim.ball.claimLock = 0;
  sim.ball.arc = null;
  sim.ball.position.set(0, 0.15, 9);
  sim.ball.velocity.set(0, 0, -16);
  const arm = blankIntent();
  arm.strafe = true;
  arm.claim = true;
  sim.step(1 / 60, arm);
  if (!human.catchReady) fail('E while squared up did not enter catch-ready');
  if (human.hasBall) fail('catch-ready grabbed a pass that was still out of the cone');
  const hold = blankIntent();
  hold.strafe = true;
  let caught = false;
  for (let i = 0; i < 80; i++) {
    sim.step(1 / 60, hold);
    if (human.hasBall) {
      caught = true;
      break;
    }
  }
  if (!caught || sim.ball.ownerId !== human.id) fail('catch-ready missed a slow pass');
}

/** A slap in catch-ready sends the ball along the aim and does not take it. */
function checkDeflect(): void {
  const sim = new Simulation(defaultTunables());
  sim.kickoffLock = 0;
  quietRoster(sim);
  const human = sim.getHuman();
  human.position.set(0, 0, 0);
  human.velocity.set(0, 0, 0);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  sim.yaw = 0;
  sim.pitch = 0;
  sim.ball.possession = 'free';
  sim.ball.ownerId = null;
  sim.ball.lastOwnerId = null;
  sim.ball.claimLock = 0;
  sim.ball.arc = null;
  sim.ball.position.set(0, 0.2, 20);
  sim.ball.velocity.set(0, 0, 0);
  const arm = blankIntent();
  arm.strafe = true;
  arm.claim = true;
  sim.step(1 / 60, arm);
  if (!human.catchReady) fail('deflect setup did not enter catch-ready');
  sim.ball.position.set(0, 0.15, 2.1);
  sim.ball.velocity.set(1, 0, -6);
  sim.ball.claimLock = 0;
  sim.ball.possession = 'free';
  const slap = blankIntent();
  slap.strafe = true;
  slap.burst = true;
  sim.step(1 / 60, slap);
  if (human.hasBall || sim.ball.possession !== 'free' || sim.ball.ownerId !== null) {
    fail('deflect claimed the ball');
  }
  if (sim.ball.velocity.z < sim.tunables.deflectStrength * 0.8) {
    fail(`deflect did not send the ball along the aim (${sim.ball.velocity.z.toFixed(1)})`);
  }
  if (human.velocity.z > sim.tunables.burstSpeed * 0.4) fail('deflect lunged like a shoulder check');
}

function checkTeammatePassReachesPlayer(): void {
  const sim = new Simulation(defaultTunables());
  sim.setSoloOpponent(false);
  sim.kickoffLock = 0;
  sim.tunables.defenseActive = false;
  sim.tunables.teammatePassDelay = 0.05;
  sim.tunables.fieldSkillA = 100;
  const human = sim.getHuman();
  const mate = sim.players.find((p) => p.team === 0 && p.role === 'ai' && p.active);
  const defense = sim.players.find((p) => p.team === 1 && p.active);
  if (!mate || !defense) fail('practice roster is missing the teammate or the defender');

  human.position.set(4, 0, 18);
  human.velocity.set(0, 0, 0);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  sim.yaw = 0;
  sim.pitch = 0;

  mate.position.set(0, 0.2, -14);
  mate.velocity.set(0, 0, 0);
  mate.facing.set(0, 0, 1);
  mate.up.set(0, 1, 0);
  mate.hasBall = true;
  sim.ball.possession = 'held';
  sim.ball.ownerId = mate.id;
  sim.ball.lastOwnerId = mate.id;
  sim.ball.arc = null;
  sim.ball.claimLock = 0;
  sim.ball.velocity.set(0, 0, 0);
  sim.ball.position.copy(mate.position).add(new THREE.Vector3(0, 0.15, -0.85));

  defense.position.set(40, 20, -40);
  defense.velocity.set(0, 0, 0);

  const intent = blankIntent();
  let released = false;
  let reclaimed = false;
  let caught = false;
  let closest = Infinity;
  for (let i = 0; i < 400; i++) {
    const held = mate.hasBall;
    sim.step(1 / 60, intent);
    const poss: string = sim.ball.possession;
    if (held && !mate.hasBall && poss === 'free' && sim.ball.lastOwnerId === mate.id) {
      released = true;
    }
    if (released && mate.hasBall) reclaimed = true;
    if (released) closest = Math.min(closest, sim.ball.position.distanceTo(human.position));
    if (released && human.hasBall) {
      caught = true;
      break;
    }
  }
  if (!released) fail('teammate did not pass to the player');
  if (reclaimed) fail('passer reclaimed their own pass');
  if (!caught || sim.ball.ownerId !== human.id) {
    fail(`pass did not reach the player (closest ${closest.toFixed(2)})`);
  }
}

/** A defender on the pass line still takes it. The thrower's lock is not global. */
function checkOpponentInterceptsPass(): void {
  const sim = new Simulation(defaultTunables());
  sim.setSoloOpponent(false);
  sim.kickoffLock = 0;
  sim.tunables.defenseActive = false;
  sim.tunables.teammatePassDelay = 0.05;
  sim.tunables.fieldSkillA = 100;
  const human = sim.getHuman();
  const mate = sim.players.find((p) => p.team === 0 && p.role === 'ai' && p.active);
  const defense = sim.players.find((p) => p.team === 1 && p.active);
  if (!mate || !defense) fail('practice roster is missing the teammate or the defender');

  human.position.set(0, 0, -10);
  human.velocity.set(0, 0, 0);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  sim.yaw = 0;
  sim.pitch = 0;

  mate.position.set(0, 0.2, 8);
  mate.velocity.set(0, 0, 0);
  mate.facing.set(0, 0, -1);
  mate.up.set(0, 1, 0);
  mate.hasBall = true;
  sim.ball.possession = 'held';
  sim.ball.ownerId = mate.id;
  sim.ball.lastOwnerId = mate.id;
  sim.ball.arc = null;
  sim.ball.claimLock = 0;
  sim.ball.velocity.set(0, 0, 0);
  sim.ball.position.copy(mate.position).add(new THREE.Vector3(0, 0.15, -0.85));

  defense.position.set(0, 0.4, -1.2);
  defense.velocity.set(0, 0, 0);
  defense.facing.set(0, 0, 1);
  defense.up.set(0, 1, 0);

  const intent = blankIntent();
  intent.callForPass = true;
  let released = false;
  for (let i = 0; i < 240; i++) {
    const held = mate.hasBall;
    sim.step(1 / 60, intent);
    const poss: string = sim.ball.possession;
    if (held && !mate.hasBall && poss === 'free') released = true;
    if (released && mate.hasBall) fail('passer took the ball before the defender');
    if (released && defense.hasBall) return;
  }
  fail(`defender did not intercept (owner ${sim.ball.ownerId}, poss ${sim.ball.possession})`);
}

/** Strip range still beats a held ball. The throw lock must not cover tackles. */
function checkTackleStillStrips(): void {
  const sim = new Simulation(defaultTunables());
  sim.setSoloOpponent(false);
  sim.kickoffLock = 0;
  const human = sim.getHuman();
  const mate = sim.players.find((p) => p.team === 0 && p.role === 'ai' && p.active);
  const defense = sim.players.find((p) => p.team === 1 && p.active);
  if (!mate || !defense) fail('practice roster is missing the teammate or the defender');
  mate.active = false;
  human.position.set(0, 0, 0);
  human.velocity.set(0, 0, 0);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  human.tackleCooldown = 0;
  sim.yaw = 0;
  sim.pitch = 0;
  defense.position.set(0, 0, 1.15);
  defense.velocity.set(0, 0, 0);
  defense.facing.set(0, 0, -1);
  defense.hasBall = true;
  sim.ball.possession = 'held';
  sim.ball.ownerId = defense.id;
  sim.ball.lastOwnerId = defense.id;
  sim.ball.claimLock = 0;
  sim.ball.velocity.set(0, 0, 0);
  sim.ball.position.copy(defense.position).add(new THREE.Vector3(0, 0.1, -0.4));
  const intent = blankIntent();
  intent.claim = true;
  sim.step(1 / 60, intent);
  if (!human.hasBall || defense.hasBall) fail('tackle did not strip the carrier');
}

function checkArcShotLeavesThrower(): void {
  const sim = new Simulation(defaultTunables());
  sim.kickoffLock = 0;
  quietRoster(sim);
  const human = sim.getHuman();
  human.position.set(0, 1, -18);
  human.velocity.set(0, 0, 0);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  human.hasBall = true;
  sim.yaw = 0;
  sim.pitch = 0;
  sim.ball.possession = 'held';
  sim.ball.ownerId = human.id;
  sim.ball.lastOwnerId = human.id;
  sim.ball.claimLock = 0;
  sim.ball.velocity.set(0, 0, 0);
  sim.ball.position.copy(human.position).add(new THREE.Vector3(0, 0.15, 0.85));
  sim.tunables.powerMode = 'hold';
  sim.tunables.shotPowerRate = 4;
  const hold = blankIntent();
  hold.shootHeld = true;
  for (let i = 0; i < 20; i++) sim.step(1 / 60, hold);
  if (!sim.shotAim.active) fail('shot did not aim');
  if (sim.charge.amount < 0.95) fail('leaving shot did not charge');
  sim.step(1 / 60, blankIntent());
  if (human.hasBall) fail('shot did not leave the hand');
  for (let i = 0; i < 40; i++) {
    sim.step(1 / 60, blankIntent());
    if (human.hasBall) fail('thrower reclaimed their own shot');
  }
  const gone = sim.ball.position.distanceTo(human.position);
  if (gone < 8) fail(`shot stayed on the thrower (${gone.toFixed(2)})`);
}

/** The player's own pass has to reach the teammate, and must not snap back. */
function checkHumanPassReachesTeammate(): void {
  const sim = new Simulation(defaultTunables());
  sim.setSoloOpponent(false);
  sim.kickoffLock = 0;
  sim.tunables.defenseActive = false;
  const human = sim.getHuman();
  const mate = sim.players.find((p) => p.team === 0 && p.role === 'ai' && p.active);
  const defense = sim.players.find((p) => p.team === 1 && p.active);
  if (!mate || !defense) fail('practice roster is missing the teammate or the defender');
  defense.position.set(30, 20, 0);
  defense.velocity.set(0, 0, 0);
  human.position.set(0, 0, 0);
  human.velocity.set(0, 0, 0);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  human.hasBall = true;
  sim.yaw = 0;
  sim.pitch = 0;
  mate.position.set(0, 0.3, 14);
  mate.velocity.set(0, 0, 0);
  mate.facing.set(0, 0, -1);
  mate.up.set(0, 1, 0);
  sim.ball.possession = 'held';
  sim.ball.ownerId = human.id;
  sim.ball.lastOwnerId = human.id;
  sim.ball.claimLock = 0;
  sim.ball.velocity.set(0, 0, 0);
  sim.ball.position.copy(human.position).add(new THREE.Vector3(0, 0.15, 0.85));
  const pass = blankIntent();
  pass.pass = true;
  sim.step(1 / 60, pass);
  if (human.hasBall) fail('human pass did not release');
  let reclaimed = false;
  let caught = false;
  for (let i = 0; i < 180; i++) {
    sim.step(1 / 60, blankIntent());
    if (human.hasBall) reclaimed = true;
    if (mate.hasBall) {
      caught = true;
      break;
    }
  }
  if (reclaimed) fail('human reclaimed their own pass');
  if (!caught) fail('teammate did not catch the human pass');
}

/** The self-pass gate must not swallow an ordinary loose-ball catch. */
function checkNormalCatchRegression(): void {
  const sim = new Simulation(defaultTunables());
  sim.kickoffLock = 0;
  quietRoster(sim);
  const human = sim.getHuman();
  human.position.set(0, 0, 0);
  human.velocity.set(0, 0, 0);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  sim.yaw = 0;
  sim.pitch = 0;
  sim.ball.possession = 'free';
  sim.ball.ownerId = null;
  sim.ball.lastOwnerId = null;
  sim.ball.claimLock = 0;
  sim.ball.velocity.set(0, 0, 0);
  sim.ball.position.set(0.25, 0.15, 2.3);
  for (let i = 0; i < 8; i++) sim.step(1 / 60, blankIntent());
  if (!human.hasBall) fail('normal catch missed a ball in front of the chest');

  human.hasBall = false;
  sim.ball.possession = 'free';
  sim.ball.ownerId = null;
  sim.ball.lastOwnerId = null;
  sim.ball.claimLock = 0;
  sim.ball.velocity.set(0, 0, 0);
  sim.ball.position.set(0, 0.1, -1.8);
  for (let i = 0; i < 8; i++) sim.step(1 / 60, blankIntent());
  if (human.hasBall) fail('normal catch took a ball behind the swimmer');

  // A pass from someone else still sticks. The thrower is not this catcher.
  const incoming = new Simulation(defaultTunables());
  incoming.kickoffLock = 0;
  quietRoster(incoming);
  const catcher = incoming.getHuman();
  catcher.position.set(0, 0, 0);
  catcher.velocity.set(0, 0, 0);
  catcher.facing.set(0, 0, 1);
  catcher.up.set(0, 1, 0);
  incoming.yaw = 0;
  incoming.pitch = 0;
  incoming.ball.possession = 'free';
  incoming.ball.ownerId = null;
  incoming.ball.lastOwnerId = 4;
  incoming.ball.claimLock = 0;
  incoming.ball.velocity.set(0, 0, -28);
  incoming.ball.position.set(0.1, 0.1, 6);
  for (let i = 0; i < 20; i++) incoming.step(1 / 60, blankIntent());
  if (!catcher.hasBall) fail('normal catch missed a pass thrown by someone else');
}

function checkCatchPose(): void {
  const swim = swimLimbPose(0, 0);
  const ready = blendLimbPose(swim, 1, 0);
  if (ready.yL < swim.yL + 0.7) fail('catch stance did not reach forward');
  if (!(ready.zL < -0.4 && ready.zR > 0.4)) fail('catch stance did not lift both arms');
  const mid = blendLimbPose(swim, 0.5, 0);
  if (!(mid.yL > swim.yL && mid.yL < ready.yL)) fail('catch blend did not ease in');
  const held = blendLimbPose(swim, 1, 1);
  if (Math.abs(held.yL - 1.05) > 0.05) fail('hold pose did not take over from the reach');
  if (held.zL < 0.3) fail('hold pose did not close the hands');
}

function checkGoalMouth(): void {
  const z = goalPlaneZ(0);
  const inside = new THREE.Vector3(GOAL.rimRadius * 0.12, 0, z + 0.5);
  const angled = new THREE.Vector3(0, GOAL.rimRadius * 0.12, z + 0.5);
  if (!inGoalPocket(inside, 0) || !inGoalPocket(angled, 0)) fail('triangle mouth rejected a point inside the opening');
  const ring = new THREE.Vector3(GOAL.rimRadius + GOAL.rimTube + 0.3, 0, z);
  if (inGoalPocket(ring, 0)) fail('the ring tube counted as the net');
  const wide = new THREE.Vector3(GOAL.rimRadius + 2.2, 0, z + 1);
  if (inGoalPocket(wide, 0)) fail('a miss beside the hoop counted as a goal');
  if (segmentScores(new THREE.Vector3(0, 0, z - 4), new THREE.Vector3(0, 0, z + 2)) !== 0) {
    fail('a shot through the center did not score');
  }
  const beside = GOAL.rimRadius + 3;
  if (segmentScores(new THREE.Vector3(beside, 0, z - 3), new THREE.Vector3(beside, 0, z + 3)) !== null) {
    fail('a shot beside the hoop scored');
  }
  const far = goalPlaneZ(1);
  if (segmentScores(new THREE.Vector3(0, 0, far + 3), new THREE.Vector3(0, 0, far - 1.5)) !== 1) {
    fail('the far hoop did not score for orange');
  }
}

function fillThrow(sim: Simulation, hold: InputIntent): void {
  for (let i = 0; i < 80 && sim.charge.amount < 0.98; i++) sim.step(1 / 60, hold);
  if (sim.charge.amount < 0.95) fail(`throw did not reach full power (${sim.charge.amount.toFixed(2)})`);
}

function checkShotIntoGoal(): void {
  const { sim, human, hold } = aimingSim();
  human.position.set(2, 0, 16);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  sim.yaw = 0;
  sim.pitch = 0;
  sim.tunables.arcHandCurve = 0.12;
  sim.tunables.shotPowerAngle = 0;
  sim.ball.position.copy(holdPoint(sim));
  sim.step(1 / 60, hold);
  fillThrow(sim, hold);
  const end = sim.chargeGhost[sim.chargeGhost.length - 1];
  if (!end || !inGoalPocket(end, 0)) fail('preview did not finish in the goal');
  if (arcRightOffset(sim) < 0.4) fail(`goal shot flattened the hand curve (${arcRightOffset(sim).toFixed(2)})`);

  const bent = aimingSim();
  bent.human.position.set(2, 0, 16);
  bent.human.facing.set(0, 0, 1);
  bent.human.up.set(0, 1, 0);
  bent.sim.yaw = 0;
  bent.sim.pitch = 0;
  bent.sim.tunables.arcHandCurve = 0.12;
  bent.sim.tunables.shotPowerAngle = 0;
  bent.sim.ball.position.copy(holdPoint(bent.sim));
  bent.sim.step(1 / 60, bent.hold);
  fillThrow(bent.sim, bent.hold);
  const before = bent.sim.chargeGhost[Math.floor(bent.sim.chargeGhost.length / 2)]!.clone();
  bent.sim.applyFrameLook({ ...blankIntent(), lookDelta: { x: 0.12, y: 0 } });
  bent.sim.step(1 / 60, bent.hold);
  const after = bent.sim.chargeGhost[Math.floor(bent.sim.chargeGhost.length / 2)];
  if (!after || after.distanceTo(before) < 0.8) fail('mouse bend did not change a shot aimed at the goal');
  const bentEnd = bent.sim.chargeGhost[bent.sim.chargeGhost.length - 1];
  if (!bentEnd || !inGoalPocket(bentEnd, 0)) fail('a bent shot aimed at the goal left the net');
  bent.sim.step(1 / 60, blankIntent());
  let bentScored = false;
  for (let i = 0; i < 420 && !bentScored; i++) {
    bent.sim.step(1 / 60, blankIntent());
    bentScored = bent.sim.match.score[0] > 0;
  }
  if (!bentScored) fail('bent shot aimed at the goal did not score');

  sim.step(1 / 60, blankIntent());
  let scored = false;
  for (let i = 0; i < 420 && !scored; i++) {
    sim.step(1 / 60, blankIntent());
    scored = sim.match.score[0] > 0;
  }
  if (!scored) fail('aimed arc did not enter the goal');

  const miss = aimingSim();
  miss.human.position.set(2, 0, 16);
  miss.human.facing.set(0, 0, 1);
  miss.human.up.set(0, 1, 0);
  miss.sim.yaw = 0.85;
  miss.sim.pitch = 0;
  miss.sim.ball.position.copy(holdPoint(miss.sim));
  miss.sim.step(1 / 60, miss.hold);
  const missedEnd = miss.sim.chargeGhost[miss.sim.chargeGhost.length - 1];
  if (missedEnd && inGoalPocket(missedEnd)) fail('a shot aimed well wide previewed into the goal');
  miss.sim.step(1 / 60, blankIntent());
  for (let i = 0; i < 240; i++) miss.sim.step(1 / 60, blankIntent());
  if (miss.sim.match.score[0] > 0) fail('a shot aimed well wide still scored');
}

function arcRightOffset(sim: Simulation): number {
  const g = sim.chargeGhost;
  const a = g[0];
  const b = g[g.length - 1];
  const mid = g[Math.floor(g.length / 2)];
  if (!a || !b || !mid) fail('arc preview missing');
  const chordMid = a.clone().lerp(b, 0.5);
  const right = lookBasis(sim.yaw, sim.pitch, sim.tunables.goalAxisUp).right;
  return mid.clone().sub(chordMid).dot(right);
}

function checkArcDefault(): void {
  const { sim, human, hold } = aimingSim();
  sim.tunables.shotCarry = 0;
  human.facing.set(1, 0, 0);
  sim.tunables.shotPowerRate = 0;
  sim.tunables.shotPowerAngle = 0;
  const yaw = sim.yaw;
  sim.step(1 / 60, hold);
  if (human.facing.dot(lookBasis(yaw, sim.pitch, false).forward) < 0.99) {
    fail('body kept turning into the aim instead of starting there');
  }
  const side = arcRightOffset(sim);
  if (Math.abs(side) > 0.12) fail(`default arc offset ${side.toFixed(2)} is not straight`);
  const frozen = sim.chargeGhost.map((p) => p.clone());
  sim.step(1 / 60, hold);
  let drift = 0;
  sim.chargeGhost.forEach((p, i) => {
    drift = Math.max(drift, p.distanceTo(frozen[i]!));
  });
  if (drift > 0.08) fail(`arc settled ${drift.toFixed(2)} after it appeared`);

  const biased = aimingSim();
  biased.sim.tunables.shotCarry = 0;
  biased.sim.tunables.shotPowerRate = 0;
  biased.sim.tunables.shotPowerAngle = 0;
  biased.sim.tunables.arcHandCurve = 0.12;
  biased.sim.step(1 / 60, biased.hold);
  const chord = biased.sim.ball.position.distanceTo(biased.sim.shotAim.target);
  const bias = arcRightOffset(biased.sim);
  if (bias < 0.12 * chord * 0.35) fail(`hand curve slider did nothing (${bias.toFixed(2)})`);
}

function checkHoldLookOrder(): void {
  const { sim, hold } = aimingSim();
  const yaw = sim.yaw;
  hold.lookDelta.x = 0.25;
  hold.lookDelta.y = -0.1;
  sim.armShotAim(hold);
  sim.applyFrameLook(hold);
  if (!sim.shotAim.active) fail('shot aim was not armed before look');
  if (Math.abs(sim.yaw - yaw) > 1e-6) fail('the press-drag turned the camera');
  const expect = 0.25 * sim.tunables.arcBendSpeed;
  if (Math.abs(sim.shotAim.bendRight - expect) > 0.05) {
    fail(`press-drag bend ${sim.shotAim.bendRight.toFixed(2)} != ${expect.toFixed(2)}`);
  }
}

function checkPowerMeter(): void {
  const { sim, hold } = aimingSim();
  sim.tunables.shotCarry = 0;
  sim.tunables.shotPowerRate = 1;
  sim.tunables.shotPowerAngle = 0.2;
  sim.tunables.arcHandCurve = 0.12;
  const amounts: number[] = [];
  for (let i = 0; i < 90; i++) {
    sim.step(1 / 60, hold);
    amounts.push(sim.charge.amount);
  }
  if ((amounts[30] ?? 0) < 0.45 || (amounts[30] ?? 1) > 0.55) {
    fail(`power at 0.5s was ${amounts[30]?.toFixed(2)}`);
  }
  if ((amounts[59] ?? 0) < 0.95) fail(`power did not fill (${amounts[59]?.toFixed(2)})`);
  if ((amounts[89] ?? 1) > 0.55) fail(`power did not empty (${amounts[89]?.toFixed(2)})`);
  const low = arcRightOffset(sim);
  // Vertical component: rebuild a zero-power arc by stepping a fresh sim.
  const calm = aimingSim();
  calm.sim.tunables.shotCarry = 0;
  calm.sim.tunables.shotPowerRate = 0;
  calm.sim.tunables.shotPowerAngle = 0.2;
  calm.sim.step(1 / 60, calm.hold);
  const highLift = sim.chargeGhost[Math.floor(sim.chargeGhost.length / 2)]!.y;
  const lowLift = calm.sim.chargeGhost[Math.floor(calm.sim.chargeGhost.length / 2)]!.y;
  if (highLift < lowLift + 0.4) fail('full power did not raise the arc');
  if (low < 0.2) fail('power removed the throwing-hand curve');

  const releaseAt = (steps: number): number => {
    const shot = aimingSim();
    shot.sim.tunables.shotCarry = 0;
    shot.sim.tunables.shotPowerRate = 1;
    for (let i = 0; i < steps; i++) shot.sim.step(1 / 60, shot.hold);
    const locked = shot.sim.charge.amount;
    shot.sim.step(1 / 60, blankIntent());
    if (!shot.sim.ball.arc) fail('release did not throw');
    if (Math.abs(shot.sim.charge.amount) > 0.001) fail('meter kept running after release');
    if (Math.abs(locked - steps / 60) > 0.04) fail(`release did not lock power ${locked.toFixed(2)}`);
    return shot.sim.ball.arc.carrySpeed;
  };
  // Higher locked power leaves the hand faster. The chord also grows, so duration is not the comparison.
  const early = releaseAt(8);
  const late = releaseAt(50);
  if (!(late > early)) fail(`power did not speed the shot (${early.toFixed(2)} vs ${late.toFixed(2)})`);
}

function checkTeammateLock(): void {
  const { sim, human, hold } = aimingSim();
  const mate = sim.players.find((p) => p.team === 0 && p.role === 'ai');
  if (!mate) fail('no teammate');
  mate.active = true;
  mate.velocity.set(0, 0, 0);
  mate.position.set(human.position.x, human.position.y, human.position.z + 18);
  sim.step(1 / 60, hold);
  if (sim.shotAim.lockId !== mate.id) fail('look ray did not lock the teammate');
  if (sim.shotAim.target.distanceTo(mate.position) > 1.2) fail('marker did not snap to the teammate');
  const look = blankIntent();
  look.lookDelta.x = 0.2;
  sim.applyFrameLook(look);
  if (sim.shotAim.bendRight < 0.15 * sim.tunables.arcBendSpeed) fail('lock ate the mouse bend');
  sim.step(1 / 60, blankIntent());
  if (sim.ball.arc?.receiverId !== mate.id) fail('release did not throw to the teammate');
  let guard = 0;
  const fly = blankIntent();
  while (sim.ball.ownerId !== mate.id && guard < 400) {
    sim.step(1 / 60, fly);
    guard++;
  }
  if (sim.ball.ownerId !== mate.id) fail('teammate did not receive the arc');
  if (mate.hasBall !== true) fail('catch did not give them the ball');
}

function checkShotSteer(): void {
  const sim = new Simulation(defaultTunables());
  sim.setSoloOpponent(false);
  sim.kickoffLock = 0;
  for (const p of sim.players) {
    if (p.id !== sim.humanId) p.active = false;
  }
  const human = sim.getHuman();
  human.position.set(0, 1, -6);
  human.velocity.set(0, 0, 0);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  human.hasBall = true;
  sim.ball.possession = 'held';
  sim.ball.ownerId = human.id;
  sim.ball.lastOwnerId = human.id;
  sim.ball.position.set(0, 1, -5.2);
  sim.yaw = 0.4;
  sim.pitch = 1;
  sim.tunables.shotPowerRate = 0;

  const upAim = blankIntent();
  upAim.shootHeld = true;
  upAim.move.set(0, 0, 1);
  sim.step(1 / 60, upAim);
  const lockedAt = human.position.clone();
  const before = sim.shotAim.target.clone();
  const yaw = sim.yaw;
  for (let i = 0; i < 30; i++) sim.step(1 / 60, upAim);
  const creptDelta = human.position.clone().sub(lockedAt);
  const markDelta = sim.shotAim.target.clone().sub(before);
  if (markDelta.distanceTo(creptDelta) > 0.6) {
    fail(`W did not carry the throw marker (${markDelta.distanceTo(creptDelta).toFixed(2)})`);
  }
  if (Math.abs(sim.yaw - yaw) > 1e-6) fail('WASD turned the locked aim');
  const crept = creptDelta.length();
  if (crept < 0.35) fail(`throw hold did not let WASD swim (${crept.toFixed(2)})`);
  const creep = PLAYER.maxSpeed * PLAYER.carrierSpeedMult * PLAYER.throwSwimMult;
  if (human.velocity.length() > creep * 1.3) {
    fail(`throw swim too fast (${human.velocity.length().toFixed(2)})`);
  }

  const riseAt = human.position.clone();
  const riseBefore = sim.shotAim.target.clone();
  const climb = blankIntent();
  climb.shootHeld = true;
  climb.up = 1;
  for (let i = 0; i < 20; i++) sim.step(1 / 60, climb);
  const riseDelta = human.position.clone().sub(riseAt);
  const riseMark = sim.shotAim.target.clone().sub(riseBefore);
  if (riseMark.distanceTo(riseDelta) > 0.6) {
    fail(`Space did not carry the throw marker (${riseMark.distanceTo(riseDelta).toFixed(2)})`);
  }

  const ranged = new Simulation(defaultTunables());
  ranged.kickoffLock = 0;
  for (const p of ranged.players) {
    if (p.id !== ranged.humanId) p.active = false;
  }
  const shooter = ranged.getHuman();
  shooter.position.set(0, 0, 0);
  shooter.velocity.set(0, 0, 0);
  shooter.hasBall = true;
  ranged.ball.possession = 'held';
  ranged.ball.ownerId = shooter.id;
  ranged.ball.position.set(0, 0, 0.8);
  ranged.yaw = 0.2;
  ranged.pitch = -0.1;
  ranged.tunables.powerMode = 'hold';
  ranged.tunables.shotPowerRate = 6;
  const hold = blankIntent();
  hold.shootHeld = true;
  for (let i = 0; i < 20; i++) ranged.step(1 / 60, hold);
  if (ranged.charge.amount < 0.99) fail('wheel check did not fill the hold');
  const forward = lookBasis(ranged.yaw, ranged.pitch, false).forward;
  const rangedBefore = ranged.shotAim.target.clone();
  ranged.nudgeAimDistance(6);
  const wheelDelta = ranged.shotAim.target.clone().sub(rangedBefore);
  const along = wheelDelta.dot(forward);
  if (Math.abs(along - 6) > 0.15) fail(`wheel range slid ${along.toFixed(2)} instead of 6`);
  if (wheelDelta.addScaledVector(forward, -along).length() > 0.08) fail('wheel moved the marker off the look axis');
}

function solo(sim: Simulation): ReturnType<Simulation['getHuman']> {
  sim.kickoffLock = 0;
  sim.match.resetTimer = 0;
  for (const p of sim.players) {
    if (p.id !== sim.humanId) p.active = false;
  }
  return sim.getHuman();
}

function checkBallFit(): void {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(2, 10, 8));
  // Same situation as the GLB: the mesh center is not the group origin.
  mesh.position.set(3, -4, 1.5);
  root.add(mesh);
  if (!fitBallModel(root, BALL.radius)) fail('fit rejected a sphere');
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  if (center.length() > 0.02) {
    fail(`fitted ball was not on the pivot (${center.toArray().map((n) => n.toFixed(3)).join(',')})`);
  }
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const expect = BALL.radius * Math.sqrt(3);
  if (Math.abs(radius - expect) > 0.04) fail(`fitted ball radius ${radius.toFixed(3)} != ${expect.toFixed(3)}`);
}

function checkSpeeds(): void {
  if (PLAYER.maxSpeed >= 24) fail(`cruise speed was not lowered (${PLAYER.maxSpeed})`);
  if (BALL.passSpeed >= 42) fail(`pass speed was not lowered (${BALL.passSpeed})`);
  if (BALL.shootSpeedMax >= 70) fail(`shot speed was not lowered (${BALL.shootSpeedMax})`);
  if (PLAYER.accel < 90) fail(`accel lost its snap (${PLAYER.accel})`);
  const defaults = defaultTunables();
  if (defaults.playerMaxSpeed !== PLAYER.maxSpeed) fail('cruise slider does not start at the new default');
  if (defaults.passSpeed !== BALL.passSpeed) fail('pass slider does not start at the new default');
  if (defaults.burstSpeed !== PLAYER.burstSpeed) fail('burst slider does not start at the new default');

  const sim = new Simulation(defaultTunables());
  const human = solo(sim);
  human.position.set(0, 0, -20);
  human.velocity.set(0, 0, 0);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  sim.yaw = 0;
  sim.pitch = 0;
  const swim = blankIntent();
  swim.move.set(0, 0, 1);
  for (let i = 0; i < 18; i++) sim.step(1 / 60, swim);
  const speed = human.velocity.length();
  if (speed < PLAYER.maxSpeed * 0.72) {
    fail(`accel not snappy after 0.3s (${speed.toFixed(2)} / ${PLAYER.maxSpeed})`);
  }
  if (speed > PLAYER.maxSpeed * 1.2) fail(`swim overshot cruise (${speed.toFixed(2)})`);
}

function checkBurst(): void {
  const sim = new Simulation(defaultTunables());
  const human = solo(sim);
  human.position.set(0, 2, -10);
  human.velocity.set(0, 0, 0);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  human.hasBall = false;
  sim.ball.possession = 'free';
  sim.ball.ownerId = null;
  sim.ball.claimLock = 9;
  sim.ball.velocity.set(0, 0, 0);
  sim.ball.position.set(30, 20, 10);
  sim.yaw = 0;
  sim.pitch = 0;

  const burst = blankIntent();
  burst.burst = true;
  sim.step(1 / 60, burst);
  if (human.burstCooldown <= 0) fail('burst did not start a cooldown');
  if (human.actionPose !== 'burst') fail(`burst pose was ${human.actionPose}`);
  if (human.velocity.z < sim.tunables.burstSpeed * 0.5) {
    fail(`look burst was not along the camera (${human.velocity.z.toFixed(2)})`);
  }
  if (human.velocity.length() > sim.tunables.burstSpeed * 1.05) {
    fail(`burst exceeded its cap (${human.velocity.length().toFixed(2)})`);
  }

  const z = human.velocity.z;
  sim.step(1 / 60, burst);
  if (human.velocity.z > z + 5) fail('burst fired again during cooldown');

  const wait = blankIntent();
  for (let i = 0; i < 90; i++) sim.step(1 / 60, wait);
  if (human.burstCooldown > 0) fail('burst cooldown did not end');

  const side = blankIntent();
  side.burst = true;
  side.move.set(1, 0, 0);
  sim.step(1 / 60, side);
  const right = lookBasis(0, 0, false).right;
  const along = human.velocity.dot(right);
  if (along < sim.tunables.burstSpeed * 0.45) {
    fail(`burst did not follow swim input (${along.toFixed(2)})`);
  }

  human.position.set(0, 0, -8);
  human.velocity.set(0, 0, 0);
  human.facing.set(0, 0, 1);
  human.burstCooldown = 0;
  human.burstTime = 0;
  human.hasBall = false;
  const stance = blankIntent();
  stance.strafe = true;
  sim.step(1 / 60, stance);
  if (!human.catchStance) fail('strafe without the ball did not enter catch stance');

  const lunge = blankIntent();
  lunge.burst = true;
  lunge.strafe = true;
  sim.step(1 / 60, lunge);
  if (human.velocity.dot(new THREE.Vector3(0, 0, 1)) < sim.tunables.burstSpeed * 0.45) {
    fail('strafe burst did not lunge along look');
  }
  if (human.facing.dot(new THREE.Vector3(0, 0, 1)) < 0.8) fail('burst broke catch-stance facing');
  if (human.catchStance) fail('lunge frame stayed in the catch reach');
  const holdStance = blankIntent();
  holdStance.strafe = true;
  for (let i = 0; i < 24; i++) sim.step(1 / 60, holdStance);
  if (!human.catchStance) fail('catch stance did not return after the lunge');

  sim.ball.position.copy(human.position).add(new THREE.Vector3(0, 0, 1));
  sim.ball.velocity.set(0, 0, 0);
  sim.ball.possession = 'free';
  sim.ball.ownerId = null;
  sim.ball.claimLock = 0;
  human.hasBall = false;
  const grab = blankIntent();
  grab.strafe = true;
  grab.claim = true;
  sim.step(1 / 60, grab);
  if (!human.hasBall) fail('catch stance blocked the claim');

  human.burstCooldown = 0;
  human.burstTime = 0;
  const shoot = blankIntent();
  shoot.burst = true;
  shoot.shoot = true;
  shoot.shootHeld = true;
  sim.step(1 / 60, shoot);
  if (human.burstCooldown > 0) fail('on-ball click triggered a burst');
  if (!sim.shotAim.active) fail('on-ball click did not start the shot');
}

function checkPointerLockGuard(): void {
  const idle = new PrimaryClickGate();
  if (idle.pointerDown()) fail('unlocked click was accepted');
  idle.pointerUp();
  idle.noteLockRequest();
  idle.setLocked(true);
  if (idle.suppress) fail('lock after the button was released stayed suppressed');
  if (!idle.pointerDown()) fail('locked click was rejected');
  idle.pointerUp();

  const capture = new PrimaryClickGate();
  capture.pointerDown();
  capture.noteLockRequest();
  capture.setLocked(true);
  if (!capture.suppress) fail('capturing press was not suppressed');
  if (capture.pointerDown()) fail('capturing click produced a shot or a burst');
  capture.pointerUp();
  if (capture.suppress) fail('release did not clear the pointer-lock guard');
  if (!capture.pointerDown()) fail('click after the guard did not register');
}

function checkCatchBeacon(): void {
  const sim = new Simulation(defaultTunables());
  const human = solo(sim);
  human.position.set(0, 0, -12);
  human.hasBall = false;
  sim.ball.possession = 'free';
  sim.ball.ownerId = null;
  sim.ball.arc = null;
  sim.ball.velocity.set(0, 2, 18);
  sim.ball.position.set(0, 0, -4);
  sim.updateAimPresentation(blankIntent(), 1 / 60);
  if (!sim.catchBeacon.visible) fail('loose ball hid the catch beacon');
  if (sim.catchBeacon.position.z <= sim.ball.position.z + 2) {
    fail(`beacon did not lead the loose ball (${sim.catchBeacon.position.z.toFixed(2)})`);
  }

  human.hasBall = true;
  sim.ball.possession = 'held';
  sim.ball.ownerId = human.id;
  sim.updateAimPresentation(blankIntent(), 1 / 60);
  if (sim.catchBeacon.visible) fail('held ball still showed the catch beacon');

  human.hasBall = false;
  sim.ball.possession = 'free';
  sim.ball.ownerId = null;
  const end = new THREE.Vector3(0, 1, 16);
  sim.ball.arc = {
    p0: new THREE.Vector3(0, 0, -8),
    p1: new THREE.Vector3(2, 4, 0),
    p2: end,
    elapsed: 0.1,
    duration: 1,
    receiverId: null,
    carryLeft: 0,
    carryDir: null,
    carrySpeed: 0,
  };
  sim.updateAimPresentation(blankIntent(), 1 / 60);
  if (!sim.catchBeacon.visible) fail('arc hid the catch beacon');
  if (sim.catchBeacon.position.distanceTo(end) > 0.05) fail('beacon was not on the arc end');
}

function checkGoalBoundArc(): void {
  const { sim, human, hold } = aimingSim();
  const mouth = goalPlaneZ(0);
  human.position.set(0, 1, mouth - 30);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  sim.yaw = 0;
  sim.pitch = 0;
  sim.ball.position.copy(holdPoint(sim));
  sim.tunables.powerMode = 'hold';
  sim.tunables.shotPowerRate = 8;
  sim.tunables.shotPowerAngle = 0;
  sim.step(1 / 60, hold);
  sim.shotAim.bendRight = 6;
  sim.shotAim.bendUp = 3;
  for (let i = 0; i < 12; i++) sim.step(1 / 60, hold);
  const ghost = sim.chargeGhost;
  const mid = ghost[Math.floor(ghost.length / 2)];
  if (!mid) fail('goal-bound preview missing');
  const chord = sim.shotAim.target.clone().sub(sim.ball.position).normalize();
  const off = mid.clone().sub(sim.ball.position);
  off.addScaledVector(chord, -off.dot(chord));
  if (off.length() < 0.6) fail('goal-bound arc lost its curve');
  sim.step(1 / 60, blankIntent());
  if (!sim.ball.arc) fail('goal-bound release did not throw');
  sim.updateAimPresentation(blankIntent(), 1 / 60);
  if (!sim.catchBeacon.visible) fail('flight hid the catch beacon');
  const flightEnd = sim.ball.arc.p2.clone();
  if (sim.ball.arc.carryLeft > 0 && sim.ball.arc.carryDir) {
    flightEnd.addScaledVector(sim.ball.arc.carryDir, sim.ball.arc.carryLeft);
  }
  if (sim.catchBeacon.position.distanceTo(flightEnd) > 0.2) fail('beacon left the goal-bound arc');
  let guard = 0;
  const fly = blankIntent();
  while (sim.ball.arc && guard < 500) {
    sim.step(1 / 60, fly);
    guard++;
  }
  const reached = sim.ball.position.z >= mouth - 8 || sim.match.score[0] > 0;
  if (!reached) fail(`curved shot did not reach the goal (z ${sim.ball.position.z.toFixed(1)})`);
}

function checkTriangleOpening(): void {
  const z = goalPlaneZ(0);
  const tip = goalMouthVertex(0);
  const through = new THREE.Vector3(tip.x * 0.62, tip.y * 0.62, z);
  if (!pointInGoalMouth(through.x, through.y)) fail('lower opening was outside the triangle');
  const bulge = GOAL.rimRadius * 0.82;
  if (pointInGoalMouth(bulge, 0)) fail('round-mouth bulge was inside the triangle');
  if (segmentScores(new THREE.Vector3(bulge, 0, z - 4), new THREE.Vector3(bulge, 0, z + 2)) !== null) {
    fail('a shot through the round mouth outside the triangle scored');
  }

  const sim = new Simulation(defaultTunables());
  sim.setSoloOpponent(false);
  sim.kickoffLock = 0;
  sim.match.resetTimer = 0;
  for (const p of sim.players) {
    if (p.id !== sim.humanId) p.active = false;
  }
  sim.ball.possession = 'free';
  sim.ball.ownerId = null;
  sim.ball.lastOwnerId = null;
  sim.ball.arc = null;
  sim.ball.claimLock = 2;
  sim.ball.velocity.set(0, 0, 90);
  sim.ball.position.set(through.x, through.y, z - 4);
  let scored = false;
  for (let i = 0; i < 40 && !scored; i++) {
    sim.step(1 / 60, blankIntent());
    scored = sim.match.score[0] > 0;
  }
  if (!scored) fail('a shot through the triangle opening did not score');
}

function checkBodiesSeparate(): void {
  const sim = new Simulation(defaultTunables());
  sim.setSoloOpponent(false);
  sim.kickoffLock = 0;
  sim.tunables.defenseActive = false;
  const human = sim.getHuman();
  const other = sim.players.find((p) => p.team === 1 && p.active);
  if (!other) fail('missing a body to collide with');
  human.position.set(-0.15, 0, 0);
  human.velocity.set(5, 0, 0);
  human.facing.set(1, 0, 0);
  human.up.set(0, 1, 0);
  other.position.set(0.15, 0, 0);
  other.velocity.set(-5, 0, 0);
  other.facing.set(-1, 0, 0);
  sim.ball.position.set(0, 20, 0);
  sim.ball.claimLock = 5;
  sim.step(1 / 60, blankIntent());
  const gap = human.position.distanceTo(other.position);
  if (gap < PLAYER.radius * 2 - 0.04) fail(`bodies still overlapped (${gap.toFixed(3)})`);
}

function checkShoulderCheck(): void {
  const sim = new Simulation(defaultTunables());
  sim.setSoloOpponent(false);
  sim.kickoffLock = 0;
  sim.tunables.defenseActive = false;
  const human = sim.getHuman();
  const enemy = sim.players.find((p) => p.team === 1 && p.role === 'ai');
  if (!enemy) fail('missing a carrier to check');
  human.position.set(0, 0, 0);
  human.velocity.set(0, 0, 0);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  human.hasBall = false;
  human.burstCooldown = 0;
  sim.yaw = 0;
  sim.pitch = 0;
  enemy.position.set(0, 0, 0.85);
  enemy.velocity.set(0, 0, 0);
  enemy.hasBall = true;
  enemy.active = true;
  sim.ball.possession = 'held';
  sim.ball.ownerId = enemy.id;
  sim.ball.lastOwnerId = enemy.id;
  sim.ball.claimLock = 0;
  sim.ball.velocity.set(0, 0, 0);
  sim.ball.position.set(0, 0.15, 1.5);
  const check = blankIntent();
  check.burst = true;
  check.move.set(0, 0, 1);
  sim.step(1 / 60, check);
  const loose: string = sim.ball.possession;
  if (enemy.hasBall || loose !== 'free') fail('check did not knock the ball loose');
  if (sim.ball.velocity.z < 6) fail(`loose ball was not thrown forward (${sim.ball.velocity.z.toFixed(2)})`);
  if (enemy.staggerTime <= 0) fail('checked swimmer was not staggered');
  if (human.hitFlash <= 0 || enemy.hitFlash <= 0) fail('check did not flash both swimmers');
  if (sim.cameraShake <= 0) fail('a landed check did not shake the camera');
  if (human.burstCooldown < sim.tunables.lightBurstCooldown * 0.7) {
    fail(`light check cooldown was ${human.burstCooldown.toFixed(2)}`);
  }
  if (human.burstCooldown > sim.tunables.lightBurstCooldown + 0.08) {
    fail('a tap used the power-tackle cooldown');
  }
  const gap = human.position.distanceTo(enemy.position);
  if (gap < PLAYER.radius * 2 - 0.05) fail(`check left the bodies overlapping (${gap.toFixed(3)})`);

  const friendly = new Simulation(defaultTunables());
  friendly.setSoloOpponent(false);
  friendly.kickoffLock = 0;
  friendly.tunables.defenseActive = false;
  const you = friendly.getHuman();
  const pal = friendly.players.find((p) => p.team === 0 && p.role === 'ai');
  if (!pal) fail('missing teammate');
  you.position.set(0, 0, 0);
  you.velocity.set(0, 0, 0);
  you.facing.set(0, 0, 1);
  you.up.set(0, 1, 0);
  you.burstCooldown = 0;
  friendly.yaw = 0;
  friendly.pitch = 0;
  pal.position.set(0, 0, 0.85);
  pal.velocity.set(0, 0, 0);
  pal.active = true;
  pal.hasBall = true;
  friendly.ball.possession = 'held';
  friendly.ball.ownerId = pal.id;
  friendly.ball.position.set(0, 0.15, 1.5);
  const again = blankIntent();
  again.burst = true;
  again.move.set(0, 0, 1);
  friendly.step(1 / 60, again);
  const friendlyBall: string = friendly.ball.possession;
  if (pal.hasBall || friendlyBall !== 'free') fail('friendly check left the ball with a teammate');
  if (pal.staggerTime <= 0) fail('friendly fire did not stagger the teammate');

  const hit = new Simulation(defaultTunables());
  hit.setSoloOpponent(false);
  hit.kickoffLock = 0;
  hit.tunables.defenseActive = false;
  const swimmer = hit.getHuman();
  const foe = hit.players.find((p) => p.team === 1 && p.role === 'ai');
  if (!foe) fail('missing checker');
  swimmer.position.set(0, 0, 0);
  swimmer.velocity.set(0, 0, 0);
  swimmer.facing.set(0, 0, 1);
  swimmer.up.set(0, 1, 0);
  hit.yaw = 0;
  hit.pitch = 0;
  foe.position.set(0, 0, 0.7);
  foe.velocity.set(0, 0, 0);
  foe.burstTime = 0.25;
  foe.burstDir.set(0, 0, -1);
  foe.active = true;
  hit.ball.position.set(20, 20, 20);
  hit.ball.claimLock = 5;
  hit.step(1 / 60, blankIntent());
  if (swimmer.staggerTime <= 0 || hit.cameraShake <= 0) fail('a check you take did not stagger or shake');
  const coast = blankIntent();
  let guard = 0;
  while (swimmer.knockTime > 0 && guard < 40) {
    hit.step(1 / 60, coast);
    guard++;
  }
  if (swimmer.staggerTime <= 0) fail('stagger ended with the knock');
  const swim = blankIntent();
  swim.move.set(0, 0, 1);
  for (let i = 0; i < 10; i++) hit.step(1 / 60, swim);
  if (swimmer.staggerTime <= 0) fail('stagger did not last through the control check');
  if (swimmer.velocity.length() > PLAYER.maxSpeed * 0.45) {
    fail(`stagger still swam at ${swimmer.velocity.length().toFixed(2)}`);
  }
}

function holdTackle(sim: Simulation, seconds: number, move = new THREE.Vector3(0, 0, 1)): void {
  const press = blankIntent();
  press.burst = true;
  press.shootHeld = true;
  press.move.copy(move);
  sim.step(1 / 60, press);
  const held = blankIntent();
  held.shootHeld = true;
  held.move.copy(move);
  const frames = Math.max(0, Math.round(seconds * 60) - 1);
  for (let i = 0; i < frames; i++) sim.step(1 / 60, held);
}

function checkTackleCharge(): void {
  const sim = new Simulation(defaultTunables());
  const human = solo(sim);
  human.position.set(0, 0, -8);
  human.velocity.set(0, 0, 0);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  sim.yaw = 0;
  sim.pitch = 0;
  sim.ball.position.set(30, 20, 10);
  sim.ball.claimLock = 9;
  sim.ball.possession = 'free';
  sim.ball.ownerId = null;

  holdTackle(sim, 0.08);
  if (!sim.tackleCharge.active || sim.tackleCharge.amount <= 0) fail('tackle charge did not show');
  if (sim.tackleCharge.amount > sim.tunables.tackleTapTime / sim.tunables.tackleChargeTime + 0.08) {
    fail(`a tap filled the bar to ${sim.tackleCharge.amount.toFixed(2)}`);
  }
  if (human.burstTime > 0) fail('the check lunged before release');
  sim.step(1 / 60, blankIntent());
  if (sim.tackleCharge.active) fail('the charge bar stayed up after release');
  if (human.burstTime <= 0) fail('a short click did not shoulder-check');
  if (human.staggerTime > 0) fail('a tap staggered the checker');
  if (human.burstCooldown > sim.tunables.lightBurstCooldown + 0.02) fail('a tap took the power cooldown');
  const tapSpeed = human.velocity.length();
  if (tapSpeed > sim.tunables.lightBurstSpeed * 1.08) fail(`tap lunged at ${tapSpeed.toFixed(2)}`);
  if (tapSpeed < sim.tunables.lightBurstSpeed * 0.7) fail(`tap was too weak (${tapSpeed.toFixed(2)})`);

  const wait = blankIntent();
  for (let i = 0; i < 40; i++) sim.step(1 / 60, wait);
  const blocked = blankIntent();
  blocked.shootHeld = true;
  blocked.burst = true;
  human.burstCooldown = sim.tunables.lightBurstCooldown;
  sim.step(1 / 60, blocked);
  if (sim.tackleCharge.active) fail('a check on cooldown started a charge');

  human.burstCooldown = 0;
  human.burstTime = 0;
  human.velocity.set(0, 0, 0);
  holdTackle(sim, sim.tunables.tackleChargeTime);
  if (sim.tackleCharge.amount < 0.95) fail(`full charge only reached ${sim.tackleCharge.amount.toFixed(2)}`);
  sim.step(1 / 60, blankIntent());
  if (sim.tackleCharge.active) fail('power release left the bar up');
  const powerSpeed = human.velocity.length();
  if (powerSpeed < sim.tunables.burstSpeed * 0.75) fail(`power tackle was ${powerSpeed.toFixed(2)}`);
  if (human.staggerTime < sim.tunables.tackleSelfStagger * 0.5) fail('power tackle did not self-stagger');
  if (human.burstCooldown < sim.tunables.burstCooldown * 0.7) {
    fail(`power cooldown was ${human.burstCooldown.toFixed(2)}`);
  }

  const lightHit = new Simulation(defaultTunables());
  lightHit.setSoloOpponent(false);
  lightHit.kickoffLock = 0;
  lightHit.tunables.defenseActive = false;
  const tapper = solo(lightHit);
  const lightFoe = lightHit.players.find((p) => p.team === 1 && p.role === 'ai');
  if (!lightFoe) fail('missing a light-check target');
  tapper.position.set(0, 0, 0);
  tapper.velocity.set(0, 0, 0);
  tapper.facing.set(0, 0, 1);
  tapper.up.set(0, 1, 0);
  lightHit.yaw = 0;
  lightHit.pitch = 0;
  lightFoe.position.set(0, 0, 0.85);
  lightFoe.velocity.set(0, 0, 0);
  lightFoe.active = true;
  lightFoe.hasBall = true;
  lightHit.ball.possession = 'held';
  lightHit.ball.ownerId = lightFoe.id;
  lightHit.ball.position.set(0, 0.15, 1.5);
  const tap = blankIntent();
  tap.burst = true;
  tap.move.set(0, 0, 1);
  lightHit.step(1 / 60, tap);
  const lightLoose: string = lightHit.ball.possession;
  if (lightFoe.hasBall || lightLoose !== 'free') fail('a tap did not pop the ball');
  const lightKnock = lightFoe.velocity.length();

  const powerHit = new Simulation(defaultTunables());
  powerHit.setSoloOpponent(false);
  powerHit.kickoffLock = 0;
  powerHit.tunables.defenseActive = false;
  powerHit.tunables.tacklePopMin = 1;
  powerHit.tunables.tacklePopMax = 1;
  const charger = solo(powerHit);
  const powerFoe = powerHit.players.find((p) => p.team === 1 && p.role === 'ai');
  if (!powerFoe) fail('missing a power-tackle target');
  charger.position.set(0, 0, 0);
  charger.velocity.set(0, 0, 0);
  charger.facing.set(0, 0, 1);
  charger.up.set(0, 1, 0);
  powerHit.yaw = 0;
  powerHit.pitch = 0;
  powerFoe.position.set(0, 0, 0.85);
  powerFoe.velocity.set(0, 0, 0);
  powerFoe.active = true;
  powerFoe.hasBall = true;
  powerHit.ball.possession = 'held';
  powerHit.ball.ownerId = powerFoe.id;
  powerHit.ball.position.set(0, 0.15, 1.5);
  holdTackle(powerHit, powerHit.tunables.tackleChargeTime);
  powerHit.step(1 / 60, blankIntent());
  const powerLoose: string = powerHit.ball.possession;
  if (powerFoe.hasBall || powerLoose !== 'free') fail('a full power tackle did not pop the ball');
  if (powerFoe.velocity.length() < lightKnock + 4) {
    fail(`power knock ${powerFoe.velocity.length().toFixed(2)} was not above the tap ${lightKnock.toFixed(2)}`);
  }
  if (powerFoe.staggerTime <= 0) fail('power tackle did not stagger the target');
  const pal = powerHit.players.find((p) => p.team === 0 && p.role === 'ai');
  if (!pal) fail('missing a teammate for friendly fire');
  charger.burstCooldown = 0;
  charger.burstTime = 0;
  charger.staggerTime = 0;
  charger.position.set(0, 0, 0);
  charger.velocity.set(0, 0, 0);
  pal.position.set(0, 0, 0.85);
  pal.velocity.set(0, 0, 0);
  pal.active = true;
  pal.hasBall = true;
  powerHit.ball.possession = 'held';
  powerHit.ball.ownerId = pal.id;
  powerHit.ball.position.set(0, 0.15, 1.5);
  holdTackle(powerHit, powerHit.tunables.tackleChargeTime);
  powerHit.step(1 / 60, blankIntent());
  const friendLoose: string = powerHit.ball.possession;
  if (pal.hasBall || friendLoose !== 'free') fail('power tackle did not check a teammate');

  const whiff = new Simulation(defaultTunables());
  whiff.setSoloOpponent(false);
  whiff.kickoffLock = 0;
  whiff.tunables.defenseActive = false;
  whiff.tunables.tacklePopMin = 0;
  whiff.tunables.tacklePopMax = 0;
  const swimmer = solo(whiff);
  const holder = whiff.players.find((p) => p.team === 1 && p.role === 'ai');
  if (!holder) fail('missing a carrier who keeps the ball');
  swimmer.position.set(0, 0, 0);
  swimmer.velocity.set(0, 0, 0);
  swimmer.facing.set(0, 0, 1);
  swimmer.up.set(0, 1, 0);
  whiff.yaw = 0;
  whiff.pitch = 0;
  holder.position.set(0, 0, 0.85);
  holder.velocity.set(0, 0, 0);
  holder.active = true;
  holder.hasBall = true;
  whiff.ball.possession = 'held';
  whiff.ball.ownerId = holder.id;
  whiff.ball.position.set(0, 0.15, 1.5);
  holdTackle(whiff, whiff.tunables.tackleChargeTime);
  whiff.step(1 / 60, blankIntent());
  if (!holder.hasBall || whiff.ball.possession !== 'held') fail('a zero pop chance still stripped the ball');
  if (holder.staggerTime <= 0 || holder.velocity.length() < 4) fail('a missed pop did not knock the carrier');
}

function checkDrillOpponent(): void {
  const sim = new Simulation(defaultTunables());
  if (!sim.tunables.soloOpponent) fail('test opponent should start on');
  sim.kickoffLock = 0;
  const human = sim.getHuman();
  human.position.set(0, 0, -30);
  human.velocity.set(0, 0, 0);
  const foe = sim.players.find((p) => p.team === 1 && p.role === 'ai' && p.active);
  const mate = sim.players.find((p) => p.team === 0 && p.role === 'ai');
  if (!foe || !mate) fail('missing the drill roster');
  if (mate.active) fail('teammate was not parked for the test opponent');
  foe.position.set(0, 0, 0);
  foe.velocity.set(0, 0, 0);
  sim.ball.possession = 'free';
  sim.ball.ownerId = null;
  sim.ball.claimLock = 4;
  sim.ball.velocity.set(0, 0, 0);
  sim.ball.position.set(0, 0, 16);
  const start = foe.position.clone();
  const intent = blankIntent();
  for (let i = 0; i < 90; i++) sim.step(1 / 60, intent);
  if (mate.active) fail('teammate woke up');
  const foes = sim.players.filter((p) => p.team === 1 && p.active);
  if (foes.length !== 1) fail(`expected one enemy, saw ${foes.length}`);
  if (foe.position.distanceTo(start) < 0.5) fail('opponent did not chase the ball');
  if (foe.velocity.length() > sim.tunables.playerMaxSpeed * 0.62) {
    fail(`opponent chased at ${foe.velocity.length().toFixed(2)}`);
  }
  foe.hasBall = true;
  sim.ball.possession = 'held';
  sim.ball.ownerId = foe.id;
  sim.ball.claimLock = 0;
  let shot = false;
  for (let i = 0; i < 180; i++) {
    sim.step(1 / 60, intent);
    const poss: string = sim.ball.possession;
    if (sim.ball.arc || sim.match.score[1] > 0 || (poss === 'free' && sim.ball.velocity.length() > 8)) {
      shot = true;
    }
  }
  if (shot) fail('test opponent passed or shot');
  if (!foe.hasBall) fail('test opponent dropped the ball');
  if (foe.velocity.length() > sim.tunables.playerMaxSpeed * 0.55) {
    fail(`wander was ${foe.velocity.length().toFixed(2)}`);
  }
}

function checkWallRicochet(): void {
  const noEscape = { escapeSpeed: 500, escapeAngle: 0.01, allowEscape: false };
  const pos = new THREE.Vector3(ARENA_RADIUS - BALL.radius + 0.35, 0, 0);
  const vel = new THREE.Vector3(40, 0, 0);
  const before = vel.length();
  const hit = resolveSphereWall(pos, vel, BALL.radius, noEscape);
  if (hit.escaped) fail('head-on bounce was treated as an escape');
  if (vel.x >= 0) fail('bounce did not reflect off the surface normal');
  const speed = vel.length();
  if (speed >= before - 0.05) fail(`bounce did not drop speed (${speed.toFixed(2)})`);
  if (speed < before * 0.55) fail(`bounce killed the shot (${speed.toFixed(2)})`);

  const angled = new THREE.Vector3(24, 18, 0);
  const angledBefore = angled.length();
  resolveSphereWall(new THREE.Vector3(ARENA_RADIUS - BALL.radius + 0.3, 0, 0), angled, BALL.radius, noEscape);
  if (angled.x >= 0) fail('angled bounce stayed outward');
  if (angled.y < 18 * 0.7) fail('angled bounce lost the curve');
  if (angled.length() >= angledBefore - 0.05) fail('angled bounce did not drop speed');

  const sim = new Simulation(defaultTunables());
  sim.setSoloOpponent(false);
  sim.kickoffLock = 0;
  for (const p of sim.players) {
    if (p.id !== sim.humanId) p.active = false;
  }
  sim.ball.possession = 'free';
  sim.ball.ownerId = null;
  sim.ball.claimLock = 5;
  sim.ball.arc = null;
  const shell = ARENA_RADIUS - BALL.radius;
  sim.ball.position.set(shell - 0.05, 0, 0);
  sim.ball.velocity.set(90, 4, 0);
  let breached = false;
  let thrownIn = false;
  for (let i = 0; i < 120; i++) {
    sim.step(1 / 60, blankIntent());
    if (sim.ball.position.length() < 0.5) fail('ball vanished on the shell');
    if (sim.ball.position.x > ARENA_RADIUS + 0.3) breached = true;
    if (breached && sim.ball.position.x > shell * 0.5 && sim.ball.velocity.x < -6) thrownIn = true;
  }
  if (!breached) fail('a strong shot did not leave the shell');
  if (!thrownIn) fail('throw-in did not bring the ball back from the breach');
}

function checkRimDeflection(): void {
  const curve = goalFrameCurve(0);
  const onFrame = curve.getPoint(0.5);
  const z = goalPlaneZ(0);
  const away = new THREE.Vector3(onFrame.x, onFrame.y, 0);
  if (away.lengthSq() < 1e-6) fail('frame sample collapsed');
  away.normalize();
  const pos = new THREE.Vector3(onFrame.x, onFrame.y, z - 0.15).addScaledVector(away, GOAL.rimTube * 0.65);
  const vel = away.clone().multiplyScalar(-28);
  vel.z = 22;
  const toward = vel.dot(away);
  if (!resolveGoalRim(pos, vel)) fail('rim did not collide');
  if (vel.dot(away) < toward + 8) fail('rim did not bounce off the frame normal');

  const sim = new Simulation(defaultTunables());
  sim.setSoloOpponent(false);
  sim.kickoffLock = 0;
  sim.match.resetTimer = 0;
  for (const p of sim.players) {
    if (p.id !== sim.humanId) p.active = false;
  }
  sim.ball.possession = 'free';
  sim.ball.ownerId = null;
  sim.ball.claimLock = 4;
  sim.ball.arc = null;
  sim.ball.position.set(onFrame.x, onFrame.y, z - 2.5);
  sim.ball.velocity.set(0, 0, 70);
  for (let i = 0; i < 40; i++) sim.step(1 / 60, blankIntent());
  if (sim.match.score[0] > 0 || sim.match.score[1] > 0) fail('a rim hit scored');
  if (inGoalPocket(sim.ball.position)) fail('a rim hit ended in the net');
}

function checkGoalStaysVisible(): void {
  const sim = new Simulation(defaultTunables());
  sim.setSoloOpponent(false);
  sim.kickoffLock = 0;
  sim.match.resetTimer = 0;
  for (const p of sim.players) {
    if (p.id !== sim.humanId) p.active = false;
  }
  const z = goalPlaneZ(0);
  sim.ball.possession = 'free';
  sim.ball.ownerId = null;
  sim.ball.claimLock = 3;
  sim.ball.arc = null;
  sim.ball.velocity.set(0, 0, 70);
  sim.ball.position.set(0, 0, z - 2);
  let scored = false;
  for (let i = 0; i < 30 && !scored; i++) {
    sim.step(1 / 60, blankIntent());
    scored = sim.match.score[0] > 0;
  }
  if (!scored) fail('shot did not score');
  if (sim.ball.position.length() < 4) fail('ball vanished on the goal');
  if (!inGoalPocket(sim.ball.position, 0)) fail('ball was not in the net');
  for (let i = 0; i < 20; i++) sim.step(1 / 60, blankIntent());
  if (sim.match.resetTimer <= 0) fail('goal reset started immediately');
  if (sim.ball.position.length() < 4) fail('ball vanished before the restart');
  if (!inGoalPocket(sim.ball.position, 0)) fail('ball left the net before the restart');
}

function checkThrowAim(): void {
  if (PLAYER.throwSwimMult < 0.25 || PLAYER.throwSwimMult > 0.35) {
    fail(`throw swim ${PLAYER.throwSwimMult} is outside 25–35% of normal`);
  }
  const sim = new Simulation(defaultTunables());
  sim.setSoloOpponent(false);
  sim.kickoffLock = 0;
  for (const p of sim.players) {
    if (p.id !== sim.humanId) p.active = false;
  }
  const human = sim.getHuman();
  human.position.set(0, 0, 0);
  human.velocity.set(0, 0, 0);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  human.hasBall = true;
  sim.ball.possession = 'held';
  sim.ball.ownerId = human.id;
  sim.ball.position.set(0, 0.15, 0.85);
  sim.yaw = 0;
  sim.pitch = 0;

  const aim = blankIntent();
  aim.strafe = true;
  aim.move.set(1, 0, 0);
  sim.step(1 / 60, aim);
  sim.updateAimPresentation(aim, 1 / 60);
  if (sim.shotAim.active || sim.chargeGhost.length > 0) fail('right-click aim showed the curve');
  if (!sim.landingMarker.visible) fail('right-click aim hid the landing marker');
  const yaw = sim.yaw;
  const look = blankIntent();
  look.strafe = true;
  look.lookDelta.x = 0.35;
  sim.applyFrameLook(look);
  if (Math.abs(sim.yaw - (yaw + 0.35)) > 1e-4) fail('right-click aim did not follow the mouse');
  if (Math.abs(sim.shotAim.bendRight) > 0.01) fail('right-click aim bent a curve');
  sim.updateAimPresentation(look, 1 / 60);
  const forward = lookBasis(sim.yaw, sim.pitch, false).forward;
  const along = sim.landingMarker.position.clone().sub(human.position);
  if (!sim.landingMarker.visible) fail('right-click aim hid the landing marker');
  if (along.lengthSq() < 1e-6 || along.normalize().dot(forward) < 0.9) {
    fail('landing marker left the mouse look');
  }
  const shot = blankIntent();
  shot.shootHeld = true;
  shot.lookDelta.x = 0.2;
  const lockedYaw = sim.yaw;
  sim.armShotAim(shot);
  sim.applyFrameLook(shot);
  if (Math.abs(sim.yaw - lockedYaw) > 1e-6) fail('throw hold did not freeze the camera');
  if (sim.shotAim.bendRight < 0.15 * sim.tunables.arcBendSpeed) fail('throw hold did not bend');
  sim.step(1 / 60, shot);
  sim.updateAimPresentation(shot, 1 / 60);
  if (sim.chargeGhost.length < 4) fail('throw hold hid the curve');
  if (!sim.landingMarker.visible) fail('throw hold hid the landing marker');
  if (sim.landingMarker.position.distanceTo(sim.shotAim.target) > 0.02) {
    fail('curve marker left the landing point');
  }
  const throwReach = sim.shotAim.target.distanceTo(holdPoint(sim));
  if (throwReach > sim.tunables.arcAimDistance * 0.45) {
    fail(`low power marker was not in close (${throwReach.toFixed(1)})`);
  }
  const aimFromHand = sim.shotAim.target.clone().sub(holdPoint(sim));
  if (aimFromHand.lengthSq() < 1e-6 || aimFromHand.normalize().dot(forward) < 0.95) {
    fail('throw marker left the locked aim');
  }
  const frozen = sim.shotAim.target.clone();
  shot.move.set(0, 0, 1);
  shot.lookDelta.x = 0;
  const at = human.position.clone();
  for (let i = 0; i < 20; i++) sim.step(1 / 60, shot);
  if (sim.shotAim.target.distanceTo(frozen) < 0.25) fail('marker stayed frozen in the world');
  if (human.position.distanceTo(at) < 0.15) fail('throw hold ignored WASD');
  const bodyAim = sim.shotAim.target.clone().sub(holdPoint(sim));
  if (bodyAim.lengthSq() < 1e-6 || bodyAim.normalize().dot(forward) < 0.9) {
    fail('marker left the swimmer');
  }
  if (sim.charge.amount < 0.2) fail(`power did not charge during the throw (${sim.charge.amount.toFixed(2)})`);
  sim.step(1 / 60, blankIntent());
  if (!sim.ball.arc) fail('release did not throw');
  if (sim.charge.active) fail('power kept charging after release');
}

function checkArenaShell(): void {
  const saved = ARENA_RADIUS;
  try {
    setArenaRadius(saved * 1.22);
    for (const index of [0, 1, 2] as const) {
      const corner = goalCornerWorld(0, index);
      const shell = ARENA_RADIUS - 0.2;
      if (Math.abs(corner.length() - shell) > 0.05) {
        fail(`goal corner left the shell (${corner.length().toFixed(2)} vs ${shell.toFixed(2)})`);
      }
    }
    const sim = new Simulation(defaultTunables());
    sim.resizeArena(ARENA_RADIUS * 0.82);
    const shell = ARENA_RADIUS - 0.2;
    for (const index of [0, 1, 2] as const) {
      const corner = goalCornerWorld(1, index);
      if (Math.abs(corner.length() - shell) > 0.05) {
        fail(`resize left the goal off the shell (${corner.length().toFixed(2)} vs ${shell.toFixed(2)})`);
      }
    }
    for (const p of sim.players) {
      if (p.position.length() > ARENA_RADIUS - PLAYER.radius + 0.08) {
        fail('player outside the shell after an arena resize');
      }
    }
  } finally {
    setArenaRadius(saved);
  }
}

function shotSide(sim: Simulation): number {
  const arc = sim.ball.arc;
  if (!arc) fail('shot missing');
  const mid = new THREE.Vector3();
  quadraticPoint(mid, arc.p0, arc.p1, arc.p2, 0.5);
  const chordMid = arc.p0.clone().lerp(arc.p2, 0.5);
  const right = lookBasis(sim.yaw, sim.pitch, sim.tunables.goalAxisUp).right;
  return mid.sub(chordMid).dot(right);
}

function checkThrowPower(): void {
  const straight = aimingSim();
  straight.sim.tunables.shotCarry = 0;
  straight.sim.shotAim.bendRight = 11;
  straight.sim.shotAim.bendUp = -6;
  straight.sim.step(1 / 60, straight.hold);
  if (Math.hypot(straight.sim.shotAim.bendRight, straight.sim.shotAim.bendUp) > 0.02) {
    fail('press did not reset the curve');
  }
  straight.sim.step(1 / 60, blankIntent());
  if (!straight.sim.ball.arc) fail('click did not throw');
  const side = shotSide(straight.sim);
  if (Math.abs(side) > 0.08) fail(`no-movement throw curved ${side.toFixed(2)}`);

  const slide = aimingSim();
  slide.sim.tunables.shotPowerRate = 1;
  slide.sim.tunables.shotCarry = 0;
  slide.sim.step(1 / 60, slide.hold);
  const d0 = slide.sim.shotAim.target.distanceTo(holdPoint(slide.sim));
  for (let i = 0; i < 40; i++) slide.sim.step(1 / 60, slide.hold);
  const d1 = slide.sim.shotAim.target.distanceTo(holdPoint(slide.sim));
  if (d1 < d0 + 8) fail(`marker distance did not grow with power (${d0.toFixed(1)} → ${d1.toFixed(1)})`);
  for (let i = 0; i < 50; i++) slide.sim.step(1 / 60, slide.hold);
  const d2 = slide.sim.shotAim.target.distanceTo(holdPoint(slide.sim));
  if (d2 > d1 - 3) fail(`marker did not slide back as power fell (${d1.toFixed(1)} → ${d2.toFixed(1)})`);
  if (slide.sim.landingMarker.minPosition.distanceTo(slide.sim.landingMarker.maxPosition) < 8) {
    fail('reach envelope did not separate min and max');
  }
  slide.sim.tunables.shotPowerRate = 0;
  const at = slide.human.position.clone();
  const mark = slide.sim.shotAim.target.clone();
  slide.hold.move.set(1, 0, 0);
  for (let i = 0; i < 24; i++) slide.sim.step(1 / 60, slide.hold);
  const playerDelta = slide.human.position.clone().sub(at);
  const markDelta = slide.sim.shotAim.target.clone().sub(mark);
  if (playerDelta.length() < 0.2) fail('throw drift did not move the swimmer');
  if (markDelta.distanceTo(playerDelta) > 0.55) fail('marker did not stay on the swimmer');

  const soft = aimingSim();
  soft.sim.tunables.powerMode = 'tap';
  soft.sim.tunables.tapWindow = 0.45;
  soft.sim.tunables.tapMax = 5;
  soft.sim.tunables.shotCarry = 0;
  soft.sim.step(1 / 60, soft.hold);
  soft.sim.shotAim.bendRight = 3;
  soft.sim.step(1 / 60, blankIntent());
  if (Boolean(soft.sim.ball.arc)) fail('tap mode threw before any tap');
  if (!soft.sim.shotAim.active || soft.sim.ball.possession !== 'held') fail('tap release dropped the aim');
  if (Math.abs(soft.sim.shotAim.bendRight - 3) > 0.01) fail('tap release cleared the curve');
  let firedAt = -1;
  let speed = 0;
  const windowFrames = Math.round(soft.sim.tunables.tapWindow * 60);
  for (let i = 0; i < windowFrames + 8; i++) {
    soft.sim.step(1 / 60, blankIntent());
    if (firedAt < 0 && soft.sim.ball.arc) {
      firedAt = i + 1;
      speed = soft.sim.ball.arc.carrySpeed;
    }
  }
  if (firedAt < windowFrames - 3) fail(`0 taps fired early (${firedAt})`);
  if (firedAt < 0 || firedAt > windowFrames + 4) fail(`0 taps did not fire with the window (${firedAt})`);
  if (speed > soft.sim.tunables.shootSpeedMin + 6) fail(`0 taps was not a soft touch (${speed.toFixed(1)})`);
  if (soft.human.burstTime > 0 || soft.human.burstCooldown > 0) fail('tap window triggered a check');

  const taps = aimingSim();
  taps.sim.tunables.powerMode = 'tap';
  taps.sim.tunables.tapWindow = 0.45;
  taps.sim.tunables.tapMax = 5;
  taps.sim.tunables.shotCarry = 0;
  taps.sim.step(1 / 60, taps.hold);
  taps.sim.shotAim.bendRight = 3;
  taps.sim.step(1 / 60, blankIntent());
  const click = blankIntent();
  click.shoot = true;
  click.shootHeld = true;
  click.burst = true;
  let tapFire = -1;
  let tapSpeed = 0;
  let pulse = 0;
  for (let i = 0; i < 5; i++) {
    taps.sim.step(1 / 60, click);
    pulse = Math.max(pulse, taps.sim.landingMarker.pulse);
    if (tapFire < 0 && taps.sim.ball.arc) {
      tapFire = i + 1;
      tapSpeed = taps.sim.ball.arc.carrySpeed;
      break;
    }
  }
  if (tapFire !== 5) fail(`5 taps fired at click ${tapFire}`);
  const fullThrow =
    taps.sim.tunables.shootSpeedMax * Math.max(0.2, taps.sim.tunables.throwSpeedScale);
  if (tapSpeed < fullThrow - 1) fail(`5 taps was not full power (${tapSpeed.toFixed(1)})`);
  if (taps.human.burstTime > 0 || taps.human.burstCooldown > 0) fail('power taps triggered a check');
  if (pulse < 0.5) fail('tap did not pulse the marker');
  if (Math.abs(shotSide(taps.sim)) < 0.4) fail('taps re-aimed and cleared the curve');
  if (tapFire > 8) fail('5 taps waited for the window');
}

/** A reported palm owns the carry point. Procedural swimmers keep the chest offset. */
function checkCarryPalm(): void {
  const sim = new Simulation(defaultTunables());
  sim.kickoffLock = 0;
  quietRoster(sim);
  const human = sim.getHuman();
  human.position.set(0, 0, 0);
  human.velocity.set(0, 0, 0);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  human.hasBall = true;
  human.throwArm = 'right';
  sim.yaw = 0;
  sim.pitch = 0;
  sim.ball.possession = 'held';
  sim.ball.ownerId = human.id;
  sim.ball.lastOwnerId = human.id;
  sim.ball.velocity.set(0, 0, 0);
  sim.ball.position.set(0, 0.15, 0.85);

  const palm = new THREE.Vector3(-0.4, 0.95, 0.35);
  const gap = sim.ball.position.distanceTo(palm);
  sim.setCarryPalm(human.id, palm);
  if (sim.ball.position.distanceTo(palm) < gap * 0.5) fail('setting the palm snapped the ball');

  sim.step(1 / 60, blankIntent());
  const afterOne = sim.ball.position.distanceTo(palm);
  if (afterOne > gap - 0.02) fail('catch did not ease toward the palm');
  if (afterOne < gap * 0.5) fail(`catch lerp snapped (${afterOne.toFixed(2)} of ${gap.toFixed(2)})`);

  for (let i = 0; i < 4; i++) sim.step(1 / 60, blankIntent());
  if (sim.ball.position.distanceTo(palm) > 0.05) {
    fail(`ball did not settle in the palm (${sim.ball.position.distanceTo(palm).toFixed(2)})`);
  }

  human.position.set(2, -1, 0.5);
  sim.step(1 / 60, blankIntent());
  const followed = palm.clone().add(new THREE.Vector3(2, -1, 0.5));
  if (sim.ball.position.distanceTo(followed) > 0.08) {
    fail(`ball did not follow the hand (${sim.ball.position.distanceTo(followed).toFixed(2)})`);
  }

  const atRelease = sim.ball.position.clone();
  const pass = blankIntent();
  pass.pass = true;
  sim.step(1 / 60, pass);
  const released: string = sim.ball.possession;
  if (human.hasBall || released !== 'free') fail('palm pass did not release');
  if (Math.abs(sim.ball.position.y - atRelease.y) > 0.35) {
    fail(`pass left the palm height (${sim.ball.position.y.toFixed(2)} vs ${atRelease.y.toFixed(2)})`);
  }
  if (sim.ball.position.distanceTo(atRelease) > 1.1) fail('pass teleported off the palm');
  if (sim.ball.velocity.z < 8) fail('pass did not leave along the aim');
  for (let i = 0; i < 30; i++) {
    sim.step(1 / 60, blankIntent());
    if (human.hasBall) fail('thrower reclaimed a pass that started in the palm');
  }

  const plain = new Simulation(defaultTunables());
  plain.kickoffLock = 0;
  quietRoster(plain);
  const swimmer = plain.getHuman();
  swimmer.position.set(0, 0, 0);
  swimmer.velocity.set(0, 0, 0);
  swimmer.facing.set(0, 0, 1);
  swimmer.up.set(0, 1, 0);
  swimmer.hasBall = true;
  plain.yaw = 0;
  plain.pitch = 0;
  plain.ball.possession = 'held';
  plain.ball.ownerId = swimmer.id;
  plain.ball.lastOwnerId = swimmer.id;
  plain.ball.velocity.set(0, 0, 0);
  plain.ball.position.set(0, 0.15, 0.85);
  const plainPass = blankIntent();
  plainPass.pass = true;
  plain.step(1 / 60, plainPass);
  if (plain.ball.position.y > 0.35) fail('offset pass stayed up on a palm that was never reported');
  const gapRelease = PLAYER.radius + BALL.radius + 0.2;
  if (plain.ball.position.z < gapRelease * 0.8) fail('offset pass did not start in front of the body');

  const checkSim = new Simulation(defaultTunables());
  checkSim.setSoloOpponent(false);
  checkSim.kickoffLock = 0;
  checkSim.tunables.defenseActive = false;
  const you = checkSim.getHuman();
  const enemy = checkSim.players.find((p) => p.team === 1 && p.role === 'ai');
  if (!enemy) fail('missing a carrier to check');
  you.position.set(0, 0, -4);
  you.velocity.set(0, 0, 0);
  you.facing.set(0, 0, 1);
  you.up.set(0, 1, 0);
  you.burstCooldown = 0;
  checkSim.yaw = 0;
  checkSim.pitch = 0;
  enemy.position.set(0, 0, 6);
  enemy.velocity.set(0, 0, 0);
  enemy.facing.set(0, 0, 1);
  enemy.up.set(0, 1, 0);
  enemy.hasBall = true;
  enemy.active = true;
  checkSim.ball.possession = 'held';
  checkSim.ball.ownerId = enemy.id;
  checkSim.ball.lastOwnerId = enemy.id;
  checkSim.ball.velocity.set(0, 0, 0);
  checkSim.ball.position.copy(enemy.position);
  checkSim.setCarryPalm(enemy.id, enemy.position.clone().add(new THREE.Vector3(0, 1.05, 0.3)));
  for (let i = 0; i < 5; i++) checkSim.step(1 / 60, blankIntent());
  you.position.set(0, 0, 0);
  enemy.position.set(0, 0, 0.85);
  const check = blankIntent();
  check.burst = true;
  check.move.set(0, 0, 1);
  checkSim.step(1 / 60, check);
  const loose: string = checkSim.ball.possession;
  if (enemy.hasBall || loose !== 'free') fail('check did not knock the palmed ball loose');
  if (checkSim.ball.position.y < 0.7) {
    fail(`check teleported the ball off the palm (${checkSim.ball.position.y.toFixed(2)})`);
  }
  if (checkSim.ball.velocity.z < 6) fail('checked palm ball was not thrown forward');
}

/** Soft and full throws are different poses, and the release starts on the windup. */
function checkThrowPoses(): void {
  const low = sampleThrowPose(0, -1, false, 0, 0, true);
  const high = sampleThrowPose(1, -1, false, 0, 0, true);
  const cradle = Math.hypot(low.handX + 0.16, low.handY - 0.2, low.handZ - 0.5);
  if (cradle > 0.28) fail(`soft windup left the cradle (${cradle.toFixed(2)})`);
  if (!(high.handZ < low.handZ - 0.2)) fail('full windup did not cock the hand back');
  if (Math.abs(high.chestYaw) < Math.abs(low.chestYaw) + 0.2) fail('full windup did not twist the chest');
  if (high.offWeight < 0.6) fail('full windup did not bring the off arm in');
  if (low.offWeight > 0.35) fail('soft windup pulled the off arm off the stroke');

  const letGo = sampleThrowPose(1, 0, false, 0, 0, true);
  const popped = Math.hypot(letGo.handX - high.handX, letGo.handY - high.handY, letGo.handZ - high.handZ);
  if (popped > 0.02) fail(`release popped off the windup (${popped.toFixed(3)})`);

  const snap = sampleThrowPose(1, 0.25, false, 0, 0, true);
  if (snap.handZ < high.handZ + 0.15) fail('full throw did not snap the hand forward');
  const softSnap = sampleThrowPose(0, 0.25, false, 0, 0, true);
  const fullArc = Math.hypot(snap.handX - high.handX, snap.handY - high.handY, snap.handZ - high.handZ);
  const softArc = Math.hypot(softSnap.handX - low.handX, softSnap.handY - low.handY, softSnap.handZ - low.handZ);
  if (fullArc < softArc + 0.15) fail('full throw arc was not larger than the soft flick');

  const done = sampleThrowPose(1, 1, false, 0, 0, true);
  if (done.armWeight > 0.02) fail('follow-through did not blend back into the stroke');

  const pass = sampleThrowPose(1, -1, true, 0, 0, true);
  if (pass.handZ < high.handZ + 0.2) fail('a pass windup was as cocked as a full shot');

  const straight = sampleThrowPose(0.8, -1, false, 0, 0, true);
  const curved = sampleThrowPose(0.8, -1, false, 1, 0, true);
  if (!(curved.handX < straight.handX - 0.02)) fail('curve did not lead the throwing hand');
  const left = sampleThrowPose(1, -1, false, 0, 0, false);
  if (left.handX <= 0.02) fail('left throw arm did not mirror');
  if (left.chestYaw < 0.2) fail('left throw did not mirror the chest');

  if (Math.abs(throwPoseSeconds(0) - 0.25) > 0.001) fail('soft throw was not a short follow-through');
  if (Math.abs(throwPoseSeconds(1) - 0.45) > 0.001) fail('full throw was not a long follow-through');
  if (throwPoseSeconds(1, true) >= throwPoseSeconds(1)) fail('a pass follow-through was not lighter');

  const soft = new Simulation(defaultTunables());
  soft.kickoffLock = 0;
  soft.tunables.powerMode = 'hold';
  quietRoster(soft);
  const swimmer = soft.getHuman();
  swimmer.position.set(0, 0, 0);
  swimmer.velocity.set(0, 0, 0);
  swimmer.facing.set(0, 0, 1);
  swimmer.up.set(0, 1, 0);
  swimmer.hasBall = true;
  soft.ball.possession = 'held';
  soft.ball.ownerId = swimmer.id;
  soft.ball.lastOwnerId = swimmer.id;
  soft.ball.position.set(0, 0.15, 0.85);
  const press = blankIntent();
  press.shootHeld = true;
  soft.step(1 / 60, press);
  soft.step(1 / 60, blankIntent());
  if (swimmer.actionPose !== 'shoot') fail('soft release did not play the throw');
  if (swimmer.actionPoseDuration < 0.24 || swimmer.actionPoseDuration > 0.32) {
    fail(`soft follow-through was ${swimmer.actionPoseDuration.toFixed(3)}s`);
  }

  const { sim, human, hold } = aimingSim();
  sim.tunables.powerMode = 'hold';
  sim.tunables.shotPowerRate = 4;
  fillThrow(sim, hold);
  if (human.actionPose !== 'hold') fail('a full charge left the carry pose');
  sim.step(1 / 60, blankIntent());
  const posed: string = human.actionPose;
  if (posed !== 'shoot') fail('full release did not play the throw');
  if (human.actionPoseDuration < 0.42) fail(`full follow-through was short (${human.actionPoseDuration.toFixed(3)}s)`);
  if (human.hasBall) fail('full release did not leave the hand');
}

/** Target picks a spot, pull scales with the drag, and right-click drops the throw. */
function checkAimPowerModes(): void {
  const aimed = aimingSim();
  aimed.sim.tunables.powerMode = 'target';
  aimed.hold.shootHeld = true;
  aimed.sim.step(1 / 60, aimed.hold);
  const started = aimed.sim.landingMarker.distance;
  if (Math.abs(started - aimed.sim.tunables.arcAimDistance) > 2) {
    fail(`target mode did not start on the aim point (${started.toFixed(1)})`);
  }
  const pullIn = blankIntent();
  pullIn.shootHeld = true;
  pullIn.lookDelta.y = 0.45;
  aimed.sim.applyFrameLook(pullIn);
  if (aimed.sim.landingMarker.distance > started - 4) fail('mouse down did not bring the target in');
  const bendBefore = aimed.sim.shotAim.bendRight;
  const slide = blankIntent();
  slide.shootHeld = true;
  slide.lookDelta.x = 0.25;
  aimed.sim.applyFrameLook(slide);
  if (aimed.sim.shotAim.bendRight <= bendBefore + 0.5) fail('target mode ignored sideways curve');
  const spot = aimed.sim.shotAim.target.clone();
  aimed.sim.step(1 / 60, blankIntent());
  if (aimed.human.hasBall) fail('target release did not throw');
  let best = aimed.sim.ball.position.distanceTo(spot);
  for (let i = 0; i < 150; i++) {
    aimed.sim.step(1 / 60, blankIntent());
    best = Math.min(best, aimed.sim.ball.position.distanceTo(spot));
  }
  if (best > 2.5) fail(`target shot missed the chosen spot (${best.toFixed(2)})`);

  const pushed = aimingSim();
  pushed.sim.tunables.powerMode = 'target';
  pushed.hold.shootHeld = true;
  pushed.sim.step(1 / 60, pushed.hold);
  const past = blankIntent();
  past.shootHeld = true;
  past.lookDelta.y = -0.8;
  pushed.sim.applyFrameLook(past);
  if (!pushed.sim.landingMarker.outOfReach) fail('a spot past full power did not dim the marker');
  if (pushed.sim.charge.amount < 0.98) fail('an out-of-reach target did not clamp power');

  const sling = aimingSim();
  sling.sim.tunables.powerMode = 'pull';
  sling.hold.shootHeld = true;
  sling.sim.step(1 / 60, sling.hold);
  if (sling.sim.charge.amount > 0.08) fail('pull mode did not start as a soft toss');
  const back = blankIntent();
  back.shootHeld = true;
  back.lookDelta.y = 0.4;
  sling.sim.applyFrameLook(back);
  const mid = sling.sim.charge.amount;
  sling.sim.applyFrameLook(back);
  if (sling.sim.charge.amount < mid + 0.15) fail('a longer pull did not add power');
  if (!sling.sim.pullBand.visible) fail('pull mode hid the stretch');
  const side = blankIntent();
  side.shootHeld = true;
  side.lookDelta.x = 0.35;
  sling.sim.applyFrameLook(side);
  if (Math.abs(sling.sim.shotAim.bendRight) < 1) fail('sideways drift did not curve the pull');
  if (sling.sim.landingMarker.distance < 6) fail('pull power did not slide the marker out');

  const held = aimingSim();
  held.sim.tunables.powerMode = 'hold';
  held.hold.shootHeld = true;
  for (let i = 0; i < 20; i++) held.sim.step(1 / 60, held.hold);
  if (!held.sim.shotAim.active || held.sim.charge.amount < 0.2) fail('cancel setup never started a throw');
  const drop = blankIntent();
  drop.shootHeld = true;
  drop.aimCancel = true;
  drop.strafe = true;
  held.sim.step(1 / 60, drop);
  if (!held.human.hasBall || held.sim.ball.possession !== 'held') fail('right-click released the held throw');
  if (held.sim.shotAim.active || held.sim.charge.active) fail('right-click left the throw armed');
  const still = blankIntent();
  still.shootHeld = true;
  held.sim.armShotAim(still);
  held.sim.step(1 / 60, still);
  if (held.sim.shotAim.active) fail('the held button started a new throw after cancel');
  held.sim.step(1 / 60, blankIntent());
  if (!held.human.hasBall) fail('letting go after cancel threw the ball');

  const taps = aimingSim();
  taps.sim.tunables.powerMode = 'tap';
  taps.hold.shootHeld = true;
  taps.sim.step(1 / 60, taps.hold);
  taps.sim.step(1 / 60, blankIntent());
  if (!taps.human.hasBall || !taps.sim.shotAim.active) fail('tap window did not stay armed');
  const abort = blankIntent();
  abort.aimCancel = true;
  taps.sim.step(1 / 60, abort);
  if (!taps.human.hasBall) fail('right-click during the tap window released the ball');
  if (taps.sim.shotAim.active || taps.sim.charge.active) fail('the tap window stayed open after cancel');
  for (let i = 0; i < 40; i++) taps.sim.step(1 / 60, blankIntent());
  if (!taps.human.hasBall) fail('a cancelled tap window threw when it would have closed');
}

function quatDelta(a: THREE.Quaternion, b: THREE.Quaternion): number {
  return 2 * Math.acos(Math.min(1, Math.abs(a.dot(b))));
}

/** A throw rig whose tread clip does not key the chest, which is how the windup used to spin. */
function windupRig(): { group: THREE.Group; rig: SwimmerRig } {
  const group = new THREE.Group();
  const model = new THREE.Group();
  const root = new THREE.Bone();
  root.name = 'Root';
  const at = (name: string, y: number, x = 0): THREE.Bone => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(x, y, 0);
    return bone;
  };
  const trans = at('Trans', 0);
  const spine = at('Spine', 0.15);
  const chest = at('Chest', 0.16);
  const neck = at('Neck', 0.1);
  const head = at('Head', 0.1);
  const upperL = at('UpperArm_L', 0.08, 0.18);
  const lowerL = at('LowerArm_L', -0.26);
  const handL = at('Hand_L', -0.22);
  const upperR = at('UpperArm_R', 0.08, -0.18);
  const lowerR = at('LowerArm_R', -0.26);
  const handR = at('Hand_R', -0.22);
  const hips = at('Hips', -0.08);
  const thighL = at('Thigh_L', -0.16, 0.08);
  const thighR = at('Thigh_R', -0.16, -0.08);
  root.add(trans);
  trans.add(spine, hips);
  spine.add(chest);
  chest.add(neck, upperL, upperR);
  neck.add(head);
  upperL.add(lowerL);
  lowerL.add(handL);
  upperR.add(lowerR);
  lowerR.add(handR);
  hips.add(thighL, thighR);
  model.add(root);
  group.add(model);

  const ident = [0, 0, 0, 1, 0, 0, 0, 1];
  const track = (name: string) => new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, [0, 1], ident);
  const mixer = new THREE.AnimationMixer(root);
  const swim = mixer.clipAction(
    new THREE.AnimationClip('Swim', 1, ['Chest', 'Spine', 'Head', 'UpperArm_L', 'UpperArm_R', 'Thigh_L', 'Thigh_R'].map(track)),
  );
  const tread = mixer.clipAction(
    new THREE.AnimationClip('Tread', 1, ['Spine', 'Head', 'UpperArm_L', 'UpperArm_R', 'Thigh_L', 'Thigh_R'].map(track)),
  );
  swim.setLoop(THREE.LoopRepeat, Infinity);
  tread.setLoop(THREE.LoopRepeat, Infinity);
  swim.play();
  tread.play();
  tread.setEffectiveWeight(1);
  swim.setEffectiveWeight(0);
  mixer.update(0);

  const rig: SwimmerRig = {
    model,
    mixer,
    swim,
    tread,
    idle: null,
    spine,
    chest,
    upperL,
    lowerL,
    handL,
    upperR,
    lowerR,
    handR,
    hips,
    thighL,
    thighR,
    head,
    neck,
    lenUpperL: lowerL.position.length(),
    lenLowerL: handL.position.length(),
    lenUpperR: lowerR.position.length(),
    lenLowerR: handR.position.length(),
    swimWeight: 0,
    catchBlend: 0,
    holdBlend: 0,
    throwShown: 0,
    curveRightShown: 0,
    curveUpShown: 0,
    speedSwim: 0,
    aimPosture: 0,
    posed: [],
    hasClip: false,
    aimSpring: spring1(),
    wIdle: spring1(),
    wTread: spring1(1),
    wSwim: spring1(),
    stroke: spring1(),
    catchSpring: spring1(),
    holdSpring: spring1(),
    throwSpring: spring1(),
    curveRightSpring: spring1(),
    curveUpSpring: spring1(),
    kickSpring: spring1(),
    burstSpring: spring1(),
    bankSpring: spring1(),
    pitchSpring: spring1(),
    headYaw: spring1(),
    headPitch: spring1(),
    armLag: spring1(),
    legLag: spring1(),
    prevFacing: new THREE.Vector3(),
  };
  return { group, rig };
}

function checkWindupSpin(): void {
  const sim = new Simulation(defaultTunables());
  sim.kickoffLock = 0;
  sim.setSoloOpponent(false);
  quietRoster(sim);
  sim.tunables.powerMode = 'hold';
  sim.tunables.shotPowerRate = 8;
  const human = sim.getHuman();
  human.position.set(0, 0, 0);
  human.velocity.set(0, 0, 0);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  human.hasBall = true;
  sim.ball.possession = 'held';
  sim.ball.ownerId = human.id;
  sim.ball.position.set(0, 0.2, 0.7);
  const charging = blankIntent();
  charging.shootHeld = true;

  sim.yaw = 0;
  sim.armShotAim(charging);
  sim.step(1 / 60, charging);
  let maxFacing = 0;
  let maxUp = 0;
  for (let i = 0; i < 240; i++) {
    // Sweep the aim through the direction behind the swimmer, across the ±180° seam.
    sim.yaw = -Math.PI * 0.95 + (i / 239) * Math.PI * 1.9;
    const before = human.facing.clone();
    const beforeUp = human.up.clone();
    sim.armShotAim(charging);
    sim.step(1 / 60, charging);
    if (human.facing.lengthSq() < 0.9 || !Number.isFinite(human.facing.x)) fail('facing collapsed during the windup');
    if (human.up.lengthSq() < 0.9 || !Number.isFinite(human.up.x)) fail('body up collapsed during the windup');
    const step = angle(before, human.facing);
    const upStep = angle(beforeUp, human.up);
    if (step > (25 * Math.PI) / 180) fail(`body spun ${deg(step).toFixed(1)}° in one windup frame`);
    if (upStep > (20 * Math.PI) / 180) fail(`body up spun ${deg(upStep).toFixed(1)}° in one windup frame`);
    maxFacing = Math.max(maxFacing, step);
    maxUp = Math.max(maxUp, upStep);
  }
  const aim = lookBasis(sim.yaw, sim.pitch, sim.tunables.goalAxisUp).forward;
  for (let i = 0; i < 50; i++) {
    sim.armShotAim(charging);
    sim.step(1 / 60, charging);
  }
  if (human.facing.dot(aim) < 0.95) {
    fail(`facing did not settle on the aim (${human.facing.dot(aim).toFixed(2)})`);
  }

  const { group, rig } = windupRig();
  let maxChest = 0;
  let prevUpper = rig.upperR.quaternion.clone();
  let settledChest = 0;
  let settledArm = 0;
  sim.yaw = 0.4;
  for (let i = 0; i < 150; i++) {
    sim.armShotAim(charging);
    sim.step(1 / 60, charging);
    updateSwimmerRig(rig, group, human, sim, 1 / 60);
    const clip = rig.posed.find((entry) => entry.bone === rig.chest);
    if (!clip) fail('chest pose was not sampled');
    const chest = quatDelta(rig.chest.quaternion, clip.clip);
    if (!Number.isFinite(chest)) fail('chest rotation became non-finite');
    if (chest > 1.2) fail(`chest offset ran away (${chest.toFixed(2)} rad)`);
    const armStep = quatDelta(rig.upperR.quaternion, prevUpper);
    if (i > 40 && armStep > 0.75) fail(`throw arm spun ${deg(armStep).toFixed(1)}° in one frame`);
    maxChest = Math.max(maxChest, chest);
    prevUpper.copy(rig.upperR.quaternion);
    if (i === 90) settledChest = chest;
    if (i === 149) {
      settledArm = armStep;
      if (Math.abs(chest - settledChest) > 0.08) fail(`chest offset did not settle (${chest.toFixed(2)} vs ${settledChest.toFixed(2)})`);
    }
  }
  if (settledArm > 0.12) fail(`throw arm kept moving after the windup settled (${deg(settledArm).toFixed(1)}°)`);
  if (maxChest < 0.05) fail('windup did not pose the chest at all');
  if (maxFacing > (25 * Math.PI) / 180) fail('recorded facing step exceeded the cap');
  if (maxUp > (20 * Math.PI) / 180) fail('recorded up step exceeded the cap');
}

function checkAimPosture(): void {
  const base = {
    human: true,
    strafing: false,
    hasBall: false,
    catchReady: false,
    throwing: false,
    burst: false,
    pose: 'none' as const,
  };
  if (!wantsAimPosture({ ...base, strafing: true, hasBall: true, pose: 'hold' })) {
    fail('right-click aim should stand up into the tread');
  }
  if (!wantsAimPosture({ ...base, strafing: true, catchReady: false })) {
    fail('square up without the ball should tread');
  }
  if (wantsAimPosture({ ...base, hasBall: true, pose: 'hold' })) {
    fail('carrying without aim should stay on the speed swim');
  }
  if (!wantsAimPosture({ ...base, throwing: true, pose: 'shoot' })) {
    fail('a throw should keep the tread until it ends');
  }
  if (wantsAimPosture({ ...base, strafing: true, hasBall: true, burst: true, pose: 'burst' })) {
    fail('a shoulder check should not tread');
  }
  if (!wantsAimPosture({ ...base, human: false, hasBall: true, pose: 'hold' })) {
    fail('an AI carrier should tread');
  }
  if (!wantsAimPosture({ ...base, human: false, hasBall: true, throwing: true, pose: 'pass' })) {
    fail('an AI pass should tread');
  }
  if (!wantsAimPosture({ ...base, human: false, catchReady: true })) {
    fail('a receiver in catch-ready should tread');
  }

  const posture = { value: 0, vel: 0 };
  for (let i = 0; i < 15; i++) stepAimPosture(posture, true, 0.25, 1 / 60);
  if (posture.value < 0.9) fail(`aim posture did not settle in 0.25s (${posture.value.toFixed(2)})`);
  for (let i = 0; i < 15; i++) stepAimPosture(posture, false, 0.25, 1 / 60);
  if (posture.value > 0.1) fail(`aim posture did not release in 0.25s (${posture.value.toFixed(2)})`);

  const level = aimPosturePitch(0, 1);
  if (level < 0.12 || level > 0.35) fail(`level aim should lean slightly (${level.toFixed(2)})`);
  const raised = aimPosturePitch(Math.sin(0.8), 1);
  if (raised < level + 0.5) fail('an upward aim should pitch the visual body back toward vertical');
  if (aimPosturePitch(0.4, 0) !== 0) fail('the swim posture should not take the aim pitch');
}

function checkRosterEdit(): void {
  const saved = parseRoster(JSON.stringify({ home: ['normal'], away: ['chaser', 'normal'] }));
  if (!saved || saved.home.join() !== 'normal' || saved.away.join() !== 'chaser,normal') {
    fail('roster save did not round-trip');
  }
  if (parseRoster('nope') !== null) fail('broken roster JSON was accepted');
  if (parseRoster(null) !== null) fail('missing roster was accepted');
  if (parseRoster(JSON.stringify({ home: ['fly'], away: [] })) !== null) fail('unknown bot behavior was accepted');
  const clipped = parseRoster(JSON.stringify({ home: Array(8).fill('normal'), away: Array(9).fill('chaser') }));
  if (!clipped || clipped.home.length !== ROSTER.maxSwimmers - 1 || clipped.away.length !== ROSTER.maxSwimmers) {
    fail('roster save ignored the six-swimmer cap');
  }

  const sim = new Simulation(defaultTunables());
  sim.kickoffLock = 0;
  const initial = sim.exportRoster();
  if (initial.home.length !== 0 || initial.away.length !== 1 || initial.away[0] !== 'chaser') {
    fail(`default roster was home ${initial.home.join()} away ${initial.away.join()}`);
  }
  if (!sim.addBot(0, 'normal')) fail('could not add a home bot');
  const mate = sim.players.find((p) => p.team === 0 && p.role === 'ai' && p.active);
  if (!mate) fail('home bot did not spawn');
  for (let i = 0; i < 30; i++) sim.step(1 / 60, blankIntent());
  if (!mate.active) fail('added bot was parked again');
  if (sim.exportRoster().away[0] !== 'chaser') fail('adding a teammate cleared the test chaser');

  let guard = 0;
  while (sim.addBot(0, 'normal') && guard < 12) guard++;
  if (sim.exportRoster().home.length !== ROSTER.maxSwimmers - 1) {
    fail(`home roster is ${sim.exportRoster().home.length}, expected ${ROSTER.maxSwimmers - 1}`);
  }
  if (sim.swimmerCount(0) !== ROSTER.maxSwimmers) fail('home side exceeded six swimmers');
  if (sim.addBot(0, 'chaser')) fail('home accepted another bot past six swimmers');

  guard = 0;
  while (sim.addBot(1, 'normal') && guard < 12) guard++;
  if (sim.exportRoster().away.length !== ROSTER.maxSwimmers) {
    fail(`away roster is ${sim.exportRoster().away.length}, expected ${ROSTER.maxSwimmers}`);
  }
  if (sim.addBot(1, 'normal')) fail('away accepted a seventh bot');

  if (sim.removeBot(sim.humanId)) fail('the human was removed');
  if (sim.removeBot(9999)) fail('a missing bot was removed');

  const human = sim.getHuman();
  human.hasBall = true;
  sim.ball.possession = 'held';
  sim.ball.ownerId = human.id;
  const bystander = sim.players.find((p) => p.team === 0 && p.role === 'ai' && p.active);
  if (!bystander || !sim.removeBot(bystander.id)) fail('could not remove a home bot');
  if (bystander.active) fail('removed bot stayed on the field');
  if (sim.ball.ownerId !== human.id || sim.ball.possession !== 'held') fail('removing a bot stole the human ball');

  const carrier = sim.players.find((p) => p.team === 1 && p.role === 'ai' && p.active);
  if (!carrier) fail('away roster was empty');
  const spot = carrier.position.clone();
  carrier.hasBall = true;
  human.hasBall = false;
  sim.ball.possession = 'held';
  sim.ball.ownerId = carrier.id;
  sim.ball.velocity.set(0, 0, 0);
  sim.ball.position.copy(spot);
  if (!sim.removeBot(carrier.id)) fail('could not remove the carrier');
  if (carrier.active) fail('carrier stayed active');
  const dropped: string = sim.ball.possession;
  if (dropped !== 'free' || sim.ball.ownerId !== null) fail('carrier took the ball with them');
  if (sim.ball.position.distanceTo(spot) > 0.05) fail('a dropped ball teleported');
  if (sim.exportRoster().away.includes('chaser') === false && sim.exportRoster().away.length === ROSTER.maxSwimmers) {
    fail('remove did not shrink the away roster');
  }
  if (sim.exportRoster().away.length !== ROSTER.maxSwimmers - 1) fail('away roster did not shrink by one');
  if (!sim.addBot(1, 'normal')) fail('could not refill a freed slot');

  for (const p of [...sim.players]) {
    if (p.role === 'ai' && p.active) sim.removeBot(p.id);
  }
  const empty = sim.exportRoster();
  if (empty.home.length !== 0 || empty.away.length !== 0) fail('roster did not reach zero bots');
  if (!sim.getHuman().active || sim.getHuman().role !== 'human') fail('clearing bots removed the human');
  for (let i = 0; i < 20; i++) sim.step(1 / 60, blankIntent());

  sim.applyRoster({ home: ['chaser', 'normal'], away: [] });
  const applied = sim.exportRoster();
  if (applied.home.join() !== 'chaser,normal' || applied.away.length !== 0) {
    fail(`applyRoster produced home ${applied.home.join()} away ${applied.away.join()}`);
  }
  const chaser = sim.players.find((p) => p.active && p.role === 'ai' && p.aiBehavior === 'chaser');
  const partner = sim.players.find((p) => p.active && p.role === 'ai' && p.aiBehavior === 'normal');
  if (!chaser || !partner) fail('applyRoster did not spawn both behaviors');
  for (const p of sim.players) {
    if (!p.active || p.role === 'stub') continue;
    if (p.position.length() > ARENA_RADIUS - PLAYER.radius + 0.05) fail(`bot ${p.id} spawned outside the shell`);
  }
  sim.ball.possession = 'free';
  sim.ball.ownerId = null;
  sim.ball.claimLock = 5;
  sim.ball.arc = null;
  sim.ball.velocity.set(0, 0, 0);
  sim.ball.position.set(0, 0, 24);
  const startZ = chaser.position.z;
  for (let i = 0; i < 90; i++) sim.step(1 / 60, blankIntent());
  if (!chaser.active || !partner.active) fail('roster changed during play');
  if (chaser.position.z < startZ + 0.4) fail('test chaser did not chase the loose ball');
  if (chaser.velocity.length() > sim.tunables.playerMaxSpeed * 0.62) {
    fail(`test chaser moved at ${chaser.velocity.length().toFixed(2)}`);
  }
  chaser.hasBall = true;
  partner.hasBall = false;
  sim.ball.possession = 'held';
  sim.ball.ownerId = chaser.id;
  sim.ball.velocity.set(0, 0, 0);
  let fired = false;
  for (let i = 0; i < 180; i++) {
    sim.step(1 / 60, blankIntent());
    const poss: string = sim.ball.possession;
    const loose = poss === 'free' && sim.ball.velocity.length() > 8;
    if (sim.ball.arc || loose) fired = true;
  }
  if (fired) fail('test chaser passed or shot');
  if (!chaser.hasBall || sim.ball.ownerId !== chaser.id) fail('test chaser dropped the ball');
}

function checkGoalies(): void {
  const one = matchRoster('1v1', true);
  if (one.home.length !== 0 || one.away.join() !== 'normal' || one.withGoalies) fail('1v1 added a goalie');
  const plus = matchRoster('1v1-goalies', false);
  if (plus.home.join() !== 'goalie' || plus.away.join() !== 'normal,goalie') fail('1v1 + goalies roster is wrong');
  const open = matchRoster('3v3', false);
  if (open.home.length !== 2 || open.away.length !== 3 || open.home.includes('goalie')) {
    fail('3v3 without goalies still kept a keeper');
  }
  const full = matchRoster('5v5', true);
  if (full.home.length !== 5 || full.away.length !== 6) fail('5v5 with goalies does not fit six a side');
  if (full.home.filter((bot) => bot === 'goalie').length !== 1) fail('home 5v5 lost its goalie');
  if (full.away.filter((bot) => bot === 'normal').length !== 5) fail('away 5v5 lost a field player');
  const saved = parseRoster(JSON.stringify({ home: ['goalie'], away: ['normal', 'goalie'], preset: '1v1-goalies' }));
  if (!saved || saved.home[0] !== 'goalie' || saved.preset !== '1v1-goalies') fail('goalie roster did not parse');

  const built = new Simulation(defaultTunables());
  built.applyRoster(matchRoster('4v4', true));
  if (!built.getHuman().active || built.getHuman().role !== 'human') fail('the match preset removed you');
  const home = built.exportRoster().home;
  if (home.length !== 4 || home.filter((bot) => bot === 'goalie').length !== 1) {
    fail(`4v4 home was ${home.join()}`);
  }

  const high = new Simulation(defaultTunables());
  high.applyRoster({ home: [], away: ['goalie'] });
  high.kickoffLock = 0;
  high.tunables.goalieSkill = 100;
  high.tunables.goalieAwayOverride = false;
  high.tunables.ballDrag = 0.2;
  const keeper = high.players.find((p) => p.aiBehavior === 'goalie' && p.active);
  if (!keeper) fail('high-skill goalie did not spawn');
  keeper.position.set(4, 0, keeper.position.z);
  keeper.velocity.set(0, 0, 0);
  const you = high.getHuman();
  you.position.set(-24, 0, -30);
  you.velocity.set(0, 0, 0);
  high.ball.possession = 'free';
  high.ball.ownerId = null;
  high.ball.arc = null;
  high.ball.claimLock = 0;
  high.ball.velocity.set(0, 0, 16);
  high.ball.position.set(0, 0, 40);
  let savedShot = false;
  for (let i = 0; i < 240; i++) {
    high.step(1 / 60, blankIntent());
    if (high.match.score[0] > 0) break;
    if (keeper.hasBall || high.ball.velocity.z < -1) savedShot = true;
  }
  if (high.match.score[0] > 0) fail('a high-skill goalie let a slow straight shot in');
  if (!savedShot) fail('a high-skill goalie did not catch or turn the slow shot');

  const low = new Simulation(defaultTunables());
  low.applyRoster({ home: [], away: ['goalie'] });
  low.kickoffLock = 0;
  low.tunables.goalieSkill = 0;
  low.tunables.ballDrag = 0.2;
  const weak = low.players.find((p) => p.aiBehavior === 'goalie' && p.active);
  if (!weak) fail('low-skill goalie did not spawn');
  low.getHuman().position.set(-24, 0, -30);
  low.getHuman().velocity.set(0, 0, 0);
  low.ball.possession = 'free';
  low.ball.ownerId = null;
  low.ball.arc = null;
  low.ball.claimLock = 0;
  low.ball.velocity.set(0, 0, 42);
  low.ball.position.set(2.8, 0, 36);
  let scored = false;
  for (let i = 0; i < 120 && !scored; i++) {
    low.step(1 / 60, blankIntent());
    scored = low.match.score[0] > 0;
  }
  if (!scored) fail('a low-skill goalie stopped a shot at the far side of the mouth');
  if (weak.hasBall) fail('a low-skill goalie caught the shot they should have missed');
}

function checkCameraSettings(): void {
  const tunables = defaultTunables();
  if (tunables.cameraPreset !== 'default') fail('camera did not start on the Default preset');
  if (tunables.camDistance !== CAMERA.chaseDistance || tunables.camFov !== CAMERA.fov) {
    fail('default follow distance or FOV drifted from the chase camera');
  }
  if (tunables.wideDistance !== CAMERA.zoomOutDistance || !tunables.camShell || tunables.ballCam) {
    fail('default wide view or shell collision changed');
  }
  applyCameraPreset(tunables, 'close');
  const closePreset: string = tunables.cameraPreset;
  if (closePreset !== 'close' || tunables.camDistance >= CAMERA.chaseDistance) {
    fail('Close preset did not pull the camera in');
  }
  tunables.camDistance += 0.4;
  noteCameraEdit(tunables);
  const edited: string = tunables.cameraPreset;
  if (edited !== 'custom') fail('a manual edit stayed on the Close preset');
  const parsed = parseCameraSettings(JSON.stringify(cameraSettingsBlob(tunables)));
  if (!parsed || parsed.preset !== 'custom' || parsed.camDistance !== tunables.camDistance) {
    fail('camera settings did not round-trip');
  }
  if (parseCameraSettings('nope') !== null) fail('broken camera JSON was accepted');
  if (parseCameraSettings(JSON.stringify({ preset: 'fly' })) !== null) fail('unknown camera preset was accepted');
  applyCameraPreset(tunables, 'default');
  if (tunables.camDistance !== CAMERA.chaseDistance || tunables.cameraPreset !== 'default') {
    fail('reset did not restore the Default preset');
  }

  const sim = new Simulation(tunables);
  sim.kickoffLock = 0;
  const human = sim.getHuman();
  human.position.set(0, 0, 0);
  human.velocity.set(0, 0, 0);
  human.facing.set(1, 0, 0);
  human.up.set(0, 1, 0);
  sim.yaw = 0;
  sim.pitch = 0;
  sim.ball.position.set(12, 0, 0);
  sim.ball.velocity.set(0, 0, 0);
  const aim = sim.getCameraPose(blankIntent());
  sim.tunables.lookAhead = 'move';
  human.velocity.set(14, 0, 0);
  const moving = sim.getCameraPose(blankIntent());
  if (moving.target.x <= aim.target.x + 0.4) fail('movement look-ahead ignored swim velocity');
  sim.tunables.lookAhead = 'aim';
  sim.tunables.ballCam = true;
  const tracked = sim.getCameraPose(blankIntent());
  if (tracked.target.distanceTo(sim.ball.position) >= aim.target.distanceTo(sim.ball.position)) {
    fail('ball cam did not look toward the ball');
  }
  sim.tunables.ballCam = false;

  const wide = blankIntent(true);
  const near = sim.getCameraPose(blankIntent()).position.distanceTo(human.position);
  sim.tunables.wideDistance = 50;
  const far = sim.getCameraPose(wide).position.distanceTo(human.position);
  if (far < near + 10) fail(`wide view stayed close (${far.toFixed(1)} vs ${near.toFixed(1)})`);
  if (sim.zoomOutLatched) fail('reading the wide pose latched the wide view');

  const shell = ARENA_RADIUS - PLAYER.radius - 0.05;
  human.position.set(0, 0, shell);
  human.velocity.set(0, 0, 0);
  sim.yaw = Math.PI;
  sim.pitch = 0;
  sim.tunables.camDistance = 18;
  sim.tunables.camPitch = 0;
  sim.tunables.camShell = false;
  if (sim.getCameraPose(blankIntent()).position.length() < ARENA_RADIUS + 1) {
    fail('shell collision off kept a long follow inside the sphere');
  }
  sim.tunables.camShell = true;
  if (sim.getCameraPose(blankIntent()).position.length() > ARENA_RADIUS - CAMERA.wallClearance + 0.05) {
    fail('shell collision on let the camera leave the sphere');
  }

  human.position.set(0, 0, 0);
  human.facing.set(1, 0, 0);
  sim.yaw = 0;
  sim.pitch = 0.2;
  sim.tunables.camRecenter = true;
  sim.tunables.camRecenterDelay = 0.1;
  sim.tunables.camShell = true;
  sim.tunables.camDistance = CAMERA.chaseDistance;
  const before = angle(sim.getCameraPose(blankIntent()).target.clone().sub(human.position).normalize(), human.facing);
  const idle = blankIntent();
  for (let i = 0; i < 40; i++) sim.updateAimPresentation(idle, 1 / 60);
  const afterForward = new THREE.Vector3(0, 0, 1);
  afterForward.copy(lookBasis(sim.yaw, sim.pitch, false).forward);
  const after = angle(afterForward, human.facing);
  if (after > before - 0.2) fail(`auto-recenter left the view ${deg(after).toFixed(1)}° off the body`);
}

function checkWideCamera(): void {
  const sim = new Simulation(defaultTunables());
  if (!sim.tunables.zoomHoldMode) fail('wide camera did not start in hold mode');
  const held = blankIntent(true);
  if (!sim.isZoomOut(held)) fail('held zoom key did not open the wide view');
  if (sim.zoomOutLatched) fail('held zoom key latched the wide view');

  const middle = blankIntent();
  middle.middleZoomPressed = true;
  sim.noteZoomToggle(middle);
  if (!sim.zoomOutLatched || !sim.isZoomOut(blankIntent())) fail('middle click did not turn the wide view on');
  sim.noteZoomToggle(middle);
  if (sim.zoomOutLatched || sim.isZoomOut(blankIntent())) fail('middle click did not turn the wide view off');

  const key = blankIntent();
  key.zoomTogglePressed = true;
  sim.noteZoomToggle(key);
  if (sim.zoomOutLatched) fail('V toggled the wide view while zoom is set to hold');

  sim.tunables.zoomHoldMode = false;
  sim.noteZoomToggle(key);
  if (!sim.zoomOutLatched) fail('V did not toggle the wide view when zoom hold is off');
}

export function runRotationChecks(): void {
  checkRotateToward();
  checkUpPole();
  checkWall();
  checkStrafe();
  checkArcHand();
  checkArcBend();
  checkArcMarker();
  checkArcFlight();
  checkArcClamp();
  checkShapeMath();
  checkArcDefault();
  checkHoldLookOrder();
  checkPowerMeter();
  checkTeammateLock();
  checkPractice();
  checkShoulder();
  checkStraightAimMarker();
  checkCatch();
  checkCatchReadyPass();
  checkDeflect();
  checkKick();
  checkTeammatePassReachesPlayer();
  checkOpponentInterceptsPass();
  checkTackleStillStrips();
  checkArcShotLeavesThrower();
  checkHumanPassReachesTeammate();
  checkNormalCatchRegression();
  checkCatchPose();
  checkGoalMouth();
  checkTriangleOpening();
  checkBodiesSeparate();
  checkShoulderCheck();
  checkTackleCharge();
  checkDrillOpponent();
  checkRosterEdit();
  checkGoalies();
  checkArenaShell();
  checkWallRicochet();
  checkRimDeflection();
  checkGoalStaysVisible();
  checkShotIntoGoal();
  checkShotSteer();
  checkThrowAim();
  checkThrowPower();
  checkCarryPalm();
  checkThrowPoses();
  checkAimPowerModes();
  checkAimPosture();
  checkWindupSpin();
  checkAiShootsOpenLane();
  checkAiPassesWhenPressured();
  checkAiPassReachesReceiver();
  checkCameraSettings();
  checkWideCamera();
  checkBallFit();
  checkSpeeds();
  checkBurst();
  checkPointerLockGuard();
  checkCatchBeacon();
  checkGoalBoundArc();
  checkVerticalLook();
  checkCamera(false, false);
  checkCamera(false, true);
  checkCamera(true, false);
  checkCamera(true, true);
}

runRotationChecks();
function giveBallTo(sim: Simulation, player: ReturnType<Simulation['getHuman']>, offset: THREE.Vector3): void {
  for (const other of sim.players) other.hasBall = false;
  player.hasBall = true;
  sim.ball.possession = 'held';
  sim.ball.ownerId = player.id;
  sim.ball.lastOwnerId = player.id;
  sim.ball.arc = null;
  sim.ball.claimLock = 0;
  sim.ball.velocity.set(0, 0, 0);
  sim.ball.position.copy(player.position).add(offset);
}

/** In range of the goal, with nobody in the lane, a carrier shoots. */
function checkAiShootsOpenLane(): void {
  const sim = new Simulation(defaultTunables());
  sim.kickoffLock = 0;
  sim.setSoloOpponent(false);
  sim.tunables.defenseActive = false;
  sim.tunables.fieldSkillA = 100;
  sim.tunables.fieldSkillB = 100;
  const human = sim.getHuman();
  const mate = sim.players.find((p) => p.team === 0 && p.role === 'ai' && p.active);
  const defense = sim.players.find((p) => p.team === 1 && p.active);
  if (!mate || !defense) fail('roster missing');
  human.position.set(0, 0, -36);
  human.velocity.set(0, 0, 0);
  defense.position.set(-28, 16, -24);
  defense.velocity.set(0, 0, 0);
  mate.position.set(0, 0, goalMouthZ() - 18);
  mate.velocity.set(0, 0, 0);
  mate.facing.set(0, 0, 1);
  mate.up.set(0, 1, 0);
  giveBallTo(sim, mate, new THREE.Vector3(0, 0.15, 0.7));
  const intent = blankIntent();
  for (let i = 0; i < 90; i++) {
    sim.step(1 / 60, intent);
    if (!mate.hasBall && sim.ball.lastOwnerId === mate.id) {
      const travel = sim.ball.arc ? sim.ball.arc.p2.clone().sub(sim.ball.arc.p0) : sim.ball.velocity.clone();
      if (travel.z <= 4) fail(`open shot did not go toward the goal (${travel.z.toFixed(1)})`);
      if (sim.ball.arc?.receiverId !== null && sim.ball.arc) fail('open shot was aimed at a teammate');
      return;
    }
  }
  fail('carrier in range with an open lane did not shoot');
}

/** A nearby defender and a better-placed teammate produce a pass, not a carry. */
function checkAiPassesWhenPressured(): void {
  const sim = new Simulation(defaultTunables());
  sim.kickoffLock = 0;
  sim.setSoloOpponent(false);
  sim.tunables.defenseActive = false;
  sim.tunables.fieldSkillA = 100;
  const human = sim.getHuman();
  const mate = sim.players.find((p) => p.team === 0 && p.role === 'ai' && p.active);
  const defense = sim.players.find((p) => p.team === 1 && p.active);
  if (!mate || !defense) fail('roster missing');
  mate.position.set(0, 0, -20);
  mate.velocity.set(0, 0, 0);
  mate.facing.set(0, 0, 1);
  mate.up.set(0, 1, 0);
  human.position.set(6, 0, 16);
  human.velocity.set(0, 0, 0);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  defense.position.set(-5, 0, -20);
  defense.velocity.set(0, 0, 0);
  giveBallTo(sim, mate, new THREE.Vector3(0, 0.15, 0.6));
  const intent = blankIntent();
  for (let i = 0; i < 80; i++) {
    sim.step(1 / 60, intent);
    if (!mate.hasBall && sim.ball.lastOwnerId === mate.id) {
      if (sim.ball.arc?.receiverId !== human.id) fail(`pressured carrier did not pass to the open teammate`);
      return;
    }
  }
  fail('pressured carrier with an open teammate did not pass');
}

/** Nobody in the lane: the pass arrives and the receiver ends up with the ball. */
function checkAiPassReachesReceiver(): void {
  const sim = new Simulation(defaultTunables());
  sim.kickoffLock = 0;
  sim.setSoloOpponent(false);
  sim.tunables.defenseActive = false;
  sim.tunables.fieldSkillA = 100;
  const human = sim.getHuman();
  const mate = sim.players.find((p) => p.team === 0 && p.role === 'ai' && p.active);
  const defense = sim.players.find((p) => p.team === 1 && p.active);
  if (!mate || !defense) fail('roster missing');
  mate.position.set(0, 0, -22);
  mate.velocity.set(0, 0, 0);
  mate.facing.set(0, 0, 1);
  mate.up.set(0, 1, 0);
  human.position.set(2, 0, 12);
  human.velocity.set(0, 0, 0);
  human.facing.set(0, 0, -1);
  human.up.set(0, 1, 0);
  defense.position.set(30, 18, 30);
  defense.velocity.set(0, 0, 0);
  giveBallTo(sim, mate, new THREE.Vector3(0, 0.15, 0.6));
  const intent = blankIntent();
  for (let i = 0; i < 240; i++) {
    sim.step(1 / 60, intent);
    if (human.hasBall && sim.ball.ownerId === human.id) return;
  }
  fail(`pass did not reach the receiver (owner ${sim.ball.ownerId})`);
}

console.log('rotation checks passed');
