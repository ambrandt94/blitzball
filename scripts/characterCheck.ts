/**
 * Character Forge runtime 2.2.0 wardrobe. Run with:
 *   npx vite-node scripts/characterCheck.ts
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import CF from '../public/cf/2.2.0/cf-runtime.mjs';
import { outfitFromSaved, piecesForOutfit, recipeForOutfit } from '../src/characters/forge';
import { parseCharacterSettings } from '../src/ui/characterSettings';

function fail(message: string): never {
  throw new Error(message);
}

const manifest = JSON.parse(readFileSync('public/cf/kits/blitzball/blitzball.cfkit.json', 'utf8')) as {
  format: string;
  namespace: string;
  garments: Record<string, { hides?: string[]; dye?: { region: string; kind: string }[] }>;
  clips: Record<string, { file: string }>;
};
if (manifest.format !== 'cf-kit/1') fail(`kit format ${manifest.format}`);
if (manifest.namespace !== 'blitzball') fail('kit namespace');
for (const id of ['trunks', 'onepiece', 'boardshorts', 'boardshorts_asym']) {
  if (!manifest.garments[id]) fail(`missing garment ${id}`);
}
if (!manifest.clips.Swim || !manifest.clips.Tread) fail('kit clips');
if (!manifest.garments.boardshorts_asym?.hides?.includes('trunks:leg_L')) fail('asym hide');
if (manifest.garments.trunks?.dye?.[0]?.kind !== 'tint') fail('tint dye');

const runtime = CF as {
  init(o: { THREE: typeof THREE; baseUrl: string }): Promise<unknown>;
  loadKit(src: object, o?: { baseUrl?: string }): Promise<{ namespace: string; garments: string[]; clips: string[] }>;
  blankRecipe(race?: string): object;
  normalize(r: object): { outfit: Record<string, { id: string }>; dye: Record<string, Record<string, string>> };
  equip(r: object, slot: string, id: string): { recipe: { outfit: Record<string, { id: string }>; dye: Record<string, Record<string, string>> } };
  dye(r: object, id: string, region: string, value: string): { recipe: { outfit: Record<string, { id: string }>; dye: Record<string, Record<string, string>> } };
};

await runtime.init({ THREE, baseUrl: new URL('../public/cf/2.2.0/', import.meta.url).href });
const loaded = await runtime.loadKit(manifest, {
  baseUrl: new URL('../public/cf/kits/blitzball/', import.meta.url).href,
});
if (!loaded.garments.includes('blitzball/boardshorts')) fail(`garments ${loaded.garments.join(',')}`);
if (!loaded.clips.includes('Swim') || !loaded.clips.includes('Tread')) fail(`clips ${loaded.clips.join(',')}`);

const cf = runtime as unknown as Parameters<typeof recipeForOutfit>[0];
const board = recipeForOutfit(cf, 'boardshorts', '#1c6fe0');
if (board.outfit.legs?.id !== 'blitzball/boardshorts') fail('board shorts were not equipped');
if (board.dye['blitzball/boardshorts']?.team?.toLowerCase() !== '#1c6fe0') fail('team dye missing');
const asym = recipeForOutfit(cf, 'boardshorts_asym', '#f2642a');
if (asym.outfit.smallclothes?.id !== 'blitzball/trunks' || asym.outfit.legs?.id !== 'blitzball/boardshorts_asym') {
  fail('asymmetric shorts were not worn over trunks');
}
if (piecesForOutfit('onepiece')[0]?.[1] !== 'blitzball/onepiece') fail('one-piece id');

if (outfitFromSaved('blitzball/trunks') !== 'trunks') fail('prefixed save did not map');
if (outfitFromSaved('onepiece') !== 'onepiece') fail('old save did not map');
const saved = parseCharacterSettings('{"human":"blitzball/boardshorts","team":["trunks","boardshorts_asym"]}');
if (!saved || saved.human !== 'boardshorts' || saved.team[1] !== 'boardshorts_asym') fail('settings parse');
if (parseCharacterSettings('{"human":"cape","team":["trunks","trunks"]}') !== null) fail('unknown outfit parsed');

console.log('character checks passed');
