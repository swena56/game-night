UI.lastcard = (() => {
  let S, ctx, pendingJack = null, shownTop, shownHand = null;
  const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const $ = (id) => document.getElementById(id);
  const rank = (c) => c.slice(0, -1), suit = (c) => c.slice(-1);

  const face = (card, cls = '') => Cards.face(card, cls);

  function mount(main, side) {
    pendingJack = null; shownTop = undefined; shownHand = null;
    main.innerHTML = `<div class="table">
      <div id="lcSeats" class="lc-seats"></div>
      <div class="pile-row">
        <button id="lcDeck" class="pc back"><b>🎴</b><small id="lcDeckCount"></small></button>
        <div id="lcTop"></div>
        <div id="lcInfo" class="lc-info"></div>
      </div>
      <div id="lcSuitPick" class="row suit-pick" hidden></div>
      <div id="lcHand" class="hand"></div>
    </div>`;
    side.innerHTML = `<div class="panel">
      <div class="row"><button id="lcDraw" class="primary">Draw</button><button id="lcPass">Pass</button></div>
      <button id="lcDeclare" class="big danger">📣 Last card!</button>
      <div id="lcCatch" class="cards"></div>
      <ul class="rules" id="lcRules"></ul></div>`;
    $('lcDeck').onclick = () => ctx.myTurn && ctx.quiet(ctx.act('draw'));
    $('lcDraw').onclick = () => ctx.quiet(ctx.act('draw'));
    $('lcPass').onclick = () => ctx.quiet(ctx.act('pass'));
    $('lcDeclare').onclick = () => ctx.quiet(ctx.act('declare'));
  }

  function render(s, c) {
    S = s; ctx = c;
    const g = S.cards;
    if (!ctx.myTurn) pendingJack = null;
    // rivals round the table, each holding a fan of card backs as big as their hand
    const seats = $('lcSeats'); seats.innerHTML = '';
    for (const pid of g.seats) {
      if (pid === S.me.id) continue;
      const p = ctx.player(pid), n = g.counts?.[pid] ?? 0;
      const seat = ctx.el('div', 'lc-seat' + (pid === S.turn ? ' up' : '') + (g.exposed.includes(pid) ? ' exposed' : ''));
      seat.dataset.pid = pid;
      const fan = ctx.el('span', 'lc-fan'), k = Math.min(n, 9);
      for (let i = 0; i < k; i++) { const b = Cards.back('mini'), o = i - (k - 1) / 2; b.style.setProperty('--r', `${o * 9}deg`); b.style.setProperty('--x', `${o * 4}px`); fan.append(b); }
      seat.append(fan, ctx.el('b', '', p?.name ?? '?'), ctx.el('small', '', n === 1 ? '1 card!' : `${n} cards`));
      if (p) seat.style.setProperty('--c', p.color);
      seats.append(seat);
    }
    const top = $('lcTop');
    const played = shownTop !== undefined && shownTop !== g.top;
    // a rival's card sails from their seat to the pile (yours flies from your hand when you tap it)
    if (played && g.lastBy && g.lastBy !== S.me.id) {
      const from = seats.querySelector(`[data-pid="${g.lastBy}"] .lc-fan`);
      const back = from?.lastElementChild;
      if (back && top.firstElementChild) Kit.fly(back, top.firstElementChild, { ms: 420 });
    }
    top.innerHTML = '';
    top.append(face(g.top, 'big-card' + (played ? ' toss' : '')));
    // action cards land with a stamp and a sound of their own
    if (played) {
      const r = rank(g.top), act = g.actions && { 7: ['+' + g.penalty, 'bad'], 8: ['⛔ Skip', 'bad'], Q: ['⇄ Reverse', 'cool'], J: [SUIT[g.suit] + '︎', 'HD'.includes(g.suit) ? 'bad' : 'cool'] }[r];
      if (act) {
        const stamp = ctx.el('span', 'lc-stamp ' + act[1], act[0]);
        top.append(stamp);
        ctx.sfx(r === '7' ? 'rise' : r === '8' ? 'thud' : r === 'Q' ? 'whoosh' : 'pickup', g.penalty / 2);
        if (r === '7' && g.penalty >= 4) Kit.callout(`+${g.penalty}!`, 'bad', { ms: 1100 });
      } else ctx.sfx('card');
    }
    shownTop = g.top;
    $('lcDeckCount').textContent = g.deck;
    const info = $('lcInfo'); info.innerHTML = '';
    if (g.suit !== suit(g.top)) info.append(ctx.el('div', 'chip-suit ' + ('HD'.includes(g.suit) ? 'red' : ''), `Suit: ${SUIT[g.suit]}︎`));
    if (g.penalty) { const pen = ctx.el('div', 'penalty', `+${g.penalty} pending!`); pen.style.setProperty('--sz', Math.min(1.6, 1 + g.penalty / 12)); info.append(pen); }
    info.append(ctx.el('div', 'hint lc-dir' + (g.direction === 1 ? '' : ' rev'), g.direction === 1 ? '↻ clockwise' : '↺ reversed'));

    // a fanned hand: one swipeable row, each card turned a little more the further it is from the middle
    const hand = $('lcHand'); hand.innerHTML = '';
    const cards = g.hand || [], mid = (cards.length - 1) / 2, step = Math.min(6, 48 / Math.max(1, cards.length));
    hand.classList.toggle('fan', cards.length > 0);
    // cards that weren't in the hand last time are dealt in from the deck, one after another
    const before = shownHand ? [...shownHand] : null;
    const fresh = new Set();
    if (before) for (const card of cards) { const at = before.indexOf(card); if (at >= 0) before.splice(at, 1); else fresh.add(card); }
    shownHand = cards;
    if (before && fresh.size) ctx.sfx('deal');
    let dealt = 0;
    for (const [k, card] of cards.entries()) {
      const twin = (g.twins || []).includes(card), ok = g.playable.includes(card) || twin;
      const b = ctx.el('button', 'card-btn' + (ok ? ' ok' : '') + (twin ? ' twin' : ''));
      if (twin) b.title = '⚡ Jump in with this twin!';
      b.style.setProperty('--rot', `${((k - mid) * step).toFixed(1)}deg`);
      b.style.setProperty('--drop', `${(Math.abs(k - mid) * step * 0.6).toFixed(1)}px`);
      b.append(face(card));
      if (fresh.has(card)) { b.classList.add('dealt'); b.style.setProperty('--deal', `${dealt++ * 0.12}s`); fresh.delete(card); }
      b.disabled = !ok;
      b.dataset.card = card;
      b.onclick = () => onCard(card);
      hand.append(b);
    }
    if (!g.hand) hand.append(ctx.el('p', 'hint', '👁 Watching'));

    const pick = $('lcSuitPick'); pick.innerHTML = ''; pick.hidden = !pendingJack;
    if (pendingJack) {
      pick.append(ctx.el('span', 'hint', 'Jack — choose a suit:'));
      for (const s of 'SHDC') {
        const b = ctx.el('button', 'HD'.includes(s) ? 'red' : '', SUIT[s] + '︎');
        b.onclick = () => { const card = pendingJack; pendingJack = null; flyToPile(card); ctx.quiet(ctx.act('play', { card, suit: s })); };
        pick.append(b);
      }
    }

    $('lcDraw').disabled = !ctx.myTurn || g.drew;
    $('lcDraw').textContent = g.penalty ? `Draw ${g.penalty}` : 'Draw';
    $('lcPass').hidden = !g.drew;
    const n = (g.hand || []).length;
    const me = S.me.id;
    $('lcDeclare').hidden = !g.hand || n > 2 || S.phase !== 'playing';
    $('lcDeclare').classList.toggle('on', g.exposed.includes(me));

    const box = $('lcCatch'); box.innerHTML = '';
    for (const pid of g.exposed) {
      if (pid === me || !g.hand) continue;
      const p = ctx.player(pid);
      const b = ctx.el('button', 'danger', `🚨 Catch ${p?.name ?? '?'}!`);
      b.onclick = () => ctx.quiet(ctx.act('catch', { player: pid }));
      box.append(b);
    }
    $('lcRules').innerHTML = '';
    const rules = g.actions
      ? ['Match the suit or rank.', '7: next player draws 2 (stack 7s to pass it on).', '8: skip the next player.',
        'Q: reverse direction.', 'J: wild — choose the suit.', 'Call “Last card!” with 2 or fewer cards, or risk being caught (+2).']
      : ['Match the suit or rank.', 'Can’t play? Draw one.', 'Call “Last card!” with 2 or fewer cards, or risk being caught (+2).'];
    for (const r of rules) $('lcRules').append(ctx.el('li', '', r));
  }

  function onCard(card) {
    if (!ctx.myTurn) {
      if ((S.cards.twins || []).includes(card)) { flyToPile(card); ctx.quiet(ctx.act('jumpin', { card })); }
      return;
    }
    if (S.cards.actions && rank(card) === 'J') { pendingJack = card; return ctx.rerender(); }
    flyToPile(card);
    if (S.cards.actions && rank(card) === 'J') { pendingJack = card; return ctx.rerender(); }
    ctx.quiet(ctx.act('play', { card }));
  }

  function flyToPile(card) {
    const from = $('lcHand').querySelector(`[data-card="${card}"] .pc`), to = $('lcTop').firstElementChild;
    if (from && to) Kit.fly(from, to, { ms: 360, remove: false });
  }

  return { mount, render, ownSounds: true };
})();
