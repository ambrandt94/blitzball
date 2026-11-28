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

const HAIR_IDS: Record<string, string> = { ponytail: 'ponytail_high' };

/** Older saves used a short name. The runtime style is ponytail_high. */
export function hairStyleId(id: string): string {
  return HAIR_IDS[id] ?? id;
}

/** Human look from the splash flow: skin, hair, and a team-tinted kit piece. */
export function recipeForLook(
  cf: CFRuntime,
  look: { outfit: OutfitId; teamColor: string; tone: number; hair: string; hairColor: string },
): Recipe {
  let recipe = cf.normalize(cf.blankRecipe('human'));
  const patch = { tone: look.tone, hair: hairStyleId(look.hair), hairColor: look.hairColor };
  try {
    recipe = cf.edit(recipe, patch);
  } catch {
    // One bad field must not drop the others. The suit still equips after this.
    for (const [key, value] of Object.entries(patch)) {
      try {
        recipe = cf.edit(recipe, { [key]: value });
      } catch {
        // Leave that field at the blank human default.
      }
    }
  }
  for (const [slot, id] of OUTFIT_PIECES[look.outfit]) {
    recipe = cf.equip(recipe, slot, id).recipe;
    recipe = cf.dye(recipe, id, 'team', look.teamColor).recipe;
  }
  return recipe;
}

let runtime: CFRuntime | null = null;
let starting: Promise<CFRuntime> | null = null;

export function forgeRuntime(): CFRuntime | null {
  return runtime;
}

/** Load the vendored 2.6.0 runtime and the Blitzball kit. Assets resolve from the manifest URL. */
export function initForge(): Promise<CFRuntime> {
  if (runtime) return Promise.resolve(runtime);
  if (starting) return starting;
  starting = (async () => {
    const base = new URL(`${import.meta.env.BASE_URL}cf/2.6.0/`, window.location.href);
    const kit = new URL(`${import.meta.env.BASE_URL}cf/kits/blitzball/blitzball.cfkit.json`, window.location.href);
    const mod = (await import(/* @vite-ignore */ new URL('cf-runtime.mjs', base).href)) as { default: CFRuntime };
    const cf = mod.default;
    await cf.init({ THREE, baseUrl: base.href });
    await cf.loadKit(kit.href);
    runtime = cf;
    return cf;
  })();
  return starting;
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
