// Drives the real Game Night UI in jsdom (a simulated, phone-sized browser) against a running server,
// playing each game through real clicks and reporting any JavaScript errors.
// Usage: start a server (e.g. PORT=8767 python3 server.py), then in tests/: npm install && BASE=http://localhost:8767 node ui.js [game ...]
const { JSDOM, VirtualConsole } = require('jsdom');
const BASE = process.env.BASE || 'http://localhost:8767';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nodeErrors = [];
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

async function openPage(stubCanvas = false) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Could not load img|Not implemented: HTMLCanvasElement/.test(e.message)) errors.push('jsdomError: ' + (e.detail?.stack || e.stack || e.message)); });
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
  const dom = await JSDOM.fromURL(BASE + '/', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (u, o) => fetch(new URL(u, BASE).href, o);
      w.EventSource = ES;
      w.ResizeObserver = class { observe() {} disconnect() {} };
      w.matchMedia = (q) => ({ matches: /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} }); // phone-sized
      w.navigator.vibrate = () => true;
      w.confirm = () => true; w.prompt = () => null; w.alert = () => {};
      w.HTMLCanvasElement.prototype.getContext = stubCanvas ? function (kind) { return kind === '2d' ? stubContext() : null; } : () => null;
      w.AudioContext = undefined;
    },
  });
  await new Promise((r) => (dom.window.document.readyState === 'complete' ? r() : dom.window.addEventListener('load', r)));
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
const MOVES = {
  oddone(d, S, n, w) {
    if (S.oddone.stage === 'vote') return click(pick(enabled(d, '.oo-vote')));
    const [form, input, text] = S.oddone.stage === 'guess' ? ['#ooGuessForm', '#ooGuess', pick(['tea', 'snow', 'pool'])]
      : ['#ooClueForm', '#ooClue', pick(['warm', 'round', 'happy', 'big', 'fast', 'blue', 'loud', 'soft']) + 'ish'.slice(0, n % 4)];
    d.querySelector(input).value = text;
    d.querySelector(form).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  },
  fibfinder(d, S, n, w) {
    if (S.fibfinder.stage === 'pick') return click(pick(enabled(d, '.fb-opt')));
    d.querySelector('#fbFib').value = pick(['a tiny hat', 'seven', 'purple', 'cheese', 'the mayor']);
    d.querySelector('#fbForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  },
  relay(d, S, n, w) {
    const g = S.relay;
    if (g.stage === 'show') return click(pick(enabled(d, '.rl-heart')));
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
  wordsmith(d) { click(enabled(d, '#wsSwap')[0]); click(enabled(d, '.rack-tile')[0]); click(enabled(d, '#wsSwap')[0]); if (!enabled(d, '#wsSwap').length) return; click(d.querySelector('#wsPass')); },
  chess(d) { click(pick(enabled(d, '.csq.movable'))); click(pick(enabled(d, '.csq.target, .csq.capture'))); click(enabled(d, '#chPromo button')[0]); },
  checkers(d) { click(pick(enabled(d, '.csq.movable'))); click(pick(enabled(d, '.csq.target'))); },
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
  dropfour(d) { click(pick(enabled(d, '.d4-cell'))); },
  boxes(d) { const ln = pick(enabled(d, '.bx-line:not(.drawn)')); click(ln); click(d.querySelector(`.bx-line[data-k="${ln?.dataset.k}"]`)); },  // touch: tap twice
  doodle(d, S, n, w) {
    d.querySelector('#ddGuess').value = pick(['cat', 'house', 'tree', 'car', 'apple', 'fish', 'sun']);
    d.querySelector('#ddForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  },
  hockey(d, S, n, w) {  // drag the mallet to a few spots in our half (the bottom of the screen)
    const c = d.querySelector('#hkCanvas');
    c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 512 });
    for (const type of ['pointerdown', 'pointermove']) c.dispatchEvent(new w.MouseEvent(type, { clientX: 40 + Math.random() * 240, clientY: 280 + Math.random() * 220, buttons: 1 }));
  },
  riders(d, S, n, w) {  // mix pad taps, swipes and keys
    if (n % 3 === 0) return d.querySelectorAll('#lrPad button[data-d]')[n % 4]?.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
    if (n % 3 === 1) return w.dispatchEvent(new w.KeyboardEvent('keydown', { code: pick(['ArrowLeft', 'ArrowRight', 'KeyW', 'Space']) }));
    const st = d.querySelector('#lrStage');
    st.dispatchEvent(new w.MouseEvent('pointerdown', { clientX: 100, clientY: 100 }));
    st.dispatchEvent(new w.MouseEvent('pointermove', { clientX: 100 + pick([-40, 40, 0]), clientY: 100 + pick([-40, 40]) }));
    st.dispatchEvent(new w.MouseEvent('pointerup', {}));
  },
  tictactoe(d) { click(pick(enabled(d, '.ttt-cell'))); },
  heist(d) { click(pick(enabled(d, '.h-choice'))); },
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
  paintblast(d, S, n, w) {  // mix pad holds, arena swipes/taps and keys
    const fire = (el, type, x = 0, y = 0) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    const kind = n % 4;
    if (kind === 0) { const b = pick([...d.querySelectorAll('#pbPad button[data-d]')]); fire(b, 'pointerdown'); setTimeout(() => fire(b, 'pointerup'), 200); }
    else if (kind === 1) { const st = d.querySelector('#pbStage'); fire(st, 'pointerdown', 100, 100); fire(st, 'pointerup', 100, 100); }
    else if (kind === 2) { const st = d.querySelector('#pbStage'); fire(st, 'pointerdown', 100, 100); fire(st, 'pointermove', 100 + pick([-40, 40]), 100); setTimeout(() => fire(st, 'pointerup'), 250); }
    else {
      const code = pick(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
      w.dispatchEvent(new w.KeyboardEvent('keydown', { code, bubbles: true }));
      setTimeout(() => w.dispatchEvent(new w.KeyboardEvent('keyup', { code, bubbles: true })), 200);
    }
  },
  oware(d) { click(pick([...d.querySelectorAll('.ow-pit.can:not(:disabled)')])); },
  reversi(d) { click(pick([...d.querySelectorAll('.rv-cell.can')])); },
  ultimate(d) { click(pick([...d.querySelectorAll('.ut-cell.can')])); },
  morris(d, S, n, w) {  // place, or pick a man then a point; take a man after a mill
    const tap = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    for (let k = 0; k < 3; k++) {
      const take = [...d.querySelectorAll('.mm-pt.take')], can = [...d.querySelectorAll('.mm-pt.can')], src = [...d.querySelectorAll('.mm-pt.src')];
      if (take.length) tap(pick(take)); else if (can.length) tap(pick(can)); else if (src.length) tap(pick(src)); else return;
    }
  },
  hearts(d, S) {
    if (S.hearts.stage === 'pass') {
      const cards = [...d.querySelectorAll('#hhHand .card-btn:not(:disabled)')].slice(0, 3);
      cards.forEach((c) => click(c));
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
  shipcrew(d) {
    const roll = d.querySelector('#scRoll'), dock = d.querySelector('#scDock');
    if (!dock.hidden && (Math.random() < 0.5 || roll.hidden)) return click(dock);
    if (!roll.hidden && !d.querySelector('#scFree .ya-die:not(:disabled)') && roll.disabled) return click(dock);
    if (Math.random() < 0.3) { const c = d.querySelector('#scFree .ya-die:not(:disabled)'); if (c) click(c); }
    const r2 = d.querySelector('#scRoll');
    click(r2.disabled ? d.querySelector('#scFree .ya-die:not(:disabled)') : r2);
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
  speed(d, S, n, w) {  // play a fitting card; when it fits both piles, tap a lifted pile
    const ok = [...d.querySelectorAll('#spHand .card-btn.ok:not(:disabled)')];
    if (!ok.length) return;
    click(pick(ok));
    const t = [...d.querySelectorAll('.sp-pile.target')];
    if (t.length) t[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  },
  twentyone(d) {
    const chips = [...d.querySelectorAll('.to-chip:not(:disabled)')];
    if (chips.length) return click(pick(chips));
    click(pick([...d.querySelectorAll('#toBar button:not(:disabled)')]));
  },
  rummy(d) {
    for (const id of ['#ruDeck', '#ruDiscard']) { const b = d.querySelector(id); if (!b.disabled) return click(b); }
    const lay = d.querySelector('#ruLay');
    if (!lay.hidden && !lay.disabled) return click(lay);
    click(pick([...d.querySelectorAll('#ruHand .card-btn:not(:disabled)')]));
    click(d.querySelector('#ruThrow'));
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
      const code = pick(['ArrowLeft', 'ArrowRight', 'Space']);
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
    const power = d.querySelector('#blPower');
    power.value = String(30 + Math.floor(Math.random() * 70));
    power.dispatchEvent(new w.Event('input', { bubbles: true }));
    click(enabled(d, '#blShoot')[0]);
  },
  spire(d, S, n, w) {
    const key = (k) => w.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
    key(pick(['ArrowLeft', 'ArrowRight', 'ArrowUp', ' ', ' ', 'c']));
  },
};

const UI_MINE = (f) => (f.stage === 'write' && !f.mine) || (f.stage === 'pick' && f.myPick == null);

async function playSolo(game, seconds = 60) {
  const { w, d, errors, close } = await openPage(game === 'hockey' || game === 'riders' || game === 'paintblast' || game === 'sumo' || game === 'putt' || game === 'rally');
  const S = () => w.eval('S');
  const report = { game, moves: 0, phase: null, notes: [] };
  d.querySelector('#name').value = 'Tester';
  d.querySelector('#soloGame').value = game;
  d.querySelector('#soloLevel').value = 'easy';
  click(d.querySelector('#soloBtn'));
  if (!(await waitFor(() => !d.querySelector('#game').hidden && S()?.phase === 'playing'))) report.notes.push('never reached the game screen');
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end && S()?.phase === 'playing') {
    const s = S();
    const mine = s.turn === s.me.id || (game === 'heist' && !s.heist.mine) || (game === 'oddone' && s.oddone.stage === 'vote' && !s.oddone.myVote) || (game === 'fibfinder' && UI_MINE(s.fibfinder)) || (game === 'holdem' && s.holdem.canRebuy) || (game === 'cribbage' && s.cribbage.stage === 'discard' && s.cribbage.discarded[s.me.id] === false)
      || (game === 'relay' && (s.relay.stage === 'play' ? !s.relay.sent : s.relay.myVote == null)) || (game === 'seabattle' && s.sea.stage === 'placing' && !s.sea.ready[s.me.id])
      || (game === 'spire' && s.spire.playing && s.spire.startIn <= 0) || (game === 'safecracker' && s.safecracker.stage === 'crack' && !s.safecracker.mine) || (game === 'gridhunt' && s.gridhunt.stage === 'hunt')
      || (game === 'doodle' && s.doodle.stage === 'draw' && !s.doodle.solvers.some(([p]) => p === s.me.id)) || game === 'hockey' || (game === 'riders' && s.riders.stage === 'ride') || (game === 'paintblast' && s.paintblast.st === 'play') || (game === 'sumo' && s.sumo.stage === 'play') || (game === 'rally' && s.rally.stage === 'race') || (game === 'hearts' && s.hearts.stage === 'pass' && !s.hearts.myPass) || (game === 'speed' && s.speed.stage === 'play') || (game === 'trivia' && s.trivia.stage === 'ask' && s.trivia.mine == null) || (game === 'ladder' && s.ladder.stage === 'climb' && !s.ladder.done)
      || (game === 'twentyone' && s.twentyone.stage === 'bet' && !s.twentyone.bets[s.twentyone.me] && s.twentyone.chips[s.twentyone.me] > 0);
    if (game === 'lucky' && s.lucky.stage === 'wheel') { await sleep(300); continue; }
    if (mine) { try { MOVES[game](d, s, report.moves, w); report.moves++; } catch (e) { errors.push('driver: ' + e.stack); } }
    await sleep(60);
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
    // replay
    if (!d.querySelector('#replayBtn').hidden) {
      click(d.querySelector('#replayBtn'));
      await waitFor(() => !d.querySelector('#replayBar').hidden, 5000);
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
    report.vote = d.querySelectorAll('#overVote .vote-chip').length;
    if (!report.vote) report.notes.push('no next-game vote choices');
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
  const cats = [...d.querySelectorAll('#gamePicker .picker-cat')].map((x) => x.textContent).join(' ');
  const nofit = [...d.querySelectorAll('#gamePicker .nofit small')].map((x) => x.textContent).join(',');
  const howto = d.querySelectorAll('#howto li').length;
  click(d.querySelector('#leaveBtn')); await sleep(200);
  const leaveDialog = d.querySelector('#modalText').textContent; click(d.querySelector('#modalCancel'));
  const out = { cats, nofit, howto, leaveDialog, tiles: tiles.length, game: S().gameId, players: d.querySelectorAll('#lobbyPlayers li').length,
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
    const r = await playSolo(g, g === 'wordsmith' ? 40 : g === 'spire' ? 25 : g === 'billiards' ? 300 : g === 'holdem' ? 240 : g === 'cribbage' ? 300 : g === 'yacht' ? 200 : g === 'farkle' ? 240 : g === 'backgammon' ? 300 : g === 'gridhunt' ? 260 : g === 'paintblast' ? 230 : g === 'sumo' ? 200 : g === 'putt' ? 300 : g === 'rally' ? 150 : g === 'hearts' || g === 'rummy' ? 300 : g === 'twentyone' ? 200 : g === 'speed' ? 150 : g === 'trivia' ? 200 : g === 'ladder' ? 330 : g === 'liars' ? 300 : g === 'shipcrew' ? 200 : g === 'reversi' || g === 'ultimate' || g === 'oware' || g === 'morris' ? 260 : g === 'safecracker' ? 200 : g === 'lucky' ? 540 : g === 'relay' ? 300 : g === 'oddone' || g === 'fibfinder' ? 200 : 70);
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
