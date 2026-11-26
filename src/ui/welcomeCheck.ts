/**
 * Headless checks for the hold-throw default, water looks, and the saved player.
 *   npx tsx src/ui/welcomeCheck.ts
 */
import { resolvePowerMode, POWER_MODE_HOLD_VERSION, type PowerModeStore } from './powerMode';
import { WATER_LOOKS, cycleWaterLook } from './waterLooks';
import { parsePlayerProfile, defaultPlayerProfile } from './playerProfile';
import { recipeForLook } from '../characters/forge';
import type { CFRuntime, Recipe } from '../characters/cfRuntime';

function fail(message: string): never {
  throw new Error(message);
}

class Memory implements PowerModeStore {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const fresh = new Memory();
const first = resolvePowerMode(fresh);
if (first.mode !== 'hold' || !first.migrated) fail('a new player should land on hold');
fresh.setItem('blitzball.powerMode', 'tap');
const kept = resolvePowerMode(fresh);
if (kept.mode !== 'tap' || kept.migrated) fail('a later choice should stick');

const old = new Memory();
old.setItem('blitzball.powerMode', 'meter');
const moved = resolvePowerMode(old);
if (moved.mode !== 'hold' || old.getItem('blitzball.powerModeVersion') !== POWER_MODE_HOLD_VERSION) {
  fail('an old meter save should migrate to hold once');
}
old.setItem('blitzball.powerMode', 'pull');
if (resolvePowerMode(old).mode !== 'pull') fail('after the migration, pull should stick');

const names = new Set(WATER_LOOKS.map((look) => look.label));
if (names.size < 6) fail('expected several named water looks');
const classic = WATER_LOOKS.find((look) => look.id === 'classic');
const deep = WATER_LOOKS.find((look) => look.id === 'deep');
if (!classic || !deep || classic.colors.deep === deep.colors.deep) fail('water looks should not be the same colour');
if (cycleWaterLook('crystal', 1).id !== 'lagoon') fail('next should wrap the look list');
if (cycleWaterLook('lagoon', -1).id !== 'crystal') fail('prev should wrap the look list');

const parsed = parsePlayerProfile(
  JSON.stringify({ ...defaultPlayerProfile(), name: '  Ada ', mode: 'practice', returning: true }),
);
if (!parsed || parsed.name !== 'Ada' || parsed.mode !== 'practice' || !parsed.returning) {
  fail('profile should keep a trimmed name and the last mode');
}
const unknown = parsePlayerProfile('{"mode":"nope","outfit":"onepiece"}');
if (!unknown || unknown.mode !== 'match') fail('an unknown mode falls back to a match');
const debug = parsePlayerProfile(JSON.stringify({ ...defaultPlayerProfile(), mode: 'debug' }));
if (!debug || debug.mode !== 'debug') fail('debug should be a selectable mode');
const pony = parsePlayerProfile(JSON.stringify({ ...defaultPlayerProfile(), hair: 'ponytail' }));
if (!pony || pony.hair !== 'ponytail_high') fail('an older ponytail save should use the runtime style');

const edits: Record<string, unknown>[] = [];
const fake = {
  blankRecipe: () => ({ tone: 0, hair: 'auto', hairColor: 'auto', outfit: {}, dye: {} }),
  normalize: (recipe: Recipe) => recipe,
  edit: (recipe: Recipe, patch: Record<string, unknown>) => {
    edits.push(patch);
    return { ...recipe, ...patch };
  },
  equip: (recipe: Recipe, slot: string, id: string) => ({ recipe: { ...recipe, outfit: { ...(recipe.outfit ?? {}), [slot]: { id } } } }),
  dye: (recipe: Recipe, id: string, region: string, value?: string) => ({
    recipe: { ...recipe, dye: { ...(recipe.dye ?? {}), [id]: { ...(recipe.dye?.[id] ?? {}), [region]: value ?? '' } } },
  }),
} as unknown as CFRuntime;
const built = recipeForLook(fake, {
  outfit: 'onepiece',
  teamColor: '#e2b43a',
  tone: 4,
  hair: 'ponytail',
  hairColor: 'blonde',
});
if (built.tone !== 4 || built.hair !== 'ponytail_high' || built.hairColor !== 'blonde') {
  fail('skin, hair, and hair colour should stay on the recipe');
}
if (built.dye?.['blitzball/onepiece']?.team !== '#e2b43a') fail('team colour should dye the suit');
if (edits.length === 0 || edits[0]?.tone !== 4) fail('edit should receive the skin tone');

console.log('welcome checks passed');
