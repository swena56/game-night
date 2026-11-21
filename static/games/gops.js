UI.gops = CardTable.screen('gops', {
  decorate(t, refs, ctx) {
    const entries = t.bidHistory || [];
    const panel = refs.hint.parentElement;
    let details = panel.querySelector('.gops-history');
    if (!details) {
      details = ctx.el('details', 'gops-history');
      details.append(ctx.el('summary', '', 'Bid history'), ctx.el('table', 'scores'));
      panel.append(details);
    }
    details.hidden = !entries.length;
    const key = JSON.stringify(entries);
    if (details.dataset.history === key) return;
    details.dataset.history = key;
    const table = details.lastElementChild;
    table.replaceChildren();
    const name = (i) => i === t.me ? 'You' : ctx.player(t.seats[i])?.name ?? '?';
    const ranks = 'A23456789TJQK';
    const cardRank = (c) => c[0] === 'T' ? '10' : c[0];
    const header = ctx.el('tr');
    header.append(ctx.el('th', '', 'Prize'), ...t.seats.map((_, i) => ctx.el('th', '', name(i))), ctx.el('th', '', 'Result'));
    table.append(header);
    entries.forEach((entry, i) => {
      const row = ctx.el('tr');
      const worth = entry.worth ?? entry.prize.reduce((n, c) => n + ranks.indexOf(c[0]) + 1, 0);
      const prize = entry.prize.map(cardRank).join(' + ');
      const result = entry.winner == null
        ? (entry.carry ?? (i < 12) ? 'Tie · carried over' : 'Tie · unclaimed')
        : `${name(entry.winner)}${entry.points == null ? '' : ` +${entry.points}`}`;
      row.append(ctx.el('td', '', `${prize} · ${worth} pts`),
        ...t.seats.map((_, seat) => ctx.el('td', '', entry.bids[seat] ? cardRank(entry.bids[seat]) : '—')),
        ctx.el('td', '', result));
      table.append(row);
    });
  },
});
