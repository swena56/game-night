// 🙈 Hidden games in the picker (static/shell/lobby.js): a hidden game leaves the list, searching still finds
// it, the picked game stays in place (dimmed), and the "🙈 N hidden" row shows them, 👁️ unhides one, and
// "Unhide all" restores the lot. Loads lobby.js into jsdom with small stand-ins for the shell's globals.
//   node tests/picker_hidden.js
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const dom = new JSDOM('<!doctype html><div id="pick"></div>', { runScripts: 'outside-only', url: 'http://localhost/' });
const w = dom.window;
w.eval(`
  const mem = {};
  function load(k) { return mem[k] == null ? null : JSON.parse(mem[k]); }
  function store(k, v) { v == null ? delete mem[k] : (mem[k] = JSON.stringify(v)); }
  function el(tag, cls = '', text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  const $ = (s) => document.querySelector(s);
  const Profile = { showNew: () => false, bestLabel: () => '', stars: () => 0, tried: () => true, starText: () => '', lastAt: () => '', played: () => 0 };
  const CATEGORIES = [['dice', '🎲 Dice'], ['words', '🔤 Words']];
  const SOLO_BOTS = {}; const SOLO_GAMES = [];
  function fitPicker() {}
` + fs.readFileSync(path.join(__dirname, '../static/shell/lobby.js'), 'utf8') + `
  window.T = { renderPickerGrid, toggleHidden, isHidden, load };
`);

const games = [
  { id: 'mia', name: 'Mia', icon: '🎭', category: 'dice', min: 2, max: 6 },
  { id: 'derby', name: 'Dice Derby', icon: '🏇', category: 'dice', min: 2, max: 6 },
  { id: 'ladder', name: 'Word Ladder', icon: '🧗', category: 'words', min: 1, max: 6 },
];
const pick = w.document.getElementById('pick');
const ids = () => [...pick.querySelectorAll('.game-tile')].map((b) => b.dataset.game);
const row = () => pick.querySelector('.picker-hidden');
let fails = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? `  (${detail})` : ''}`);
  if (!ok) fails++;
}
const opts = { games, current: 'ladder', tile: (b) => { b.onclick = () => {}; } };
const draw = (extra = {}) => w.T.renderPickerGrid(pick, { ...opts, ...extra });

draw();
check('every game listed at first, no hidden row', ids().sort().join() === 'derby,ladder,mia' && !row(), ids().join());
w.T.toggleHidden('mia');
draw();
check('a hidden game leaves the list', !ids().includes('mia'), ids().join());
check('the hidden row counts it', row()?.textContent.includes('1 hidden'), row()?.textContent);
draw({ query: 'mi' });
check('searching still finds it', ids().includes('mia'));
w.T.toggleHidden('ladder');
draw();
check('the picked game stays in place, dimmed, and is not counted', ids().includes('ladder')
  && pick.querySelector('[data-game="ladder"]').classList.contains('is-hidden') && row()?.textContent.includes('1 hidden'));
row().querySelector('button').click();
check('show: a 🙈 Hidden group appears', ids().includes('mia') && [...pick.querySelectorAll('.picker-cat')].some((h) => h.textContent.startsWith('🙈 Hidden')));
pick.querySelector('[data-game="mia"] .tile-unhide').click();
check('👁️ on a tile unhides that game', !w.T.isHidden('mia') && w.T.isHidden('ladder') && ids().includes('mia'));
w.T.toggleHidden('derby');
draw();
[...row().querySelectorAll('button')].find((b) => b.textContent.includes('Unhide all')).click();
check('Unhide all restores everything', w.T.load('hiddenGames') === null && !row() && ids().sort().join() === 'derby,ladder,mia');

console.log(fails ? `\n${fails} failed` : '\nall ok');
process.exit(fails ? 1 : 0);
