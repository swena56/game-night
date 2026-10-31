// Cribbage: a peg track, the play (count and cards), your hand, and the show's breakdown.
// Hand buttons are rebuilt only when the hand changes, so taps aren't lost to other players' updates.
UI.cribbage = (() => {
  let S, ctx, picked = new Set(), handKey = '', shownScore = {}, backPeg = {}, myCount = 0, countFor = '';
  const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const $ = (id) => document.getElementById(id);
  const value = (c) => Math.min('A23456789TJQK'.indexOf(c[0]) + 1, 10);

  function face(card, cls = '') {
    const f = ctx.el('span', `pc ${'HD'.includes(card[1]) ? 'red' : 'black'} ${cls}`);
    f.append(ctx.el('b', '', card[0] === 'T' ? '10' : card[0]), ctx.el('i', '', SUIT[card[1]] + '︎'));
    return f;
  }

  function mount(main, side) {
    picked = new Set(); handKey = ''; shownScore = {}; backPeg = {};
    main.innerHTML = `<div class="cb">
      <div id="cbTrack" class="cb-track"></div>
      <div class="table cb-table">
        <div class="cb-mid">
          <div class="cb-slot"><small>Starter</small><div id="cbStarter"></div></div>
          <div class="cb-slot"><small>Count</small><div id="cbCount" class="cb-count"></div></div>
          <div class="cb-slot"><small id="cbCribLabel">Crib</small><div id="cbCrib" class="cb-crib"></div></div>
        </div>
        <div id="cbSeq" class="cb-seq"></div>
        <div id="cbLast" class="cb-last"></div>
        <div id="cbShow" class="cb-show"></div>
      </div>
      <div id="cbHand" class="hand cb-hand"></div>
      <div id="cbCountBox" class="cb-countbox" hidden>
        <div id="cbCountCards" class="he-cards"></div>
        <div class="lr-qty"><button id="cbLess" aria-label="Less">−</button><b id="cbMine">0</b><button id="cbMore" aria-label="More">+</button></div>
        <button id="cbCountGo" class="primary big">🧮 That's my count</button>
      </div>
      <button id="cbDiscard" class="primary big" hidden></button>
      <p id="cbHint" class="hint"></p>
    </div>`;
    side.innerHTML = `<div class="panel"><div id="cbStatus" class="seat-row"></div><div id="cbPlayed" class="cb-played"></div>
      <h3>Scoring</h3><ul class="rules cb-rules">
      <li>Fifteen 2 · Pair 2 · Three of a kind 6 · Four 12</li><li>Run: 1 per card · 31: 2 · Last card / go: 1</li>
      <li>Show: flush 4 (5 with the starter; the crib needs 5) · Nobs 1</li></ul></div>`;
    $('cbLess').onclick = () => { myCount = Math.max(0, myCount - 1); $('cbMine').textContent = myCount; };
    $('cbMore').onclick = () => { myCount = Math.min(29, myCount + 1); $('cbMine').textContent = myCount; };
    $('cbCountGo').onclick = () => ctx.quiet(ctx.act('count', { n: myCount }));
    $('cbDiscard').onclick = () => {
      const cards = [...picked];
      ctx.quiet(ctx.act('discard', { cards }).then(() => { picked = new Set(); }));
    };
  }

  function render(s, c) {
    S = s; ctx = c;
    const g = S.cribbage, me = S.me.id, mine = g.seats.includes(me);
    const dealerName = ctx.player(g.dealer)?.name ?? '';

    // peg track: one lane per player. Like real two-peg scoring, the back peg stays at the old score while the
    // front peg hops forward, with the points just scored floating above it.
    const track = $('cbTrack'); track.innerHTML = '';
    const at = (v) => `${(100 * Math.min(v, g.target)) / g.target}%`;
    for (const pid of g.seats) {
      const p = ctx.player(pid); if (!p) continue;
      const lane = ctx.el('div', 'cb-lane' + (pid === S.turn ? ' now' : ''));
      const name = ctx.el('b', '', `${p.name}${pid === g.dealer ? ' 🔘' : ''}`); name.style.color = p.color;
      const bar = ctx.el('div', 'cb-bar');
      const score = g.scores[pid] || 0, was = shownScore[pid] ?? score;
      if (score < was) backPeg[pid] = 0;               // a new game
      else if (score > was) backPeg[pid] = was;
      shownScore[pid] = score;
      if (backPeg[pid] != null && backPeg[pid] < score) {
        const back = ctx.el('span', 'cb-peg back'); back.style.left = at(backPeg[pid]); back.style.background = p.color;
        bar.append(back);
      }
      const peg = ctx.el('span', 'cb-peg'); peg.style.left = at(was); peg.style.background = p.color;
      bar.append(peg);
      if (score > was) {
        requestAnimationFrame(() => requestAnimationFrame(() => { peg.style.left = at(score); }));
        const plus = ctx.el('span', 'cb-plus', `+${score - was}`); plus.style.left = at(score);
        bar.append(plus);
      } else peg.style.left = at(score);
      lane.append(name, bar, ctx.el('span', 'cb-score', String(g.scores[pid] || 0)));
      track.append(lane);
    }

    // middle of the table
    const st = $('cbStarter'); st.innerHTML = '';
    st.append(g.starter ? face(g.starter, 'small') : ctx.el('span', 'pc back small'));
    $('cbCount').textContent = g.stage === 'peg' ? String(g.count) : '–';
    $('cbCribLabel').textContent = `${dealerName}'s crib`;
    $('cbCrib').textContent = `${g.crib} card${g.crib === 1 ? '' : 's'}`;
    const seq = $('cbSeq'); seq.innerHTML = '';
    for (const card of g.seq) seq.append(face(card, 'small'));
    $('cbLast').textContent = g.stage === 'peg' ? g.lastPeg : '';

    // the show
    const show = $('cbShow'); show.innerHTML = '';
    show.hidden = !g.show.length;
    for (const h of g.show) {
      const p = ctx.player(h.who);
      const box = ctx.el('div', 'cb-showhand');
      const title = ctx.el('div', 'cb-showtitle');
      const who = ctx.el('b', '', `${p?.name ?? '?'}${h.crib ? "'s crib" : "'s hand"}`); who.style.color = p?.color ?? '';
      title.append(who, ctx.el('span', 'cb-total', h.said != null && h.said !== h.total ? `${h.said} → ${h.total}` : `${h.total}`));
      const cards = ctx.el('div', 'he-cards');
      for (const card of h.cards) cards.append(face(card, 'small'));
      if (g.starter) { const s2 = face(g.starter, 'small starter'); cards.append(s2); }
      box.append(title, cards, ctx.el('small', '', h.items.map(([d, v]) => `${d} ${v}`).join(' · ') || 'Nineteen (nothing!)'));
      show.append(box);
    }

    // my hand: pick discards, or play a card
    const hand = g.hand || [];
    const discarding = g.stage === 'discard' && mine && !g.discarded[me] && S.phase === 'playing';
    const playing = g.stage === 'peg' && ctx.myTurn && S.phase === 'playing';
    const key = `${g.deal}:${g.stage}:${hand.join(',')}`;
    const box = $('cbHand');
    if (key !== handKey) {
      handKey = key; box.innerHTML = '';
      picked = new Set([...picked].filter((x) => hand.includes(x)));
      for (const card of hand) {
        const b = ctx.el('button', 'card-btn');
        b.dataset.card = card;
        b.append(face(card, 'big-card'));
        b.onclick = () => {
          if (S.cribbage.stage === 'discard') {
            picked.has(card) ? picked.delete(card) : picked.size < S.cribbage.need && picked.add(card);
            ctx.rerender();
          } else ctx.quiet(ctx.act('play', { card }));
        };
        box.append(b);
      }
    }
    for (const b of box.children) {
      const card = b.dataset.card;
      b.classList.toggle('ok', discarding ? picked.has(card) : playing && g.count + value(card) <= 31);
      b.disabled = !(discarding || (playing && g.count + value(card) <= 31));
    }
    $('cbDiscard').hidden = !discarding;
    $('cbDiscard').disabled = picked.size !== g.need;
    $('cbDiscard').textContent = `✂️ Send ${g.need === 1 ? 'this card' : `these ${g.need}`} to ${g.dealer === me ? 'your' : `${dealerName}'s`} crib`
      + (picked.size !== g.need ? ` (${picked.size}/${g.need})` : '');
    $('cbHint').textContent = !mine ? '' : discarding ? `Pick ${g.need} card${g.need > 1 ? 's' : ''} for the crib. ${g.dealer === me ? "It's yours: feed it!" : "It's your rival's: don't help it."}`
      : g.stage === 'discard' ? 'Waiting for everyone to discard…'
      : g.stage === 'peg' ? (ctx.myTurn ? `Play a card (count ${g.count}; you can go up to 31).` : `${ctx.player(S.turn)?.name ?? ''} is playing…`)
      : g.stage === 'show' ? 'Counting hands… next deal shortly.' : '';

    // side: cards each player has laid this deal
    const played = $('cbPlayed'); played.innerHTML = '';
    for (const pid of g.seats) {
      const p = ctx.player(pid); if (!p) continue;
      const row = ctx.el('div', 'cb-playedrow');
      const n = ctx.el('b', '', p.name); n.style.color = p.color;
      row.append(n);
      for (const card of g.pegged[pid] || []) row.append(face(card, 'small'));
      if (g.stage === 'peg') row.append(ctx.el('small', 'hint', ` ${g.left[pid]} left`));
      played.append(row);
    }
    $('cbStatus').textContent = `Deal ${g.deal} · to ${g.target}`;

    // 🦉 muggins: count your own hand (the kept four and the starter)
    const cb = $('cbCountBox');
    cb.hidden = !g.counting || !ctx.act;
    if (g.counting) {
      const k = `${g.deal}`;
      if (countFor !== k) { countFor = k; myCount = 0; }
      $('cbMine').textContent = myCount;
      const cards = $('cbCountCards'); cards.innerHTML = '';
      for (const card of g.kept) cards.append(face(card, 'small'));
      if (g.starter) cards.append(face(g.starter, 'small starter'));
      $('cbHint').textContent = 'Muggins! Count your hand with the starter. Miss points and the next player takes them.';
    } else if (g.stage === 'count') $('cbHint').textContent = 'Everyone is counting their hand…';
  }

  const turnText = (s) => s.phase !== 'playing' ? null
    : s.cribbage.stage === 'discard' ? (s.cribbage.discarded[s.me.id] === false ? '✂️ Discard to the crib' : '✂️ Waiting for discards…')
    : s.cribbage.stage === 'count' ? (s.cribbage.counting ? '🦉 Count your hand!' : '🦉 Waiting for counts…')
    : s.cribbage.stage === 'show' ? '🧮 Counting hands…' : null;
  const myMove = (s) => s.phase === 'playing' && ((s.cribbage.stage === 'discard' && s.cribbage.discarded[s.me.id] === false) || s.cribbage.counting);
  return { mount, render, turnText, myMove };
})();
