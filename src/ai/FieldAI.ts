import * as THREE from 'three';
import type { BallState, InputIntent, PlayerState, Tunables } from '../game/types';
import { goalieSkill01 } from './GoalieAI';
import { goalCenter } from '../sim/math';

/**
 * Field players on both teams. A carrier shoots, passes, or carries a few times
 * a second. Everyone else supports, receives, or defends. The test-chaser drill
 * does not use this.
 */
const THINK_SECONDS = 0.2;
const PRESSURE_METERS = 6.5;
const LANE_BLOCK = 1.7;

export interface AiDelivery {
  point: THREE.Vector3;
  power: number;
  bendRight: number;
  bendUp: number;
  kick: boolean;
  receiverId: number | null;
  kind: 'shoot' | 'pass';
}

export interface AiMark {
  id: number;
  kind: string;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

interface Memory {
  nextThink: number;
  phase: 'idle' | 'wait' | 'wind';
  wait: number;
  wind: number;
  windMax: number;
  order: 'shoot' | 'pass' | 'carry' | 'support' | 'press' | 'chase';
  kick: boolean;
  point: THREE.Vector3;
  power: number;
  bendRight: number;
  bendUp: number;
  receiverId: number | null;
  move: THREE.Vector3;
  sprint: boolean;
}

export class FieldAI {
  private memory = new Map<number, Memory>();
  private fired = new Map<number, AiDelivery>();
  private shown: AiMark[] = [];

  marks(): readonly AiMark[] {
    return this.shown;
  }

  takeDelivery(id: number): AiDelivery | null {
    const spec = this.fired.get(id) ?? null;
    if (spec) this.fired.delete(id);
    return spec;
  }

  think(
    self: PlayerState,
    ball: BallState,
    players: PlayerState[],
    tunables: Tunables,
    dt: number,
    forceTarget?: PlayerState,
  ): InputIntent {
    const mem = this.slot(self);
    const intent = emptyIntent();
    const skill = fieldSkill(self, tunables);

    if (!self.hasBall && (mem.phase === 'wind' || mem.phase === 'wait')) this.clearWind(self, mem);

    if (self.hasBall && forceTarget) {
      this.orderPass(mem, self, forceTarget, tunables, skill, true);
    } else if (mem.phase === 'idle' && mem.nextThink <= 0) {
      this.decide(self, ball, players, tunables, mem, skill);
      mem.nextThink = THINK_SECONDS;
    } else if (mem.phase === 'idle') {
      mem.nextThink -= dt;
    }

    let release = false;
    if (mem.phase === 'wait') {
      mem.wait -= dt;
      if (mem.wait <= 0) {
        mem.phase = 'wind';
        mem.wind = 0;
      }
    }
    if (mem.phase === 'wind') {
      mem.wind += dt;
      self.windupKind = mem.kick ? 'kick' : mem.order === 'pass' ? 'pass' : 'shoot';
      self.windup = THREE.MathUtils.clamp(mem.wind / Math.max(0.05, mem.windMax), 0, 1);
      self.throwCurveRight = THREE.MathUtils.clamp(mem.bendRight / 22, -1, 1);
      self.throwCurveUp = THREE.MathUtils.clamp(mem.bendUp / 22, -1, 1);
      if (mem.wind >= mem.windMax) {
        release = true;
        this.fired.set(self.id, {
          point: mem.point.clone(),
          power: mem.power,
          bendRight: mem.bendRight,
          bendUp: mem.bendUp,
          kick: mem.kick,
          receiverId: mem.receiverId,
          kind: mem.order === 'pass' ? 'pass' : 'shoot',
        });
        this.clearWind(self, mem);
      }
    } else if (!release) {
      self.windup = 0;
      self.windupKind = 'none';
    }

    const move = mem.move;
    intent.move.copy(move);
    intent.up = THREE.MathUtils.clamp(move.y, -1, 1);
    intent.sprint = mem.sprint && mem.phase !== 'wind';
    if (mem.phase === 'wind') intent.move.multiplyScalar(0.22);
    if (release) {
      if (mem.kick) intent.kick = true;
      else if (this.fired.get(self.id)?.kind === 'pass') intent.pass = true;
      else intent.shoot = true;
    }
    // The release cleared `mem.order` via clearWind, so the edge above reads the fired spec.
    if (!release && mem.order === 'press' && !self.hasBall) {
      const carrier = ball.ownerId !== null ? players[ball.ownerId] : undefined;
      if (carrier && carrier.team !== self.team) {
        const dist = self.position.distanceTo(carrier.position);
        const facing = carrier.position.clone().sub(self.position);
        const aligned = facing.lengthSq() > 0.04 && self.facing.dot(facing.normalize()) > 0.35;
        const reach = Math.max(1.2, tunables.grabReach);
        if (dist < reach && aligned && self.burstCooldown <= 0) intent.burst = true;
      }
    }
    if (!self.hasBall && ball.possession === 'free') {
      const toBall = ball.position.clone().sub(self.position);
      const dist = toBall.length();
      const reach = Math.max(0.4, tunables.grabReach);
      if (dist > 0.05 && dist < reach && self.facing.dot(toBall) / dist > 0.45) intent.claim = true;
    }

    this.rememberMark(self, mem);
    return intent;
  }

  private orderPass(
    mem: Memory,
    self: PlayerState,
    target: PlayerState,
    tunables: Tunables,
    skill: number,
    forced: boolean,
  ): void {
    if ((mem.phase === 'wind' || mem.phase === 'wait') && mem.order === 'pass' && mem.receiverId === target.id) {
      return;
    }
    const lead = this.leadPoint(self, target, tunables);
    this.spoil(lead, self, (1 - skill) * 0.22);
    mem.order = 'pass';
    mem.kick = false;
    mem.point.copy(lead);
    mem.power = 0.72;
    mem.bendRight = 0;
    mem.bendUp = 0;
    mem.receiverId = target.id;
    mem.move.copy(target.position).sub(self.position);
    if (mem.move.lengthSq() > 1e-6) mem.move.normalize();
    mem.sprint = false;
    const delay = forced ? 0 : (1 - skill) * 0.42;
    mem.phase = delay > 0.03 ? 'wait' : 'wind';
    mem.wait = delay;
    mem.wind = 0;
    mem.windMax = 0.22;
  }

  private decide(
    self: PlayerState,
    ball: BallState,
    players: PlayerState[],
    tunables: Tunables,
    mem: Memory,
    skill: number,
  ): void {
    if (self.hasBall) {
      this.decideCarry(self, players, tunables, mem, skill);
      return;
    }
    if (ball.possession === 'free') {
      this.orderChase(self, ball, players, mem);
      return;
    }
    const owner = ball.ownerId !== null ? players[ball.ownerId] : undefined;
    if (!owner) {
      this.orderChase(self, ball, players, mem);
      return;
    }
    if (owner.team === self.team) this.orderSupport(self, owner, players, tunables, mem);
    else this.orderDefense(self, owner, ball, players, tunables, mem, skill);
  }

  private decideCarry(
    self: PlayerState,
    players: PlayerState[],
    tunables: Tunables,
    mem: Memory,
    skill: number,
  ): void {
    const attack = goalCenter(self.team);
    const toGoal = attack.clone().sub(self.position);
    const goalDist = toGoal.length();
    if (goalDist > 1e-4) toGoal.multiplyScalar(1 / goalDist);

    const foes = opponents(self, players);
    const pressed = foes.some((foe) => {
      const dist = foe.position.distanceTo(self.position);
      const closing = foe.velocity.clone().sub(self.velocity).dot(self.position.clone().sub(foe.position));
      return dist < PRESSURE_METERS || (foe.burstTime > 0 && dist < 9 && closing > 0);
    });

    const kick = goalDist > tunables.arcAimDistance * 0.8;
    const reach = tunables.arcAimDistance * (kick ? Math.max(1, tunables.kickRange) : 1) * 0.96;
    const shot = this.pickShot(self, toGoal, goalDist, foes, tunables, skill);
    if (shot && goalDist <= reach && this.laneClear(self.position, shot.point, foes, skill)) {
      this.beginDelivery(mem, self, 'shoot', shot.point, kick, shot.power, shot.bendRight, shot.bendUp, null, skill);
      return;
    }

    const pass = this.pickPass(self, players, foes, tunables, skill, pressed, goalDist);
    if (pass) {
      this.beginDelivery(mem, self, 'pass', pass.point, false, 0.72, pass.bendRight, pass.bendUp, pass.id, skill);
      return;
    }

    const steer = toGoal.clone();
    const nearest = nearestFoe(self.position, foes);
    if (nearest && nearest.dist < 9) {
      const away = self.position.clone().sub(nearest.player.position);
      if (away.lengthSq() > 1e-6) steer.addScaledVector(away.normalize(), ((9 - nearest.dist) / 9) * 0.85);
    }
    if (steer.lengthSq() > 1e-6) steer.normalize();
    mem.order = 'carry';
    mem.phase = 'idle';
    mem.kick = false;
    mem.receiverId = null;
    mem.point.copy(self.position).addScaledVector(steer, 6);
    mem.move.copy(steer);
    mem.sprint = goalDist > 14 && !(nearest && nearest.dist < 5);
  }

  private beginDelivery(
    mem: Memory,
    self: PlayerState,
    kind: 'shoot' | 'pass',
    point: THREE.Vector3,
    kick: boolean,
    power: number,
    bendRight: number,
    bendUp: number,
    receiverId: number | null,
    skill: number,
  ): void {
    const aim = point.clone().sub(self.position);
    if (aim.lengthSq() > 1e-6) {
      aim.normalize();
      this.spoilDirection(aim, (1 - skill) * (kind === 'shoot' ? 0.16 : 0.1));
      point = self.position.clone().addScaledVector(aim, Math.max(4, self.position.distanceTo(point)));
    }
    mem.order = kind;
    mem.kick = kick;
    mem.point.copy(point);
    mem.power = power;
    mem.bendRight = bendRight;
    mem.bendUp = bendUp;
    mem.receiverId = receiverId;
    mem.move.copy(aim.lengthSq() > 1e-6 ? aim : self.facing);
    mem.sprint = false;
    const delay = (1 - skill) * 0.42;
    mem.phase = delay > 0.03 ? 'wait' : 'wind';
    mem.wait = delay;
    mem.wind = 0;
    mem.windMax = kind === 'pass' ? 0.22 : kick ? 0.4 : 0.3;
  }

  private pickShot(
    self: PlayerState,
    toGoal: THREE.Vector3,
    goalDist: number,
    foes: PlayerState[],
    tunables: Tunables,
    skill: number,
  ): { point: THREE.Vector3; power: number; bendRight: number; bendUp: number } | null {
    const mouth = goalCenter(self.team);
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(up, toGoal);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    else side.normalize();
    const spots = [
      mouth.clone(),
      mouth.clone().addScaledVector(side, 3.2),
      mouth.clone().addScaledVector(side, -3.2),
      mouth.clone().addScaledVector(up, 2.6),
      mouth.clone().addScaledVector(up, -2.2),
    ];
    const goalie = nearestFoe(mouth, foes);
    let best: { point: THREE.Vector3; gap: number } | null = null;
    for (const spot of spots) {
      if (!this.laneClear(self.position, spot, foes, skill)) continue;
      const gap = goalie ? spot.distanceTo(goalie.player.position) : 8;
      if (!best || gap > best.gap) best = { point: spot, gap };
    }
    if (!best) return null;
    const reach = Math.max(8, tunables.arcAimDistance);
    const power = THREE.MathUtils.clamp(goalDist / reach, 0.62, 1);
    let bendRight = 0;
    let bendUp = 0;
    if (goalie && goalie.dist < 8) {
      const away = best.point.clone().sub(goalie.player.position);
      bendRight = THREE.MathUtils.clamp(away.dot(side) * 0.35, -5, 5) * (0.35 + 0.65 * skill);
      bendUp = THREE.MathUtils.clamp(away.y * 0.3, -4, 4) * (0.35 + 0.65 * skill);
    }
    return { point: best.point, power, bendRight, bendUp };
  }

  private pickPass(
    self: PlayerState,
    players: PlayerState[],
    foes: PlayerState[],
    tunables: Tunables,
    skill: number,
    pressed: boolean,
    myGoalDist: number,
  ): { id: number; point: THREE.Vector3; bendRight: number; bendUp: number } | null {
    let best: { id: number; point: THREE.Vector3; score: number; bendRight: number; bendUp: number } | null = null;
    for (const mate of players) {
      if (!mate.active || mate.role === 'stub' || mate.team !== self.team || mate.id === self.id) continue;
      const lead = this.leadPoint(self, mate, tunables);
      if (!this.laneClear(self.position, lead, foes, skill)) continue;
      const open = nearestFoe(lead, foes);
      const openness = open ? Math.min(14, open.dist) : 14;
      const theirGoal = goalCenter(self.team).distanceTo(lead);
      const closer = myGoalDist - theirGoal;
      if (!pressed && closer < 6 && openness < 8) continue;
      const score = closer * 0.7 + openness * 1.15;
      if (!best || score > best.score) {
        const bend = this.bendAway(self.position, lead, foes);
        best = { id: mate.id, point: lead, score, bendRight: bend.x, bendUp: bend.y };
      }
    }
    if (!best) return null;
    if (!pressed && best.score < 4) return null;
    return best;
  }

  private orderChase(self: PlayerState, ball: BallState, players: PlayerState[], mem: Memory): void {
    const mates = players.filter((p) => p.active && p.team === self.team && p.id !== self.id && p.role !== 'stub');
    let nearer = false;
    const mine = self.position.distanceTo(ball.position);
    for (const mate of mates) {
      if (mate.position.distanceTo(ball.position) + 1.5 < mine) nearer = true;
    }
    const to = ball.position.clone().sub(self.position);
    const dist = to.length();
    if (dist > 1e-4) to.multiplyScalar(1 / dist);
    mem.order = nearer && mine > 6 ? 'support' : 'chase';
    mem.phase = 'idle';
    mem.point.copy(ball.position);
    mem.move.copy(to);
    if (nearer && mine > 6) mem.move.multiplyScalar(0.35);
    mem.sprint = !nearer && dist > 6;
    mem.receiverId = null;
  }

  private orderSupport(
    self: PlayerState,
    carrier: PlayerState,
    players: PlayerState[],
    tunables: Tunables,
    mem: Memory,
  ): void {
    const attack = goalCenter(self.team).sub(carrier.position);
    if (attack.lengthSq() < 1e-6) attack.set(0, 0, self.team === 0 ? 1 : -1);
    else attack.normalize();
    const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), attack);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    else side.normalize();
    const foes = opponents(self, players);
    const nearest = nearestFoe(carrier.position, foes);
    const sign = nearest && nearest.player.position.clone().sub(carrier.position).dot(side) > 0 ? -1 : 1;
    const spot = carrier.position
      .clone()
      .addScaledVector(attack, 12)
      .addScaledVector(side, sign * 8);
    const limit = tunables.arenaRadius * 0.78;
    if (spot.length() > limit) spot.setLength(limit);
    const to = spot.clone().sub(self.position);
    const gap = to.length();
    if (gap > 1e-4) to.multiplyScalar(1 / gap);
    mem.order = 'support';
    mem.phase = 'idle';
    mem.point.copy(spot);
    mem.move.copy(gap > 1.4 ? to : new THREE.Vector3());
    mem.sprint = gap > 16;
    mem.receiverId = carrier.id;
  }

  private orderDefense(
    self: PlayerState,
    carrier: PlayerState,
    ball: BallState,
    players: PlayerState[],
    tunables: Tunables,
    mem: Memory,
    skill: number,
  ): void {
    const own = goalCenter(self.team === 0 ? 1 : 0);
    const mates = players.filter((p) => p.active && p.role !== 'stub' && p.team === self.team);
    let deepest = true;
    const myOwn = self.position.distanceTo(own);
    for (const mate of mates) {
      if (mate.id !== self.id && mate.position.distanceTo(own) + 0.5 < myOwn) deepest = false;
    }
    const goalie = deepest ? goalieSkill01(tunables, self.team) : 0;
    const press = self.position.distanceTo(carrier.position) < 14 - goalie * 6;
    if (press && goalie < 0.85) {
      const to = carrier.position.clone().sub(self.position);
      if (to.lengthSq() > 1e-6) to.normalize();
      mem.order = 'press';
      mem.phase = 'idle';
      mem.point.copy(carrier.position);
      mem.move.copy(to);
      mem.sprint = self.position.distanceTo(carrier.position) > 4;
      mem.receiverId = carrier.id;
      return;
    }
    const between = own.clone().lerp(carrier.position, 0.35 + (1 - goalie) * 0.4);
    const lane = this.dangerLane(self, carrier, ball, players);
    const spot = lane ? between.lerp(lane, 0.45 + skill * 0.25) : between;
    const limit = tunables.arenaRadius * 0.8;
    if (spot.length() > limit) spot.setLength(limit);
    const to = spot.clone().sub(self.position);
    const gap = to.length();
    if (gap > 1e-4) to.multiplyScalar(1 / gap);
    mem.order = 'press';
    mem.phase = 'idle';
    mem.point.copy(spot);
    mem.move.copy(gap > 1.2 ? to : new THREE.Vector3());
    mem.sprint = gap > 10;
    mem.receiverId = carrier.id;
  }

  /** A point on the pass the carrier would most like to throw, so a marker can sit in it. */
  private dangerLane(
    self: PlayerState,
    carrier: PlayerState,
    _ball: BallState,
    players: PlayerState[],
  ): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestDist = Infinity;
    for (const mate of players) {
      if (!mate.active || mate.team !== carrier.team || mate.id === carrier.id) continue;
      const mid = carrier.position.clone().lerp(mate.position, 0.55);
      const dist = self.position.distanceTo(mid);
      if (dist < bestDist) {
        bestDist = dist;
        best = mid;
      }
    }
    return best;
  }

  private leadPoint(self: PlayerState, target: PlayerState, tunables: Tunables): THREE.Vector3 {
    const dist = Math.max(3, self.position.distanceTo(target.position));
    const speed = Math.max(8, tunables.passSpeed);
    const flight = THREE.MathUtils.clamp(dist / speed, 0.12, 0.7);
    return target.position.clone().addScaledVector(target.velocity, flight).addScaledVector(target.up, 0.15);
  }

  private laneClear(from: THREE.Vector3, to: THREE.Vector3, foes: PlayerState[], skill: number): boolean {
    const mid = from.clone().lerp(to, 0.5);
    const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from));
    if (side.lengthSq() > 1e-6) mid.addScaledVector(side.normalize(), 1.2);
    const radius = LANE_BLOCK * (1.15 - 0.35 * skill);
    for (const foe of foes) {
      if (segmentDistance(foe.position, from, mid) < radius) return false;
      if (segmentDistance(foe.position, mid, to) < radius) return false;
    }
    return true;
  }

  private bendAway(from: THREE.Vector3, to: THREE.Vector3, foes: PlayerState[]): { x: number; y: number } {
    const nearest = nearestFoe(from.clone().lerp(to, 0.5), foes);
    if (!nearest || nearest.dist > 7) return { x: 0, y: 0 };
    const chord = to.clone().sub(from);
    const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), chord);
    if (side.lengthSq() < 1e-6) return { x: 0, y: 0 };
    side.normalize();
    const away = from.clone().lerp(to, 0.5).sub(nearest.player.position);
    return {
      x: THREE.MathUtils.clamp(away.dot(side) * 0.4, -4.5, 4.5),
      y: THREE.MathUtils.clamp(away.y * 0.25, -3, 3),
    };
  }

  private spoil(point: THREE.Vector3, self: PlayerState, radians: number): void {
    const dir = point.clone().sub(self.position);
    if (dir.lengthSq() < 1e-6 || radians < 0.004) return;
    const dist = dir.length();
    dir.multiplyScalar(1 / dist);
    this.spoilDirection(dir, radians);
    point.copy(self.position).addScaledVector(dir, dist);
  }

  private spoilDirection(dir: THREE.Vector3, radians: number): void {
    if (radians < 0.004) return;
    const axis = new THREE.Vector3(dir.y, -dir.x, 0.15);
    if (axis.lengthSq() < 1e-6) axis.set(0, 1, 0);
    axis.normalize();
    dir.applyAxisAngle(axis, (Math.random() * 2 - 1) * radians).normalize();
  }

  private rememberMark(self: PlayerState, mem: Memory): void {
    const next = this.shown.filter((mark) => mark.id !== self.id);
    next.push({
      id: self.id,
      kind: mem.phase === 'wind' || mem.phase === 'wait' ? mem.order : mem.order,
      from: self.position.clone(),
      to: mem.point.clone(),
    });
    this.shown = next;
  }

  private clearWind(self: PlayerState, mem: Memory): void {
    mem.phase = 'idle';
    mem.wind = 0;
    mem.wait = 0;
    self.windup = 0;
    self.windupKind = 'none';
  }

  private slot(self: PlayerState): Memory {
    let mem = this.memory.get(self.id);
    if (!mem) {
      mem = {
        nextThink: 0,
        phase: 'idle',
        wait: 0,
        wind: 0,
        windMax: 0.3,
        order: 'carry',
        kick: false,
        point: self.position.clone(),
        power: 0.7,
        bendRight: 0,
        bendUp: 0,
        receiverId: null,
        move: new THREE.Vector3(),
        sprint: false,
      };
      this.memory.set(self.id, mem);
    }
    return mem;
  }
}

function fieldSkill(self: PlayerState, tunables: Tunables): number {
  const raw = self.team === 0 ? tunables.fieldSkillA : tunables.fieldSkillB;
  return THREE.MathUtils.clamp(raw, 0, 100) / 100;
}

function opponents(self: PlayerState, players: PlayerState[]): PlayerState[] {
  return players.filter((p) => p.active && p.role !== 'stub' && p.team !== self.team);
}

function nearestFoe(point: THREE.Vector3, foes: PlayerState[]): { player: PlayerState; dist: number } | null {
  let best: { player: PlayerState; dist: number } | null = null;
  for (const foe of foes) {
    const dist = foe.position.distanceTo(point);
    if (!best || dist < best.dist) best = { player: foe, dist };
  }
  return best;
}

function segmentDistance(point: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = b.clone().sub(a);
  const len2 = ab.lengthSq();
  if (len2 < 1e-6) return point.distanceTo(a);
  const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(ab) / len2, 0, 1);
  return point.distanceTo(a.clone().addScaledVector(ab, t));
}

function emptyIntent(): InputIntent {
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
    tackleHeld: false,
    passHeld: false,
    zoomOut: false,
    zoomTogglePressed: false,
    middleZoomPressed: false,
    resetBall: false,
    level: false,
    ballCamToggle: false,
    toggleDev: false,
    aimRangeDelta: 0,
    callForPass: false,
  };
}
