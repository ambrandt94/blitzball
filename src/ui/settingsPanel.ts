/**
 * Reusable settings panel: a sticky table of contents, a search box, and a
 * Pinned group that stays at the top. Pins and edited values live in a
 * key/value store (localStorage in the browser). Another project can mount
 * one of these without taking the rest of the Dev panel.
 */

export type SettingValue = number | boolean | string;

export interface SettingStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SavedSettings {
  pins: string[];
  values: Record<string, SettingValue>;
}

export interface SettingSpec {
  key: string;
  label: string;
  sectionId: string;
  /** Build the control into `parent`. Called again for the pinned copy. */
  render: (parent: HTMLElement) => void;
}

const EMPTY: SavedSettings = { pins: [], values: {} };

export function readSettings(store: SettingStore, storageKey: string): SavedSettings {
  try {
    const raw = store.getItem(storageKey);
    if (!raw) return { pins: [], values: {} };
    const data = JSON.parse(raw) as Partial<SavedSettings>;
    const pins = Array.isArray(data.pins) ? data.pins.filter((pin) => typeof pin === 'string') : [];
    const values: Record<string, SettingValue> = {};
    if (data.values && typeof data.values === 'object') {
      for (const [key, value] of Object.entries(data.values)) {
        if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
          values[key] = value;
        }
      }
    }
    return { pins, values };
  } catch {
    return { pins: [], values: {} };
  }
}

export function writeSettings(store: SettingStore, storageKey: string, saved: SavedSettings): void {
  store.setItem(storageKey, JSON.stringify({ pins: saved.pins, values: saved.values }));
}

export function settingMatches(label: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return label.toLowerCase().includes(q);
}

export class SettingsPanel {
  private saved: SavedSettings = { pins: [], values: {} };
  private specs = new Map<string, SettingSpec>();
  private sections: { id: string; title: string; el: HTMLElement }[] = [];
  private chrome: HTMLElement | null = null;
  private toc: HTMLElement | null = null;
  private pinned: HTMLElement | null = null;
  private pinnedList: HTMLElement | null = null;
  private query = '';
  private observer: IntersectionObserver | null = null;
  private root: HTMLElement;
  private storageKey: string;
  private store: SettingStore;

  constructor(root: HTMLElement, storageKey: string, store: SettingStore = localStorage) {
    this.root = root;
    this.storageKey = storageKey;
    this.store = store;
    this.saved = readSettings(this.store, this.storageKey);
  }

  /** Values saved from earlier sessions. Apply them before building controls. */
  values(): Record<string, SettingValue> {
    return { ...this.saved.values };
  }

  pins(): string[] {
    return [...this.saved.pins];
  }

  isPinned(key: string): boolean {
    return this.saved.pins.includes(key);
  }

  writeValue(key: string, value: SettingValue): void {
    this.saved.values[key] = value;
    this.persist();
  }

  /** Search box, table of contents, and the Pinned group. Call once, first. */
  mountChrome(): void {
    const chrome = document.createElement('div');
    chrome.className = 'settings-chrome';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'settings-search';
    search.placeholder = 'Find a setting';
    search.autocomplete = 'off';
    search.addEventListener('input', () => {
      this.query = search.value;
      this.applyFilter();
    });
    const toc = document.createElement('nav');
    toc.className = 'settings-toc';
    toc.setAttribute('aria-label', 'Settings');
    chrome.append(search, toc);

    const pinned = document.createElement('section');
    pinned.className = 'settings-pinned';
    pinned.id = 'settings-pinned';
    pinned.dataset.sectionTitle = 'Pinned';
    const head = document.createElement('h3');
    head.textContent = 'Pinned';
    const list = document.createElement('div');
    list.className = 'settings-pinned-list';
    pinned.append(head, list);

    this.root.append(chrome, pinned);
    this.chrome = chrome;
    this.toc = toc;
    this.pinned = pinned;
    this.pinnedList = list;
  }

  section(id: string, title: string): HTMLElement {
    const block = document.createElement('section');
    block.className = 'settings-section';
    block.id = `settings-${id}`;
    block.dataset.sectionId = id;
    block.dataset.sectionTitle = title;
    const head = document.createElement('h3');
    head.textContent = title;
    const body = document.createElement('div');
    body.className = 'settings-section-body';
    block.append(head, body);
    this.root.append(block);
    this.sections.push({ id, title, el: block });
    return body;
  }

  /**
   * Remember a row so it can be pinned and filtered.
   * `row` is the element just built into its section.
   */
  track(row: HTMLElement, spec: SettingSpec): void {
    row.dataset.settingKey = spec.key;
    row.dataset.settingLabel = spec.label;
    row.classList.add('setting-row');
    this.specs.set(spec.key, spec);
    this.addPin(row, spec.key);
  }

  /** Fill the table of contents, the pinned group, and the scroll highlight. */
  finish(): void {
    this.renderToc();
    this.renderPinned();
    this.applyFilter();
    this.watchScroll();
  }

  private persist(): void {
    try {
      writeSettings(this.store, this.storageKey, this.saved);
    } catch {
      // Ignore quota and private-mode failures.
    }
  }

  private togglePin(key: string): void {
    const index = this.saved.pins.indexOf(key);
    if (index >= 0) this.saved.pins.splice(index, 1);
    else this.saved.pins.push(key);
    this.persist();
    this.renderPinned();
    this.paintPins();
    this.applyFilter();
  }

  private addPin(row: HTMLElement, key: string): void {
    if (row.querySelector('.settings-pin')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'settings-pin';
    button.dataset.pinKey = key;
    button.title = 'Pin this setting to the top';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.togglePin(key);
    });
    row.append(button);
    this.paintPin(button, key);
  }

  private paintPins(): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.settings-pin')) {
      const key = button.dataset.pinKey;
      if (key) this.paintPin(button, key);
    }
  }

  private paintPin(button: HTMLButtonElement, key: string): void {
    const on = this.isPinned(key);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.textContent = on ? 'Unpin' : 'Pin';
  }

  private renderToc(): void {
    const toc = this.toc;
    if (!toc) return;
    toc.innerHTML = '';
    const pinnedLink = document.createElement('a');
    pinnedLink.href = '#settings-pinned';
    pinnedLink.textContent = 'Pinned';
    pinnedLink.dataset.toc = 'settings-pinned';
    pinnedLink.addEventListener('click', (event) => {
      event.preventDefault();
      this.scrollTo(this.pinned);
    });
    toc.append(pinnedLink);
    for (const section of this.sections) {
      const link = document.createElement('a');
      link.href = `#${section.el.id}`;
      link.textContent = section.title;
      link.dataset.toc = section.el.id;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        this.scrollTo(section.el);
      });
      toc.append(link);
    }
  }

  private scrollTo(el: HTMLElement | null): void {
    if (!el) return;
    const chrome = this.chrome?.offsetHeight ?? 0;
    const top = el.offsetTop - chrome - 4;
    this.root.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  private renderPinned(): void {
    const list = this.pinnedList;
    if (!list) return;
    list.innerHTML = '';
    if (this.saved.pins.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'settings-empty';
      empty.textContent = 'Pin a setting and it stays here.';
      list.append(empty);
      return;
    }
    for (const key of this.saved.pins) {
      const spec = this.specs.get(key);
      if (!spec) continue;
      const host = document.createElement('div');
      host.className = 'settings-pinned-item';
      spec.render(host);
      const row = host.firstElementChild;
      if (row instanceof HTMLElement) this.track(row, spec);
      list.append(host);
    }
  }

  private applyFilter(): void {
    const query = this.query;
    for (const spec of this.specs.values()) {
      const show = settingMatches(spec.label, query);
      for (const row of this.root.querySelectorAll<HTMLElement>(`[data-setting-key="${cssEscape(spec.key)}"]`)) {
        row.hidden = !show;
      }
    }
    for (const section of this.sections) {
      const titleHit = settingMatches(section.title, query);
      const rows = [...section.el.querySelectorAll<HTMLElement>('[data-setting-key]')];
      const anyRow = rows.some((row) => !row.hidden);
      const visible = query.trim() === '' || titleHit || anyRow;
      section.el.hidden = !visible;
      if (titleHit && query.trim() !== '') {
        for (const row of rows) row.hidden = false;
      }
      const link = this.toc?.querySelector<HTMLAnchorElement>(`[data-toc="${section.el.id}"]`);
      if (link) link.hidden = !visible;
    }
    if (this.pinned) {
      const rows = [...this.pinned.querySelectorAll<HTMLElement>('[data-setting-key]')];
      const any = rows.some((row) => !row.hidden);
      this.pinned.hidden = query.trim() !== '' && !any && !settingMatches('Pinned', query);
    }
  }

  private watchScroll(): void {
    this.observer?.disconnect();
    if (typeof IntersectionObserver === 'undefined') return;
    const links = new Map<string, HTMLAnchorElement>();
    for (const link of this.toc?.querySelectorAll<HTMLAnchorElement>('[data-toc]') ?? []) {
      if (link.dataset.toc) links.set(link.dataset.toc, link);
    }
    this.observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const id = (visible.target as HTMLElement).id;
        for (const [key, link] of links) link.classList.toggle('is-active', key === id);
      },
      { root: this.root, rootMargin: '-20% 0px -70% 0px', threshold: [0.1, 0.4] },
    );
    if (this.pinned) this.observer.observe(this.pinned);
    for (const section of this.sections) this.observer.observe(section.el);
  }
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}

export { EMPTY as emptySettings };
