UI.cassino = CardTable.screen('cassino', {
  decorate(t, refs, ctx) {
    const builds = t.builds || [];
    const panel = refs.hint.parentElement;
    let ledger = panel.querySelector('.cassino-builds');
    if (!ledger) {
      ledger = ctx.el('details', 'cassino-builds');
      ledger.open = true;
      ledger.append(ctx.el('summary', '', 'Build ledger'), ctx.el('ul', 'rules'));
      panel.append(ledger);
    }
    ledger.hidden = !builds.length;
    const key = JSON.stringify(builds);
    if (ledger.dataset.builds === key) return;
    ledger.dataset.builds = key;
    ledger.lastElementChild.replaceChildren(...builds.map(({ owner, target, cards }) => {
      const name = owner === t.me ? 'You' : ctx.player(t.seats[owner])?.name ?? '?';
      return ctx.el('li', '', `Target ${target} · ${name} · ${cards}`);
    }));
  },
});
