// Texas Hold'em: the table (rivals, shared cards, pot), your two cards, and the betting bar.
// The action buttons are built once and only updated, so taps never land on a replaced button.
UI.holdem = (() => {
  let S, ctx, raiseFor = null, histOpen = false, seenBoard = -1, seenHand = 0, seenBets = '', seenDone = null;
  const HANDS = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
  const $ = (id) => document.getElementById(id);
  const num = (n) => Number(n || 0).toLocaleString();

  const face = (card, cls = '') => Cards.face(card, cls);
  const back = (cls = '') => ctx.el('span', `pc back ${cls}`);

  function mount(main, side) {
    raiseFor = null; histOpen = false; seenBoard = -1; seenHand = 0; seenBets = ''; seenDone = null;
    main.innerHTML = `<div class="he">
      <div class="table he-table">
        <div id="heSeats" class="he-seats"></div>
        <div class="he-center">
          <div id="hePot" class="he-pot"></div>
          <div id="heBoard" class="he-board"></div>
          <div id="heResult" class="he-result"></div>
          <div id="heNext" class="he-next" hidden><span class="he-next-bar"><i></i></span>
            <button id="heNextBtn">Next hand ▶</button></div>
        </div>
      </div>
      <div class="he-me"><div id="heMyCards" class="he-cards"></div><div id="heMyInfo" class="he-myinfo"></div>
        <div id="heMeter" class="he-meter" hidden></div></div>
      <button id="heRebuy" class="primary big" hidden></button>
      <button id="heShow" hidden>🙂 Show my cards</button>
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
        <li>Straight</li><li>Three of a kind</li><li>Two pair</li><li>Pair</li><li>High card</li></ol>
      <details id="heHist" class="he-hist" hidden><summary>📜 Hand history</summary><div id="heHistList"></div></details></div>`;
    $('heHist').ontoggle = () => { histOpen = $('heHist').open; };
    const go = (type, extra) => ctx.quiet(ctx.act(type, extra));
    $('heFold').onclick = () => go('fold');
    $('heRebuy').onclick = () => go('rebuy');
    $('heShow').onclick = () => go('show');
    $('heNextBtn').onclick = () => go('next');
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
      const el = ctx.el('div', 'he-seat' + (st.id === S.turn ? ' now' : '') + (st.folded ? ' folded' : '') + (st.out ? ' out' : '')
        + ((h.winners || []).includes(st.id) && h.stage === 'done' ? ' winner' : ''));
      el.dataset.id = st.id;
      const name = ctx.el('b', '', p?.name ?? '?'); name.style.color = p?.color ?? '';
      const badges = [st.button ? 'D' : '', st.sb ? 'SB' : '', st.bb ? 'BB' : ''].filter(Boolean);
      const top = ctx.el('div', 'he-seat-top'); top.append(name);
      for (const t of badges) top.append(ctx.el('span', 'he-badge' + (t === 'D' ? ' d' : ''), t));
      const cards = ctx.el('div', 'he-cards small');
      const shown = h.shown[st.id]?.cards || h.reveal?.[st.id];
      if (shown) for (const card of shown) cards.append(face(card, 'small' + (h.best5?.includes(card) ? ' best' : '')));
      else if (st.inHand && !st.folded && !st.out) cards.append(back('small'), back('small'));
      el.append(top, cards, ctx.el('small', '', st.out ? '💥 out' : `💰${num(st.chips)}${st.allin ? ' · ALL-IN' : ''}`));
      if (h.shown[st.id]) el.append(ctx.el('small', 'he-handname', h.shown[st.id].hand));
      else if (st.bet) { const b = ctx.el('small', 'he-bet'); b.append(Chips.stack(st.bet, { max: 5 })); el.append(b); }
      else if (st.last && h.stage !== 'done') el.append(ctx.el('small', 'he-last', st.last));
      box.append(el);
    }

    // shared cards and pot
    // the flop, turn and river turn over one card at a time
    const board = $('heBoard'); board.innerHTML = '';
    const newHand = h.hand !== seenHand, fromCard = newHand || seenBoard < 0 ? h.board.length : seenBoard;
    for (let i = 0; i < 5; i++) {
      if (!h.board[i]) { board.append(ctx.el('span', 'pc empty')); continue; }
      const f = face(h.board[i], h.best5?.includes(h.board[i]) && h.stage === 'done' ? 'best' : '');
      if (i >= fromCard && motionOK()) { f.classList.add('flip-in'); f.style.animationDelay = (i - fromCard) * 0.18 + 's'; f.style.animationFillMode = 'both'; }
      board.append(f);
    }
    if (h.board.length > fromCard) for (let k = 0; k < h.board.length - fromCard; k++) setTimeout(() => ctx.sfx('flip'), k * 180);
    seenBoard = h.board.length; seenHand = h.hand;
    const pot = $('hePot'); pot.innerHTML = '';
    pot.append(Chips.stack(h.pot, { cls: 'big' }), ctx.el('span', 'he-pot-label', 'Pot'));
    // chips clink when anyone puts more in; at the end of a hand the pot slides to the winner
    const bets = JSON.stringify(h.seats.map((x) => x.bet));
    if (seenBets && bets !== seenBets && h.seats.some((x, i) => x.bet > (JSON.parse(seenBets)[i] || 0))) ctx.sfx('chip');
    seenBets = bets;
    const doneKey = h.stage === 'done' ? `${h.hand}:${(h.winners || []).join()}` : '';
    if (doneKey && seenDone !== doneKey && seenDone !== null && h.winners?.length) {
      const w = h.winners[0], target = w === me ? $('heMyCards') : box.querySelector(`[data-id="${w}"]`);
      setTimeout(() => { Kit.fly(pot.querySelector('.chip-stack'), target, { ms: 600 }); ctx.sfx('chip'); }, 700);
      if (w === me) setTimeout(() => ctx.sfx('good'), 1300);
      // say who won, big, before the next hand (the result line under the board says with what)
      const names = h.winners.map((id) => (id === me ? 'You' : (ctx.player(id)?.name ?? '?').replace(/^🤖\s*/, '')));
      Kit.callout(names.length > 1 ? `${names.join(' & ')} split!` : `${names[0]} ${w === me ? 'win' : 'wins'}!`,
        w === me ? 'gold' : 'cool', { ms: 2200 });
    }
    seenDone = doneKey;
    const done = h.stage === 'done' || S.phase === 'over';
    $('heResult').textContent = done ? h.result : '';
    $('heResult').classList.toggle('done', done && !!h.result);
    // between hands: a bar runs down to the next deal, and people still in can skip ahead
    const between = h.stage === 'done' && S.phase === 'playing' && !h.rebuyWait && S.timeLeft != null;
    const nx = $('heNext'); nx.hidden = !between;
    if (between) {
      const bar = nx.querySelector('i'), barKey = `${h.hand}`;
      if (bar.dataset.k !== barKey) {
        bar.dataset.k = barKey;
        bar.style.animation = 'none'; void bar.offsetWidth;
        bar.style.animation = `heNext ${Math.max(0.5, S.timeLeft)}s linear forwards`;
      }
      const inGame = mine && !mine.out && !ctx.player(me)?.bot && !!ctx.act;
      const asked = (h.ready || []).includes(me);
      const btn = $('heNextBtn');
      btn.hidden = !inGame;
      btn.disabled = asked;
      btn.textContent = asked ? 'Waiting for the others…' : 'Next hand ▶';
    }

    $('heShow').hidden = !h.canShow || !ctx.act;
    paintHistory(h);

    // my hand
    const my = $('heMyCards'); my.innerHTML = '';
    for (const card of h.myCards) my.append(face(card, 'big-card' + (h.best5?.includes(card) && h.stage === 'done' ? ' best' : '')));
    // how strong my hand is right now: nine steps from high card to straight flush
    const meter = $('heMeter'), k = h.myCat;
    meter.hidden = !h.myCards.length || k == null;
    if (!meter.hidden) {
      meter.innerHTML = '';
      for (let i = 0; i < HANDS.length; i++) meter.append(ctx.el('i', i <= k ? 'on' : ''));
      meter.title = `${HANDS[k]} (${k + 1} of ${HANDS.length})`;
      meter.style.setProperty('--lvl', k / 8);
    }
    $('heMyInfo').textContent = !mine ? '👁 Watching' : mine.out ? '💥 Out of chips' : mine.folded && h.stage !== 'done' ? `Folded · 💰${num(mine.chips)}`
      : `💰${num(mine.chips)}${mine.bet ? ` · bet ${num(mine.bet)}` : ''}${h.myHand && !mine.folded ? ` · 🃏 ${h.myHand}` : h.shown[me] ? ` · ${h.shown[me].hand}` : ''}`
        + [mine.button ? ' · 🔘 Dealer' : '', mine.sb ? ' · SB' : '', mine.bb ? ' · BB' : ''].join('')
        + (h.bank != null ? ` · ⏳ ${h.bank} s bank` : '');

    // busted with a buy-back left: offer it (the table waits if it would otherwise end)
    const rebuy = !!h.canRebuy && S.phase === 'playing' && !ctx.player(me)?.bot;
    $('heRebuy').hidden = !rebuy;
    $('heActions').hidden = rebuy;
    if (rebuy) $('heRebuy').textContent = `💸 Buy back in for ${num(S.settings.chips)} (${h.rebuysLeft} left)${h.rebuyWait ? ' — the table is waiting!' : ''}`;

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

  const turnText = (s) => s.phase !== 'playing' ? null
    : s.holdem.rebuyWait ? '💸 Waiting for a buy-back…' : s.holdem.stage === 'done' ? '🃏 Next hand…' : null;
  // the last few hands, newest first: the board, the result, any cards shown, and your own two cards
  function paintHistory(h) {
    const box = $('heHist'), list = $('heHistList');
    box.hidden = !h.history?.length;
    box.open = histOpen;
    list.innerHTML = '';
    for (const e of [...(h.history || [])].reverse()) {
      const item = ctx.el('div', 'he-hand');
      const top = ctx.el('div', 'he-hand-top');
      top.append(ctx.el('b', '', `#${e.n}`));
      for (const card of e.board) top.append(face(card, 'tiny'));
      if (e.mine.length) { top.append(ctx.el('span', 'he-you', 'you:')); for (const card of e.mine) top.append(face(card, 'tiny')); }
      item.append(top, ctx.el('div', 'hint left', e.result));
      for (const [pid, sh] of Object.entries(e.shown)) {
        if (pid === S.me.id) continue;
        const row = ctx.el('div', 'he-hand-top');
        row.append(ctx.el('span', 'he-you', `${ctx.player(pid)?.name ?? '?'}:`));
        for (const card of sh.cards) row.append(face(card, 'tiny'));
        row.append(ctx.el('small', '', sh.hand));
        item.append(row);
      }
      list.append(item);
    }
  }

  return { mount, render, turnText };
})();
