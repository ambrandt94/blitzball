import * as THREE from 'three';
import { initForge, recipeForLook } from '../characters/forge';
import type { Body } from '../characters/cfRuntime';
import {
  HAIR_COLORS,
  HAIR_STYLES,
  PLAY_MODES,
  SKIN_TONES,
  TEAM_COLORS,
  loadPlayerProfile,
  randomPlayerProfile,
  savePlayerProfile,
  type PlayMode,
  type PlayerProfile,
} from './playerProfile';
import { BLITZBALL_OUTFITS } from '../characters/outfits';

type Screen = 'splash' | 'settings' | 'character' | 'mode' | 'controls';

export class FrontDoor {
  private hooks: { onStart: (profile: PlayerProfile) => void; onResume: () => void; onPause: () => void };
  private root: HTMLElement;
  private pause: HTMLElement;
  private draft: PlayerProfile;
  private screen: Screen = 'splash';
  private backTo: 'splash' | 'pause' = 'splash';
  private focus = 0;
  private pad = { up: false, down: false, a: false, b: false };
  private running = false;
  private previewQueued = false;
  private preview: {
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    body: Body | null;
    busy: boolean;
  } | null = null;

  constructor(hooks: { onStart: (profile: PlayerProfile) => void; onResume: () => void; onPause: () => void }) {
    this.hooks = hooks;
    this.draft = loadPlayerProfile();
    this.root = document.createElement('div');
    this.root.id = 'front-door';
    this.root.className = 'front-door';
    this.root.hidden = true;
    this.pause = document.createElement('div');
    this.pause.id = 'pause-menu';
    this.pause.className = 'front-door';
    this.pause.hidden = true;
    this.render();
    document.getElementById('app')?.append(this.root, this.pause);
    window.addEventListener('keydown', this.onKey, true);
  }

  isFlowOpen(): boolean {
    return !this.root.hidden;
  }

  isPauseOpen(): boolean {
    return !this.pause.hidden;
  }

  openFlow(): void {
    this.backTo = 'splash';
    this.draft = loadPlayerProfile();
    this.root.hidden = false;
    this.pause.hidden = true;
    this.show(this.draft.returning ? 'splash' : 'splash');
    this.running = true;
    requestAnimationFrame(this.frame);
  }

  closeFlow(): void {
    this.root.hidden = true;
    this.running = false;
  }

  showPause(handlers: { resume: () => void; mode: () => void; character: () => void; menu: () => void }): void {
    this.pause.hidden = false;
    this.pause.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'front-card';
    card.append(heading('Paused'), note('Esc or P resumes. Back on a screen returns here.'));
    const resume = choice('Resume', () => handlers.resume());
    const mode = choice('Change mode', () => {
      this.pause.hidden = true;
      this.backTo = 'pause';
      this.root.hidden = false;
      this.running = true;
      this.show('mode');
      requestAnimationFrame(this.frame);
    });
    const character = choice('Edit character', () => {
      this.pause.hidden = true;
      this.backTo = 'pause';
      this.root.hidden = false;
      this.running = true;
      this.show('character');
      requestAnimationFrame(this.frame);
    });
    const menu = choice('Main menu', () => handlers.menu());
    card.append(resume, mode, character, menu);
    this.pause.append(card);
    this.focusChoice(this.pause);
  }

  hidePause(): void {
    this.pause.hidden = true;
  }

  private show(screen: Screen): void {
    this.screen = screen;
    this.focus = 0;
    if (screen === 'character') {
      const next = this.character();
      const old = this.root.querySelector('[data-screen="character"]');
      if (old) old.replaceWith(next);
    }
    if (screen === 'splash') this.syncSplash();
    for (const page of this.root.querySelectorAll<HTMLElement>('[data-screen]')) {
      page.hidden = page.dataset.screen !== screen;
    }
    if (screen === 'character') void this.ensurePreview();
    this.focusChoice(this.root.querySelector<HTMLElement>(`[data-screen="${screen}"]`) ?? this.root);
  }

  private render(): void {
    this.root.append(
      this.splash(),
      this.settings(),
      this.character(),
      this.mode(),
      this.controls(),
    );
  }

  private splash(): HTMLElement {
    const page = screen('splash');
    page.append(
      heading('Blitzball'),
      note('Swim, grab, and throw. A short setup, then you are in the water.'),
    );
    const actions = document.createElement('div');
    actions.className = 'front-actions';
    actions.id = 'splash-actions';
    page.append(actions);
    const settings = choice('Settings', () => this.show('settings'));
    settings.classList.add('front-quiet');
    page.append(settings);
    return page;
  }

  private syncSplash(): void {
    const actions = this.root.querySelector('#splash-actions');
    if (!actions) return;
    actions.innerHTML = '';
    if (this.draft.returning) {
      actions.append(
        choice('Quick play', () => this.start(false)),
        choice('Change mode', () => {
          this.backTo = 'splash';
          this.show('mode');
        }),
        choice('Edit character', () => {
          this.backTo = 'splash';
          this.show('character');
        }),
      );
    } else {
      actions.append(choice('Play', () => this.show('character')));
    }
  }

  private settings(): HTMLElement {
    const page = screen('settings');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.draft.showControls;
    box.addEventListener('change', () => {
      this.draft.showControls = box.checked;
      savePlayerProfile(this.draft);
    });
    const row = document.createElement('label');
    row.className = 'front-check';
    row.append(box, document.createTextNode(' Show the controls card before a match'));
    page.append(
      heading('Settings'),
      note('The developer panel stays hidden. Press ` during a match to open it.'),
      row,
      choice('Back', () => this.back()),
    );
    return page;
  }

  private character(): HTMLElement {
    const page = screen('character');
    const stage = document.createElement('div');
    stage.className = 'front-stage';
    const canvas = document.createElement('canvas');
    canvas.id = 'character-preview';
    canvas.width = 360;
    canvas.height = 420;
    const status = document.createElement('p');
    status.className = 'front-note';
    status.textContent = 'Building preview…';
    status.dataset.previewStatus = '1';
    stage.append(canvas, status);
    const name = document.createElement('input');
    name.type = 'text';
    name.maxLength = 18;
    name.value = this.draft.name;
    name.className = 'front-name';
    name.setAttribute('aria-label', 'Name');
    name.addEventListener('input', () => {
      this.draft.name = name.value.trim() || 'Player';
    });
    page.append(
      heading('Your swimmer'),
      stage,
      labelRow('Name', name),
      this.cycle('Skin', SKIN_TONES.map((tone) => ({ id: String(tone.id), label: tone.label })), () => String(this.draft.tone), (id) => {
        this.draft.tone = Number(id);
        void this.ensurePreview();
      }),
      this.cycle('Hair', HAIR_STYLES.map((style) => ({ id: style.id, label: style.label })), () => this.draft.hair, (id) => {
        this.draft.hair = id;
        void this.ensurePreview();
      }),
      this.cycle('Hair colour', HAIR_COLORS.map((color) => ({ id: color.id, label: color.label })), () => this.draft.hairColor, (id) => {
        this.draft.hairColor = id;
        void this.ensurePreview();
      }),
      this.cycle('Suit', BLITZBALL_OUTFITS.map((outfit) => ({ id: outfit.id, label: outfit.label })), () => this.draft.outfit, (id) => {
        if (id === 'onepiece' || id === 'trunks' || id === 'boardshorts' || id === 'boardshorts_asym') this.draft.outfit = id;
        void this.ensurePreview();
      }),
      this.cycle('Team colour', TEAM_COLORS.map((color) => ({ id: color.id, label: color.label })), () => this.draft.teamColor, (id) => {
        this.draft.teamColor = id;
        void this.ensurePreview();
      }),
    );
    const random = choice('Randomize', () => {
      this.draft = randomPlayerProfile(this.draft, Math.random());
      name.value = this.draft.name;
      this.show('character');
    });
    const next = choice(this.backTo === 'pause' ? 'Done' : 'Next', () => {
      if (this.backTo === 'pause') {
        savePlayerProfile(this.draft);
        this.hooks.onStart({ ...this.draft, returning: true });
        return;
      }
      this.show('mode');
    });
    const back = choice('Back', () => this.back());
    page.append(random, next, back);
    return page;
  }

  private mode(): HTMLElement {
    const page = screen('mode');
    page.append(heading('How do you want to play?'), note('You can change this later from the pause menu.'));
    for (const mode of PLAY_MODES) {
      const button = choice(mode.label, () => this.pickMode(mode.id));
      const detail = document.createElement('p');
      detail.className = 'front-detail';
      detail.textContent = mode.detail;
      page.append(button, detail);
    }
    page.append(choice('Back', () => this.back()));
    return page;
  }

  private controls(): HTMLElement {
    const page = screen('controls');
    const skip = document.createElement('label');
    skip.className = 'front-check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => {
      this.draft.showControls = !box.checked;
    });
    skip.append(box, document.createTextNode(" Don't show this again"));
    page.append(
      heading('Controls'),
      note('WASD swim. Space up, Ctrl down. Mouse looks. Right mouse aims.'),
      note('Left click grabs. Double-click dives. Hold left click to throw, and move the mouse or right stick to curve. Let go and it straightens.'),
      note('C kicks. Q dives. F passes. P pauses.'),
      skip,
      choice('Play', () => this.start(true)),
      choice('Back', () => this.show('mode')),
    );
    return page;
  }

  private cycle(
    label: string,
    options: { id: string; label: string }[],
    read: () => string,
    write: (id: string) => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'front-cycle';
    const name = document.createElement('span');
    name.textContent = label;
    const value = document.createElement('strong');
    const paint = () => {
      const current = options.find((option) => option.id === read()) ?? options[0]!;
      value.textContent = current.label;
    };
    const step = (dir: number) => {
      const index = Math.max(0, options.findIndex((option) => option.id === read()));
      const next = options[(index + dir + options.length) % options.length]!;
      write(next.id);
      paint();
    };
    const prev = choice('‹', () => step(-1));
    const next = choice('›', () => step(1));
    prev.classList.add('front-step');
    next.classList.add('front-step');
    paint();
    row.append(name, prev, value, next);
    return row;
  }

  private pickMode(mode: PlayMode): void {
    this.draft.mode = mode;
    if (this.backTo === 'pause') {
      savePlayerProfile({ ...this.draft, returning: true });
      this.hooks.onStart({ ...this.draft, returning: true });
      return;
    }
    if (this.draft.showControls) this.show('controls');
    else this.start(true);
  }

  private start(markReturning: boolean): void {
    const profile = { ...this.draft, returning: markReturning || this.draft.returning };
    savePlayerProfile(profile);
    this.hooks.onStart(profile);
  }

  private back(): void {
    if (this.screen === 'settings' || (this.screen === 'character' && this.backTo === 'splash') || this.screen === 'mode' && this.backTo === 'splash') {
      this.show('splash');
      return;
    }
    if (this.screen === 'character' && this.backTo === 'pause') {
      this.root.hidden = true;
      this.pause.hidden = false;
      this.running = false;
      return;
    }
    if (this.screen === 'mode' && this.backTo === 'pause') {
      this.root.hidden = true;
      this.pause.hidden = false;
      this.running = false;
      return;
    }
    if (this.screen === 'mode') this.show('character');
    else if (this.screen === 'controls') this.show('mode');
    else this.show('splash');
  }

  private onKey = (event: KeyboardEvent): void => {
    if (event.code !== 'Escape' && !this.isFlowOpen() && !this.isPauseOpen()) return;
    if (event.code === 'Escape') {
      if (document.pointerLockElement) return;
      event.preventDefault();
      if (this.isPauseOpen() && this.root.hidden) {
        this.hooks.onResume();
        return;
      }
      if (this.isFlowOpen()) {
        this.back();
        return;
      }
      this.hooks.onPause();
      return;
    }
    if (event.code === 'KeyP' && this.isPauseOpen() && this.root.hidden) {
      event.preventDefault();
      this.hooks.onResume();
      return;
    }
    if (!this.isFlowOpen() && !this.isPauseOpen()) return;
    const page = this.activePage();
    if (!page) return;
    const choices = [...page.querySelectorAll<HTMLButtonElement>('button.front-choice')];
    if (event.code === 'ArrowDown' || event.code === 'ArrowRight') {
      event.preventDefault();
      this.focus = (this.focus + 1) % Math.max(1, choices.length);
      this.applyFocus(choices);
    } else if (event.code === 'ArrowUp' || event.code === 'ArrowLeft') {
      event.preventDefault();
      this.focus = (this.focus - 1 + choices.length) % Math.max(1, choices.length);
      this.applyFocus(choices);
    } else if (event.code === 'Enter' || event.code === 'Space') {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.type === 'text') return;
      event.preventDefault();
      choices[this.focus]?.click();
    }
  };

  private frame = (): void => {
    if (!this.running && this.pause.hidden) return;
    this.pollPad();
    if (this.preview?.body) {
      this.preview.body.object3D.rotation.y += 0.01;
      this.preview.renderer.render(this.preview.scene, this.preview.camera);
    }
    if (this.running) requestAnimationFrame(this.frame);
  };

  private pollPad(): void {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = [...pads].find((entry) => entry && entry.connected);
    if (!pad) return;
    const up = (pad.buttons[12]?.pressed ?? false) || (pad.axes[1] ?? 0) < -0.6;
    const down = (pad.buttons[13]?.pressed ?? false) || (pad.axes[1] ?? 0) > 0.6;
    const a = pad.buttons[0]?.pressed ?? false;
    const b = pad.buttons[1]?.pressed ?? false;
    const page = this.isPauseOpen() && this.root.hidden ? this.pause : this.activePage();
    const choices = page ? [...page.querySelectorAll<HTMLButtonElement>('button.front-choice')] : [];
    if (up && !this.pad.up) {
      this.focus = (this.focus - 1 + choices.length) % Math.max(1, choices.length);
      this.applyFocus(choices);
    }
    if (down && !this.pad.down) {
      this.focus = (this.focus + 1) % Math.max(1, choices.length);
      this.applyFocus(choices);
    }
    if (a && !this.pad.a) choices[this.focus]?.click();
    if (b && !this.pad.b) {
      if (this.isPauseOpen() && this.root.hidden) this.hooks.onResume();
      else this.back();
    }
    this.pad = { up, down, a, b };
  }

  private activePage(): HTMLElement | null {
    return this.root.querySelector<HTMLElement>(`[data-screen="${this.screen}"]:not([hidden])`);
  }

  private focusChoice(scope: ParentNode): void {
    const choices = [...scope.querySelectorAll<HTMLButtonElement>('button.front-choice')];
    this.applyFocus(choices);
  }

  private applyFocus(choices: HTMLButtonElement[]): void {
    choices.forEach((button, index) => button.classList.toggle('is-focus', index === this.focus));
    choices[this.focus]?.scrollIntoView({ block: 'nearest' });
  }

  private async ensurePreview(): Promise<void> {
    const canvas = this.root.querySelector<HTMLCanvasElement>('#character-preview');
    if (!canvas || this.screen !== 'character') return;
    if (!canvas.dataset.preview) canvas.dataset.preview = 'building';
    if (!this.preview || this.preview.renderer.domElement !== canvas) {
      this.preview?.body?.dispose();
      this.preview?.renderer.dispose();
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setSize(canvas.width, canvas.height, false);
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 0.7));
      const key = new THREE.DirectionalLight(0xffffff, 1.1);
      key.position.set(1, 2, 2);
      scene.add(key);
      const camera = new THREE.PerspectiveCamera(32, canvas.width / canvas.height, 0.05, 20);
      camera.position.set(0, 0.85, 2.4);
      camera.lookAt(0, 0.7, 0);
      this.preview = { renderer, scene, camera, body: null, busy: false };
    }
    if (this.preview.busy) {
      this.previewQueued = true;
      return;
    }
    this.preview.busy = true;
    try {
      const cf = await initForge();
      const recipe = recipeForLook(cf, this.draft);
      if (!this.preview.body) {
        const body = await cf.build(recipe);
        body.object3D.position.y = 0;
        this.preview.scene.add(body.object3D);
        this.preview.body = body;
        canvas.dataset.preview = 'ready';
        canvas.parentElement?.querySelector('[data-preview-status]')?.remove();
      } else {
        await this.preview.body.setRecipe(recipe);
        canvas.dataset.preview = 'ready';
        canvas.parentElement?.querySelector('[data-preview-status]')?.remove();
      }
    } catch (err) {
      canvas.dataset.preview = 'error';
      canvas.dataset.previewError = err instanceof Error ? err.message : String(err);
      console.warn('character preview failed', err);
    } finally {
      if (this.preview) this.preview.busy = false;
      if (this.previewQueued) {
        this.previewQueued = false;
        void this.ensurePreview();
      }
    }
  }
}

function screen(name: Screen): HTMLElement {
  const page = document.createElement('section');
  page.className = 'front-card';
  page.dataset.screen = name;
  page.hidden = name !== 'splash';
  return page;
}

function heading(text: string): HTMLElement {
  const h = document.createElement('h1');
  h.textContent = text;
  return h;
}

function note(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'front-note';
  p.textContent = text;
  return p;
}

function labelRow(label: string, field: HTMLElement): HTMLElement {
  const row = document.createElement('label');
  row.className = 'front-cycle';
  const name = document.createElement('span');
  name.textContent = label;
  row.append(name, field);
  return row;
}

function choice(text: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'front-choice';
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}
