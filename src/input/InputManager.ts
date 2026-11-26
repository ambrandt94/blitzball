import * as THREE from 'three';
import { INPUT, PLAYER } from '../game/constants';
import type { InputIntent } from '../game/types';
import { PrimaryClickGate } from './primaryClickGate';

const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['Space'],
  down: ['ControlLeft', 'ControlRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  claim: ['KeyX'],
  drop: ['KeyZ'],
  tackle: ['KeyQ'],
  pass: ['KeyF'],
  kick: ['KeyC'],
  callForPass: ['KeyG'],
  zoom: ['KeyV'],
  reset: [] as string[],
  level: ['KeyR'],
  ballCam: ['KeyB'],
  toggleDev: ['Backquote'],
  pause: ['KeyP'],
  step: ['BracketRight'],
  help: ['KeyH'],
  fullscreen: ['F11'],
};

/**
 * Keys the page should swallow while the canvas is focused or pointer-locked.
 * Ctrl+W, Ctrl+T, and Ctrl+N are in this set, but a normal tab still ignores
 * preventDefault for those. Fullscreen keyboard lock is what actually catches them.
 */
export function browserKeyBlocked(code: string, ctrl: boolean): boolean {
  if (code === 'Space' || code === 'ControlLeft' || code === 'ControlRight') return true;
  return ctrl;
}

/**
 * A click is always a grab, on this frame. A second click inside the window
 * is also a dive. The first click does not wait to find out.
 */
export function classifyGrabClick(
  nowMs: number,
  lastMs: number,
  windowMs = PLAYER.grabDouble * 1000,
): { grab: true; dive: boolean } {
  return { grab: true, dive: lastMs >= 0 && nowMs - lastMs <= windowMs && nowMs - lastMs >= 0 };
}

function deadzone(v: number, dz = INPUT.stickDeadzone): number {
  if (Math.abs(v) < dz) return 0;
  const sign = Math.sign(v);
  return sign * ((Math.abs(v) - dz) / (1 - dz));
}

export class InputManager {
  private keys = new Set<string>();
  private justPressed = new Set<string>();
  private mouseDelta = { x: 0, y: 0 };
  private pointerLocked = false;
  private lmbDown = false;
  private lmbPressed = false;
  private rmbDown = false;
  /** Right mouse went down this frame. Cancels a held throw. */
  private rmbPressed = false;
  /** Middle mouse went down this frame. Consumed by sample. */
  private mmbPressed = false;
  private clickGate = new PrimaryClickGate();
  private wheel = 0;
  private playback = { pause: false, step: false, help: false };
  /** Set when pointerrawupdate already recorded this frame's motion. */
  private sawPointerDelta = false;
  private canvas: HTMLElement;
  private padButtons = { a: false, b: false, x: false, y: false, rb: false, rt: false, rs: false, l3: false };
  private lastGrabMs = -1;
  private lastPadGrabMs = -1;
  private grabEdge = false;
  private diveEdge = false;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    canvas.tabIndex = 0;
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    canvas.addEventListener('click', this.onClick);
    document.addEventListener('pointerlockchange', this.onPointerLock);
    // While a button is held, some Chrome builds report movementX/Y as 0 on
    // mousemove and put the real delta on coalesced pointerrawupdate events.
    document.addEventListener('pointerrawupdate', this.onPointerRaw, true);
    document.addEventListener('mousemove', this.onMouseMove, true);
    canvas.addEventListener('mousedown', this.onMouseDown, true);
    window.addEventListener('mouseup', this.onMouseUp, true);
    // Right-click is strafe/aim. Kill the browser menu on press and on the
    // contextmenu event, including when the pointer is not yet locked.
    canvas.addEventListener('contextmenu', this.onContextMenu, { capture: true });
    document.addEventListener('contextmenu', this.onContextMenu, { capture: true });
    // Middle click toggles the wide camera. Stop autoscroll and the auxclick
    // default (paste, scroll) on the canvas and while the pointer is locked.
    canvas.addEventListener('auxclick', this.onAuxClick, { capture: true });
    document.addEventListener('auxclick', this.onAuxClick, { capture: true });
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    // Ctrl+wheel zooms the browser. The listener has to be non-passive or
    // preventDefault is ignored. Window capture covers the locked pointer too.
    window.addEventListener('wheel', this.onCtrlWheel, { capture: true, passive: false });
    canvas.addEventListener('selectstart', this.blockSelect);
    canvas.addEventListener('dragstart', this.blockSelect);
    document.addEventListener('selectstart', this.onSelectStart, true);
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    const fullscreen = document.getElementById('fullscreen-btn');
    if (fullscreen instanceof HTMLButtonElement) {
      fullscreen.addEventListener('click', () => {
        void this.toggleFullscreen();
      });
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.removeEventListener('click', this.onClick);
    document.removeEventListener('pointerlockchange', this.onPointerLock);
    document.removeEventListener('pointerrawupdate', this.onPointerRaw, true);
    document.removeEventListener('mousemove', this.onMouseMove, true);
    this.canvas.removeEventListener('mousedown', this.onMouseDown, true);
    window.removeEventListener('mouseup', this.onMouseUp, true);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu, { capture: true });
    document.removeEventListener('contextmenu', this.onContextMenu, { capture: true });
    this.canvas.removeEventListener('auxclick', this.onAuxClick, { capture: true });
    document.removeEventListener('auxclick', this.onAuxClick, { capture: true });
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('wheel', this.onCtrlWheel, { capture: true });
    this.canvas.removeEventListener('selectstart', this.blockSelect);
    this.canvas.removeEventListener('dragstart', this.blockSelect);
    document.removeEventListener('selectstart', this.onSelectStart, true);
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
  }

  private onWheel = (e: WheelEvent): void => {
    if (e.ctrlKey && this.capturesBrowserKeys()) e.preventDefault();
    if (!this.pointerLocked) return;
    this.wheel += e.deltaY;
    e.preventDefault();
  };

  /** Ctrl+wheel over the page, including while the pointer is locked. */
  private onCtrlWheel = (e: WheelEvent): void => {
    if (!e.ctrlKey || !this.capturesBrowserKeys()) return;
    e.preventDefault();
  };

  private onContextMenu = (e: Event): void => {
    const mouse = e as MouseEvent;
    if (e.target === this.canvas || this.pointerLocked || (mouse.ctrlKey && this.capturesBrowserKeys())) {
      e.preventDefault();
    }
  };

  private blockSelect = (e: Event): void => {
    e.preventDefault();
  };

  private onSelectStart = (e: Event): void => {
    if (this.pointerLocked || document.activeElement === this.canvas || e.target === this.canvas) {
      e.preventDefault();
    }
  };

  private onAuxClick = (e: MouseEvent): void => {
    if (e.button !== 1) return;
    if (e.target === this.canvas || this.pointerLocked) e.preventDefault();
  };

  /** Canvas focus or pointer lock. Dev-panel text fields are left to the browser. */
  private capturesBrowserKeys(): boolean {
    if (this.pointerLocked) return true;
    return document.activeElement === this.canvas;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.typingTarget(e)) return;
    // Repeats still count. Pointer lock can leave a dev-panel control focused,
    // and the first keydown is then dropped; the repeats are the only signal
    // that the key is physically down.
    if (this.capturesBrowserKeys() && browserKeyBlocked(e.code, e.ctrlKey)) e.preventDefault();
    this.keys.add(e.code);
    if (e.repeat) return;
    this.justPressed.add(e.code);
    if (e.code === 'F11' && this.capturesBrowserKeys()) {
      e.preventDefault();
      void this.toggleFullscreen();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    if (!this.typingTarget(e) && this.capturesBrowserKeys() && browserKeyBlocked(e.code, e.ctrlKey)) {
      e.preventDefault();
    }
  };

  private releaseKeys(): void {
    this.keys.clear();
    this.justPressed.clear();
    this.lmbDown = false;
    this.rmbDown = false;
    this.mmbPressed = false;
    this.clickGate.pointerUp();
  }

  private onBlur = (): void => {
    this.releaseKeys();
  };

  private onVisibility = (): void => {
    if (document.hidden) this.releaseKeys();
  };

  private async toggleFullscreen(): Promise<void> {
    const root = document.getElementById('app') ?? document.documentElement;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await root.requestFullscreen();
      await this.lockKeyboard();
    } catch {
      // The browser can deny fullscreen. The button stays available.
    }
  }

  private async lockKeyboard(): Promise<void> {
    const kb = (
      navigator as Navigator & {
        keyboard?: { lock?: (keyCodes?: string[]) => Promise<void>; unlock?: () => void };
      }
    ).keyboard;
    if (!kb?.lock || !document.fullscreenElement) return;
    try {
      // No key list captures every key, including Ctrl+W / T / N, in Chromium.
      await kb.lock();
    } catch {
      // Safari and Firefox have no keyboard lock. Fullscreen still works.
    }
  }

  private unlockKeyboard(): void {
    const kb = (navigator as Navigator & { keyboard?: { unlock?: () => void } }).keyboard;
    kb?.unlock?.();
  }

  private onFullscreenChange = (): void => {
    const button = document.getElementById('fullscreen-btn');
    if (button) button.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
    if (!document.fullscreenElement) this.unlockKeyboard();
  };

  private onClick = (): void => {
    this.canvas.focus();
    if (!this.pointerLocked) {
      this.clickGate.noteLockRequest();
      this.canvas.requestPointerLock();
    }
  };

  private onPointerLock = (): void => {
    const locked = document.pointerLockElement === this.canvas;
    this.clickGate.setLocked(locked);
    this.pointerLocked = locked;
    if (!locked) this.releaseKeys();
    if (!locked || this.clickGate.suppress) {
      this.lmbDown = false;
      this.lmbPressed = false;
    }
    // Unlock/lock often delivers a cursor-warp mousemove. Drop it so the view does not flick.
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
    this.sawPointerDelta = false;
    if (this.pointerLocked) this.blurGameFocus();
  };

  /** Sum coalesced deltas. The parent event's own movementX is 0 on some held-button frames. */
  private movementOf(e: PointerEvent): { x: number; y: number } {
    const coal = e.getCoalescedEvents?.() ?? [];
    if (coal.length > 0) {
      let x = 0;
      let y = 0;
      for (const c of coal) {
        x += c.movementX;
        y += c.movementY;
      }
      if (x !== 0 || y !== 0) return { x, y };
    }
    return { x: e.movementX, y: e.movementY };
  }

  private onPointerRaw = (event: Event): void => {
    if (!this.pointerLocked) return;
    const e = event as PointerEvent;
    const d = this.movementOf(e);
    if (d.x === 0 && d.y === 0) return;
    this.mouseDelta.x += d.x;
    this.mouseDelta.y += d.y;
    this.sawPointerDelta = true;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked || this.sawPointerDelta) return;
    this.mouseDelta.x += e.movementX;
    this.mouseDelta.y += e.movementY;
  };

  private onMouseDown = (e: MouseEvent): void => {
    // A drag starting here would swallow later keydowns. Aiming is not a drag.
    // Button 1 is the wide-camera toggle; cancel autoscroll even before lock.
    if (e.button === 0 || e.button === 1 || this.pointerLocked || e.ctrlKey) e.preventDefault();
    if (e.currentTarget === this.canvas) this.canvas.focus();
    if (this.pointerLocked) this.blurGameFocus();
    if (e.button === 0) {
      // The press that captures the pointer is not a shot and not a lunge.
      const accept = this.clickGate.pointerDown();
      if (accept) {
        this.lmbDown = true;
        this.lmbPressed = true;
        const now = performance.now();
        const click = classifyGrabClick(now, this.lastGrabMs);
        this.grabEdge = click.grab;
        if (click.dive) this.diveEdge = true;
        this.lastGrabMs = now;
      }
    }
    if (e.button === 1 && this.pointerLocked) this.mmbPressed = true;
    if (e.button === 2 && this.pointerLocked) {
      this.rmbDown = true;
      this.rmbPressed = true;
    }
  };

  /** Pointer lock does not move focus. A dev slider would keep eating WASD. */
  private blurGameFocus(): void {
    const el = document.activeElement;
    if (el instanceof HTMLElement && el !== document.body && el !== this.canvas) el.blur();
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 1 && (e.target === this.canvas || this.pointerLocked)) e.preventDefault();
    if (e.button === 0) {
      this.clickGate.pointerUp();
      this.lmbDown = false;
    }
    if (e.button === 2) this.rmbDown = false;
  };

  private anyDown(codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  private anyJust(codes: string[]): boolean {
    return codes.some((c) => this.justPressed.has(c));
  }

  private readGamepad(_frameDt: number): Partial<InputIntent> | null {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = pads.find((p) => p && p.connected);
    if (!pad) return null;

    const lx = deadzone(pad.axes[0] ?? 0);
    const ly = deadzone(pad.axes[1] ?? 0);
    const rx = deadzone(pad.axes[2] ?? 0);
    const ry = deadzone(pad.axes[3] ?? 0);

    const buttons = pad.buttons;
    const down = (index: number) => buttons[index]?.pressed ?? false;
    const a = down(0);
    const b = down(1);
    const x = down(2);
    const lb = down(4);
    const rb = down(5);
    const lt = (buttons[6]?.value ?? 0) > 0.45;
    const rt = (buttons[7]?.value ?? 0) > 0.45;
    const y = down(3);
    const rs = down(11);
    const dUp = down(12);
    const dDown = down(13);

    const aEdge = a && !this.padButtons.a;
    const bEdge = b && !this.padButtons.b;
    const xEdge = x && !this.padButtons.x;
    const yEdge = y && !this.padButtons.y;
    const rtEdge = rt && !this.padButtons.rt;
    const rsEdge = rs && !this.padButtons.rs;
    const l3 = down(9);
    const l3Edge = l3 && !this.padButtons.l3;
    const rbEdge = rb && !this.padButtons.rb;
    // X grabs. A second X inside the window, Y, or RB dives. Y used to drop;
    // dropping the ball on a pad is the left stick click.
    let burst = yEdge || rbEdge;
    if (xEdge) {
      const now = performance.now();
      if (classifyGrabClick(now, this.lastPadGrabMs).dive) burst = true;
      this.lastPadGrabMs = now;
    }
    this.padButtons = { a, b, x, y, rb, rt, rs, l3 };

    return {
      move: new THREE.Vector3(lx, 0, -ly),
      lookDelta: { x: 0, y: 0 },
      aimStick: { x: rx, y: ry },
      up: (dUp ? 1 : 0) - (dDown ? 1 : 0),
      sprint: down(10),
      strafe: lt,
      claim: aEdge || xEdge,
      drop: l3Edge,
      kick: bEdge,
      kickHeld: b,
      shoot: rtEdge,
      shootHeld: rt,
      burst,
      burstPower: false,
      tackleHeld: false,
      passHeld: false,
      zoomOut: lb,
      zoomTogglePressed: rsEdge,
      resetBall: down(8),
      level: false,
      ballCamToggle: false,
    };
  }

  private typingTarget(e: KeyboardEvent): boolean {
    // Captured pointer means the player is in the arena, even if a range
    // input kept document focus. Those controls are not text fields.
    if (this.pointerLocked) return false;
    const t = e.target;
    if (!(t instanceof HTMLElement)) return false;
    return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
  }

  sample(frameDt: number): InputIntent {
    const move = new THREE.Vector3(
      (this.anyDown(KEYS.right) ? 1 : 0) - (this.anyDown(KEYS.left) ? 1 : 0),
      0,
      (this.anyDown(KEYS.forward) ? 1 : 0) - (this.anyDown(KEYS.back) ? 1 : 0),
    );
    if (move.lengthSq() > 1) move.normalize();

    const lookDelta = {
      x: this.mouseDelta.x * INPUT.mouseSensitivity,
      y: this.mouseDelta.y * INPUT.mouseSensitivity,
    };
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;

    const intent: InputIntent = {
      move,
      lookDelta,
      up: (this.anyDown(KEYS.up) ? 1 : 0) - (this.anyDown(KEYS.down) ? 1 : 0),
      sprint: this.anyDown(KEYS.sprint),
      strafe: this.rmbDown,
      claim: this.anyJust(KEYS.claim) || this.grabEdge,
      drop: this.anyJust(KEYS.drop),
      pass: this.anyJust(KEYS.pass),
      shoot: this.lmbPressed,
      shootHeld: this.lmbDown,
      kick: this.anyJust(KEYS.kick),
      kickHeld: this.anyDown(KEYS.kick),
      burstPower: false,
      aimCancel: this.rmbPressed,
      // Q is a dive, the same lunge as a double-click. It is not a charge.
      burst: this.anyJust(KEYS.tackle) || this.diveEdge,
      tackleHeld: false,
      passHeld: this.anyDown(KEYS.pass),
      zoomOut: this.anyDown(KEYS.zoom),
      zoomTogglePressed: this.anyJust(KEYS.zoom),
      middleZoomPressed: this.mmbPressed,
      resetBall: this.anyJust(KEYS.reset),
      level: this.anyJust(KEYS.level),
      ballCamToggle: this.anyJust(KEYS.ballCam),
      toggleDev: this.anyJust(KEYS.toggleDev),
      // Wheel-up (negative deltaY) lengthens the aim. ~3 units per notch.
      aimRangeDelta: -this.wheel * 0.03,
      callForPass: this.anyJust(KEYS.callForPass),
    };
    this.wheel = 0;

    const pad = this.readGamepad(frameDt);
    if (pad) {
      if (pad.move && pad.move.lengthSq() > intent.move.lengthSq()) intent.move.copy(pad.move);
      if (pad.aimStick) intent.aimStick = pad.aimStick;
      if (pad.up) intent.up = Math.max(-1, Math.min(1, intent.up + (pad.up ?? 0)));
      intent.sprint = intent.sprint || Boolean(pad.sprint);
      intent.strafe = intent.strafe || Boolean(pad.strafe);
      intent.claim = intent.claim || Boolean(pad.claim);
      intent.drop = intent.drop || Boolean(pad.drop);
      intent.pass = intent.pass || Boolean(pad.pass);
      intent.shoot = intent.shoot || Boolean(pad.shoot);
      intent.shootHeld = intent.shootHeld || Boolean(pad.shootHeld);
      intent.kick = intent.kick || Boolean(pad.kick);
      intent.kickHeld = intent.kickHeld || Boolean(pad.kickHeld);
      intent.burst = intent.burst || Boolean(pad.burst);
      intent.burstPower = intent.burstPower || Boolean(pad.burstPower);
      intent.tackleHeld = intent.tackleHeld || Boolean(pad.tackleHeld);
      intent.passHeld = intent.passHeld || Boolean(pad.passHeld);
      intent.zoomOut = intent.zoomOut || Boolean(pad.zoomOut);
      intent.zoomTogglePressed = intent.zoomTogglePressed || Boolean(pad.zoomTogglePressed);
      intent.resetBall = intent.resetBall || Boolean(pad.resetBall);
    }

    this.playback = {
      pause: this.anyJust(KEYS.pause),
      step: this.anyJust(KEYS.step),
      help: this.anyJust(KEYS.help),
    };
    this.justPressed.clear();
    this.lmbPressed = false;
    this.grabEdge = false;
    this.diveEdge = false;
    this.rmbPressed = false;
    this.mmbPressed = false;
    this.sawPointerDelta = false;
    if (this.pointerLocked) this.blurGameFocus();

    return intent;
  }

  /** Pause and single-step edges from the sample that just ran. */
  takePlayback(): { pause: boolean; step: boolean; help: boolean } {
    return this.playback;
  }
}
