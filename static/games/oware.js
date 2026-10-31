// Oware: two rows of six pits drawn from your side (your row at the bottom, sowing runs left to right
// along it and back along the top). Seeds show as dots up to 12, then as a number.
UI.oware = (() => {
  let S, ctx;
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    main.innerHTML = `<div class="ow"><div class="ow-store" id="owTheirs"></div>
      <div class="ow-board"><div class="ow-row" id="owTop"></div><div class="ow-row" id="owBottom"></div></div>
      <div class="ow-store" id="owMine"></div></div>
      <p id="owHint" class="hint"></p>`;
    side.innerHTML = '<div class="panel"><div id="owSeats"></div><p class="hint left">Sowing goes counter-clockwise: along your row to the right, then back along the top.</p></div>';
  }

  function pit(i, n, cls) {
    const b = ctx.el('button', 'ow-pit ' + cls);
    b.dataset.i = i;
    const seeds = ctx.el('span', 'ow-seeds');
    if (n <= 12) for (let k = 0; k < n; k++) seeds.append(ctx.el('i'));
    else seeds.append(ctx.el('b', '', String(n)));
    b.append(seeds, ctx.el('small', '', String(n)));
    return b;
  }

  function render(s, c) {
    S = s; ctx = c;
    const o = S.oware, me = o.me ?? 0, legal = new Set(o.legal);
    // the viewer's row runs left to right along the bottom; the rival's runs right to left on top
    const bottom = me === 0 ? [0, 1, 2, 3, 4, 5] : [6, 7, 8, 9, 10, 11];
    const top = (me === 0 ? [6, 7, 8, 9, 10, 11] : [0, 1, 2, 3, 4, 5]).reverse();
    const [last, caught] = o.last || [-1, []];
    for (const [id, idx, mine] of [['owTop', top, false], ['owBottom', bottom, true]]) {
      const row = $(id); row.innerHTML = '';
      for (const i of idx) {
        const b = pit(i, o.pits[i], (mine ? 'mine' : 'theirs') + (legal.has(i) ? ' can' : '') + (i === last ? ' last' : '') + (caught.includes(i) ? ' caught' : ''));
        b.disabled = !legal.has(i) || !ctx.myTurn;
        b.onclick = () => ctx.quiet(ctx.act('sow', { pit: i }));
        row.append(b);
      }
    }
    const them = 1 - me;
    $('owMine').textContent = String(o.stores[me]);
    $('owTheirs').textContent = String(o.stores[them]);
    $('owMine').title = 'Your captured seeds'; $('owTheirs').title = 'Rival captured seeds';
    const info = $('owSeats'); info.innerHTML = '';
    o.seats.forEach((pid, i) => {
      const p = ctx.player(pid), row = ctx.el('div', 'seat-row');
      const disc = ctx.el('span', 'mini-disc'); disc.style.background = p?.color ?? '#777';
      row.append(disc, ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === o.me ? ' (you)' : ''}`), ctx.el('b', '', `🫘 ${o.stores[i]}`));
      info.append(row);
    });
    $('owHint').textContent = S.phase !== 'playing' ? '' : ctx.myTurn ? 'Tap one of your glowing pits to sow it.' : '';
  }

  return { mount, render };
})();
