UI.blitz = CardTable.screen('blitz', {
  decorate(t, refs, ctx) {
    const forecast = t.knockForecast;
    if (!forecast) return;
    const current = forecast.sameSuit === forecast.current ? `Current: ${forecast.current}`
      : `Current: ${forecast.current} with three of a kind (${forecast.sameSuit} same-suit)`;
    const best = forecast.best == null ? 'No stock draw available' : `Stock draw could reach ${forecast.best} (upper bound)`;
    const knock = forecast.knock ? 'Knocking risks two lives if your hand ties for lowest or loses' : 'A rival has already knocked';
    refs.note.append(ctx.el('div', 'hint', `${current} · ${best} · ${knock}`));
  },
});
