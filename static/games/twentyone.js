// Twenty-One: the dealer's cards on top, every seat's cards and bet below, and a bar with the bet
// chips (while betting) or Hit / Stand / Double / Split (on your turn). A split seat shows one row per hand.
UI.twentyone = (() => {
  let S, ctx;
  const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const $ = (id) => document.getElementById(id);

  function face(card, cls = '') {
    if (card === '??') return ctx.el('span', `pc back ${cls}`);
    const f = ctx.el('span', `pc ${'HD'.includes(card[1]) ? 'red' : 'black'} ${cls}`);
    f.append(ctx.el('b', '', card[0] === 'T' ? '10' : card[0]), ctx.el('i', '', SUIT[card[1]] + '︎'));
    return f;
  }

  function mount(main, side) {
    main.innerHTML = `<div class="to">
      <div class="to-dealer"><div class="hint">🎩 Dealer <b id="toDealerTotal"></b></div><div id="toDealer" class="to-cards"></div></div>
      <div id="toBar" class="row to-bar"></div>
      <p id="toNote" class="hint"></p>
      <div id="toSeats" class="to-seats"></div></div>`;  // the buttons sit above the seats, which grow with every card (#18)
    side.innerHTML = '<div class="panel"><h3>Chips</h3><div id="toChips"></div><p class="hint left">Dealer draws to 17. A two-card 21 pays 3 to 2.</p></div>';
  }

  function render(s, c) {
    S = s; ctx = c;
    const t = S.twentyone, me = t.me;
    const dl = $('toDealer'); dl.innerHTML = '';
    t.dealer.forEach((card, k) => dl.append(face(card, k ? 'deal' : '')));
    $('toDealerTotal').textContent = t.dealer.length ? String(t.dealerTotal) + (t.dealer.includes('??') ? '+?' : '') : '';

    const seats = $('toSeats'); seats.innerHTML = '';
    t.seats.forEach((pid, i) => {
      const p = ctx.player(pid);
      const box = ctx.el('div', 'to-seat' + (S.turn === pid ? ' turn' : '') + (i === me ? ' me' : ''));
      const head = ctx.el('div', 'to-head');
      const nm = ctx.el('b', '', `${p?.name ?? 'left'}${i === me ? ' (you)' : ''}`); nm.style.color = p?.color ?? 'inherit';
      head.append(nm, ctx.el('span', 'hint', t.bets[i] ? `bet ${t.bets[i]}` : t.stage === 'bet' && t.chips[i] > 0 ? 'betting…' : ''));
      box.append(head);
      const hs = t.seatHands[i], split = hs.length > 1;
      hs.forEach((h, k) => {
        const wrap = ctx.el('div', 'to-hand' + (split && S.turn === pid && t.stage === 'play' && t.cur[i] === k ? ' cur' : ''));
        const cards = ctx.el('div', 'to-cards');
        h.cards.forEach((card) => cards.append(face(card, 'small')));
        const foot = ctx.el('div', 'to-foot');
        foot.append(ctx.el('b', h.total > 21 ? 'bust' : '', String(h.total)));
        if (split) foot.append(ctx.el('span', 'hint', `💰 ${h.bet}`));
        if (h.res) foot.append(ctx.el('span', 'to-res ' + (h.res[1] > 0 ? 'win' : h.res[1] < 0 ? 'lose' : ''), `${h.res[0]} ${h.res[1] > 0 ? '+' : ''}${h.res[1]}`));
        wrap.append(cards, foot);
        box.append(wrap);
      });
      if (split && t.result[i]) {
        const [, d] = t.result[i], tot = ctx.el('div', 'to-foot');
        tot.append(ctx.el('span', 'hint', 'total'), ctx.el('span', 'to-res ' + (d > 0 ? 'win' : d < 0 ? 'lose' : ''), `${d > 0 ? '+' : ''}${d}`));
        box.append(tot);
      }
      seats.append(box);
    });

    const bar = $('toBar'); bar.innerHTML = '';
    const playing = S.phase === 'playing' && me != null;
    let note = '';
    if (playing && t.stage === 'bet' && !t.bets[me] && t.chips[me] > 0) {
      for (const amt of t.betOptions) {
        const b = ctx.el('button', 'to-chip', `💰 ${amt}`);
        b.disabled = !ctx.act;
        b.onclick = () => ctx.quiet(ctx.act('bet', { amount: amt }));
        bar.append(b);
      }
      note = 'Place your bet.';
    } else if (playing && t.stage === 'play' && ctx.myTurn) {
      for (const [type, label, cls] of [['hit', '➕ Hit', 'primary'], ['stand', '✋ Stand', ''], ['double', '💰 Double', ''], ['split', '✂️ Split', '']]) {
        if (type === 'split' && !t.canSplit) continue;  // only offered on a pair
        const b = ctx.el('button', cls, label);
        if (type === 'double') b.disabled = !t.canDouble;
        b.onclick = () => ctx.quiet(ctx.act(type));
        bar.append(b);
      }
      const hs = t.seatHands[me];
      note = hs.length > 1 ? `Hand ${t.cur[me] + 1} of ${hs.length}: you have ${hs[t.cur[me]].total}.` : `You have ${hs[0].total}.`;
    } else if (playing && t.stage === 'bet') note = t.chips[me] > 0 ? 'Waiting for the other bets…' : 'Out of chips — watching.';
    else if (t.stage === 'dealer') note = 'The dealer plays…';
    $('toNote').textContent = note;

    const ch = $('toChips'); ch.innerHTML = '';
    t.seats.map((pid, i) => [i, t.chips[i]]).sort((a, b) => b[1] - a[1]).forEach(([i, v]) => {
      const row = ctx.el('div', 'seat-row');
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = ctx.player(t.seats[i])?.color ?? '#777';
      row.append(dot, ctx.el('span', 'grow', ctx.player(t.seats[i])?.name ?? 'left'), ctx.el('b', '', `💰 ${v}`));
      ch.append(row);
    });
    ch.append(ctx.el('div', 'hint left', `Hand ${t.hand} of ${t.hands}`));
  }

  const turnText = (s) => (s.phase === 'playing' && s.twentyone.stage === 'bet' ? (s.twentyone.me != null && !s.twentyone.bets[s.twentyone.me] && s.twentyone.chips[s.twentyone.me] > 0 ? '💰 Place your bet' : '💰 Bets going in…') : null);
  const myMove = (s) => s.phase === 'playing' && s.twentyone.stage === 'bet' && s.twentyone.me != null && !s.twentyone.bets[s.twentyone.me] && s.twentyone.chips[s.twentyone.me] > 0;

  return { mount, render, turnText, myMove };
})();
