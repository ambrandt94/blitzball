/**
 * Headless checks for the rotation snaps. Run with:
 *   npx tsx src/sim/rotationCheck.ts
 */
import * as THREE from 'three';
import { ARENA_RADIUS, BALL, CAMERA, GOAL, PLAYER, SHOT_ARC, setArenaRadius } from '../game/constants';
import type { InputIntent } from '../game/types';
import { PrimaryClickGate } from '../input/primaryClickGate';
import { fitBallModel } from '../render/blitzball';
import { blendLimbPose, swimLimbPose } from '../render/limbs';
import { defaultTunables } from '../ui/DevPanel';
import { Simulation } from './Simulation';
import { goalCornerWorld, goalFrameCurve, goalMouthVertex, goalPlaneZ, inGoalPocket, pointInGoalMouth, resolveGoalRim, segmentScores } from './goal';
import { lookBasis, rotateToward, stabilizeUp } from './math';
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
    burst: false,
    passHeld: false,
    zoomOut: zoom,
    zoomTogglePressed: false,
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
  sim.step(1 / 60, hold);
  const playerBefore = human.position.clone();
  const before = sim.shotAim.target.clone();
  hold.move.set(1, 0, 0);
  const frames = 30;
  for (let i = 0; i < frames; i++) sim.step(1 / 60, hold);
  const moved = sim.shotAim.target.distanceTo(before);
  if (moved > 0.2) fail(`WASD moved the throw marker (${moved.toFixed(2)})`);
  if (human.position.distanceTo(playerBefore) < 0.2) fail('WASD did not creep the swimmer during the throw');

  const forward = lookBasis(sim.yaw, sim.pitch, false).forward;
  const ranged = sim.shotAim.target.clone();
  sim.nudgeAimDistance(6);
  const delta = sim.shotAim.target.clone().sub(ranged);
  const along = delta.dot(forward);
  if (Math.abs(along - 6) > 0.05) fail(`wheel range slid ${along.toFixed(2)} instead of 6`);
  if (delta.addScaledVector(forward, -along).length() > 0.05) fail('wheel moved the marker off the look axis');
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
  for (let i = 0; i < 100; i++) sim.step(1 / 60, intent);
  if (defense.position.distanceTo(held) > 0.15) fail('frozen defense left its spot');
  if (!mate.hasBall && mate.position.distanceTo(sim.ball.position) > 2.5) {
    fail('teammate did not come receive the pass');
  }

  for (const p of sim.players) p.hasBall = false;
  mate.hasBall = true;
  mate.position.set(-4, 1, -2);
  sim.getHuman().position.set(0, 0, -8);
  sim.getHuman().velocity.set(0, 0, 0);
  sim.ball.possession = 'held';
  sim.ball.ownerId = mate.id;
  sim.ball.lastOwnerId = mate.id;
  sim.ball.arc = null;
  let passed = false;
  for (let i = 0; i < 140; i++) {
    const before: string = sim.ball.possession;
    sim.step(1 / 60, intent);
    const now: string = sim.ball.possession;
    if (before === 'held' && now === 'free' && sim.ball.lastOwnerId === mate.id) {
      const toHuman = sim.getHuman().position.clone().sub(mate.position);
      if (toHuman.lengthSq() > 0.01 && sim.ball.velocity.dot(toHuman.normalize()) < 2) {
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

function cursorKind(sim: Simulation): string {
  return sim.aimCursor.kind;
}

function checkAimCursor(): void {
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
  if (!mate) fail('missing teammate for the aim cursor');
  mate.position.set(0, 0, 12);
  const strafe = blankIntent();
  strafe.strafe = true;

  sim.updateAimPresentation(strafe, 1 / 60);
  if (sim.aimCursor.visible) fail('off-ball strafe showed a reticle on a teammate');
  sim.ball.position.set(0, 0, 9);
  sim.ball.possession = 'free';
  sim.ball.ownerId = null;
  sim.updateAimPresentation(strafe, 1 / 60);
  if (sim.aimCursor.visible) fail('off-ball strafe showed a reticle on the ball');
  sim.yaw = 1.1;
  sim.pitch = 0.35;
  sim.updateAimPresentation(strafe, 1 / 60);
  if (sim.aimCursor.visible) fail('off-ball strafe showed an open-water reticle');

  human.hasBall = true;
  sim.ball.possession = 'held';
  sim.ball.ownerId = human.id;
  sim.ball.position.set(0, 0, 1.2);
  sim.yaw = 0;
  sim.pitch = 0;
  mate.position.set(0, 0, 12);
  sim.updateAimPresentation(strafe, 1 / 60);
  if (!sim.aimCursor.visible) fail('aim cursor hidden while holding and strafing');
  if (cursorKind(sim) !== 'player') fail(`cursor missed the teammate (${cursorKind(sim)})`);
  if (sim.aimCursor.position.distanceTo(mate.position) > PLAYER.radius + 0.5) {
    fail('cursor was not on the teammate');
  }

  mate.position.set(24, 18, -20);
  // The held ball sits on the look ray. The cursor must ignore it and keep the goal.
  sim.updateAimPresentation(strafe, 1 / 60);
  if (cursorKind(sim) !== 'goal') fail(`held ball stole the cursor (${cursorKind(sim)})`);
  if (Math.abs(sim.aimCursor.position.z - goalPlaneZ(0)) > 0.6) fail('cursor was not on the goal mouth');

  sim.yaw = 1.2;
  sim.pitch = 0;
  sim.updateAimPresentation(strafe, 1 / 60);
  if (cursorKind(sim) !== 'air') fail(`open water cursor was ${cursorKind(sim)}`);
  const reach = sim.aimCursor.position.distanceTo(human.position);
  if (Math.abs(reach - sim.tunables.aimCursorDistance) > 0.75) {
    fail(`cursor distance ${reach.toFixed(2)} was not the fallback`);
  }

  human.position.set(50, 0, 0);
  sim.yaw = -Math.PI / 2;
  sim.pitch = 0;
  sim.updateAimPresentation(strafe, 1 / 60);
  if (cursorKind(sim) !== 'wall') fail(`near-wall cursor was ${cursorKind(sim)}`);
  if (sim.aimCursor.position.length() > ARENA_RADIUS - 0.2) fail('wall cursor left the arena');

  sim.updateAimPresentation(blankIntent(), 1 / 60);
  if (sim.aimCursor.visible) fail('aim cursor stayed up after releasing strafe');
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

  const stance = blankIntent();
  stance.strafe = true;
  wide.ball.claimLock = 0;
  wide.step(1 / 60, stance);
  if (!swimmer.hasBall) fail('catch stance did not take the ball in front of the hands');

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
function checkTeammatePassReachesPlayer(): void {
  const sim = new Simulation(defaultTunables());
  sim.setSoloOpponent(false);
  sim.kickoffLock = 0;
  sim.tunables.defenseActive = false;
  sim.tunables.teammatePassDelay = 0.05;
  const human = sim.getHuman();
  const mate = sim.players.find((p) => p.team === 0 && p.role === 'ai' && p.active);
  const defense = sim.players.find((p) => p.team === 1 && p.active);
  if (!mate || !defense) fail('practice roster is missing the teammate or the defender');

  human.position.set(0, 0, -4);
  human.velocity.set(0, 0, 0);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  sim.yaw = 0;
  sim.pitch = 0;

  mate.position.set(0, 0.2, 12);
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

  defense.position.set(40, 20, 0);
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

  defense.position.set(0, 0, 1);
  defense.velocity.set(0, 0, 0);
  defense.facing.set(0, 0, 1);
  defense.up.set(0, 1, 0);

  const intent = blankIntent();
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
  const hold = blankIntent();
  hold.shootHeld = true;
  sim.step(1 / 60, hold);
  if (!sim.shotAim.active) fail('shot did not aim');
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

function checkShotIntoGoal(): void {
  const { sim, human, hold } = aimingSim();
  human.position.set(2, 0, 16);
  human.facing.set(0, 0, 1);
  human.up.set(0, 1, 0);
  sim.yaw = 0;
  sim.pitch = 0;
  sim.ball.position.copy(holdPoint(sim));
  sim.step(1 / 60, hold);
  const end = sim.chargeGhost[sim.chargeGhost.length - 1];
  if (!end || !inGoalPocket(end, 0)) fail('preview did not finish in the goal');
  if (arcRightOffset(sim) < 0.4) fail(`goal shot flattened the hand curve (${arcRightOffset(sim).toFixed(2)})`);

  const bent = aimingSim();
  bent.human.position.set(2, 0, 16);
  bent.human.facing.set(0, 0, 1);
  bent.human.up.set(0, 1, 0);
  bent.sim.yaw = 0;
  bent.sim.pitch = 0;
  bent.sim.ball.position.copy(holdPoint(bent.sim));
  bent.sim.step(1 / 60, bent.hold);
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
  const chord = sim.ball.position.distanceTo(sim.shotAim.target);
  // Quadratic midpoint sits halfway out toward the control point.
  if (side < sim.tunables.arcHandCurve * chord * 0.35) {
    fail(`default arc offset ${side.toFixed(2)} is not toward the throwing hand`);
  }
  const frozen = sim.chargeGhost.map((p) => p.clone());
  sim.step(1 / 60, hold);
  let drift = 0;
  sim.chargeGhost.forEach((p, i) => {
    drift = Math.max(drift, p.distanceTo(frozen[i]!));
  });
  if (drift > 0.08) fail(`arc settled ${drift.toFixed(2)} after it appeared`);
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
    return shot.sim.ball.arc.duration;
  };
  // Higher locked power is a faster shot, so the same chord takes less time.
  const early = releaseAt(8);
  const late = releaseAt(50);
  if (!(late < early)) fail(`power did not speed the shot (${early.toFixed(3)} vs ${late.toFixed(3)})`);
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

  const upAim = blankIntent();
  upAim.shootHeld = true;
  upAim.move.set(0, 0, 1);
  sim.step(1 / 60, upAim);
  const lockedAt = human.position.clone();
  const before = sim.shotAim.target.clone();
  const yaw = sim.yaw;
  for (let i = 0; i < 30; i++) sim.step(1 / 60, upAim);
  if (sim.shotAim.target.distanceTo(before) > 0.25) fail('W moved the locked throw marker');
  if (Math.abs(sim.yaw - yaw) > 1e-6) fail('WASD turned the locked aim');
  const crept = human.position.distanceTo(lockedAt);
  if (crept < 0.35) fail(`throw hold did not let WASD swim (${crept.toFixed(2)})`);
  const creep = PLAYER.maxSpeed * PLAYER.carrierSpeedMult * PLAYER.throwSwimMult;
  if (human.velocity.length() > creep * 1.3) {
    fail(`throw swim too fast (${human.velocity.length().toFixed(2)})`);
  }

  const riseBefore = sim.shotAim.target.clone();
  const climb = blankIntent();
  climb.shootHeld = true;
  climb.up = 1;
  for (let i = 0; i < 20; i++) sim.step(1 / 60, climb);
  if (sim.shotAim.target.distanceTo(riseBefore) > 0.25) fail('Space moved the locked throw marker');

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
  const hold = blankIntent();
  hold.shootHeld = true;
  ranged.step(1 / 60, hold);
  const forward = lookBasis(ranged.yaw, ranged.pitch, false).forward;
  const rangedBefore = ranged.shotAim.target.clone();
  ranged.nudgeAimDistance(6);
  const wheelDelta = ranged.shotAim.target.clone().sub(rangedBefore);
  const along = wheelDelta.dot(forward);
  if (Math.abs(along - 6) > 0.05) fail(`wheel range slid ${along.toFixed(2)} instead of 6`);
  if (wheelDelta.addScaledVector(forward, -along).length() > 0.05) fail('wheel moved the marker off the look axis');
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
  const { sim, hold } = aimingSim();
  sim.step(1 / 60, hold);
  const mouth = goalPlaneZ(0);
  sim.shotAim.target.set(0, 0, mouth);
  sim.shotAim.bendRight = 6;
  sim.shotAim.bendUp = 3;
  sim.step(1 / 60, hold);
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
  if (human.burstCooldown < 0.75) fail(`check cooldown was ${human.burstCooldown.toFixed(2)}`);
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
  if (!sim.aimCursor.visible) fail('right-click aim hid the reticle');
  const yaw = sim.yaw;
  const look = blankIntent();
  look.strafe = true;
  look.lookDelta.x = 0.35;
  sim.applyFrameLook(look);
  if (Math.abs(sim.yaw - (yaw + 0.35)) > 1e-4) fail('right-click aim did not follow the mouse');
  if (Math.abs(sim.shotAim.bendRight) > 0.01) fail('right-click aim bent a curve');
  sim.updateAimPresentation(look, 1 / 60);
  const forward = lookBasis(sim.yaw, sim.pitch, false).forward;
  const along = sim.aimCursor.position.clone().sub(human.position);
  if (along.lengthSq() < 1e-6 || along.normalize().dot(forward) < 0.9) {
    fail('reticle left the mouse look');
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
  if (sim.chargeGhost.length < 4) fail('throw hold hid the curve');
  const marker = sim.shotAim.target.clone();
  shot.move.set(0, 0, 1);
  shot.lookDelta.x = 0;
  const at = human.position.clone();
  for (let i = 0; i < 20; i++) sim.step(1 / 60, shot);
  if (sim.shotAim.target.distanceTo(marker) > 0.3) fail('swim moved the locked marker');
  if (human.position.distanceTo(at) < 0.15) fail('throw hold ignored WASD');
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
  checkAimCursor();
  checkCatch();
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
  checkDrillOpponent();
  checkArenaShell();
  checkWallRicochet();
  checkRimDeflection();
  checkGoalStaysVisible();
  checkShotIntoGoal();
  checkShotSteer();
  checkThrowAim();
  checkBallFit();
  checkSpeeds();
  checkBurst();
  checkPointerLockGuard();
  checkCatchBeacon();
  checkGoalBoundArc();
  checkCamera(false, false);
  checkCamera(false, true);
  checkCamera(true, false);
  checkCamera(true, true);
}

runRotationChecks();
console.log('rotation checks passed');
