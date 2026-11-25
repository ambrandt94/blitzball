import { ARENA_RADIUS, BALL, GOALIE, PLAYER, PRACTICE, SHOT_ARC, WALL } from '../game/constants';
import { TIME_SCALE_DEFAULT, clampTimeScale } from '../sim/timeScale';
import type { BotBehavior, CameraPresetId, MatchPresetId, PowerMode, RosterSpec, Tunables } from '../game/types';
import { loadRoster, saveRoster } from './rosterStorage';
import {
  defaultCharacterSettings,
  loadCharacterSettings,
  saveCharacterSettings,
  type CharacterSettings,
} from './characterSettings';
import {
  cleanIndicatorSettings,
  debugIndicatorSettings,
  loadIndicatorSettings,
  saveIndicatorSettings,
  type IndicatorSettings,
} from './indicatorSettings';
import { matchRoster, presetAllowsGoalieToggle } from './matchPresets';
import {
  applyCameraPreset,
  applyCameraSave,
  isLookAhead,
  loadCameraSettings,
  noteCameraEdit,
  saveCameraSettings,
  defaultCameraFields,
} from './cameraSettings';
import {
  CAUSTIC_FPS_DEFAULT,
  CAUSTIC_FPS_MAX,
  CAUSTIC_FPS_MIN,
  CAUSTIC_SCROLL_DEFAULT,
  CAUSTIC_SCROLL_MAX,
  CAUSTIC_SCROLL_MIN,
  LIGHT_BANDS_DEFAULT,
  colorsForPreset,
  loadWaterColors,
  saveWaterColors,
  type WaterColors,
} from '../render/waterSettings';

const POWER_MODE_KEY = 'blitzball.powerMode';
const CURVE_AIM_OFFSET_KEY = 'blitzball.curveAimOffset';
const TIME_SCALE_KEY = 'blitzball.timeScale';
const TIME_SCALE_VERSION_KEY = 'blitzball.timeScaleVersion';
const TIME_SCALE_FLIGHT_KEY = 'blitzball.timeScaleFlight';
const SHOW_HELP_KEY = 'blitzball.showHelp';
const ZOOM_HOLD_KEY = 'blitzball.zoomHoldMode';
const ZOOM_HOLD_VERSION_KEY = 'blitzball.zoomHoldVersion';
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

export interface CharacterMenu {
  outfits: { id: string; label: string }[];
  onChange: (settings: CharacterSettings) => void;
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

/** Saved curve-aim offset, clamped to the slider. Null when nothing valid is stored. */
export function loadCurveAimOffset(): number | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return parseCurveAimOffset(localStorage.getItem(CURVE_AIM_OFFSET_KEY));
  } catch {
    return null;
  }
}

export function parseCurveAimOffset(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(1.25, Math.max(0, n));
}

function loadTimeScale(): number | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    // Older builds saved a slow scale with no way back to 1x. Treat that as unset.
    if (localStorage.getItem(TIME_SCALE_VERSION_KEY) !== '1') {
      localStorage.setItem(TIME_SCALE_KEY, String(TIME_SCALE_DEFAULT));
      localStorage.setItem(TIME_SCALE_VERSION_KEY, '1');
      return TIME_SCALE_DEFAULT;
    }
    const parsed = Number(localStorage.getItem(TIME_SCALE_KEY));
    if (!Number.isFinite(parsed)) return null;
    return clampTimeScale(parsed);
  } catch {
    return null;
  }
}

function loadFlightOnly(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(TIME_SCALE_FLIGHT_KEY) === '1';
  } catch {
    return false;
  }
}

/** First visit of this default forces toggle. Later checkbox changes are kept. */
function loadZoomHoldMode(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    if (localStorage.getItem(ZOOM_HOLD_VERSION_KEY) !== '1') {
      localStorage.setItem(ZOOM_HOLD_KEY, '0');
      localStorage.setItem(ZOOM_HOLD_VERSION_KEY, '1');
      return false;
    }
    return localStorage.getItem(ZOOM_HOLD_KEY) === '1';
  } catch {
    return false;
  }
}

function saveZoomHoldMode(hold: boolean): void {
  try {
    localStorage.setItem(ZOOM_HOLD_KEY, hold ? '1' : '0');
    localStorage.setItem(ZOOM_HOLD_VERSION_KEY, '1');
  } catch {
    // Ignore quota and private-mode failures.
  }
}

function loadShowHelp(): boolean {
  try {
    if (typeof localStorage === 'undefined') return true;
    const stored = localStorage.getItem(SHOW_HELP_KEY);
    if (stored === null) return true;
    return stored === '1';
  } catch {
    return true;
  }
}

function saveShowHelp(on: boolean): void {
  try {
    localStorage.setItem(SHOW_HELP_KEY, on ? '1' : '0');
  } catch {
    // Ignore quota and private-mode failures.
  }
}

function saveFlightOnly(on: boolean): void {
  try {
    localStorage.setItem(TIME_SCALE_FLIGHT_KEY, on ? '1' : '0');
  } catch {
    // Ignore quota and private-mode failures.
  }
}

function saveTimeScale(value: number): void {
  try {
    localStorage.setItem(TIME_SCALE_KEY, String(clampTimeScale(value)));
    localStorage.setItem(TIME_SCALE_VERSION_KEY, '1');
  } catch {
    // Ignore quota and private-mode failures.
  }
}

function saveCurveAimOffset(value: number): void {
  try {
    localStorage.setItem(CURVE_AIM_OFFSET_KEY, String(value));
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
  const waterColors = loadWaterColors();
  return {
    // World-Y reads clearer in greybox; goal-axis remains a Dev toggle (Alex unsure).
    goalAxisUp: false,
    zoomHoldMode: false,
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
    catchReadyRadius: 6.5,
    catchReadyCone: 0.7,
    fumbleSpeed: 48,
    deflectStrength: 28,
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
    lightBurstSpeed: PLAYER.lightBurstSpeed,
    lightBurstDuration: PLAYER.lightBurstDuration,
    lightBurstCooldown: PLAYER.lightBurstCooldown,
    lightKnock: PLAYER.lightKnock,
    tackleTapTime: PLAYER.tackleTapTime,
    tackleChargeTime: PLAYER.tackleChargeTime,
    tacklePopMin: PLAYER.tacklePopMin,
    tacklePopMax: PLAYER.tacklePopMax,
    tackleSelfStagger: PLAYER.tackleSelfStagger,
    checkKnock: PLAYER.checkKnock,
    ballDrag: BALL.drag,
    aimAssist: 0.35,
    showChargeGhost: true,
    showDebugStats: true,
    showHelp: true,
    bodyTurnRate: PLAYER.bodyTurnRate,
    turnSmooth: PLAYER.turnSmooth,
    bodyIdleSpeed: PLAYER.bodyIdleSpeed,
    swimAnimRate: PLAYER.swimAnimRate,
    swimAnimAmount: PLAYER.swimAnimAmount,
    swimAnim: true,
    strafeSpeedMult: PLAYER.strafeSpeedMult,
    arcAimDistance: SHOT_ARC.aimDistance,
    arcAimSpeed: SHOT_ARC.aimSpeed,
    arcBendSpeed: SHOT_ARC.bendSpeed,
    arcBendLimit: SHOT_ARC.bendLimit,
    curveAimOffset: SHOT_ARC.curveAimOffset,
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
    fieldSkillA: 70,
    fieldSkillB: 70,
    showAiIntent: false,
    aimPostureBlend: 0.25,
    blendStiffness: 8,
    bankAmount: 0.42,
    kickRange: 1.25,
    kickSpeed: 1.25,
    kickCurve: 0.5,
    kickWindup: 0.15,
    kickPower: 18,
    kickSweet: 0.14,
    kickReach: 0.62,
    volleyCone: 0.6,
    volleySpread: 0.38,
    throwSpeedScale: 0.88,
    waterStyle: 'trailbound',
    waterPreset: 'Clearer',
    waterRefraction: true,
    waterQuality: 'high',
    waterPixelScale: 1,
    causticFps: CAUSTIC_FPS_DEFAULT,
    causticScroll: CAUSTIC_SCROLL_DEFAULT,
    showLightBands: LIGHT_BANDS_DEFAULT,
    waterTint: waterColors.tint,
    waterDeep: waterColors.deep,
    waterFog: waterColors.fog,
    stadiumDetail: 'high',
    crowdDensity: 'high',
    arenaRadius: ARENA_RADIUS,
    teammatePassDelay: PRACTICE.passDelay,
    showSunbeams: true,
    sunbeamIntensity: 0.7,
    goalieReach: GOALIE.reach,
    goalieReaction: GOALIE.reaction,
    goalieCatchDifficulty: GOALIE.catchDifficulty,
    timeScale: TIME_SCALE_DEFAULT,
    timeScaleFlightOnly: false,
    goalieSkill: 70,
    goalieSkillHome: 70,
    goalieSkillAway: 70,
    goalieHomeOverride: false,
    goalieAwayOverride: false,
    ...defaultCameraFields(),
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
  private waterTintInput: HTMLInputElement | null = null;
  private waterDeepInput: HTMLInputElement | null = null;
  private waterFogInput: HTMLInputElement | null = null;
  private matchPreset: MatchPresetId = 'custom';
  private withGoalies = true;
  private character: CharacterMenu | null = null;
  private characterSettings: CharacterSettings = defaultCharacterSettings();
  private indicators: IndicatorSettings = loadIndicatorSettings();
  private onIndicators: ((settings: IndicatorSettings) => void) | null = null;
  private onTogglePause: (() => void) | null = null;
  private onStepFrame: (() => void) | null = null;
  private pauseButton: HTMLButtonElement | null = null;
  visible = true;

  constructor(
    root: HTMLElement,
    tunables: Tunables,
    onChange: (key: keyof Tunables) => void,
    roster: RosterControl,
    character?: CharacterMenu,
    onIndicators?: (settings: IndicatorSettings) => void,
    playback?: { togglePause: () => void; step: () => void },
  ) {
    this.root = root;
    this.tunables = tunables;
    this.onChange = onChange;
    this.roster = roster;
    this.character = character ?? null;
    this.characterSettings = loadCharacterSettings();
    this.onIndicators = onIndicators ?? null;
    this.onTogglePause = playback?.togglePause ?? null;
    this.onStepFrame = playback?.step ?? null;
    this.indicators = loadIndicatorSettings();
    this.mount = root;
    const saved = loadPowerMode();
    if (saved) this.tunables.powerMode = saved;
    const savedOffset = loadCurveAimOffset();
    if (savedOffset !== null) this.tunables.curveAimOffset = savedOffset;
    const savedScale = loadTimeScale();
    if (savedScale !== null) this.tunables.timeScale = savedScale;
    this.tunables.timeScaleFlightOnly = loadFlightOnly();
    this.tunables.showHelp = loadShowHelp();
    this.tunables.zoomHoldMode = loadZoomHoldMode();
    const savedRoster = loadRoster();
    if (savedRoster) {
      this.matchPreset = savedRoster.preset ?? 'custom';
      this.withGoalies = savedRoster.withGoalies ?? true;
      if (savedRoster.goalieSkill !== undefined) this.tunables.goalieSkill = savedRoster.goalieSkill;
      if (savedRoster.goalieSkillHome !== undefined) this.tunables.goalieSkillHome = savedRoster.goalieSkillHome;
      if (savedRoster.goalieSkillAway !== undefined) this.tunables.goalieSkillAway = savedRoster.goalieSkillAway;
      this.tunables.goalieHomeOverride = savedRoster.goalieHomeOverride === true;
      this.tunables.goalieAwayOverride = savedRoster.goalieAwayOverride === true;
      this.roster.applyRoster(savedRoster);
    }
    const savedCamera = loadCameraSettings();
    if (savedCamera) applyCameraSave(this.tunables, savedCamera);
    this.collapsed = loadCollapsed();
    this.render();
  }

  resetTimeScale(): void {
    this.tunables.timeScale = TIME_SCALE_DEFAULT;
    saveTimeScale(TIME_SCALE_DEFAULT);
    const input = this.root.querySelector<HTMLInputElement>('input[data-time-scale]');
    const value = input?.parentElement?.querySelector('.value');
    if (input) input.value = String(TIME_SCALE_DEFAULT);
    if (value) value.textContent = `${TIME_SCALE_DEFAULT.toFixed(2)}x`;
  }

  setShowHelp(shown: boolean): void {
    this.tunables.showHelp = shown;
    saveShowHelp(shown);
    const box = this.root.querySelector<HTMLInputElement>('input[data-key="showHelp"]');
    if (box) box.checked = shown;
    this.onChange('showHelp');
  }

  setPaused(paused: boolean): void {
    if (this.pauseButton) this.pauseButton.textContent = paused ? 'Resume' : 'Pause';
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.style.display = v ? 'block' : 'none';
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  private renderCharacter(): void {
    const menu = this.character;
    if (!menu) return;
    this.section('Character', 'character', () => {
      const outfits = menu.outfits;
      const pick = (label: string, current: string, apply: (id: string) => void) => {
        const row = document.createElement('div');
        row.className = 'row';
        const lab = document.createElement('label');
        lab.style.flex = '1';
        lab.textContent = label;
        const input = document.createElement('select');
        for (const outfit of outfits) {
          const item = document.createElement('option');
          item.value = outfit.id;
          item.textContent = outfit.label;
          input.append(item);
        }
        input.value = current;
        input.addEventListener('change', () => apply(input.value));
        row.append(lab, input);
        this.mount.append(row);
      };
      pick('You', this.characterSettings.human, (id) => {
        if (!outfits.some((outfit) => outfit.id === id)) return;
        this.characterSettings = { ...this.characterSettings, human: id as CharacterSettings['human'] };
        saveCharacterSettings(this.characterSettings);
        menu.onChange(this.characterSettings);
      });
      pick('Blue team', this.characterSettings.team[0], (id) => {
        if (!outfits.some((outfit) => outfit.id === id)) return;
        this.characterSettings = {
          ...this.characterSettings,
          team: [id as CharacterSettings['human'], this.characterSettings.team[1]],
        };
        saveCharacterSettings(this.characterSettings);
        menu.onChange(this.characterSettings);
      });
      pick('Orange team', this.characterSettings.team[1], (id) => {
        if (!outfits.some((outfit) => outfit.id === id)) return;
        this.characterSettings = {
          ...this.characterSettings,
          team: [this.characterSettings.team[0], id as CharacterSettings['human']],
        };
        saveCharacterSettings(this.characterSettings);
        menu.onChange(this.characterSettings);
      });
    });
  }

  private renderIndicators(): void {
    this.section('HUD / Indicators', 'indicators', () => {
      const toggle = (label: string, key: keyof IndicatorSettings) => {
        const row = document.createElement('div');
        row.className = 'row';
        const lab = document.createElement('label');
        lab.style.flex = '1';
        lab.textContent = label;
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.indicator = key;
        input.checked = this.indicators[key];
        input.addEventListener('change', () => {
          this.indicators = { ...this.indicators, [key]: input.checked };
          this.commitIndicators();
        });
        row.append(lab, input);
        this.mount.append(row);
      };
      toggle('Player rings', 'rings');
      toggle('Ball bubble', 'ballBubble');
      toggle('Y prompt', 'prompt');
      toggle('Goal target', 'goalTarget');
      toggle('Beacons and marks', 'beacons');
      toggle('Bold gizmos', 'bold');

      const row = document.createElement('div');
      row.className = 'row';
      const clean = document.createElement('button');
      clean.type = 'button';
      clean.textContent = 'Clean';
      clean.title = 'Hide the rings, bubble, prompt, and beacons. Keep a faint goal target.';
      clean.addEventListener('click', () => {
        this.indicators = cleanIndicatorSettings();
        this.syncIndicatorWidgets();
        this.commitIndicators();
      });
      const debug = document.createElement('button');
      debug.type = 'button';
      debug.textContent = 'Debug';
      debug.title = 'Show every marker at full strength.';
      debug.addEventListener('click', () => {
        this.indicators = debugIndicatorSettings();
        this.syncIndicatorWidgets();
        this.commitIndicators();
      });
      row.append(clean, debug);
      this.mount.append(row);
    });
  }

  private commitIndicators(): void {
    saveIndicatorSettings(this.indicators);
    this.onIndicators?.(this.indicators);
  }

  private syncIndicatorWidgets(): void {
    for (const input of this.root.querySelectorAll<HTMLInputElement>('input[data-indicator]')) {
      const key = input.dataset.indicator as keyof IndicatorSettings | undefined;
      if (!key) continue;
      input.checked = this.indicators[key];
    }
  }

  private render(): void {
    this.root.innerHTML = '';
    this.mount = this.root;
    const h = document.createElement('h2');
    h.textContent = 'Dev toggles';
    this.root.appendChild(h);
    this.renderRosterCard();
    this.renderCharacter();
    this.renderIndicators();

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
      this.range('Curve aim offset', 'curveAimOffset', 0, 1.25, 0.05);
      this.range('Arc height', 'arcHeight', 0, 0.8, 0.01);
      this.range('Arc hand curve', 'arcHandCurve', 0, 0.6, 0.01);
      this.range('Shot carry', 'shotCarry', 0, 60, 0.5);
      this.range('Teammate lock radius', 'teammateLockRadius', 0.3, 3, 0.05);
      this.range('Aim assist', 'aimAssist', 0, 1, 0.05);
      this.range('Aim posture blend time', 'aimPostureBlend', 0.05, 0.8, 0.01);
      this.range('Kick range', 'kickRange', 1, 1.8, 0.01);
      this.range('Kick speed', 'kickSpeed', 1, 1.8, 0.01);
      this.range('Kick curve', 'kickCurve', 0, 1, 0.01);
      this.range('Kick windup', 'kickWindup', 0, 0.45, 0.01);
      this.range('Kick power', 'kickPower', 6, 40, 0.5);
      this.range('Sweet-spot width', 'kickSweet', 0.04, 0.4, 0.01);
      this.range('Kick reach', 'kickReach', 0.25, 1.3, 0.01);
      this.range('Volley cone', 'volleyCone', 0.15, 1.2, 0.01);
      this.range('Volley spread', 'volleySpread', 0, 0.9, 0.01);
      this.range('Throw speed scale', 'throwSpeedScale', 0.5, 1.2, 0.01);
    });

    this.section('Movement', 'movement', () => {
      this.range('Acceleration', 'playerAccel', 30, 170, 1);
      this.range('Cruise speed', 'playerMaxSpeed', 8, 40, 0.5);
      this.range('Sprint mult', 'sprintMult', 1, 2, 0.01);
      this.range('Strafe speed', 'strafeSpeedMult', 0.25, 1, 0.01);
      this.range('Turn speed', 'bodyTurnRate', 1, 8, 0.1);
      this.range('Turn smoothing', 'turnSmooth', 0.04, 0.55, 0.01);
      this.range('Idle face speed', 'bodyIdleSpeed', 0.4, 12, 0.1);
      this.bool('Paddle anim', 'swimAnim');
      this.range('Paddle rate', 'swimAnimRate', 0.2, 4, 0.1);
      this.range('Paddle amount', 'swimAnimAmount', 0, 1.4, 0.05);
      this.range('Blend stiffness', 'blendStiffness', 2, 22, 0.5);
      this.range('Bank amount', 'bankAmount', 0, 0.9, 0.01);
    });

    this.section('Tackle / Checking', 'tackle', () => {
      this.range('Light speed', 'lightBurstSpeed', 8, 40, 0.5);
      this.range('Light window', 'lightBurstDuration', 0.05, 0.35, 0.01);
      this.range('Light cooldown', 'lightBurstCooldown', 0.1, 1.2, 0.01);
      this.range('Light knock', 'lightKnock', 4, 30, 0.5);
      this.range('Tap time', 'tackleTapTime', 0.05, 0.35, 0.01);
      this.range('Charge time', 'tackleChargeTime', 0.2, 1.2, 0.01);
      this.range('Power speed', 'burstSpeed', 16, 60, 0.5);
      this.range('Power window', 'burstDuration', 0.08, 0.55, 0.01);
      this.range('Power cooldown', 'burstCooldown', 0.3, 2, 0.01);
      this.range('Power knock', 'checkKnock', 8, 40, 0.5);
      this.range('Pop chance min', 'tacklePopMin', 0, 1, 0.01);
      this.range('Pop chance full', 'tacklePopMax', 0, 1, 0.01);
      this.range('Self stagger', 'tackleSelfStagger', 0, 0.8, 0.01);
    });

    this.section('Camera', 'camera', () => {
      this.cameraPresetRow();
      this.camRange('Follow distance', 'camDistance', 2, 24, 0.1);
      this.camRange('Height', 'camHeight', 0, 10, 0.05);
      this.camRange('Pitch offset', 'camPitch', -0.45, 0.45, 0.01);
      this.camRange('Shoulder offset', 'shoulderOffset', 0, 4, 0.05);
      this.camRange('Shoulder ease', 'shoulderTransition', 1, 18, 0.1);
      this.camRange('FOV', 'camFov', 35, 100, 1);
      this.camRange('Camera lag', 'camLag', 1, 24, 0.5);
      this.camChoice('Look ahead', 'lookAhead', [
        { value: 'aim', label: 'Aim' },
        { value: 'move', label: 'Movement' },
        { value: 'ball', label: 'Ball' },
      ]);
      this.camBool('Auto-recenter', 'camRecenter');
      this.camRange('Recenter delay', 'camRecenterDelay', 0, 2.5, 0.05);
      this.camBool('Ball cam', 'ballCam');
      this.camRange('Wide distance', 'wideDistance', 12, 70, 0.5);
      this.camBool('Shell collision', 'camShell');
      this.bool('Goal-axis up', 'goalAxisUp');
      this.bool('Zoom hold (V / LB)', 'zoomHoldMode');
      this.bool('Invert look X', 'mouseLookInvertX');
      this.bool('Invert look Y', 'mouseLookInvertY');
    });

    this.section('Water', 'water', () => {
      this.select('Water style', 'waterStyle', [
        { value: 'trailbound', label: 'Trailbound v2' },
        { value: 'classic', label: 'Classic' },
      ], () => this.onChange('waterStyle'));
      this.select('Water preset', 'waterPreset', [
        { value: 'Mockup', label: 'Mockup' },
        { value: 'Clearer', label: 'Clearer' },
        { value: 'Deeper', label: 'Deeper' },
      ], () => this.applyWaterPresetColors());
      this.select('Water quality', 'waterQuality', [
        { value: 'high', label: 'High' },
        { value: 'low', label: 'Low' },
        { value: 'basic', label: 'Basic' },
      ], () => this.onChange('waterQuality'));
      this.bool('Water refraction', 'waterRefraction');
      this.range('Pixel scale', 'waterPixelScale', 1, 3, 1);
      this.range('Caustic speed', 'causticFps', CAUSTIC_FPS_MIN, CAUSTIC_FPS_MAX, 0.05);
      this.range('Scroll speed', 'causticScroll', CAUSTIC_SCROLL_MIN, CAUSTIC_SCROLL_MAX, 0.005);
      this.bool('Light bands', 'showLightBands');
      this.waterColor('Water tint', 'waterTint');
      this.waterColor('Deep color', 'waterDeep');
      this.waterColor('Fog color', 'waterFog');
      this.waterReset();
    });

    this.section('Arena', 'arena', () => {
      this.select('Stadium detail', 'stadiumDetail', [
        { value: 'off', label: 'Off' },
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' },
      ], () => this.onChange('stadiumDetail'));
      this.select('Crowd density', 'crowdDensity', [
        { value: 'off', label: 'Off' },
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' },
      ], () => this.onChange('crowdDensity'));
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
      this.range('Catch radius', 'catchReadyRadius', 2, 12, 0.1);
      this.range('Catch cone', 'catchReadyCone', 0.2, 1.3, 0.01);
      this.range('Fumble speed', 'fumbleSpeed', 16, 90, 1);
      this.range('Deflect strength', 'deflectStrength', 6, 70, 1);
      this.range('Hold lag', 'holdLag', 2, 20, 0.1);
      this.range('Pass speed', 'passSpeed', 12, 80, 1);
      this.range('Ball drag', 'ballDrag', 0.2, 3, 0.05);
    });

    this.section('Teams', 'teams', () => {
      this.bool('Normal defense chases', 'defenseActive');
      this.range('Teammate pass delay', 'teammatePassDelay', 0.3, 3, 0.05);
      this.range('Goalie reach', 'goalieReach', 0.7, 2.2, 0.05);
      this.range('Goalie reaction time', 'goalieReaction', 0.04, 0.55, 0.01);
      this.range('Catch difficulty', 'goalieCatchDifficulty', 0, 1, 0.01);
      this.range('Goalie skill', 'goalieSkill', 0, 100, 1);
      this.bool('Home skill override', 'goalieHomeOverride');
      this.range('Home goalie skill', 'goalieSkillHome', 0, 100, 1);
      this.bool('Away skill override', 'goalieAwayOverride');
      this.range('Away goalie skill', 'goalieSkillAway', 0, 100, 1);
      this.range('Blue field AI', 'fieldSkillA', 0, 100, 1);
      this.range('Orange field AI', 'fieldSkillB', 0, 100, 1);
    });

    this.section('Playback', 'playback', () => {
      this.range('Time scale', 'timeScale', 0.05, 2, 0.05);
      this.bool('Only while ball in flight', 'timeScaleFlightOnly');
      const row = document.createElement('div');
      row.className = 'row';
      const pause = document.createElement('button');
      pause.type = 'button';
      pause.textContent = 'Pause';
      pause.addEventListener('click', () => this.onTogglePause?.());
      const step = document.createElement('button');
      step.type = 'button';
      step.textContent = 'Step frame';
      step.addEventListener('click', () => this.onStepFrame?.());
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.textContent = 'Reset to 1x';
      reset.addEventListener('click', () => this.resetTimeScale());
      row.append(pause, step, reset);
      this.mount.append(row);
      this.pauseButton = pause;
    });

    this.section('Visual / Debug', 'visual', () => {
      this.bool('Charge ghost', 'showChargeGhost');
      this.bool('Debug stats', 'showDebugStats');
      this.bool('Show AI intent', 'showAiIntent');
      this.bool('Show help', 'showHelp');
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
      'Field bots play the match. Goalies guard their own goal. Test chasers just hold the ball. Add, remove, or change a role and the match becomes Custom.';
    card.appendChild(note);
    this.root.appendChild(card);
    this.refreshRoster();
  }

  private persistRoster(): void {
    const spec = this.roster.exportRoster();
    saveRoster({
      ...spec,
      preset: this.matchPreset,
      withGoalies: this.withGoalies,
      goalieSkill: this.tunables.goalieSkill,
      goalieSkillHome: this.tunables.goalieSkillHome,
      goalieSkillAway: this.tunables.goalieSkillAway,
      goalieHomeOverride: this.tunables.goalieHomeOverride,
      goalieAwayOverride: this.tunables.goalieAwayOverride,
    });
  }

  private applyMatch(preset: Exclude<MatchPresetId, 'custom'>): void {
    if (presetAllowsGoalieToggle(preset)) this.withGoalies = true;
    const spec = matchRoster(preset, this.withGoalies);
    this.matchPreset = preset;
    this.withGoalies = spec.withGoalies === true;
    this.tunables.defenseActive = true;
    const chase = this.root.querySelector<HTMLInputElement>('input[data-key="defenseActive"]');
    if (chase) chase.checked = true;
    this.roster.applyRoster(spec);
    this.persistRoster();
    this.refreshRoster();
  }

  private refreshRoster(): void {
    const body = this.rosterBody;
    if (!body) return;
    body.innerHTML = '';
    this.rosterPresetRow(body);
    const bots = this.roster.listBots();
    this.teamBlock(body, 0, 'Home (Blue)', bots);
    this.teamBlock(body, 1, 'Away (Orange)', bots);
  }

  private rosterPresetRow(body: HTMLElement): void {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.textContent = 'Match';
    lab.style.flex = '1';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Match preset');
    const options: { value: MatchPresetId; label: string }[] = [
      { value: '1v1', label: '1v1' },
      { value: '1v1-goalies', label: '1v1 + goalies' },
      { value: '3v3', label: '3v3' },
      { value: '4v4', label: '4v4' },
      { value: '5v5', label: '5v5' },
      { value: 'custom', label: 'Custom' },
    ];
    for (const option of options) {
      const item = document.createElement('option');
      item.value = option.value;
      item.textContent = option.label;
      select.append(item);
    }
    select.value = this.matchPreset;
    select.addEventListener('change', () => {
      const value = select.value as MatchPresetId;
      if (value === 'custom') {
        this.matchPreset = 'custom';
        this.persistRoster();
        this.refreshRoster();
        return;
      }
      this.applyMatch(value);
    });
    row.append(lab, select);
    body.append(row);
    if (!presetAllowsGoalieToggle(this.matchPreset)) return;
    const toggle = document.createElement('div');
    toggle.className = 'row';
    const name = document.createElement('label');
    name.textContent = 'With goalies';
    name.style.flex = '1';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.withGoalies;
    input.addEventListener('change', () => {
      const preset = this.matchPreset;
      if (preset !== '3v3' && preset !== '4v4' && preset !== '5v5') return;
      this.withGoalies = input.checked;
      const spec = matchRoster(preset, this.withGoalies);
      this.withGoalies = spec.withGoalies === true;
      this.roster.applyRoster(spec);
      this.persistRoster();
      this.refreshRoster();
    });
    toggle.append(name, input);
    body.append(toggle);
  }

  private markRosterCustom(): void {
    this.matchPreset = 'custom';
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
        { value: 'normal', label: 'Field' },
        { value: 'goalie', label: 'Goalie' },
        { value: 'chaser', label: 'Test chaser' },
      ]) {
        const item = document.createElement('option');
        item.value = option.value;
        item.textContent = option.label;
        select.append(item);
      }
      select.value = bot.behavior;
      select.addEventListener('change', () => {
        const value: BotBehavior =
          select.value === 'chaser' ? 'chaser' : select.value === 'goalie' ? 'goalie' : 'normal';
        this.roster.setBotBehavior(bot.id, value);
        this.markRosterCustom();
        this.persistRoster();
        this.refreshRoster();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = 'Remove';
      remove.title = 'Despawn this bot. A held ball drops loose.';
      remove.addEventListener('click', () => {
        this.roster.removeBot(bot.id);
        this.markRosterCustom();
        this.persistRoster();
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
      this.markRosterCustom();
      this.persistRoster();
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

  private cameraPresetRow(): void {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.textContent = 'Preset';
    lab.style.flex = '1';
    const select = document.createElement('select');
    select.dataset.preset = 'camera';
    const options: { value: CameraPresetId; label: string }[] = [
      { value: 'close', label: 'Close' },
      { value: 'default', label: 'Default' },
      { value: 'broadcast', label: 'Broadcast' },
      { value: 'ball', label: 'Ball cam' },
      { value: 'cinematic', label: 'Cinematic' },
      { value: 'custom', label: 'Custom' },
    ];
    for (const option of options) {
      const item = document.createElement('option');
      item.value = option.value;
      item.textContent = option.label;
      select.append(item);
    }
    select.value = this.tunables.cameraPreset;
    select.addEventListener('change', () => {
      const value = select.value as CameraPresetId;
      if (value === 'custom') {
        noteCameraEdit(this.tunables);
        saveCameraSettings(this.tunables);
        return;
      }
      applyCameraPreset(this.tunables, value);
      this.syncCameraWidgets();
      saveCameraSettings(this.tunables);
    });
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Reset';
    reset.title = 'Restore the Default camera preset';
    reset.addEventListener('click', () => {
      applyCameraPreset(this.tunables, 'default');
      this.syncCameraWidgets();
      saveCameraSettings(this.tunables);
    });
    row.append(lab, select, reset);
    this.mount.append(row);
  }

  private markCameraCustom(): void {
    if (this.tunables.cameraPreset === 'custom') return;
    noteCameraEdit(this.tunables);
    const select = this.root.querySelector<HTMLSelectElement>('select[data-preset="camera"]');
    if (select) select.value = 'custom';
  }

  private syncCameraWidgets(): void {
    const select = this.root.querySelector<HTMLSelectElement>('select[data-preset="camera"]');
    if (select) select.value = this.tunables.cameraPreset;
    for (const input of this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-cam]')) {
      const key = input.dataset.cam;
      if (!key) continue;
      const value = (this.tunables as unknown as Record<string, unknown>)[key];
      if (input instanceof HTMLInputElement && input.type === 'checkbox') {
        input.checked = Boolean(value);
      } else {
        input.value = String(value);
      }
      const readout = input.parentElement?.querySelector('.value');
      if (readout && typeof value === 'number') readout.textContent = value.toFixed(2);
    }
  }

  private camRange(label: string, key: keyof Tunables, min: number, max: number, step: number): void {
    const wrap = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.dataset.cam = key;
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
      this.markCameraCustom();
      saveCameraSettings(this.tunables);
    });
    wrap.append(name, input, value);
    this.mount.append(wrap);
  }

  private camBool(label: string, key: keyof Tunables): void {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.style.flex = '1';
    lab.textContent = label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.cam = key;
    input.checked = Boolean(this.tunables[key]);
    input.addEventListener('change', () => {
      (this.tunables as unknown as Record<string, unknown>)[key] = input.checked;
      this.markCameraCustom();
      saveCameraSettings(this.tunables);
    });
    row.append(lab, input);
    this.mount.append(row);
  }

  private camChoice(label: string, key: 'lookAhead', options: { value: string; label: string }[]): void {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.style.flex = '1';
    lab.textContent = label;
    const input = document.createElement('select');
    input.dataset.cam = key;
    for (const option of options) {
      const item = document.createElement('option');
      item.value = option.value;
      item.textContent = option.label;
      input.append(item);
    }
    input.value = this.tunables.lookAhead;
    input.addEventListener('change', () => {
      if (!isLookAhead(input.value)) return;
      this.tunables.lookAhead = input.value;
      this.markCameraCustom();
      saveCameraSettings(this.tunables);
    });
    row.append(lab, input);
    this.mount.append(row);
  }

  private bool(label: string, key: keyof Tunables): void {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.style.flex = '1';
    lab.textContent = label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.key = key;
    input.checked = Boolean(this.tunables[key]);
    input.addEventListener('change', () => {
      (this.tunables as unknown as Record<string, unknown>)[key] = input.checked;
      // Only the up-axis change rebuilds the chase basis. Invert toggles and
      // other checkboxes must not snap yaw/pitch back to kickoff.
      if (key === 'goalAxisUp' || key === 'waterRefraction' || key === 'showLightBands') this.onChange(key);
      if (key === 'goalieHomeOverride' || key === 'goalieAwayOverride') this.persistRoster();
      if (key === 'timeScaleFlightOnly') saveFlightOnly(input.checked);
      if (key === 'showHelp') {
        saveShowHelp(input.checked);
        this.onChange(key);
      }
      if (key === 'zoomHoldMode') saveZoomHoldMode(input.checked);
    });
    row.append(lab, input);
    this.mount.append(row);
  }

  private select<K extends keyof Tunables>(
    label: string,
    key: K,
    options: { value: Tunables[K]; label: string }[],
    onPick: () => void,
  ): void {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.style.flex = '1';
    lab.textContent = label;
    const input = document.createElement('select');
    for (const option of options) {
      const item = document.createElement('option');
      item.value = String(option.value);
      item.textContent = option.label;
      input.append(item);
    }
    input.value = String(this.tunables[key]);
    input.addEventListener('change', () => {
      const value = input.value as Tunables[K];
      if (!options.some((option) => option.value === value)) return;
      this.tunables[key] = value;
      onPick();
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
    if (key === 'timeScale') input.dataset.timeScale = '1';
    const value = document.createElement('span');
    value.className = 'value';
    value.textContent =
      key === 'timeScale' ? `${Number(this.tunables[key]).toFixed(2)}x` : Number(this.tunables[key]).toFixed(2);
    input.addEventListener('input', () => {
      const n = parseFloat(input.value);
      (this.tunables as unknown as Record<string, unknown>)[key] = n;
      value.textContent = n.toFixed(2);
      if (key === 'arenaRadius' || key === 'waterPixelScale' || key === 'causticFps' || key === 'causticScroll') this.onChange(key);
      if (key === 'curveAimOffset') saveCurveAimOffset(n);
      if (key === 'timeScale') {
        const clamped = clampTimeScale(n);
        this.tunables.timeScale = clamped;
        input.value = String(clamped);
        value.textContent = `${clamped.toFixed(2)}x`;
        saveTimeScale(clamped);
      }
      if (key === 'goalieSkill' || key === 'goalieSkillHome' || key === 'goalieSkillAway') this.persistRoster();
    });
    wrap.append(name, input, value);
    this.mount.append(wrap);
  }

  private waterColors(): WaterColors {
    return {
      tint: this.tunables.waterTint,
      deep: this.tunables.waterDeep,
      fog: this.tunables.waterFog,
    };
  }

  private syncWaterColorInputs(): void {
    if (this.waterTintInput) this.waterTintInput.value = this.tunables.waterTint;
    if (this.waterDeepInput) this.waterDeepInput.value = this.tunables.waterDeep;
    if (this.waterFogInput) this.waterFogInput.value = this.tunables.waterFog;
  }

  private applyWaterPresetColors(): void {
    const colors = colorsForPreset(this.tunables.waterPreset);
    this.tunables.waterTint = colors.tint;
    this.tunables.waterDeep = colors.deep;
    this.tunables.waterFog = colors.fog;
    this.syncWaterColorInputs();
    saveWaterColors(colors);
    this.onChange('waterPreset');
  }

  private waterColor(label: string, key: 'waterTint' | 'waterDeep' | 'waterFog'): void {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.style.flex = '1';
    lab.textContent = label;
    const input = document.createElement('input');
    input.type = 'color';
    input.dataset.key = key;
    input.value = this.tunables[key];
    input.addEventListener('input', () => {
      this.tunables[key] = input.value;
      saveWaterColors(this.waterColors());
      this.onChange(key);
    });
    if (key === 'waterTint') this.waterTintInput = input;
    if (key === 'waterDeep') this.waterDeepInput = input;
    if (key === 'waterFog') this.waterFogInput = input;
    row.append(lab, input);
    this.mount.append(row);
  }

  private waterReset(): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'add-bot';
    button.textContent = 'Reset water colors';
    button.addEventListener('click', () => {
      const colors = colorsForPreset('Clearer');
      this.tunables.waterTint = colors.tint;
      this.tunables.waterDeep = colors.deep;
      this.tunables.waterFog = colors.fog;
      this.syncWaterColorInputs();
      saveWaterColors(colors);
      this.onChange('waterTint');
    });
    this.mount.append(button);
  }
}
