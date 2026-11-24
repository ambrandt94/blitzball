import * as THREE from 'three';
import type { BallState, InputIntent, PlayerState, Tunables } from '../game/types';
import { goalMouthZ } from '../sim/goal';
import { goalCenter } from '../sim/math';

/**
 * Minimal Phase 0 opponent: seek ball when free, drive to goal when carrying,
 * chase carrier when opponent has possession. Reaction delay + aim noise keep it dummy-level.
 */
export class DummyAI {
  private reaction = 0;
  private cached: InputIntent | null = null;

  think(
    self: PlayerState,
    ball: BallState,
    _players: PlayerState[],
    tunables: Tunables,
  ): InputIntent {
    this.reaction -= 1 / 60;
    if (this.cached && this.reaction > 0) return this.cached;

    this.reaction = 0.35 + Math.random() * 0.4;
    const intent = emptyIntent();

    if (self.hasBall) {
      const goal = goalCenter(self.team);
      const toGoal = goal.clone().sub(self.position);
      const dist = toGoal.length();
      toGoal.normalize();
      toGoal.x += (Math.random() - 0.5) * 0.2;
      toGoal.y += (Math.random() - 0.5) * 0.2;
      toGoal.normalize();
      intent.move.copy(toGoal);
      intent.up = toGoal.y;
      // Hesitate before shooting so human can contest
      if (dist < goalMouthZ() * 0.55 && self.facing.dot(toGoal) > 0.55 && Math.random() < 0.025) {
        intent.shoot = true;
      }
    } else if (ball.possession === 'free') {
      const toBall = ball.position.clone().sub(self.position);
      const dist = toBall.length();
      if (dist > 0.01) toBall.normalize();
      // Approach at partial speed so human can win the race
      intent.move.copy(toBall).multiplyScalar(0.72);
      intent.up = toBall.y * 0.72;
      intent.sprint = false;
      if (dist < tunables.catchReach + tunables.claimRadius) intent.claim = true;
    } else if (ball.ownerId !== null && ball.ownerId !== self.id) {
      const toBall = ball.position.clone().sub(self.position);
      const dist = toBall.length();
      if (dist > 0.01) toBall.normalize();
      intent.move.copy(toBall).multiplyScalar(0.65);
      intent.up = toBall.y * 0.65;
      intent.sprint = false;
      // Rare strip attempts — dummy, not a pest
      if (dist < 1.8) intent.claim = Math.random() < 0.02;
    }

    this.cached = intent;
    return intent;
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
