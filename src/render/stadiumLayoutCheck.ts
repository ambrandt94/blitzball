import {
  KIT_SPHERE_CENTER_Y,
  KIT_SPHERE_RADIUS,
  STAND_ROWS,
  bannerPlacements,
  buildCrowdSlots,
  crowdSpriteUv,
  crystalPlacements,
  stadiumTransform,
  standPlacements,
  towerPlacements,
  wallPlacements,
} from './stadiumLayout';

function fail(message: string): never {
  throw new Error(message);
}

const at68 = stadiumTransform(KIT_SPHERE_RADIUS);
if (Math.abs(at68.scale - 1) > 1e-8) fail('radius 68 should be kit scale 1');
if (Math.abs(at68.offsetY + KIT_SPHERE_CENTER_Y) > 1e-6) fail('sphere centre should land on the origin');

const at34 = stadiumTransform(34);
if (Math.abs(at34.scale - 0.5) > 1e-8) fail('half radius should half the kit');
if (Math.abs(at34.offsetY + 35) > 1e-6) fail('offset should scale with the sphere');

if (standPlacements().length !== 24) fail('stands should tile 24 wedges');
const walls = wallPlacements();
const gates = walls.filter((w) => w.gate);
if (walls.length !== 24) fail('wall ring should cover every wedge');
if (gates.length !== 4) fail('four gates');
if (walls.filter((w) => !w.gate).length !== 20) fail('twenty plain walls');
if (towerPlacements().length !== 8) fail('eight corner towers');
if (crystalPlacements().length !== 4) fail('four crystal pillars');
if (bannerPlacements().length !== 24) fail('a banner on every wedge');
if (STAND_ROWS.length !== 32) fail('32 seat rows');
if (STAND_ROWS[0]?.radius !== 111.3 || STAND_ROWS[31]?.height !== 55) fail('row table drifted from stands_rows.json');

const uv0 = crowdSpriteUv(0);
if (uv0[0] !== 0 || Math.abs(uv0[1] - 0.75) > 1e-6 || Math.abs(uv0[2] - 0.0625) > 1e-6) {
  fail(`sprite 0 uv ${uv0.join(',')}`);
}
const uv16 = crowdSpriteUv(16);
if (Math.abs(uv16[1] - 0.25) > 1e-6) fail('sprite 16 should sit on atlas row 2');

const high = buildCrowdSlots('high');
const low = buildCrowdSlots('low');
if (buildCrowdSlots('off').length !== 0) fail('off density is empty');
if (high.length < 8000 || high.length > 20000) fail(`high crowd ${high.length} is outside the thousands band`);
if (low.length < 1500 || low.length >= high.length) fail(`low crowd ${low.length} should be a smaller positive set`);

let teamA = 0;
let teamB = 0;
let neutral = 0;
for (const slot of high) {
  if (slot.sprite < 12) teamA++;
  else if (slot.sprite < 24) teamB++;
  else neutral++;
}
if (teamA < 1000 || teamB < 1000 || neutral < 200) {
  fail(`sections collapsed A ${teamA} B ${teamB} N ${neutral}`);
}

console.log(`stadium layout ok (crowd high ${high.length}, low ${low.length})`);
