UI.briscola = CardTable.screen('briscola', {
  decorate(t, refs, ctx) {
    const preview = t.trickPreview;
    if (!preview) return;
    const text = preview.led ? `Led: ${preview.led} · Briscola: ${preview.trump}` : `Choose a lead · Briscola: ${preview.trump}`;
    const options = preview.cards.map(({ card, trump, follows, leads }) => {
      const kind = trump ? 'briscola' : follows ? 'follows suit' : preview.led ? 'off suit' : 'lead';
      return `${card} ${kind}${preview.led ? (leads ? ', takes the lead' : ', falls short') : ''}`;
    });
    refs.note.append(ctx.el('div', 'hint', text), ctx.el('div', 'hint', options.join(' · ')));
  },
});
