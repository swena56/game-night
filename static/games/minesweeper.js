// Minesweeper: the same minefield for everyone, raced. Tap a square to uncover it; 🚩 switches the tap to a flag
// (long-press flags too, and a flag on an uncovered number's neighbours is cleared by tapping the number: chord).
// The server owns the mines and checks every move; this screen only draws the numbers it is sent.
UI.minesweeper = (() => {
  let S, ctx, v, clk = null, busy = false, sel = 0;
  let flagMode = false, seenSeq = -1, seenKey = '', seenDone = false, press = null, prevOpen = null;
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    flagMode = false; seenSeq = -1; seenKey = ''; seenDone = false; busy = false; prevOpen = null; sel = 0;
    main.innerHTML = `<div class="swp" id="swpRoot">
      <div class="pt-head"><span id="swpRound"></span><span id="swpInfo" class="pt-info"></span><b id="swpClock" class="pt-clock"></b></div>
      <div class="dd-bar"><span id="swpBar"></span></div>
      <div class="swp-board" id="swpBoard" role="grid" aria-label="Minefield"></div>
      <div class="pt-tools">
        <button type="button" id="swpFlag" class="swp-flagtool" title="Flag mode: tap to mark a mine (F)" aria-pressed="false">🚩<small>Flag</small></button>
        <button type="button" id="swpHint" title="Uncover a safe square (costs 1 point)">💡<small>Hint</small></button>
        <button type="button" id="swpBank" title="Stop here and keep your points">🏳️<small>Done</small></button>
      </div>
      <div class="pt-note" id="swpNote"></div></div>`;
    side.innerHTML = '<div class="panel"><h3>Sweepers</h3><div id="swpRacers"></div><p class="hint left">Everyone clears the same field. A safe square +1, a mine −4, 💡 −1; clearing it all +10, first to finish +5 more.</p></div>';
    const board = $('swpBoard');
    board.addEventListener('pointerdown', (e) => {
      const c = e.target.closest('.swp-cell'); if (!c) return;
      press = { i: +c.dataset.i, long: false, t: setTimeout(() => { if (press) { press.long = true; tap(press.i, true); } }, 380) };
    });
    const clear = () => { if (press) { clearTimeout(press.t); press = null; } };
    board.addEventListener('pointerup', (e) => {
      const p = press; clear();
      if (p && !p.long) { const c = e.target.closest('.swp-cell'); if (c && +c.dataset.i === p.i) tap(p.i, false); }
    });
    board.addEventListener('pointerleave', clear); board.addEventListener('pointercancel', clear);
    board.addEventListener('contextmenu', (e) => { e.preventDefault(); });
    $('swpFlag').onclick = () => { flagMode = !flagMode; draw(); };
    $('swpHint').onclick = () => send('hint', {});
    $('swpBank').onclick = async () => {
      if (!live()) return;
      if (await ctx.ask('Call it a day? You keep the points you have, but can\'t uncover more of this field.', { ok: '🏳️ Done' })) send('bank', {});
    };
    window.addEventListener('keydown', key);
    clk = Kit.clock($('swpBar'), $('swpClock'), { warn: 30, beep: live, sfx: (k) => ctx.sfx(k) });
  }

  function unmount() { clk?.stop(); window.removeEventListener('keydown', key); if (press) clearTimeout(press.t); press = null; }

  const live = () => S?.phase === 'playing' && v?.stage === 'play' && v.playing && !v.done && !v.banked && !!ctx.act;

  function send(type, extra) {
    if (!live() || busy) return;
    busy = true;
    ctx.act(type, extra).catch((err) => ctx.toast(err?.message || 'Not right now.')).finally(() => { busy = false; });
  }

  // a tap: on a covered square it digs (or flags in flag mode, or on a long press); on a number it chords
  function tap(i, long) {
    if (!live()) return;
    sel = i;
    const g = v.grid[i];
    if (g >= 0 && g < 9) { if (g > 0) send('chord', { cell: i }); return; }
    if (g === 9) return;
    if (long || flagMode) { ctx.buzz?.(12); return send('flag', { cell: i }); }
    if (g === -2) return send('flag', { cell: i });   // a tap on a flag lifts it
    send('open', { cell: i });
  }

  function key(e) {
    if (!v || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const n = v.n, k = e.key.toLowerCase();
    if (k === 'f') { flagMode = !flagMode; draw(); return; }
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); tap(sel, false); return; }
    const mv = { ArrowUp: -n, ArrowDown: n, ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (mv) {
      e.preventDefault();
      if (mv === -1 && sel % n === 0) return; if (mv === 1 && sel % n === n - 1) return;
      sel = Math.max(0, Math.min(n * n - 1, sel + mv)); draw();
    }
  }

  function render(s, c) {
    S = s; ctx = c; v = S.minesweeper;
    if (!v) return;
    const key = `${v.round}:${v.n}:${v.mines}`;
    if (key !== seenKey) { seenKey = key; seenSeq = -1; seenDone = false; prevOpen = null; sel = 0; }
    const fresh = seenSeq >= 0 && v.seq !== seenSeq;
    seenSeq = v.seq;
    draw();
    if (fresh) feedback();
    if (v.done && !seenDone && fresh) {
      Kit.callout(v.boom || v.hints ? '🏁 Field cleared!' : '🧹 Clean sweep!', 'gold', { ms: 1600 });
      ctx.sfx('fanfare');
    }
    seenDone = v.done;
    racers();
    const timed = S.phase === 'playing' && v.stage === 'play';
    clk.set({ left: v.left, secs: v.secs, on: timed && v.clock !== false, hide: timed && v.clock === false });
  }

  function feedback() {
    const board = $('swpBoard');
    if (v.miss != null) {
      const cell = board.children[v.miss];
      ctx.sfx('wrong'); ctx.buzz?.(60); Kit.callout('💥 Mine! −4', 'bad', { ms: 700 });
      if (cell) { cell.classList.remove('boom'); void cell.offsetWidth; cell.classList.add('boom'); }
      return;
    }
    ctx.sfx('place');
  }

  function draw() {
    if (!v) return;
    const { n, grid, show } = v, board = $('swpBoard');
    board.style.setProperty('--n', n);
    if (board.children.length !== n * n) {
      board.innerHTML = '';
      for (let i = 0; i < n * n; i++) {
        const b = ctx.el('button', 'swp-cell'); b.type = 'button'; b.dataset.i = i; board.append(b);
      }
    }
    const can = live(), opened = new Set();
    for (let i = 0; i < n * n; i++) {
      const b = board.children[i], g = grid[i], r = Math.floor(i / n), c = i % n;
      const isOpen = g >= 0 && g < 9, isMine = !!show && show[i] === 1;
      b.className = 'swp-cell' + (isOpen ? ` open n${g}` : '') + (g === 9 ? ' boom' : '') + (v.hint === i ? ' hinted' : '');
      if (isOpen && g > 0 && can) {   // a number whose flags are all down can be chorded
        let fl = 0; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc; if ((dr || dc) && rr >= 0 && rr < n && cc >= 0 && cc < n && grid[rr * n + cc] === -2) fl++;
        }
        if (fl === g) b.classList.add('chordable');
      }
      let t = '';
      if (isOpen) t = g ? String(g) : '';
      else if (g === 9) t = '💥';
      else if (g === -2) { t = '🚩'; b.classList.add('flag'); if (show && !isMine) b.classList.add('wrongflag'); }
      else if (isMine) { t = '💣'; b.classList.add('mineshow'); }
      if (b.textContent !== t) b.textContent = t;
      if (isOpen) opened.add(i);
      b.setAttribute('aria-label', `Row ${r + 1}, column ${c + 1}: ` + (isOpen ? (g ? `${g} nearby` : 'clear') : g === -2 ? 'flag' : g === 9 ? 'mine' : 'covered'));
    }
    // a cascade ripples out from where it started
    if (prevOpen && v.hint == null && v.miss == null) {
      const born = [...opened].filter((i) => !prevOpen.has(i));
      if (born.length > 3 && sel >= 0) born.forEach((i) => {
        const el = board.children[i]; if (!el) return;
        el.style.animationDelay = `${Math.min(300, (Math.abs((i % n) - (sel % n)) + Math.abs(Math.floor(i / n) - Math.floor(sel / n))) * 30)}ms`;
        el.classList.add('wave');
      });
    }
    prevOpen = opened;
    $('swpFlag').classList.toggle('on', flagMode);
    $('swpFlag').setAttribute('aria-pressed', String(flagMode));
    $('swpFlag').disabled = $('swpHint').disabled = $('swpBank').disabled = !can;
    if (v.hintsLeft === 0) $('swpHint').disabled = true;
    $('swpHint').querySelector('small').textContent = v.hintsLeft == null ? 'Hint' : `Hint (${v.hintsLeft})`;
    $('swpRoot').classList.toggle('off', !can);

    const lv = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }[v.level] || v.level;
    $('swpRound').textContent = `💣 ${v.rounds > 1 ? `Field ${v.round}/${v.rounds} · ` : ''}${n}×${n} ${lv}`;
    const left = v.safe - opened.size;
    $('swpInfo').textContent = v.playing ? `🚩 ${v.mines - v.flags} · ${left} to go${v.boom ? ` · 💥${v.boom}` : ''}${v.hints ? ` · 💡${v.hints}` : ''}` : '';
    let note = '';
    if (v.gained) note = v.playing ? `+${v.gained[S.me.id] ?? 0} this field` + (left > 0 ? ' · the mines are shown' : '') : '';
    else if (v.done) note = '🏁 Cleared! Waiting for the others…';
    else if (v.banked) note = '🏳️ You called it a day. Waiting for the others…';
    else if (!v.playing) note = 'Watching: the field as it was dealt.';
    else if (flagMode) note = '🚩 Flag mode: tap a square to mark a mine.';
    else note = 'Tap to uncover · long-press (or 🚩) to flag · tap a number with its flags placed to clear around it.';
    $('swpNote').textContent = note;
  }

  function racers() {
    const box = $('swpRacers'); box.innerHTML = '';
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
    const x = s.minesweeper;
    if (s.phase !== 'playing' || !x) return null;
    return x.stage === 'reveal' ? '💣 Field over' : !x.playing ? '💣 Watching' : x.done ? '🏁 Cleared — waiting' : x.banked ? '🏳️ Waiting' : '💣 Sweep!';
  };
  const myMove = (s) => s.phase === 'playing' && s.minesweeper?.stage === 'play' && s.minesweeper.playing && !s.minesweeper.done && !s.minesweeper.banked;

  return { mount, render, unmount, turnText, myMove, ownTimer: () => true };
})();
