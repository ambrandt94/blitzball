import type * as THREE from 'three';

/** The slice of Character Forge runtime 2.2.0 this game calls. */
export interface Recipe {
  race: string;
  outfit: Record<string, { id: string; variant?: string }>;
  dye: Record<string, Record<string, string>>;
  kits?: { namespace: string; version: string | null }[];
  [key: string]: unknown;
}

export interface WardrobeResult {
  recipe: Recipe;
}

export interface Body {
  object3D: THREE.Group;
  mixer: THREE.AnimationMixer;
  readonly clips: Record<string, THREE.AnimationClip>;
  socket(name: string): THREE.Object3D | null;
  setRecipe(next: Recipe): Promise<{ path: string }>;
  dispose(): void;
}

export interface CFRuntime {
  readonly version: string;
  init(options: { THREE: typeof THREE; baseUrl?: string }): Promise<unknown>;
  loadKit(src: string): Promise<unknown>;
  blankRecipe(race?: string): Recipe;
  normalize(recipe: object): Recipe;
  equip(recipe: Recipe, slot: string, garmentId: string): WardrobeResult;
  dye(recipe: Recipe, garmentId: string, region: string, value?: string): WardrobeResult;
  edit(recipe: Recipe, patch: Record<string, unknown>): WardrobeResult;
  build(recipe: Recipe): Promise<Body>;
}
