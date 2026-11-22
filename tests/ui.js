// Drives the real Game Night UI in jsdom (a simulated, phone-sized browser) against a running server,
// playing each game through real clicks and reporting any JavaScript errors.
// Usage: start a server (e.g. PORT=8767 python3 server.py), then in tests/: npm install && BASE=http://localhost:8767 node ui.js [game ...]
// jsdom's loader makes a fresh keep-alive agent for every resource (~50 scripts a page) and never reuses
// or closes them; with a few pages opened that left page loads hanging. One shared, pooled agent instead
// (jsdom picks up this module from the require cache).
{
  const http = require('http'), https = require('https'), path = require('path');
  const factory = path.join(path.dirname(require.resolve('jsdom')), 'jsdom/living/helpers/agent-factory.js');
  const shared = { http: new http.Agent({ keepAlive: true, maxSockets: 8 }), https: new https.Agent({ keepAlive: true, maxSockets: 8 }) };
  require.cache[factory] = { id: factory, filename: factory, loaded: true, exports: () => shared };
}
const { JSDOM, VirtualConsole } = require('jsdom');
const BASE = process.env.BASE || 'http://localhost:8767';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nodeErrors = [];
const relayReplayed = new Set();
process.on('unhandledRejection', (e) => nodeErrors.push('unhandledRejection: ' + (e?.stack || e)));

class ES { // minimal EventSource over fetch streaming
  constructor(url) { this.url = new URL(url, BASE).href; this.readyState = 0; this.l = {}; this.ctrl = new AbortController(); this.open(); }
  async open() {
    try {
      const r = await fetch(this.url, { signal: this.ctrl.signal });
      if (!r.ok) { this.readyState = 2; this.onerror?.(); return; }
      this.readyState = 1; this.onopen?.();
      const dec = new TextDecoder(); let buf = '';
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) { this.dispatch(buf.slice(0, i)); buf = buf.slice(i + 2); }
      }
    } catch { if (this.readyState !== 2) { this.readyState = 0; this.onerror?.(); } }
  }
  dispatch(block) {
    let ev = 'message', data = '';
    for (const line of block.split('\n')) { if (line.startsWith('event: ')) ev = line.slice(7); else if (line.startsWith('data: ')) data += line.slice(6); }
    if (!data || this.readyState === 2) return;
    try { if (ev === 'message') this.onmessage?.({ data }); (this.l[ev] || []).forEach((f) => f({ data })); }
    catch (e) { nodeErrors.push('in onmessage: ' + e.stack); }
  }
  addEventListener(t, f) { (this.l[t] ||= []).push(f); }
  close() { this.readyState = 2; this.ctrl.abort(); }
}
ES.CONNECTING = 0; ES.OPEN = 1; ES.CLOSED = 2;

// A canvas 2D context that accepts every call and draws nothing (jsdom has no canvas).
const stubContext = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : /^create.*Gradient$/.test(k) ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });

// On a busy host jsdom can take a long time over the page's ~50 scripts, and now and then never fires
// `load` at all, which used to hang a whole run. Each try gets LOAD_MS (env LOAD_MS overrides); a stuck
// page is closed and opened again, up to three tries.
const LOAD_MS = +(process.env.LOAD_MS || 60000);
async function openPage(stubCanvas = false) {
  for (let attempt = 1; ; attempt++) {
    const limit = sleep(LOAD_MS + 5000).then(() => { throw new Error('page never opened'); });
    try { return await Promise.race([openOnce(stubCanvas), limit]); } catch (e) {
      if (attempt >= 3) throw e;
      console.error(`   (page load ${attempt} stalled: ${e.message}; retrying)`);
    }
  }
}
async function openOnce(stubCanvas) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Could not load img|Not implemented: HTMLCanvasElement/.test(e.message)) errors.push('jsdomError: ' + (e.detail?.stack || e.stack || e.message)); });
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
  const dom = await JSDOM.fromURL(BASE + '/', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (u, o) => fetch(new URL(u, BASE).href, o);
      w.EventSource = ES;
      if (!w.CSS) w.CSS = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&") };  // jsdom has no CSS global
      w.ResizeObserver = class { observe() {} disconnect() {} };
      w.matchMedia = (q) => ({ matches: /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} }); // phone-sized
      w.navigator.vibrate = () => true;
      w.confirm = () => true; w.prompt = () => null; w.alert = () => {};
      w.HTMLCanvasElement.prototype.getContext = stubCanvas ? function (kind) { return kind === '2d' ? stubContext() : null; } : () => null;
      w.AudioContext = undefined;
    },
  });
  const loaded = await Promise.race([
    new Promise((r) => (dom.window.document.readyState === 'complete' ? r(true) : dom.window.addEventListener('load', () => r(true)))),
    sleep(LOAD_MS).then(() => false),
  ]);
  if (!loaded) { try { dom.window.close(); } catch {} throw new Error(`no load event in ${LOAD_MS / 1000} s`); }
  return { w: dom.window, d: dom.window.document, errors, close: () => { try { dom.window.eval('es && es.close()'); } catch {} dom.window.close(); } };
}

async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (fn()) return true; } catch {} await sleep(100); }
  return false;
}
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const enabled = (d, sel) => [...d.querySelectorAll(sel)].filter((b) => !b.disabled && !b.closest('[hidden]'));
const click = (el) => el && el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));

// One "human" move per game, done purely through the DOM.
// FreeCell / Solitaire: ask for a 💡 hint, then play it with real taps (pick the card up, tap where it
// goes); now and then an undo. With no hint to be had, call it a day (🏳️, which asks first).
let ptNoHint = 0;
function patienceMove(key, P, d, S, n, w) {
  const v = S[key], tap = (el) => { for (const t of ['pointerdown', 'pointerup']) el.dispatchEvent(new w.MouseEvent(t, { bubbles: true, cancelable: true, button: 0 })); };
  const h = v.hint;
  if (!h) {
    if (n % 9 === 8 && !d.querySelector(`#${P}Undo`).disabled) return click(d.querySelector(`#${P}Undo`));
    const t = d.querySelector('#toast');
    if (!t.hidden && /No helpful move/.test(t.textContent)) ptNoHint++;
    if (ptNoHint > 2) { ptNoHint = 0; return click(d.querySelector(`#${P}Bank`)); }
    return click(d.querySelector(`#${P}Hint`));
  }
  if (h.type === 'draw') return tap(d.querySelector(`#${P}Root [data-pile="s"]`));
  const nodes = [...d.querySelectorAll(`#${P}Root .pc[data-pile="${h.src}"][data-k]`)];
  const card = nodes[nodes.length - h.n];
  if (!card) return click(d.querySelector(`#${P}Hint`));
  tap(card);
  const dst = h.dst === 'f' ? `f${'SHDC'.indexOf(card.dataset.k[1])}` : h.dst;
  const slot = d.querySelector(`#${P}Root .pt-slot[data-pile="${dst}"]`);
  tap(slot.querySelector('.pc:last-child') || slot);
}

// the 🃏 card-table games (static/cardtable.js) share one driver: pick cards and confirm, tap a playable
// card (and a choice if one appears), or press one of the buttons
const CT_GAMES = new Set(['cheat', 'president', 'spoons', 'kowhist', 'spades', 'ohhell', 'euchre', 'gops', 'scopa', 'gin', 'germanwhist', 'fantan', 'palace', 'ratscrew', 'nertz', 'whist', 'briscola', 'blitz', 'ranter', 'bigtwo', 'gofish', 'oldmaid', 'cassino', 'spite', 'war', 'ninetynine', 'sixtysix', 'pitch', 'ecarte', 'fivehundred', 'canasta', 'eleusis', 'mao', 'belote', 'pinochle', 'bezique', 'bridge', 'truc', 'skat', 'piquet']);
function ctMove(game, d, S) {
  const t = S[game], root = d.querySelector(`.ct-${game}`);
  if (!root) return;
  const cards = [...root.querySelectorAll('.ct-hand .card-btn:not(:disabled), .ct-rows .card-btn:not(:disabled)')];
  const btns = [...root.querySelectorAll('.ct-btns button:not(:disabled)')];
  const slap = root.querySelector('.ct-btns button.slap');
  if (slap) return click(slap);
  if (t.pick && !(t.buttons?.length && Math.random() < 0.5)) {
    const n = Math.max(t.pick.min ?? 1, 1 + Math.floor(Math.random() * Math.min(2, t.pick.max)));
    for (let k = 0; k < n; k++) { const c = [...root.querySelectorAll('.ct-hand .card-btn:not(:disabled):not(.picked), .ct-rows .card-btn:not(:disabled):not(.picked)')]; if (c.length) click(pick(c)); }
    const go = [...root.querySelectorAll('.ct-btns button.primary:not(:disabled)')];
    if (go.length) return click(pick(go));
  }
  if (t.moves?.length && cards.length && (!btns.length || Math.random() < (game === 'spoons' ? 0.97 : 0.7))) {
    const card = pick(cards);
    click(card);
    const ch = [...root.querySelectorAll('.ct-choice button.primary')];
    if (ch.length) {
      const option = pick(ch);
      if (game === 'scopa') {
        const handIndex = cards.indexOf(card);
        const expected = t.moves.filter((move) => move.card === t.hand[handIndex])[ch.indexOf(option)].a.take;
        option.focus();
        const shown = [...root.querySelectorAll('.ct-capture-preview')].map((face) => face.dataset.previewCard);
        if (shown.length !== expected.length || shown.some((c) => !expected.includes(c))) {
          throw new Error('Scopa highlights a different set of cards than the capture option');
        }
      }
      click(option);
    }
    return;
  }
  const piles = [...root.querySelectorAll('.ct-pile.tap')];
  if (piles.length && (!btns.length || Math.random() < 0.5)) return click(pick(piles));
  if (btns.length) return click(pick(btns));
}

let WB_WORDS = null;   // the dictionary, for Word Bomb moves
let WS_PLAN = null, WS_RACK = null;   // Wordsmith: the 🔮 plan-ahead step
const MOVES = {
  oddone(d, S, n, w) {
    if (S.oddone.stage === 'vote') return click(pick(enabled(d, '.oo-vote')));
    if (S.oddone.stage === 'defense') {
      d.querySelector('#ooDefense').value = pick(['careful', 'steady', 'thoughtful']);
      return d.querySelector('#ooDefenseForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    }
    const [form, input, text] = S.oddone.stage === 'guess' ? ['#ooGuessForm', '#ooGuess', pick(['tea', 'snow', 'pool'])]
      : ['#ooClueForm', '#ooClue', pick(['warm', 'round', 'happy', 'big', 'fast', 'blue', 'loud', 'soft']) + 'ish'.slice(0, n % 4)];
    d.querySelector(input).value = text;
    d.querySelector(form).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  },
  fibfinder(d, S, n, w) {
    if (S.fibfinder.stage === 'pick') return click(pick(enabled(d, '.fb-opt')));
    if (!d.querySelector('#fbFib')) return;  // the screen's script is still loading
    d.querySelector('#fbFib').value = pick(['a tiny hat', 'seven', 'purple', 'cheese', 'the mayor']);
    d.querySelector('#fbForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  },
  relay(d, S, n, w) {
    const g = S.relay;
    if (g.stage === 'show') {
      const key = `${S.code}:${g.show}`;
      if (!relayReplayed.has(key)) {
        relayReplayed.add(key);
        const before = [...d.querySelectorAll('#rlChain .rl-entry')].map((e) => e.textContent);
        const replay = d.querySelector('.rl-replay');
        if (!replay) nodeErrors.push('Scribble Relay replay control missing');
        else {
          click(replay);
          const after = [...d.querySelectorAll('#rlChain .rl-entry')].map((e) => e.textContent);
          if (JSON.stringify(after) !== JSON.stringify(before)) nodeErrors.push('Scribble Relay replay changed chain cards or order');
        }
        return;
      }
      return click(pick(enabled(d, '.rl-heart')));
    }
    if (g.kind === 'draw') {
      const pad = d.querySelector('#rlPad');
      pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 300 });
      for (let k = 0; k < 2; k++) {
        click(pick([...d.querySelectorAll('.rl-swatch')]));
        pad.dispatchEvent(new w.MouseEvent('pointerdown', { clientX: 30 + 100 * k, clientY: 40 }));
        for (let i = 1; i < 12; i++) pad.dispatchEvent(new w.MouseEvent('pointermove', { clientX: 30 + 100 * k + i * 9, clientY: 40 + i * 15 }));
        pad.dispatchEvent(new w.MouseEvent('pointerup', {}));
      }
      return click(d.querySelector('#rlSend'));
    }
    if (g.kind === 'write') click(d.querySelector('#rlIdea')); else d.querySelector('#rlText').value = pick(['a duck', 'my uncle', 'a cat']);
    d.querySelector('#rlTextForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  },
  unmask(d, S, n) {
    if (n % 4 === 3) { click(d.querySelector('#accuseBtn')); return click(pick(enabled(d, '#board .card:not(.down)'))); }
    const fl = d.querySelector('#log .entry button'); if (fl) click(fl);
    click(d.querySelector('#askBtn'));
  },
  wordsmith(d, S, n, w) {
    if (n === 0) {  // drag a rack tile onto the ★ (jsdom lays nothing out, so give the board a size first)
      const board = d.querySelector('.ws-board'), tile = d.querySelector('.rack-tile');
      board.getBoundingClientRect = () => ({ left: 0, top: 0, width: 440, height: 440, right: 440, bottom: 440 });
      const fire = (el, type, x, y) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
      const k = [...board.children].findIndex((c) => !c.classList.contains('tile'));
      const x = (k % 11) * 40 + 20, y = Math.floor(k / 11) * 40 + 20 + 24;  // the tile is held above the finger
      fire(tile, 'pointerdown', 500, 500); fire(tile, 'pointermove', x, y); fire(tile, 'pointerup', x, y);
      const placed = d.querySelectorAll('.ws-cell.pending');
      if (placed.length !== 1 || [...board.children].indexOf(placed[0]) !== k) throw new Error('dragging a tile onto the board did not place it');
      click(d.querySelector('#wsRecall'));
    }
    // 🔮 plan ahead: place the 💡 hint's word, then ask for a dry run of the next turn (nothing is played)
    if (n === 1 && enabled(d, '#wsHint').length && !d.querySelector('#wsHint').hidden) { WS_PLAN = 'hint'; return click(d.querySelector('#wsHint')); }
    if (n === 2 && WS_PLAN === 'hint') {
      const b = d.querySelector('.ws-planbtn');
      if (b) { WS_PLAN = 'asked'; WS_RACK = S.ws.rack.join(''); return click(b); }
    }
    if (n === 3 && WS_PLAN === 'asked') {
      WS_PLAN = 'done';
      if (d.querySelector('#wsPlan').hidden) throw new Error('🔮 plan ahead showed nothing');
      if (S.ws.rack.join('') !== WS_RACK || d.querySelectorAll('.ws-cell.pending').length === 0) throw new Error('🔮 plan ahead changed the rack or the placed tiles');
      click(d.querySelector('#wsRecall'));
    }
    click(enabled(d, '#wsSwap')[0]); click(enabled(d, '.rack-tile')[0]); click(enabled(d, '#wsSwap')[0]); if (!enabled(d, '#wsSwap').length) return; click(d.querySelector('#wsPass')); },
  chess(d) { click(pick(enabled(d, '.csq.movable'))); click(pick(enabled(d, '.csq.target, .csq.capture'))); click(enabled(d, '#chPromo button')[0]); },
  checkers(d, S, n, w) {
    const history = S.checkers.history || [], panel = d.querySelector('#ckReplayPanel');
    if (history.length && n % 12 === 4) { click(d.querySelector('#ckReplayToggle')); return; }
    if (history.length && n % 12 === 5 && !panel.hidden) {
      const range = d.querySelector('#ckReplayRange'); range.value = String(Math.max(1, history.length - 1)); range.dispatchEvent(new w.Event('input', { bubbles: true })); return;
    }
    if (history.length && n % 12 === 6 && !panel.hidden) { click(d.querySelector('#ckReplayToggle')); return; }
    click(pick(enabled(d, '.csq.movable'))); click(pick(enabled(d, '.csq.target')));
  },
  go(d, S, n) { if (n > 30) return click(d.querySelector('#goPass')); click(pick(enabled(d, '.go-pt'))); },
  lastcard(d) {
    click(enabled(d, '#lcDeclare')[0]);
    const ok = enabled(d, '.card-btn.ok');
    if (ok.length) { click(ok[0]); return click(enabled(d, '#lcSuitPick button')[0]); }
    click(enabled(d, '#lcPass')[0] || enabled(d, '#lcDraw')[0]);
  },
  seabattle(d, S) {
    if (S.sea.stage === 'placing') { click(d.querySelector('#sbRandom')); return click(d.querySelector('#sbReady')); }
    click(pick(enabled(d, '#sbEnemy .sea-cell')));
  },
  hedgerow(d, S, n) {  // every 4th turn try a hedge (touch: tap a groove twice, the second tap plants), else move to a glowing square
    const legal = S.hedgerow.legal || [];
    if (n % 4 === 1 && legal.length && !d.querySelector('#hgHedge').disabled) {
      click(d.querySelector('#hgHedge'));
      const [o, r, c] = pick(legal).split(',');
      const hit = d.querySelector(`.hg-seg[data-slot="${o},${r},${c}"]`);  // the half-groove nearest that hedge's crossing
      click(hit); click(hit);
      if (d.querySelector('#hgGhost.picked') || !d.querySelector('#hgHedge.primary')) return;
      click(d.querySelector('#hgMove'));
    }
    click(pick([...d.querySelectorAll('.hg-cell.target')]));
  },
  dropfour(d) { click(pick(enabled(d, '.d4-cell'))); },
  boxes(d) { const ln = pick(enabled(d, '.bx-line:not(.drawn)')); click(ln); click(d.querySelector(`.bx-line[data-k="${ln?.dataset.k}"]`)); },  // touch: tap twice
  doodle(d, S, n, w) {
    d.querySelector('#ddGuess').value = pick(['cat', 'house', 'tree', 'car', 'apple', 'fish', 'sun']);
    d.querySelector('#ddForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  },
  qork(d, S, n, w) {  // roll as the Cupper; yank or slam on a trigger
    const g = S.qork;
    if (g.stage === 'snap') return d.querySelector('#qkGo').dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    if (!d.querySelector('#qkRoll').disabled) click(d.querySelector('#qkRoll'));
  },
  hockey(d, S, n, w) {  // drag the mallet to a few spots in our half (the bottom of the screen)
    const c = d.querySelector('#hkCanvas');
    c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 512 });
    for (const type of ['pointerdown', 'pointermove']) c.dispatchEvent(new w.MouseEvent(type, { clientX: 40 + Math.random() * 240, clientY: 280 + Math.random() * 220, buttons: 1 }));
  },
  fuse(d, S, n, w) {  // run to random spots, dash now and then
    const c = d.querySelector('#fzCanvas');
    c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 416 });
    for (const type of ['pointerdown', 'pointermove']) c.dispatchEvent(new w.MouseEvent(type, { clientX: 30 + Math.random() * 260, clientY: 30 + Math.random() * 350, buttons: 1 }));
    if (n % 5 === 0) { const b = d.querySelector('#fzDash'); if (b && !b.disabled) click(b); }
  },
  riders(d, S, n, w) {  // mix taps (relative-turn mode), swipes anywhere, the boost button and keys
    const root = d.querySelector('#lrRoot');
    if (n % 12 === 5) return w.dispatchEvent(new w.KeyboardEvent('keydown', { code: 'KeyX' }));
    if (n % 12 === 9) return d.querySelector('#lrBrake')?.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
    if (n % 4 === 0) {
      const tap = d.querySelector('#lrTap');
      if (!tap.checked) { tap.checked = true; tap.dispatchEvent(new w.Event('change', { bubbles: true })); }
      root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 480 });
      return root.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: pick([40, 280]), clientY: 200 }));
    }
    if (n % 4 === 1) return w.dispatchEvent(new w.KeyboardEvent('keydown', { code: pick(['ArrowLeft', 'ArrowRight', 'KeyW', 'KeyQ', 'KeyE', 'Space']) }));
    if (n % 4 === 2) return d.querySelector('#lrBoost')?.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
    const tap = d.querySelector('#lrTap');
    if (tap.checked) { tap.checked = false; tap.dispatchEvent(new w.Event('change', { bubbles: true })); }
    root.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
    root.dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: 100 + pick([-40, 40, 0]), clientY: 100 + pick([-40, 40]) }));
    root.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true }));
  },
  whisker(d, S, n, w) {  // swipes anywhere, taps on the maze, the arrow pad and keys
    const stage = d.querySelector('#wkStage');
    if (n % 4 === 0) return w.dispatchEvent(new w.KeyboardEvent('keydown', { code: pick(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'KeyS']) }));
    if (n % 4 === 1) return d.querySelector(`#wkPad button[data-d="${pick([0, 1, 2, 3])}"]`)?.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    if (n % 4 === 2) {
      d.querySelector('#wkCanvas').getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 300 });
      stage.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: pick([20, 300]), clientY: pick([20, 280]) }));
      return stage.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, clientX: 20, clientY: 20 }));
    }
    stage.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
    stage.dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: 100 + pick([-40, 40, 0]), clientY: 100 + pick([-40, 40]) }));
    stage.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, clientX: 100, clientY: 100 }));
  },
  tictactoe(d) { click(pick(enabled(d, '.ttt-cell'))); },
  kindred(d) {  // a square for the piece in hand (if placing), then a piece to hand over
    const cells = enabled(d, '.kn-cell'); if (cells.length) click(pick(cells));
    const pieces = enabled(d, '.kn-pp'); if (pieces.length) click(pick(pieces));
  },
  heist(d) { click(pick(enabled(d, '.h-choice'))); },
  lantern(d) { click(pick(enabled(d, '.lm-tile'))); },
  meteorshot(d, S) { const f = d.querySelector('#msFire'); if (f && !f.disabled) click(f); },
  moonshot(d, S) { click(S.moon.fuel >= 12 ? d.querySelector('#msBank') : d.querySelector('#msRoll')); },
  lucky(d, S, n, w) {
    const keys = enabled(d, '.lk-key');
    if (keys.length) return click(pick(keys));
    if (n % 6 === 5) {
      d.querySelector('#lkSolve').value = 'definitely not it';
      return d.querySelector('#lkSolveForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    }
    click(enabled(d, '#lkSpin')[0]);
  },
  backgammon(d) {
    for (const id of ['#bgRoll', '#bgEnd']) { const b = d.querySelector(id); if (!b.hidden) return click(b); }
    const dest = d.querySelector('.bg-pt.dest, .bg-off.dest');
    if (dest) return click(dest);
    click(pick([...d.querySelectorAll('.bg-pt.src, .bg-bar.src')]));
  },
  safecracker(d, S, n) {
    const lock = d.querySelector('#scLock');
    if (!lock) return;  // the screen's script is still loading
    if (n === 2) { click(d.querySelector('#scNotes .sc-peg')); click(d.querySelector('#scSpots .sc-cell')); }  // 📝 notes: local only
    if (!lock.disabled) return click(lock);
    const probe = d.querySelector('#scProbe');
    if (n === 3 && !probe.disabled) click(probe);  // probe once, then keep building the guess
    click(pick([...d.querySelectorAll('.sc-peg.pad:not(.off)')]));
  },
  gridhunt(d, S, n, w) {
    if (n % 3 === 0) {  // type a word on the keyboard
      for (const k of [...'TEARS'.slice(0, 3 + (n % 3)), 'Enter']) w.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
      return;
    }
    const tiles = [...d.querySelectorAll('.gh-tile')], size = S.gridhunt.n;
    let at = Math.floor(Math.random() * tiles.length);
    click(tiles[at]);
    for (let k = 0; k < 3; k++) {  // walk to touching tiles, then tap the last one again to send
      const next = tiles.map((_, i) => i).filter((i) => i !== at && Math.abs((i / size | 0) - (at / size | 0)) <= 1 && Math.abs(i % size - at % size) <= 1 && !tiles[i].classList.contains('on'));
      if (!next.length) break;
      at = pick(next); click(tiles[at]);
    }
    click(tiles[at]);
  },
  sumo(d, S, n, w) {  // stick drags, taps (dash), the dash button and keys
    const fire = (el, type, x = 0, y = 0) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    const st = d.querySelector('#smStage'), kind = n % 4;
    if (kind === 0) { fire(st, 'pointerdown', 150, 150); fire(st, 'pointermove', 150 + pick([-50, 50]), 150 + pick([-50, 50])); setTimeout(() => fire(st, 'pointerup'), 400); }
    else if (kind === 1) { fire(st, 'pointerdown', 150, 150); fire(st, 'pointerup', 150, 150); }
    else if (kind === 2) fire(d.querySelector('#smDash'), 'pointerdown');
    else {
      const code = pick(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
      w.dispatchEvent(new w.KeyboardEvent('keydown', { code, bubbles: true }));
      setTimeout(() => w.dispatchEvent(new w.KeyboardEvent('keyup', { code, bubbles: true })), 300);
    }
  },
  snowball(d, S, n, w) {  // stick drags, taps (throw), a held throw button (a big one) and keys
    const fire = (el, type, x = 0, y = 0) => el && el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    const st = d.querySelector('#swStage'), btn = d.querySelector('#swThrow'), kind = n % 4;
    if (kind === 0) { fire(st, 'pointerdown', 150, 150); fire(st, 'pointermove', 150 + pick([-50, 50]), 150 + pick([-50, 50])); setTimeout(() => fire(st, 'pointerup'), 400); }
    else if (kind === 1) { fire(st, 'pointerdown', 150, 150); fire(st, 'pointerup', 150, 150); }
    else if (kind === 2) { fire(btn, 'pointerdown'); setTimeout(() => fire(btn, 'pointerup'), pick([100, 1000])); }
    else {
      const code = pick(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space']);
      w.dispatchEvent(new w.KeyboardEvent('keydown', { code, bubbles: true }));
      setTimeout(() => w.dispatchEvent(new w.KeyboardEvent('keyup', { code, bubbles: true })), 300);
    }
  },
  tops(d, S, n, w) {  // pick a top, the 🚀/💨 button, 🌀 Rev, stick drags, taps (dash) and keys
    const fire = (el, type, x = 0, y = 0) => el && el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    const st = d.querySelector('#tpStage'), btn = d.querySelector('#tpBtn'), kind = S.tops.st === 'launch' ? (n % 3 ? 2 : 5) : n % 6;
    const chips = [...d.querySelectorAll('#tpPick:not([hidden]) [data-k]')];
    if (kind === 5 && chips.length) fire(pick(chips), 'click');
    else if (kind === 4) fire(d.querySelector('#tpRev:not([hidden])'), 'pointerdown');
    else if (kind === 0) { fire(st, 'pointerdown', 150, 150); fire(st, 'pointermove', 150 + pick([-50, 50]), 150 + pick([-50, 50])); setTimeout(() => fire(st, 'pointerup'), 400); }
    else if (kind === 1) { fire(st, 'pointerdown', 150, 150); fire(st, 'pointerup', 150, 150); }
    else if (kind === 2) fire(btn, 'pointerdown');
    else {
      const code = pick(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyR', 'Digit3']);
      w.dispatchEvent(new w.KeyboardEvent('keydown', { code, bubbles: true }));
      setTimeout(() => w.dispatchEvent(new w.KeyboardEvent('keyup', { code, bubbles: true })), 300);
    }
  },
  lander(d, S, n, w) {  // hold 🔥 burn for a while, lean ◀ ▶, or keys
    const fire = (el, type) => el && el.dispatchEvent(new w.MouseEvent(type, { bubbles: true }));
    const k = pick(['up', 'up', 'l', 'r']), b = d.querySelector(`#mlCtl [data-k="${k}"]`);
    if (n % 5 === 4) {  // drag the sky to look around, or hold a pad arrow
      const st = d.querySelector('#mlStage'), pe = (el, type, x) => el && el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x }));
      const arrow = d.querySelector('.ml-arrows [data-pad]');
      if (arrow) { pe(arrow, 'pointerdown', 0); setTimeout(() => pe(arrow, 'pointerup', 0), 400); return; }
      pe(st, 'pointerdown', 200); pe(st, 'pointermove', 120); setTimeout(() => pe(st, 'pointerup', 120), 200); return;
    }
    if (n % 3 === 2) { const code = pick(['ArrowUp', 'ArrowLeft', 'Space']); w.dispatchEvent(new w.KeyboardEvent('keydown', { code, bubbles: true })); setTimeout(() => w.dispatchEvent(new w.KeyboardEvent('keyup', { code, bubbles: true })), 500); return; }
    fire(b, 'pointerdown'); setTimeout(() => fire(b, 'pointerup'), k === 'up' ? pick([400, 900]) : 150);
  },
  pusher(d, S, n, w) {  // slide the chute (slider, drag or keys) and drop
    const fire = (el, type, x = 0) => el && el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x }));
    const sl = d.querySelector('#ccAim'), st = d.querySelector('#ccStage');
    if (n % 3 === 0) { sl.value = String(Math.round(Math.random() * 200 - 100)); sl.dispatchEvent(new w.Event('input', { bubbles: true })); }
    else if (n % 3 === 1) { fire(st, 'pointerdown', 150); fire(st, 'pointermove', 150 + pick([-60, 60])); fire(st, 'pointerup'); }
    else w.dispatchEvent(new w.KeyboardEvent('keydown', { code: pick(['ArrowLeft', 'ArrowRight']), bubbles: true }));
    setTimeout(() => d.querySelector('#ccDrop')?.click(), 200);
  },
  tide(d, S, n, w) {  // pick a tool, tap the beach, and (now and then) say ready
    const tools = [...d.querySelectorAll('#tcTools [data-t]')];
    pick(tools)?.click();
    d.querySelector('#tcStage')?.dispatchEvent(new w.MouseEvent('click', { bubbles: true, clientX: 100 + Math.random() * 150, clientY: 100 + Math.random() * 150 }));
    if (n % 4 === 3) d.querySelector('#tcReady')?.click();
  },
  midway(d, S, n, w) {  // swipes up on the booth (aim + power), and the buttons / keys
    const fire = (el, type, x = 0, y = 0) => el && el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    const st = d.querySelector('#mwStage'), kind = n % 3;
    if (kind === 0) { fire(st, 'pointerdown', 150, 260); fire(st, 'pointermove', 150 + pick([-40, 0, 30]), 260 - pick([60, 120, 180])); fire(st, 'pointerup', 150, 100); }
    else if (kind === 1) { d.querySelector(`#mwCtl [data-a="${pick([-1, 1])}"]`)?.click(); d.querySelector('#mwGo')?.click(); }
    else w.dispatchEvent(new w.KeyboardEvent('keydown', { key: pick(['ArrowUp', 'ArrowLeft', ' ']), bubbles: true }));
  },
  planes(d, S, n, w) {  // fold chips, swipes up on the park (aim + power), the buttons and keys
    const fire = (el, type, x = 0, y = 0) => el && el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    const st = d.querySelector('#plStage'), kind = n % 4;
    d.querySelector(`#plFolds [data-f="${pick(['dart', 'glider', 'stunt'])}"]`)?.click();
    if (kind === 0) { fire(st, 'pointerdown', 150, 260); fire(st, 'pointermove', 150 + pick([-40, 0, 30]), 260 - pick([60, 120, 180])); fire(st, 'pointerup', 150, 100); }
    else if (kind === 1) { d.querySelector(`#plCtl [data-l="${pick([-1, 1])}"]`)?.click(); if (n % 8 === 1) d.querySelector('#plClip')?.click(); d.querySelector('#plGo')?.click(); }
    else w.dispatchEvent(new w.KeyboardEvent('keydown', { key: pick(['ArrowUp', 'ArrowLeft', 'w', '3', ' ']), bubbles: true }));
  },
  orbit(d, S, n, w) {  // slingshot drags on the course, the buttons and keys
    const fire = (el, type, x = 0, y = 0) => el && el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    const st = d.querySelector('#ogStage'), kind = n % 3;
    if (kind === 0) { fire(st, 'pointerdown', 200, 200); fire(st, 'pointermove', 200 + pick([-30, 0, 30]), 200 + pick([40, 80, 140])); fire(st, 'pointerup', 200, 300); }
    else if (kind === 1) { d.querySelector(`#ogCtl [data-p="${pick([-1, 1])}"]`)?.click(); d.querySelector('#ogGo')?.click(); }
    else w.dispatchEvent(new w.KeyboardEvent('keydown', { key: pick(['ArrowUp', 'ArrowLeft', ' ']), bubbles: true }));
  },
  pond(d, S, n, w) {  // taps on the ice (drill / drop), the big button (hook, hold to reel) and Space
    const fire = (el, type, x = 0, y = 0) => el && el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    const st = d.querySelector('#fpStage'), go = d.querySelector('#fpGo'), ln = S.pond.anglers[S.pond.me]?.line?.st;
    if (ln === 'fight') { fire(go, 'pointerdown'); setTimeout(() => fire(go, 'pointerup'), pick([300, 900, 1500])); }
    else if (n % 7 === 5 && !d.querySelector('#fpDrill')?.hidden) d.querySelector('#fpDrill').click();
    else if (ln === 'bite' || n % 3 === 0) fire(go, 'pointerdown');
    else if (n % 3 === 1) fire(st, 'pointerdown', 100 + pick([0, 60, 120]), 150 + pick([0, 50, 100]));
    else { w.dispatchEvent(new w.KeyboardEvent('keydown', { key: ' ', bubbles: true })); w.dispatchEvent(new w.KeyboardEvent('keyup', { key: ' ', bubbles: true })); }
  },
  domino(d, S, n, w) {  // taps on the table (pick / turn a square), the piece chips, ⟳ and ✔ Place, and keys
    const st = d.querySelector('#dmStage'), click = (el, x = 0, y = 0) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
    if (n % 5 === 4) { d.querySelector(`#dmKinds [data-k="${pick(['split', 'pirate', 'domino'])}"]`)?.click(); return; }
    if (n % 2 === 0) { click(st, 60 + Math.floor(Math.random() * 280), 80 + Math.floor(Math.random() * 300)); if (n % 4 === 0) d.querySelector('#dmRot')?.click(); d.querySelector('#dmGo')?.click(); }
    else { w.dispatchEvent(new w.KeyboardEvent('keydown', { key: pick(['ArrowUp', 'ArrowLeft', 'ArrowRight', 'r']), bubbles: true })); w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
  },
  regatta(d, S, n, w) {  // sideways drags (steer), the held ◀ ▶ buttons, ⟲ Tack and keys
    const fire = (el, type, x = 0, y = 0) => el && el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    const st = d.querySelector('#rgStage'), kind = n % 4;
    if (kind === 0) { fire(st, 'pointerdown', 150, 150); fire(st, 'pointermove', 150 + pick([-80, 80]), 150); setTimeout(() => fire(st, 'pointerup'), 600); }
    else if (kind === 1) { const b = d.querySelector(pick(['#rgL', '#rgR'])); fire(b, 'pointerdown'); setTimeout(() => fire(b, 'pointerup'), pick([200, 900])); }
    else if (kind === 2) d.querySelector(n % 8 === 2 ? '#rgTack' : '#rgFire')?.click();
    else { const key = pick(['ArrowLeft', 'ArrowRight', 'a', 'd', 'f']); w.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true })); setTimeout(() => w.dispatchEvent(new w.KeyboardEvent('keyup', { key, bubbles: true })), 400); }
  },
  rapids(d, S, n, w) {  // sideways drags (steer), taps (paddle), a held paddle button (brace) and keys
    const fire = (el, type, x = 0, y = 0) => el && el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    const st = d.querySelector('#rpStage'), btn = d.querySelector('#rpPaddle'), kind = n % 4;
    if (kind === 0) { fire(st, 'pointerdown', 150, 150); fire(st, 'pointermove', 150 + pick([-60, 60]), 150); setTimeout(() => fire(st, 'pointerup'), 500); }
    else if (kind === 1) { fire(st, 'pointerdown', 150, 150); fire(st, 'pointerup', 150, 150); }
    else if (kind === 2) { fire(btn, 'pointerdown'); setTimeout(() => fire(btn, 'pointerup'), pick([80, 900])); }
    else {
      const code = pick(['KeyA', 'KeyD', 'ArrowLeft', 'Space', 'KeyS']);
      w.dispatchEvent(new w.KeyboardEvent('keydown', { code, bubbles: true }));
      setTimeout(() => w.dispatchEvent(new w.KeyboardEvent('keyup', { code, bubbles: true })), 300);
    }
  },
  paintblast(d, S, n, w) {  // mix pad holds, arena swipes/taps and keys
    const fire = (el, type, x = 0, y = 0) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    const kind = n % 4;
    if (kind === 0) {  // press the d-pad off-centre, slide round to another direction, let go
      const pad = d.querySelector('#pbPad');
      fire(pad, 'pointerdown', pick([-50, 50]), 0); fire(pad, 'pointermove', 0, pick([-50, 50]));
      setTimeout(() => fire(pad, 'pointerup'), 200);
    }
    else if (kind === 1) { const st = d.querySelector('#pbStage'); fire(st, 'pointerdown', 100, 100); fire(st, 'pointerup', 100, 100); }
    else if (kind === 2) { const st = d.querySelector('#pbStage'); fire(st, 'pointerdown', 100, 100); fire(st, 'pointermove', 100 + pick([-40, 40]), 100); setTimeout(() => fire(st, 'pointerup'), 250); }
    else {
      const code = pick(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
      w.dispatchEvent(new w.KeyboardEvent('keydown', { code, bubbles: true }));
      setTimeout(() => w.dispatchEvent(new w.KeyboardEvent('keyup', { code, bubbles: true })), 200);
    }
  },
  oware(d, S, n, w) {
    const o = S.oware, toggle = d.querySelector('#owPreviewToggle');
    if (o.legal.length && n % 9 === 4 && !toggle.classList.contains('on')) {
      click(toggle);
      const pit = o.legal[0], cell = d.querySelector(`.ow-pit[data-i="${pit}"]`);
      click(cell);
      const expect = w.UI.oware.testPreview(o.pits, pit, o.me), actual = [...d.querySelectorAll('.ow-pit.takes')].map((b) => +b.dataset.i).sort((a, b) => a - b);
      if (JSON.stringify(actual) !== JSON.stringify([...expect.taken].sort((a, b) => a - b))) nodeErrors.push('Oware touch preview disagrees with its sowing capture simulation');
      click(d.querySelector(`.ow-pit[data-i="${pit}"]`)); return;
    }
    click(pick([...d.querySelectorAll('.ow-pit.can:not(:disabled)')]));
  },
  reversi(d) { click(pick([...d.querySelectorAll('.rv-cell.can')])); },
  ultimate(d) { click(pick([...d.querySelectorAll('.ut-cell.can')])); },
  realm(d, S, n) {  // draft all onto one land; attack (blitz) from a land with a rival neighbour; move in; end the turn
    const m = S.realm, btns = [...d.querySelectorAll('#rwBar button:not(:disabled)')];
    const b = (t) => btns.find((x) => x.textContent.includes(t));
    if (n % 6 === 2) {  // follow the 💡 advisor now and then
      const tog = d.querySelector('#rwBar .rw-advtog');
      if (tog && !tog.classList.contains('on')) click(tog);
      const go = d.querySelector('#rwBar .rw-advdo');
      if (go) return click(go);
    }
    if (m.phase === 'claim') return click(pick([...d.querySelectorAll('#rwMap .rw-node.can')]));
    if (m.phase === 'draft') {
      if (b('Trade')) return click(b('Trade'));
      if (n % 7 === 3 && b('Fort')) { click(b('Fort')); return click(pick([...d.querySelectorAll('#rwMap .rw-node.can')])); }
      if (n % 9 === 5 && b('Undo')) return click(b('Undo'));
      click(b('All'));
      return click(pick([...d.querySelectorAll('#rwMap .rw-node.can')]));
    }
    if (m.phase === 'occupy') return click(b('Move in'));
    if (m.phase === 'fortify' || n % 5 === 4) return click(b('End turn'));
    if (b('Blitz')) return click(b('Blitz'));
    for (const g of d.querySelectorAll('#rwMap .rw-node.mine.can')) {
      click(g);
      const t = d.querySelector('#rwMap .rw-node.target');
      if (t) return click(t);
      click(g);  // no rival next to it: let go and try the next
    }
    click(b('End turn'));
  },
  morris(d, S, n, w) {  // place, or pick a man then a point; take a man after a mill
    const tap = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    for (let k = 0; k < 3; k++) {
      const take = [...d.querySelectorAll('.mm-pt.take')], can = [...d.querySelectorAll('.mm-pt.can')], src = [...d.querySelectorAll('.mm-pt.src')];
      if (take.length) tap(pick(take)); else if (can.length) tap(pick(can)); else if (src.length) tap(pick(src)); else return;
    }
  },
  ratscrew(d, S) {
    // slap only real doubles and sandwiches (read off the pile's cards), otherwise flip
    const root = d.querySelector('.ct-ratscrew'), ranks = [...root.querySelectorAll('.ct-piles .pc')].map((c) => c.dataset.face?.slice(0, -1));
    const n = ranks.length, slap = root.querySelector('.ct-btns button.slap'), flip = root.querySelector('.ct-btns button.primary');
    if (slap && n >= 2 && (ranks[n - 1] === ranks[n - 2] || (n >= 3 && ranks[n - 1] === ranks[n - 3]))) return click(slap);
    if (flip) click(flip);
  },
  hearts(d, S) {
    if (S.hearts.stage === 'pass') {
      const cards = [...d.querySelectorAll('#hhHand .card-btn:not(:disabled)')].slice(0, 3);
      cards.forEach((c) => click(c));
      const sent = S.hearts.hand.slice(0, 3);
      const points = sent.reduce((sum, card) => sum + (card[1] === 'H' ? 1 : card === 'QS' ? 13 : 0), 0);
      const preview = d.querySelector('#hhPassPreview');
      if (preview.hidden || !preview.textContent.includes(`${points} pts passed`)) {
        throw new Error('Hearts pass preview does not match the selected cards');
      }
      return click(d.querySelector('#hhPass'));
    }
    click(pick([...d.querySelectorAll('#hhHand .card-btn:not(:disabled)')]));
  },
  trivia(d) { click(pick([...d.querySelectorAll('.tv-opt:not(:disabled)')])); },
  liars(d, S) {
    const go = d.querySelector('#lrGo'), liar = d.querySelector('#lrLiar');
    if (S.liars.bid && (Math.random() < 0.3 || go.disabled)) return click(liar);
    if (S.liars.bid && Math.random() < 0.1 && !d.querySelector('#lrExact').hidden) return click(d.querySelector('#lrExact'));
    if (Math.random() < 0.3) click(pick([...d.querySelectorAll('#lrFaces .ya-die')]));
    if (Math.random() < 0.3) click(d.querySelector('#lrMore'));
    const g2 = d.querySelector('#lrGo');
    click(g2.disabled ? liar : g2);
  },
  midnight(d) {  // roll, or keep a die or two and roll on
    const roll = d.querySelector('#mdRoll');
    if (!roll) return;
    if (!roll.hidden) return click(roll);
    const dice = [...d.querySelectorAll('#mdDice .ya-die:not(:disabled)')];
    if (!dice.length) return;
    click(dice[0]);
    if (dice.length > 1 && Math.random() < 0.4) click(d.querySelectorAll('#mdDice .ya-die')[1]);
    click(d.querySelector('#mdKeep'));
  },
  mia(d) {  // roll / believe, sometimes lift; announce from the ladder
    const roll = d.querySelector('#miaRoll'), lift = d.querySelector('#miaLift'), conc = d.querySelector('#miaConcede');
    if (!roll) return;
    if (!d.querySelector('#miaSay').hidden) {
      if (Math.random() < 0.3) { const s = [...d.querySelectorAll('.mia-step:not(:disabled)')]; if (s.length) click(s[Math.floor(Math.random() * Math.min(3, s.length))]); }
      return click(d.querySelector('#miaSay'));
    }
    if (!conc.hidden) return click(Math.random() < 0.5 ? conc : lift);
    if (!lift.hidden && (Math.random() < 0.3 || roll.hidden)) return click(lift);
    if (!roll.hidden) click(roll);
  },
  bingo(d, S) {  // pick cards and get ready; then daub a glowing called number, and claim when BINGO! lights up
    if (S.bingo.stage === 'deal') return click(enabled(d, '#bgoReady')[0]);
    const hot = d.querySelector('#bgoBingo.hot:not(:disabled)');
    if (hot) return click(hot);
    click(pick([...d.querySelectorAll('.bgo-cell.called:not(.d)')]));
  },
  squares(d) { const sel = d.querySelector('.dsq-cell.sel:not(:disabled)'), cells = [...d.querySelectorAll('.dsq-cell:not(:disabled)')]; if (sel) click(sel); else if (cells.length) click(pick(cells)); },  // 🔮 tap to forecast, tap again to place
  brawl(d) {  // roll, hold a die now and then, fight
    const roll = d.querySelector('#brwRoll'), fight = d.querySelector('#brwFight');
    if (!roll) return;
    if (!fight.hidden && (roll.hidden || Math.random() < 0.4)) return click(fight);
    const free = [...d.querySelectorAll('.brw-die:not(:disabled)')];
    if (free.length && Math.random() < 0.5) click(free[0]);
    const r2 = d.querySelector('#brwRoll');
    click(r2.disabled ? d.querySelector('#brwFight') : r2);
  },
  derby(d) {  // roll, then tap the three dice in some order and go
    const roll = d.querySelector('#dbyRoll');
    if (!roll) return;
    if (!roll.hidden) return click(roll);
    for (let k = 0; k < 3; k++) { const f = [...d.querySelectorAll('#dbyDice .ya-die:not(:disabled)')]; if (f.length) click(pick(f)); }
    click(d.querySelector('#dbyGo'));
  },
  shipcrew(d) {
    const roll = d.querySelector('#scRoll'), dock = d.querySelector('#scDock');
    if (!dock.hidden && (Math.random() < 0.5 || roll.hidden)) return click(dock);
    if (!roll.hidden && !d.querySelector('#scFree .ya-die:not(:disabled)') && roll.disabled) return click(dock);
    if (Math.random() < 0.3) { const c = d.querySelector('#scFree .ya-die:not(:disabled)'); if (c) click(c); }
    const r2 = d.querySelector('#scRoll');
    click(r2.disabled ? d.querySelector('#scFree .ya-die:not(:disabled)') : r2);
  },
  shutbox(d, S) {  // roll (one die now and then), or tap the tiles of one fitting set and Shut
    const r1 = d.querySelector('#sbRoll1'), r2 = d.querySelector('#sbRoll2');
    if (!r2.hidden) return click(!r1.hidden && Math.random() < 0.5 ? r1 : r2);
    const opts = S.shutbox.options;
    if (!opts.length) return;
    for (const b of [...d.querySelectorAll('#sbBox .sb-tile.picked')]) click(b);
    const want = opts[Math.floor(Math.random() * opts.length)];
    for (const v of want) click([...d.querySelectorAll('#sbBox .sb-tile')].find((b) => b.textContent === String(v)));
    const shut = d.querySelector('#sbShut');
    if (shut.disabled) throw new Error(`Shut stayed disabled after picking ${want} (roll ${S.shutbox.dice})`);
    click(shut);
  },
  freecell(d, S, n, w) { patienceMove('freecell', 'fc', d, S, n, w); },
  klondike(d, S, n, w) { patienceMove('klondike', 'kl', d, S, n, w); },
  sudoku(d, S, n, w) {
    // Mostly hints; now and then a digit typed into an empty cell (often wrong, which must bounce off).
    const v = S.sudoku;
    if (n % 3 !== 1) return click(d.querySelector('#sdHint'));
    const empty = [...d.querySelectorAll('#sdBoard .sd-cell')].filter((c) => !v.grid[+c.dataset.i]);
    if (!empty.length) return;
    click(pick(empty));
    if (n % 6 === 4) { click(d.querySelector('#sdPencil')); click(pick(enabled(d, '#sdPad .sd-key'))); return click(d.querySelector('#sdPencil')); }
    click(pick(enabled(d, '#sdPad .sd-key')));
  },
  minesweeper(d, S, n, w) {
    // Mostly hints; now and then a tap on a covered square (a mine costs points but must not end the game), a flag, a chord.
    const v = S.minesweeper;
    const tap = (el) => { for (const t of ['pointerdown', 'pointerup']) el.dispatchEvent(new w.MouseEvent(t, { bubbles: true, cancelable: true, button: 0 })); };
    const cells = [...d.querySelectorAll('#swpBoard .swp-cell')];
    if (n % 4 === 1 && !d.querySelector('#swpHint').disabled) return click(d.querySelector('#swpHint'));
    const covered = cells.filter((c) => v.grid[+c.dataset.i] === -1);
    if (n % 5 === 2 && covered.length) { click(d.querySelector('#swpFlag')); tap(pick(covered)); return click(d.querySelector('#swpFlag')); }
    const chord = cells.filter((c) => c.classList.contains('chordable'));
    if (chord.length && n % 3 === 0) return tap(pick(chord));
    if (covered.length) tap(pick(covered));
  },
  wordsearch(d, S, n, w) {
    // Find an open word in the grid the way a person would (scan every line), then tap its first and last letters.
    const v = S.wordsearch, N = v.size, cells = [...d.querySelectorAll('#wfGrid .wf-cell')];
    const tap = (el) => { for (const t of ['pointerdown', 'pointerup']) el.dispatchEvent(new w.MouseEvent(t, { bubbles: true, cancelable: true, button: 0 })); };
    if (n % 7 === 3) return tap(pick(cells)), tap(pick(cells));   // a miss
    const open = v.words.filter((x) => !(x in v.owners));
    for (const word of open) for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]]) {
      let k = 0;
      while (k < word.length && v.grid[r + dr * k]?.[c + dc * k] === word[k]) k++;
      if (k === word.length) { tap(cells[r * N + c]); tap(cells[(r + dr * (k - 1)) * N + c + dc * (k - 1)]); return; }
    }
  },
  garden(d, S, n, w) {
    // The driver can't see the answers: it spells random 3–4 letter tries from the ring (plenty are bonus
    // words, which earn drops), and spends drops on hints, which fill the garden in the end.
    const v = S.garden;
    if (v.drops > 0 && n % 3 === 2 && !v.done) return click(d.querySelector('#gdHint'));
    if (!v.drops && n % 25 === 24) return click(d.querySelector('#gdBank'));   // out of hints: rest
    const tap = (el) => { for (const t of ['pointerdown', 'pointerup']) el.dispatchEvent(new w.MouseEvent(t, { bubbles: true, cancelable: true, button: 0 })); };
    const ls = [...d.querySelectorAll('#gdRing .gd-l')].sort(() => Math.random() - 0.5).slice(0, 3 + (n % 2));
    click(d.querySelector('#gdClear'));
    for (const el of ls) tap(el);
    click(d.querySelector('#gdPlant'));
  },
  ladder(d, S, n, w) {
    // Mostly hints (always a legal step); sometimes a typed word (often rejected) or a step back.
    const r = Math.random();
    if (r < 0.15 && !d.querySelector('#ldUndo').disabled) return click(d.querySelector('#ldUndo'));
    if (r < 0.35) {
      const last = S.ladder.path[S.ladder.path.length - 1];
      d.querySelector('#ldInput').value = S.ladder.target[0] + last.slice(1);
      return d.querySelector('#ldForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    }
    click(d.querySelector('#ldHint'));
  },
  wordbomb(d, S, n, w) {
    // Type a dictionary word with the bomb's letters (now and then a bad one, to see it refused), key by key.
    if (S.wordbomb.holder !== S.me.id || S.wordbomb.stage !== 'lit') return;
    WB_WORDS ??= require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'words.txt'), 'utf8').split('\n').map((x) => x.trim().toUpperCase());
    const fits = WB_WORDS.filter((x) => x.includes(S.wordbomb.chunk) && x.length >= 3 && x.length <= 8);
    const word = Math.random() < 0.15 ? 'ZZ' + S.wordbomb.chunk + 'QX' : fits[Math.floor(Math.random() * fits.length)];
    const inp = d.querySelector('#wbInput');
    for (let k = 1; k <= word.length; k++) { inp.value = word.slice(0, k); inp.dispatchEvent(new w.Event('input', { bubbles: true })); }
    d.querySelector('#wbForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  },
  speed(d, S, n, w) {  // play a fitting card; when it fits both piles, tap a lifted pile
    const ok = [...d.querySelectorAll('#spHand .card-btn.ok:not(:disabled)')];
    if (!ok.length) return;
    click(pick(ok));
    const t = [...d.querySelectorAll('.sp-pile.target')];
    if (t.length) t[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  },
  twentyone(d) {
    const deal = d.querySelector('.to-deal:not(:disabled)');
    if (deal && Math.random() < 0.6) return click(deal);
    const chips = [...d.querySelectorAll('.to-chip:not(:disabled)')];
    if (chips.length) return click(pick(chips));
    if (deal) return click(deal);
    click(pick([...d.querySelectorAll('#toBar button:not(:disabled)')]));
  },
  rummy(d, S, n, w) {
    if (n === 1) {  // drag the last card of the hand to the front (#59)
      const cards = [...d.querySelectorAll('#ruHand .card-btn')], last = cards.at(-1);
      const fire = (el, type, x, y) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
      fire(last, 'pointerdown', 50, 0); fire(last, 'pointermove', 10, 0); fire(last, 'pointerup', -5, 0);
      const now = [...d.querySelectorAll('#ruHand .card-btn')].map((x) => x.dataset.card);
      if (now[0] !== last.dataset.card || !d.querySelector('#ruSort .seg-opt.on')?.textContent.includes('My order')) throw new Error('drag to reorder did not move the card');
      return;
    }
    for (const id of ['#ruDeck', '#ruDiscard']) { const b = d.querySelector(id); if (!b.disabled) return click(b); }
    const lay = d.querySelector('#ruLay');
    if (!lay.hidden && !lay.disabled) return click(lay);
    click(pick([...d.querySelectorAll('#ruHand .card-btn:not(.idle)')]));
    click(d.querySelector('#ruThrow'));
  },
  cannon(d, S, n, w) {  // drag to aim (sometimes a special shell), then fire once the last shells have landed
    const fire = (el, type, x, y) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    const st = d.querySelector('#cnStage');
    fire(st, 'pointerdown', 200, 100);
    fire(st, 'pointermove', 200 + Math.round(Math.random() * 160 - 80), 100 + 20 + Math.round(Math.random() * 80));
    fire(st, 'pointerup', 0, 0);
    if (n % 3 === 2) click(pick(enabled(d, '.cn-shell')));
    click(d.querySelector('#cnFire'));
  },
  stones(d, S, n, w) {  // nudge the aim, pick a weight / curl, throw once the ice is still; sweep (#187) while it slides
    const pad = d.querySelector('#icPad');
    if (pad && !pad.hidden) {   // your stone is sliding: hold the pad, scrub it now and then
      const fire = (type, x) => pad.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: 50 }));
      fire('pointerdown', 100); if (n % 2) { fire('pointermove', 180); fire('pointermove', 100); }
      if (n % 3 === 0) fire('pointerup', 100);
      return;
    }
    click(pick([...d.querySelectorAll('#icCtl [data-a]')]));
    if (n % 2) click(pick([...d.querySelectorAll('#icCurl button')]));
    if (n % 4 === 1) click(pick([...d.querySelectorAll('#icCtl [data-w]')]));
    const wt = d.querySelector('#icWeight');
    wt.value = String(380 + Math.round(Math.random() * 300)); wt.dispatchEvent(new w.Event('input', { bubbles: true }));
    click(d.querySelector('#icThrow'));
  },
  archery(d, S, n, w) {
    if (S.darts) {
      const button = d.querySelector('.ar-darts-swipe:enabled');
      if (button) {
        button.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true }));
        button.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }
      return;
    }
    // Nudge the sight a few steps, sometimes using steady breath or a fire arrow.
    for (let k = 0; k < 1 + (n % 4); k++) click(pick([...d.querySelectorAll('#arCtl [data-n]')]));
    if (n % 5 === 3) click(d.querySelector('#arBreath'));
    if (n % 3 === 1) { const f = d.querySelector('#arFire'); if (f && !f.disabled && !f.hidden) click(f); }   // #177 a fire arrow now and then
    click(d.querySelector('#arLoose'));
  },
  wobble(d, S, n, w) {  // pick the next player's block when it's our gift, else nudge the ghost about and place it
    if (S.wobble.mode === 'pull') {  // 🪵 #190: tap a spot on top when stacking, else step to a plank (◀ ▶) and 🪵 Pull it
      const slots = enabled(d, '#wbSCtl button[data-slot]');
      if (slots.length) return click(pick(slots));
      for (let k = 0; k < 1 + (n % 3); k++) click(d.querySelector(n % 2 ? '#wbPrev' : '#wbNextP'));
      const b = d.querySelector('#wbPull');
      if (b && !b.disabled) click(b);
      return;
    }
    const gift = [...d.querySelectorAll('#wbPicks button')];
    if (gift.length && !d.querySelector('#wbGift').hidden) return click(pick(gift));
    if (n % 2) click(pick([...d.querySelectorAll('.wb-pad button')]));
    if (n % 3 === 1) click(d.querySelector('#wbRot'));
    const pl = d.querySelector('#wbPlace');
    if (pl && !pl.disabled) click(pl);
  },
  lanes(d, S, n, w) {  // stand somewhere, set the hook, then drag back on the lane and let go
    const fire = (el, type, x, y) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    const st = d.querySelector('#lnStage'), sp = d.querySelector('#lnSpin');
    if (!st || !sp) return;
    if (n % 3 === 0) click(pick([...d.querySelectorAll('.ln-dial button')]));
    sp.value = String(-20 - Math.round(Math.random() * 60)); sp.dispatchEvent(new w.Event('input', { bubbles: true }));
    const sv = d.querySelector('#lnSaver'); if (sv && !sv.hidden && n % 2) click(sv);
    fire(st, 'pointerdown', 150, 100);
    fire(st, 'pointermove', 150 + Math.round(Math.random() * 20 - 10), 100 + 80 + Math.round(Math.random() * 60));
    fire(st, 'pointerup', 0, 0);
  },
  drift(d, S, n, w) {  // pick a height (sometimes with the burner) and lock in
    const picks = [...d.querySelectorAll('#skPicks button:not([disabled])')];
    if (!picks.length) return;
    click(pick(picks));
    if (n % 4 === 1) { const b = d.querySelector('#skBurn'); if (b && !b.disabled) click(b); }
    click(d.querySelector('#skGo'));
  },
  putt(d, S, n, w) {  // a slingshot drag on the course
    const fire = (el, type, x, y) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    const st = d.querySelector('#ppStage');
    fire(st, 'pointerdown', 150, 150);
    fire(st, 'pointermove', 150 + Math.round(Math.random() * 120 - 60), 150 + Math.round(Math.random() * 120));
    fire(st, 'pointerup', 0, 0);
  },
  rally(d, S, n, w) {  // hold a side of the screen, swipe up to boost, or keys
    const fire = (el, type, x, y) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    const st = d.querySelector('#raStage');
    if (n % 3 === 2) {
      const code = pick(['ArrowLeft', 'ArrowRight', 'Space', 'KeyF']);
      w.dispatchEvent(new w.KeyboardEvent('keydown', { code, bubbles: true }));
      return setTimeout(() => w.dispatchEvent(new w.KeyboardEvent('keyup', { code, bubbles: true })), 250);
    }
    const x = pick([40, 280]);
    fire(st, 'pointerdown', x, 200);
    if (n % 3 === 1) fire(st, 'pointermove', x, 120);
    setTimeout(() => fire(st, 'pointerup', x, 120), 300);
  },
  farkle(d, S) {
    const f = S.farkle;
    if (f.rolled) {
      click(d.querySelector('#fkBest'));
      if (!d.querySelector('#fkBank').disabled && Math.random() < 0.4) return click(d.querySelector('#fkBank'));
    }
    click(d.querySelector('#fkRoll'));
  },
  yacht(d, S) {
    const boxes = enabled(d, '.ya-box');
    if (boxes.length && (S.yacht.rollsLeft === 0 || Math.random() < 0.4)) return click(pick(boxes));
    for (const b of enabled(d, '.ya-die')) if (Math.random() < 0.4) click(b);
    click(d.querySelector('#yaRoll'));
  },
  cribbage(d, S) {
    if (!d.querySelector('#cbDiscard').hidden) {
      for (const b of enabled(d, '#cbHand .card-btn').slice(0, S.cribbage.need)) click(b);
      return click(d.querySelector('#cbDiscard'));
    }
    click(pick(enabled(d, '#cbHand .card-btn')));
  },
  holdem(d) {
    if (!d.querySelector('#heRebuy').hidden) return click(d.querySelector('#heRebuy'));
    const opts = enabled(d, '#heCall, #heFold, #heRaise, .he-presets button');
    const call = d.querySelector('#heCall');
    if (!call.disabled && Math.random() < 0.6) return click(call);
    const preset = pick(enabled(d, '.he-presets button'));
    if (preset && Math.random() < 0.5) { click(preset); return click(d.querySelector('#heRaise')); }
    click(pick(opts));
  },
  billiards(d, S, n, w) {
    if (d.querySelector('#blShoot').disabled) return;  // a shot is still rolling
    if (S.billiards.calling) {  // on the 8: tap the pocket at table (0, 0) to call it (jsdom: canvas at the page's top left)
      const c = d.querySelector('#blCanvas'), B = S.billiards, RAIL = 6, portrait = parseFloat(c.style.height) > parseFloat(c.style.width);
      const k = parseFloat(c.style.width) / (portrait ? B.H + 2 * RAIL : B.W + 2 * RAIL);
      const [x, y] = portrait ? [RAIL * k, (RAIL + B.W) * k] : [RAIL * k, RAIL * k];
      c.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
      if (!d.querySelector('#blStatus').textContent.includes('called pocket')) throw new Error(`tapping a pocket did not call it (canvas ${c.style.width}×${c.style.height}, tapped ${x.toFixed(1)},${y.toFixed(1)})`);
    }
    const spin = d.querySelector('#blSpin');
    spin.value = String(pick([-50, 0, 50])); spin.dispatchEvent(new w.Event('input', { bubbles: true }));
    const power = d.querySelector('#blPower');
    power.value = String(30 + Math.floor(Math.random() * 70));
    power.dispatchEvent(new w.Event('input', { bubbles: true }));
    click(enabled(d, '#blShoot')[0]);
  },
  prism(d, S, n, w) {   // one legal swap with the keyboard cursor: walk to the gem, Enter, step to its neighbour, Enter
    const key = (k) => w.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
    const t = w.UI.prism.testState();
    if (!t.move || t.busy) return;
    if (t.cursor == null) key('ArrowRight');
    let cur = w.UI.prism.testState().cursor;
    const walk = (to) => {
      while (cur % 8 < to % 8) { key('ArrowRight'); cur++; }
      while (cur % 8 > to % 8) { key('ArrowLeft'); cur--; }
      while (cur < to) { key('ArrowDown'); cur += 8; }
      while (cur > to) { key('ArrowUp'); cur -= 8; }
    };
    const before = t.score;
    walk(t.move[0]); key('Enter'); walk(t.move[1]); key('Enter');
    if (!w.UI.prism.testState().busy && w.UI.prism.testState().score === before) throw new Error(`the swap ${t.move} did nothing`);
  },
  marble(d, S, n, w) {   // roll about with the keys a moment, then (once a real run could have got there) drop on the goal
    const t = w.UI.marble.testState(), m = S.marble;
    if (!t || !t.racing || t.done) return;
    const k = `${m.round}`;
    if (w.__mbRound !== k) { w.__mbRound = k; w.__mbAt = Date.now(); }
    const key = (type, k2) => w.dispatchEvent(new w.KeyboardEvent(type, { key: k2, bubbles: true }));
    const dir = pick(['ArrowRight', 'ArrowDown']);
    key('keydown', dir); setTimeout(() => key('keyup', dir), 250);
    if (Date.now() - w.__mbAt > (m.course.path.length / 6 + 1) * 1000) w.UI.marble.testWarp(m.course.goal[0] + 0.5, m.course.goal[1] + 0.5);
  },
  spire(d, S, n, w) {
    const upgrade = enabled(d, '#spUpgrade button');
    if (upgrade.length) { click(pick(upgrade)); return; }
    const key = (k) => w.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
    key(pick(['ArrowLeft', 'ArrowRight', 'ArrowUp', ' ', ' ', 'c']));
  },
  starguard(d, S, n, w) {  // drag the ship to a few spots along the bottom, and drop the bomb now and then
    const c = d.querySelector('#sgCanvas');
    c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 512 });
    for (const type of ['pointerdown', 'pointermove']) c.dispatchEvent(new w.MouseEvent(type, { clientX: 30 + Math.random() * 260, clientY: 480, buttons: 1 }));
    if (n % 9 === 5) d.querySelector('#sgBomb')?.click();
  },
  skydrop(d, S, n, w) {
    const st=d.querySelector('#sdStage'), x=150+pick([-70,0,70]), y=170+pick([-70,0,70]);
    st.dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true,clientX:150,clientY:180}));
    st.dispatchEvent(new w.MouseEvent('pointermove',{bubbles:true,clientX:x,clientY:y}));
    st.dispatchEvent(new w.MouseEvent('pointerup',{bubbles:true,clientX:x,clientY:y}));
    if(n%4===0)click(d.querySelector('#sdBoost'));
  },
};

const UI_MINE = (f) => (f.stage === 'write' && !f.mine) || (f.stage === 'pick' && f.myPick == null);

async function playSolo(game, seconds = 60) {
  const [, mode] = game.split(':');   // e.g. wobble:pull plays that game in that mode
  game = game.split(':')[0];
  const { w, d, errors, close } = await openPage(game === 'hockey' || game === 'starguard' || game === 'riders' || game === 'whisker' || game === 'paintblast' || game === 'sumo' || game === 'snowball' || game === 'tops' || game === 'lander' || game === 'rapids' || game === 'midway' || game === 'planes' || game === 'pond' || game === 'regatta' || game === 'putt' || game === 'rally' || game === 'prism' || game === 'marble' || game === 'skydrop' || game === 'fuse');
  const S = () => w.eval('S');
  const report = { game, moves: 0, phase: null, notes: [] };
  d.querySelector('#name').value = 'Tester';
  d.querySelector('#soloGame').value = game;
  d.querySelector('#soloLevel').value = 'easy';
  if (mode) {
    click(d.querySelector('#soloSetupBtn'));
    await waitFor(() => w.eval('S')?.phase === 'lobby' && w.eval('S').players?.length > 1);
    const setting = game === 'archery' ? 'course' : 'mode';
    await w.eval(`act('settings', { settings: ${JSON.stringify({ [setting]: mode })} })`);
    await w.eval(`act('start')`);
  } else click(d.querySelector('#soloBtn'));
  // …and the game's screen module has loaded and mounted (it loads on demand: slow on a busy host)
  if (!(await waitFor(() => !d.querySelector('#game').hidden && S()?.phase === 'playing' && !!w.eval('mounted'), 30000))) report.notes.push('never reached the game screen');
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end && S()?.phase === 'playing') {
    const s = S();
    const mine = s.turn === s.me.id || (game === 'heist' && !s.heist.mine) || (game === 'lantern' && !s.lantern.mine) || (game === 'squares' && !s.squares.mine) || (game === 'bingo' && !!s.bingo.cards && (s.bingo.stage === 'call' || !s.bingo.ready)) || (game === 'oddone' && s.oddone.stage === 'vote' && !s.oddone.myVote) || (game === 'fibfinder' && UI_MINE(s.fibfinder)) || (game === 'holdem' && s.holdem.canRebuy) || (game === 'cribbage' && s.cribbage.stage === 'discard' && s.cribbage.discarded[s.me.id] === false)
      || (game === 'relay' && (s.relay.stage === 'play' ? !s.relay.sent : s.relay.myVote == null)) || (game === 'seabattle' && s.sea.stage === 'placing' && !s.sea.ready[s.me.id])
      || (game === 'spire' && s.spire.playing && s.spire.startIn <= 0) || (game === 'prism' && s.prism.playing && s.prism.startIn <= 0) || (game === 'marble' && s.marble.playing) || (game === 'safecracker' && ['crack', 'set'].includes(s.safecracker.stage) && !s.safecracker.mine) || (game === 'gridhunt' && s.gridhunt.stage === 'hunt')
      || (game === 'doodle' && s.doodle.stage === 'draw' && !s.doodle.solvers.some(([p]) => p === s.me.id)) || game === 'hockey' || game === 'fuse' || game === 'starguard' || (game === 'riders' && s.riders.stage === 'ride') || (game === 'whisker' && s.whisker.stage === 'play') || (game === 'paintblast' && s.paintblast.st === 'play') || (game === 'sumo' && s.sumo.stage === 'play') || (game === 'snowball' && s.snowball.st === 'play') || (game === 'tops' && (s.tops.st === 'spin' || s.tops.st === 'launch')) || (game === 'lander' && s.lander.stage === 'fly' && s.lander.me != null && !s.lander.fliers[s.lander.me]?.res) || (game === 'tide' && s.tide.stage === 'build' && s.tide.me != null && !s.tide.ready[s.tide.me]) || (game === 'rapids' && s.rapids.st === 'race') || (game === 'midway' && s.midway.stage === 'play') || (game === 'planes' && s.planes.stage === 'play') || (game === 'pond' && s.pond.t >= 0) || (game === 'regatta' && s.regatta.st === 'race') || (game === 'cannon' && s.cannon.volley && !s.cannon.between && s.cannon.me != null && s.cannon.tanks[s.cannon.me]?.[2] > 0 && !s.cannon.locked.includes(s.cannon.me)) || (game === 'rally' && s.rally.stage === 'race') || (game === 'lanes' && s.lanes.me != null && !s.lanes.wait) || (game === 'drift' && Object.keys(s.drift.options || {}).length > 0 && !s.drift.mine) || (game === 'hearts' && s.hearts.stage === 'pass' && !s.hearts.myPass) || (game === 'speed' && s.speed.stage === 'play') || (game === 'trivia' && s.trivia.stage === 'ask' && s.trivia.mine == null) || (game === 'ladder' && s.ladder.stage === 'climb' && !s.ladder.done) || (game === 'skydrop' && s.skydrop.stage === 'race')
      || ((game === 'freecell' || game === 'klondike' || game === 'sudoku' || game === 'minesweeper' || game === 'wordsearch' || game === 'garden') && s[game].stage === 'play' && s[game].playing && !s[game].done && !s[game].banked)
      || (game === 'qork' && (s.qork.stage === 'snap' ? !(s.me.id in s.qork.acted) : s.qork.cupper === s.me.id && ['wait', 'dice'].includes(s.qork.stage)))
      || (CT_GAMES.has(game) && s[game]?.mine)
      || (game === 'twentyone' && s.twentyone.stage === 'bet' && !s.twentyone.bets[s.twentyone.me] && s.twentyone.chips[s.twentyone.me] > 0);
    if (game === 'lucky' && s.lucky.stage === 'wheel') { await sleep(300); continue; }
    if (mine) { try { (MOVES[game] || ((d2, s2) => ctMove(game, d2, s2)))(d, s, report.moves, w); report.moves++; } catch (e) { errors.push('driver: ' + e.stack); } }
    await sleep(60);
    // the server turned a press away as unknown: the game's action never reached it (Qork #11)
    const t = d.querySelector('#toast'); if (!t.hidden && /Unknown/.test(t.textContent) && !report.notes.includes('toast: ' + t.textContent)) report.notes.push('toast: ' + t.textContent);
    if (!d.querySelector('#modal').hidden) { report.dialogs = (report.dialogs || 0) + 1; click(d.querySelector('#modalOk')); }
    await sleep(game === 'spire' ? 120 : 350);
  }
  click(d.querySelector('#helpBtn'));
  report.help = d.querySelector('#modal').hidden ? 'no dialog' : `${d.querySelector('#modalTitle').textContent} (${d.querySelectorAll('#modalBody li').length} rules)`;
  click(d.querySelector('#modalOk'));
  report.ticker = d.querySelector('#logLast').textContent.slice(0, 40) + (d.querySelector('#log').hidden ? ' [log folded]' : ' [log open]');
  report.phase = S()?.phase;
  report.screen = d.querySelector('#turnText')?.textContent;
  if (report.phase === 'over') {
    report.banner = d.querySelector('#overText')?.textContent;
    if (game === 'doodle') {
      const gallery = d.querySelector('#ddGalleryPanel'), cards = [...d.querySelectorAll('.dd-gallery-card')];
      report.gallery = cards.length;
      if (!gallery || gallery.hidden || cards.length !== S().doodle.rounds) report.notes.push('Doodle Dash gallery missing or out of round order');
      if (cards.some((card, i) => !card.querySelector('svg') || !card.querySelector('h4')?.textContent.startsWith(`Picture ${i + 1}:`)))
        report.notes.push('Doodle Dash gallery picture data is incomplete or out of order');
    }
    // replay
    if (!d.querySelector('#replayBtn').hidden) {
      click(d.querySelector('#replayBtn'));
      await waitFor(() => !d.querySelector('#replayBar').hidden, 5000);
      if (d.querySelector('#rpPlay').textContent !== '⏸') report.notes.push('replay did not start playing');
      for (let i = 0; i < 3; i++) { click(d.querySelector('#rpNext')); await sleep(150); }
      report.replay = d.querySelector('#replayCaption').textContent.slice(0, 50);
      click(d.querySelector('#rpExit')); await sleep(300);
    }
    // chat + prefs
    click(d.querySelector('#chatBtn'));
    d.querySelector('#chatInput').value = 'gg from the test';
    d.querySelector('#chatForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => d.querySelector('#chatList').textContent.includes('gg from the test'), 5000) || report.notes.push('chat message never appeared');
    click(d.querySelector('#prefsBtn')); report.prefs = d.querySelectorAll('#prefsList input').length;
    // next-game vote: suggestions render (voting itself would start another game, so it's checked server-side)
    report.vote = d.querySelectorAll('#overVote .next-tile').length;
    if (!report.vote) report.notes.push('no next-game vote choices');
    // alone with bots a tile only picks the next game (#93): nothing starts until ▶ Play
    if (report.vote && !S().players.some((p) => !p.bot && p.id !== S().me.id)) {
      click(d.querySelector('#overVote .next-tile')); await sleep(400);
      if (S().phase !== 'over') report.notes.push('a solo next-game tile started a game straight away');
      if (d.querySelector('#playPickBtn').hidden) report.notes.push('no ▶ Play button after picking a next game');
      click(d.querySelector('#overVote .next-tile.on')); await sleep(100);  // take it back
    }
    // rematch, then back to lobby
    click(d.querySelector('#rematchBtn'));
    await waitFor(() => S().phase === 'playing', 8000) || report.notes.push('rematch did not start');
    report.rematch = S().phase;
  }
  close();
  report.errors = [...errors];
  return report;
}

async function lobbyTour() {
  const { w, d, errors, close } = await openPage();
  const S = () => w.eval('S');
  d.querySelector('#name').value = 'Host';
  click(d.querySelector('#createBtn'));
  const notes = [];
  await waitFor(() => !d.querySelector('#lobby').hidden && S()) || notes.push('lobby never showed');
  const tiles = d.querySelectorAll('#gamePicker .game-tile');
  for (const t of [...tiles].slice(0, 12)) { click(t); await sleep(250); }
  const sel = d.querySelector('#settingsBox select');
  sel.value = sel.options[sel.options.length - 1].value; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  click(d.querySelector('#addBotBtn')); await sleep(400);
  click(d.querySelector('#shareBtn'));
  await sleep(500);
  const qr = d.querySelectorAll('#modalBody .invite-qr path').length === 1 && d.querySelector('#modalBody input')?.value.includes('?room=');
  const cats = [...d.querySelectorAll('#gamePicker .picker-cat')].map((x) => x.textContent).join(' ');
  const nofit = [...d.querySelectorAll('#gamePicker .nofit small')].map((x) => x.textContent).join(',');
  // #98: families inside Cards and Dice, a jump row, and the A–Z sort as one flat list
  if (!d.querySelector('#gamePicker .picker-sub')) notes.push('no family sub-headers in the picker');
  if (!d.querySelectorAll('#pickerBar .picker-jump .chip-btn').length) notes.push('no category jump chips');
  const az = [...d.querySelectorAll('#pickerBar .picker-sorts .chip-btn')].find((b) => b.textContent.includes('A–Z'));
  click(az); await sleep(200);
  const names = [...d.querySelectorAll('#gamePicker .game-tile b')].map((b) => b.textContent);
  if (names.length !== S().games.length || names.join() !== [...names].sort((a, b) => a.localeCompare(b)).join()) notes.push('A–Z sort is not one alphabetical list');
  click([...d.querySelectorAll('#pickerBar .picker-sorts .chip-btn')][0]); await sleep(200);
  // #189: card-game tiles say so (data-cat drives the playing-card icon), and 🃏 Cards shows only them (plus the picked game)
  const cardIds = S().games.filter((g) => g.category === 'cards').map((g) => g.id);
  if ([...d.querySelectorAll('#gamePicker .game-tile[data-cat="cards"]')].length < cardIds.length) notes.push('card-game tiles lack data-cat="cards"');
  click(d.querySelector('#pickerCards')); await sleep(200);
  const onlyCards = [...d.querySelectorAll('#gamePicker .game-tile')].filter((t) => t.dataset.game !== S().gameId);
  if (!onlyCards.length || onlyCards.some((t) => t.dataset.cat !== 'cards')) notes.push('🃏 Cards filter shows other games');
  click(d.querySelector('#pickerCards')); await sleep(200);
  const howto = d.querySelectorAll('#howto li').length;
  click(d.querySelector('#leaveBtn')); await sleep(200);
  const leaveDialog = d.querySelector('#modalText').textContent; click(d.querySelector('#modalCancel'));
  if (!qr) notes.push('invite dialog has no QR code');
  if (d.querySelectorAll('#lobbyPlayers .pmark').length !== d.querySelectorAll('#lobbyPlayers li').length) notes.push('lobby players lack colour shapes');
  const out = { cats, nofit, howto, leaveDialog, qr, tiles: tiles.length, game: S().gameId, players: d.querySelectorAll('#lobbyPlayers li').length,
    settings: d.querySelectorAll('#settingsBox select').length, notes };
  close();
  return { ...out, errors };
}

async function feedbackTour() {
  const notes = [];
  // 1. report a bug from the home screen through the real dialog
  const home = await openPage();
  const d = home.d, w = home.w;
  d.querySelector('#name').value = 'Tester';
  click(d.querySelector('#reportLink'));
  await waitFor(() => !d.querySelector('#modal').hidden, 3000) || notes.push('report dialog never opened');
  const radios = [...d.querySelectorAll('input[name=reportKind]')].map((r) => r.value).join('/');
  click(d.querySelector('#modalOk'));  // empty → should re-open with a hint
  await sleep(300);
  const reopened = !d.querySelector('#modal').hidden && d.querySelector('#toast').textContent;
  d.querySelector('#reportText').value = 'The <b>chess</b> board <img src=x onerror=alert(1)> looks odd';
  click(d.querySelector('.report .ghost-btn'));  // "What's included?"
  const preview = d.querySelector('.report-pre').textContent;
  click(d.querySelector('#modalOk'));
  await waitFor(() => /Thanks!/.test(d.querySelector('#toast').textContent), 5000) || notes.push('no thank-you toast');
  const thanks = d.querySelector('#toast').textContent;
  home.close();
  // 2. report from the in-game ❓ help dialog, with game details attached
  const game = await openPage();
  game.d.querySelector('#name').value = 'Tester';
  game.d.querySelector('#soloGame').value = 'tictactoe';
  click(game.d.querySelector('#soloBtn'));
  await waitFor(() => game.w.eval('S')?.phase === 'playing');
  click(game.d.querySelector('#helpBtn'));
  click([...game.d.querySelectorAll('#modalBody button')].find((b) => /Something wrong/.test(b.textContent)));
  await sleep(200);
  game.d.querySelector('#reportText').value = 'Tic-tac-toe felt slow after my move';
  click(game.d.querySelector('#modalOk'));
  await waitFor(() => /Thanks!/.test(game.d.querySelector('#toast').textContent), 5000) || notes.push('in-game report failed');
  game.close();
  // 3. the inbox page renders reports safely and can mark them done
  const vc = new VirtualConsole(); const errors = [...home.errors, ...game.errors];
  vc.on('jsdomError', (e) => errors.push('inbox: ' + e.message));
  const inbox = await JSDOM.fromURL(BASE + '/feedback.html', { runScripts: 'dangerously', resources: 'usable', virtualConsole: vc,
    beforeParse(win) { win.fetch = (u, o) => fetch(new URL(u, BASE).href, o); } });
  const id = inbox.window.document;
  await waitFor(() => id.querySelectorAll('.item').length > 0, 5000) || notes.push('inbox showed nothing');
  const first = id.querySelector('.item');
  const injected = first.querySelector('.text b, .text img') !== null;
  const withGame = [...id.querySelectorAll('.item')].some((x) => /tictactoe/.test(x.textContent));
  click(first.querySelector('.actions button'));
  await sleep(500);
  const afterDone = id.querySelector('#filters').textContent;
  const items = id.querySelectorAll('.item').length;
  inbox.window.close();
  return { radios, reopened, previewHasGame: preview.includes('"view"'), thanks, items,
    htmlInjected: injected, inGameReportHasGame: withGame, filters: afterDone, notes, errors };
}

(async () => {
  const games = process.argv.slice(2);
  if (games[0] === 'feedback') { console.log('FEEDBACK', JSON.stringify(await feedbackTour(), null, 1)); process.exit(0); }
  const lt = await lobbyTour();
  console.log('LOBBY', JSON.stringify(lt));
  for (const g of games.length ? games : Object.keys(MOVES)) {
    const r = await playSolo(g, g === 'fantan' ? 420 : CT_GAMES.has(g) ? 240 : g === 'wordsmith' ? 40 : g === 'bingo' ? 300 : g === 'spire' || g === 'fuse' ? 25 : g === 'prism' ? 110 : g === 'marble' ? 150 : g === 'billiards' ? 300 : g === 'holdem' ? 240 : g === 'cribbage' ? 300 : g === 'yacht' ? 200 : g === 'farkle' ? 240 : g === 'qork' ? 200 : g === 'backgammon' ? 300 : g === 'gridhunt' ? 260 : g === 'paintblast' ? 230 : g === 'sumo' ? 200 : g === 'snowball' ? 200 : g === 'tops' ? 200 : g === 'lander' ? 330 : g === 'pusher' ? 330 : g === 'tide' ? 300 : g === 'rapids' ? 200 : g === 'midway' ? 200 : g === 'planes' ? 240 : g === 'orbit' ? 420 : g === 'pond' ? 240 : g === 'domino' ? 300 : g === 'regatta' ? 200 : g === 'putt' ? 300 : g === 'cannon' ? 240 : g === 'stones' ? 300 : g === 'archery' ? 240 : g === 'lanes' ? 300 : g === 'wobble' || g === 'wobble:pull' ? 300 : g === 'drift' ? 200 : g === 'rally' ? 150 : g === 'whisker' ? 120 : g === 'hearts' || g === 'rummy' ? 300 : g === 'twentyone' ? 200 : g === 'speed' ? 150 : g === 'trivia' ? 200 : g === 'ladder' ? 330 : g === 'freecell' || g === 'klondike' ? 300 : g === 'sudoku' ? 120 : g === 'wordsearch' ? 150 : g === 'garden' ? 200 : g === 'wordbomb' ? 200 : g === 'liars' ? 300 : g === 'shipcrew' || g === 'shutbox' || g === 'midnight' || g === 'mia' || g === 'brawl' || g === 'derby' ? 200 : g === 'squares' ? 120 : g === 'kindred' ? 200 : g === 'reversi' || g === 'hedgerow' || g === 'ultimate' || g === 'oware' || g === 'morris' || g === 'realm' ? 260 : g === 'safecracker' ? 200 : g === 'lucky' ? 540 : g === 'relay' ? 300 : g === 'oddone' || g === 'fibfinder' ? 200 : 70);
    console.log(`\n== ${g}: phase=${r.phase} moves=${r.moves} dialogs=${r.dialogs || 0} screen="${r.screen}" ${r.banner ? `banner="${r.banner}"` : ''}`);
    console.log(`   help: ${r.help} | log ticker: "${r.ticker}"`);
    if (r.replay) console.log(`   replay: ${r.replay}`);
    if (r.rematch) console.log(`   rematch: ${r.rematch} | prefs toggles: ${r.prefs} | vote choices: ${r.vote}`);
    if (r.notes.length) console.log('   notes:', r.notes.join('; '));
    for (const e of r.errors.filter((x) => !x.includes('WebGL')).slice(0, 5)) console.log('   ERROR', e.split('\n').slice(0, 4).join(' | '));
  }
  if (nodeErrors.length) console.log('\nNODE ERRORS:\n' + nodeErrors.slice(0, 8).join('\n'));
  process.exit(0);
})();
