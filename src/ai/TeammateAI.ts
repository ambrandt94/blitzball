import type { BallState, InputIntent, PlayerState, Tunables } from '../game/types';
import { FieldAI, type AiDelivery, type AiMark } from './FieldAI';

/**
 * Field players on the human's team. Same decisions as the opposition.
 * Calling for the ball forces a pass back through that pipeline.
 */
export class TeammateAI {
  private field = new FieldAI();

  think(
    self: PlayerState,
    ball: BallState,
    players: PlayerState[],
    tunables: Tunables,
    human: PlayerState,
    callForPass: boolean,
    dt: number,
  ): InputIntent {
    const force = callForPass && self.hasBall ? human : undefined;
    return this.field.think(self, ball, players, tunables, dt, force);
  }

  marks(): readonly AiMark[] {
    return this.field.marks();
  }

  takeDelivery(id: number): AiDelivery | null {
    return this.field.takeDelivery(id);
  }
}
