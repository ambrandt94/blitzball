# Blitzball stadium kit (Model Forge), v1, 2026-11-24

Modular GLB kit for the Blitzball arena. Y-up, metres, one GLB per piece, shared external textures.
Style is Trailbound: smooth low/low-mid poly, pixel tiles, nearest filtering, metallic 0, roughness 0.85.
Reference: `/workspace/uploads/blitzball-stadium-ref.png`. Preview: `renders/stadium_preview.png`.

## Texel density: 32 texels/m on every surface
Trailbound Artist's README wasn't in `../textures/` at build time. Their texture sources set `TEXELS_PER_M = 32`
(`../textures/_src/common.py`, "128 px = 4 m"), so every UV here is 32 px/m and their tiles are used where they exist.
When their README lands, change `PXM` and/or `TEXPATH` in `src/build_kit.py` and re-run (about 1 s).

## Files
| file | KB | tris | nodes |
|---|---|---|---|
| stands_tier.glb | 97 | 1536 | `stands_tier` + 32 empties `row_00..row_31` |
| crystal_pillar.glb | 29 | 322 + 24 | `crystal_pillar` > child `crystal_tip` (emissive) |
| wall_battlement.glb | 37 | 518 | `wall_battlement` |
| wall_battlement_gate.glb | 38 | 524 | `wall_battlement_gate` (6 m-radius arched gate, timber doors) |
| outer_corner_tower.glb | 40 | 619 + 64 | `outer_corner_tower` > child `flag` (8x4 grid, sways) |
| banner.glb | 5 | 72 + 12 | `banner` (4x9 grid, swallowtail, double-sided) > child `banner_rod` |
| pool_basin.glb | 76 | 1582 | `pool_basin` (water disc, basin wall, rim, arena floor to r 110.6) |

Kit total: 0.33 MB of GLB plus 0.02 MB of textures, about 0.35 MB. The full assembled ring (layout below) is about 59.8k tris.
`stands_rows.json` lists the row data. `ball.glb` in this folder belongs to a separate job and isn't part of this kit.

**Textures are external URIs, not embedded.** Serve `models/` and `textures/` (the sibling folder) with this layout unchanged.
three.js GLTFLoader resolves the URIs relative to each GLB. The tiles are NPOT (96/48/144 px etc.), which is fine on WebGL2.
Samplers are mag NEAREST, min NEAREST_MIPMAP_NEAREST, wrap REPEAT.

## Pivots and placement (one formula for every piece)
Pivot convention: ring pieces (`stands_tier`, `wall_battlement*`) pivot at the ring centre (world origin) and are centred on +X, spanning +-7.5 deg.
Every other piece pivots at its base centre (banner: top centre of the cloth).

Polar placement in three.js (φ in radians):
```js
obj.position.set(r*Math.cos(φ), h, -r*Math.sin(φ));
obj.rotation.y = φ;            // ring pieces: r = 0, h = 0, rotation only
```
| piece | count | r (m) | φ (deg) | h (m) | notes |
|---|---|---|---|---|---|
| stands_tier | 24 | 0 | 15·k, k=0..23 | 0 | tiles a full ring |
| wall_battlement | 20 | 0 | 15·k, k mod 6 ≠ 0 | 0 | outer facade, inner face r 190, outer r 194 |
| wall_battlement_gate | 4 | 0 | 0, 90, 180, 270 | 0 | gate faces outward |
| outer_corner_tower | 8 | 192 | 90·m ± 7.5 | 0 | flanks each gate on wall joints. Local +X (door) faces out |
| crystal_pillar | 4 | 88 | 45 + 90·m | 0 | 20 m clear of the 68 m sphere |
| banner | 24 | 189.7 | 15·k | 75 | hangs on the wall's inner face. Cloth front faces the arena (local −X) |
| pool_basin | 1 | 0 | 0 | 0 | |
| water sphere (yours) | 1 | 0 | – | 70 | radius 68 (bottom at y = 2) |

## Sizes
- **stands_tier**: radial 110 → 190.3, height 0 → 56. Arcaded podium at r 110 (y 0–7.2).
  - 4 tiers. Tier t starts at r₀ = 110 + 20t with seat base y_b = 6 + 14t.
  - Each tier: 0.6 m parapet with brass cap, then 8 bench rows (2 m tread, 1 m riser), then a 4 m walkway at y_b + 8.
  - The next tier's 6 m arcade wall (3 arched niches per wedge) rises from that walkway.
  - The back is closed at r 190.3.
- **crystal_pillar**: octagonal. Base Ø 21 m (stepped plinth), shaft Ø about 11.7 → 10.8 m, brass bands at y 3, 30 and 58.
  - Crown top is at y 65.5. Glowing rune panels run on the 4 axis faces.
  - `crystal_tip` node sits at y 64.5. It is a hex bipyramid, Ø 5.6 m, 12.5 m tall, reaching y 77.
  - Spin or bob the crystal tip node on its own.
- **wall_battlement**: 15° arc, r 190–194.3, y 0–81.
  - Two storeys of blind arches on the outside, a brass string course at y 62, and the wall walk at y 76.
  - 11 merlons on top.
  - Gate variant: the middle bay is a 12 m wide, 20 m tall arch, 3.5 m deep, with timber doors.
- **outer_corner_tower**: 14 m square body to y 86, with arrow-slit windows and a door on +X.
  - Corbel band with brass, red pyramid roof y 90–104, pole to y 115.
  - `flag` node at (0, 114.5, −0.35). The flag hangs from it and extends 6 m along local −Z, 3 m down.
- **banner**: 4.5 × 13.5 m cloth, origin at the top centre, cloth spans local z ±2.25.
- **pool_basin**: water surface disc r 62 at y −0.6, basin wall up to y 1.0, rim r 62–64.5, brass band on the rim's outer face.
  - Arena floor at y 0 from r 64.5 to 110.6 (it runs under the podium), with a dark inlay ring at r 75–77.

## Crowd row empties (stands_tier)
Empty nodes `row_00..row_31` sit at each row's mid-arc seat-surface point (φ = 0 inside the wedge): glTF (x = radius, y = height, z = 0).
Rotate them with the wedge. The row arc runs ±7.5°, so a row's arc length is radius × 0.2618.
Rows 00–07 are tier 0, 08–15 tier 1, 16–23 tier 2, 24–31 tier 3. Usable tread depth is 2 m (row 0 of each tier: 1.4 m).

| tier | rows | radius (m) | height (m) |
|---|---|---|---|
| 0 | 00–07 | 111.3, 113, 115, 117, 119, 121, 123, 125 | 6, 7, 8, 9, 10, 11, 12, 13 |
| 1 | 08–15 | 131.3, 133, … 145 (+2 per row) | 20 … 27 |
| 2 | 16–23 | 151.3, 153, … 165 | 34 … 41 |
| 3 | 24–31 | 171.3, 173, … 185 | 48 … 55 |

## Materials → tiles
To retexture, replace the PNG in place with the same size or any size at 32 px/m. Changing the size needs a re-run of `src/build_kit.py`, because UVs are in metres.

| material | tile (path relative to models/) | px | metres per repeat | owner |
|---|---|---|---|---|
| stone_wall | ../textures/materials/stone_sandstone_wall_128.png | 128 | 4×4 | Artist |
| stone_tower | ../textures/materials/stone_tower_128.png | 128 | 4×4 | Artist |
| stone_floor | ../textures/materials/stone_flagstone_floor_128.png | 128 | 4×4 | Artist |
| trim_gold | ../textures/materials/trim_brass_band_128x16.png | 128×16 | 4×0.5 | Artist |
| wood | ../textures/materials/wood_timber_planks_128.png | 128 | 4×4 | Artist |
| water_basin | ../textures/materials/tile_pool_basin_128.png | 128 | 4×4 | Artist |
| crystal_emissive | ../textures/crystal/crystal_facets_64.png | 64 | 2×2 | Artist (emissive = base) |
| stone_wall_dark | textures/stone_wall_dark.png | 96 | 3×3 | placeholder (niche/arch backs) |
| roof_tile | textures/roof_tile.png | 48 | 1.5×1.5 | placeholder |
| rune_glow | textures/rune_panel.png | 48×144 | 1.5×4.5, repeats vertically | placeholder (emissive 0.85) |
| banner_cloth | textures/banner_cloth.png | 144×432 | 4.5×13.5 decal | placeholder |
| flag_cloth | textures/flag_cloth.png | 192×96 | 6×3 decal | placeholder |

## Build / checks
- `python3 src/paint_tiles.py`: writes the placeholder tiles. `python3 src/tile_qa.py`: 0 isolated pixels, 0 near-black, 0 checker dither.
  - Unused placeholders are kept in `_work/unused_placeholders/`.
- `blender -b --factory-startup -P src/build_kit.py`: builds all GLBs and `stands_rows.json`.
- gltf-validator (`node src/gv_ext.js *.glb`, NODE_PATH=/workspace/scratch/gv/node_modules): 0 errors, 0 warnings on all 7 GLBs.
  - Infos are URI_GLB (external textures) and IMAGE_NPOT_DIMENSIONS.
- `python3 src/check_refs.py`: PASS. It checks that image URIs resolve, the material set and PBR values, child nodes, the 32 row empties against `stands_rows.json`, and identity roots.
- `blender -b --factory-startup -P src/render_preview.py`: assembles the ring with the table above and renders `renders/stadium_preview.png`.
