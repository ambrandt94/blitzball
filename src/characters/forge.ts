import * as THREE from 'three';
import type { Body, CFRuntime, Recipe } from './cfRuntime';
import { isOutfitId, type OutfitId } from './outfits';

const OUTFIT_PIECES: Record<OutfitId, [slot: string, id: string][]> = {
  onepiece: [['torso_inner', 'blitzball/onepiece']],
  trunks: [['smallclothes', 'blitzball/trunks']],
  boardshorts: [['legs', 'blitzball/boardshorts']],
  boardshorts_asym: [
    ['smallclothes', 'blitzball/trunks'],
    ['legs', 'blitzball/boardshorts_asym'],
  ],
};

/** Older saved names, with or without the project prefix, become the current outfit id. */
export function outfitFromSaved(value: string): OutfitId | null {
  const bare = value.replace(/^blitzball\//, '');
  if (isOutfitId(bare)) return bare;
  return null;
}

export function piecesForOutfit(outfit: OutfitId): [slot: string, id: string][] {
  return OUTFIT_PIECES[outfit];
}

export function recipeForOutfit(cf: CFRuntime, outfit: OutfitId, teamHex: string): Recipe {
  let recipe = cf.normalize(cf.blankRecipe('human'));
  for (const [slot, id] of OUTFIT_PIECES[outfit]) {
    recipe = cf.equip(recipe, slot, id).recipe;
    recipe = cf.dye(recipe, id, 'team', teamHex).recipe;
  }
  return recipe;
}

let runtime: CFRuntime | null = null;

export function forgeRuntime(): CFRuntime | null {
  return runtime;
}

/** Load the vendored 2.2.0 runtime and the Blitzball kit. Assets resolve from the manifest URL. */
export async function initForge(): Promise<CFRuntime> {
  if (runtime) return runtime;
  const base = new URL(`${import.meta.env.BASE_URL}cf/2.2.0/`, window.location.href);
  const kit = new URL(`${import.meta.env.BASE_URL}cf/kits/blitzball/blitzball.cfkit.json`, window.location.href);
  const mod = (await import(/* @vite-ignore */ new URL('cf-runtime.mjs', base).href)) as { default: CFRuntime };
  const cf = mod.default;
  await cf.init({ THREE, baseUrl: base.href });
  await cf.loadKit(kit.href);
  runtime = cf;
  return cf;
}

export async function buildOutfit(cf: CFRuntime, outfit: OutfitId, teamHex: string): Promise<Body> {
  return cf.build(recipeForOutfit(cf, outfit, teamHex));
}

export async function repaintTeam(cf: CFRuntime, body: Body, recipe: Recipe, outfit: OutfitId, teamHex: string): Promise<Recipe> {
  let next = recipe;
  for (const [, id] of OUTFIT_PIECES[outfit]) next = cf.dye(next, id, 'team', teamHex).recipe;
  await body.setRecipe(next);
  return next;
}
