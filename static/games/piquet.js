UI.piquet = CardTable.screen('piquet', {
  decorate(t, refs, ctx) {
    const report = t.declarations;
    const panel = refs.hint.parentElement;
    let details = panel.querySelector('.piquet-declarations');
    if (!details) {
      details = ctx.el('details', 'piquet-declarations');
      details.append(ctx.el('summary', '', 'Declaration comparison'), ctx.el('table', 'scores'));
      panel.append(details);
    }
    details.hidden = !report;
    if (!report) return;
    const key = JSON.stringify(report);
    if (details.dataset.report === key) return;
    details.dataset.report = key;
    const table = details.lastElementChild;
    table.replaceChildren();
    const row = (tag, cells) => {
      const tr = ctx.el('tr');
      tr.append(...cells.map((value) => ctx.el(tag, '', String(value))));
      table.append(tr);
    };
    row('th', ['Deal scoring', ...t.seats.map((pid, i) => i === t.me ? 'You' : ctx.player(pid)?.name ?? '?')]);
    const scored = [0, 0];
    for (const { label, counts, points } of report.rows) {
      row('td', [label, ...counts.map((value, i) => `${value || '—'} · +${points[i]}`)]);
      points.forEach((value, i) => { scored[i] += value; });
    }
    for (const { label, seat, points } of report.bonuses) {
      scored[seat] += points;
      row('td', [label, seat === 0 ? `+${points}` : '—', seat === 1 ? `+${points}` : '—']);
    }
    const tricks = report.totals.map((total, i) => total - scored[i]);
    if (tricks.some(Boolean)) row('td', ['Trick points', ...tricks]);
    row('th', ['Deal total', ...report.totals]);
  },
});
