// Shared pieces and "juice" for the game modules: playing cards, dice, chip stacks, floating score text,
// big moment callouts, staged reveals and FLIP moves. Loaded before the games; like them it leans on
// app.js globals (el, sfx, motionOK, buzz) at call time, so nothing here runs on load.
const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };
// replays draw the same effects silently (app.js sets this around each render)
let kitMuted = false;
const ksfx = (kind, arg) => { if (!kitMuted) sfx(kind, arg); };

const Cards = (() => {
  // card codes are rank + suit: 'TD', 'QS', 'AH' (Last Card may write '10H'); 'JK…' is a joker
  const rankOf = (c) => { const r = c.slice(0, -1); return r === 'T' ? '10' : r; };
  const suitOf = (c) => c.slice(-1);
  function face(card, cls = '') {
    if (card === '??') return back(cls);
    const r = rankOf(card), s = suitOf(card), g = SUIT_GLYPH[s] || s;
    const f = el('span', `pc ${'HD'.includes(s) ? 'red' : 'black'} ${cls}`);
    f.dataset.ix = r + g;                       // the corner indices (drawn by CSS, not in textContent)
    if ('JQK'.includes(r)) f.classList.add('court', 'court-' + r);
    else if (r === 'A') f.classList.add('ace');
    f.append(el('b', '', r), el('i', '', g + '︎'));
    return f;
  }
  function joker(cls = '') {
    const f = el('span', `pc joker ${cls}`);
    f.append(el('b', '', '🃏'), el('i', '', 'wild'));
    return f;
  }
  function back(cls = '', label = null) {
    const f = el('span', `pc back ${cls}`);
    if (label != null) f.append(el('small', '', String(label)));
    return f;
  }
  // turn a card over in place (a back becomes `card`)
  function flip(node, card, cls = '') {
    const f = face(card, cls);
    if (motionOK()) f.classList.add('flip-in');
    node.replaceWith(f);
    return f;
  }
  return { face, joker, back, flip, rankOf, suitOf };
})();

const Dice = (() => {
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  function set(node, value) {
    const on = new Set(PIPS[value] || []);
    if (node.children.length !== 9) { node.replaceChildren(); for (let k = 0; k < 9; k++) node.append(el('span')); }
    [...node.children].forEach((pip, k) => pip.classList.toggle('on', on.has(k)));
    node.dataset.v = value || '';
    return node;
  }
  // a die with pips; cls may include 'held', 'blank', 'roll', 'small'
  const die = (value, cls = '', tag = 'span') => set(el(tag, 'ya-die ' + cls), value);
  // tumble the dice in `nodes` with a staggered landing and a rattle, then a settle click
  function roll(nodes, { sound = true } = {}) {
    nodes = [...nodes];
    if (sound) { ksfx('dice'); setTimeout(() => ksfx('settle'), 380 + nodes.length * 40); }
    if (!motionOK()) return;
    nodes.forEach((n, i) => {
      n.style.setProperty('--i', i);
      n.style.setProperty('--spin', (Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 200) + 'deg');
      n.classList.remove('roll'); void n.offsetWidth; n.classList.add('roll');
    });
  }
  return { PIPS, die, set, roll };
})();

const Chips = (() => {
  const DENOMS = [[1000, 'gold'], [500, 'purple'], [100, 'black'], [25, 'green'], [5, 'red'], [1, 'white']];
  // a little stack of casino chips for `amount` (at most `max` chips drawn), with the amount under it
  function stack(amount, { max = 8, label = true, cls = '' } = {}) {
    const box = el('span', 'chip-stack ' + cls), col = el('span', 'chip-col');
    let left = Math.max(0, Math.round(amount)), n = 0;
    for (const [v, c] of DENOMS) {
      while (left >= v && n < max) { col.append(el('i', 'cchip ' + c)); left -= v; n++; }
    }
    if (!n && amount > 0) col.append(el('i', 'cchip white'));
    box.append(col);
    if (label) box.append(el('b', '', Number(amount).toLocaleString()));
    return box;
  }
  return { stack };
})();

const Kit = (() => {
  const layer = () => document.getElementById('floaters') || document.body;
  // "+38" rising from an element; kind: good | bad | gold
  function flyText(anchor, text, kind = 'good') {
    if (!anchor?.getBoundingClientRect) return;
    const r = anchor.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const f = el('div', 'fly-text ' + kind, text);
    f.style.left = r.left + r.width / 2 + 'px';
    f.style.top = r.top + r.height / 2 + 'px';
    if (!motionOK()) f.classList.add('still');
    layer().append(f);
    setTimeout(() => f.remove(), 1300);
  }
  // a big word across the middle of the screen for a moment: "YACHT!", "Shoot the moon!", "BUST"
  let lastCallout = null;
  function callout(text, kind = 'gold', { sound = null, ms = 1500 } = {}) {
    lastCallout?.remove();
    const c = el('div', 'kit-callout ' + kind, text);
    if (!motionOK()) c.classList.add('still');
    layer().append(c);
    lastCallout = c;
    if (sound) ksfx(sound);
    setTimeout(() => c.remove(), ms);
    return c;
  }
  // show items one after another: onEach(item, i) runs `step` ms apart (all at once when motion is off);
  // returns a cancel function
  function reveal(items, step, onEach, { sound = 'flip', done = null } = {}) {
    items = [...items];
    const timers = [];
    if (!motionOK() || step <= 0) { items.forEach((it, i) => onEach(it, i)); done?.(); return () => {}; }
    items.forEach((it, i) => timers.push(setTimeout(() => { onEach(it, i); if (sound) ksfx(sound); }, i * step)));
    if (done) timers.push(setTimeout(done, items.length * step));
    return () => timers.forEach(clearTimeout);
  }
  // FLIP: remember where keyed pieces are (children with data-k), re-render, then glide them from there
  function snap(root) {
    const m = new Map();
    root?.querySelectorAll('[data-k]').forEach((n) => m.set(n.dataset.k, n.getBoundingClientRect()));
    return m;
  }
  function glide(root, before, ms = 260) {
    if (!root || !before?.size || !motionOK()) return;
    root.querySelectorAll('[data-k]').forEach((n) => {
      const a = before.get(n.dataset.k);
      if (!a) return;
      const b = n.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      n.animate?.([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: ms, easing: 'cubic-bezier(.3, .9, .4, 1)' });
    });
  }
  // a copy of `from` flies to `to` and vanishes (cards swept to a trick winner, chips into the pot)
  function fly(from, to, { ms = 450, delay = 0, scale = 1, remove = true } = {}) {
    if (!from || !to || !motionOK() || !from.animate) return;
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    if (!a.width || !b.width) return;
    const g = from.cloneNode(true);
    Object.assign(g.style, { position: 'fixed', left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px', margin: 0, zIndex: 40, pointerEvents: 'none' });
    g.classList.add('kit-ghost');
    layer().append(g);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const anim = g.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: remove ? 0.2 : 1 }],
      { duration: ms, delay, easing: 'cubic-bezier(.5, 0, .3, 1)', fill: 'both' });
    anim.onfinish = () => g.remove();
    setTimeout(() => g.remove(), ms + delay + 200);
  }
  // remember a value between renders and say whether it changed (for one-shot effects on new state)
  const seen = new Map();
  function changed(key, value) {
    const v = JSON.stringify(value), was = seen.get(key);
    seen.set(key, v);
    return was !== undefined && was !== v;
  }
  // the cards in `cards` that weren't there last time `key` was asked about (null the first time, so a
  // page load doesn't deal the whole hand in again); duplicates count one by one
  const hands = new Map();
  function fresh(key, cards) {
    const before = hands.get(key);
    hands.set(key, [...cards]);
    if (!before) return null;
    const left = [...before], out = new Set();
    for (const c of cards) { const at = left.indexOf(c); if (at >= 0) left.splice(at, 1); else out.add(c); }
    return out;
  }
  // lay a row of card buttons out as a fan (.hand.fan in style.css): each one turned a little more the
  // further it is from the middle; the buttons in `dealt` deal in one after another
  function fan(hand, dealt = []) {
    const kids = [...hand.children], mid = (kids.length - 1) / 2, step = Math.min(6, 48 / Math.max(1, kids.length));
    hand.classList.add('hand', 'fan');
    kids.forEach((b, k) => {
      b.style.setProperty('--rot', `${((k - mid) * step).toFixed(1)}deg`);
      b.style.setProperty('--drop', `${(Math.abs(k - mid) * step * 0.6).toFixed(1)}px`);
    });
    dealt.forEach((b, k) => { b.classList.add('dealt'); b.style.setProperty('--deal', `${k * 0.09}s`); });
    if (dealt.length) ksfx('deal');
  }
  // a word stamped onto an element for a moment ("FARKLE", "SKIP", "FLINCH!")
  function stamp(anchor, text, kind = 'bad', ms = 1100) {
    if (!anchor?.getBoundingClientRect) return;
    const r = anchor.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const s = el('div', 'kit-stamp ' + kind, text);
    s.style.left = r.left + r.width / 2 + 'px';
    s.style.top = r.top + r.height / 2 + 'px';
    if (!motionOK()) s.classList.add('still');
    layer().append(s);
    setTimeout(() => s.remove(), ms);
  }
  // count a number shown in `node` up (or down) to `to`
  function tally(node, from, to, ms = 600) {
    if (!node) return;
    const fmt = (v) => Math.round(v).toLocaleString();
    if (!motionOK() || from === to || from == null) { node.textContent = fmt(to); return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      node.textContent = fmt(from + (to - from) * (1 - (1 - k) ** 3));
      if (k < 1 && node.isConnected) requestAnimationFrame(step);
    };
    node.textContent = fmt(from);
    requestAnimationFrame(step);
  }
  // a pen-stroke ✕ (seat 0: two strokes) or ◯ (seat 1: one loop) that draws itself in; `still` skips the drawing
  // (Tic-Tac-Toe and Ultimate)
  function ink(seat, still = false) {
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('class', 'ttt-ink' + (still || !motionOK() ? ' still' : '')); svg.setAttribute('aria-hidden', 'true');
    const paths = seat === 0 ? ['M24 24 L76 76', 'M76 24 L24 76'] : ['M50 20 a30 30 0 1 1 -0.1 0'];
    paths.forEach((d, k) => {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d); path.setAttribute('pathLength', '100'); path.style.animationDelay = k * 0.12 + 's';
      svg.append(path);
    });
    return svg;
  }
  return { flyText, callout, reveal, snap, glide, fly, changed, fresh, fan, stamp, tally, ink };
})();
