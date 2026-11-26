/**
 * Headless check for the reusable settings panel store.
 *   npx tsx src/ui/settingsPanelCheck.ts
 */
import { readSettings, settingMatches, writeSettings, type SettingStore } from './settingsPanel';

function fail(message: string): never {
  throw new Error(message);
}

class MemoryStore implements SettingStore {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const store = new MemoryStore();
if (readSettings(store, 'panel').pins.length !== 0) fail('missing store should start with no pins');
writeSettings(store, 'panel', {
  pins: ['maxCurve', 'deadzone'],
  values: { maxCurve: 1.15, deadzone: 0.08, named: 'hold' },
});
const saved = readSettings(store, 'panel');
if (saved.pins.join(',') !== 'maxCurve,deadzone') fail('pins did not round-trip');
if (saved.values.maxCurve !== 1.15 || saved.values.deadzone !== 0.08) fail('numbers did not round-trip');
if (saved.values.named !== 'hold') fail('strings did not round-trip');
store.setItem('panel', '{');
if (readSettings(store, 'panel').pins.length !== 0) fail('bad json should read as empty');
if (!settingMatches('Max curve', 'curve')) fail('search missed a label');
if (settingMatches('Max curve', 'water')) fail('search matched the wrong label');
if (!settingMatches('Max curve', '   ')) fail('an empty search should keep every row');

console.log('settings panel checks passed');
