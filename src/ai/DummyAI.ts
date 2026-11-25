import * as THREE from 'three';
import type { BallState, InputIntent, PlayerState, Tunables } from '../game/types';
import { FieldAI, type AiDelivery, type AiMark } from './FieldAI';

/**
 * Opponents when defense is allowed to play. The test-chaser drill stays a
 * slow ball-follower that never passes or shoots.
 */
const DRILL_CHASE = 0.38;
const DRILL_WANDER = 0.3;

export class DummyAI {
  private field = new FieldAI();
  private wander = new THREE.Vector3(1, 0, 0);
  private wanderTime = 0;

  think(
    self: PlayerState,
    ball: BallState,
    players: PlayerState[],
    tunables: Tunables,
    dt: number,
  ): InputIntent {
    return this.field.think(self, ball, players, tunables, dt);
  }

  marks(): readonly AiMark[] {
    return this.field.marks();
  }

  takeDelivery(id: number): AiDelivery | null {
    return this.field.takeDelivery(id);
  }

  /**
   * Practice dummy. Chases the loose ball well under cruise speed.
   * With the ball, wanders. Never passes or shoots.
   */
  thinkDrill(self: PlayerState, ball: BallState, tunables: Tunables, dt: number): InputIntent {
    const intent = emptyIntent();
    if (self.hasBall) {
      this.wanderTime -= dt;
      if (this.wanderTime <= 0) {
        this.wanderTime = 1.3 + Math.random() * 0.8;
        const a = Math.random() * Math.PI * 2;
        this.wander.set(Math.cos(a), (Math.random() - 0.5) * 0.4, Math.sin(a));
        if (this.wander.lengthSq() > 1e-6) this.wander.normalize();
      }
      intent.move.copy(this.wander).multiplyScalar(DRILL_WANDER);
      intent.up = this.wander.y * DRILL_WANDER;
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
