# Blitzball water sphere: the look (v2)

**The spec is `../previews/mock_water_outside_4x.png`**, picked by Alex. This folder turns it into data, textures and a drop-in three.js shader.

- Definitive numbers: `water_look_spec.json`. `sphere_palette.json` (v2) points to it. The original is kept as `sphere_palette_v1.json`.
- Measurements taken from the mock: `_mock_measurements.json`. Regenerate everything with `_src/analyse_water_mock.py`, `_src/make_water_look.py` and `_src/compare_water.py`.
- Proof: `water_shader_vs_mockup.png` shows the mock beside the shader (outside, inside, fallback, Clearer and Deeper). `test/compare_metrics.json` holds the numbers.

## The look in one paragraph
- **Body:** a posterized teal body, 5 steps (`#163A48 #1F6066 #2E8A84 #2A9EAE #3EB8D8`). It is driven by the luma of whatever is behind the sphere, seen through an inverted lens, and the lower part (`ny > 0.35`) drops one step.
- **Caustic web:** thin `#5ED2DC` lines with little node rings, only in the inner disc (`f < 0.55`).
- **Rim:** a wide rim made of four Fresnel bands, with Bayer coverage of 25%, 50%, solid and solid.
- **Halo:** a 6%-radius ordered-dither halo outside the silhouette, 50% checker then 25%.
- **Highlight and arc:** a big two-step pixel highlight at the top-left (view-fixed), plus a thin `#E8FFF6` reflection arc at the lower-right.
- **Bubbles:** small bubble rings (`bubbles_64.png`).
- **Pixels:** every pixel is a palette colour. There is no smooth alpha anywhere; transparency is stepped or dithered.

## Files
| file | what | how to sample |
|---|---|---|
| `water_sphere_shader.js` | `createWaterSphere()`, `vertexShader`, `fragmentShader`, `PRESETS`, `WATER` ramp | ES module. Needs `three` in the import map. |
| `water_web_256.png` | seamless caustic-web tile (`#5ED2DC` lines and node rings, alpha cutout) | nearest, RepeatWrapping |
| `water_web_anim_4f_1024x256.png` | 4 seamless looping frames of the web | frame = `floor(t*6)%4`, 6 fps |
| `bayer4_4x4.png` | 4×4 Bayer threshold map, grey `(n+0.5)/16` | nearest, repeat; the shader has it as a const array too |
| `lut_body_5x1.png` | body steps WR0–4 | texel centres, NoColorSpace |
| `lut_rim_4x1.png` | rim bands WR4–7. **Alpha = Bayer coverage** (64/128/255/255), not blend alpha | texel centres |
| `lut_halo_2x1.png` | halo WR5 @50%, WR4 @25% (alpha = coverage) | texel centres |
| `lut_inner_fog_3x1.png` | inside fog steps WR2 → WR1 → WR0 | texel centres |
| `highlight_decal_128.png` | highlight and reflection arc as a whole-disc cutout | fallback billboard over the sphere |
| `water_sphere_test.html` | test page (three@0.160 from unpkg + lil-gui) | serve the `textures/` folder over http |

Test page URL parameters:
- `?mode=outside|inside`
- `&refraction=1|0`
- `&preset=Mockup|Clearer|Deeper`
- `&pixel=1` (virtual pixel size)
- `&res=256` (internal buffer)
- `&gui=0`
- `&freeze=1`

## Uniforms (all tunable live; the GUI exposes them)
Colours are **raw sRGB** `Vector3`s, and the LUTs are `NoColorSpace`. The shader outputs raw sRGB and sets `toneMapped=false`, so palette hexes come out exactly.

| uniform | default (Mockup) | meaning |
|---|---|---|
| `uPixel` | 1 | virtual pixel size in screen px. All shading snaps to this grid (2–3 for a chunky look at native res). |
| `uDitherScale` | 1 | Bayer cell size in virtual pixels |
| `uRefraction` | 1 | 1 = sample the background render target, 0 = fallback tint |
| `uLensScale` | -0.55 | background lens. Negative = inverted, as in the mock. **+0.85 is recommended for gameplay** so swimmers aren't upside-down. |
| `uBodyGain` / `uBodyBias` | 3.4 / 1 | body step `k = bias + floor(luma*gain)`, clamped 0..4 (= number of body bands) |
| `uLowerDarken` | 0.35 | below this `ny` the body drops one step |
| `uBodyLUT`, `uBodySteps` | lut_body_5x1, 5 | body colours |
| `uRimF` | (.50,.58,.68,.80) | Fresnel thresholds of the 4 rim bands |
| `uRimWidth` | 1 | scales the rim width (1 = the mock: 0.081 R dithered + 0.053 R solid) |
| `uRimLUT` | lut_rim_4x1 | rim colours plus coverage |
| `uHaloR`, `uHaloLUT` | (1.0,1.03,1.06) | halo radii (× R) and colours/coverage |
| `uWeb`, `uWebFrames`, `uWebFrame` | anim strip, 4, auto | caustic web texture |
| `uWebTile` | R×2.56 m | world size of one web tile (object-space triplanar, snapped to texels) |
| `uWebScreen`, `uWebScreenTile` | 0, 256 | 1 = flat screen-space web, an exact mock match for a fixed camera |
| `uWebMaxF` | 0.55 | web appears only where `f <` this (it stays out of the rim) |
| `uWebColor` | `#5ED2DC` | web line colour |
| `uHlDir` | (-.55,.6,.58) view space | highlight light direction (top-left, view-fixed) |
| `uHlSteps`, `uHlColA/B` | (.975,.993), `#BDF6F0`/`#E8FFF6` | highlight two-step thresholds |
| `uArcF`, `uArcQuad` | (.70,.80), .35 | lower-right reflection arc band |
| `uFallbackOpacity` | 0.75 | fallback body opacity, quantized to 0.25 steps |
| `uFallbackBlend` | 1 | 1 = one constant stepped alpha (blended), 0 = Bayer screen-door |
| `uFogLUT`, `uFogSteps` | lut_inner_fog, (0.9R,1.5R,2R) m | inside view: 3 hard distance steps with a Bayer seam |
| `uInsideBgGain` | 2 | how much the stands show through when looking out from inside |
| `uInsideCaustic`, `uInsideCausticCover` | `#8CE6E8`, .75 | caustic light web on the upper inner shell |
| `uRays`, `uRay` | 1, (70 period, 11 width, .6 slant) | stepped diagonal god-ray bands from the top-left (inside) |
| caustic speed | `state.caustFps` = 6 | web frame rate (per preset) |

## Presets (`sphere.applyPreset(name)`)
| preset | use | changes |
|---|---|---|
| **Mockup** (default) | matches the picked mock pixel-for-pixel in palette coverage | lens -0.55, gain 3.4, rim 1.0, fallback .75, 6 fps |
| **Clearer** | gameplay: you can read swimmers and the ball through the water | lens +0.85 (upright), gain 4.2, lighter lower half, rim .85, web only in f<.45, fallback .5 |
| **Deeper** | night or dramatic: dark, heavy water | gain 2.4, bias 0, rim 1.15, web f<.6, fallback 1.0, 4 fps |

## Integration (Blitzball Builder)
```js
import { createWaterSphere } from './water/water_sphere_shader.js';
const water = createWaterSphere({ radius: 15, base: 'textures/water/', pixel: 2, preset: 'Clearer' });
water.mesh.position.set(0, 18, 0); scene.add(water.mesh);       // mesh is on layer 2, renderOrder 10
camera.layers.enable(1); camera.layers.enable(2);               // the shader's RT pass uses layer 0 only
// every frame, BEFORE renderer.render(scene, camera):
water.update(renderer, scene, camera, clock.elapsedTime);
```
1. **Layers and render order:**
   - Stadium and everything that should be seen *through* the water go on **layer 0**.
   - The sphere is on **layer 2**.
   - Things *inside* the water (swimmers, ball, bubbles) go on **layer 1**, with `renderOrder > 10` or opaque, so they draw over the water body and stay crisp. That is how the mock shows the ball and bubbles.
2. **Transparency:** `transparent:true`, `depthWrite:false`, `depthTest:true`, `renderOrder 10`. `update()` swaps `FrontSide`/`BackSide` and the inside mode automatically when the camera crosses the radius (the camera-inside test is `distance < radius`).
3. **Refraction RT:**
   - `update()` re-renders the scene (layer 0) into a nearest-filtered RT the size of the drawing buffer. That costs **one extra scene render**.
   - To make it cheaper, render the whole game at low res (for example 320–480 px tall) and upscale with `image-rendering: pixelated`, which also gives the true pixel look. Or skip it on low-end devices (see fallbacks).
   - The RT is linear; `uBgIsLinear=1` handles the conversion.
4. **Geometry:** the mesh is a shell at 1.07 R for the halo. The real sphere is ray-traced analytically per virtual pixel, so geometry segments barely matter (64×32 is plenty).
5. **Requirements:** WebGL2, because the material uses `glslVersion: THREE.GLSL3`. Tested with three r160.
6. **Colour:** keep the LUTs as `NoColorSpace` with nearest filtering and no mipmaps. The loader in the module already does this. Don't let tone mapping touch the material.
7. **Pixel grid:** set `uPixel` to your pixel-art scale so the rim, dither and web snap to the same grid as the rest of the art.

## Fallbacks
- **No refraction RT** (`refraction:false` / `uRefraction=0`):
  - The body uses the fallback tint with a single stepped alpha (`uFallbackOpacity`, 0.25 steps). Set `uFallbackBlend=0` for a pure Bayer screen-door, with no blending at all.
  - Rim, halo, web and highlight are unchanged and stay solid.
  - Inside, the fog becomes a pure 3-step LUT with god-rays.
- **No custom shader at all:**
  - Use a `MeshBasicMaterial` sphere tinted `#2E8A84` at opacity 0.75.
  - Layer `water_web_anim_4f` on top (alphaTest 0.5).
  - Add a camera-facing `highlight_decal_128.png` billboard the size of the sphere's diameter.
  - Add a slightly larger back-face shell in `#8CE6E8` for the rim.
- **Static art:** `../previews/mock_water_outside_4x.png` and `mock_water_inside_4x.png`.

## How close is it
Scores from `test/compare_metrics.json`, outside, Mockup preset, matching camera. Palette-coverage L1 runs from 0 (identical) to 2:
- Disc **0.024**, rim **0.057**, halo **0.012**, core **0.042**.
- **76% of the pixels inside the disc are exactly identical** to the mock.

Remaining differences:
- The highlight is slightly elongated by perspective, because the shader works in true 3D.
- The web curves in object space; set `uWebScreen=1` for the flat look of the mock.
- The halo uses the closest-approach ratio, so it's a touch thinner at grazing angles.
