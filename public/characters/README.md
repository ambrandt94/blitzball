# Blitzball swimwear (Character Forge v2 human, default adult build)

Modular: one base body plus garments skinned to the **identical** 29-bone skeleton (same joint order, rest pose and inverse bind matrices in every file).
Bind a garment to the base skeleton by bone name. Baked full characters are also included as a convenience.

- Scale: metres, feet at y=0, +Y up, **+Z forward**, height 0.9463 m. Root bone `Root` (child of node `Armature`).
- Hands `Hand_L` / `Hand_R`; spine `Hips > Spine > Chest > Neck > Head`; root chain `Root > Trans > Hips`.
- Clips (in `swimmer_base.glb` and every `swimmer_*.glb`): `Idle` 2.0417 s, `Swim` 1.2 s, `Tread` 1.6 s. All loop.
  `Swim` lies prone along +Z (head toward +Z, face down, pivot at `Trans`); `Tread` is upright (eggbeater legs, sculling arms).
- Textures: 256 px PNG, NEAREST filtering, embedded in the GLBs and also provided as files here.

## Files
`swimmer_base.glb`: body split into segment nodes `Body_rest`, `Body_pelvis`, `Body_torso`, `Body_thigh_L`, `Body_thigh_R`, plus `Hair`. Materials `Skin`, `Hair`. Bare skin under every garment (no underwear painted on). Waistlines (2026-11-25 rev): trunks top y=0.396 m, board shorts top y=0.402 m (about navel height); `Body_pelvis` covers y 0.272-0.385, `Body_torso` y 0.391-0.430.

| garment | slot (band, layer) | file | nodes | texture / tint mask | hides | tris |
|---|---|---|---|---|---|---|
| `trunks` | smallclothes (under, layer 0) | `garment_trunks.glb` | `Garment_trunks_leg_L`, `Garment_trunks_leg_R`, `Garment_trunks_upper` | `trunks_tex.png` / `trunks_tintmask.png` | `body:pelvis` | 534 |
| `onepiece` | torso_inner (base, layer 1) | `garment_onepiece.glb` | `Garment_onepiece` | `onepiece_tex.png` / `onepiece_tintmask.png` | `body:pelvis`, `body:torso`, `trunks` | 999 |
| `boardshorts` | legs (base, layer 1) | `garment_boardshorts.glb` | `Garment_boardshorts` | `boardshorts_tex.png` / `boardshorts_tintmask.png` | `body:pelvis`, `body:thigh_L`, `body:thigh_R`, `trunks` | 512 |
| `boardshorts_asym` | legs (base, layer 1) | `garment_boardshorts_asym.glb` | `Garment_boardshorts_asym` | `boardshorts_asym_tex.png` / `boardshorts_asym_tintmask.png` | `body:pelvis`, `body:thigh_L`, `trunks:upper`, `trunks:leg_L` | 468 |

Baked looks (one Body mesh with hidden segments removed, plus garments):

| file | garments | materials | tris |
|---|---|---|---|
| `swimmer_onepiece.glb` | onepiece | Skin, Hair, TeamTint | 3895 |
| `swimmer_trunks.glb` | trunks | Skin, Hair, TeamTint | 3612 |
| `swimmer_boardshorts.glb` | boardshorts | Skin, Hair, TeamTint | 3382 |
| `swimmer_boardshorts_asym.glb` | trunks + boardshorts_asym | Skin, Hair, TeamTint_under, TeamTint | 3550 |

## Hides (same convention as Character Forge runtime_v2 `hides` / `hiddenBy` / `displaces`)
- `body:<segment>`: hide the base node `Body_<segment>` (it sits fully under the garment, at least 1 cm inside its edges).
- `<garmentId>`: do not show that garment (for example `boardshorts` hides `trunks`).
- `<garmentId>:<segment>`: hide one segment node of that garment. `boardshorts_asym` hides `trunks:upper` and `trunks:leg_L`, so only the right leg band of the under-trunks shows beneath the short right hem.
- `displaces`: garments in the same slot that cannot be worn together. The bands are `under < base < mid < armor < outer`.

## Team tint
Each garment has its own `TeamTint` material: a neutral light-grey texture with a white base colour. `material.color.set(teamColour)` tints it, and the darker trims read as a darker shade.
In the baked asymmetric look, the under-trunks use `TeamTint_under` and the shorts use `TeamTint`.
Optional mask `<id>_tintmask.png` (same UVs; white = tint, black = keep trim): `col = mix(tex, tex * team, mask)`.

## three.js (r150+)
```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { attachGarment, applyHides } from './swimwear.mjs';
const loader = new GLTFLoader();
const man = await (await fetch('wardrobe.json')).json();
const base = await loader.loadAsync('swimmer_base.glb');
const worn = {};
for (const id of ['trunks', 'boardshorts_asym']) worn[id] = attachGarment(base, await loader.loadAsync(man.garments[id].file));
applyHides(base, worn, man);
worn.boardshorts_asym[0].material.color.set('#2a6cff');
scene.add(base.scene);
const mixer = new THREE.AnimationMixer(base.scene);
mixer.clipAction(base.animations.find(c => c.name === 'Swim')).play();
```
`attachGarment` moves the garment's SkinnedMeshes into the base scene and rebinds them to the base bones by name (`new THREE.Skeleton(bones, boneInverses)` + `mesh.bind`).
Each worn garment adds one draw call; trunks adds three (one per segment node).
