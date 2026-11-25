import * as THREE from 'three';
import type { BallState, InputIntent, PlayerState, Tunables } from '../game/types';
import { goalMouthZ } from '../sim/goal';
import { goalCenter } from '../sim/math';

/**
 * Minimal Phase 0 opponent: seek ball when free, drive to goal when carrying,
 * chase carrier when opponent has possession. Reaction delay + aim noise keep it dummy-level.
 */
const DRILL_CHASE = 0.38;
const DRILL_WANDER = 0.3;

export class DummyAI {
  private reaction = new Map<number, number>();
  private cached = new Map<number, InputIntent>();
  private wander = new Map<number, { dir: THREE.Vector3; time: number }>();

  think(
    self: PlayerState,
    ball: BallState,
    _players: PlayerState[],
    tunables: Tunables,
  ): InputIntent {
    const left = (this.reaction.get(self.id) ?? 0) - 1 / 60;
    const cached = this.cached.get(self.id);
    if (cached && left > 0) {
      this.reaction.set(self.id, left);
      return cached;
    }

    this.reaction.set(self.id, 0.35 + Math.random() * 0.4);
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

    this.cached.set(self.id, intent);
    return intent;
  }

  /**
   * Practice dummy. Chases the loose ball well under cruise speed.
   * With the ball, wanders. Never passes or shoots.
   */
  thinkDrill(self: PlayerState, ball: BallState, tunables: Tunables, dt: number): InputIntent {
    const intent = emptyIntent();
    if (self.hasBall) {
      const wander = this.drillWander(self.id);
      wander.time -= dt;
      if (wander.time <= 0) {
        wander.time = 1.3 + Math.random() * 0.8;
        const a = Math.random() * Math.PI * 2;
        wander.dir.set(Math.cos(a), (Math.random() - 0.5) * 0.4, Math.sin(a));
        if (wander.dir.lengthSq() > 1e-6) wander.dir.normalize();
      }
      intent.move.copy(wander.dir).multiplyScalar(DRILL_WANDER);
      intent.up = wander.dir.y * DRILL_WANDER;
      return intent;
    }

    const toBall = ball.position.clone().sub(self.position);
    const dist = toBall.length();
    if (dist > 0.01) toBall.multiplyScalar(1 / dist);
    intent.move.copy(toBall).multiplyScalar(DRILL_CHASE);
    intent.up = toBall.y * DRILL_CHASE;
    if (dist < tunables.catchReach + tunables.claimRadius) intent.claim = true;
    return intent;
  }

  private drillWander(id: number): { dir: THREE.Vector3; time: number } {
    let state = this.wander.get(id);
    if (!state) {
      state = { dir: new THREE.Vector3(1, 0, 0), time: 0 };
      this.wander.set(id, state);
    }
    return state;
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
