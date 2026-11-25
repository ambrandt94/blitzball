# character-kit

A small wardrobe for humanoid characters that share one skeleton. The game registers races, slots, and a `wardrobe.json` manifest. Nothing about a particular sport or setting is built in.

`three` is a peer dependency (r150 or newer). This package does not ship a build step; import `character-kit` from TypeScript.

## What you register

Bands run low to high, matching Character Forge `runtime_v2`: `under < base < mid < armor < outer`. A higher band wins when two pieces cannot be worn together.

```ts
import { createCharacterKit, loadCharacter, installTeamTint } from 'character-kit';
import type { WardrobeManifest } from 'character-kit';

const kit = createCharacterKit();
kit.registerRace({ id: 'human', label: 'Human' });
kit.setBands(['under', 'base', 'mid', 'armor', 'outer']);
kit.registerWardrobe(manifest as WardrobeManifest);

kit.registerOutfit({
  id: 'jacket',
  label: 'Jacket',
  race: 'human',
  slots: { torso: 'jacket' },
});
```

`registerWardrobe` reads `base`, `slots`, `garments`, and `looks` from the Character Forge document (`hides`, `displaces` / `incompatibilities`, `wornOver`, tint masks, prebaked files).

## Loading

`loadCharacter(kit, loadout, assetRoot, { preferBaked: true })` uses a prebaked GLB when one matches the worn set, and otherwise binds each garment to the base skeleton by bone name and applies hides.

```ts
const loadout = kit.loadoutFromOutfit('jacket', { jacket: '#3355aa' });
const character = await loadCharacter(kit, loadout, '/characters/', { preferBaked: true });
scene.add(character.scene);
```

Team tint is `mix(texture, texture * color, mask)` on materials named `TeamTint` and `TeamTint_under`. White in the mask takes the color, black keeps the trim. Pass `{ invertMask: true }` when a pack stores the cloth as black instead. Give each garment its own hex in `loadout.colors`.

```ts
installTeamTint(material, loadout.colors[garmentId] ?? teamColor, maskTexture);
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
