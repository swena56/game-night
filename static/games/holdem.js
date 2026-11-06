// Texas Hold'em: the table (rivals, shared cards, pot), your two cards, and the betting bar.
// The action buttons are built once and only updated, so taps never land on a replaced button.
UI.holdem = (() => {
  let revealAt = 0;  // when an all-in run-out's last card has turned over
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
      <div class="he-me"><div id="heMyCards" class="he-cards"></div><div class="he-mycol"><div id="heMyInfo" class="he-myinfo"></div>
        <div id="heMeter" class="he-meter" hidden></div><div id="heOdds" class="he-odds" hidden></div></div></div>
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

  // a seat's nameplate: avatar, name (cut short with … if long), stack, blinds, and the dealer button
  function plate(p, st) {
    const pl = ctx.el('div', 'he-plate');
    if (p && typeof avatar === 'function') pl.append(avatar(p));
    const id = ctx.el('div', 'he-id');
    const name = ctx.el('b', 'he-name', p?.name ?? '?'); name.style.color = p?.color ?? ''; name.title = p?.name ?? '';
    const row = ctx.el('div', 'he-sub');
    row.append(ctx.el('span', 'he-stack', st.out ? '💥 out' : num(st.chips)));
    if (st.sb) row.append(ctx.el('span', 'he-blind', 'SB'));
    if (st.bb) row.append(ctx.el('span', 'he-blind bb', 'BB'));
    id.append(name, row); pl.append(id);
    if (st.button) { const d = ctx.el('span', 'he-dealer', 'D'); d.title = 'Dealer'; pl.append(d); }
    return pl;
  }
  // under the nameplate: the hand they showed, or their latest action and the chips they've bet this round
  function seatFoot(st, now, h, nowWord = 'Thinking…') {
    const f = ctx.el('div', 'he-foot');
    if (h.shown[st.id]) { f.append(ctx.el('span', 'he-handname', h.shown[st.id].hand)); return f; }
    if (st.out) return f;
    const word = now ? nowWord : st.allin ? 'All-in' : st.folded ? 'Folded' : h.stage !== 'done' ? actWord(st.last) : '';
    if (word) f.append(ctx.el('span', 'he-act ' + (now ? 'now' : st.allin ? 'allin' : st.folded ? 'fold' : word.toLowerCase()), word));
    // a turn timer: the acting player's time drains away under their name (#76)
    if (now && S.timeLeft != null && S.settings?.timer && h.stage !== 'done') {
      const left = Math.max(0, S.timeLeft - (performance.now() - stateAt) / 1000), full = Math.max(left, S.settings.timer);
      const clock = ctx.el('span', 'he-clock'), bar = ctx.el('i');
      bar.style.width = `${(100 * left) / full}%`;
      if (motionOK()) bar.animate([{ width: `${(100 * left) / full}%` }, { width: '0%' }], { duration: left * 1000, fill: 'forwards' });
      clock.title = `${Math.ceil(left)} s left`;
      clock.append(bar); f.append(clock);
    }
    if (st.bet) f.append(Chips.stack(st.bet, { max: 6, cls: 'he-chips he-bet' }));
    return f;
  }
  const actWord = (last = '') => ({ folds: 'Folded', checks: 'Check', calls: 'Call', bets: 'Bet', raises: 'Raise' })[last.split(' ')[0]] || '';
  // the pot as a row of columns, one per chip colour, the way a dealer stacks it
  const DENOMS = [1000, 500, 100, 25, 5, 1];
  function potChips(amount) {
    const row = ctx.el('span', 'he-potchips');
    let left = Math.max(0, Math.round(amount)), cols = 0;
    for (const v of DENOMS) {
      const n = Math.floor(left / v);
      if (!n) continue;
      left -= n * v;
      row.append(Chips.stack(n * v, { label: false, max: 8, cls: 'he-chips' }));
      if (++cols >= 5) break;
    }
    return row;
  }

  function render(s, c) {
    S = s; ctx = c;
    const h = S.holdem, me = S.me.id;
    const seat = (id) => h.seats.find((x) => x.id === id);
    const mine = seat(me);

    // rivals around the table: hole cards over a nameplate (avatar, name, stack, dealer/blind buttons),
    // then a footer with what they last did and the chips they have out this round
    const box = $('heSeats'); box.innerHTML = '';
    for (const st of h.seats) {
      if (st.id === me) continue;
      const p = ctx.player(st.id), now = st.id === S.turn && h.stage !== 'done';
      const el = ctx.el('div', 'he-seat' + (now ? ' now' : '') + (st.folded ? ' folded' : '') + (st.out ? ' out' : '')
        + ((h.winners || []).includes(st.id) && h.stage === 'done' ? ' winner' : ''));
      el.dataset.id = st.id;
      const cards = ctx.el('div', 'he-cards small');
      const shown = h.shown[st.id]?.cards || h.reveal?.[st.id];
      if (shown) for (const card of shown) cards.append(face(card, 'small' + (h.best5?.includes(card) ? ' best' : '')));
      else if (st.inHand && !st.out) for (let i = 0; i < 2; i++) cards.append(back('small' + (st.folded ? ' mucked' : '')));
      else for (let i = 0; i < 2; i++) cards.append(ctx.el('span', 'pc small empty'));
      el.append(cards, plate(p, st), seatFoot(st, now, h));
      box.append(el);
    }

    // shared cards and pot
    // the flop, turn and river turn over one card at a time
    const board = $('heBoard'); board.innerHTML = '';
    const newHand = h.hand !== seenHand, fromCard = newHand || seenBoard < 0 ? h.board.length : seenBoard;
    // 🔥 an all-in run-out: the hands are face up and the rest of the board comes out slowly, with a heartbeat
    const runout = h.runout != null && h.stage === 'done' && h.board.length > fromCard && !newHand && motionOK();
    // cards dealt before the all-in (the flop, if everyone went all in on it) still come out quickly
    const slowFrom = runout ? Math.max(h.runout, fromCard) : 5, quick = Math.max(0, slowFrom - fromCard) * 0.18;
    const delay = (i) => (i < slowFrom ? (i - fromCard) * 0.18 : quick + 0.6 + (i - slowFrom) * 1.1);
    if (runout) { Kit.callout('🔥 ALL IN', 'gold', { ms: 1100 }); ctx.buzz?.([40, 80, 40]); }
    for (let i = 0; i < 5; i++) {
      if (!h.board[i]) { board.append(ctx.el('span', 'pc empty')); continue; }
      const f = face(h.board[i], h.best5?.includes(h.board[i]) && h.stage === 'done' ? 'best' : '');
      if (i >= fromCard && motionOK()) { f.classList.add('flip-in'); f.style.animationDelay = delay(i) + 's'; f.style.animationFillMode = 'both'; }
      board.append(f);
    }
    for (let i = fromCard; i < h.board.length; i++) {
      setTimeout(() => ctx.sfx('flip'), delay(i) * 1000);
      if (i >= slowFrom) setTimeout(() => ctx.sfx('thud'), delay(i) * 1000 - 350);  // ba-dum before each slow card
    }
    if (newHand) revealAt = 0;
    else if (h.board.length > fromCard) revealAt = performance.now() + (runout ? (delay(h.board.length - 1) + 0.5) * 1000 : 0);
    seenBoard = h.board.length; seenHand = h.hand;
    const pot = $('hePot'); pot.innerHTML = '';
    const amt = ctx.el('span', 'he-pot-amt'); amt.append(ctx.el('small', '', 'Pot'), ctx.el('b', '', num(h.pot)));
    pot.append(potChips(h.pot), amt);
    // chips clink when anyone puts more in; at the end of a hand the pot slides to the winner
    const bets = JSON.stringify(h.seats.map((x) => x.bet));
    if (seenBets && bets !== seenBets && h.seats.some((x, i) => x.bet > (JSON.parse(seenBets)[i] || 0))) ctx.sfx('chip');
    seenBets = bets;
    const doneKey = h.stage === 'done' ? `${h.hand}:${(h.winners || []).join()}` : '';
    if (doneKey && seenDone !== doneKey && seenDone !== null && h.winners?.length) {
      const w = h.winners[0], target = w === me ? $('heMyCards') : box.querySelector(`[data-id="${w}"]`);
      const later = Math.max(0, revealAt - performance.now());  // after a run-out has finished dealing
      setTimeout(() => { Kit.fly(pot.querySelector('.he-potchips'), target, { ms: 600 }); ctx.sfx('chip'); }, 700 + later);
      if (w === me) setTimeout(() => ctx.sfx('good'), 1300 + later);
      // say who won, big, before the next hand (the result line under the board says with what)
      const names = h.winners.map((id) => (id === me ? 'You' : (ctx.player(id)?.name ?? '?').replace(/^🤖\s*/, '')));
      Kit.callout(names.length > 1 ? `${names.join(' & ')} split!` : `${names[0]} ${w === me ? 'win' : 'wins'}!`,
        w === me ? 'gold' : 'cool', { ms: 2200 });
    }
    seenDone = doneKey;
    const done = h.stage === 'done' || S.phase === 'over';
    // after an all-in, who won waits until the last card is out (hand names too, via .he-suspense)
    const hold = Math.max(0, revealAt - performance.now());
    const res = $('heResult');
    clearTimeout(res._t);
    const show = () => { res.textContent = done ? h.result : ''; res.classList.toggle('done', done && !!h.result); document.querySelector('.he')?.classList.remove('he-suspense'); };
    if (hold && done) { res.textContent = '🔥 All in…'; res.classList.remove('done'); document.querySelector('.he')?.classList.add('he-suspense'); res._t = setTimeout(show, hold); }
    else show();
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
      // ready for the keyboard: Enter or Space deals on (#77), once per hand so it doesn't steal focus later
      if (inGame && !asked && btn.dataset.focused !== barKey) { btn.dataset.focused = barKey; btn.focus({ preventScroll: true }); }
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
    // 📊 option: my rough chance to win from here, as a bar, counting up or down when a street changes it
    const odds = $('heOdds'), pct = h.myOdds;
    odds.hidden = pct == null;
    if (pct != null) {
      if (!odds.firstChild) odds.append(ctx.el('span', 'he-odds-bar', ''), ctx.el('b', '', ''), ctx.el('small', '', ''));
      const [bar, num, word] = odds.children, was = +odds.dataset.v;
      bar.style.setProperty('--p', pct / 100);
      bar.style.setProperty('--h', Math.round(pct * 1.2));
      if (was !== pct) Kit.tally(num, Number.isFinite(was) && odds.dataset.v !== '' ? was : pct, pct, 500);
      num.dataset.unit = '%';
      const fair = 100 / (1 + h.seats.filter((x) => x.inHand && !x.folded && x.id !== me).length);
      word.textContent = pct >= fair * 1.5 ? 'favourite' : pct <= fair * 0.6 ? 'underdog' : 'to win';
      odds.dataset.v = pct;
      odds.title = 'Your share of the pot if everyone still in plays it out, from your cards and the board';
    } else odds.dataset.v = '';
    // my own nameplate: stack and buttons, then my hand's name, my bet as chips, and my time bank
    const info = $('heMyInfo'); info.innerHTML = '';
    info.classList.toggle('folded', !!mine?.folded && h.stage !== 'done');
    if (!mine || mine.out) info.append(ctx.el('span', 'he-act', !mine ? '👁 Watching' : '💥 Out of chips'));
    else {
      const meNow = S.turn === me && h.stage !== 'done';
      info.append(plate(ctx.player(me), mine));
      const foot = seatFoot(mine, meNow, { ...h, shown: {} }, 'Your turn');
      const hand = mine.folded && h.stage !== 'done' ? '' : h.shown[me]?.hand || h.myHand;
      if (hand) foot.prepend(ctx.el('span', 'he-handname', `🃏 ${hand}`));
      if (h.bank != null) foot.append(ctx.el('span', 'he-bank', `⏳ ${h.bank} s bank`));
      else if (meNow && !S.settings?.timer) foot.append(ctx.el('span', 'he-bank', '⏳ No turn timer: take your time'));
      info.append(foot);
    }

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
