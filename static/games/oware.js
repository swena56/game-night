// Oware: two rows of six pits drawn from your side (your row at the bottom, sowing runs left to right
// along it and back along the top). Seeds lie scattered in each pit (up to 20, with the count beside);
// a sowing drops them in one pit at a time along its path (#56).
UI.oware = (() => {
  let S, ctx, shownKey = null;
  const MAX_SHOWN = 20, STEP = 0.11;  // seconds between seeds as a sowing plays out
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    shownKey = null;
    // rows, stores and pits are labelled, and the flow arrows show the way seeds travel (#16)
    main.innerHTML = `<div class="ow"><div class="ow-store" id="owTheirs"><b></b><small></small></div>
      <div class="ow-mid"><div class="ow-label" id="owTopLabel"></div>
        <div class="ow-board"><div class="ow-row" id="owTop"></div><div class="ow-row" id="owBottom"></div></div>
        <div class="ow-label" id="owBottomLabel"></div></div>
      <div class="ow-store" id="owMine"><b></b><small>You</small></div></div>
      <p id="owHint" class="hint"></p><div id="owUndo" class="row center"></div>`;
    side.innerHTML = `<div class="panel"><div id="owSeats"></div>
      <p class="hint left">Seeds travel counter-clockwise: along your row to the right, then back along the top.
      Your captures go in the store on the right (gold).</p></div>`;
  }

  // what sowing `from` would do, by the server's rules: the pits that get seeds, where the last one lands,
  // and the rival pits it captures (none if that would take every rival seed)
  const sideOf = (seat) => (seat === 0 ? [0, 1, 2, 3, 4, 5] : [6, 7, 8, 9, 10, 11]);
  function preview(pits, from, me) {
    const after = [...pits], reached = new Set();
    let left = after[from], i = from;
    after[from] = 0;
    while (left) { i = (i + 1) % 12; if (i === from) continue; after[i]++; reached.add(i); left--; }
    const theirs = sideOf(1 - me), taken = [];
    for (let j = i; theirs.includes(j) && (after[j] === 2 || after[j] === 3); j--) taken.push(j);
    const all = theirs.reduce((t, j) => t + after[j], 0);
    const seeds = taken.reduce((t, j) => t + after[j], 0);
    return { reached, last: i, taken: seeds === all ? [] : taken, slam: taken.length > 0 && seeds === all, seeds };
  }

  // Seed k of a pit always sits in the same spot (a golden-angle spiral with a little jitter), so seeds
  // already there never move when more arrive, and the pit never changes size (#55, #57).
  function seedAt(i, k) {
    const a = k * 2.39996 + i, r = Math.min(36, 8.6 * Math.sqrt(k + 0.4)) + ((i * 7 + k * 13) % 5) - 2;
    return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
  }
  function pit(i, n, cls, drops) {
    const b = ctx.el('button', 'ow-pit ' + cls);
    b.dataset.i = i;
    b.setAttribute('aria-label', `${n} seed${n === 1 ? '' : 's'}`);
    const seeds = ctx.el('span', 'ow-seeds'), shown = Math.min(n, MAX_SHOWN);
    for (let k = 0; k < shown; k++) {
      const seed = ctx.el('i'), [x, y] = seedAt(i, k);
      seed.style.left = `${x}%`; seed.style.top = `${y}%`;
      const d = drops.length - (n - k);  // the newest seeds are the ones that just fell in
      if (d >= 0) { seed.className = 'drop'; seed.style.setProperty('--d', `${drops[d]}s`); }
      seeds.append(seed);
    }
    if (n > MAX_SHOWN) seeds.append(ctx.el('b', '', String(n)));
    b.append(seeds, ctx.el('small', '', String(n)), ctx.el('em', 'ow-num', String(i % 6 + 1)));
    return b;
  }

  // the pits a sowing dropped seeds into, with when each seed lands: {pit: [delay, ...]}
  function sowing(from, seeds) {
    const drops = {};
    for (let i = from, k = 0; k < seeds;) {
      i = (i + 1) % 12;
      if (i === from) continue;
      (drops[i] ||= []).push(+(k * STEP).toFixed(2));
      k++;
    }
    return drops;
  }

  function render(s, c) {
    S = s; ctx = c;
    const o = S.oware, me = o.me ?? 0, legal = new Set(o.legal);
    // the viewer's row runs left to right along the bottom; the rival's runs right to left on top
    const bottom = me === 0 ? [0, 1, 2, 3, 4, 5] : [6, 7, 8, 9, 10, 11];
    const top = (me === 0 ? [6, 7, 8, 9, 10, 11] : [0, 1, 2, 3, 4, 5]).reverse();
    const [last, caught, seeds] = o.last || [-1, [], 0];
    const key = JSON.stringify(o.last) + o.pits.join();
    const animate = shownKey != null && key !== shownKey && seeds > 0;
    shownKey = key;
    const drops = animate ? sowing(last, seeds) : {}, done = seeds * STEP;
    for (const [id, idx, mine] of [['owTop', top, false], ['owBottom', bottom, true]]) {
      const row = $(id); row.innerHTML = '';
      for (const i of idx) {
        const b = pit(i, o.pits[i], (mine ? 'mine' : 'theirs') + (legal.has(i) ? ' can' : '') + (i === last ? ' last' : '') + (caught.includes(i) ? ' caught' : ''), drops[i] || []);
        if (caught.includes(i)) b.style.setProperty('--cd', `${animate ? done : 0}s`);  // captures flash once the seeds have landed
        b.disabled = !legal.has(i) || !ctx.myTurn;
        b.onclick = () => ctx.quiet(ctx.act('sow', { pit: i }));
        if (!b.disabled) {  // a mouse or keyboard shows the move before it's made
          b.onpointerenter = (e) => e.pointerType === 'mouse' && showPreview(i);
          b.onfocus = () => b.matches(':focus-visible') && showPreview(i);
          b.onpointerleave = b.onblur = () => showPreview(null);
        }
        row.append(b);
      }
    }
    const them = 1 - me;
    const rival = ctx.player(o.seats[them])?.name ?? 'Rival', rivalShort = rival.replace(/^🤖\s*/, '');
    $('owMine').querySelector('b').textContent = String(o.stores[me]);
    $('owTheirs').querySelector('b').textContent = String(o.stores[them]);
    $('owTheirs').querySelector('small').textContent = rivalShort;
    $('owMine').title = 'Your captured seeds'; $('owTheirs').title = `${rival}'s captured seeds`;
    const watching = o.me == null;
    $('owTopLabel').textContent = `◀ ${watching ? rival : rivalShort}'s row`;
    $('owBottomLabel').textContent = watching ? `${ctx.player(o.seats[me])?.name ?? '?'}'s row ▶` : 'Your row ▶';
    const info = $('owSeats'); info.innerHTML = '';
    o.seats.forEach((pid, i) => {
      const p = ctx.player(pid), row = ctx.el('div', 'seat-row');
      const disc = ctx.el('span', 'mini-disc'); disc.style.background = p?.color ?? '#777';
      row.append(disc, ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === o.me ? ' (you)' : ''}`), ctx.el('b', '', `🌰 ${o.stores[i]}`));
      info.append(row);
    });
    baseHint = S.phase !== 'playing' ? ''
      : ctx.myTurn ? `Your turn: tap a glowing pit to sow it.${last >= 0 ? ` The blue ring is the pit ${rivalShort} last sowed from.` : ''}`
      : `${rivalShort} is thinking…`;
    $('owHint').textContent = baseHint;
    undoRow($('owUndo'), S.oware.undo, S, ctx, S.oware.me != null);
  }

  let baseHint = '';
  function showPreview(from) {
    for (const b of document.querySelectorAll('.ow-pit')) b.classList.remove('gets', 'lands', 'takes');
    const o = S?.oware;
    if (from == null || !o || o.me == null) { $('owHint').textContent = baseHint; return; }
    const pv = preview(o.pits, from, o.me), at = (i) => document.querySelector(`.ow-pit[data-i="${i}"]`);
    for (const i of pv.reached) at(i)?.classList.add('gets');
    at(pv.last)?.classList.add('lands');
    for (const i of pv.taken) at(i)?.classList.add('takes');
    const n = o.pits[from], mine = sideOf(o.me).includes(pv.last);
    const where = mine ? `your pit ${pv.last % 6 + 1}` : `their pit ${pv.last % 6 + 1}`;
    $('owHint').textContent = `Sow ${n} seed${n === 1 ? '' : 's'}: the last lands in ${where}`
      + (pv.taken.length ? ` and captures ${pv.seeds} (pits of 2 or 3)!`
        : pv.slam ? ' — that would take all their seeds, so it captures nothing.'
        : mine ? ' (captures only happen on their side).' : ' — no capture (it needs to make 2 or 3).');
  }

  return { mount, render };
})();
