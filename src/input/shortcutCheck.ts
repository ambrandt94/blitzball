/**
 * Headless check for which keys the game swallows. Run with:
 *   npx tsx src/input/shortcutCheck.ts
 */
import { browserKeyBlocked } from './InputManager';

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
if (browserKeyBlocked('KeyQ', false)) fail('Q is tackle and must still reach the game');
if (browserKeyBlocked('KeyE', false)) fail('E is unbound and should not be treated as a browser key');

console.log('shortcut checks passed');
