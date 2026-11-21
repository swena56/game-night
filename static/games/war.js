UI.war = CardTable.screen('war', {
  decorate(t, refs, ctx) {
    const entries = t.battleHistory || [];
    const panel = refs.hint.parentElement;
    let details = panel.querySelector('.war-history');
    if (!details) {
      details = ctx.el('details', 'war-history');
      details.append(ctx.el('summary', '', 'Recent battles'), ctx.el('ol', 'rules'));
      panel.append(details);
    }
    details.hidden = !entries.length;
    const key = JSON.stringify(entries);
    if (details.dataset.history === key) return;
    details.dataset.history = key;
    const name = (seat) => Number(seat) === t.me ? 'You' : ctx.player(t.seats[seat])?.name ?? '?';
    const suit = { C: '♣', D: '♦', H: '♥', S: '♠' };
    const card = (c) => (c[0] === 'T' ? '10' : c[0]) + suit[c[1]];
    const items = [...entries].reverse().map((entry) => {
      const line = ctx.el('li');
      line.append(ctx.el('b', '', `Battle ${entry.battle} · ${name(entry.winner)} won ${entry.won.length}`));
      entry.rounds.forEach(({ up, down }, i) => {
        const plays = Object.entries(up).map(([seat, c]) => {
          const hidden = down[seat]?.map(card).join(' ');
          return `${name(seat)}: ${hidden ? hidden + ' down, ' : ''}${card(c)} up`;
        });
        line.append(ctx.el('div', '', `${i ? `War ${i}` : 'Flip'} · ${plays.join(' · ')}`));
      });
      const endedOnTie = entry.ties >= entry.rounds.length;
      if (endedOnTie) line.append(ctx.el('div', '', 'No further war flip available.'));
      line.append(ctx.el('small', '', `Won: ${entry.won.map(card).join(' ')}${entry.extra ? ` · includes ${entry.extra} from gambles` : ''}`));
      return line;
    });
    details.lastElementChild.replaceChildren(...items);
  },
});
