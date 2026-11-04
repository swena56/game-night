// Contract Rummy: deck and discard pile on top, then every meld on the table, then your hand.
// Select cards by tapping them. Before you've laid down, group them with Set / Run (tap a staged group
// to undo it), then Lay down. Afterwards, tap a meld to add the selected cards to it. Discard ends your turn.
// The hand's order is yours (#59): drag a card to move it, or sort by rank or suit. Drawn cards join at the right.
UI.rummy = (() => {
  let S, ctx, sel = [], staged = [], stageFor = '', order = [], drag = null;
  const RANKS = '23456789TJQKA', SUITS = 'SHCD';  // suits alternate black, red, black, red
  let sortMode = 'suit';
  try { sortMode = localStorage.getItem('rummy.sort') || 'suit'; } catch {}
  const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const $ = (id) => document.getElementById(id);
  const joker = (c) => c[0] === 'X';

  const face = (card, cls = '') => (joker(card) ? Cards.joker(cls) : Cards.face(card, cls));

  function mount(main, side) {
    sel = []; staged = []; stageFor = ''; order = []; drag = null; shownMelds = null;
    main.innerHTML = `<div class="ru">
      <div class="ru-top"><div id="ruContract" class="ru-contract"></div>
        <div class="ru-piles"><button id="ruDeck" class="ru-pile"></button><button id="ruDiscard" class="ru-pile"></button></div></div>
      <div id="ruMelds" class="ru-melds"></div>
      <div id="ruStaged" class="ru-staged"></div>
      <div id="ruNote" class="hh-note"></div>
      <div class="ru-sort" id="ruSort" role="group" aria-label="Sort your hand"></div>
      <div id="ruHand" class="hh-hand ru-hand"></div>
      <div class="row ru-actions"><button id="ruSet">Set</button><button id="ruRun">Run</button>
        <button id="ruLay" class="primary">Lay down</button><button id="ruThrow" class="danger">Discard</button></div></div>`;
    side.innerHTML = '<div class="panel"><h3>Scores</h3><div id="ruScores"></div><p class="hint left">2–9 = 5 · 10–K = 10 · A = 15 · 🃏 = 25. Lowest wins.</p></div>';
    $('ruDeck').onclick = () => ctx.quiet(ctx.act('draw', { from: 'deck' }));
    $('ruDiscard').onclick = () => ctx.quiet(ctx.act('draw', { from: 'discard' }));
    $('ruSet').onclick = () => stage('set');
    $('ruRun').onclick = () => stage('run');
    $('ruLay').onclick = () => ctx.quiet(ctx.act('laydown', { groups: staged.map(([kind, cards]) => ({ kind, cards })) }));
    $('ruThrow').onclick = () => {
      if (sel.length !== 1) return;
      const card = sel[0]; sel = [];
      // the card leaves the hand and sails onto the discard pile
      const from = [...$('ruHand').children].find((b) => b.dataset.card === card)?.firstElementChild;
      Kit.fly(from, $('ruDiscard').querySelector('.pc') || $('ruDiscard'), { ms: 380, remove: false });
      ctx.quiet(ctx.act('discard', { card }));
    };
  }

  // ---------- hand order: a multiset kept in step with the server's hand (two decks, so cards repeat)
  const rankOf = (c) => (joker(c) ? 99 : RANKS.indexOf(c[0]));
  const SORTS = {
    rank: (a, b) => rankOf(a) - rankOf(b) || SUITS.indexOf(a[1]) - SUITS.indexOf(b[1]),
    suit: (a, b) => (joker(a) - joker(b)) || SUITS.indexOf(a[1]) - SUITS.indexOf(b[1]) || rankOf(a) - rankOf(b),
  };
  function syncOrder(hand) {
    const left = [...hand], kept = [];
    for (const c of order) { const k = left.indexOf(c); if (k >= 0) { kept.push(c); left.splice(k, 1); } }
    order = [...kept, ...left];  // new cards join at the right
    if (SORTS[sortMode]) order.sort(SORTS[sortMode]);
  }
  function setSort(mode) {
    sortMode = mode;
    try { localStorage.setItem('rummy.sort', mode); } catch {}
    ctx.rerender();
  }

  // drag a card along the hand to move it; a press without moving is a tap (select)
  function startDrag(e, card, b) {
    if (e.button > 0) return;
    drag = { card, b, x: e.clientX, y: e.clientY, ghost: null, moved: false };
    const move = (ev) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 8) return;
      if (!drag.moved) {
        drag.moved = true;
        drag.ghost = b.firstElementChild.cloneNode(true);
        drag.ghost.classList.add('ru-ghost');
        document.body.append(drag.ghost);
        b.classList.add('lifted');
      }
      drag.ghost.style.left = `${ev.clientX - 22}px`; drag.ghost.style.top = `${ev.clientY - 40}px`;
      const at = dropIndex(ev.clientX, ev.clientY);
      for (const [k, x] of [...$('ruHand').children].entries()) x.classList.toggle('drop-before', k === at && x !== drag.b);
    };
    const up = (ev) => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      const d = drag; drag = null;
      if (!d?.moved) return;
      d.ghost.remove();
      const shown = [...$('ruHand').children], from = shown.indexOf(d.b);
      let to = ev.type === 'pointercancel' ? from : dropIndex(ev.clientX, ev.clientY);
      d.b.skipClick = true;
      if (from < 0 || to === from || to === from + 1) return ctx.rerender();
      // move within the shown cards, then rebuild the order (cards staged in a group keep their places at the end)
      const cards = shown.map((x) => x.dataset.card);
      const [c] = cards.splice(from, 1);
      cards.splice(to > from ? to - 1 : to, 0, c);
      const rest = [...order];
      for (const x of cards) rest.splice(rest.indexOf(x), 1);
      order = [...cards, ...rest];
      if (sortMode !== 'mine') { sortMode = 'mine'; try { localStorage.setItem('rummy.sort', 'mine'); } catch {} }
      ctx.rerender();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }
  // where a card dropped at (x, y) goes: before the shown card whose middle is past the pointer (rows wrap)
  function dropIndex(x, y) {
    const shown = [...$('ruHand').children];
    for (const [k, el] of shown.entries()) {
      const r = el.getBoundingClientRect();
      if (y < r.top) return k;
      if (y <= r.bottom && x < r.left + r.width / 2) return k;
    }
    return shown.length;
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

    // the contract as a checklist: one box per set and run, ticked as they're staged (or all, once down)
    const con = $('ruContract'); con.innerHTML = '';
    con.append(ctx.el('span', '', `Hand ${r.handNo}/${r.hands}: `));
    const [needSets, needRuns] = r.contract, down = me != null && r.down[me];
    const stagedSets = staged.filter(([kd]) => kd === 'set').length, stagedRuns = staged.filter(([kd]) => kd === 'run').length;
    for (let k2 = 0; k2 < needSets; k2++) con.append(ctx.el('span', 'ru-goal' + (down || k2 < stagedSets ? ' done' : ''), '🎯 set'));
    for (let k2 = 0; k2 < needRuns; k2++) con.append(ctx.el('span', 'ru-goal' + (down || k2 < stagedRuns ? ' done' : ''), '🪜 run'));
    con.title = r.contractText;
    // a player laying down: their new melds sweep in
    const meldCount = r.melds.length;
    const laid = shownMelds != null && meldCount > shownMelds;
    if (laid) { ctx.sfx('sweep'); if (r.melds.slice(shownMelds).some((m) => m.owner === me)) Kit.callout('Down!', 'good', { ms: 1000 }); }
    const freshFrom = laid ? shownMelds : meldCount;
    shownMelds = meldCount;
    const deck = $('ruDeck'); deck.innerHTML = ''; deck.append(ctx.el('span', 'pc back'), ctx.el('small', '', `${r.deck} left`));
    const dis = $('ruDiscard'); dis.innerHTML = '';
    const tossed = shownTop !== undefined && r.top && r.top !== shownTop;  // a fresh discard lands on the pile
    shownTop = r.top;
    dis.append(r.top ? face(r.top, tossed ? 'toss' : '') : ctx.el('span', 'pc empty'), ctx.el('small', '', 'discard'));
    deck.disabled = dis.disabled = !myTurn || r.drawn;
    if (!r.top) dis.disabled = true;

    // cards laid off onto a meld since the last look glow for a moment; a player going out gets a callout
    const added = r.melds.map((m, idx) => {
      const was = [...(meldCards[idx] || [])], fresh = new Set();
      if (meldCards[idx]) m.cards.forEach((x, k) => { const at = was.indexOf(x); if (at >= 0) was.splice(at, 1); else fresh.add(k); });
      return fresh;
    });
    meldCards = r.melds.map((m) => [...m.cards]);
    if (shownCounts && shownNo === r.handNo) r.counts.forEach((n, i) => { if (!n && shownCounts[i]) Kit.callout(i === me ? '🃏 You go out!' : `🃏 ${name(i)} goes out!`, i === me ? 'gold' : 'cool', { sound: i === me ? 'fanfare' : 'sweep', ms: 1600 }); });
    shownCounts = [...r.counts];
    const melds = $('ruMelds'); melds.innerHTML = '';
    if (!r.melds.length) melds.append(ctx.el('p', 'hint', 'No melds on the table yet.'));
    r.melds.forEach((m, idx) => {
      const b = ctx.el('button', 'ru-meld' + (myTurn && r.down[me] && sel.length ? ' can' : '') + (idx >= freshFrom ? ' fresh' : ''));
      if (idx >= freshFrom) b.style.animationDelay = (idx - freshFrom) * 0.12 + 's';
      const who = ctx.el('small', '', `${name(m.owner)} · ${m.kind}`);
      const row = ctx.el('span', 'ru-cards');
      m.cards.forEach((x, k) => row.append(face(x, 'small' + (added[idx]?.has(k) ? ' laidoff' : ''))));
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

    const sortBox = $('ruSort'); sortBox.innerHTML = '';
    sortBox.append(ctx.el('small', '', 'Sort:'));
    for (const [mode, label] of [['mine', '✋ My order'], ['rank', '🔢 Rank'], ['suit', '♠ Suit']]) {
      const b = ctx.el('button', 'seg-opt' + (sortMode === mode ? ' on' : ''), label);
      b.setAttribute('aria-pressed', String(sortMode === mode));
      b.onclick = () => setSort(mode);
      sortBox.append(b);
    }
    sortBox.hidden = me == null;

    if (!drag?.moved) renderHand(r, inStage, myTurn && r.drawn);  // never rebuild the hand under a card being dragged
    renderButtons(r, me, myTurn);
  }

  // #31: cards new to the hand since it was last drawn are dealt in from the deck, one after another (the
  // whole hand at the start of each deal, the drawn card on a turn). A multiset: two decks repeat cards.
  // Opening the page mid-hand shows the hand as it is, unless it was only just dealt.
  let shown = null, shownNo = null, shownTop, dealing = [], dealStart = 0, shownMelds = null, meldCards = [], shownCounts = null;  // dealing: [{card, delay}] from dealStart
  function freshCards(r) {
    if (shownNo !== r.handNo) {
      const n = r.counts.length, size = r.handNo <= 3 ? 10 : 12;
      const justDealt = shownNo !== null || (r.deck === 108 - n * size - 1 && !r.melds.length);
      shown = justDealt ? [] : [...r.hand]; shownNo = r.handNo;
    }
    const left = [...shown], fresh = [];
    for (const c of r.hand) { const at = left.indexOf(c); if (at >= 0) left.splice(at, 1); else fresh.push(c); }
    shown = [...r.hand];
    return fresh;
  }

  function renderHand(r, inStage, canPick) {
    syncOrder(r.hand);
    const fresh = freshCards(r), gap = fresh.length > 3 ? 0.07 : 0.12, now = performance.now();
    if (fresh.length) {  // give each new card its turn, in the order they sit in the hand
      dealing = []; dealStart = now;
      for (const c of order) { const f = fresh.indexOf(c); if (f >= 0) { fresh.splice(f, 1); dealing.push({ card: c, delay: dealing.length * gap }); } }
    }
    // a rebuild mid-deal (a bot moved, you tapped a card) carries each flight on from where it was
    const flying = [...dealing], since = (now - dealStart) / 1000;
    const hand = $('ruHand'); hand.innerHTML = '';
    const pending = [...inStage];  // a staged card leaves the hand once (duplicates stay)
    for (const card of order) {
      const k = pending.indexOf(card);
      if (k >= 0) { pending.splice(k, 1); continue; }
      const b = ctx.el('button', 'card-btn' + (sel.includes(card) ? ' ok' : '') + (canPick ? '' : ' idle'));
      b.dataset.card = card;
      b.append(face(card));
      const f = flying.findIndex((d) => d.card === card);
      if (f >= 0) {
        const left = flying.splice(f, 1)[0].delay - since;  // negative: already part-way through the .4s flight
        if (left > -0.4) { b.classList.add('dealt'); b.style.setProperty('--deal', `${left.toFixed(3)}s`); }
      }
      b.setAttribute('aria-disabled', String(!canPick));  // not disabled: you can rearrange the hand any time
      b.addEventListener('pointerdown', (e) => startDrag(e, card, b));
      b.onclick = () => {
        if (b.skipClick) { b.skipClick = false; return; }
        if (!canPick) return;
        sel = sel.includes(card) ? sel.filter((x) => x !== card) : [...sel, card];
        ctx.rerender();
      };
      hand.append(b);
    }
  }

  function renderButtons(r, me, myTurn) {
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
      row.append(dot, ctx.el('span', 'grow', `${name(i)}${i === me ? ' (you)' : ''} · 🎴${r.counts[i]}${r.down[i] ? ' ✅' : ''}`), ctx.el('b', '', String(v)));
      sc.append(row);
    });
  }

  function unmount() { drag?.ghost?.remove(); drag = null; shown = shownNo = null; shownTop = undefined; dealing = []; meldCards = []; shownCounts = null; }

  return { mount, render, unmount };
})();
