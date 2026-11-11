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
  // Each face is one SVG on a 250×350 card, built once per card and cloned after that. Suits are drawn
  // shapes (not font glyphs), so they look the same on every phone. The SVG holds two layouts: `.full`
  // (corner indices, real pip layout, drawn court figures) and `.cmp` (a big rank and suit for narrow
  // cards); style.css picks one with a container query on the card's width.
  const SUIT = {   // each in a 100×100 box
    H: 'M50 90C22 68 5 50 5 30 5 15 16 5 29 5c10 0 17 6 21 14 4-8 11-14 21-14 13 0 24 10 24 25 0 20-17 38-45 60z',
    D: 'M50 3Q67 30 88 50 67 70 50 97 33 70 12 50 33 30 50 3z',
    S: 'M50 4C33 26 6 40 6 61c0 13 10 22 22 22 9 0 15-4 19-10-1 10-6 17-14 23h34c-8-6-13-13-14-23 4 6 10 10 19 10 12 0 22-9 22-22C94 40 67 26 50 4z',
    C: 'M50 8a19 19 0 1 1 0 38a19 19 0 1 1 0-38zM28 38a19 19 0 1 1 0 38a19 19 0 1 1 0-38zM72 38a19 19 0 1 1 0 38a19 19 0 1 1 0-38zM43 42h14v18H43zM46 58c0 16-5 28-14 36h36c-9-8-14-20-14-36z',
  };
  // pip spots on a 60×90 grid (x, y), mapped onto the card's pip box; lower-half pips are turned round
  const L = 17, C = 30, R = 43, Y4 = [17, 35.7, 54.3, 73];
  const sides = (ys) => ys.flatMap((y) => [[L, y], [R, y]]);
  const PIPS = {
    A: [[C, 45]], 2: [[C, 17], [C, 73]], 3: [[C, 17], [C, 45], [C, 73]], 4: sides([17, 73]), 5: [...sides([17, 73]), [C, 45]],
    6: sides([17, 45, 73]), 7: [...sides([17, 45, 73]), [C, 31]], 8: [...sides([17, 45, 73]), [C, 31], [C, 59]],
    9: [...sides(Y4), [C, 45]], 10: [...sides(Y4), [C, 26], [C, 64]],
  };
  const pip = (s, cx, cy, size, flip = false) =>
    `<path d="${SUIT[s]}" transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${size / 100})${flip ? ' rotate(180 50 50)' : ''}"/>`;
  // a court figure from the waist up, in a 154×135 box whose bottom edge is the card's middle; the
  // card shows it twice, the second turned round, as real court cards do
  const SKIN = '#f6d2ad', INK = '#3b2718', GOLD = '#e8b847', GOLD2 = '#9c7414', CREAM = '#fbf3dc';
  const bust = (r) => {
    const face = `<path d="M70 70h14v20H70z" fill="${SKIN}"/>
      <ellipse cx="77" cy="58" rx="19" ry="22" fill="${SKIN}" stroke="${INK}" stroke-width="1.6"/>
      <circle cx="70" cy="56" r="2.3" fill="${INK}"/><circle cx="84" cy="56" r="2.3" fill="${INK}"/>
      <path d="M76 58q-2 6 1 7" fill="none" stroke="${INK}" stroke-width="1.3"/>`;
    const robe = `<path d="M8 135c4-34 32-47 69-47s65 13 69 47z" fill="currentColor"/>
      <path d="M77 90 58 135M77 90l19 45" stroke="${GOLD}" stroke-width="7"/>
      <path d="M8 135c4-34 32-47 69-47s65 13 69 47" fill="none" stroke="${INK}" stroke-width="1.6"/>
      <path d="M22 118h20M112 118h20" stroke="var(--acc)" stroke-width="9" stroke-linecap="round"/>
      <ellipse cx="77" cy="91" rx="25" ry="7" fill="${CREAM}" stroke="${INK}" stroke-width="1.2"/>`;
    if (r === 'K') return robe + face + `
      <path d="M58 60c2 22 11 31 19 31s17-9 19-31c-5 9-12 12-19 12s-14-3-19-12z" fill="#7a4a22" stroke="${INK}" stroke-width="1.2"/>
      <path d="M69 68q8-5 16 0" fill="none" stroke="${INK}" stroke-width="1.5"/>
      <path d="M55 40 57 13l10 14 10-20 10 20 10-14 2 27z" fill="${GOLD}" stroke="${GOLD2}" stroke-width="1.6"/>
      <circle cx="77" cy="30" r="3.4" fill="var(--acc)"/><circle cx="64" cy="33" r="2.4" fill="#d6304a"/><circle cx="90" cy="33" r="2.4" fill="#d6304a"/>
      <path d="M128 135V66" stroke="${GOLD2}" stroke-width="5"/><circle cx="128" cy="62" r="7" fill="${GOLD}" stroke="${GOLD2}" stroke-width="1.5"/>
      <path d="M121 62h14M128 55v14" stroke="${GOLD2}" stroke-width="1.5"/>`;
    if (r === 'Q') return robe + `
      <path d="M57 62c-6-26 6-36 20-36s26 10 20 36c4 18 8 28 2 40l-9-32c1-17-4-26-13-26s-14 9-13 26l-9 32c-6-12-2-22 2-40z" fill="#b8632a" stroke="${INK}" stroke-width="1.2"/>`
      + face + `<path d="M71 71q6 4 12 0" fill="none" stroke="#c0392b" stroke-width="2"/>
      <path d="M60 34l6-12 6 8 5-13 5 13 6-8 6 12z" fill="${GOLD}" stroke="${GOLD2}" stroke-width="1.5"/><circle cx="77" cy="28" r="2.6" fill="var(--acc)"/>
      <path d="M126 135c-2-20 2-34 0-44" stroke="#3f8f4a" stroke-width="3" fill="none"/>
      <g fill="#e2557a" stroke="${INK}" stroke-width="1"><circle cx="126" cy="80" r="6"/><circle cx="134" cy="87" r="6"/><circle cx="118" cy="87" r="6"/><circle cx="126" cy="94" r="6"/></g>
      <circle cx="126" cy="87" r="4" fill="${GOLD}"/>`;
    return robe + face + `
      <path d="M58 46c3-8 9-12 19-12s16 4 19 12c-4 3-8 4-8 10-2-8-6-10-11-10s-9 2-11 10c0-6-4-7-8-10z" fill="#d09a3c" stroke="${INK}" stroke-width="1.1"/>
      <path d="M71 70h12" stroke="${INK}" stroke-width="1.5"/>
      <path d="M52 44c0-22 50-22 50 0l4 3H48z" fill="var(--acc)" stroke="${INK}" stroke-width="1.4"/>
      <path d="M50 44h54" stroke="${GOLD}" stroke-width="4"/>
      <path d="M98 34c18-16 34-26 46-30-8 14-24 26-42 34z" fill="${GOLD}" stroke="${GOLD2}" stroke-width="1.2"/>
      <path d="M24 135V60" stroke="#8a8f98" stroke-width="4"/><path d="M24 52l-9 16h18z" fill="#c9ced6" stroke="#5c626b" stroke-width="1.2"/>`;
  };
  const cache = new Map();
  function art(r, s) {
    const key = r + s;
    if (cache.has(key)) return cache.get(key);
    const corner = `<text x="27" y="52" class="ix">${r}</text>${pip(s, 27, 77, 30)}`;
    let mid = '';
    if (PIPS[r] && r !== 'A') for (const [x, y] of PIPS[r]) mid += pip(s, 125 + (x - 30) * 3.8, 175 + (y - 45) * 4.45, 50, y > 45);
    else if (r === 'A') {
      mid = pip(s, 125, 175, s === 'S' ? 128 : 104)
        + (s === 'S' ? `<path d="M125 128c-14 18-26 26-26 40 0 6 4 10 10 10" fill="none" stroke="#fff" stroke-width="3" opacity=".55"/>
          <circle cx="125" cy="175" r="78" fill="none" stroke="currentColor" stroke-width="2" opacity=".35"/>` : '');
    } else {
      mid = `<rect x="47" y="38" width="156" height="274" rx="10" class="frame"/>
        <svg x="48" y="40" width="154" height="135" viewBox="0 0 154 135" overflow="hidden">${bust(r)}</svg>
        <g transform="rotate(180 125 175)"><svg x="48" y="40" width="154" height="135" viewBox="0 0 154 135" overflow="hidden">${bust(r)}</svg></g>
        <path d="M48 175h154" stroke="${GOLD2}" stroke-width="2"/>
        ${pip(s, 64, 58, 24)}${pip(s, 186, 292, 24, true)}`;
    }
    const svg = `<svg class="face" viewBox="0 0 250 350" aria-hidden="true">
      <g class="full">${corner}<g transform="rotate(180 125 175)">${corner}</g>${mid}</g>
      <g class="cmp"><text x="14" y="92" class="ix big${r === '10' ? ' ten' : ''}">${r}</text>${pip(s, 200, 52, 62)}${pip(s, 125, 238, 150)}</g></svg>`;
    const t = document.createElement('template');
    t.innerHTML = svg;
    const node = t.content.firstElementChild;
    cache.set(key, node);
    return node;
  }
  function face(card, cls = '') {
    if (card === '??') return back(cls);
    if (card.startsWith('JK')) return joker(cls);
    const r = rankOf(card), s = suitOf(card), g = SUIT_GLYPH[s] || s;
    const f = el('span', `pc ${'HD'.includes(s) ? 'red' : 'black'} ${cls}`);
    f.dataset.face = r + s;
    f.setAttribute('aria-label', `${r}${g}`);
    if ('JQK'.includes(r)) f.classList.add('court', 'court-' + r);
    else if (r === 'A') f.classList.add('ace');
    // b and i: the plain rank + suit, shown only at the tiny size (and read by screen readers and tests)
    f.append(el('b', '', r), el('i', '', g + '︎'));
    if (SUIT[s]) f.append(art(r, s).cloneNode(true));
    return f;
  }
  function joker(cls = '') {
    const f = el('span', `pc joker ${cls}`);
    f.append(el('b', '', '🃏'), el('i', '', 'wild'));
    if (!cache.has('JK')) {
      const t = document.createElement('template');
      t.innerHTML = `<svg class="face" viewBox="0 0 250 350" aria-hidden="true">
        <path d="M125 92l20 46 50 4-38 32 12 49-44-27-44 27 12-49-38-32 50-4z" fill="${GOLD}" stroke="${GOLD2}" stroke-width="3"/>
        <circle cx="125" cy="168" r="14" fill="currentColor"/>
        <text x="125" y="300" class="ix jk">JOKER</text><text x="125" y="62" class="ix jk">WILD</text></svg>`;
      cache.set('JK', t.content.firstElementChild);
    }
    f.append(cache.get('JK').cloneNode(true));
    return f;
  }
  // the back is all CSS (style.css), so the backs games build themselves look the same
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
  // a bare suit shape (an empty foundation's watermark, a suit in a label)
  function suit(s, cls = '') {
    const t = document.createElement('template');
    t.innerHTML = `<svg class="suit ${cls}" viewBox="0 0 100 100" aria-hidden="true"><path d="${SUIT[s] || ''}"/></svg>`;
    return t.content.firstElementChild;
  }
  return { face, joker, back, flip, suit, rankOf, suitOf };
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
