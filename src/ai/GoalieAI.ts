import * as THREE from 'three';
import type { BallState, InputIntent, PlayerState, Tunables } from '../game/types';
import { PLAYER } from '../game/constants';
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

/** Shot speed this goalie will catch. Anything faster is a parry, if they get there. */
export function goalieCatchSpeed(skill: number): number {
  return 8 + THREE.MathUtils.clamp(skill, 0, 1) * 36;
}

/**
 * Crease goalie. Holds a zone in front of their own triangle, steps onto the
 * line between the ball and the goal, and jumps a curved shot when they read it.
 */
export class GoalieAI {
  private clock = new Map<number, number>();
  private nextThink = new Map<number, number>();
  private spot = new Map<number, THREE.Vector3>();
  private heldFor = new Map<number, number>();
  private readonly predict = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();

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

    if (self.hasBall) {
      const held = (this.heldFor.get(self.id) ?? 0) + dt;
      this.heldFor.set(self.id, held);
      const wait = 0.35 + (1 - skill) * 0.55;
      if (held >= wait) intent.pass = true;
      return intent;
    }
    this.heldFor.set(self.id, 0);

    const delay = 0.03 + (1 - skill) * 0.52;
    if (!this.nextThink.has(self.id)) this.nextThink.set(self.id, delay);
    if (now >= (this.nextThink.get(self.id) ?? 0)) {
      this.spot.set(self.id, this.anchorSpot(self, ball, skill));
      this.nextThink.set(self.id, now + delay);
    }

    const spot = this.spot.get(self.id);
    const scale = 0.32 + skill * 0.74;
    if (spot) {
      const to = spot.clone().sub(self.position);
      const dist = to.length();
      if (dist > 0.4) {
        intent.move.copy(to).multiplyScalar(scale / dist);
        intent.sprint = skill > 0.62 && dist > 1.1;
      }
    }
    const face = this.aim.clone().sub(self.position);
    if (intent.move.lengthSq() < 1e-4 && this.spot.has(self.id) && face.lengthSq() > 0.25) {
      intent.move.copy(face).multiplyScalar(0.14 / face.length());
    }

    const speed = Math.max(ball.velocity.length(), ball.arc ? 18 : 0);
    const reach = PLAYER.radius + tunables.claimRadius + tunables.catchReach * (0.45 + skill * 0.35);
    if (self.position.distanceTo(ball.position) < reach && speed <= goalieCatchSpeed(skill)) intent.claim = true;
    return intent;
  }

  /** Own goal is the hoop this team does not attack. */
  private ownPlane(team: 0 | 1): { z: number; inward: number } {
    const z = goalPlaneZ(team === 0 ? 1 : 0);
    return { z, inward: z > 0 ? -1 : 1 };
  }

  private anchorSpot(self: PlayerState, ball: BallState, skill: number): THREE.Vector3 {
    const { z, inward } = this.ownPlane(self.team);
    const depth = z + inward * (4.4 + skill * 1.8);
    this.readThreat(ball, depth, skill);
    const spot = new THREE.Vector3(this.predict.x, THREE.MathUtils.clamp(this.predict.y, -5, 5), depth);
    const zone = 2.1 + skill * 5.4;
    const error = (1 - skill) * 3.35 * (self.id % 2 === 0 ? 1 : -1);
    spot.x += error;
    const lateral = Math.hypot(spot.x, spot.y);
    if (lateral > zone) {
      const k = zone / lateral;
      spot.x *= k;
      spot.y *= k;
    }
    return spot;
  }

  /** Where the ball will be at the crease depth. Low skill keeps more of the current position. */
  private readThreat(ball: BallState, depth: number, skill: number): void {
    const arc = ball.arc;
    if (arc && arc.duration > 0.05) {
      const now = THREE.MathUtils.clamp(arc.elapsed / arc.duration, 0, 1);
      let bestT = now;
      let best = Infinity;
      for (let i = 0; i <= 10; i++) {
        const t = now + (1 - now) * (i / 10);
        quadraticPoint(this.aim, arc.p0, arc.p1, arc.p2, t);
        const dz = Math.abs(this.aim.z - depth);
        if (dz < best) {
          best = dz;
          bestT = t;
        }
      }
      quadraticPoint(this.predict, arc.p0, arc.p1, arc.p2, bestT);
    } else {
      const vz = ball.velocity.z;
      const dz = depth - ball.position.z;
      const t = Math.abs(vz) > 1.2 ? dz / vz : -1;
      if (t > 0 && t < 3.2) {
        this.predict.copy(ball.position).addScaledVector(ball.velocity, t * (0.2 + 0.8 * skill));
      } else {
        this.predict.copy(ball.position);
      }
    }
    this.predict.lerp(ball.position, (1 - skill) * 0.72);
    this.aim.copy(this.predict);
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
    aimCancel: false,
    burst: false,
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
