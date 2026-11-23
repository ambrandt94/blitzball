/**
 * Headless checks for the rotation snaps. Run with:
 *   npx tsx src/sim/rotationCheck.ts
 */
import * as THREE from 'three';
import { ARENA_RADIUS, BALL, CAMERA, PLAYER, SHOT_ARC } from '../game/constants';
import type { InputIntent } from '../game/types';
import { defaultTunables } from '../ui/DevPanel';
import { Simulation } from './Simulation';
import { lookBasis, rotateToward, stabilizeUp } from './math';
import { arcControl, clampAimMarker, quadraticPoint, shapedControl } from './shotArc';
import { constrainPlayerToSphere } from './wallPhysics';

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
  // Camera looks off the body's facing so the carry pose has to turn,
  // and the swimmer still has speed. WASD / rise must not add thrust.
  sim.yaw = 0.7;
  human.velocity.set(0, 0, 6);
  hold.move.set(1, 0, 0);
  hold.up = 1;
  const startBall = sim.ball.position.clone();
  const startPlayer = human.position.clone();
  for (let i = 0; i < 30; i++) sim.step(1 / 60, hold);
  if (!sim.shotAim.active) fail('shot aim did not lock');
  if (human.actionPose !== 'hold') fail(`aim pose was ${human.actionPose}, ball would leave the hands`);
  if (Math.abs(human.velocity.x) > 0.4 || human.velocity.y > 0.4) {
    fail(`WASD still swam during the hold (${human.velocity.x.toFixed(2)}, ${human.velocity.y.toFixed(2)})`);
  }
  const carried = sim.ball.position.distanceTo(holdPoint(sim));
  if (carried > 0.05) fail(`ball left the hand by ${carried.toFixed(2)}`);
  if (sim.ball.position.distanceTo(startBall) < 0.2) {
    fail('ball froze in the water instead of moving with the hold pose');
  }
  if (human.position.distanceTo(startPlayer) < 0.15) fail('player did not coast while aiming');
}

function checkArcBend(): void {
  const { sim, hold } = aimingSim();
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
  const expect = sim.tunables.arcAimSpeed * (frames / 60);
  if (Math.abs(moved - expect) > 0.35) fail(`marker moved ${moved.toFixed(2)}, expected ${expect.toFixed(2)}`);
  if (human.position.distanceTo(playerBefore) > 0.15) fail('player swam while WASD moved the marker');
  const right = lookBasis(sim.yaw, sim.pitch, false).right;
  const lateral = sim.shotAim.target.clone().sub(before).dot(right);
  if (lateral < expect * 0.9) fail(`A/D did not strafe the marker (${lateral.toFixed(2)})`);

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
  checkPractice();
  checkCamera(false, false);
  checkCamera(false, true);
  checkCamera(true, false);
  checkCamera(true, true);
}

runRotationChecks();
console.log('rotation checks passed');
