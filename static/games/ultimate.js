// Ultimate Tic-Tac-Toe: nine small boards; the boards you may play in glow, and won boards show a big mark.
UI.ultimate = (() => {
  let S, ctx, big;
  const MARK = ['✕', '◯'];
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    main.innerHTML = '<div class="ut"><div class="ut-big" id="utBig"></div><p id="utHint" class="hint"></p></div>';
    side.innerHTML = '<div class="panel"><div id="utSeats"></div><p class="hint left">Where you play in a small board sends your rival to that board on the big grid.</p></div>';
    big = $('utBig');
    for (let b = 0; b < 9; b++) {
      const sb = document.createElement('div'); sb.className = 'ut-small';
      for (let k = 0; k < 9; k++) {
        const cell = document.createElement('button'); cell.className = 'ut-cell';
        const idx = b * 9 + k;
        cell.setAttribute('aria-label', `board ${b + 1}, square ${k + 1}`);
        cell.onclick = () => ctx.myTurn && ctx.quiet(ctx.act('mark', { cell: idx }));
        sb.append(cell);
      }
      sb.append(Object.assign(document.createElement('span'), { className: 'ut-won' }));
      big.append(sb);
    }
  }

  function render(s, c) {
    S = s; ctx = c;
    const u = S.ultimate, legal = new Set(u.legal), open = new Set(u.open);
    [...big.children].forEach((sb, b) => {
      const res = u.boards[b];
      sb.classList.toggle('open', open.has(b) && S.phase === 'playing');
      sb.classList.toggle('done', res != null);
      const won = sb.lastElementChild;
      won.textContent = res === 0 || res === 1 ? MARK[res] : '';
      won.className = 'ut-won' + (res === 0 ? ' x' : res === 1 ? ' o' : '');
      [...sb.querySelectorAll('.ut-cell')].forEach((cell, k) => {
        const i = b * 9 + k, v = u.cells[i];
        cell.textContent = v == null ? '' : MARK[v];
        cell.className = 'ut-cell' + (v === 0 ? ' x' : v === 1 ? ' o' : '') + (i === u.last ? ' last' : '') + (legal.has(i) && ctx.myTurn ? ' can' : '');
        cell.disabled = !(legal.has(i) && ctx.myTurn);
      });
    });
    const info = $('utSeats'); info.innerHTML = '';
    u.seats.forEach((pid, i) => {
      const p = ctx.player(pid), row = ctx.el('div', 'seat-row');
      row.append(ctx.el('b', i === 0 ? 'ut-x' : 'ut-o', MARK[i]), ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === u.me ? ' (you)' : ''}`),
        ctx.el('span', 'hint', `${u.boards.filter((v) => v === i).length} boards`));
      info.append(row);
    });
    $('utHint').textContent = S.phase !== 'playing' || !ctx.myTurn ? '' : u.open.length > 1 ? 'Play in any glowing board.' : `Play in board ${u.open[0] + 1}.`;
  }

  return { mount, render };
})();
