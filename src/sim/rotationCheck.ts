/**
 * Headless checks for the rotation snaps. Run with:
 *   npx tsx src/sim/rotationCheck.ts
 */
import * as THREE from 'three';
import { ARENA_RADIUS, CAMERA, PLAYER } from '../game/constants';
import type { InputIntent } from '../game/types';
import { defaultTunables } from '../ui/DevPanel';
import { Simulation } from './Simulation';
import { rotateToward, stabilizeUp } from './math';
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

function checkArc(): void {
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
  sim.ball.possession = 'held';
  sim.ball.ownerId = human.id;
  sim.ball.lastOwnerId = human.id;
  sim.ball.position.set(0, 1, -5.2);
  sim.yaw = 1.2;
  sim.pitch = 0.2;
  const hold = blankIntent();
  hold.shootHeld = true;
  sim.step(1 / 60, hold);
  if (!sim.shotAim.active) fail('shot aim did not lock');
  const origin = sim.shotAim.origin.clone();
  if (sim.chargeGhost.length < 4) fail('arc preview missing');
  sim.yaw = 0.8;
  sim.nudgeAimDistance(4);
  sim.step(1 / 60, hold);
  if (sim.shotAim.origin.distanceTo(origin) > 0.02) fail('shot origin moved while aiming');
  const target = sim.shotAim.target.clone();
  const last = sim.chargeGhost[sim.chargeGhost.length - 1];
  if (!last || last.distanceTo(target) > 0.05) fail('preview does not end on the marker');
  const release = blankIntent();
  sim.step(1 / 60, release);
  if (!sim.ball.arc) fail('release did not start the arc');
  const steps = Math.ceil(sim.ball.arc.duration * 60) + 3;
  for (let i = 0; i < steps; i++) sim.step(1 / 60, release);
  const miss = sim.ball.position.distanceTo(target);
  if (miss > 1.5) fail(`arc missed the marker by ${miss.toFixed(2)}`);
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
  checkArc();
  checkPractice();
  checkCamera(false, false);
  checkCamera(false, true);
  checkCamera(true, false);
  checkCamera(true, true);
}

runRotationChecks();
console.log('rotation checks passed');
