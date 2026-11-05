// Twenty-One: the dealer's cards on top, every seat's cards and bet below, and a bar with the bet
// chips (while betting) or Hit / Stand / Double / Split (on your turn). A split seat shows one row per hand.
UI.twentyone = (() => {
  let S, ctx;
  const $ = (id) => document.getElementById(id);

  const face = (card, cls = '') => Cards.face(card, cls);

  function mount(main, side) {
    main.innerHTML = `<div class="to">
      <div class="to-dealer"><div class="to-shoe" id="toShoe" aria-hidden="true"><i></i><i></i><i></i></div>
        <div class="hint">🎩 Dealer <b id="toDealerTotal"></b></div><div id="toDealer" class="to-cards"></div>
        <svg class="to-arc" viewBox="0 0 300 44" aria-hidden="true"><path id="toArcPath" d="M18 6 Q150 52 282 6" fill="none"/>
          <text><textPath href="#toArcPath" startOffset="50%" text-anchor="middle" id="toArcText">PAYS 3 TO 2 · DEALER STANDS ON 17</textPath></text></svg></div>
      <div id="toBar" class="row to-bar"></div>
      <p id="toNote" class="hint"></p>
      <div id="toSeats" class="to-seats"></div></div>`;  // the buttons sit above the seats, which grow with every card (#18)
    side.innerHTML = '<div class="panel"><h3>Chips</h3><div id="toChips"></div><p class="hint left">Dealer draws to 17. A two-card 21 pays 3 to 2.</p></div>';
  }

  // The bet builder (#5): tap chips to stack a bet, then Deal. The stake lives here until it's sent.
  let stake = 0, pairOn = false, stakeHand = null, seen = new Map(), seenHand = null, holeHidden = false, called = new Set();
  function betBar(bar, t, me) {
    const chips = t.chips[me], last = Math.min(t.lastBets?.[me] || 0, chips), min = t.minBet || 5;
    const draw = () => {
      bar.innerHTML = '';
      const pile = ctx.el('div', 'to-chips');
      for (const amt of t.betOptions) {
        const b = ctx.el('button', `to-chip c${amt}`, String(amt));
        b.title = `Add ${amt}`;
        b.disabled = !ctx.act || stake + amt > chips;
        b.onclick = () => { stake += amt; ctx.sfx('chip'); draw(); };
        pile.append(b);
      }
      const row = ctx.el('div', 'to-betrow');
      const clear = ctx.el('button', '', '✖ Clear');
      clear.disabled = !stake;
      clear.onclick = () => { stake = 0; draw(); };
      const all = ctx.el('button', '', `All in ${chips}`);
      all.onclick = () => { stake = chips; draw(); };
      row.append(clear, all);
      if (last) {
        const again = ctx.el('button', '', `↺ ${last}`);
        again.title = 'Bet the same as last hand';
        again.onclick = () => ctx.quiet(ctx.act('bet', { amount: last, pair: !!(t.pairs && t.lastPairs?.[me] && last + t.pairBet <= chips) }));
        row.append(again);
      }
      // 👯 the Perfect Pairs side bet (a room option): a toggle that rides on top of the main bet
      const pairOk = t.pairs && stake + t.pairBet <= chips;
      if (t.pairs) {
        const pb = ctx.el('button', 'to-pairbtn' + (pairOn && pairOk ? ' on' : ''), `👯 Pair +${t.pairBet}`);
        pb.title = `A ${t.pairBet}-chip side bet on your first two cards being a pair: ${t.pairPays.mixed}:1 mixed, ${t.pairPays.coloured}:1 same colour, ${t.pairPays.perfect}:1 same suit`;
        pb.setAttribute('aria-pressed', String(pairOn && pairOk));
        pb.disabled = !pairOk;
        pb.onclick = () => { pairOn = !pairOn; ctx.sfx('chip'); draw(); };
        row.append(pb);
      }
      const deal = ctx.el('button', 'primary to-deal', stake ? `Deal · bet ${stake}${pairOn && pairOk ? ` + ${t.pairBet}` : ''}` : 'Deal');
      deal.disabled = !ctx.act || !(stake === chips || stake >= min);
      deal.onclick = () => ctx.quiet(ctx.act('bet', { amount: stake, pair: !!(pairOn && pairOk) }));
      row.append(deal);
      const stack = ctx.el('div', 'hint to-stake', stake ? `Your bet: ${stake} of ${chips}` : `Tap chips to build a bet (you have ${chips}).`);
      if (stake) stack.prepend(Chips.stack(stake, { label: false, max: 10 }));
      bar.append(pile, stack, row);
    };
    draw();
  }

  function render(s, c) {
    S = s; ctx = c;
    const t = S.twentyone, me = t.me;
    // #31: a card dealt since the last render flies in from the shoe, once, one after another
    if (seenHand !== t.hand) { seenHand = t.hand; seen = new Map(); }
    let flying = 0;
    const dealt = (key, cards) => {
      const was = seen.get(key) ?? 0;
      seen.set(key, cards.length);
      return (el, k) => {
        if (k >= was) { el.dataset.fresh = ''; el.style.setProperty('--deal', `${(flying++ * 0.11).toFixed(2)}s`); }
        return el;
      };
    };
    // once the new cards are in place, aim each one's deal animation from the shoe
    const fromShoe = () => {
      const shoe = $('toShoe')?.getBoundingClientRect();
      document.querySelectorAll('.to [data-fresh]').forEach((c) => {
        delete c.dataset.fresh;
        if (shoe?.width) {
          const r = c.getBoundingClientRect();
          c.style.setProperty('--fx', `${shoe.left + shoe.width / 2 - (r.left + r.width / 2)}px`);
          c.style.setProperty('--fy', `${shoe.top + shoe.height / 2 - (r.top + r.height / 2)}px`);
        }
        c.classList.add('dealt');
        if (motionOK()) setTimeout(() => ctx.sfx('deal'), parseFloat(c.style.getPropertyValue('--deal')) * 1000 || 0);
      });
    };
    const dl = $('toDealer'); dl.innerHTML = '';
    const dd = dealt('d', t.dealer);
    // the dealer's hole card turns over in place when the dealer plays
    const flipHole = holeHidden && !t.dealer.includes('??') && t.dealer.length >= 2;
    holeHidden = t.dealer.includes('??');
    t.dealer.forEach((card, k) => {
      const f = dd(face(card), k);
      if (flipHole && k === 1 && motionOK()) { delete f.dataset.fresh; f.classList.add('flip-in'); }
      dl.append(f);
    });
    if (flipHole) ctx.sfx('flip');
    if (seenHand === t.hand && t.dealer.length && !t.dealer.includes('??') && t.dealerTotal > 21 && !called.has('d' + t.hand)) {
      called.add('d' + t.hand); Kit.callout('Dealer busts!', 'good', { ms: 1200 });
    }
    $('toArcText').textContent = t.pairs ? `PAYS 3 TO 2 · PAIRS PAY ${t.pairPays.perfect} TO 1` : 'PAYS 3 TO 2 · DEALER STANDS ON 17';
    $('toDealerTotal').textContent = t.dealer.length ? String(t.dealerTotal) + (t.dealer.includes('??') ? '+?' : '') : '';

    const seats = $('toSeats'); seats.innerHTML = '';
    t.seats.forEach((pid, i) => {
      const p = ctx.player(pid);
      const box = ctx.el('div', 'to-seat' + (S.turn === pid ? ' turn' : '') + (i === me ? ' me' : ''));
      const head = ctx.el('div', 'to-head');
      const nm = ctx.el('b', '', `${p?.name ?? 'left'}${i === me ? ' (you)' : ''}`); nm.style.color = p?.color ?? 'inherit';
      head.append(nm, t.bets[i] ? Chips.stack(t.bets[i], { max: 6, cls: 'to-bet' }) : ctx.el('span', 'hint', t.stage === 'bet' && t.chips[i] > 0 ? 'betting…' : ''));
      // insurance: 🛡️ while it's on, then what it paid or cost
      const ir = t.insRes?.[i], ins = t.ins?.[i];
      if (ir != null) head.append(ctx.el('span', 'to-pair ' + (ir > 0 ? 'win' : 'lose'), `🛡️ ${ir > 0 ? '+' : ''}${ir}`));
      else if (t.stage === 'insure' && ins) head.append(ctx.el('span', 'to-pair', `🛡️ ${ins}`));
      else if (t.stage === 'insure' && ins === null) head.append(ctx.el('span', 'hint', 'deciding…'));
      if (i === me && ir > 0 && !called.has('i' + t.hand)) { called.add('i' + t.hand); Kit.callout(`Insurance pays! +${ir}`, 'gold', { ms: 1600 }); }
      const pr = t.pairRes?.[i];
      if (t.pair?.[i] && !pr) head.append(ctx.el('span', 'to-pair', `👯 ${t.pair[i]}`));
      if (pr) {
        head.append(ctx.el('span', 'to-pair ' + (pr[1] > 0 ? 'win' : 'lose'), pr[1] > 0 ? `👯 ${pr[0]} +${pr[1]}` : `👯 ${pr[1]}`));
        if (i === me && pr[1] > 0 && !called.has('p' + t.hand)) {
          called.add('p' + t.hand);
          Kit.callout(pr[0] === 'perfect' ? `Perfect pair! +${pr[1]}` : `${pr[0][0].toUpperCase() + pr[0].slice(1)} pair! +${pr[1]}`, 'gold', { sound: 'fanfare', ms: 1600 });
        }
      }
      box.append(head);
      const hs = t.seatHands[i], split = hs.length > 1;
      hs.forEach((h, k) => {
        const wrap = ctx.el('div', 'to-hand' + (split && S.turn === pid && t.stage === 'play' && t.cur[i] === k ? ' cur' : ''));
        const cards = ctx.el('div', 'to-cards');
        const dh = dealt(`${i}:${k}`, h.cards);
        h.cards.forEach((card, n) => cards.append(dh(face(card, 'small'), n)));
        const foot = ctx.el('div', 'to-foot');
        foot.append(ctx.el('b', h.total > 21 ? 'bust' : '', String(h.total)));
        // my own big moments: blackjack and bust
        const ck = `${t.hand}:${k}`;
        if (i === me && !called.has(ck)) {
          if (h.total > 21) { called.add(ck); Kit.callout('BUST', 'bad', { ms: 1100 }); ctx.sfx('wrong'); ctx.buzz(60); }
          else if (h.total === 21 && h.cards.length === 2 && !split) { called.add(ck); Kit.callout('Blackjack!', 'gold', { sound: 'fanfare' }); }
        }
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

    fromShoe();
    if (t.stage === 'settle' && !called.has('pay' + t.hand)) {
      called.add('pay' + t.hand);
      const dealerBox = document.querySelector('.to-dealer');
      [...seats.children].forEach((box, i) => {
        const res = t.result[i], stack = box.querySelector('.to-bet');
        if (!res || !stack) return;
        const d = res[1];
        if (d > 0) {  // the winnings slide out from the dealer to the seat
          const pay = Chips.stack(d, { label: false, max: 5, cls: 'to-paychips' });
          dealerBox.append(pay);
          Kit.fly(pay, stack, { ms: 600, delay: 150 * i, remove: false });
          pay.remove();
        } else if (d < 0) Kit.fly(stack, dealerBox, { ms: 600, delay: 150 * i });
        if (d) setTimeout(() => Kit.flyText(box.querySelector('.to-head'), `${d > 0 ? '+' : ''}${d}`, d > 0 ? 'good' : 'bad'), 150 * i + 450);
      });
      if (t.result[me]?.[1] > 0) setTimeout(() => ctx.sfx('chip'), 500);
    }

    const bar = $('toBar'); bar.innerHTML = '';
    const playing = S.phase === 'playing' && me != null;
    let note = '';
    if (playing && t.stage === 'bet' && !t.bets[me] && t.chips[me] > 0) {
      if (stakeHand !== t.hand) { stakeHand = t.hand; stake = 0; }
      betBar(bar, t, me);
      note = '';
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
    } else if (playing && t.stage === 'insure' && t.ins?.[me] === null) {
      // the dealer shows an ace: insure for half the bet, before the dealer peeks
      const yes = ctx.el('button', 'primary', `🛡️ Insure (${t.insStake})`), no = ctx.el('button', '', 'No insurance');
      yes.onclick = () => ctx.quiet(ctx.act('insure', { take: true }));
      no.onclick = () => ctx.quiet(ctx.act('insure', { take: false }));
      bar.append(yes, no);
      note = `The dealer shows an ace. Insurance costs ${t.insStake} and pays ${t.insStake * 2} if the dealer has blackjack.`;
    } else if (playing && t.stage === 'insure') note = 'Waiting for the others to decide on insurance…';
    else if (playing && t.stage === 'bet') note = t.chips[me] > 0 ? 'Waiting for the other bets…' : 'Out of chips — watching.';
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

  const turnText = (s) => (s.phase === 'playing' && s.twentyone.stage === 'insure' ? '🛡️ Insurance?'
    : s.phase === 'playing' && s.twentyone.stage === 'bet' ? (s.twentyone.me != null && !s.twentyone.bets[s.twentyone.me] && s.twentyone.chips[s.twentyone.me] > 0 ? '💰 Place your bet' : '💰 Bets going in…') : null);
  const myMove = (s) => s.phase === 'playing' && s.twentyone.stage === 'insure' && s.twentyone.me != null && s.twentyone.ins?.[s.twentyone.me] === null
    || s.phase === 'playing' && s.twentyone.stage === 'bet' && s.twentyone.me != null && !s.twentyone.bets[s.twentyone.me] && s.twentyone.chips[s.twentyone.me] > 0;

  return { mount, render, turnText, myMove };
})();
