import { ARENA_RADIUS, BALL, CAMERA, PLAYER, PRACTICE, SHOT_ARC, WALL } from '../game/constants';
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
    catchReach: PLAYER.claimReach,
    catchStanceReach: PLAYER.catchStanceReach,
    catchStanceWidth: PLAYER.catchStanceWidth,
    catchPull: PLAYER.catchPull,
    holdLag: BALL.holdLag,
    playerAccel: PLAYER.accel,
    playerMaxSpeed: PLAYER.maxSpeed,
    sprintMult: PLAYER.sprintMult,
    passSpeed: BALL.passSpeed,
    shootSpeedMin: BALL.shootSpeedMin,
    shootSpeedMax: BALL.shootSpeedMax,
    burstSpeed: PLAYER.burstSpeed,
    burstDuration: PLAYER.burstDuration,
    burstCooldown: PLAYER.burstCooldown,
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
    arcAimSpeed: SHOT_ARC.aimSpeed,
    arcBendSpeed: SHOT_ARC.bendSpeed,
    arcBendLimit: SHOT_ARC.bendLimit,
    arcHeight: SHOT_ARC.height,
    arcHandCurve: SHOT_ARC.handCurve,
    shotPowerRate: SHOT_ARC.powerRate,
    shotPowerAngle: SHOT_ARC.powerAngle,
    teammateLockRadius: SHOT_ARC.teammateLockRadius,
    shotCarry: SHOT_ARC.carry,
    defenseActive: false,
    soloOpponent: true,
    arenaRadius: ARENA_RADIUS,
    teammatePassDelay: PRACTICE.passDelay,
    shoulderOffset: CAMERA.shoulderOffset,
    shoulderTransition: CAMERA.shoulderTransition,
    aimCursorDistance: CAMERA.aimCursorDistance,
    showSunbeams: true,
    sunbeamIntensity: 0.7,
  };
}

export class DevPanel {
  private root: HTMLElement;
  private tunables: Tunables;
  private onChange: (key: keyof Tunables) => void;
  visible = true;

  constructor(root: HTMLElement, tunables: Tunables, onChange: (key: keyof Tunables) => void) {
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
    this.bool('Defense chases', 'defenseActive');
    this.bool('Test opponent', 'soloOpponent');
    this.range('Arena radius', 'arenaRadius', 44, 96, 0.5);
    this.bool('Sunbeams', 'showSunbeams');
    this.range('Sunbeam strength', 'sunbeamIntensity', 0, 1.5, 0.05);
    this.range('Wall escape speed', 'wallEscapeSpeed', 20, 110, 0.5);
    this.range('Wall escape angle', 'wallEscapeAngle', 0.1, 1.2, 0.01);
    this.range('Claim radius', 'claimRadius', 0.6, 4, 0.05);
    this.range('Catch reach', 'catchReach', 0.8, 6, 0.05);
    this.range('Catch stance reach', 'catchStanceReach', 1, 2.4, 0.05);
    this.range('Catch stance width', 'catchStanceWidth', 1, 2.4, 0.05);
    this.range('Catch pull', 'catchPull', 0, 60, 0.5);
    this.range('Hold lag', 'holdLag', 2, 20, 0.1);
    this.range('Player accel', 'playerAccel', 30, 170, 1);
    this.range('Cruise speed', 'playerMaxSpeed', 8, 40, 0.5);
    this.range('Sprint mult', 'sprintMult', 1, 2, 0.01);
    this.range('Pass speed', 'passSpeed', 12, 80, 1);
    this.range('Shot speed min', 'shootSpeedMin', 12, 70, 1);
    this.range('Shot speed max', 'shootSpeedMax', 20, 110, 1);
    this.range('Check speed', 'burstSpeed', 16, 60, 0.5);
    this.range('Check window', 'burstDuration', 0.08, 0.5, 0.01);
    this.range('Check cooldown', 'burstCooldown', 0.2, 1.6, 0.01);
    this.range('Ball drag', 'ballDrag', 0.2, 3, 0.05);
    this.range('Aim assist', 'aimAssist', 0, 1, 0.05);
    this.range('Body turn rate', 'bodyTurnRate', 2, 16, 0.5);
    this.range('Idle face speed', 'bodyIdleSpeed', 0.4, 12, 0.1);
    this.bool('Paddle anim', 'swimAnim');
    this.range('Paddle rate', 'swimAnimRate', 0.2, 4, 0.1);
    this.range('Paddle amount', 'swimAnimAmount', 0, 1.4, 0.05);
    this.range('Strafe speed', 'strafeSpeedMult', 0.25, 1, 0.01);
    this.range('Shoulder offset', 'shoulderOffset', 0, 3.2, 0.05);
    this.range('Shoulder transition', 'shoulderTransition', 1, 18, 0.1);
    this.range('Aim cursor distance', 'aimCursorDistance', 6, 48, 0.5);
    this.range('Arc aim distance', 'arcAimDistance', 8, 90, 0.5);
    this.range('Arc aim speed', 'arcAimSpeed', 4, 70, 1);
    this.range('Arc bend speed', 'arcBendSpeed', 0, 140, 1);
    this.range('Arc bend limit', 'arcBendLimit', 0, 1.5, 0.05);
    this.range('Arc height', 'arcHeight', 0, 0.8, 0.01);
    this.range('Arc hand curve', 'arcHandCurve', 0, 0.6, 0.01);
    this.range('Power fill rate', 'shotPowerRate', 0.2, 4, 0.05);
    this.range('Power angle', 'shotPowerAngle', 0, 0.4, 0.01);
    this.range('Teammate lock radius', 'teammateLockRadius', 0.3, 3, 0.05);
    this.range('Shot carry', 'shotCarry', 0, 60, 0.5);
    this.range('Teammate pass delay', 'teammatePassDelay', 0.3, 3, 0.05);
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
      if (key === 'goalAxisUp') this.onChange(key);
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
      if (key === 'arenaRadius') this.onChange(key);
    });
    wrap.appendChild(name);
    wrap.appendChild(input);
    wrap.appendChild(value);
    this.root.appendChild(wrap);
  }
}
