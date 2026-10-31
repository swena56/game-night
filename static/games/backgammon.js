// Backgammon: an HTML board drawn from your side (your home board bottom right, whichever colour you
// play). Tap a checker (or the bar), then a highlighted point or the tray to move. Undo until you end.
UI.backgammon = (() => {
  let S, ctx, sel = null;
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    sel = null;
    main.innerHTML = `<div class="bg">
      <div class="bg-info"><span id="bgOpp"></span><span id="bgScore"></span></div>
      <div id="bgBoard" class="bg-board"></div>
      <div class="bg-info"><span id="bgMe"></span><span id="bgDice" class="bg-dice"></span></div>
      <div class="row bg-actions">
        <button id="bgDouble" class="big">🎲 Double</button>
        <button id="bgTake" class="primary big">✋ Take</button>
        <button id="bgDrop" class="big danger">🏳️ Drop</button>
        <button id="bgRoll" class="primary big">🎲 Roll</button>
        <button id="bgUndo" class="big">↩ Undo</button>
        <button id="bgEnd" class="primary big">✅ End turn</button>
      </div>
      <p id="bgHint" class="hint"></p>
    </div>`;
    side.innerHTML = `<div class="panel"><ul class="rules bg-rules">
      <li>Tap a checker, then a highlighted point. Doubles move four times.</li>
      <li>A lone checker can be hit to the bar; it must come back in first.</li>
      <li>All fifteen home? Bear off into the tray on the right.</li>
      <li>Gammon (they bore none off) = 2 points · backgammon = 3.</li>
      <li>🎲 Before rolling you may double the stakes; your rival takes (and owns the cube) or drops and loses.</li></ul>
      <div id="bgCube" class="bg-cube"></div></div>`;
    $('bgRoll').onclick = () => ctx.quiet(ctx.act('roll'));
    $('bgDouble').onclick = async () => (await ctx.ask(`Offer to double? The game would be worth ${S.backgammon.cube * 2}, and your rival takes the cube.`, { ok: '🎲 Double' })) && ctx.quiet(ctx.act('double'));
    $('bgTake').onclick = () => ctx.quiet(ctx.act('take'));
    $('bgDrop').onclick = async () => (await ctx.ask(`Drop and lose ${S.backgammon.cube} point${S.backgammon.cube > 1 ? 's' : ''} now?`, { ok: '🏳️ Drop', danger: true })) && ctx.quiet(ctx.act('drop'));
    $('bgUndo').onclick = () => { sel = null; ctx.quiet(ctx.act('undo')); };
    $('bgEnd').onclick = () => { sel = null; ctx.quiet(ctx.act('end')); };
  }

  function render(s, c) {
    S = s; ctx = c;
    const g = S.backgammon;
    const view = g.me || 'w';                       // spectators watch from White's side
    const toV = (i) => (view === 'w' ? i : 25 - i);  // real point → displayed number (home = 1..6)
    const mine = ctx.myTurn && S.phase === 'playing';
    const legal = mine ? g.legal : [];
    const sources = new Set(legal.map(([f]) => String(f)));
    if (sel != null && !sources.has(String(sel))) sel = null;
    if (sel == null && sources.size === 1 && sources.has('bar')) sel = 'bar';
    const dests = new Set(legal.filter(([f]) => String(f) === String(sel)).map(([, t]) => String(t)));
    const last = new Set((g.moves.length ? g.moves : g.last).flatMap(([f, t]) => [String(f), String(t)]));
    const myColor = view, oppColor = view === 'w' ? 'b' : 'w';

    const tap = (where) => {
      if (!mine) return;
      const key = String(where);
      if (sel != null && dests.has(key)) {
        const to = key === 'off' ? 'off' : +key;
        const frm = String(sel) === 'bar' ? 'bar' : +sel;
        sel = null;
        return ctx.quiet(ctx.act('move', { from: frm, to }));
      }
      sel = sources.has(key) && String(sel) !== key ? (key === 'bar' ? 'bar' : +key) : null;
      ctx.rerender();
    };

    const board = $('bgBoard'); board.innerHTML = '';
    const point = (v, top) => {
      const i = view === 'w' ? v : 25 - v;          // displayed → real
      const n = g.points[i - 1];
      const el = ctx.el('button', `bg-pt ${top ? 'top' : 'bottom'} ${v % 2 ? 'odd' : 'even'}`);
      el.dataset.i = i;
      if (String(sel) === String(i)) el.classList.add('sel');
      if (dests.has(String(i))) el.classList.add('dest');
      if (sources.has(String(i)) && sel == null) el.classList.add('src');
      if (last.has(String(i))) el.classList.add('last');
      const stack = ctx.el('div', 'bg-stack');
      const color = n > 0 ? 'w' : 'b', count = Math.abs(n);
      for (let k = 0; k < Math.min(count, 5); k++) stack.append(ctx.el('span', `bg-ck ${color}`, k === 4 && count > 5 ? String(count) : ''));
      el.append(stack, ctx.el('small', 'bg-num', String(v)));
      el.onclick = () => tap(i);
      return el;
    };
    const half = (vs, top) => { const h = ctx.el('div', 'bg-half'); for (const v of vs) h.append(point(v, top)); return h; };
    const barEl = (color, top) => {
      const el = ctx.el('button', `bg-bar ${top ? 'top' : 'bottom'}`);
      const n = g.bar[color];
      for (let k = 0; k < Math.min(n, 4); k++) el.append(ctx.el('span', `bg-ck ${color}`, k === 3 && n > 4 ? String(n) : ''));
      if (color === myColor) {
        if (String(sel) === 'bar') el.classList.add('sel');
        else if (sources.has('bar')) el.classList.add('src');
        el.onclick = () => tap('bar');
      } else el.disabled = true;
      return el;
    };
    const tray = (color, top) => {
      const el = ctx.el('button', `bg-off ${top ? 'top' : 'bottom'}`);
      const n = g.off[color];
      for (let k = 0; k < n; k++) el.append(ctx.el('span', `bg-slab ${color}`));
      el.title = `${n} borne off`;
      if (color === myColor && dests.has('off')) { el.classList.add('dest'); el.onclick = () => tap('off'); } else el.disabled = !dests.has('off');
      return el;
    };
    // top: 13–18 | bar | 19–24 | tray (opponent's)   bottom: 12–7 | bar | 6–1 | tray (mine)
    board.append(half([13, 14, 15, 16, 17, 18], true), barEl(oppColor, true), half([19, 20, 21, 22, 23, 24], true), tray(oppColor, true),
      half([12, 11, 10, 9, 8, 7], false), barEl(myColor, false), half([6, 5, 4, 3, 2, 1], false), tray(myColor, false));

    // dice, buttons, names
    const dice = $('bgDice'); dice.innerHTML = '';
    const left = [...g.dice];
    for (const d of g.rolled) {
      const used = !left.includes(d); if (!used) left.splice(left.indexOf(d), 1);
      dice.append(ctx.el('span', 'bg-die' + (used ? ' used' : '') + (g.turn === myColor ? '' : ' theirs'), String(d)));
    }
    const name = (col) => ctx.player(g.names[col])?.name ?? '?';
    $('bgOpp').textContent = `${oppColor === 'w' ? '⚪' : '⚫'} ${name(oppColor)} · ${g.pips[oppColor]} pips`;
    $('bgMe').textContent = `${myColor === 'w' ? '⚪' : '⚫'} ${g.me ? 'You' : name(myColor)} · ${g.pips[myColor]} pips`;
    $('bgScore').textContent = g.match > 1 ? `Match to ${g.match}: ${g.score[myColor]}–${g.score[oppColor]}` : '';
    const answering = mine && !!g.offer;
    $('bgRoll').hidden = !mine || g.rolled.length > 0 || answering;
    $('bgDouble').hidden = !g.canDouble;
    $('bgTake').hidden = $('bgDrop').hidden = !answering;
    $('bgCube').textContent = !g.cubeOn ? '' : `🎲 Cube: ${g.cube} · ${!g.owner ? 'either player can double'
      : g.owner === myColor && g.me ? 'only you can double' : `only ${name(g.owner)} can double`}`;
    $('bgUndo').hidden = !mine || !g.moves.length;
    $('bgEnd').hidden = !mine || !g.canEnd;
    $('bgHint').textContent = answering ? `${name(g.offer)} doubles! Take to play on for ${g.cube * 2}, or drop and lose ${g.cube}.`
      : !mine ? (S.phase === 'playing' ? (g.offer ? `Waiting for ${ctx.player(S.turn)?.name ?? ''} to take or drop…` : `${ctx.player(S.turn)?.name ?? ''} is moving…`) : '')
      : !g.rolled.length ? 'Roll the dice.' : g.canEnd ? (g.moves.length ? 'Done? End your turn (or undo).' : "No legal moves. End your turn.")
      : sel != null ? 'Now tap a highlighted point.' : g.bar[myColor] ? 'Bring your checker in from the bar first.' : 'Tap a glowing checker to move it.';
  }

  return { mount, render };
})();
