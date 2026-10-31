UI.tictactoe = (() => {
  let S, ctx, grid;

  function mount(main, side) {
    main.innerHTML = '<div class="ttt"></div>';
    side.innerHTML = '<div class="panel" id="tttInfo"></div>';
    grid = main.querySelector('.ttt');
    for (let i = 0; i < 9; i++) {
      const b = document.createElement('button');
      b.className = 'ttt-cell';
      b.onclick = () => ctx.quiet(ctx.act('move', { cell: i }));
      grid.append(b);
    }
  }

  function render(s, c) {
    S = s; ctx = c;
    const t = S.ttt;
    [...grid.children].forEach((b, i) => {
      const v = t.cells[i];
      b.textContent = v == null ? '' : t.marks[v];
      b.style.color = v == null ? '' : ctx.player(t.seats[v])?.color ?? '#999';
      b.classList.toggle('mark', v != null);
      b.classList.toggle('fading', t.fading.includes(i));
      b.classList.toggle('win', !!t.line?.includes(i));
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
      info.append(ctx.el('p', 'hint', '👻 Vanishing: you only keep 3 marks. Your faded mark disappears when you place the next one.'));
  }

  return { mount, render };
})();
