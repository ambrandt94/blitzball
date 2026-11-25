import * as THREE from 'three';
import type { BallState, InputIntent, PlayerState, Tunables } from '../game/types';
import { GOALIE } from '../game/constants';
import { goalPlaneZ } from '../sim/goal';
import { quadraticPoint } from '../sim/shotArc';

/** 0–1 from the global skill, unless that team has an override. */
export function goalieSkill01(tunables: Tunables, team: 0 | 1): number {
  const override = team === 0 ? tunables.goalieHomeOverride : tunables.goalieAwayOverride;
  const value = override
    ? team === 0
      ? tunables.goalieSkillHome
      : tunables.goalieSkillAway
    : tunables.goalieSkill;
  return THREE.MathUtils.clamp(value, 0, 100) / 100;
}

/** Cruise speed. Skill adds a little; it never matches a sprinting field swimmer. */
export function goalieSwimSpeed(skill: number): number {
  return THREE.MathUtils.lerp(GOALIE.speedMin, GOALIE.speedMax, THREE.MathUtils.clamp(skill, 0, 1));
}

/**
 * Crease goalie. He holds his line until a shot has been readable for the
 * reaction delay, then swims toward where that path crosses the crease.
 * He does not claim the ball. Contact is a swept reach test in the sim.
 */
export class GoalieAI {
  private clock = new Map<number, number>();
  private seenAt = new Map<number, number>();
  private spot = new Map<number, THREE.Vector3>();
  private heldFor = new Map<number, number>();
  private dive = new Map<number, boolean>();
  private readonly predict = new THREE.Vector3();

  /** True while he is lunging at a read intercept, so the view can play a dive. */
  diving(id: number): boolean {
    return this.dive.get(id) === true;
  }

  think(
    self: PlayerState,
    ball: BallState,
    tunables: Tunables,
    dt: number,
  ): InputIntent {
    const intent = emptyIntent();
    const skill = goalieSkill01(tunables, self.team);
    const now = (this.clock.get(self.id) ?? 0) + dt;
    this.clock.set(self.id, now);
    this.dive.set(self.id, false);

    if (self.hasBall) {
      const held = (this.heldFor.get(self.id) ?? 0) + dt;
      this.heldFor.set(self.id, held);
      this.seenAt.delete(self.id);
      const wait = 0.45 + (1 - skill) * 0.4;
      if (held >= wait) intent.pass = true;
      return intent;
    }
    this.heldFor.set(self.id, 0);

    const home = this.homeSpot(self);
    const threat = this.isThreat(self, ball);
    if (!threat) {
      this.seenAt.delete(self.id);
      this.spot.set(self.id, home);
    } else if (!this.seenAt.has(self.id)) {
      this.seenAt.set(self.id, now);
      if (!this.spot.has(self.id)) this.spot.set(self.id, home);
    } else {
      const reaction = Math.max(0.04, tunables.goalieReaction) * (1 + (1 - skill) * 1.5);
      if (now - (this.seenAt.get(self.id) ?? now) >= reaction) {
        const read = this.intercept(self, ball, skill);
        this.spot.set(self.id, read);
      }
    }

    const spot = this.spot.get(self.id) ?? home;
    const to = spot.clone().sub(self.position);
    const dist = to.length();
    if (dist > 0.35) {
      intent.move.copy(to).multiplyScalar(1 / dist);
      const closing = this.timeToCrease(self, ball);
      this.dive.set(self.id, threat && dist > 1.05 && closing > 0 && closing < 0.85);
    }
    return intent;
  }

  /** Own goal is the hoop this team does not attack. */
  private ownPlane(team: 0 | 1): { z: number; inward: number } {
    const z = goalPlaneZ(team === 0 ? 1 : 0);
    return { z, inward: z > 0 ? -1 : 1 };
  }

  private homeSpot(self: PlayerState): THREE.Vector3 {
    const { z, inward } = this.ownPlane(self.team);
    return new THREE.Vector3(0, 0.4, z + inward * 5.4);
  }

  /** A ball carrying into this goal, not a teammate swimming it around. */
  private isThreat(self: PlayerState, ball: BallState): boolean {
    if (ball.possession === 'held') return false;
    const { z, inward } = this.ownPlane(self.team);
    const intoGoal = -inward;
    if (ball.arc) return true;
    const closing = ball.velocity.z * intoGoal;
    if (closing < 4) return false;
    const depth = z + inward * 5.4;
    const dz = depth - ball.position.z;
    return dz * intoGoal > 0.4;
  }

  private timeToCrease(self: PlayerState, ball: BallState): number {
    const { z, inward } = this.ownPlane(self.team);
    const depth = z + inward * 5.4;
    const vz = ball.velocity.z;
    if (Math.abs(vz) < 1) return ball.arc ? Math.max(0.05, ball.arc.duration - ball.arc.elapsed) : 2;
    const t = (depth - ball.position.z) / vz;
    return t;
  }

  /** Where the current path crosses the crease. Skill misses wide; the zone is finite. */
  private intercept(self: PlayerState, ball: BallState, skill: number): THREE.Vector3 {
    const { z, inward } = this.ownPlane(self.team);
    const depth = z + inward * (4.6 + skill * 0.8);
    this.readPath(ball, depth);
    const spot = this.predict;
    spot.y = THREE.MathUtils.clamp(spot.y, -3.2, 4.2);
    const sign = self.id % 2 === 0 ? 1 : -1;
    spot.x += (1 - skill) * 2.5 * sign;
    spot.z = depth;
    const zone = 3.1 + skill * 2.4;
    const lateral = Math.hypot(spot.x, spot.y);
    if (lateral > zone) {
      const k = zone / lateral;
      spot.x *= k;
      spot.y *= k;
    }
    return spot.clone();
  }

  /** Point on the ball's current path at `depth`. No pull toward the goalie. */
  private readPath(ball: BallState, depth: number): void {
    const arc = ball.arc;
    if (arc && arc.duration > 0.05) {
      const now = THREE.MathUtils.clamp(arc.elapsed / arc.duration, 0, 1);
      let bestT = now;
      let best = Infinity;
      const sample = new THREE.Vector3();
      for (let i = 0; i <= 12; i++) {
        const t = now + (1 - now) * (i / 12);
        quadraticPoint(sample, arc.p0, arc.p1, arc.p2, t);
        const dz = Math.abs(sample.z - depth);
        if (dz < best) {
          best = dz;
          bestT = t;
        }
      }
      quadraticPoint(this.predict, arc.p0, arc.p1, arc.p2, bestT);
      return;
    }
    const vz = ball.velocity.z;
    const dz = depth - ball.position.z;
    const t = Math.abs(vz) > 1.2 ? dz / vz : -1;
    if (t > 0 && t < 4) this.predict.copy(ball.position).addScaledVector(ball.velocity, t);
    else this.predict.copy(ball.position);
  }
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
    toggleDev: false,
    aimRangeDelta: 0,
    callForPass: false,
  };
}
