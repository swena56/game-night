// Texas Hold'em: the table (rivals, shared cards, pot), your two cards, and the betting bar.
// The action buttons are built once and only updated, so taps never land on a replaced button.
UI.holdem = (() => {
  let S, ctx, raiseFor = null;
  const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const $ = (id) => document.getElementById(id);
  const num = (n) => Number(n || 0).toLocaleString();

  function face(card, cls = '') {
    const f = ctx.el('span', `pc ${'HD'.includes(card[1]) ? 'red' : 'black'} ${cls}`);
    f.append(ctx.el('b', '', card[0] === 'T' ? '10' : card[0]), ctx.el('i', '', SUIT[card[1]] + '︎'));
    return f;
  }
  const back = (cls = '') => ctx.el('span', `pc back ${cls}`);

  function mount(main, side) {
    raiseFor = null;
    main.innerHTML = `<div class="he">
      <div class="table he-table">
        <div id="heSeats" class="he-seats"></div>
        <div class="he-center">
          <div id="hePot" class="he-pot"></div>
          <div id="heBoard" class="he-board"></div>
          <div id="heResult" class="he-result"></div>
        </div>
      </div>
      <div class="he-me"><div id="heMyCards" class="he-cards"></div><div id="heMyInfo" class="he-myinfo"></div></div>
      <div id="heActions" class="he-actions">
        <div class="row he-main">
          <button id="heFold" class="danger">Fold</button>
          <button id="heCall" class="primary"></button>
        </div>
        <div class="he-raise">
          <div class="row he-presets"><button data-p="half">½ pot</button><button data-p="pot">Pot</button><button data-p="all">All-in</button></div>
          <input id="heAmount" type="range" min="0" max="0" step="1">
          <button id="heRaise"></button>
        </div>
      </div></div>`;
    side.innerHTML = `<div class="panel">
      <div id="heStatus" class="seat-row"></div>
      <h3>Hands, best first</h3>
      <ol class="rules he-ranks"><li>Straight flush</li><li>Four of a kind</li><li>Full house</li><li>Flush</li>
        <li>Straight</li><li>Three of a kind</li><li>Two pair</li><li>Pair</li><li>High card</li></ol></div>`;
    const go = (type, extra) => ctx.quiet(ctx.act(type, extra));
    $('heFold').onclick = () => go('fold');
    $('heCall').onclick = () => go(S.holdem.toCall ? 'call' : 'check');
    $('heRaise').onclick = () => {
      const h = S.holdem, to = +$('heAmount').value;
      go(to >= h.maxRaise ? 'allin' : 'raise', { to });
    };
    $('heAmount').oninput = () => labelRaise();
    for (const b of main.querySelectorAll('.he-presets button')) {
      b.onclick = () => {
        const h = S.holdem, pot = h.pot + h.toCall;
        const to = { half: h.curBet + Math.round(pot / 2), pot: h.curBet + pot, all: h.maxRaise }[b.dataset.p];
        $('heAmount').value = String(Math.max(h.minRaise, Math.min(h.maxRaise, to)));
        labelRaise();
      };
    }
  }

  function labelRaise() {
    const h = S.holdem, to = +$('heAmount').value;
    $('heRaise').textContent = to >= h.maxRaise ? `🔥 All-in ${num(h.maxRaise)}` : `${h.curBet ? 'Raise to' : 'Bet'} ${num(to)}`;
  }

  function render(s, c) {
    S = s; ctx = c;
    const h = S.holdem, me = S.me.id;
    const seat = (id) => h.seats.find((x) => x.id === id);
    const mine = seat(me);

    // rivals around the table
    const box = $('heSeats'); box.innerHTML = '';
    for (const st of h.seats) {
      if (st.id === me) continue;
      const p = ctx.player(st.id);
      const el = ctx.el('div', 'he-seat' + (st.id === S.turn ? ' now' : '') + (st.folded ? ' folded' : '') + (st.out ? ' out' : ''));
      const name = ctx.el('b', '', p?.name ?? '?'); name.style.color = p?.color ?? '';
      const badges = [st.button ? 'D' : '', st.sb ? 'SB' : '', st.bb ? 'BB' : ''].filter(Boolean);
      const top = ctx.el('div', 'he-seat-top'); top.append(name);
      for (const t of badges) top.append(ctx.el('span', 'he-badge' + (t === 'D' ? ' d' : ''), t));
      const cards = ctx.el('div', 'he-cards small');
      const shown = h.shown[st.id]?.cards || h.reveal?.[st.id];
      if (shown) for (const card of shown) cards.append(face(card, 'small'));
      else if (st.inHand && !st.folded && !st.out) cards.append(back('small'), back('small'));
      el.append(top, cards, ctx.el('small', '', st.out ? '💥 out' : `💰${num(st.chips)}${st.allin ? ' · ALL-IN' : ''}`));
      if (h.shown[st.id]) el.append(ctx.el('small', 'he-handname', h.shown[st.id].hand));
      else if (st.bet) el.append(ctx.el('small', 'he-bet', `bet ${num(st.bet)}`));
      else if (st.last && h.stage !== 'done') el.append(ctx.el('small', 'he-last', st.last));
      box.append(el);
    }

    // shared cards and pot
    const board = $('heBoard'); board.innerHTML = '';
    for (let i = 0; i < 5; i++) board.append(h.board[i] ? face(h.board[i]) : ctx.el('span', 'pc empty'));
    $('hePot').textContent = `Pot ${num(h.pot)}`;
    $('heResult').textContent = h.stage === 'done' || S.phase === 'over' ? h.result : '';

    // my hand
    const my = $('heMyCards'); my.innerHTML = '';
    for (const card of h.myCards) my.append(face(card, 'big-card'));
    $('heMyInfo').textContent = !mine ? '👁 Watching' : mine.out ? '💥 Out of chips' : mine.folded && h.stage !== 'done' ? `Folded · 💰${num(mine.chips)}`
      : `💰${num(mine.chips)}${mine.bet ? ` · bet ${num(mine.bet)}` : ''}${h.shown[me] ? ` · ${h.shown[me].hand}` : ''}`
        + [mine.button ? ' · 🔘 Dealer' : '', mine.sb ? ' · SB' : '', mine.bb ? ' · BB' : ''].join('');

    // betting bar (only on my turn)
    const acting = ctx.myTurn && S.phase === 'playing' && h.stage !== 'done';
    $('heActions').classList.toggle('off', !acting);
    for (const b of $('heActions').querySelectorAll('button')) b.disabled = !acting;
    $('heAmount').disabled = !acting;
    $('heCall').textContent = h.toCall ? `Call ${num(Math.min(h.toCall, mine?.chips ?? 0))}` : 'Check';
    $('heFold').disabled = !acting || !h.toCall;  // never fold when a check is free
    const canRaise = acting && h.maxRaise > h.curBet && (mine?.chips ?? 0) > h.toCall;
    $('heAmount').min = String(h.minRaise); $('heAmount').max = String(h.maxRaise);
    $('heAmount').step = String(Math.max(1, Math.floor(h.blinds[0] / 2)));
    const key = `${h.hand}:${h.stage}:${h.curBet}:${S.turn}`;
    if (acting && raiseFor !== key) { raiseFor = key; $('heAmount').value = String(h.minRaise); }
    $('heRaise').disabled = $('heAmount').disabled = !canRaise;
    for (const b of document.querySelectorAll('.he-presets button')) b.disabled = !canRaise;
    labelRaise();

    const turnName = ctx.player(S.turn)?.name ?? '';
    $('heStatus').textContent = `Hand ${h.hand} · blinds ${num(h.blinds[0])}/${num(h.blinds[1])} (rise every ${h.pace})`
      + (h.stage === 'done' || !turnName ? '' : ` · ${turnName} to act`);
  }

  const turnText = (s) => s.phase !== 'playing' ? null : s.holdem.stage === 'done' ? '🃏 Next hand…' : null;
  return { mount, render, turnText };
})();
