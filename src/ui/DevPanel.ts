import { BALL, PLAYER, SHOT_ARC, WALL } from '../game/constants';
import type { Tunables } from '../game/types';

export function defaultTunables(): Tunables {
  return {
    // World-Y reads clearer in greybox; goal-axis remains a Dev toggle (Alex unsure).
    goalAxisUp: false,
    zoomHoldMode: true,
    // Standard FPS / over-shoulder: mouse-right → look right, mouse-up → look up.
    mouseLookInvertX: false,
    mouseLookInvertY: false,
    wallEscapeSpeed: WALL.escapeSpeed,
    wallEscapeAngle: WALL.escapeAngle,
    claimRadius: PLAYER.claimRadius,
    holdLag: BALL.holdLag,
    playerAccel: PLAYER.accel,
    ballDrag: BALL.drag,
    aimAssist: 0.35,
    showChargeGhost: true,
    showDebugStats: true,
    bodyTurnRate: PLAYER.bodyTurnRate,
    bodyIdleSpeed: PLAYER.bodyIdleSpeed,
    swimAnimRate: PLAYER.swimAnimRate,
    swimAnimAmount: PLAYER.swimAnimAmount,
    swimAnim: true,
    strafeSpeedMult: PLAYER.strafeSpeedMult,
    arcAimDistance: SHOT_ARC.aimDistance,
    arcHeight: SHOT_ARC.height,
    arcChargeFlatten: SHOT_ARC.chargeFlatten,
  };
}

export class DevPanel {
  private root: HTMLElement;
  private tunables: Tunables;
  private onChange: () => void;
  visible = true;

  constructor(root: HTMLElement, tunables: Tunables, onChange: () => void) {
    this.root = root;
    this.tunables = tunables;
    this.onChange = onChange;
    this.render();
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.style.display = v ? 'block' : 'none';
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  private render(): void {
    this.root.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = 'Dev toggles';
    this.root.appendChild(h);

    this.bool('Goal-axis up (vs world Y)', 'goalAxisUp');
    this.bool('Zoom = hold (off = toggle)', 'zoomHoldMode');
    this.bool('Invert mouse look X', 'mouseLookInvertX');
    this.bool('Invert mouse look Y', 'mouseLookInvertY');
    this.bool('Charge ghost trail', 'showChargeGhost');
    this.bool('Debug stats', 'showDebugStats');
    this.range('Wall escape speed', 'wallEscapeSpeed', 10, 45, 0.5);
    this.range('Wall escape angle', 'wallEscapeAngle', 0.1, 1.2, 0.01);
    this.range('Claim radius', 'claimRadius', 0.8, 3.5, 0.05);
    this.range('Hold lag', 'holdLag', 2, 20, 0.1);
    this.range('Player accel', 'playerAccel', 15, 80, 1);
    this.range('Ball drag', 'ballDrag', 0.2, 3, 0.05);
    this.range('Aim assist', 'aimAssist', 0, 1, 0.05);
    this.range('Body turn rate', 'bodyTurnRate', 2, 16, 0.5);
    this.range('Idle face speed', 'bodyIdleSpeed', 0.2, 6, 0.1);
    this.bool('Paddle anim', 'swimAnim');
    this.range('Paddle rate', 'swimAnimRate', 0.2, 4, 0.1);
    this.range('Paddle amount', 'swimAnimAmount', 0, 1.4, 0.05);
    this.range('Strafe speed', 'strafeSpeedMult', 0.25, 1, 0.01);
    this.range('Arc aim distance', 'arcAimDistance', 4, 48, 0.5);
    this.range('Arc height', 'arcHeight', 0, 0.8, 0.01);
    this.range('Arc charge flatten', 'arcChargeFlatten', 0, 1, 0.05);
  }

  private bool(label: string, key: keyof Tunables): void {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.style.flex = '1';
    lab.textContent = label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(this.tunables[key]);
    input.addEventListener('change', () => {
      (this.tunables as unknown as Record<string, unknown>)[key] = input.checked;
      // Only the up-axis change rebuilds the chase basis. Invert toggles and
      // other checkboxes must not snap yaw/pitch back to kickoff.
      if (key === 'goalAxisUp') this.onChange();
    });
    row.appendChild(lab);
    row.appendChild(input);
    this.root.appendChild(row);
  }

  private range(
    label: string,
    key: keyof Tunables,
    min: number,
    max: number,
    step: number,
  ): void {
    const wrap = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(this.tunables[key]);
    const value = document.createElement('span');
    value.className = 'value';
    value.textContent = Number(this.tunables[key]).toFixed(2);
    input.addEventListener('input', () => {
      const n = parseFloat(input.value);
      (this.tunables as unknown as Record<string, unknown>)[key] = n;
      value.textContent = n.toFixed(2);
    });
    wrap.appendChild(name);
    wrap.appendChild(input);
    wrap.appendChild(value);
    this.root.appendChild(wrap);
  }
}
