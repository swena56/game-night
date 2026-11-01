UI.tictactoe = (() => {
  let S, ctx, grid, built = 0, prev = null, last = -1;

  function mount(main, side) {
    built = 0; prev = null; last = -1;
    main.innerHTML = '<div class="ttt"></div>';
    side.innerHTML = '<div class="panel" id="tttInfo"></div>';
    grid = main.querySelector('.ttt');
  }

  function build(n) {  // 3×3 or 4×4
    built = n; grid.innerHTML = '';
    grid.style.setProperty('--n', n);
    grid.classList.toggle('big', n === 4);
    for (let i = 0; i < n * n; i++) {
      const b = document.createElement('button');
      b.className = 'ttt-cell';
      b.onclick = () => ctx.quiet(ctx.act('move', { cell: i }));
      grid.append(b);
    }
    gridKeys(grid, n);
  }

  function render(s, c) {
    S = s; ctx = c;
    const t = S.ttt, n = t.n || 3;
    if (built !== n) { build(n); prev = null; }
    // the newest mark gets an outline (and pops in), so you can see what was just played
    if (prev && prev.length === t.cells.length) {
      const fresh = t.cells.findIndex((v, i) => v != null && prev[i] !== v);
      if (fresh >= 0) last = fresh;
    }
    if (t.cells.every((v) => v == null)) last = -1;
    prev = [...t.cells];
    [...grid.children].forEach((b, i) => {
      const v = t.cells[i];
      b.textContent = v == null ? '' : t.marks[v];
      b.style.color = v == null ? '' : ctx.player(t.seats[v])?.color ?? '#999';
      b.classList.toggle('mark', v != null);
      b.setAttribute('aria-label', `row ${Math.floor(i / n) + 1}, column ${i % n + 1}, ${v == null ? 'empty' : `${ctx.player(t.seats[v])?.name ?? '?'}'s ${t.marks[v]}`}${t.fading.includes(i) ? ', fades next' : ''}`);
      b.classList.toggle('fading', t.fading.includes(i));
      b.classList.toggle('win', !!t.line?.includes(i));
      b.classList.toggle('last', i === last && v != null && !t.line);
      b.disabled = !ctx.myTurn || v != null;
    });
    const info = document.getElementById('tttInfo'); info.innerHTML = '';
    t.seats.forEach((pid, i) => {
      const p = ctx.player(pid);
      const row = ctx.el('div', 'seat-row', `${t.marks[i]}  ${p?.name ?? '—'}${pid === S.me.id ? ' (you)' : ''}`);
      row.style.color = p?.color ?? '';
      info.append(row);
    });
    if (S.settings.variant === 'vanishing')
      info.append(ctx.el('p', 'hint', `👻 Vanishing: you only keep ${n} marks. Your faded mark disappears when you place the next one.`));
    if (n === 4) info.append(ctx.el('p', 'hint', 'Four in a row wins: across, down or corner to corner.'));
  }

  return { mount, render };
})();
