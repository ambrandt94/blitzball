# Blitzball arena texture pack (Trailbound style)

Hand-pixelled with Python/PIL scripts in `_src/` (rebuild everything with `_src/build_all.sh`). There is no AI image output in any final pixel. Every design is original Trailbound art: no Final Fantasy characters, logos, crests or symbols. The team crests are simple frontier emblems: a wagon wheel for Team A and a crescent over waves for Team B.

## TEXEL DENSITY: **32 texels per metre** (official)

- 1 m = 32 px, so a 128 px tile covers 4 m and a 16 px course is 0.5 m. This matches the Trailbound character / hero density (GDD: 32 tx/m for hero assets). The GDD's 24 tx/m building figure is not used here, because Alex asked for one consistent density matching the characters.
- Model Forge has already UV'd the stadium kit at 32 tx/m. Keep the tile filenames and sizes below stable, because they are used in place.
- Filtering: `magFilter = NearestFilter`. For distant stands use `minFilter = NearestMipmapNearestFilter` (or `NearestFilter`), keep `generateMipmaps` on to stop shimmer, set `anisotropy = 1` and `colorSpace = SRGBColorSpace`. Never use linear filtering.
- Exceptions:
  - The sky is a backdrop, so density doesn't apply.
  - The ball is a hero prop at ~116 tx/m on Model Forge's 0.35 m mesh. At 32 tx/m the lettering would not read.

### Model Forge material → file (stable names, used in place)

| Model Forge material | File | Size | Covers |
|---|---|---|---|
| stone_wall | `materials/stone_sandstone_wall_128.png` | 128×128 | 4×4 m |
| stone_tower | `materials/stone_tower_128.png` | 128×128 | 4×4 m |
| stone_floor | `materials/stone_flagstone_floor_128.png` | 128×128 | 4×4 m |
| trim_gold | `materials/trim_brass_band_128x16.png` | 128×16 | 4×0.5 m |
| wood | `materials/wood_timber_planks_128.png` | 128×128 | 4×4 m |
| water_basin | `materials/tile_pool_basin_128.png` | 128×128 | 4×4 m |
| crystal_emissive | `crystal/crystal_facets_64.png` | 64×64 | 2×2 m |
| stone_wall_dark | `../models/textures/stone_wall_dark.png` | 96×96 | 3×3 m |
| roof_tile | `../models/textures/roof_tile.png` | 48×48 | 1.5×1.5 m |
| rune_panel | `../models/textures/rune_panel.png` | 48×144 | 1.5×4.5 m |
| banner_cloth | `../models/textures/banner_cloth.png` | 144×432 | 4.5×13.5 m |
| flag_cloth | `../models/textures/flag_cloth.png` | 192×96 | 6×3 m |

The five `models/textures/` files fill Model Forge's fixed-size placeholders. The originals are kept as `*.placeholder.png`. They are **not power-of-two on purpose**: their sizes match the mesh at 32 px/m. They are opaque RGB.
- `stone_wall_dark` is a seamless, darker sandstone for arch backs and niches.
- `roof_tile` is seamless red clay barrel tiles.
- `rune_panel` repeats vertically, with three original glowing aqua runes and brass collars every 1.5 m.
- `banner_cloth` is one image for the whole banner: a Team A red banner with a brass border, a water-sphere roundel, an aqua rune column and brass chevrons.
- `flag_cloth` is an original flag: a teal field, a cream wave band, and a red hoist chevron with a brass star. The hoist is on the left.

Extra tiles (also 32 tx/m), not yet mapped by Model Forge:
- `materials/stone_limestone_tier_128x32.png`: a stand step. Rows 0–15 are the tread top (0.5 m) and rows 16–31 are the riser front (0.5 m). Stacked vertically it gives consecutive tiers.
- `materials/stone_tower_brass_band_128.png`: tower stone with a 0.5 m brass ring at rows 56–71.
- `materials/trim_rune_inlay_128x32.png`: a sandstone frieze with aqua rune grooves. The crystal-ramp pixels can act as an emissive mask.

## Style rules
- Palette v2 (`/workspace/controller-assets/palette/trailbound_palette_v2.*`), with only three extra aqua tones:
  - `#2A9EAE` aqua_mid
  - `#5ED2DC` aqua_bright
  - `#BDF6F0` rim_glow
  - They're listed in `materials_palette.json` → `extra_tones_not_in_v2`.
- Materials use 3–5 hue-shifted tones each, with cool shadows, warm highlights and light from the top-left. Shading is clustered, with no dither. The one exception is water and glow, where a little 4×4 Bayer dither is used on band seams only.
- No `#000000` or `#FFFFFF`. The outline is `#4E2E34`, used only on sprite silhouettes (crowd, banners, ball previews), never on tiling textures.
- Sprites use alpha 0/255 only. All tiles tile seamlessly; `checks.json` has the numbers.

## Files

### crowd/
`crowd_atlas_256x128.png` plus `crowd_atlas.json`.
- **Grid:** 16 columns × 4 rows of **16×32 cells**. Each billboard is 0.5×1.0 m at 32 tx/m.
- **Pivot:** bottom-centre (x=8, y=31). Put the quad's bottom on the tread.
- **Layout:** spectator `s` (0–31) sits at `col = s % 16`, `row = (s // 16) * 2 + frame`.
  - Frame 0 is idle (seated).
  - Frame 1 is cheer: arms up, body lifted 2 px, mouth open, plus a pennant on 4 of them. It sits one row below idle.
- **Teams:**
  - Sprites 0–11 are **Team A** (rust red `dye_red`, brass trim).
  - Sprites 12–23 are **Team B** (teal `dye_teal`, cream trim).
  - Sprites 24–31 are **neutrals** (canvas, wool and leather).
  - `by_team` in the JSON lists the ids.
- **Variety:** 9 skin ramps (human pale–deep, elf, dwarf, halfling), 8 hair colours, 7 hair styles, hats (wide brim, knit cap, headscarf, headband), face paint and team scarves.
- **Animation:** swap the frame by adding a V offset of one row. Use a random phase per instance, about 2–4 Hz while cheering. In three.js with flipY, `v0 = 1 - (row+1)/4` (`uv_rect_flipY` is in the JSON).

### water/ (the most care went here)
- `water_caustics_256.png`: a seamless 8×8 m tile with a deep teal body (`#163A48` / `#1F6066` / `#2E8A84`) and a cyan caustic net in stepped bands (`#2A9EAE` → `#3EB8D8` → `#5ED2DC` → `#8CE6E8`). Bright knots are `#BDF6F0` / `#E8FFF6`. An ordered-dither fringe sits on the lines only.
- `water_caustics_anim_4f_1024x256.png`: 4 frames of 256 px, side by side, looping (frame 3 → 0). Each frame is seamless. Run at 6 fps: `offset.x = frame * 0.25`, `repeat.x = 0.25`.
- `caustics_light_overlay_4f_1024x256.png`: the same 4 frames, lines only, as an alpha cutout. Project it **additively** onto the basin, floor and lower stands (strength about 0.45).
- `water_shell_bands_256.png`: wavy stepped surface bands for the sphere shell. Scroll them slowly.
- `bubbles_64.png` plus `bubbles.json`: a 4×4 grid of 16 px cells.
  - Rows are 4, 6, 10 and 14 px bubbles.
  - Columns are round, wobble-wide, wobble-tall and pop.
  - Loop the wobble as [0,1,0,2] at about 6 fps. Play pop once, then despawn.
  - There's no outline, because bubbles aren't solid.
- `sphere_palette.json`: every shader colour, threshold and opacity (summarised below).

#### Shell shader notes (match `sphere_palette.json`)
- **Body:** posterize to the water ramp. Deep `#163A48` is for the far side and depth, mid `#1F6066`, base `#2E8A84`, teal-cyan `#2A9EAE` and cyan `#3EB8D8` toward the lit top-left. Never use a smooth blend.
- **Rim glow:** use `f = 1 - dot(N,V)`, then step it.

  | f ≥ | Colour | Bayer cover |
  |---|---|---|
  | 0.50 | `#3EB8D8` | 25% |
  | 0.58 | `#5ED2DC` | 50% |
  | 0.68 | `#8CE6E8` | solid |
  | 0.80 | `#BDF6F0` | solid (the bright edge) |

  Add an outer halo just outside the silhouette (about 3% of the radius) in `#5ED2DC` at 50% Bayer, then `#3EB8D8` at 25%.
- **Highlight:**
  - Spec dot thresholds: 0.975 → `#BDF6F0` and 0.993 → `#E8FFF6`, with light from the top-left (view-space `[-0.55, 0.6, 0.58]`).
  - A thin reflection arc on the lower-right (f 0.70–0.80) in `#E8FFF6`.
- **Inner fog (camera inside):** 3 hard steps by distance (6 / 14 / 26 m): `#2E8A84` → `#1F6066` → `#163A48`. Bayer goes only on the 2 px seam between steps.
  - Looking out, show the shell as a bright line (`#E8FFF6` then `#BDF6F0`) with a `#8CE6E8` dithered band inside. The stadium beyond is posterized to `#2A9EAE`–`#8CE6E8`.
  - God-rays are stepped diagonal bands, +1 tone, from the top-left.
- **Surface band:** `#2E8A84` base, `#3EB8D8` band and `#8CE6E8` crest.
- **Bubbles:** rim `#8CE6E8`, lit `#E8FFF6`, shade `#3EB8D8`.
- **Opacity:**
  - Shell centre 0.55, shell rim 0.95.
  - Rim glow additive 0.8.
  - Caustics: 0.35 on the interior, 0.45 additive on stone.
  - Inside fog max 0.85.
  - Quantize alpha to 0.25 steps, or use a Bayer cutout.
- Pixelate in screen space if you want texel-matched shading: compute the shading at `floor(gl_FragCoord.xy / 2.0)`.

```glsl
float f = 1.0 - clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
float b = bayer4(gl_FragCoord.xy);            // 0..1
vec3 c = uBody[int(clamp(depthStep, 0.0, 4.0))];
if (f > 0.50 && b < 0.25) c = cCyan;          // #3EB8D8
if (f > 0.58 && b < 0.50) c = cAquaBright;    // #5ED2DC
if (f > 0.68) c = cFoam;                      // #8CE6E8
if (f > 0.80) c = cRim;                       // #BDF6F0
```

Mockups (not to scale, read-check only):
- `previews/mock_water_outside_{1x,4x}.png`: the sphere seen from the stands.
- `previews/mock_water_inside_{1x,4x}.png`: underwater, looking out at the shell.

### materials/
See the table above. `materials_palette.json` lists every ramp by hex (dark → light), per material, with vertex-colour fallbacks for Model Forge.
- Sandstone blocks are 1×0.5 m in running bond.
- Tower stone uses bossed blocks.
- Flagstones are irregular and in cool cobble.
- Basin tiles are 0.5 m glazed teal, with a brass and cream mosaic band every 2 m.
- Timber planks are 0.25 m, with iron nails.

### banners/ (64×128 = 2×4 m hanging cutouts, power-of-two, outlined)
- `banner_team_a_crest_64x128.png`: red, with a brass wagon-wheel crest.
- `banner_team_b_crest_64x128.png`: teal, with a cream crescent over waves.
- `banner_arena_sphere_64x128.png`: cream, with an aqua sphere roundel and two pylons.
- `banner_crystal_navy_64x128.png`: navy, with an aqua crystal between brass bars.
- `banner_tricolour_star_64x128.png`: red, cream and teal stripes, with a brass eight-point star.

The large mesh banner is `../models/textures/banner_cloth.png`, at 144×432.

### crystal/
- `crystal_facets_64.png`: seamless faceted crystal, unlit or emissive (`crystal_emissive`).
- `crystal_glow_halo_64.png`: stepped glow-ring billboard with alpha cutout. Use additive blending.
- `crystal_ramp_8x1.png`: the ramp. Hexes: `#163A48 #1F6066 #2E8A84 #52B4A0 #5ED2DC #7FE6EE #BDF6F0 #E8FFF6`.

### sky/
`sky_backdrop_1024x256.png` tiles horizontally. It has a stepped gold-blue gradient (no smooth gradient, no dither) and chunky pixel clouds lit from the top-left with warm undersides.

### ball/
- `blitzball_ball_equirect_256x128.png`: the **main deliverable**. It's a 2:1 equirect that **assumes a standard equirect UV sphere** (three.js `SphereGeometry`): u is longitude with u=0.5 facing +Z, v=0 is the north pole and the image top is north.
  - It's an original design: a royal-blue band on a 24° tilted great circle, gold pinstripes, an asymmetric thin and soft-blue stripe pair, and brass star "valve" roundels at the band poles.
  - It has hand-pixelled slanted "BLITZBALL" lettering, front and back, with a gold top highlight and a navy drop shadow. Painted cup dimples are shaded per dimple (shadow upper-left inner wall, lit lower-right). The underside is stepped lavender.
  - `blitzball_ball_equirect_nodimples_256x128.png` is the same design without dimples, for a mesh that models its cups.
- `ball_modelforge_bandaligned_256x128.png`: a draft for Model Forge's in-progress ball (`/workspace/model-forge/blitzball_ball`). It uses their band-aligned UV: the colour axis is tilted 30°, the band sits on the UV equator, the logo is at uv (0.5, 0.5), v=0 is south (the lavender cap), and dimple shading is painted at their 14 cup UVs. Use 256×128, not 128×64, or the lettering won't read. **Pending their final UV layout.**
- `ball_atlas0_for_blitzball_glb_256x128.png`: a bake into the UV layout of the current `public/models/blitzball.glb` (PixMesh atlas0). It works as a drop-in `material.map` with `flipY=false`, and it has no painted dimples because that mesh has cup geometry.
- Previews: `ball_preview_{1x,4x}.png` (4 rotations, stepped lighting), `ball_equirect_preview_4x.png` and `ball_modelforge_preview_{1x,4x}.png`.
- The root files `ball_albedo.png` and `ball_uv_layout.png` belong to Model Forge and were left untouched.

### Sheets and checks
- `contact_sheet.png`: everything at 1–4×.
- `previews/mock_arena_composite_{1x,4x}.png`: crowd on limestone tiers, the sandstone wall, the tower with its brass band, banners, the flagstone deck and caustic water.
- `checks.json`: per file it records power-of-two, alpha binary, palette (v2 + 3 extras, no pure black or white), outline use, and seamless wrap. The seamless test checks that the wrap-edge step is no larger than the interior steps, or that the wrap lands on a joint. The `model_forge_fixed_size` section covers the five placeholders: size match, opaque, palette and seams.
