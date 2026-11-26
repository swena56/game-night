// Sudoku: the grid, a digit pad and a tool row. Tap a cell, then a digit (or type it). The server checks
// each digit against the solution: right ones stay, wrong ones bounce off and cost a point. Pencil marks
// (✏️) live only in this browser, and clear themselves as digits land around them.
UI.sudoku = (() => {
  let S, ctx, v, clk = null, busy = false;
  let sel = -1, pencil = false, notes = {}, notesKey = '', seenSeq = -1, seenKey = '', seenDone = false, units = null;
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    sel = -1; pencil = false; notes = {}; notesKey = ''; seenSeq = -1; seenKey = ''; seenDone = false; busy = false;
    main.innerHTML = `<div class="sd" id="sdRoot">
      <div class="pt-head"><span id="sdRound"></span><span id="sdInfo" class="pt-info"></span><b id="sdClock" class="pt-clock"></b></div>
      <div class="dd-bar"><span id="sdBar"></span></div>
      <div class="sd-board" id="sdBoard" role="grid" aria-label="Sudoku grid"></div>
      <div class="sd-pad" id="sdPad"></div>
      <div class="pt-tools">
        <button type="button" id="sdPencil" title="Pencil marks: notes only you see (N)" aria-pressed="false">✏️<small>Notes</small></button>
        <button type="button" id="sdErase" title="Clear this cell's notes (Backspace)">⌫<small>Erase</small></button>
        <button type="button" id="sdHint" title="Fill in a cell that can be worked out (costs 1 point)">💡<small>Hint</small></button>
        <button type="button" id="sdBank" title="Stop here and keep your points">🏳️<small>Done</small></button>
      </div>
      <div class="pt-note" id="sdNote"></div></div>`;
    side.innerHTML = '<div class="panel"><h3>Solvers</h3><div id="sdRacers"></div><p class="hint left">Everyone solves the same grid. A right digit +1, a wrong one −1, 💡 −1; finishing +10, first to finish +5 more.</p></div>';
    $('sdBoard').addEventListener('click', (e) => {
      const c = e.target.closest('.sd-cell');
      if (c) { sel = +c.dataset.i; draw(); }
    });
    $('sdPad').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-d]');
      if (b) digit(+b.dataset.d);
    });
    $('sdPencil').onclick = () => { pencil = !pencil; draw(); };
    $('sdErase').onclick = erase;
    $('sdHint').onclick = () => send('hint', {});
    $('sdBank').onclick = async () => {
      if (!live()) return;
      if (await ctx.ask('Call it a day? You keep the points you have, but can\'t fill in more of this grid.', { ok: '🏳️ Done' })) send('bank', {});
    };
    window.addEventListener('keydown', key);
    clk = Kit.clock($('sdBar'), $('sdClock'), { warn: 30, beep: live, sfx: (k) => ctx.sfx(k) });
  }

  function unmount() { clk?.stop(); window.removeEventListener('keydown', key); }

  const live = () => S?.phase === 'playing' && v?.stage === 'play' && v.playing && !v.done && !v.banked && !!ctx.act;

  function send(type, extra) {
    if (!live() || busy) return;
    busy = true;
    ctx.act(type, extra).catch((err) => ctx.toast(err?.message || 'Not right now.')).finally(() => { busy = false; });
  }

  function digit(d) {
    if (!live() || sel < 0 || v.grid[sel]) return;
    if (pencil) {
      notes[sel] = (notes[sel] || 0) ^ (1 << d);
      ctx.sfx('tick');
      return draw();
    }
    send('put', { cell: sel, digit: d });
  }

  function erase() {
    if (sel >= 0 && notes[sel]) { delete notes[sel]; draw(); }
  }

  function key(e) {
    if (!v || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const n = v.n;
    if (/^[1-9]$/.test(e.key) && +e.key <= n) { digit(+e.key); e.preventDefault(); return; }
    const k = e.key.toLowerCase();
    if (k === 'n' || k === 'p') { pencil = !pencil; draw(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { erase(); e.preventDefault(); return; }
    const mv = { ArrowUp: -n, ArrowDown: n, ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (mv) {
      e.preventDefault();
      if (sel < 0) sel = 0;
      else if (mv === -1 && sel % n === 0) sel += n - 1;
      else if (mv === 1 && sel % n === n - 1) sel -= n - 1;
      else sel = (sel + mv + n * n) % (n * n);
      draw();
    }
  }

  // rows, columns and boxes, as lists of cells
  function unitsOf(n, bh, bw) {
    const u = [];
    for (let r = 0; r < n; r++) u.push([...Array(n)].map((_, c) => r * n + c));
    for (let c = 0; c < n; c++) u.push([...Array(n)].map((_, r) => r * n + c));
    for (let br = 0; br < n; br += bh) for (let bc = 0; bc < n; bc += bw) {
      const b = [];
      for (let r = 0; r < bh; r++) for (let c = 0; c < bw; c++) b.push((br + r) * n + bc + c);
      u.push(b);
    }
    return u;
  }


  function render(s, c) {
    S = s; ctx = c; v = S.sudoku;
    if (!v) return;
    const key = `${v.round}:${v.puzzle.join('')}`;
    if (key !== notesKey) { notesKey = key; notes = {}; sel = -1; seenSeq = -1; seenDone = false; units = unitsOf(v.n, v.bh, v.bw); }
    units ||= unitsOf(v.n, v.bh, v.bw);
    // a digit landed: its notes go, and so does that digit from the notes around it
    v.grid.forEach((d, i) => {
      if (!d) return;
      delete notes[i];
      for (const u of units) if (u.includes(i)) for (const j of u) if (notes[j]) notes[j] &= ~(1 << d);
    });
    const fresh = seenSeq >= 0 && v.seq !== seenSeq;
    seenSeq = v.seq;
    if (fresh) feedback();
    if (v.done && !seenDone && fresh) {
      Kit.callout(v.wrong || v.hints ? '🏁 Solved!' : '✨ Solved, no slips!', 'gold', { ms: 1600 });
      ctx.sfx('fanfare');
    }
    seenDone = v.done;
    draw();
    racers();
    const timed = S.phase === 'playing' && v.stage === 'play';
    clk.set({ left: v.left, secs: v.secs, on: timed && v.clock !== false, hide: timed && v.clock === false });
  }

  // what the last move did: a wrong digit shakes its cell; a finished row, column or box glows
  function feedback() {
    const board = $('sdBoard');
    if (v.miss) {
      const [i, d] = v.miss, cell = board.children[i];
      ctx.sfx('wrong'); ctx.buzz?.(40);
      if (cell) {
        cell.classList.remove('bad'); void cell.offsetWidth; cell.classList.add('bad');
        cell.dataset.miss = d;
      }
      return;
    }
    ctx.sfx('place');
    const at = v.hint ?? sel;
    const doneUnits = units.filter((u) => u.includes(at) && u.every((j) => v.grid[j]));
    if (doneUnits.length && !v.done) {
      ctx.sfx('good');
      requestAnimationFrame(() => doneUnits.flat().forEach((j, k) => {
        const el = board.children[j];
        if (!el) return;
        el.style.animationDelay = `${(k % v.n) * 25}ms`;
        el.classList.remove('wave'); void el.offsetWidth; el.classList.add('wave');
      }));
    }
  }

  function draw() {
    if (!v) return;
    const { n, bh, bw, grid, puzzle, sol } = v;
    const board = $('sdBoard');
    board.style.setProperty('--n', n);
    board.classList.toggle('mini', n === 6);
    if (board.children.length !== n * n) {
      board.innerHTML = '';
      for (let i = 0; i < n * n; i++) {
        const b = ctx.el('button', 'sd-cell');
        b.type = 'button'; b.dataset.i = i;
        const r = Math.floor(i / n), c = i % n;
        if (c % bw === bw - 1 && c < n - 1) b.classList.add('bx-r');
        if (r % bh === bh - 1 && r < n - 1) b.classList.add('bx-b');
        board.append(b);
      }
    }
    const sr = sel >= 0 ? Math.floor(sel / n) : -1, sc = sel % n;
    const sb = sel >= 0 ? Math.floor(sr / bh) * (n / bw) + Math.floor(sc / bw) : -1;
    const sd = sel >= 0 ? grid[sel] : 0;
    for (let i = 0; i < n * n; i++) {
      const b = board.children[i], d = grid[i], r = Math.floor(i / n), c = i % n;
      const box = Math.floor(r / bh) * (n / bw) + Math.floor(c / bw);
      b.classList.toggle('given', !!puzzle[i]);
      b.classList.toggle('mine', !!d && !puzzle[i]);
      b.classList.toggle('hinted', v.hint === i);
      b.classList.toggle('sel', i === sel);
      b.classList.toggle('peer', sel >= 0 && i !== sel && (r === sr || c === sc || box === sb));
      b.classList.toggle('same', !!sd && d === sd && i !== sel);
      const missed = !d && sol;
      b.classList.toggle('missed', !!missed);
      b.textContent = '';
      if (d || missed) b.textContent = String(d || sol[i]);
      else if (notes[i]) {
        const g = ctx.el('span', 'sd-notes');
        for (let k = 1; k <= n; k++) g.append(ctx.el('i', '', notes[i] >> k & 1 ? String(k) : ''));
        b.append(g);
      }
      b.setAttribute('aria-label', `Row ${r + 1}, column ${c + 1}: ${d || 'empty'}`);
    }
    // the pad: one button per digit, dimmed once all of that digit are in
    const pad = $('sdPad');
    if (pad.children.length !== n) {
      pad.innerHTML = '';
      for (let k = 1; k <= n; k++) {
        const b = ctx.el('button', 'sd-key'); b.type = 'button'; b.dataset.d = k;
        b.append(ctx.el('b', '', String(k)), ctx.el('small'));
        pad.append(b);
      }
    }
    pad.classList.toggle('pencil', pencil);
    const can = live();
    for (const b of pad.children) {
      const k = +b.dataset.d, left = n - grid.filter((x) => x === k).length;
      b.lastChild.textContent = left ? String(left) : '✓';
      b.classList.toggle('all', !left);
      b.disabled = !can || (!left && !pencil);
    }
    $('sdPencil').classList.toggle('pt-glow', pencil);
    $('sdPencil').setAttribute('aria-pressed', String(pencil));
    $('sdPencil').disabled = $('sdHint').disabled = $('sdBank').disabled = !can;
    if (v.hintsLeft === 0) $('sdHint').disabled = true;
    $('sdHint').hidden = !S.hintsOk;
    $('sdHint').querySelector('small').textContent = v.hintsLeft == null ? 'Hint' : `Hint (${v.hintsLeft})`;
    $('sdErase').disabled = !can || !(sel >= 0 && notes[sel]);
    $('sdRoot').classList.toggle('off', !can);

    const lv = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }[v.level] || v.level;
    $('sdRound').textContent = `🔢 ${v.rounds > 1 ? `Puzzle ${v.round}/${v.rounds} · ` : ''}${n}×${n} ${lv}`;
    const left = grid.filter((x) => !x).length;
    $('sdInfo').textContent = v.playing ? `${left} left${v.wrong ? ` · ✗${v.wrong}` : ''}${v.hints ? ` · 💡${v.hints}` : ''}` : '';
    let note = '';
    if (v.why && v.hint != null && v.playing) note = `💡 ${v.why}`;
    else if (v.gained) note = v.playing ? `+${v.gained[S.me.id] ?? 0} this puzzle` + (left ? ' · the red digits were still to find' : '') : '';
    else if (v.done) note = '🏁 Solved! Waiting for the others…';
    else if (v.banked) note = '🏳️ You called it a day. Waiting for the others…';
    else if (!v.playing) note = 'Watching: the grid as it was dealt.';
    else if (pencil) note = '✏️ Notes on: digits go in as pencil marks.';
    else if (sel < 0) note = 'Tap a cell, then a digit.';
    $('sdNote').textContent = note;
  }

  function racers() {
    const box = $('sdRacers'); box.innerHTML = '';
    for (const r of [...v.rivals].sort((a, b) => b.score - a.score || b.prog[0] - a.prog[0])) {
      const p = ctx.player(r.id);
      if (!p) continue;
      const row = ctx.el('div', 'seat-row pt-racer');
      const dot = ctx.el('span', 'dot'); dot.style.background = p.color;
      const flag = r.done != null ? ` · 🏁 ${Math.floor(r.done / 60)}:${String(r.done % 60).padStart(2, '0')}` : r.banked ? ' · 🏳️' : '';
      row.append(dot, ctx.el('span', 'grow', `${r.id === S.me.id ? 'You' : p.name}: ${r.score} pts${flag}`));
      const bar = ctx.el('span', 'pt-prog');
      const fill = ctx.el('i'); fill.style.width = `${(r.prog[0] / Math.max(1, r.prog[1])) * 100}%`; fill.style.background = p.color;
      bar.append(fill, ctx.el('b', '', `${r.prog[0]}/${r.prog[1]}`));
      row.append(bar);
      box.append(row);
    }
  }

  const turnText = (s) => {
    const x = s.sudoku;
    if (s.phase !== 'playing' || !x) return null;
    return x.stage === 'reveal' ? '🔢 Puzzle over' : !x.playing ? '🔢 Watching' : x.done ? '🏁 Solved — waiting' : x.banked ? '🏳️ Waiting' : '🔢 Solve!';
  };
  const myMove = (s) => s.phase === 'playing' && s.sudoku?.stage === 'play' && s.sudoku.playing && !s.sudoku.done && !s.sudoku.banked;

  return { mount, render, unmount, turnText, myMove, ownTimer: () => true };
})();
