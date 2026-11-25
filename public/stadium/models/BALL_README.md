# Blitzball ball

Hero ball for the Blitzball web game. Y-up, metres. This file is separate from the stadium kit in `README.md`.

## Size and pivot
- Diameter **0.35 m** (radius 0.175 m).
- Pivot at the **centre**. The node has no translation or rotation.
- Shallow cups make the AABB slightly short of 0.35 m on two axes; the uncut sphere still measures 0.35 m through the centre.

## Mesh
- File: `ball.glb` (about 66 KB, well under the 300 KB cap).
- 2,592 triangles, 1,298 vertices, smooth-shaded UV sphere (48 segments × 28 rings).
- **14** shallow spherical-cap dimples in a Fibonacci distribution, frozen to the cup UVs Trailbound Artist painted. Angular radius 16.5°, depth 0.015 m.
- glTF-validator: 0 errors, 0 warnings.

## UV layout
Band-aligned equirectangular **256 × 128**:

- The colour / UV axis is tilted 30° from +Y toward +X, so the blue/gold bands are **horizontal in UV** and read as diagonals on the ball in a front 3/4 view.
- **u = 0.5** is the front (glTF +Z). The back seam is at u = 0 / 1.
- **v = 0** is the south lavender cap (bottom of the image). **v = 1** is the white north cap (top of the image).
- The gold **BLITZBALL** logo is at **uv (0.5, 0.5)**.
- Dimple islands are numbered 1–14 on `../textures/ball_uv_layout.png`. Cups 12 and 13 sit on the left and right ends of the wordmark; that is intentional and matches the painted draft.

A labelled guide: `/workspace/blitzball/stadium/textures/ball_uv_layout.png`.

## Material
- Name: **`ball`**.
- Base colour: `/workspace/blitzball/stadium/textures/ball/ball_modelforge_bandaligned_256x128.png` (also copied to `../textures/ball_albedo.png` so the GLB and the loose file match). Palette is Trailbound v2 (`materials_palette.json`): canvas sun-bleached, dye blue, dye purple muted, metal gold.
- metallic **0**, roughness **0.85**.
- Sampler: mag/min **NEAREST** (9728), wrap **REPEAT**.

## Texel density
256 px around a 0.35 m circumference is about **116 texels/m**. Trailbound Artist set this as a deliberate hero-prop exception (at the stadium default of 32 tx/m the lettering would not read). See `../textures/README.md`.

## Preview
`renders/ball_preview.png` — model (front 3/4 and underside) next to the reference painting.

## Replacing the texture
Keep the 256 × 128 band-aligned layout and the 14 cup UV centres in `mesh_meta.json` (work copy: `/workspace/model-forge/blitzball_ball/work/mesh_meta.json`). Re-export, or swap the embedded PNG and keep the same sampler.
