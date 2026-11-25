/**
 * Wardrobe resolution and garment binding. Run with:
 *   npx vite-node scripts/characterCheck.ts
 */
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { applyHidePlan, attachGarment } from '../packages/character-kit/src/index.ts';
import { createBlitzballKit, type OutfitId } from '../src/characters/blitzball';
import type { WardrobeManifest } from '../packages/character-kit/src/index.ts';
import { parseCharacterSettings } from '../src/ui/characterSettings';

function fail(message: string): never {
  throw new Error(message);
}

const manifest = JSON.parse(readFileSync('public/characters/wardrobe.json', 'utf8')) as WardrobeManifest;
const kit = createBlitzballKit(manifest);

const expectHidden: Record<OutfitId, { worn: string[]; visible: string[]; body: string[]; part?: string }> = {
  onepiece: { worn: ['onepiece'], visible: ['onepiece'], body: ['Body_pelvis', 'Body_torso'] },
  trunks: { worn: ['trunks'], visible: ['trunks'], body: ['Body_pelvis'] },
  boardshorts: {
    worn: ['trunks', 'boardshorts'],
    visible: ['boardshorts'],
    body: ['Body_pelvis', 'Body_thigh_L', 'Body_thigh_R'],
  },
  boardshorts_asym: {
    worn: ['trunks', 'boardshorts_asym'],
    visible: ['trunks', 'boardshorts_asym'],
    body: ['Body_pelvis', 'Body_thigh_L'],
    part: 'Garment_trunks_leg_L',
  },
};

for (const [id, expect] of Object.entries(expectHidden) as [OutfitId, (typeof expectHidden)[OutfitId]][]) {
  const plan = kit.resolve(kit.loadoutFromOutfit(id));
  const worn = [...plan.worn].sort().join(',');
  const wantWorn = [...expect.worn].sort().join(',');
  if (worn !== wantWorn) fail(`${id} wore ${worn}`);
  const visible = [...plan.visible].sort().join(',');
  const wantVisible = [...expect.visible].sort().join(',');
  if (visible !== wantVisible) fail(`${id} showed ${visible}`);
  for (const node of expect.body) {
    if (!plan.hiddenBodyNodes.includes(node)) fail(`${id} left ${node} visible`);
  }
  if (!plan.bakedFile) fail(`${id} had no baked look`);
  if (expect.part && !plan.hiddenGarmentNodes.some((item) => item.nodeName === expect.part)) {
    fail(`${id} did not hide ${expect.part}`);
  }
}

const both = kit.loadoutFromOutfit('boardshorts');
both.slots.legs = 'boardshorts';
both.slots.torso_inner = 'onepiece';
const mixed = kit.resolve(both);
if (mixed.visible.includes('trunks')) fail('one-piece left the trunks on');
if (!mixed.hiddenBodyNodes.includes('Body_torso')) fail('one-piece left the torso skin on');

const round = kit.parse(kit.serialize(kit.loadoutFromOutfit('boardshorts_asym', { trunks: '#112233' })));
if (!round || round.outfit !== 'boardshorts_asym' || round.colors.trunks !== '#112233') {
  fail('loadout did not round-trip');
}
if (kit.parse('{') !== null) fail('broken loadout parsed');
if (parseCharacterSettings('{"human":"trunks","team":["onepiece","boardshorts_asym"]}')?.human !== 'trunks') {
  fail('character settings did not parse');
}
if (parseCharacterSettings('{"human":"cape","team":["trunks","trunks"]}') !== null) fail('unknown outfit parsed');

(globalThis as { self?: typeof globalThis }).self = globalThis;
const loader = new GLTFLoader();
async function parse(file: string) {
  const buf = readFileSync(file);
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return loader.parseAsync(bytes, '');
}

const base = await parse('public/characters/swimmer_base.glb');
const garment = await parse('public/characters/garment_trunks.glb');
const meshes = attachGarment(base, garment);
if (meshes.length !== 3) fail(`trunks attached ${meshes.length} meshes`);
const hand = base.scene.getObjectByName('Hand_R');
const bound = meshes[0]?.skeleton.bones.find((bone) => bone.name === 'Hand_R');
if (!hand || bound !== hand) fail('garment did not bind to the base hand');
const asym = kit.resolve(kit.loadoutFromOutfit('boardshorts_asym'));
applyHidePlan(base.scene, { trunks: meshes }, asym, kit.baseSegments());
const hidden = meshes
  .filter((mesh) => !mesh.visible)
  .map((mesh) => mesh.name)
  .sort();
if (hidden.join(',') !== 'Garment_trunks_leg_L,Garment_trunks_upper') {
  fail(`asymmetric shorts hid ${hidden.join(',') || 'nothing'}`);
}
const pelvis = base.scene.getObjectByName('Body_pelvis');
const thighR = base.scene.getObjectByName('Body_thigh_R');
if (!pelvis || pelvis.visible) fail('asymmetric shorts left the pelvis skin on');
if (!thighR?.visible) fail('asymmetric shorts hid the bare right thigh');

console.log('character checks passed');
