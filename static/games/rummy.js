// Contract Rummy: deck and discard pile on top, then every meld on the table, then your hand.
// Select cards by tapping them. Before you've laid down, group them with Set / Run (tap a staged group
// to undo it), then Lay down. Afterwards, tap a meld to add the selected cards to it. Discard ends your turn.
UI.rummy = (() => {
  let S, ctx, sel = [], staged = [], stageFor = '';
  const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const $ = (id) => document.getElementById(id);
  const joker = (c) => c[0] === 'X';

  function face(card, cls = '') {
    if (joker(card)) { const f = ctx.el('span', `pc joker ${cls}`); f.append(ctx.el('b', '', '🃏'), ctx.el('i', '', 'wild')); return f; }
    const f = ctx.el('span', `pc ${'HD'.includes(card[1]) ? 'red' : 'black'} ${cls}`);
    f.append(ctx.el('b', '', card[0] === 'T' ? '10' : card[0]), ctx.el('i', '', SUIT[card[1]] + '︎'));
    return f;
  }

  function mount(main, side) {
    sel = []; staged = []; stageFor = '';
    main.innerHTML = `<div class="ru">
      <div class="ru-top"><div id="ruContract" class="ru-contract"></div>
        <div class="ru-piles"><button id="ruDeck" class="ru-pile"></button><button id="ruDiscard" class="ru-pile"></button></div></div>
      <div id="ruMelds" class="ru-melds"></div>
      <div id="ruStaged" class="ru-staged"></div>
      <div id="ruNote" class="hh-note"></div>
      <div id="ruHand" class="hh-hand ru-hand"></div>
      <div class="row ru-actions"><button id="ruSet">Set</button><button id="ruRun">Run</button>
        <button id="ruLay" class="primary">Lay down</button><button id="ruThrow" class="danger">Discard</button></div></div>`;
    side.innerHTML = '<div class="panel"><h3>Scores</h3><div id="ruScores"></div><p class="hint left">2–9 = 5 · 10–K = 10 · A = 15 · 🃏 = 25. Lowest wins.</p></div>';
    $('ruDeck').onclick = () => ctx.quiet(ctx.act('draw', { from: 'deck' }));
    $('ruDiscard').onclick = () => ctx.quiet(ctx.act('draw', { from: 'discard' }));
    $('ruSet').onclick = () => stage('set');
    $('ruRun').onclick = () => stage('run');
    $('ruLay').onclick = () => ctx.quiet(ctx.act('laydown', { groups: staged.map(([kind, cards]) => ({ kind, cards })) }));
    $('ruThrow').onclick = () => { if (sel.length === 1) { const card = sel[0]; sel = []; ctx.quiet(ctx.act('discard', { card })); } };
  }

  function stage(kind) {
    if (sel.length < (kind === 'set' ? 3 : 4)) return ctx.toast(kind === 'set' ? 'A set needs 3+ cards of one rank.' : 'A run needs 4+ cards of one suit in a row.');
    staged.push([kind, sel]); sel = []; ctx.rerender();
  }

  const name = (i) => ctx.player(S.rummy.seats[i])?.name ?? '?';

  function render(s, c) {
    S = s; ctx = c;
    const r = S.rummy, me = r.me, myTurn = ctx.myTurn && S.phase === 'playing';
    const key = `${r.handNo}`;
    if (key !== stageFor) { staged = []; sel = []; stageFor = key; }
    const inStage = new Set(staged.flatMap(([, cs]) => cs));
    sel = sel.filter((x) => r.hand.includes(x));
    if (r.down[me]) staged = [];

    $('ruContract').textContent = `Hand ${r.handNo}/${r.hands}: ${r.contractText}`;
    const deck = $('ruDeck'); deck.innerHTML = ''; deck.append(ctx.el('span', 'pc back'), ctx.el('small', '', `${r.deck} left`));
    const dis = $('ruDiscard'); dis.innerHTML = '';
    dis.append(r.top ? face(r.top) : ctx.el('span', 'pc empty'), ctx.el('small', '', 'discard'));
    deck.disabled = dis.disabled = !myTurn || r.drawn;
    if (!r.top) dis.disabled = true;

    const melds = $('ruMelds'); melds.innerHTML = '';
    if (!r.melds.length) melds.append(ctx.el('p', 'hint', 'No melds on the table yet.'));
    r.melds.forEach((m, idx) => {
      const b = ctx.el('button', 'ru-meld' + (myTurn && r.down[me] && sel.length ? ' can' : ''));
      const who = ctx.el('small', '', `${name(m.owner)} · ${m.kind}`);
      const row = ctx.el('span', 'ru-cards');
      m.cards.forEach((x) => row.append(face(x, 'small')));
      b.append(who, row);
      b.disabled = !(myTurn && r.drawn && r.down[me] && sel.length);
      b.onclick = () => { const cards = sel; sel = []; ctx.quiet(ctx.act('add', { meld: idx, cards })); };
      melds.append(b);
    });

    const st = $('ruStaged'); st.innerHTML = '';
    staged.forEach(([kind, cs], k) => {
      const b = ctx.el('button', 'ru-meld staged');
      b.append(ctx.el('small', '', `${kind} (tap to undo)`));
      const row = ctx.el('span', 'ru-cards'); cs.forEach((x) => row.append(face(x, 'small'))); b.append(row);
      b.onclick = () => { staged.splice(k, 1); ctx.rerender(); };
      st.append(b);
    });

    const hand = $('ruHand'); hand.innerHTML = '';
    for (const card of r.hand) {
      if (inStage.has(card)) continue;
      const b = ctx.el('button', 'card-btn' + (sel.includes(card) ? ' ok' : ''));
      b.append(face(card));
      b.disabled = !myTurn || !r.drawn;
      b.onclick = () => { sel = sel.includes(card) ? sel.filter((x) => x !== card) : [...sel, card]; ctx.rerender(); };
      hand.append(b);
    }

    const [k, m] = r.contract;
    const sets = staged.filter(([kd]) => kd === 'set').length, runs = staged.filter(([kd]) => kd === 'run').length;
    const can = myTurn && r.drawn;
    $('ruSet').hidden = $('ruRun').hidden = $('ruLay').hidden = !!r.down[me] || me == null;
    $('ruSet').disabled = !can || sets >= k;
    $('ruRun').disabled = !can || runs >= m;
    $('ruLay').disabled = !can || sets !== k || runs !== m;
    $('ruThrow').disabled = !can || sel.length !== 1;
    $('ruThrow').hidden = me == null;
    $('ruNote').textContent = !myTurn ? (S.phase === 'playing' ? `${name(r.seats.indexOf(S.turn))} is playing…` : '')
      : !r.drawn ? 'Draw from the deck or take the discard.'
      : r.down[me] ? 'Add cards to any meld, then discard one.'
      : `Build the contract (${sets}/${k} sets, ${runs}/${m} runs), or discard one card.`;

    const sc = $('ruScores'); sc.innerHTML = '';
    r.seats.map((pid, i) => [i, r.scores[i]]).sort((a, b) => a[1] - b[1]).forEach(([i, v]) => {
      const row = ctx.el('div', 'seat-row');
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = ctx.player(r.seats[i])?.color ?? '#777';
      row.append(dot, ctx.el('span', 'grow', `${name(i)}${i === me ? ' (you)' : ''} · 🂠${r.counts[i]}${r.down[i] ? ' ✅' : ''}`), ctx.el('b', '', String(v)));
      sc.append(row);
    });
  }

  return { mount, render };
})();
