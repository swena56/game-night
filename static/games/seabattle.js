UI.seabattle = (() => {
  let S, ctx, layout = [], pick = 0, horizontal = true, sonarMode = false, layoutFor = '', drag = null, dragged = false, N = 0;  // N: the sea's size (10 or 12)
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    layout = []; pick = 0; horizontal = true; sonarMode = false; layoutFor = ''; drag = null; dragged = false; N = 0;
    main.innerHTML = `<div class="seas">
      <div><h3 id="sbEnemyTitle">Enemy waters</h3><div id="sbEnemy" class="sea-grid"></div></div>
      <div><h3 id="sbMineTitle">Your fleet</h3><div id="sbMine" class="sea-grid"></div></div>
    </div>`;
    side.innerHTML = `<div class="panel">
      <div id="sbStatus" class="seat-row"></div>
      <div id="sbPlace">
        <div id="sbShips" class="ship-list"></div>
        <div class="row"><button id="sbRotate">↻ Rotate</button><button id="sbRandom">🎲 Random</button><button id="sbClear">Clear</button></div>
        <button id="sbReady" class="primary big">⚓ Ready</button>
      </div>
      <div id="sbFire">
        <button id="sbSonar" class="big">📡 Use sonar</button>
        <div id="sbFleets" class="hint left"></div>
      </div></div>`;
    dragToPlace($('sbMine'));
    $('sbRotate').onclick = () => { horizontal = !horizontal; ctx.rerender(); };
    $('sbRandom').onclick = () => { layout = randomLayout(); pick = -1; ctx.rerender(); };
    $('sbClear').onclick = () => { layout = []; pick = 0; ctx.rerender(); };
    $('sbReady').onclick = () => ctx.quiet(ctx.act('place', { ships: layout }));
    $('sbSonar').onclick = () => { sonarMode = !sonarMode; ctx.rerender(); if (sonarMode) ctx.toast('Tap the centre of the area to scan.'); };
  }

  function buildGrids(n) {
    N = n;
    for (const id of ['sbEnemy', 'sbMine']) {
      const grid = $(id);
      grid.innerHTML = '';
      grid.style.setProperty('--n', n);
      for (let i = 0; i < n * n; i++) {
        const cell = document.createElement('button');
        cell.className = 'sea-cell';
        cell.onclick = () => (id === 'sbEnemy' ? onEnemy(i) : onMine(i));
        cell.setAttribute('aria-label', `${'ABCDEFGHIJKL'[Math.floor(i / n)]}${i % n + 1}`);
        grid.append(cell);
      }
      gridKeys(grid, n);
    }
  }

  const spec = () => S.sea.fleetSpec;
  const cellsOf = ([r, c, len, h]) => Array.from({ length: len }, (_, k) => (h ? [r, c + k] : [r + k, c]));
  function fits(item, skip) {
    const taken = new Set(layout.filter((x, i) => x && i !== skip).flatMap(cellsOf).map((x) => x.join()));
    return cellsOf(item).every(([r, c]) => r >= 0 && c >= 0 && r < N && c < N && !taken.has(`${r},${c}`));
  }
  function randomLayout() {
    for (;;) {
      layout = [];
      let ok = true;
      for (const [, len] of spec()) {
        let placed = false;
        for (let t = 0; t < 200 && !placed; t++) {
          const h = Math.random() < 0.5;
          const item = [Math.floor(Math.random() * (h ? N : N + 1 - len)), Math.floor(Math.random() * (h ? N + 1 - len : N)), len, h];
          if (fits(item, layout.length)) { layout.push(item); placed = true; }
        }
        if (!placed) { ok = false; break; }
      }
      if (ok) return layout;
    }
  }

  function render(s, c) {
    S = s; ctx = c;
    const sea = S.sea, placing = sea.stage === 'placing';
    if (N !== (sea.n || 10)) buildGrids(sea.n || 10);
    const playing = sea.player === S.me.id;
    const ready = sea.ready[S.me.id];
    if (layoutFor !== S.code + sea.seats.join()) { layoutFor = S.code + sea.seats.join(); layout = []; pick = 0; }
    if (!ctx.myTurn) sonarMode = false;

    $('sbPlace').hidden = !(placing && playing && !ready);
    $('sbMine').classList.toggle('placing', placing && playing && !ready);  // drag ships without scrolling the page
    $('sbFire').hidden = placing;
    $('sbEnemyTitle').parentElement.hidden = placing && playing && !ready;
    $('sbMineTitle').textContent = playing ? 'Your fleet' : `${ctx.player(sea.player)?.name ?? ''}'s fleet`;

    // my board: placement preview, or real fleet with incoming shots
    const mine = $('sbMine').children;
    const shipAt = new Map();
    const myShips = placing && playing && !ready ? layout.map((x, i) => x && { cells: cellsOf(x), idx: i }).filter(Boolean)
      : sea.mine.map((s, i) => ({ cells: s.cells || [], idx: i, sunk: s.sunk }));
    for (const s of myShips) for (const x of s.cells) shipAt.set(x.join(), s);
    const incoming = new Map(sea.theirShots.map(([r, c, v]) => [`${r},${c}`, v]));
    for (let i = 0; i < N * N; i++) {
      const k = `${Math.floor(i / N)},${i % N}`, cell = mine[i], s = shipAt.get(k), hit = incoming.get(k);
      cell.className = 'sea-cell' + (s ? ' ship' : '') + (s && s.sunk ? ' sunk' : '') + (s && placing && s.idx === pick ? ' picked' : '');
      cell.textContent = hit === 'miss' ? '•' : hit ? '🔥' : '';
      cell.disabled = !(placing && playing && !ready);
    }

    // enemy board: my shots, sunk ships, sonar scans
    const enemy = $('sbEnemy').children;
    const shots = new Map(sea.myShots.map(([r, c, v]) => [`${r},${c}`, v]));
    const revealed = new Set(sea.enemy.filter((s) => s.cells).flatMap((s) => s.cells.map((x) => x.join())));
    const scanned = new Map();
    for (const [r, c, n] of sea.scans) for (let y = r - 1; y <= r + 1; y++) for (let x = c - 1; x <= c + 1; x++) scanned.set(`${y},${x}`, n);
    const scanCentre = new Map(sea.scans.map(([r, c, n]) => [`${r},${c}`, n]));
    for (let i = 0; i < N * N; i++) {
      const k = `${Math.floor(i / N)},${i % N}`, cell = enemy[i], v = shots.get(k);
      cell.className = 'sea-cell' + (revealed.has(k) ? ' ship' : '') + (v === 'sunk' ? ' sunk' : '') + (scanned.has(k) ? ' scanned' : '')
        + (sea.last && `${sea.last[0]},${sea.last[1]}` === k ? ' last' : '');
      cell.textContent = v === 'miss' ? '•' : v === 'hit' ? '🔥' : v === 'sunk' ? '✖' : scanCentre.has(k) ? String(scanCentre.get(k)) : '';
      cell.disabled = !ctx.myTurn || (!!v && !sonarMode);
    }

    // side panel
    let status;
    if (placing) status = !playing ? '⚓ Fleets are being placed…' : ready ? '⚓ Ready — waiting for your opponent…'
      : pick >= 0 && pick < spec().length ? `Place your ${spec()[pick][0]} (${spec()[pick][1]}) — ${horizontal ? 'horizontal' : 'vertical'}` : 'Fleet placed — tap Ready (or tap a ship to move it).';
    else status = ctx.myTurn ? `🎯 Fire! ${sea.shotsLeft > 1 ? `${sea.shotsLeft} shots left` : ''}` : S.phase === 'playing' ? 'Incoming…' : 'Battle over';
    $('sbStatus').textContent = status;
    const list = $('sbShips'); list.innerHTML = '';
    spec().forEach(([name, len], i) => {
      const b = ctx.el('button', 'ship-btn' + (i === pick ? ' on' : '') + (layout[i] ? ' done' : ''), `${name} ${'■'.repeat(len)}`);
      b.onclick = () => { pick = i; ctx.rerender(); };
      list.append(b);
    });
    $('sbReady').disabled = layout.filter(Boolean).length !== spec().length;
    $('sbSonar').hidden = !sea.sonar;
    $('sbSonar').disabled = !ctx.myTurn;
    $('sbSonar').classList.toggle('on', sonarMode);
    const fleetLine = (ships) => ships.map((s) => (s.sunk ? '✖ ' : '') + s.name).join(' · ');
    $('sbFleets').innerHTML = '';
    $('sbFleets').append(ctx.el('div', '', `Enemy: ${fleetLine(sea.enemy)}`), ctx.el('div', '', `Yours: ${fleetLine(sea.mine)}`));
  }

  // while placing, a ship can be dragged to a new spot: grab any part of it and it follows your finger,
  // staying put wherever it wouldn't fit. A tap (no drag) still picks it up.
  function dragToPlace(grid) {
    const placing = () => S && S.sea.stage === 'placing' && S.sea.player === S.me.id && !S.sea.ready[S.me.id];
    const cellAt = (e) => {
      const el = document.elementFromPoint?.(e.clientX, e.clientY)?.closest?.('.sea-cell');
      const i = el ? [...grid.children].indexOf(el) : -1;
      return i < 0 ? null : [Math.floor(i / N), i % N];
    };
    grid.addEventListener('pointerdown', (e) => {
      if (!placing()) return;
      const i = [...grid.children].indexOf(e.target.closest('.sea-cell'));
      const r = Math.floor(i / N), c = i % N;
      const idx = layout.findIndex((x) => x && cellsOf(x).some(([y, z]) => y === r && z === c));
      if (idx < 0) return;
      drag = { idx, off: layout[idx][3] ? c - layout[idx][1] : r - layout[idx][0], from: `${r},${c}` };
      try { grid.setPointerCapture(e.pointerId); } catch {}
    });
    grid.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const at = cellAt(e);
      if (!at || at.join() === drag.from) return;
      drag.from = at.join(); dragged = true;
      const [, , len, h] = layout[drag.idx];
      const item = h ? [at[0], at[1] - drag.off, len, h] : [at[0] - drag.off, at[1], len, h];
      if (fits(item, drag.idx)) { layout[drag.idx] = item; ctx.rerender(); }
    });
    const end = () => { drag = null; };
    grid.addEventListener('pointerup', end);
    grid.addEventListener('pointercancel', end);
  }

  function onMine(i) {
    if (dragged) { dragged = false; return; }  // the click that ends a drag
    const r = Math.floor(i / N), c = i % N;
    const at = layout.findIndex((x) => x && cellsOf(x).some(([y, z]) => y === r && z === c));
    if (at >= 0) { layout[at] = null; pick = at; return ctx.rerender(); }  // pick a ship back up
    if (pick < 0 || pick >= spec().length) return;
    const item = [r, c, spec()[pick][1], horizontal];
    if (!fits(item, pick)) return ctx.toast("It doesn't fit there.");
    layout[pick] = item;
    const next = spec().findIndex((_, k) => !layout[k]);
    pick = next;
    ctx.rerender();
  }

  function onEnemy(i) {
    if (!ctx.myTurn) return;
    const r = Math.floor(i / N), c = i % N;
    if (sonarMode) { sonarMode = false; return ctx.quiet(ctx.act('sonar', { r, c })); }
    ctx.quiet(ctx.act('fire', { r, c }));
  }

  return { mount, render };
})();
