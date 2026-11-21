UI.oldmaid = CardTable.screen('oldmaid', {
  decorate(t, refs, ctx) {
    const entries = t.drawHistory || [];
    const panel = refs.hint.parentElement;
    let history = panel.querySelector('.oldmaid-history');
    if (!history) {
      history = ctx.el('details', 'oldmaid-history');
      history.append(ctx.el('summary', '', 'Draw history'), ctx.el('ol', 'rules'));
      panel.append(history);
    }
    history.hidden = !entries.length;
    const key = JSON.stringify(entries);
    if (history.dataset.entries === key) return;
    history.dataset.entries = key;
    const name = (i) => i === t.me ? 'You' : ctx.player(t.seats[i])?.name ?? '?';
    const rows = [...entries].reverse().map((draw) => {
      const result = draw.maid ? '👵 Old Maid passed'
        : draw.pairs.map((rank) => `🃏 Pair of ${rank === 'T' ? '10' : rank}`).join(' · ');
      return ctx.el('li', '', `${name(draw.from)} → ${name(draw.seat)} · ${result}`);
    });
    history.lastElementChild.replaceChildren(...rows);
  },
});
