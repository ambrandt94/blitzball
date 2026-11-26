/**
 * Headless check for which keys the game swallows. Run with:
 *   npx tsx src/input/shortcutCheck.ts
 */
import { browserKeyBlocked, classifyGrabClick } from './InputManager';

function fail(message: string): never {
  throw new Error(message);
}

if (!browserKeyBlocked('Space', false)) fail('Space should be swallowed');
if (!browserKeyBlocked('ControlLeft', false)) fail('left Ctrl should be swallowed');
if (!browserKeyBlocked('ControlRight', false)) fail('right Ctrl should be swallowed');
if (!browserKeyBlocked('KeyW', true)) fail('Ctrl+W should be swallowed when the game has focus');
if (!browserKeyBlocked('KeyS', true) || !browserKeyBlocked('KeyD', true)) fail('Ctrl+WASD should still be a game chord');
if (!browserKeyBlocked('KeyF', true) || !browserKeyBlocked('KeyP', true) || !browserKeyBlocked('KeyR', true)) {
  fail('Ctrl shortcuts should be swallowed');
}
if (browserKeyBlocked('KeyW', false)) fail('W alone is swim, not a browser shortcut');
if (browserKeyBlocked('KeyQ', false)) fail('Q is the dive alias and must still reach the game');
const first = classifyGrabClick(1000, -1, 250);
if (!first.grab || first.dive) fail('the first click must grab immediately and must not dive');
const second = classifyGrabClick(1200, 1000, 250);
if (!second.grab || !second.dive) fail('a second click inside 250ms must grab and dive');
const late = classifyGrabClick(1400, 1000, 250);
if (!late.grab || late.dive) fail('a click after the window is another grab, not a dive');
if (browserKeyBlocked('KeyE', false)) fail('E is unbound and should not be treated as a browser key');

console.log('shortcut checks passed');
