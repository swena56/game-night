UI.spite = CardTable.screen('spite', {
  decorate(t, refs, ctx) {
    const hint = t.payoffHint;
    if (!hint) return;
    const destinations = hint.destinations.length
      ? `${hint.top} can go on ${hint.destinations.join(' or ')}`
      : `${hint.top} has no legal destination yet`;
    const reveal = hint.next ? `Next in your pile: ${hint.next}` : 'This is your last pay-off card';
    refs.note.append(ctx.el('div', 'hint', `${destinations} · ${reveal}`));
  },
});
