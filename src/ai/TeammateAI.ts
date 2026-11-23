import * as THREE from 'three';
import { ARENA_RADIUS, PRACTICE } from '../game/constants';
import type { BallState, InputIntent, PlayerState, Tunables } from '../game/types';

/**
 * One practice partner. Gets open when you have the ball, runs onto a pass,
 * and gives it back after a short hold or when you call for it.
 */
export class TeammateAI {
  private heldFor = 0;

  think(
    self: PlayerState,
    ball: BallState,
    players: PlayerState[],
    tunables: Tunables,
    human: PlayerState,
    callForPass: boolean,
    dt: number,
  ): InputIntent {
    const intent = emptyIntent();

    if (self.hasBall) {
      this.heldFor += dt;
      const toHuman = human.position.clone().sub(self.position);
      const dist = toHuman.length();
      if (dist > 16) intent.move.copy(toHuman).multiplyScalar(1 / dist);
      if (this.heldFor >= tunables.teammatePassDelay || callForPass) intent.pass = true;
      return intent;
    }

    this.heldFor = 0;

    if (this.shouldReceive(self, ball, human)) {
      const chase = ball.position.clone().addScaledVector(ball.velocity, Math.min(0.4, ball.velocity.length() > 1 ? 0.35 : 0));
      const to = chase.sub(self.position);
      const dist = to.length();
      if (dist > 0.35) {
        intent.move.copy(to).multiplyScalar(1 / dist);
        intent.sprint = dist > 4;
      }
      if (dist < 1.7) intent.claim = true;
      return intent;
    }

    const open = this.openPoint(self, human, players);
    const toOpen = open.sub(self.position);
    const gap = toOpen.length();
    if (gap > 1.2) {
      intent.move.copy(toOpen).multiplyScalar(1 / gap);
      intent.sprint = callForPass || gap > 18;
    }
    return intent;
  }

  private shouldReceive(self: PlayerState, ball: BallState, human: PlayerState): boolean {
    if (ball.possession !== 'free') return false;
    const toMe = self.position.distanceTo(ball.position);
    const toHuman = human.position.distanceTo(ball.position);
    const speed = ball.velocity.length();
    if (ball.lastOwnerId === human.id && (speed > 3.5 || toMe + 1 < toHuman)) return true;
    if (speed > 8 && toMe < 36) {
      const toward = self.position.clone().sub(ball.position);
      if (toward.lengthSq() > 0.01 && ball.velocity.clone().normalize().dot(toward.normalize()) > 0.35) return true;
    }
    return toMe + 4 < toHuman && toMe < 24;
  }

  private openPoint(self: PlayerState, human: PlayerState, players: PlayerState[]): THREE.Vector3 {
    const attack = new THREE.Vector3(0, 0, self.team === 0 ? 1 : -1);
    const side = new THREE.Vector3().crossVectors(attack, new THREE.Vector3(0, 1, 0)).normalize();
    let sign = 1;
    let nearest = Infinity;
    for (const other of players) {
      if (!other.active || other.team === self.team) continue;
      const lateral = other.position.clone().sub(human.position).dot(side);
      const abs = Math.abs(lateral);
      if (abs < nearest) {
        nearest = abs;
        sign = lateral >= 0 ? -1 : 1;
      }
    }
    const spot = human.position
      .clone()
      .addScaledVector(side, sign * PRACTICE.openSide)
      .addScaledVector(attack, PRACTICE.openForward);
    const limit = ARENA_RADIUS * 0.72;
    if (spot.length() > limit) spot.setLength(limit);
    return spot;
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
    passHeld: false,
    zoomOut: false,
    zoomTogglePressed: false,
    resetBall: false,
    toggleDev: false,
    aimRangeDelta: 0,
    callForPass: false,
  };
}
