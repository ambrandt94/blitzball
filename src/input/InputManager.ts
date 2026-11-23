import * as THREE from 'three';
import { INPUT } from '../game/constants';
import type { InputIntent } from '../game/types';

const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['Space'],
  down: ['KeyC', 'ControlLeft'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  claim: ['KeyE'],
  drop: ['KeyQ'],
  pass: ['KeyF'],
  zoom: ['KeyV'],
  reset: ['KeyR'],
  toggleDev: ['Backquote'],
};

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
  private wheel = 0;
  private canvas: HTMLElement;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('click', this.onClick);
    document.addEventListener('pointerlockchange', this.onPointerLock);
    document.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    // Right-click is strafe/aim. Kill the browser menu on press and on the
    // contextmenu event, including when the pointer is not yet locked.
    canvas.addEventListener('contextmenu', this.onContextMenu, { capture: true });
    document.addEventListener('contextmenu', this.onContextMenu, { capture: true });
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('click', this.onClick);
    document.removeEventListener('pointerlockchange', this.onPointerLock);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu, { capture: true });
    document.removeEventListener('contextmenu', this.onContextMenu, { capture: true });
    this.canvas.removeEventListener('wheel', this.onWheel);
  }

  private onWheel = (e: WheelEvent): void => {
    if (!this.pointerLocked) return;
    this.wheel += e.deltaY;
    e.preventDefault();
  };

  private onContextMenu = (e: Event): void => {
    if (e.target === this.canvas || this.pointerLocked) e.preventDefault();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (this.typingTarget(e)) return;
    this.keys.add(e.code);
    this.justPressed.add(e.code);
    if (KEYS.up.includes(e.code) || e.code === 'Space') e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.lmbDown = false;
    this.rmbDown = false;
  };

  private onClick = (): void => {
    if (!this.pointerLocked) this.canvas.requestPointerLock();
  };

  private onPointerLock = (): void => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    // Unlock/lock often delivers a cursor-warp mousemove. Drop it so the view does not flick.
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    this.mouseDelta.x += e.movementX;
    this.mouseDelta.y += e.movementY;
  };

  private onMouseDown = (e: MouseEvent): void => {
    // The click that captures the pointer is not a shot or a pass.
    if (!this.pointerLocked) return;
    if (e.button === 0) {
      this.lmbDown = true;
      this.lmbPressed = true;
    }
    if (e.button === 2) {
      this.rmbDown = true;
      e.preventDefault();
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.lmbDown = false;
    if (e.button === 2) this.rmbDown = false;
  };

  private anyDown(codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  private anyJust(codes: string[]): boolean {
    return codes.some((c) => this.justPressed.has(c));
  }

  private readGamepad(): Partial<InputIntent> | null {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = pads.find((p) => p && p.connected);
    if (!pad) return null;

    const lx = deadzone(pad.axes[0] ?? 0);
    const ly = deadzone(pad.axes[1] ?? 0);
    const rx = deadzone(pad.axes[2] ?? 0);
    const ry = deadzone(pad.axes[3] ?? 0);

    const buttons = pad.buttons;
    const a = buttons[0]?.pressed ?? false;
    const x = buttons[2]?.pressed ?? false;
    const b = buttons[1]?.pressed ?? false;
    const lb = buttons[4]?.pressed ?? false;
    const lt = (buttons[6]?.value ?? 0) > 0.4;
    const rt = (buttons[7]?.value ?? 0) > 0.15;
    const rtPressed = buttons[7]?.pressed && (buttons[7].value ?? 0) > 0.5;
    const rs = buttons[11]?.pressed ?? false;

    // Edge detect for gamepad face buttons via previous frame would be better;
    // for greybox treat held as intent edge each frame when just crossing — simplified: use pressed each frame for claim via A edge via value.
    return {
      move: new THREE.Vector3(lx, 0, -ly),
      lookDelta: {
        x: rx * INPUT.gamepadLookSens,
        y: ry * INPUT.gamepadLookSens,
      },
      up: (buttons[5]?.pressed ? 1 : 0) - (lt ? 1 : 0),
      sprint: buttons[10]?.pressed ?? false,
      strafe: buttons[3]?.pressed ?? false,
      claim: a,
      drop: b,
      pass: x,
      shoot: Boolean(rtPressed),
      shootHeld: rt,
      passHeld: x,
      zoomOut: lb,
      zoomTogglePressed: rs,
      resetBall: buttons[8]?.pressed ?? false,
    };
  }

  private typingTarget(e: KeyboardEvent): boolean {
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
      claim: this.anyJust(KEYS.claim),
      drop: this.anyJust(KEYS.drop),
      pass: this.anyJust(KEYS.pass),
      shoot: this.lmbPressed,
      shootHeld: this.lmbDown,
      passHeld: this.anyDown(KEYS.pass),
      zoomOut: this.anyDown(KEYS.zoom),
      zoomTogglePressed: this.anyJust(KEYS.zoom),
      resetBall: this.anyJust(KEYS.reset),
      toggleDev: this.anyJust(KEYS.toggleDev),
      // Wheel-up (negative deltaY) lengthens the aim. ~3 units per notch.
      aimRangeDelta: -this.wheel * 0.03,
    };
    this.wheel = 0;

    const pad = this.readGamepad();
    if (pad) {
      if (pad.move && pad.move.lengthSq() > intent.move.lengthSq()) intent.move.copy(pad.move);
      if (pad.lookDelta) {
        intent.lookDelta.x += pad.lookDelta.x * frameDt;
        intent.lookDelta.y += pad.lookDelta.y * frameDt;
      }
      if (pad.up) intent.up = Math.max(-1, Math.min(1, intent.up + (pad.up ?? 0)));
      intent.sprint = intent.sprint || Boolean(pad.sprint);
      intent.strafe = intent.strafe || Boolean(pad.strafe);
      intent.claim = intent.claim || Boolean(pad.claim);
      intent.drop = intent.drop || Boolean(pad.drop);
      intent.pass = intent.pass || Boolean(pad.pass);
      intent.shoot = intent.shoot || Boolean(pad.shoot);
      intent.shootHeld = intent.shootHeld || Boolean(pad.shootHeld);
      intent.passHeld = intent.passHeld || Boolean(pad.passHeld);
      intent.zoomOut = intent.zoomOut || Boolean(pad.zoomOut);
      intent.zoomTogglePressed = intent.zoomTogglePressed || Boolean(pad.zoomTogglePressed);
      intent.resetBall = intent.resetBall || Boolean(pad.resetBall);
    }

    this.justPressed.clear();
    this.lmbPressed = false;

    return intent;
  }
}
