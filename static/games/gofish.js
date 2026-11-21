UI.gofish = CardTable.screen('gofish', {
  decorate(t, refs, ctx) {
    const entries = t.memory || [];
    const panel = refs.hint.parentElement;
    let memory = panel.querySelector('.gofish-memory');
    if (!memory) {
      memory = ctx.el('details', 'gofish-memory');
      memory.append(ctx.el('summary', '', 'Your table memory'), ctx.el('ul', 'rules'));
      panel.append(memory);
    }
    memory.hidden = !entries.length;
    const key = JSON.stringify(entries);
    if (memory.dataset.entries === key) return;
    memory.dataset.entries = key;
    const ranks = (cards) => cards.map((rank) => rank === 'T' ? '10' : rank).join(', ');
    memory.lastElementChild.replaceChildren(...entries.map(({ seat, asked, denied }) => {
      const facts = [];
      if (asked.length) facts.push(`asked for ${ranks(asked)}`);
      if (denied.length) facts.push(`said “go fish” for ${ranks(denied)}`);
      return ctx.el('li', '', `${ctx.player(t.seats[seat])?.name ?? '?'} · ${facts.join(' · ')}`);
    }));
  },
});
