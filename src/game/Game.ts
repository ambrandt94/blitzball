import { FIXED_DT } from './constants';
import { InputManager } from '../input/InputManager';
import { SceneView } from '../render/SceneView';
import { Simulation } from '../sim/Simulation';
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
    resetBall: false,
    zoomTogglePressed: false,
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

  constructor(app: HTMLElement) {
    this.canvas = document.createElement('canvas');
    app.insertBefore(this.canvas, app.firstChild);

    this.view = new SceneView(this.canvas);
    this.input = new InputManager(this.canvas);
    this.sim = new Simulation(this.tunables);
    this.dev = new DevPanel(document.getElementById('dev-panel')!, this.tunables, () => {
      this.sim.orientAfterUpToggle();
    });

    this.scoreA = document.getElementById('score-a')!;
    this.scoreB = document.getElementById('score-b')!;
    this.status = document.getElementById('status')!;
    this.possessionEl = document.getElementById('possession')!;
    this.debugStats = document.getElementById('debug-stats')!;
    this.chargeEl = document.getElementById('charge')!;
    this.chargeFill = document.getElementById('charge-fill')!;
    this.chargeLabel = document.getElementById('charge-label')!;

    this.onResize();
    window.addEventListener('resize', this.onResize);
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

    if (this.sim.charge.active) {
      this.chargeEl.classList.add('visible');
      const pct = Math.round(this.sim.charge.amount * 100);
      this.chargeFill.style.width = `${pct}%`;
      const shooting = this.sim.charge.kind === 'shoot';
      this.chargeLabel.textContent = shooting ? `Power ${pct}` : `Pass ${pct}`;
      this.chargeEl.classList.toggle('shot', shooting);
    } else {
      this.chargeEl.classList.remove('visible');
    }

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
          ? `arc ${b.position.distanceTo(this.sim.shotAim.target).toFixed(1)}u bend ${Math.hypot(this.sim.shotAim.bendRight, this.sim.shotAim.bendUp).toFixed(1)}`
          : 'arc idle',
        `shoulder ${this.sim.shoulderLateral.toFixed(2)}`,
        this.sim.aimCursor.visible ? `cursor ${this.sim.aimCursor.kind}` : 'cursor off',
        this.sim.catchStance ? 'catch reach' : 'catch off',
        `mate + ${this.tunables.defenseActive ? 'defense chases' : 'defense holds'}`,
      ].join('\n');
    }
  }
}
