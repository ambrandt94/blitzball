import { FIXED_DT } from './constants';
import { InputManager } from '../input/InputManager';
import { SceneView } from '../render/SceneView';
import { Simulation } from '../sim/Simulation';
import { BLITZBALL_OUTFITS } from '../characters/blitzball';
import { loadCharacterSettings, saveCharacterSettings } from '../ui/characterSettings';
import { DevPanel, defaultTunables } from '../ui/DevPanel';
import type { InputIntent } from './types';

/** Keep one-frame button edges until a physics step actually consumes them. */
function orEdges(pending: InputIntent, fresh: InputIntent): InputIntent {
  return {
    ...fresh,
    claim: pending.claim || fresh.claim,
    drop: pending.drop || fresh.drop,
    pass: pending.pass || fresh.pass,
    shoot: pending.shoot || fresh.shoot,
    kick: pending.kick || fresh.kick,
    burstPower: pending.burstPower || fresh.burstPower,
    aimCancel: pending.aimCancel || fresh.aimCancel,
    burst: pending.burst || fresh.burst,
    resetBall: pending.resetBall || fresh.resetBall,
    callForPass: pending.callForPass || fresh.callForPass,
  };
}

function withoutEdges(intent: InputIntent): InputIntent {
  return {
    ...intent,
    move: intent.move.clone(),
    lookDelta: { x: 0, y: 0 },
    claim: false,
    drop: false,
    pass: false,
    shoot: false,
    kick: false,
    burstPower: false,
    aimCancel: false,
    burst: false,
    resetBall: false,
    zoomTogglePressed: false,
    middleZoomPressed: false,
    toggleDev: false,
    aimRangeDelta: 0,
    callForPass: false,
  };
}

export class Game {
  private sim: Simulation;
  private view: SceneView;
  private input: InputManager;
  private dev: DevPanel;
  private canvas: HTMLCanvasElement;
  private accum = 0;
  private last = 0;
  private running = false;
  private lastZoom = false;
  private pendingEdge: InputIntent | null = null;
  private tunables = defaultTunables();

  private scoreA: HTMLElement;
  private scoreB: HTMLElement;
  private status: HTMLElement;
  private possessionEl: HTMLElement;
  private debugStats: HTMLElement;
  private chargeEl: HTMLElement;
  private chargeFill: HTMLElement;
  private chargeLabel: HTMLElement;
  private chargePips: HTMLElement;
  private tackleEl: HTMLElement;
  private tackleFill: HTMLElement;
  private goalBanner: HTMLElement | null;
  private lastThrowFeedback = 0;
  private audioCtx: AudioContext | null = null;
  private shotMode: 'wide' | 'inside' | 'ball' | 'windup' | 'bank' | 'play' | null = null;

  constructor(app: HTMLElement) {
    this.canvas = document.createElement('canvas');
    app.insertBefore(this.canvas, app.firstChild);

    this.view = new SceneView(this.canvas);
    this.input = new InputManager(this.canvas);
    this.sim = new Simulation(this.tunables);
    this.dev = new DevPanel(
      document.getElementById('dev-panel')!,
      this.tunables,
      (key) => {
        if (key === 'goalAxisUp') this.sim.orientAfterUpToggle();
        if (key === 'arenaRadius') {
          this.sim.resizeArena(this.tunables.arenaRadius);
          this.view.rebuildArena();
        }
        if (
          key === 'waterStyle' ||
          key === 'waterPreset' ||
          key === 'waterRefraction' ||
          key === 'waterQuality' ||
          key === 'waterPixelScale' ||
          key === 'causticFps' ||
          key === 'showLightBands' ||
          key === 'waterTint' ||
          key === 'waterDeep' ||
          key === 'waterFog' ||
          key === 'stadiumDetail' ||
          key === 'crowdDensity'
        ) {
          this.view.applyVisuals(this.visuals());
        }
      },
      {
        listBots: () => this.sim.listBots(),
        swimmerCount: (team) => this.sim.swimmerCount(team),
        maxSwimmers: () => this.sim.maxSwimmers(),
        addBot: (team, behavior) => this.sim.addBot(team, behavior),
        removeBot: (id) => this.sim.removeBot(id),
        setBotBehavior: (id, behavior) => this.sim.setBotBehavior(id, behavior),
        applyRoster: (spec) => this.sim.applyRoster(spec),
        exportRoster: () => this.sim.exportRoster(),
      },
      {
        outfits: BLITZBALL_OUTFITS.map((outfit) => ({ id: outfit.id, label: outfit.label })),
        onChange: (settings) => {
          saveCharacterSettings(settings);
          this.view.setCharacters(settings);
        },
      },
    );
    this.view.setCharacters(loadCharacterSettings());
    const shot = new URLSearchParams(location.search).get('shot');
    if (shot === 'wide' || shot === 'inside' || shot === 'ball' || shot === 'windup' || shot === 'bank' || shot === 'play') {
      this.shotMode = shot;
      this.tunables.showDebugStats = false;
      const hud = document.getElementById('hud');
      if (hud) hud.style.display = 'none';
      const dev = document.getElementById('dev-panel');
      if (dev) dev.style.display = 'none';
      if (shot === 'windup' || shot === 'bank') this.poseStill();
    }

    this.scoreA = document.getElementById('score-a')!;
    this.scoreB = document.getElementById('score-b')!;
    this.status = document.getElementById('status')!;
    this.possessionEl = document.getElementById('possession')!;
    this.debugStats = document.getElementById('debug-stats')!;
    this.chargeEl = document.getElementById('charge')!;
    this.chargeFill = document.getElementById('charge-fill')!;
    this.chargeLabel = document.getElementById('charge-label')!;
    this.chargePips = document.getElementById('charge-pips')!;
    this.tackleEl = document.getElementById('tackle-meter')!;
    this.tackleFill = document.getElementById('tackle-fill')!;
    this.goalBanner = document.getElementById('goal-banner');

    this.view.applyVisuals(this.visuals());
    this.onResize();
    window.addEventListener('resize', this.onResize);
  }

  private visuals() {
    return {
      waterStyle: this.tunables.waterStyle,
      waterPreset: this.tunables.waterPreset,
      waterRefraction: this.tunables.waterRefraction,
      waterQuality: this.tunables.waterQuality,
      waterPixelScale: this.tunables.waterPixelScale,
      causticFps: this.tunables.causticFps,
      showLightBands: this.tunables.showLightBands,
      waterTint: this.tunables.waterTint,
      waterDeep: this.tunables.waterDeep,
      waterFog: this.tunables.waterFog,
      stadiumDetail: this.tunables.stadiumDetail,
      crowdDensity: this.tunables.crowdDensity,
    };
  }

  /** Park the human in frame for the windup and bank stills. Physics does not step. */
  private poseStill(): void {
    const human = this.sim.getHuman();
    human.position.set(0, 0, 0);
    human.velocity.set(0, 0, 0);
    human.facing.set(0, 0, 1);
    human.up.set(0, 1, 0);
    human.actionPose = this.shotMode === 'windup' ? 'hold' : 'none';
    human.actionPoseTime = 0.2;
    this.sim.kickoffLock = 0;
    this.sim.strafing = this.shotMode === 'windup';
    if (this.shotMode === 'windup') {
      human.hasBall = true;
      this.sim.ball.possession = 'held';
      this.sim.ball.ownerId = human.id;
      this.sim.ball.position.set(0, 0.2, 0.7);
      this.sim.charge.active = true;
      this.sim.charge.kind = 'shoot';
      this.sim.charge.amount = 0.85;
      this.sim.shotAim.active = true;
    } else {
      human.hasBall = false;
      human.velocity.set(16, 2, 5);
      this.sim.ball.possession = 'free';
      this.sim.ball.ownerId = null;
      this.sim.ball.position.set(0, -6, 18);
    }
    for (const p of this.sim.players) {
      if (p.id !== human.id) p.active = false;
    }
  }

  start(): void {
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * Math.min(devicePixelRatio, 2));
    this.canvas.height = Math.floor(h * Math.min(devicePixelRatio, 2));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.view.setSize(w, h);
  };

  private frame = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.accum += dt;

    if (this.shotMode) {
      this.view.sync(this.sim, false, dt);
      this.view.render();
      requestAnimationFrame(this.frame);
      return;
    }

    const fresh = this.input.sample(dt);
    if (fresh.toggleDev) this.dev.toggle();
    // Mouse look is a per-frame distance, not a per-tick rate. Arm the shot
    // first so this sample's drag bends the arc instead of yawing the camera.
    // Apply it even when this frame does not run a physics step, and never more than once.
    this.sim.armShotAim(fresh);
    this.sim.applyFrameLook(fresh);
    this.sim.nudgeAimDistance(fresh.aimRangeDelta);
    this.sim.noteZoomToggle(fresh);

    const intent = this.pendingEdge ? orEdges(this.pendingEdge, fresh) : fresh;

    let steps = 0;
    while (this.accum >= FIXED_DT && steps < 5) {
      this.sim.step(FIXED_DT, steps === 0 ? intent : withoutEdges(intent));
      this.accum -= FIXED_DT;
      steps++;
    }
    this.pendingEdge = steps > 0 ? null : intent;

    this.sim.updateAimPresentation(fresh, dt);
    this.lastZoom = this.sim.isZoomOut(fresh);
    this.view.sync(this.sim, this.lastZoom, dt);
    this.view.render();
    this.updateHud();

    requestAnimationFrame(this.frame);
  };

  private updateHud(): void {
    this.scoreA.textContent = String(this.sim.match.score[0]);
    this.scoreB.textContent = String(this.sim.match.score[1]);
    this.status.textContent = this.sim.match.statusMessage;
    this.goalBanner?.classList.toggle('show', this.sim.goalCelebrate > 0);

    const b = this.sim.ball;
    this.possessionEl.classList.remove('you', 'orange', 'free');
    if (b.possession === 'held' && b.ownerId !== null) {
      if (b.ownerId === this.sim.humanId) {
        this.possessionEl.textContent = 'You have the ball';
        this.possessionEl.classList.add('you');
      } else {
        const owner = this.sim.players[b.ownerId];
        if (owner?.team === 0 && owner.role === 'ai') {
          this.possessionEl.textContent = 'Teammate has the ball';
          this.possessionEl.classList.add('you');
        } else {
          const team = owner?.team === 1 ? 'Orange' : 'Blue';
          this.possessionEl.textContent = `${team} has the ball`;
          this.possessionEl.classList.add(owner?.team === 1 ? 'orange' : 'you');
        }
      }
    } else {
      this.possessionEl.textContent = 'Ball free — swim into it or hold RMB to reach';
      this.possessionEl.classList.add('free');
    }

    const readout = this.sim.throwReadout;
    if (readout.feedback !== this.lastThrowFeedback) {
      this.lastThrowFeedback = readout.feedback;
      this.flashCharge();
      this.playTap();
    }
    if (this.sim.charge.active) {
      this.chargeEl.classList.add('visible');
      const pct = Math.round(this.sim.charge.amount * 100);
      this.chargeFill.style.width = `${pct}%`;
      const shooting = this.sim.charge.kind === 'shoot' || this.sim.charge.kind === 'kick';
      const kicking = this.sim.charge.kind === 'kick';
      const dist =
        shooting && this.sim.landingMarker.visible ? Math.round(this.sim.landingMarker.distance) : 0;
      const tapMode = shooting && this.tunables.powerMode === 'tap';
      const mode = this.tunables.powerMode;
      this.syncPips(tapMode ? Math.max(1, readout.tapMax) : 0, readout.taps);
      if (tapMode) {
        this.chargeLabel.textContent = dist > 0 ? `${kicking ? 'Kick tap' : 'Tap'} ${readout.taps}/${readout.tapMax} · ${dist}u` : `${kicking ? 'Kick tap' : 'Tap'} ${readout.taps}/${readout.tapMax}`;
      } else if (shooting && mode === 'target') {
        this.chargeLabel.textContent = this.sim.landingMarker.outOfReach ? `Out of reach · ${dist}u` : `Target ${dist}u`;
      } else if (shooting && mode === 'pull') {
        this.chargeLabel.textContent = dist > 0 ? `Pull ${pct} · ${dist}u` : `Pull ${pct}`;
      } else if (shooting && dist > 0) {
        this.chargeLabel.textContent = `${kicking ? 'Kick' : 'Power'} ${pct} · ${dist}u`;
      } else {
        this.chargeLabel.textContent = kicking ? `Kick ${pct}` : shooting ? `Power ${pct}` : `Pass ${pct}`;
      }
      this.chargeEl.classList.toggle('shot', shooting);
    } else {
      this.chargeEl.classList.remove('visible');
      this.syncPips(0, 0);
    }

    const tackle = this.sim.tackleCharge;
    this.tackleEl.classList.toggle('visible', tackle.active);
    this.tackleEl.setAttribute('aria-hidden', tackle.active ? 'false' : 'true');
    if (tackle.active) this.tackleFill.style.width = `${Math.round(tackle.amount * 100)}%`;

    this.debugStats.style.display = this.tunables.showDebugStats ? 'block' : 'none';
    if (this.tunables.showDebugStats) {
      const h = this.sim.getHuman();
      const owner =
        b.ownerId === null ? 'free' : b.ownerId === this.sim.humanId ? 'you' : `p${b.ownerId}`;
      const ballDist = h.position.distanceTo(b.position);
      this.debugStats.textContent = [
        `spd ${h.velocity.length().toFixed(1)}`,
        `ball spd ${b.velocity.length().toFixed(1)} dist ${ballDist.toFixed(1)} (${owner})`,
        `up ${this.tunables.goalAxisUp ? 'goal-axis' : 'world-Y'}`,
        `zoom ${this.lastZoom ? 'out' : 'chase'} (${this.tunables.zoomHoldMode ? 'hold' : 'toggle'})`,
        this.sim.shotAim.active
          ? `arc ${b.position.distanceTo(this.sim.shotAim.target).toFixed(1)}u bend ${Math.hypot(this.sim.shotAim.bendRight, this.sim.shotAim.bendUp).toFixed(1)} ${this.tunables.powerMode}`
          : 'arc idle',
        `check ${h.burstCooldown > 0 ? h.burstCooldown.toFixed(2) + 's' : 'ready'}`,
        this.sim.catchBeacon.visible ? 'catch beacon on' : 'catch beacon off',
        `shoulder ${this.sim.shoulderLateral.toFixed(2)}`,
        this.sim.landingMarker.visible
          ? `landing ${this.sim.landingMarker.lockId !== null ? 'mate' : 'free'}`
          : 'landing off',
        this.sim.getHuman().catchReady ? 'catch ready' : this.sim.catchStance ? 'squared up' : 'catch off',
        this.rosterLine(),
        this.tunables.showAiIntent
          ? this.sim.aiIntents.map((mark) => `ai${mark.id} ${mark.kind}`).join(' ') || 'ai idle'
          : 'ai intent hidden',
      ].join('\n');
    }
  }

  private rosterLine(): string {
    const roster = this.sim.exportRoster();
    const chasers = [...roster.home, ...roster.away].filter((behavior) => behavior === 'chaser').length;
    const chase = chasers === 0 ? '' : chasers === 1 ? ' · 1 chaser' : ` · ${chasers} chasers`;
    const defense = this.tunables.defenseActive ? ' · defense chases' : '';
    return `roster home ${roster.home.length} · away ${roster.away.length}${chase}${defense}`;
  }

  private syncPips(count: number, filled: number): void {
    this.chargeEl.classList.toggle('taps', count > 0);
    while (this.chargePips.children.length < count) {
      this.chargePips.appendChild(document.createElement('i'));
    }
    while (this.chargePips.children.length > count) {
      this.chargePips.lastElementChild?.remove();
    }
    for (let i = 0; i < this.chargePips.children.length; i++) {
      this.chargePips.children[i]?.classList.toggle('on', i < filled);
    }
  }

  private flashCharge(): void {
    this.chargeEl.classList.add('flash');
    window.setTimeout(() => this.chargeEl.classList.remove('flash'), 90);
  }

  /** Short click so a power tap is audible as well as visible. */
  private playTap(): void {
    const Ctx = window.AudioContext;
    if (!Ctx) return;
    try {
      if (!this.audioCtx) this.audioCtx = new Ctx();
      const ctx = this.audioCtx;
      if (ctx.state === 'suspended') void ctx.resume();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(720, now);
      osc.frequency.exponentialRampToValueAtTime(1180, now + 0.045);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.08);
    } catch {
      // Autoplay policies and missing audio devices should not stop the throw.
    }
  }
}
