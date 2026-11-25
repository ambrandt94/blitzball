# character-kit

A small wardrobe for humanoid characters that share one skeleton. The game registers races, slots, and a `wardrobe.json` manifest. Nothing about a particular sport or setting is built in.

`three` is a peer dependency (r150 or newer). This package does not ship a build step; import `character-kit` from TypeScript.

## What you register

Bands run low to high: `under < base < mid < armor < outer`. A higher band wins when two pieces cannot be worn together. This follows the proposed cf-kit/1 shape and does not depend on a Forge runtime.

```ts
import { createCharacterKit, loadCharacter, installTeamTint } from 'character-kit';
import type { WardrobeManifest } from 'character-kit';

const kit = createCharacterKit();
kit.registerRace({ id: 'human', label: 'Human' });
kit.loadKit(manifest as WardrobeManifest, { project: 'demo' });
kit.registerSlot({ id: 'torso', band: 'outer', layer: 0 });
kit.registerGarment({
  id: 'demo/jacket',
  slot: 'torso',
  band: 'outer',
  layer: 0,
  label: 'Jacket',
  file: 'jacket.glb',
  material: 'TeamTint',
  hides: [],
  hiddenBy: [],
  displaces: [],
  incompatible: [],
  wornOver: [],
  nodes: ['Jacket'],
  segments: {},
});

const catalog = kit.registry();
```

`loadKit` reads `base`, `slots`, `garments`, and `looks` using the wardrobe.json names. Garment ids are stored as `project/name` (for example `blitzball/boardshorts`). Hide rules stay data-driven: `body:<segment>`, `<garment>`, and `<garment>:<segment>`. A document may say `displaces` or `incompatible`; both mean the pieces cannot be worn together.

## Loading

`loadCharacter(kit, loadout, assetRoot, { preferBaked: true })` uses a prebaked GLB when one matches the worn set, and otherwise binds each garment to the base skeleton by bone name and applies hides.

```ts
const loadout = kit.loadoutFromOutfit('jacket', { 'demo/jacket': '#3355aa' });
const character = await loadCharacter(kit, loadout, '/characters/', { preferBaked: true });
scene.add(character.scene);
```

Tint dye is the material color times the team color. An optional mask keeps fixed trims out of that multiply: white takes the dye, black keeps the trim. Pass `{ invertMask: true }` when a pack paints the cloth black instead. Set `material.color` to the piece dye before installing the tint. The team color is the second argument.

```ts
material.color.set(loadout.colors[garmentId] ?? '#ffffff');
installTeamTint(material, teamColor, maskTexture);
```

Textures are left on nearest filtering.

## Saving a loadout

```ts
const json = kit.serialize(loadout);
const again = kit.parse(json);
```

The document is `{ v: 1, race, outfit, slots, colors }`. Unknown garments are dropped. Store that string wherever the game keeps settings.

## Skeleton contract

Garments must use the same bone names, rest pose, and inverse bind matrices as the base file. Clips on the base (or on a prebaked look) keep working, including a `Hand_R` prop, because the skeleton is not replaced.
