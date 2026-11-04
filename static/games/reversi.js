// Reversi: an 8×8 board; your legal squares glow, the last disc is ringed and flipped discs spin over.
UI.reversi = (() => {
  let S, ctx, board, seen = '', counted = false;
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    seen = ''; counted = false;
    main.innerHTML = '<div class="rv"><div id="rvBar" class="rv-bar"><i></i><b></b><b></b></div><div class="rv-board" id="rvBoard"></div><p id="rvHint" class="hint"></p><div id="rvUndo" class="row center"></div></div>';
    side.innerHTML = '<div class="panel"><div id="rvSeats"></div><div class="row"><button id="rvResign" class="danger">🏳️ Resign</button></div></div>';
    board = $('rvBoard');
    for (let c = 0; c < 64; c++) {
      const b = ctx?.el ? ctx.el('button', 'rv-cell') : Object.assign(document.createElement('button'), { className: 'rv-cell' });
      b.setAttribute('aria-label', `${'abcdefgh'[c % 8]}${Math.floor(c / 8) + 1}`);
      b.onclick = () => ctx.myTurn && ctx.quiet(ctx.act('place', { cell: c }));
      // a preview with a mouse or keyboard: a ghost disc, and (with hints on) the discs it would turn
      b.onpointerenter = (e) => e.pointerType === 'mouse' && preview(c);
      b.onpointerleave = () => preview(null);
      b.onfocus = () => preview(c); b.onblur = () => preview(null);
      board.append(b);
    }
    gridKeys(board, 8);
    $('rvResign').onclick = async () => (await ctx.ask('Resign this game?', { ok: '🏳️ Resign', danger: true })) && ctx.quiet(ctx.act('resign'));
  }

  const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  function flipsFor(bd, me, c) {
    const out = [], r0 = Math.floor(c / 8), c0 = c % 8;
    for (const [dr, dc] of DIRS) {
      const run = [];
      let r = r0 + dr, cc = c0 + dc;
      while (r >= 0 && r < 8 && cc >= 0 && cc < 8 && bd[r * 8 + cc] === 1 - me) { run.push(r * 8 + cc); r += dr; cc += dc; }
      if (run.length && r >= 0 && r < 8 && cc >= 0 && cc < 8 && bd[r * 8 + cc] === me) out.push(...run);
    }
    return out;
  }
  function preview(c) {
    board?.querySelectorAll('.rv-ghost').forEach((g) => g.remove());
    board?.querySelectorAll('.rv-disc.would').forEach((d) => d.classList.remove('would'));
    const r = S?.reversi;
    if (c == null || !r || !ctx?.myTurn || !r.legal.includes(c)) return;
    board.children[c].append(ctx.el('span', 'rv-disc rv-ghost ' + (r.me === 0 ? 'dark' : 'light')));
    if (Object.keys(r.flipCounts || {}).length) flipsFor(r.board, r.me, c).forEach((i) => board.children[i].querySelector('.rv-disc')?.classList.add('would'));
  }

  function render(s, c) {
    S = s; ctx = c;
    preview(null);
    const r = S.reversi, legal = new Set(r.legal), flipped = new Set(r.flipped);
    const first = !seen, fresh = `${r.last}:${r.counts}` !== seen;  // animate flips once per move
    seen = `${r.last}:${r.counts}`;
    [...board.children].forEach((b, i) => {
      const v = r.board[i];
      b.classList.toggle('can', legal.has(i) && ctx.myTurn);
      b.classList.toggle('last', i === r.last);
      b.disabled = !(legal.has(i) && ctx.myTurn);
      const n = ctx.myTurn ? r.flipCounts?.[i] : null;  // flip hint: how many discs this square flips
      if (n) b.dataset.flips = n; else delete b.dataset.flips;
      let disc = b.querySelector('.rv-disc');
      if (v == null) { disc?.remove(); return; }
      if (!disc) { disc = ctx.el('span', 'rv-disc'); b.append(disc); }
      disc.className = 'rv-disc ' + (v === 0 ? 'dark' : 'light') + (fresh && flipped.has(i) ? ' flip' : '') + (fresh && i === r.last ? ' drop' : '');
    });
    // flips ripple outwards from the disc just placed, each one ticking
    if (fresh && r.last != null) {
      const lr = Math.floor(r.last / 8), lc = r.last % 8;
      [...flipped].forEach((i) => board.children[i]?.querySelector('.rv-disc')?.style.setProperty('--fd', Math.max(Math.abs(Math.floor(i / 8) - lr), Math.abs(i % 8 - lc)) * 0.07 + 's'));
      if (!first && flipped.size) { ctx.sfx('place'); for (let k = 1; k <= Math.min(flipped.size, 8); k++) setTimeout(() => ctx.sfx('flip'), 80 + k * 70); }
      if (flipped.size >= 6) Kit.callout(`${flipped.size} flips!`, 'gold', { ms: 1100 });
    }
    // the tug of war: dark's share of the discs on the board
    const total = r.counts[0] + r.counts[1], bar = $('rvBar');
    bar.firstChild.style.width = (total ? (r.counts[0] / total) * 100 : 50) + '%';
    bar.children[1].textContent = String(r.counts[0]); bar.children[2].textContent = String(r.counts[1]);
    // at the end the discs are counted out one by one, dark then light
    if (S.phase !== 'playing' && !counted && !first) {
      counted = true;
      const order = [0, 1].flatMap((v) => [...board.children].map((b, i) => [b, i]).filter(([, i]) => r.board[i] === v));
      order.forEach(([b], k) => b.querySelector('.rv-disc')?.style.setProperty('--cd', Math.min(k * 0.035, 2.4) + 's'));
      board.classList.add('counting');
      setTimeout(() => board.classList.remove('counting'), 3200);
    }
    if (S.phase === 'playing') counted = false;
    const info = $('rvSeats'); info.innerHTML = '';
    r.seats.forEach((pid, i) => {
      const p = ctx.player(pid), row = ctx.el('div', 'seat-row');
      row.append(ctx.el('span', 'rv-disc mini ' + (i === 0 ? 'dark' : 'light')), ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === r.me ? ' (you)' : ''}`), ctx.el('b', '', String(r.counts[i])));
      info.append(row);
    });
    $('rvHint').textContent = S.phase === 'playing' && ctx.myTurn ? 'Tap a glowing square.' : '';
    $('rvResign').hidden = r.me == null;
    $('rvResign').disabled = S.phase !== 'playing';
    undoRow($('rvUndo'), r.undo, S, ctx, r.me != null);
  }

  return { mount, render, ownSounds: true };
})();
