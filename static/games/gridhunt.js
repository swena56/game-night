// Grid Hunt: trace words by dragging across tiles (or tapping them one by one; tap the last tile again to
// send), or type them on a keyboard. The server checks every word against the grid and the dictionary.
UI.gridhunt = (() => {
  let S, ctx, path = [], typed = '', dragging = false, dragMoved = false, skipClick = false;
  let receivedAt = 0, tickTimer = 0, gridKey = '', note = '';
  const $ = (id) => document.getElementById(id);

  const adjacent = (a, b, n) => a !== b && Math.abs((a / n | 0) - (b / n | 0)) <= 1 && Math.abs((a % n) - (b % n)) <= 1;
  const word = () => typed || path.map((i) => S.gridhunt.tiles[i]).join('');
  const live = () => S?.phase === 'playing' && S.gridhunt.stage === 'hunt' && !S.me.spectator && !!ctx.act;

  function mount(main, side) {
    path = []; typed = ''; gridKey = ''; note = '';
    main.innerHTML = `<div class="gh">
      <div class="gh-head"><span id="ghRound"></span><span id="ghLeft" class="gh-left"></span></div>
      <div class="dd-bar"><span id="ghBar"></span></div>
      <div id="ghGrid" class="gh-grid"></div>
      <div class="gh-entry"><button id="ghClear" title="Clear">✕</button><span id="ghWord" class="gh-word"></span><button id="ghSend" class="primary">Send</button></div>
      <div id="ghNote" class="gh-note"></div>
      <div id="ghMine" class="gh-mine"></div>
      <div id="ghResults" class="gh-results" hidden></div></div>`;
    side.innerHTML = '<div class="panel"><h3>Words found</h3><div id="ghCounts"></div><p class="hint left">Only the count shows until time is up. Words someone else also found score nothing.</p></div>';
    $('ghClear').onclick = () => { clear(); paint(); };
    $('ghSend').onclick = send;
    const grid = $('ghGrid');
    grid.addEventListener('pointerdown', (e) => {
      const i = cellOf(e.target);
      if (i == null || !live()) return;
      dragging = true; dragMoved = false;
      grid.setPointerCapture?.(e.pointerId);
      grid.dataset.start = i;
    });
    grid.addEventListener('pointermove', (e) => {
      if (!dragging || !document.elementFromPoint) return;
      const i = cellOf(document.elementFromPoint(e.clientX, e.clientY));
      if (i == null) return;
      const start = +grid.dataset.start;
      if (!dragMoved) {
        if (i === start) return;
        dragMoved = true; typed = ''; path = [start];
      }
      const n = S.gridhunt.n, last = path[path.length - 1];
      if (path.length > 1 && i === path[path.length - 2]) path.pop();  // slide back to undo a tile
      else if (!path.includes(i) && adjacent(last, i, n)) path.push(i);
      paint();
    });
    const up = () => {
      if (!dragging) return;
      dragging = false;
      if (dragMoved) { skipClick = true; send(); }
    };
    grid.addEventListener('pointerup', up);
    grid.addEventListener('pointercancel', up);
    grid.addEventListener('click', (e) => {
      if (skipClick) { skipClick = false; return; }
      const i = cellOf(e.target);
      if (i != null && live()) tap(i);
    });
    window.addEventListener('keydown', onKey);
    tickTimer = setInterval(tick, 250);
  }

  function unmount() { clearInterval(tickTimer); window.removeEventListener('keydown', onKey); }

  function cellOf(node) {
    const t = node?.closest?.('.gh-tile');
    return t && t.parentElement?.id === 'ghGrid' ? +t.dataset.i : null;
  }

  function clear() { path = []; typed = ''; }

  function tap(i) {
    const n = S.gridhunt.n, last = path[path.length - 1];
    typed = '';
    if (i === last) return send();                      // tap the last tile again to send
    if (path.includes(i)) path = path.slice(0, path.indexOf(i) + 1);   // back up to that tile
    else if (path.length && adjacent(last, i, n)) path.push(i);
    else path = [i];
    paint();
  }

  function onKey(e) {
    if (!S?.gridhunt || !live() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable) return;
    if (/^[a-z]$/i.test(e.key)) { path = []; typed = (typed + e.key.toUpperCase()).slice(0, 25); }
    else if (e.key === 'Backspace') { if (typed) typed = typed.slice(0, -1); else path.pop(); }
    else if (e.key === 'Enter') return send();
    else if (e.key === 'Escape') clear();
    else return;
    e.preventDefault();
    paint();
  }

  function send() {
    const w = word();
    clear(); paint();
    if (!w || !live()) return;
    ctx.act('word', { word: w }).then(() => {
      const got = S.gridhunt.mine.find(([x]) => x === w.toUpperCase());
      note = `✅ ${w.toUpperCase()}${got ? ` +${got[1]}` : ''}`;
      paint();
    }).catch((err) => { note = `❌ ${err?.message || 'Not a word here.'}`; paint(); });
  }

  function tick() {
    if (!S?.gridhunt || !$('ghBar')) return;
    const g = S.gridhunt, left = Math.max(0, g.left - (performance.now() - receivedAt) / 1000);
    const hunting = g.stage === 'hunt' && S.phase === 'playing';
    $('ghBar').style.width = `${hunting ? (left / g.secs) * 100 : 0}%`;
    $('ghBar').parentElement.classList.toggle('last', hunting && left < 10);
    $('ghLeft').textContent = !hunting ? '' : `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
  }

  // the grid highlight and the word being built (local only)
  function paint() {
    if (!S?.gridhunt) return;
    const tiles = $('ghGrid').children;
    for (let i = 0; i < tiles.length; i++) {
      const k = path.indexOf(i);
      tiles[i].classList.toggle('on', k >= 0);
      tiles[i].classList.toggle('head', k >= 0 && k === path.length - 1);
    }
    const w = word();
    $('ghWord').textContent = w || (live() ? 'drag, tap or type' : '');
    $('ghWord').classList.toggle('empty', !w);
    $('ghSend').disabled = !live() || w.length < S.gridhunt.minLen;
    $('ghClear').disabled = !w;
    $('ghNote').textContent = note;
  }

  function render(s, c) {
    S = s; ctx = c; receivedAt = performance.now();
    const g = S.gridhunt;
    const key = `${g.round}:${g.tiles.join('')}`;
    const grid = $('ghGrid');
    if (key !== gridKey) {  // a new grid: rebuild the tiles
      gridKey = key; clear(); note = '';
      grid.innerHTML = '';
      grid.style.gridTemplateColumns = `repeat(${g.n}, 1fr)`;
      grid.classList.toggle('five', g.n === 5);
      grid.classList.toggle('six', g.n === 6);
      g.tiles.forEach((t, i) => {
        const b = ctx.el('button', 'gh-tile' + (i === g.star ? ' star' : ''), t === 'QU' ? 'Qu' : t);
        b.dataset.i = i;
        b.setAttribute('aria-label', `${t}${i === g.star ? ', star tile' : ''}, row ${(i / g.n | 0) + 1}, column ${i % g.n + 1}`);
        grid.append(b);
      });
    }
    for (const b of grid.children) b.disabled = !live();
    $('ghRound').textContent = `🔎 Round ${g.round} of ${g.rounds} · ${g.total} words hidden · ${g.minLen}+ letters` + (g.target ? ` · target ${g.target}` : '');

    const mine = $('ghMine'); mine.innerHTML = '';
    const total = g.mine.reduce((t, [, pts]) => t + pts, 0);
    if (g.stage === 'hunt') {
      mine.append(ctx.el('div', 'hint left', g.mine.length ? `Your words: ${g.mine.length} (up to ${total} pts if nobody else has them)` : 'Your words will appear here.'));
      for (const [w, pts] of g.mine.slice().reverse()) mine.append(ctx.el('span', 'gh-chip', `${w} ${pts}`));
      if (g.lengths?.length) mine.append(ctx.el('div', 'hint left', 'Still to find: ' + g.lengths.map(([n, k]) => `${k}× ${n}${n === 7 ? '+' : ''}-letter`).join(' · ')));
    }

    const counts = $('ghCounts'); counts.innerHTML = '';
    for (const [pid, n] of Object.entries(g.counts)) {
      const p = ctx.player(pid);
      const row = ctx.el('div', 'seat-row');
      const dot = ctx.el('span', 'dot'); dot.style.background = p?.color ?? '#777';
      row.append(dot, ctx.el('span', '', `${p?.name ?? '?'}: ${n} word${n === 1 ? '' : 's'}`));
      counts.append(row);
    }

    const res = $('ghResults');
    res.hidden = !g.results;
    if (g.results) {
      res.innerHTML = '';
      res.append(ctx.el('h3', '', S.phase === 'over' ? `Round ${g.round} results` : `Round ${g.round} results — next grid soon…`));
      const ids = Object.keys(g.results.lists).sort((a, b) => g.results.pts[b] - g.results.pts[a]);
      for (const pid of ids) {
        const p = ctx.player(pid);
        const box = ctx.el('div', 'gh-list');
        const head = ctx.el('b', '', `${p?.name ?? '?'} +${g.results.pts[pid]}`);
        head.style.color = p?.color ?? 'inherit';
        box.append(head);
        for (const [w, pts, shared] of g.results.lists[pid]) {
          const chip = ctx.el('span', 'gh-chip' + (shared ? ' shared' : ''), shared ? w : `${w} ${pts}`);
          if (shared) chip.title = 'Someone else found it too';
          traceable(chip, w);
          box.append(chip);
        }
        if (!g.results.lists[pid].length) box.append(ctx.el('span', 'hint', ' no words'));
        res.append(box);
      }
      if (g.results.missed.length) {
        const box = ctx.el('div', 'gh-list missed');
        box.append(ctx.el('b', '', 'Nobody found'));
        for (const [w, pts] of g.results.missed) { const chip = ctx.el('span', 'gh-chip', `${w} ${pts}`); traceable(chip, w); box.append(chip); }
        res.append(box);
      }
    }
    paint();
    tick();
  }

  // results: tap a word to see it traced across the grid, tile by tile
  function pathOf(word) {
    const g = S.gridhunt, n = g.n, tiles = g.tiles;
    const walk = (i, at, used) => {
      const t = tiles[i];
      if (!word.startsWith(t, at) || used.includes(i)) return null;
      const next = at + t.length, path = [...used, i];
      if (next === word.length) return path;
      for (let j = 0; j < tiles.length; j++) if (adjacent(i, j, n)) { const p = walk(j, next, path); if (p) return p; }
      return null;
    };
    for (let i = 0; i < tiles.length; i++) { const p = walk(i, 0, []); if (p) return p; }
    return null;
  }
  let traceTimer = 0;
  function traceable(chip, word) {
    chip.classList.add('traceable');
    chip.setAttribute('role', 'button'); chip.tabIndex = 0;
    const go = () => {
      const path = pathOf(word.toUpperCase()), tiles = [...$('ghGrid').children];
      if (!path) return;
      tiles.forEach((t) => { t.classList.remove('trace'); t.style.removeProperty('--t'); });
      void $('ghGrid').offsetWidth;
      path.forEach((i, k) => { tiles[i].style.setProperty('--t', `${k * 0.18}s`); tiles[i].classList.add('trace'); });
      clearTimeout(traceTimer);
      traceTimer = setTimeout(() => tiles.forEach((t) => t.classList.remove('trace')), path.length * 180 + 1600);
      $('ghGrid').scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    };
    chip.onclick = go;
    chip.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  }

  const turnText = (s) => s.phase !== 'playing' ? null
    : s.gridhunt.stage === 'reveal' ? '⏱️ Time! Comparing lists…' : s.me.spectator ? '🔎 Watching the hunt' : '🔎 Find words!';
  const myMove = (s) => s.phase === 'playing' && s.gridhunt.stage === 'hunt' && !s.me.spectator;

  return { mount, render, unmount, turnText, myMove };
})();
