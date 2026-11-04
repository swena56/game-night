// Liar's Dice: the current bid up top, your hidden dice, then a bid picker (how many, which face) with
// Liar! and Exact buttons. The last showdown stays on screen with everyone's dice until the next one.
UI.liars = (() => {
  let S, ctx, qty = 1, face = 2, bidKey = '', seenShow = null, rolled = -1, reviewOpen = false, revealEnd = 0;
  const $ = (id) => document.getElementById(id);
  const PIPS = Dice.PIPS;
  const say = (q, f) => (q === 1 ? `one ${f}` : `${q} ${f}s`);

  const die = (value, cls = '', tag = 'span') => Dice.die(value, cls, tag);

  function mount(main, side) {
    qty = 1; face = 2; bidKey = ''; seenShow = null; rolled = -1;
    main.innerHTML = `<div class="liar">
      <div id="lrBid" class="liar-bid"></div>
      <div class="liar-label">Your dice</div>
      <div id="lrMine" class="ya-dice liar-mine"></div>
      <div id="lrPick" class="liar-pick">
        <div class="liar-qty"><button id="lrLess" aria-label="Fewer">−</button><b id="lrQty"></b><span>×</span><button id="lrMore" aria-label="More">+</button></div>
        <div id="lrFaces" class="liar-faces"></div>
        <div id="lrOdds" class="hint"></div>
        <div class="row liar-actions"><button id="lrGo" class="primary big">Bid</button><button id="lrLiar" class="big danger">🤥 Liar!</button><button id="lrExact" class="big">🎯 Exact</button></div>
      </div>
      <div id="lrShow" class="liar-show" hidden></div></div>`;
    side.innerHTML = '<div class="panel"><h3>Cups</h3><div id="lrCups"></div><h3>Bids this round</h3><div id="lrBids" class="liar-bids"></div></div>';
    $('lrLess').onclick = () => { qty = Math.max(1, qty - 1); paint(); };
    $('lrMore').onclick = () => { qty = Math.min(S.liars.total, qty + 1); paint(); };
    $('lrGo').onclick = () => ctx.quiet(ctx.act('bid', { qty, face }));
    $('lrLiar').onclick = () => ctx.quiet(ctx.act('liar', {}));
    $('lrExact').onclick = () => ctx.quiet(ctx.act('exact', {}));
  }

  const legal = (q, f) => {
    const l = S.liars;
    if (l.palifico && l.bid) return f === l.bid[1] && q > l.bid[0] && q <= l.total;  // palifico: same face, more dice
    return f >= l.low && f <= 6 && q >= 1 && q <= l.total && (!l.bid || q > l.bid[0] || (q === l.bid[0] && f > l.bid[1]));
  };

  // The smallest raise, nudged toward the face we hold most of.
  function suggest() {
    const l = S.liars, counts = {};
    for (const d of l.mine) if (d >= l.low) counts[d] = (counts[d] || 0) + 1;
    const fav = +(Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 6);
    if (!l.bid) { qty = Math.max(1, Math.round(l.total / (l.wild ? 4 : 7))); face = fav; return; }
    const [q, f] = l.bid;
    if (l.palifico) { qty = q + 1; face = f; return; }
    if (legal(q, fav)) { qty = q; face = fav; } else if (f < 6) { qty = q; face = f + 1; } else { qty = q + 1; face = fav; }
  }

  function paint() {
    const l = S.liars;
    const mine = ctx.myTurn && !!ctx.act && S.phase === 'playing' && l.mine.length > 0;
    $('lrPick').hidden = !mine;
    if (!mine) return;
    $('lrQty').textContent = qty;
    const faces = $('lrFaces'); faces.innerHTML = '';
    for (let f = l.low; f <= 6; f++) {
      const b = die(f, f === face ? 'held' : '', 'button');
      b.setAttribute('aria-label', `${f}s`);
      b.onclick = () => { face = f; if (!legal(qty, face) && l.bid) qty = l.bid[0] + (face > l.bid[1] ? 0 : 1); paint(); };
      faces.append(b);
    }
    const ok = legal(qty, face);
    $('lrGo').disabled = !ok;
    $('lrGo').textContent = ok ? `Bid ${say(qty, face)}` : l.palifico && l.bid ? `🗿 Stay on ${l.bid[1]}s, raise the count` : 'Raise the bid';
    $('lrLiar').disabled = !l.bid;
    $('lrExact').hidden = !l.exact;
    $('lrExact').disabled = !l.bid;
    const own = l.mine.filter((d) => d === face || (l.wild && d === 1)).length;
    const hidden = l.total - l.mine.length;
    const expect = own + hidden * (l.wild ? 1 / 3 : 1 / 6);
    $('lrOdds').textContent = `You hold ${own} that count as ${face}s; with ${hidden} hidden dice, about ${expect.toFixed(1)} on the table.`;
  }

  function render(s, c) {
    S = s; ctx = c;
    const l = S.liars;
    const bidBox = $('lrBid'); bidBox.innerHTML = '';
    if (l.bid) {
      const p = ctx.player(l.bid[2]);
      const who = ctx.el('span', 'liar-who', `${p?.name ?? '?'} bids`);
      who.style.color = p?.color ?? 'inherit';
      bidBox.append(who, ctx.el('b', 'liar-q', `${l.bid[0]} ×`), die(l.bid[1], 'liar-bigdie'));
    } else {
      bidBox.append(ctx.el('span', 'liar-who', `Round ${l.round} · ${l.total} dice on the table · no bid yet`));
    }

    const mine = $('lrMine'); mine.innerHTML = '';
    for (const d of l.mine) mine.append(die(d, (l.wild && d === 1 ? 'wild ' : '')));
    if (l.round !== rolled && rolled !== -1) { mine.classList.remove('dice-cup'); void mine.offsetWidth; mine.classList.add('dice-cup'); Dice.roll(mine.children, { sound: false }); }
    rolled = l.round;
    if (!l.mine.length) mine.append(ctx.el('span', 'hint', S.me.spectator || !l.seats.includes(S.me.id) ? 'Watching' : 'Out of dice — watching'));

    const key = `${l.round}|${l.bid ? l.bid.join(',') : ''}`;
    if (key !== bidKey) { bidKey = key; suggest(); }

    // the last showdown
    const sd = l.showdown, show = $('lrShow');
    show.hidden = !sd;
    const sk = sd ? JSON.stringify([sd.round, sd.caller, sd.kind]) : '';
    const fresh = sd && sk !== seenShow && seenShow !== null;
    if (sd && !fresh && performance.now() < revealEnd) { /* the cups are still lifting: leave them be */ }
    else if (sd) {
      show.innerHTML = '';
      const caller = ctx.player(sd.caller), by = ctx.player(sd.by);
      const title = sd.kind === 'liar'
        ? `🤥 ${caller?.name ?? '?'} called ${by?.name ?? '?'} on ${say(sd.bid[0], sd.bid[1])}: there were ${sd.count}.`
        : `🎯 ${caller?.name ?? '?'} called exactly ${say(sd.bid[0], sd.bid[1])}: there were ${sd.count}.`;
      show.append(ctx.el('b', '', title));
      const lost = sd.losers.map((id) => ctx.player(id)?.name ?? '?').join(', ');
      show.append(ctx.el('div', 'hint left', `Lost a die: ${lost}`));
      // a fresh call: every cup lifts in turn while the count of the bid face climbs
      const counter = ctx.el('div', 'liar-count');
      if (fresh && motionOK()) { counter.textContent = `0 of ${sd.bid[0]}`; show.append(counter); }
      const rows = [];
      for (const [pid, dice] of Object.entries(sd.hands)) {
        const p = ctx.player(pid);
        const row = ctx.el('div', 'liar-hand' + (sd.losers.includes(pid) ? ' lost' : '') + (fresh && motionOK() ? ' cupped' : ''));
        row.dataset.n = dice.filter((d) => d === sd.bid[1] || (sd.wild && d === 1)).length;
        rows.push(row);
        const name = ctx.el('span', 'liar-name', p?.name ?? '?'); name.style.color = p?.color ?? 'inherit';
        const dd = ctx.el('span', 'liar-dice');
        for (const d of dice) dd.append(die(d, d === sd.bid[1] || (sd.wild && d === 1) ? 'match' : 'dim'));
        row.append(name, dd);
        show.append(row);
      }
      if (sd.review?.length) {
        const rv = ctx.el('details', 'liar-review');
        rv.open = reviewOpen; rv.ontoggle = () => { reviewOpen = rv.open; };
        rv.append(ctx.el('summary', '', '📊 How likely was each bid?'));
        for (const b of sd.review) {
          const who = ctx.player(b.by);
          const row = ctx.el('div', 'liar-rv' + (b.held ? ' held' : ' bust'));
          const name = ctx.el('span', 'liar-name', who?.name ?? '?'); name.style.color = who?.color ?? 'inherit';
          row.append(name, ctx.el('span', '', say(b.bid[0], b.bid[1])), ctx.el('b', '', `${b.odds}%`), ctx.el('span', '', b.held ? '✓ held' : '✗ bust'));
          rv.append(row);
        }
        rv.append(ctx.el('div', 'hint left', "The odds are from each bidder's own seat: their dice, plus a fair roll for every hidden die."));
        show.append(rv);
      }
      if (fresh && motionOK()) {
        let n = 0;
        const held = sd.kind === 'liar' ? sd.count >= sd.bid[0] : sd.count === sd.bid[0];
        revealEnd = performance.now() + rows.length * 650 + 400;
        Kit.reveal(rows, 650, (row) => {
          row.classList.remove('cupped');
          n += +row.dataset.n;
          counter.textContent = `${n} of ${sd.bid[0]}`;
          counter.classList.toggle('over', n >= sd.bid[0]);
        }, { done: () => { Kit.callout(sd.kind === 'exact' ? (held ? '🎯 Spot on!' : '🎯 Missed!') : held ? '😇 Truth!' : '🤥 LIAR!', held === (sd.kind === 'exact') ? 'good' : 'bad'); ctx.sfx(held ? 'good' : 'bad'); } });
      } else if (sk !== seenShow) { show.classList.remove('flash'); void show.offsetWidth; show.classList.add('flash'); }
    }
    seenShow = sk;
    if (S.phase === 'over' && l.hands) {
      const fin = ctx.el('div', 'hint left', 'Final dice: ' + Object.entries(l.hands).map(([pid, d]) => `${ctx.player(pid)?.name ?? '?'} ${d.join(' ')}`).join(' · '));
      show.append(fin); show.hidden = false;
    }

    const cups = $('lrCups'); cups.innerHTML = '';
    for (const pid of l.seats) {
      const p = ctx.player(pid); if (!p) continue;
      const n = l.counts[pid] ?? 0;
      const row = ctx.el('div', 'seat-row' + (S.turn === pid ? ' turn' : '') + (n ? '' : ' out'));
      const dot = ctx.el('span', 'dot'); dot.style.background = p.color;
      row.append(dot, ctx.el('span', '', `${p.name}: ${n ? '🎲'.repeat(n) : 'out'}`));
      cups.append(row);
    }
    const bids = $('lrBids'); bids.innerHTML = '';
    for (const [q, f, pid] of l.bids.slice().reverse()) bids.append(ctx.el('div', '', `${ctx.player(pid)?.name ?? '?'}: ${say(q, f)}`));
    if (!l.bids.length) bids.append(ctx.el('div', 'hint left', 'None yet.'));
    paint();
  }

  const turnText = (s) => s.phase !== 'playing' ? null : s.turn === s.me.id ? (s.liars.bid ? '🤥 Raise or call!' : '🤥 Make the first bid') : null;

  return { mount, render, turnText };
})();
