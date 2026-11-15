// Word Search: a square letter grid with an SVG layer on top for the circled words, and the word list
// below. Drag from a word's first letter to its last (the line snaps to the eight directions), or tap
// the first letter and then the last. The server checks the word; found words stay circled in the
// finder's colour. In 🏴 Grab everyone shares the grid, so rivals' finds appear (and vanish from the list).
UI.wordsearch = (() => {
  let S, ctx, v, clk = null, busy = false;
  let anchor = null, drag = null, seenOwners = null, seenKey = '';
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';

  function mount(main, side) {
    anchor = drag = seenOwners = null; seenKey = ''; busy = false;
    main.innerHTML = `<div class="wf" id="wfRoot">
      <div class="pt-head"><span id="wfRound"></span><span id="wfInfo" class="pt-info"></span><b id="wfClock" class="pt-clock"></b></div>
      <div class="dd-bar"><span id="wfBar"></span></div>
      <div class="wf-board" id="wfBoard"><div class="wf-grid" id="wfGrid"></div><svg class="wf-ink" id="wfInk" aria-hidden="true"></svg></div>
      <div class="wf-words" id="wfWords" aria-label="Words to find"></div>
      <div class="pt-tools">
        <button type="button" id="wfHint" title="Show where a word starts">💡<small>Hint</small></button>
        <button type="button" id="wfBank" title="Stop here and keep your points">🏳️<small>Done</small></button>
      </div>
      <div class="pt-note" id="wfNote"></div></div>`;
    side.innerHTML = '<div class="panel"><h3>Hunters</h3><div id="wfRacers"></div><p class="hint left" id="wfHelp"></p></div>';
    const b = $('wfBoard');
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointermove', move);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', () => { drag = null; drawSel(); });
    $('wfHint').onclick = async () => {
      if (!live()) return;
      if (await ctx.ask(`Show where one of the words starts? It costs ${v.hintCost} points.`, { ok: '💡 Show me' })) send('hint', {});
    };
    $('wfBank').onclick = async () => {
      if (!live()) return;
      if (await ctx.ask('Call it a day? You keep the words you\'ve found but can\'t find more in this grid.', { ok: '🏳️ Done' })) send('bank', {});
    };
    clk = Kit.clock($('wfBar'), $('wfClock'), { warn: 20, beep: live, sfx: (k) => ctx.sfx(k) });
  }

  function unmount() { clk?.stop(); }

  const live = () => S?.phase === 'playing' && v?.stage === 'play' && v.playing && !v.done && !v.banked && !!ctx.act;

  function send(type, extra) {
    if (!live() || busy) return Promise.resolve(false);
    busy = true;
    return ctx.act(type, extra).then(() => true)
      .catch((err) => {
        ctx.toast(err?.message || 'Not right now.');
        if (type === 'find') { ctx.sfx('wrong'); ctx.buzz?.(30); const g = $('wfBoard'); g.classList.remove('shake'); void g.offsetWidth; g.classList.add('shake'); }
        return false;
      })
      .finally(() => { busy = false; });
  }

  // -- picking a line of letters

  function cellAt(e) {
    const r = $('wfGrid').getBoundingClientRect(), n = v.size;
    const hit = e.target.closest?.('.wf-cell');
    if (hit && (e.type === 'pointerdown' || !r.width)) {   // a press lands on a letter: use it exactly
      const i = [...$('wfGrid').children].indexOf(hit);
      return [Math.floor(i / n) + 0.5, i % n + 0.5];
    }
    if (!r.width) return [0, 0];
    return [Math.min(n - 1, Math.max(0, (e.clientY - r.top) / r.height * n)), Math.min(n - 1, Math.max(0, (e.clientX - r.left) / r.width * n))];
  }

  // from start cell [r, c] toward the pointer: the nearest of the eight directions, as far as the pointer reaches
  function snap(start, fr, fc) {
    const n = v.size, dy = fr - (start[0] + 0.5), dx = fc - (start[1] + 0.5);
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return start;
    const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const sy = Math.round(Math.sin(a)), sx = Math.round(Math.cos(a));
    let k = Math.round(sx && sy ? len / Math.SQRT2 : len);
    while (k > 0) {
      const r = start[0] + sy * k, c = start[1] + sx * k;
      if (r >= 0 && r < n && c >= 0 && c < n) return [r, c];
      k--;
    }
    return start;
  }

  function down(e) {
    if (!live() || e.button > 0) return;
    e.preventDefault();
    const [fr, fc] = cellAt(e), cell = [Math.floor(fr), Math.floor(fc)];
    drag = { start: anchor || cell, end: anchor ? snap(anchor, fr, fc) : cell, moved: false, tapAnchor: !!anchor, id: e.pointerId };
    try { $('wfBoard').setPointerCapture(e.pointerId); } catch {}
    drawSel();
  }

  function move(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const [fr, fc] = cellAt(e);
    const end = snap(drag.start, fr, fc);
    if (end[0] !== drag.end[0] || end[1] !== drag.end[1]) { drag.end = end; drag.moved = true; drawSel(); }
  }

  function up(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { start, end } = drag;
    drag = null;
    const same = start[0] === end[0] && start[1] === end[1];
    if (same) {   // a tap: the first one marks the first letter, a tap on it again lets go
      anchor = anchor ? null : start;
      ctx.sfx('tick');
      return drawSel();
    }
    anchor = null;
    drawSel(start, end);
    send('find', { cells: [start[0], start[1], end[0], end[1]] }).then(() => drawSel());
  }

  // -- drawing

  function capsule(r1, c1, r2, c2, cls, color) {
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', c1 + 0.5); l.setAttribute('y1', r1 + 0.5);
    l.setAttribute('x2', c2 + 0.5); l.setAttribute('y2', r2 + 0.5);
    l.setAttribute('class', cls);
    if (color) l.style.stroke = color;
    return l;
  }

  function drawSel(pinA, pinB) {
    const ink = $('wfInk');
    ink.querySelector('.wf-sel')?.remove();
    for (const el of $('wfGrid').querySelectorAll('.anchor')) el.classList.remove('anchor');
    const a = pinA || drag?.start || anchor, b = pinB || drag?.end || anchor;
    if (!a) return;
    ink.append(capsule(a[0], a[1], b[0], b[1], 'wf-sel', ctx.player(S.me.id)?.color));
    if (anchor && !drag && !pinA) $('wfGrid').children[anchor[0] * v.size + anchor[1]]?.classList.add('anchor');
  }


  function render(s, c) {
    S = s; ctx = c; v = S.wordsearch;
    if (!v) return;
    const n = v.size, key = `${v.round}:${v.grid.join('')}`;
    if (key !== seenKey) { seenKey = key; seenOwners = null; anchor = null; drag = null; }
    // the letters (rebuilt only for a new grid)
    const grid = $('wfGrid');
    if (grid.dataset.key !== key) {
      grid.dataset.key = key;
      grid.innerHTML = '';
      grid.style.setProperty('--n', n);
      $('wfBoard').style.setProperty('--n', n);
      for (const row of v.grid) for (const ch of row) grid.append(ctx.el('span', 'wf-cell', ch));
      $('wfInk').setAttribute('viewBox', `0 0 ${n} ${n}`);
    }
    // what changed since the last view: my finds cheer, a rival's grab blinks
    const prev = seenOwners;
    seenOwners = { ...v.owners };
    const fresh = prev ? Object.keys(v.owners).filter((w) => !(w in prev)) : [];
    for (const w of fresh) {
      if (v.owners[w] === S.me.id) { ctx.sfx(w.length >= 8 ? 'fanfare' : 'good'); }
      else ctx.sfx('pop');
    }
    if (prev && v.done && fresh.some((w) => v.owners[w] === S.me.id)) Kit.callout('🏁 Every word!', 'gold', { ms: 1500 });

    // circled words, then the words nobody found (after the round)
    const ink = $('wfInk');
    ink.innerHTML = '';
    for (const [w, [r1, c1, r2, c2]] of Object.entries(v.lines)) {
      const who = v.owners[w];
      const col = who ? ctx.player(who)?.color || 'var(--accent)' : null;
      ink.append(capsule(r1, c1, r2, c2, 'wf-line' + (who ? '' : ' missed') + (fresh.includes(w) ? ' fresh' : ''), col));
    }
    drawSel();
    for (const el of grid.querySelectorAll('.hint')) el.classList.remove('hint');
    for (const [r, cc] of v.hints) grid.children[r * n + cc]?.classList.add('hint');

    // the word list
    const words = $('wfWords'); words.innerHTML = '';
    for (const w of v.words) {
      const who = v.owners[w];
      const chip = ctx.el('span', 'wf-word' + (who ? ' got' : '') + (who && who !== S.me.id ? ' theirs' : ''), w);
      if (who) chip.style.setProperty('--c', ctx.player(who)?.color || 'var(--accent)');
      words.append(chip);
    }

    const can = live();
    $('wfHint').disabled = $('wfBank').disabled = !can;
    $('wfRoot').classList.toggle('off', !can);
    $('wfRound').textContent = `🔍 ${v.rounds > 1 ? `${v.round}/${v.rounds} · ` : ''}${v.theme}`;
    const got = v.found.length, open = v.words.length - Object.keys(v.owners).length;
    $('wfInfo').textContent = v.grab ? `${open} left · you ${got}` : `${got}/${v.words.length} found`;
    let note = '';
    if (v.gained) note = v.grab ? 'Grey lines are the words nobody found.' : `${v.playing ? `+${v.gained[S.me.id] ?? 0} this grid · ` : ''}grey lines are the words you missed.`;
    else if (v.done) note = '🏁 Every word! Waiting for the others…';
    else if (v.banked) note = '🏳️ You called it a day. Waiting for the others…';
    else if (!v.playing) note = 'Watching.';
    else if (anchor) note = 'Now tap the word\'s last letter.';
    else note = 'Drag across a word, or tap its first and last letters.';
    $('wfNote').textContent = note;
    $('wfHelp').textContent = v.grab
      ? `🏴 Grab: one shared grid, and a word is yours if you circle it first. A point per letter; 💡 costs ${v.hintCost}.`
      : `🏁 Race: everyone has their own copy. A point per letter, +10 for finding them all, +5 for being first; 💡 costs ${v.hintCost}.`;
    racers();
    const timed = S.phase === 'playing' && v.stage === 'play';
    clk.set({ left: v.left, secs: v.secs, on: timed && v.clock !== false, hide: timed && v.clock === false });
  }

  function racers() {
    const box = $('wfRacers'); box.innerHTML = '';
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
    const x = s.wordsearch;
    if (s.phase !== 'playing' || !x) return null;
    return x.stage === 'reveal' ? '🔍 Grid over' : !x.playing ? '🔍 Watching' : x.done ? '🏁 All found — waiting' : x.banked ? '🏳️ Waiting' : '🔍 Hunt!';
  };
  const myMove = (s) => s.phase === 'playing' && s.wordsearch?.stage === 'play' && s.wordsearch.playing && !s.wordsearch.done && !s.wordsearch.banked;

  return { mount, render, unmount, turnText, myMove, ownTimer: () => true };
})();
