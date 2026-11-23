import { Game } from './game/Game';

const app = document.getElementById('app');
if (!app) throw new Error('#app missing');

const game = new Game(app);
game.start();
