UI.lastcard = (() => {
  let S, ctx, pendingJack = null, shownTop, shownHand = null;
  const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const $ = (id) => document.getElementById(id);
  const rank = (c) => c.slice(0, -1), suit = (c) => c.slice(-1);

  function face(card, cls = '') {
    const f = ctx.el('span', `pc ${'HD'.includes(suit(card)) ? 'red' : 'black'} ${cls}`);
    f.append(ctx.el('b', '', rank(card)), ctx.el('i', '', SUIT[suit(card)] + '︎'));
    return f;
  }

  function mount(main, side) {
    pendingJack = null; shownTop = undefined; shownHand = null;
    main.innerHTML = `<div class="table">
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
    const top = $('lcTop'); top.innerHTML = '';
    top.append(face(g.top, 'big-card' + (shownTop !== undefined && shownTop !== g.top ? ' toss' : '')));
    shownTop = g.top;
    $('lcDeckCount').textContent = g.deck;
    const info = $('lcInfo'); info.innerHTML = '';
    if (g.suit !== suit(g.top)) info.append(ctx.el('div', 'chip-suit ' + ('HD'.includes(g.suit) ? 'red' : ''), `Suit: ${SUIT[g.suit]}︎`));
    if (g.penalty) info.append(ctx.el('div', 'penalty', `+${g.penalty} pending!`));
    info.append(ctx.el('div', 'hint', g.direction === 1 ? '↻ clockwise' : '↺ reversed'));

    // a fanned hand: one swipeable row, each card turned a little more the further it is from the middle
    const hand = $('lcHand'); hand.innerHTML = '';
    const cards = g.hand || [], mid = (cards.length - 1) / 2, step = Math.min(6, 48 / Math.max(1, cards.length));
    hand.classList.toggle('fan', cards.length > 0);
    // cards that weren't in the hand last time are dealt in from the deck, one after another
    const before = shownHand ? [...shownHand] : null;
    const fresh = new Set();
    if (before) for (const card of cards) { const at = before.indexOf(card); if (at >= 0) before.splice(at, 1); else fresh.add(card); }
    shownHand = cards;
    let dealt = 0;
    for (const [k, card] of cards.entries()) {
      const ok = g.playable.includes(card);
      const b = ctx.el('button', 'card-btn' + (ok ? ' ok' : ''));
      b.style.setProperty('--rot', `${((k - mid) * step).toFixed(1)}deg`);
      b.style.setProperty('--drop', `${(Math.abs(k - mid) * step * 0.6).toFixed(1)}px`);
      b.append(face(card));
      if (fresh.has(card)) { b.classList.add('dealt'); b.style.setProperty('--deal', `${dealt++ * 0.12}s`); fresh.delete(card); }
      b.disabled = !ok;
      b.onclick = () => onCard(card);
      hand.append(b);
    }
    if (!g.hand) hand.append(ctx.el('p', 'hint', '👁 Watching'));

    const pick = $('lcSuitPick'); pick.innerHTML = ''; pick.hidden = !pendingJack;
    if (pendingJack) {
      pick.append(ctx.el('span', 'hint', 'Jack — choose a suit:'));
      for (const s of 'SHDC') {
        const b = ctx.el('button', 'HD'.includes(s) ? 'red' : '', SUIT[s] + '︎');
        b.onclick = () => { const card = pendingJack; pendingJack = null; ctx.quiet(ctx.act('play', { card, suit: s })); };
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
    if (!ctx.myTurn) return;
    if (S.cards.actions && rank(card) === 'J') { pendingJack = card; return ctx.rerender(); }
    ctx.quiet(ctx.act('play', { card }));
  }

  return { mount, render };
})();
