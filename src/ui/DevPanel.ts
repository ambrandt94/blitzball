import { ARENA_RADIUS, BALL, CAMERA, PLAYER, PRACTICE, SHOT_ARC, WALL } from '../game/constants';
import type { BotBehavior, PowerMode, RosterSpec, Tunables } from '../game/types';
import { loadRoster, saveRoster } from './rosterStorage';

const POWER_MODE_KEY = 'blitzball.powerMode';
const SECTIONS_KEY = 'blitzball.devSections';

export interface RosterBotView {
  id: number;
  team: 0 | 1;
  behavior: BotBehavior;
  name: string;
}

export interface RosterControl {
  listBots(): RosterBotView[];
  swimmerCount(team: 0 | 1): number;
  maxSwimmers(): number;
  addBot(team: 0 | 1, behavior?: BotBehavior): boolean;
  removeBot(id: number): boolean;
  setBotBehavior(id: number, behavior: BotBehavior): void;
  applyRoster(spec: RosterSpec): void;
  exportRoster(): RosterSpec;
}

function loadPowerMode(): PowerMode | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const value = localStorage.getItem(POWER_MODE_KEY);
    if (value === 'meter' || value === 'tap' || value === 'hold' || value === 'target' || value === 'pull') return value;
  } catch {
    // Headless or blocked storage. Keep the built-in default.
  }
  return null;
}

function savePowerMode(mode: PowerMode): void {
  try {
    localStorage.setItem(POWER_MODE_KEY, mode);
  } catch {
    // Ignore quota and private-mode failures.
  }
}

function loadCollapsed(): Record<string, boolean> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(SECTIONS_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!data || typeof data !== 'object') return {};
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'boolean') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function saveCollapsed(state: Record<string, boolean>): void {
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(state));
  } catch {
    // Ignore quota and private-mode failures.
  }
}

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
    powerMode: 'meter',
    tapWindow: SHOT_ARC.tapWindow,
    tapMax: SHOT_ARC.tapMax,
    teammateLockRadius: SHOT_ARC.teammateLockRadius,
    shotCarry: SHOT_ARC.carry,
    defenseActive: false,
    soloOpponent: true,
    arenaRadius: ARENA_RADIUS,
    teammatePassDelay: PRACTICE.passDelay,
    shoulderOffset: CAMERA.shoulderOffset,
    shoulderTransition: CAMERA.shoulderTransition,
    showSunbeams: true,
    sunbeamIntensity: 0.7,
  };
}

export class DevPanel {
  private root: HTMLElement;
  private tunables: Tunables;
  private onChange: (key: keyof Tunables) => void;
  private roster: RosterControl;
  private collapsed: Record<string, boolean>;
  private mount: HTMLElement;
  private rosterBody: HTMLElement | null = null;
  visible = true;

  constructor(
    root: HTMLElement,
    tunables: Tunables,
    onChange: (key: keyof Tunables) => void,
    roster: RosterControl,
  ) {
    this.root = root;
    this.tunables = tunables;
    this.onChange = onChange;
    this.roster = roster;
    this.mount = root;
    const saved = loadPowerMode();
    if (saved) this.tunables.powerMode = saved;
    const savedRoster = loadRoster();
    if (savedRoster) this.roster.applyRoster(savedRoster);
    this.collapsed = loadCollapsed();
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
    this.mount = this.root;
    const h = document.createElement('h2');
    h.textContent = 'Dev toggles';
    this.root.appendChild(h);
    this.renderRosterCard();

    this.section('Throwing / Power', 'throwing', () => {
      this.choice('Power mode', 'powerMode', [
        { value: 'meter', label: 'Meter' },
        { value: 'tap', label: 'Tap' },
        { value: 'hold', label: 'Hold' },
        { value: 'target', label: 'Target' },
        { value: 'pull', label: 'Pull' },
      ]);
      this.range('Power fill rate', 'shotPowerRate', 0.2, 4, 0.05);
      this.range('Power angle', 'shotPowerAngle', 0, 0.4, 0.01);
      this.range('Tap window', 'tapWindow', 0.15, 0.9, 0.05);
      this.range('Max taps', 'tapMax', 1, 9, 1);
      this.range('Shot speed min', 'shootSpeedMin', 12, 70, 1);
      this.range('Shot speed max', 'shootSpeedMax', 20, 110, 1);
      this.range('Arc aim distance', 'arcAimDistance', 8, 90, 0.5);
      this.range('Arc aim speed', 'arcAimSpeed', 4, 70, 1);
      this.range('Arc bend speed', 'arcBendSpeed', 0, 140, 1);
      this.range('Arc bend limit', 'arcBendLimit', 0, 1.5, 0.05);
      this.range('Arc height', 'arcHeight', 0, 0.8, 0.01);
      this.range('Arc hand curve', 'arcHandCurve', 0, 0.6, 0.01);
      this.range('Shot carry', 'shotCarry', 0, 60, 0.5);
      this.range('Teammate lock radius', 'teammateLockRadius', 0.3, 3, 0.05);
      this.range('Aim assist', 'aimAssist', 0, 1, 0.05);
    });

    this.section('Movement', 'movement', () => {
      this.range('Acceleration', 'playerAccel', 30, 170, 1);
      this.range('Cruise speed', 'playerMaxSpeed', 8, 40, 0.5);
      this.range('Sprint mult', 'sprintMult', 1, 2, 0.01);
      this.range('Strafe speed', 'strafeSpeedMult', 0.25, 1, 0.01);
      this.range('Body turn rate', 'bodyTurnRate', 2, 16, 0.5);
      this.range('Idle face speed', 'bodyIdleSpeed', 0.4, 12, 0.1);
      this.bool('Paddle anim', 'swimAnim');
      this.range('Paddle rate', 'swimAnimRate', 0.2, 4, 0.1);
      this.range('Paddle amount', 'swimAnimAmount', 0, 1.4, 0.05);
      this.range('Check speed', 'burstSpeed', 16, 60, 0.5);
      this.range('Check window', 'burstDuration', 0.08, 0.5, 0.01);
      this.range('Check cooldown', 'burstCooldown', 0.2, 1.6, 0.01);
    });

    this.section('Camera', 'camera', () => {
      this.bool('Goal-axis up', 'goalAxisUp');
      this.bool('Zoom hold (V / LB)', 'zoomHoldMode');
      this.bool('Invert look X', 'mouseLookInvertX');
      this.bool('Invert look Y', 'mouseLookInvertY');
      this.range('Shoulder offset', 'shoulderOffset', 0, 3.2, 0.05);
      this.range('Shoulder transition', 'shoulderTransition', 1, 18, 0.1);
    });

    this.section('Arena', 'arena', () => {
      this.range('Arena radius', 'arenaRadius', 44, 96, 0.5);
      this.bool('Sunbeams', 'showSunbeams');
      this.range('Sunbeam strength', 'sunbeamIntensity', 0, 1.5, 0.05);
    });

    this.section('Ball / Physics', 'ball', () => {
      this.range('Wall escape speed', 'wallEscapeSpeed', 20, 110, 0.5);
      this.range('Wall escape angle', 'wallEscapeAngle', 0.1, 1.2, 0.01);
      this.range('Claim radius', 'claimRadius', 0.6, 4, 0.05);
      this.range('Catch reach', 'catchReach', 0.8, 6, 0.05);
      this.range('Catch stance reach', 'catchStanceReach', 1, 2.4, 0.05);
      this.range('Catch stance width', 'catchStanceWidth', 1, 2.4, 0.05);
      this.range('Catch pull', 'catchPull', 0, 60, 0.5);
      this.range('Hold lag', 'holdLag', 2, 20, 0.1);
      this.range('Pass speed', 'passSpeed', 12, 80, 1);
      this.range('Ball drag', 'ballDrag', 0.2, 3, 0.05);
    });

    this.section('Teams', 'teams', () => {
      this.bool('Normal defense chases', 'defenseActive');
      this.range('Teammate pass delay', 'teammatePassDelay', 0.3, 3, 0.05);
    });

    this.section('Visual / Debug', 'visual', () => {
      this.bool('Charge ghost', 'showChargeGhost');
      this.bool('Debug stats', 'showDebugStats');
    });
  }

  private renderRosterCard(): void {
    const card = document.createElement('section');
    card.className = 'roster-card';
    card.setAttribute('aria-label', 'Team roster');
    const title = document.createElement('h3');
    title.textContent = 'Team roster';
    card.appendChild(title);
    this.rosterBody = document.createElement('div');
    card.appendChild(this.rosterBody);
    const note = document.createElement('p');
    note.className = 'roster-note';
    note.textContent =
      'Test chasers chase slowly and hold the ball. Normal teammates pass back. Normal defense holds unless it is set to chase.';
    card.appendChild(note);
    this.root.appendChild(card);
    this.refreshRoster();
  }

  private refreshRoster(): void {
    const body = this.rosterBody;
    if (!body) return;
    body.innerHTML = '';
    const bots = this.roster.listBots();
    this.teamBlock(body, 0, 'Home (Blue)', bots);
    this.teamBlock(body, 1, 'Away (Orange)', bots);
  }

  private teamBlock(body: HTMLElement, team: 0 | 1, title: string, bots: RosterBotView[]): void {
    const wrap = document.createElement('div');
    wrap.className = 'roster-team';
    const head = document.createElement('div');
    head.className = 'roster-head';
    const name = document.createElement('span');
    name.textContent = title;
    const count = document.createElement('span');
    const swimming = this.roster.swimmerCount(team);
    const max = this.roster.maxSwimmers();
    count.textContent = `${swimming}/${max}`;
    head.append(name, count);
    wrap.append(head);

    const mine = bots.filter((bot) => bot.team === team);
    if (mine.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'roster-empty';
      empty.textContent = 'No bots';
      wrap.append(empty);
    }
    for (const bot of mine) {
      const row = document.createElement('div');
      row.className = 'bot-row';
      const label = document.createElement('span');
      label.className = 'bot-name';
      label.textContent = bot.name;
      const select = document.createElement('select');
      select.setAttribute('aria-label', `${title} ${bot.name} behavior`);
      for (const option of [
        { value: 'normal', label: 'Normal AI' },
        { value: 'chaser', label: 'Test chaser' },
      ]) {
        const item = document.createElement('option');
        item.value = option.value;
        item.textContent = option.label;
        select.append(item);
      }
      select.value = bot.behavior;
      select.addEventListener('change', () => {
        const value: BotBehavior = select.value === 'chaser' ? 'chaser' : 'normal';
        this.roster.setBotBehavior(bot.id, value);
        saveRoster(this.roster.exportRoster());
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = 'Remove';
      remove.title = 'Despawn this bot. A held ball drops loose.';
      remove.addEventListener('click', () => {
        this.roster.removeBot(bot.id);
        saveRoster(this.roster.exportRoster());
        this.refreshRoster();
      });
      row.append(label, select, remove);
      wrap.append(row);
    }

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'add-bot';
    add.textContent = 'Add bot';
    const full = swimming >= max;
    add.disabled = full;
    add.title = full ? 'This side is full (6 swimmers).' : 'Add a normal AI bot.';
    add.addEventListener('click', () => {
      if (!this.roster.addBot(team, 'normal')) return;
      saveRoster(this.roster.exportRoster());
      this.refreshRoster();
    });
    wrap.append(add);
    body.append(wrap);
  }

  private section(title: string, key: string, build: () => void): void {
    const collapsed = this.collapsed[key] === true;
    const block = document.createElement('section');
    block.className = 'dev-section';
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'dev-section-head';
    head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    const label = document.createElement('span');
    label.textContent = title;
    const mark = document.createElement('span');
    mark.className = 'chevron';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = collapsed ? '▸' : '▾';
    head.append(label, mark);
    const body = document.createElement('div');
    body.className = 'dev-section-body';
    if (collapsed) body.hidden = true;
    const previous = this.mount;
    this.mount = body;
    build();
    this.mount = previous;
    head.addEventListener('click', () => {
      const nextCollapsed = !body.hidden;
      body.hidden = nextCollapsed;
      mark.textContent = nextCollapsed ? '▸' : '▾';
      head.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
      this.collapsed[key] = nextCollapsed;
      saveCollapsed(this.collapsed);
    });
    block.append(head, body);
    this.root.append(block);
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
    row.append(lab, input);
    this.mount.append(row);
  }

  private choice(label: string, key: 'powerMode', options: { value: PowerMode; label: string }[]): void {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.style.flex = '1';
    lab.textContent = label;
    const input = document.createElement('select');
    for (const option of options) {
      const item = document.createElement('option');
      item.value = option.value;
      item.textContent = option.label;
      input.append(item);
    }
    input.value = this.tunables[key];
    input.addEventListener('change', () => {
      const value = input.value;
      if (value !== 'meter' && value !== 'tap' && value !== 'hold' && value !== 'target' && value !== 'pull') return;
      this.tunables[key] = value;
      savePowerMode(value);
    });
    row.append(lab, input);
    this.mount.append(row);
  }

  private range(label: string, key: keyof Tunables, min: number, max: number, step: number): void {
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
    wrap.append(name, input, value);
    this.mount.append(wrap);
  }
}
