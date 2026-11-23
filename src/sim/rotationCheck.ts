/**
 * Headless checks for the rotation snaps. Run with:
 *   npx tsx src/sim/rotationCheck.ts
 */
import * as THREE from 'three';
import { ARENA_RADIUS, CAMERA, GOAL, PLAYER } from '../game/constants';
import type { InputIntent } from '../game/types';
import { defaultTunables } from '../ui/DevPanel';
import { Simulation } from './Simulation';
import { lookBasis, rotateToward, stabilizeUp } from './math';
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
  if (shoulderMeasure(empty) < full * 0.8) {
    fail(`empty hands did not keep the default shoulder (${shoulderMeasure(empty).toFixed(2)})`);
  }

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
  if (!sim.aimCursor.visible) fail('aim cursor hidden while strafing');
  if (cursorKind(sim) !== 'player') fail(`cursor missed the teammate (${cursorKind(sim)})`);
  if (sim.aimCursor.position.distanceTo(mate.position) > PLAYER.radius + 0.5) {
    fail('cursor was not on the teammate');
  }

  mate.position.set(24, 18, -20);
  sim.ball.position.set(0, 0, 9);
  sim.updateAimPresentation(strafe, 1 / 60);
  if (cursorKind(sim) !== 'ball') fail(`cursor missed the ball (${cursorKind(sim)})`);
  if (sim.aimCursor.position.distanceTo(sim.ball.position) > 1.2) fail('cursor was not on the ball');

  human.hasBall = true;
  sim.ball.possession = 'held';
  sim.ball.ownerId = human.id;
  // The held ball sits on the look ray. The cursor must ignore it and keep the goal.
  sim.ball.position.set(0, 0, 1.2);
  sim.updateAimPresentation(strafe, 1 / 60);
  if (cursorKind(sim) !== 'goal') fail(`held ball stole the cursor (${cursorKind(sim)})`);
  if (Math.abs(sim.aimCursor.position.z - GOAL.distance) > 0.6) fail('cursor was not on the goal mouth');

  human.hasBall = false;
  sim.ball.possession = 'free';
  sim.ball.ownerId = null;
  sim.ball.position.set(0, 22, -16);
  sim.yaw = 1.1;
  sim.pitch = 0.35;
  sim.updateAimPresentation(strafe, 1 / 60);
  if (cursorKind(sim) !== 'air') fail(`open water cursor was ${cursorKind(sim)}`);
  const reach = sim.aimCursor.position.distanceTo(human.position);
  if (Math.abs(reach - sim.tunables.aimCursorDistance) > 0.75) {
    fail(`cursor distance ${reach.toFixed(2)} was not the fallback`);
  }

  human.position.set(0, 0, 50);
  sim.yaw = 0;
  sim.pitch = 0;
  sim.updateAimPresentation(strafe, 1 / 60);
  if (cursorKind(sim) !== 'wall') fail(`near-wall cursor was ${cursorKind(sim)}`);
  if (sim.aimCursor.position.length() > ARENA_RADIUS - 0.2) fail('wall cursor left the arena');

  sim.updateAimPresentation(blankIntent(), 1 / 60);
  if (sim.aimCursor.visible) fail('aim cursor stayed up after releasing strafe');
}

function checkShotSteer(): void {
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
  sim.yaw = 0.4;
  sim.pitch = 1;

  const upAim = blankIntent();
  upAim.shootHeld = true;
  upAim.move.set(0, 0, 1);
  sim.step(1 / 60, upAim);
  const lockedAt = human.position.clone();
  const before = sim.shotAim.target.clone();
  for (let i = 0; i < 30; i++) sim.step(1 / 60, upAim);
  const delta = sim.shotAim.target.clone().sub(before);
  const basis = lookBasis(sim.yaw, sim.pitch, false);
  const up = delta.dot(basis.up);
  const fwd = delta.dot(basis.forward);
  const side = delta.dot(basis.right);
  if (up < 4) fail(`W did not raise the marker (up ${up.toFixed(2)})`);
  if (Math.abs(fwd) > 1.2) fail(`W moved the marker along the look (${fwd.toFixed(2)})`);
  if (Math.abs(side) > 1.2) fail(`W slid the marker sideways (${side.toFixed(2)})`);
  if (human.position.distanceTo(lockedAt) > 0.35) {
    fail(`WASD still swam while aiming (${human.position.distanceTo(lockedAt).toFixed(2)})`);
  }

  const climb = blankIntent();
  climb.shootHeld = true;
  climb.up = 1;
  const y0 = human.position.y;
  for (let i = 0; i < 40; i++) sim.step(1 / 60, climb);
  if (human.position.y < y0 + 0.8) fail('Space stopped swimming up while aiming');

  const lateral = new Simulation(defaultTunables());
  lateral.kickoffLock = 0;
  for (const p of lateral.players) {
    if (p.id !== lateral.humanId) p.active = false;
  }
  const carrier = lateral.getHuman();
  carrier.position.set(0, 1, -6);
  carrier.velocity.set(0, 0, 0);
  carrier.facing.set(0, 0, 1);
  carrier.up.set(0, 1, 0);
  carrier.hasBall = true;
  lateral.ball.possession = 'held';
  lateral.ball.ownerId = carrier.id;
  lateral.ball.position.set(0, 1, -5.2);
  lateral.yaw = 0.3;
  lateral.pitch = 0.2;
  const sideAim = blankIntent();
  sideAim.shootHeld = true;
  sideAim.move.set(1, 0, 0);
  lateral.step(1 / 60, sideAim);
  const sideBefore = lateral.shotAim.target.clone();
  for (let i = 0; i < 30; i++) lateral.step(1 / 60, sideAim);
  const sideDelta = lateral.shotAim.target.clone().sub(sideBefore);
  const sideBasis = lookBasis(lateral.yaw, lateral.pitch, false);
  const rightDot = sideDelta.dot(sideBasis.right);
  if (rightDot < 4) fail(`A/D did not slide the marker (${rightDot.toFixed(2)})`);
  if (Math.abs(sideDelta.dot(sideBasis.up)) > 1.2) fail('A/D raised the marker');
  if (Math.abs(sideDelta.dot(sideBasis.forward)) > 1.2) fail('A/D changed the range');

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
  const near = ranged.shotAim.origin.distanceTo(ranged.shotAim.target);
  ranged.nudgeAimDistance(6);
  ranged.step(1 / 60, hold);
  const far = ranged.shotAim.origin.distanceTo(ranged.shotAim.target);
  if (far < near + 4) fail(`wheel did not extend the arc (${near.toFixed(2)} -> ${far.toFixed(2)})`);
}

export function runRotationChecks(): void {
  checkRotateToward();
  checkUpPole();
  checkWall();
  checkStrafe();
  checkArc();
  checkPractice();
  checkShoulder();
  checkAimCursor();
  checkShotSteer();
  checkCamera(false, false);
  checkCamera(false, true);
  checkCamera(true, false);
  checkCamera(true, true);
}

runRotationChecks();
console.log('rotation checks passed');
