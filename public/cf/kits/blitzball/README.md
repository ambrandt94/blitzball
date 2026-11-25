# Blitzball swimwear kit (cf-kit/1, namespace `blitzball`, 1.0.0)
Built by Character Forge (runtime_v2/kitwork/build_kit.py) from the Blitzball swimwear in ../ (wardrobe.json, garment_*.glb, *_tex.png, *_tintmask.png, swimmer_base.glb clips).
All content is CF-authored: no third-party or licensed (KI) files.

- `blitzball.cfkit.json`: the manifest (superset of ../wardrobe.json).
- `garments/garment_*.glb`: skinned meshes (cf-humanoid-29, bound by bone name; images stripped, textures below).
- `textures/*_tex.png`, `textures/*_tintmask.png`: colour maps and team-tint masks (white = tinted).
- `clips/swim.json`, `clips/tread.json`: CF clip JSON (Swim, Tread), relative root motion; work on every race.

```js
import CF from '<cf>/2.2.0/cf-runtime.mjs';
await CF.init({ THREE, baseUrl: '<cf>/2.2.0/' });
await CF.loadKit('<this folder>/blitzball.cfkit.json');
let r = CF.normalize(CF.blankRecipe('human'));
r = CF.equip(r, 'legs', 'blitzball/boardshorts').recipe;
r = CF.dye(r, 'blitzball/boardshorts', 'team', '#1e5bd8').recipe;
const b = await CF.build(r); scene.add(b.object3D); b.play('Swim');
```
Garments: `blitzball/trunks` (smallclothes), `blitzball/onepiece` (torso_inner), `blitzball/boardshorts` (legs), `blitzball/boardshorts_asym` (legs, worn over trunks).
Every garment hides the painted smallclothes and the body it covers, auto-fits every race / body type / body slider, and has one tint region `team`.
