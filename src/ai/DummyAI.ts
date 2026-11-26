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
  private wander = new Map<number, { dir: THREE.Vector3; time: number }>();

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
    if (dist > 0.05 && dist < Math.max(0.4, tunables.grabReach) && self.facing.dot(toBall) > 0.45) {
      intent.claim = true;
    }
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
