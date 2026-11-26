import { KIT_SPHERE_CENTER_Y, KIT_SPHERE_RADIUS } from './stadiumLayout';
import {
  BASIN_CLEARANCE,
  BASIN_DISC_Y,
  CAUSTIC_FPS_DEFAULT,
  CAUSTIC_SCROLL_DEFAULT,
  LIGHT_BANDS_DEFAULT,
  WATER_DEEP_DEFAULT,
  WATER_FOG_DEFAULT,
  WATER_HALO_SCALE,
  WATER_CLARITY_DEFAULT,
  WATER_FOG_CAP,
  WATER_FOG_START_DEFAULT,
  WATER_TINT_DEFAULT,
  basinBowlDrop,
  causticPhase,
  colorsForPreset,
  fogDensityFromClarity,
  gradeMul,
  parseWaterColors,
  waterFogFactor,
} from './waterSettings';

function fail(message: string): never {
  throw new Error(message);
}

const causticCycle = 4 / CAUSTIC_FPS_DEFAULT;
if (causticCycle < 8) fail(`caustic cycle should last several seconds, got ${causticCycle.toFixed(2)}`);
if (CAUSTIC_FPS_DEFAULT > 0.6) fail('caustic playback should be a long cross-fade, not a quick step');
if (!(CAUSTIC_SCROLL_DEFAULT > 0) || CAUSTIC_SCROLL_DEFAULT > 0.12) {
  fail('default caustic scroll should be a slow drift');
}
if (LIGHT_BANDS_DEFAULT) fail('diagonal light bands should be off by default');

const mid = causticPhase(0.2, CAUSTIC_FPS_DEFAULT);
if (mid === Math.floor(mid)) fail('caustic phase should move inside a frame, not step');
if (Math.abs(causticPhase(1 / CAUSTIC_FPS_DEFAULT, CAUSTIC_FPS_DEFAULT) - 1) > 1e-6) {
  fail('one frame of playback should advance one frame index');
}
if (causticPhase(10, 0) !== 0) fail('zero speed holds the first frame');
const loop = causticPhase(4 / CAUSTIC_FPS_DEFAULT, CAUSTIC_FPS_DEFAULT);
if (loop > 1e-6) fail('phase should wrap the 4-frame strip');

const clearer = colorsForPreset('Clearer');
if (clearer.tint !== WATER_TINT_DEFAULT || clearer.deep !== WATER_DEEP_DEFAULT || clearer.fog !== WATER_FOG_DEFAULT) {
  fail('Clearer should keep the current water colours');
}
for (const name of ['Mockup', 'Clearer', 'Deeper']) {
  const colors = colorsForPreset(name);
  if (!colors.tint || !colors.deep || !colors.fog) fail(`${name} is missing water colours`);
}
const ident = gradeMul(WATER_TINT_DEFAULT, WATER_TINT_DEFAULT);
if (ident.some((v) => Math.abs(v - 1) > 1e-6)) fail('default tint grade should be identity');
const deepIdent = gradeMul(WATER_DEEP_DEFAULT, WATER_DEEP_DEFAULT);
if (deepIdent.some((v) => Math.abs(v - 1) > 1e-6)) fail('default deep grade should be identity');

const parsed = parseWaterColors({ tint: '#112233', deep: 'nope', fog: '#abcdef' });
if (parsed.tint !== '#112233' || parsed.deep !== WATER_DEEP_DEFAULT || parsed.fog !== '#abcdef') {
  fail('colour restore should keep valid hexes and fall back the rest');
}
if (parsed.clarity !== WATER_CLARITY_DEFAULT || parsed.fogStart !== WATER_FOG_START_DEFAULT) {
  fail('missing fog settings should keep the defaults');
}

const density = fogDensityFromClarity(WATER_CLARITY_DEFAULT);
const near = waterFogFactor(3, density, WATER_FOG_START_DEFAULT);
const atStart = waterFogFactor(WATER_FOG_START_DEFAULT, density, WATER_FOG_START_DEFAULT);
const midFog = waterFogFactor(28, density, WATER_FOG_START_DEFAULT);
const farther = waterFogFactor(55, density, WATER_FOG_START_DEFAULT);
const across = waterFogFactor(120, density, WATER_FOG_START_DEFAULT);
if (near !== 0 || atStart !== 0) fail(`the first metres should stay clear (${near}, ${atStart})`);
if (!(midFog > 0.02 && midFog < farther && farther <= across)) fail('fog should deepen smoothly with distance');
if (across > WATER_FOG_CAP + 1e-6) fail(`far water went opaque (${across})`);
const step = waterFogFactor(36, density, WATER_FOG_START_DEFAULT) - waterFogFactor(34, density, WATER_FOG_START_DEFAULT);
if (step > 0.04) fail(`fog jumped ${step.toFixed(3)} across two metres`);
if (fogDensityFromClarity(1) !== 0) fail('full clarity should remove the fog');

const drop = basinBowlDrop(KIT_SPHERE_CENTER_Y, KIT_SPHERE_RADIUS);
const discY = BASIN_DISC_Y - drop;
const meshR = KIT_SPHERE_RADIUS * WATER_HALO_SCALE;
const dist = Math.abs(KIT_SPHERE_CENTER_Y - discY);
if (!(dist > meshR + BASIN_CLEARANCE * 0.5)) fail(`sunk disc still meets the water mesh (${dist} vs ${meshR})`);
const authored = Math.abs(KIT_SPHERE_CENTER_Y - BASIN_DISC_Y);
if (authored >= meshR) fail('the authored disc should be the one that clips the halo mesh');

console.log(`water settings ok (basin drop ${drop.toFixed(2)} m, caustic ${CAUSTIC_FPS_DEFAULT} fps)`);
