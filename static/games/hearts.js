// Hearts: the players sit round a felt table (you at the bottom) and each card of the trick is played in
// front of whoever played it. Your hand fans out below. In the passing stage tap three cards and send
// them (an arrow points at who gets them); in play only the cards you may play stand up.
UI.hearts = (() => {
  let S, ctx, chosen = [], chosenFor = '', seenLast = null, seenTrick = 0, seenBroken = null, seenHandPts = null, seenGot = '';
  const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const $ = (id) => document.getElementById(id);

  const face = (card, cls = '') => Cards.face(card, cls);

  function mount(main, side) {
    chosen = []; chosenFor = ''; seenLast = null; seenTrick = 0; seenBroken = null; seenHandPts = null; seenGot = '';
    main.innerHTML = `<div class="hh">
      <div id="hhTable" class="table hh-table"><div id="hhSeats"></div><div id="hhTrick" class="hh-trick"></div></div>
      <div id="hhNote" class="hh-note"></div>
      <div id="hhHand" class="hh-hand"></div>
      <button id="hhPass" class="primary big" hidden></button></div>`;
    side.innerHTML = '<div class="panel"><h3>Scores</h3><div id="hhScores"></div><p class="hint left">♥ = 1 point, Q♠ = 13. Lowest score wins.</p></div>';
    $('hhPass').onclick = () => {
      if (chosen.length !== 3) return;
      // the three cards slide off toward whoever gets them
      const to = document.querySelector(`.hh-seat[data-seat="${(S.hearts.me + S.hearts.pass) % S.hearts.n}"]`);
      for (const b of $('hhHand').querySelectorAll('.card-btn.ok .pc')) Kit.fly(b, to, { ms: 500, scale: 0.4 });
      ctx.sfx('deal');
      ctx.quiet(ctx.act('pass', { cards: chosen.slice() }));
    };
  }

  const name = (i) => ctx.player(S.hearts.seats[i])?.name ?? '?';
  // where seat i sits round the table: k steps after the bottom seat, going left, over the top and right
  function spot(i, h) {
    const k = (i - (h.me ?? 0) + h.n) % h.n, a = (k * 2 * Math.PI) / h.n;
    return { k, x: -Math.sin(a), y: Math.cos(a), deg: (k * 360) / h.n };
  }

  function render(s, c) {
    S = s; ctx = c;
    const h = S.hearts, me = h.me, n = h.n;
    const key = `${h.handNo}:${h.stage}`;
    if (key !== chosenFor) { chosen = []; chosenFor = key; }

    // everyone round the table, with the hearts they've taken this hand as little pips
    const seats = $('hhSeats'); seats.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const p = ctx.player(h.seats[i]), at = spot(i, h);
      const box = ctx.el('div', 'hh-seat' + (S.turn === h.seats[i] ? ' turn' : '') + (at.k === 0 ? ' bottom' : ''));
      box.dataset.seat = i;
      box.style.setProperty('--x', at.x.toFixed(3)); box.style.setProperty('--y', at.y.toFixed(3));
      const nm = ctx.el('b', '', i === me ? 'You' : name(i)); nm.style.color = p?.color ?? 'inherit';
      const pips = ctx.el('span', 'hh-pips');
      const t = h.taken[i];
      for (let k = 0; k < Math.min(Math.max(t, 0), 8); k++) pips.append(ctx.el('i', '', '♥'));
      if (t > 8) pips.append(ctx.el('small', '', `+${t - 8}`));
      box.append(nm, ctx.el('small', '', i === me ? `♥ ${t}` : `🎴 ${h.counts[i]} · ♥ ${t}`), pips);
      seats.append(box);
    }

    // the trick: each card in front of its player, or the last trick for a moment
    const tr = $('hhTrick'); tr.innerHTML = '';
    const showing = h.trick.length ? h.trick : (h.stage === 'play' && h.last ? h.last.cards : []);
    const fresh = seenLast !== null && h.trick.length;
    showing.forEach(([i, card], k) => {
      const at = spot(i, h);
      const slot = ctx.el('div', 'hh-slot' + (!h.trick.length && h.last?.winner === i ? ' won' : '') + (fresh && k >= seenTrick ? ' in' : ''));
      slot.style.setProperty('--x', at.x.toFixed(3)); slot.style.setProperty('--y', at.y.toFixed(3));
      slot.style.setProperty('--r', `${((i * 37) % 11) - 5}deg`);
      slot.style.zIndex = k + 1;
      slot.append(face(card));
      tr.append(slot);
    });
    if (h.stage === 'pass') {
      // an arrow from the middle of the table to whoever my three cards go to
      const to = spot(((me ?? 0) + h.pass) % n, h);
      const arrow = ctx.el('div', 'hh-arrow' + (h.myPass ? ' sent' : ''), '⬇');
      arrow.style.setProperty('--deg', `${to.deg}deg`);
      tr.append(arrow);
    } else if (!showing.length && h.stage === 'play') tr.append(ctx.el('span', 'hh-lead', S.turn === S.me.id ? 'Lead a card' : ''));

    juice(h, tr, showing);

    // note line
    const offName = { 1: 'left', [n - 1]: 'right', 2: 'across' }[h.pass];
    let note = '';
    if (h.stage === 'pass') note = h.myPass ? `Passed. Waiting for ${n - h.passed.length} more…` : `Pick 3 cards to pass ${offName} (${chosen.length}/3).`;
    else if (h.stage === 'score' && h.handPoints) note = 'This hand: ' + h.handPoints.map((v, i) => `${i === me ? 'You' : name(i)} ${v < 0 ? '−' + -v : '+' + v}`).join(' · ');
    else if (h.received) note = 'You received: ' + h.received.map((c) => (c[0] === 'T' ? '10' : c[0]) + SUIT[c[1]]).join(' ');
    else if (h.stage === 'play' && S.turn === S.me.id) note = h.broken ? 'Your turn.' : 'Your turn. Hearts not broken yet.';
    $('hhNote').textContent = note;

    // my hand, fanned; a new hand is dealt in, and the cards passed to me glow for the first trick
    const hand = $('hhHand'); hand.innerHTML = '';
    const legal = new Set(h.legal), passing = h.stage === 'pass' && !h.myPass && me != null;
    const got = new Set(h.received || []), newCards = Kit.fresh('hearts', h.hand), dealt = [];
    const gotKey = (h.received || []).join();
    const showGot = gotKey && gotKey !== seenGot;
    for (const card of h.hand) {
      const ok = passing ? true : legal.has(card);
      const b = ctx.el('button', 'card-btn' + ((passing ? chosen.includes(card) : ok && legal.size) ? ' ok' : '') + (got.has(card) ? ' got' : ''));
      b.append(face(card));
      b.disabled = !ok || (!passing && S.turn !== S.me.id);
      b.onclick = () => {
        if (passing) {
          chosen = chosen.includes(card) ? chosen.filter((x) => x !== card) : chosen.length < 3 ? [...chosen, card] : chosen;
          ctx.sfx('tick');
          return ctx.rerender();
        }
        ctx.quiet(ctx.act('play', { card }));
      };
      if (newCards?.has(card) && (newCards.size > 3 || got.has(card) || showGot)) dealt.push(b);
      hand.append(b);
    }
    Kit.fan(hand, newCards && newCards.size ? dealt : []);
    seenGot = gotKey;
    const pb = $('hhPass');
    pb.hidden = !passing;
    pb.disabled = chosen.length !== 3;
    pb.textContent = `Pass 3 ${offName ?? ''} →`;

    const sc = $('hhScores'); sc.innerHTML = '';
    h.seats.map((pid, i) => [i, h.scores[i]]).sort((a, b) => a[1] - b[1]).forEach(([i, v]) => {
      const row = ctx.el('div', 'seat-row');
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = ctx.player(h.seats[i])?.color ?? '#777';
      row.append(dot, ctx.el('span', 'grow', `${name(i)}${i === me ? ' (you)' : ''}`), ctx.el('b', '', String(v)));
      sc.append(row);
    });
    sc.append(ctx.el('div', 'hint left', `Hand ${h.handNo} · game to ${h.target}`));
  }

  // a finished trick is swept to whoever took it; the Q♠ lands with a thud; hearts breaking and
  // shooting the moon get their moment
  function juice(h, tr, showing) {
    const lastKey = h.last ? JSON.stringify(h.last.cards) : null;
    const first = seenLast === null;
    const table = $('hhTable');
    if (!first && showing.length > seenTrick && showing.some(([, c]) => c === 'QS') && !showing.slice(0, seenTrick).some(([, c]) => c === 'QS')) {
      ctx.sfx('thud'); ctx.buzz(40);
      if (motionOK()) { table.classList.remove('shake', 'dark'); void table.offsetWidth; table.classList.add('shake', 'dark'); }
    } else if (!first && showing.length > seenTrick && h.trick.length) ctx.sfx('card');
    if (!first && lastKey && lastKey !== seenLast && !h.trick.length) {
      const w = h.last.winner, target = document.querySelector(`.hh-seat[data-seat="${w}"]`) || $('hhHand');
      ctx.sfx('card');
      setTimeout(() => {
        if (!tr.isConnected) return;
        [...tr.querySelectorAll('.pc')].forEach((card, k) => Kit.fly(card, target, { ms: 420, delay: k * 50, scale: 0.4 }));
        tr.classList.add('swept');
        ctx.sfx('sweep');
        const pts = h.last.cards.reduce((t, [, c]) => t + (c[1] === 'H' ? 1 : c === 'QS' ? 13 : 0), 0);
        if (pts && target) setTimeout(() => Kit.flyText(target, `+${pts}`, 'bad'), 420);
      }, 900);
    } else tr.classList.remove('swept');
    if (seenBroken === false && h.broken) Kit.callout('💔 Hearts broken', 'bad', { ms: 1200 });
    const hp = JSON.stringify(h.handPoints || null);
    if (!first && h.handPoints && hp !== seenHandPts) {
      if (h.handPoints.filter((v) => v >= 26).length === h.n - 1) Kit.callout('🌙 Shot the moon!', 'gold', { sound: 'fanfare', ms: 2000 });
      else if (h.me != null && h.handPoints[h.me] <= 0) Kit.callout('🧼 Clean hand!', 'good', { sound: 'good', ms: 1300 });
    }
    seenHandPts = hp; seenBroken = h.broken; seenLast = lastKey; seenTrick = h.trick.length ? showing.length : 0;
  }

  const turnText = (s) => (s.phase === 'playing' && s.hearts.stage === 'pass' ? (s.hearts.myPass ? '🔁 Waiting for the others to pass…' : '🔁 Pick 3 cards to pass') : null);
  const myMove = (s) => s.phase === 'playing' && s.hearts.stage === 'pass' && !s.hearts.myPass && s.hearts.me != null;

  return { mount, render, turnText, myMove, ownSounds: true };
})();
