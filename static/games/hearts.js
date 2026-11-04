// Hearts: rivals across the top, the trick in the middle, your hand at the bottom. In the passing
// stage tap three cards and send them; in play only the cards you may play stand up.
UI.hearts = (() => {
  let S, ctx, chosen = [], chosenFor = '', seenLast = null, seenTrick = 0, seenBroken = null, seenHandPts = null;
  const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const $ = (id) => document.getElementById(id);

  const face = (card, cls = '') => Cards.face(card, cls);

  function mount(main, side) {
    chosen = []; chosenFor = ''; seenLast = null; seenTrick = 0; seenBroken = null; seenHandPts = null;
    main.innerHTML = `<div class="hh">
      <div id="hhRivals" class="hh-rivals"></div>
      <div id="hhTrick" class="hh-trick"></div>
      <div id="hhNote" class="hh-note"></div>
      <div id="hhHand" class="hh-hand"></div>
      <button id="hhPass" class="primary big" hidden></button></div>`;
    side.innerHTML = '<div class="panel"><h3>Scores</h3><div id="hhScores"></div><p class="hint left">♥ = 1 point, Q♠ = 13. Lowest score wins.</p></div>';
    $('hhPass').onclick = () => { if (chosen.length === 3) ctx.quiet(ctx.act('pass', { cards: chosen.slice() })); };
  }

  const name = (i) => ctx.player(S.hearts.seats[i])?.name ?? '?';

  function render(s, c) {
    S = s; ctx = c;
    const h = S.hearts, me = h.me, n = h.n;
    const key = `${h.handNo}:${h.stage}`;
    if (key !== chosenFor) { chosen = []; chosenFor = key; }

    // rivals in playing order after me
    const riv = $('hhRivals'); riv.innerHTML = '';
    for (let k = 1; k < n; k++) {
      const i = ((me ?? 0) + k) % n;
      const box = ctx.el('div', 'hh-rival' + (S.turn === h.seats[i] ? ' turn' : ''));
      box.dataset.seat = i;
      const p = ctx.player(h.seats[i]);
      const nm = ctx.el('b', '', name(i)); nm.style.color = p?.color ?? 'inherit';
      box.append(nm, ctx.el('small', '', `🎴 ${h.counts[i]} · ♥ ${h.taken[i]}`));
      riv.append(box);
    }

    // the trick: the cards played so far, or the last trick for a moment
    const tr = $('hhTrick'); tr.innerHTML = '';
    const showing = h.trick.length ? h.trick : (h.stage === 'play' && h.last ? h.last.cards : []);
    for (const [i, card] of showing) {
      const slot = ctx.el('div', 'hh-slot' + (!h.trick.length && h.last?.winner === i ? ' won' : ''));
      slot.append(face(card), ctx.el('small', '', i === me ? 'You' : name(i)));
      tr.append(slot);
    }
    if (!showing.length) tr.append(ctx.el('span', 'hint', h.stage === 'pass' ? 'Passing…' : h.stage === 'score' ? '' : 'Lead a card.'));

    juice(h, tr, showing);

    // note line
    const offName = { 1: 'left', [n - 1]: 'right', 2: 'across' }[h.pass];
    let note = '';
    if (h.stage === 'pass') note = h.myPass ? `Passed. Waiting for ${n - h.passed.length} more…` : `Pick 3 cards to pass ${offName} (${chosen.length}/3).`;
    else if (h.stage === 'score' && h.handPoints) note = 'This hand: ' + h.handPoints.map((v, i) => `${i === me ? 'You' : name(i)} ${v < 0 ? '−' + -v : '+' + v}`).join(' · ');
    else if (h.received) note = 'You received: ' + h.received.map((c) => (c[0] === 'T' ? '10' : c[0]) + SUIT[c[1]]).join(' ');
    else if (h.stage === 'play' && S.turn === S.me.id) note = h.broken ? 'Your turn.' : 'Your turn. Hearts not broken yet.';
    $('hhNote').textContent = note;

    // my hand
    const hand = $('hhHand'); hand.innerHTML = '';
    const legal = new Set(h.legal), passing = h.stage === 'pass' && !h.myPass && me != null;
    for (const card of h.hand) {
      const ok = passing ? true : legal.has(card);
      const b = ctx.el('button', 'card-btn' + ((passing ? chosen.includes(card) : ok && legal.size) ? ' ok' : ''));
      b.append(face(card));
      b.disabled = !ok || (!passing && S.turn !== S.me.id);
      b.onclick = () => {
        if (passing) {
          chosen = chosen.includes(card) ? chosen.filter((x) => x !== card) : chosen.length < 3 ? [...chosen, card] : chosen;
          return ctx.rerender();
        }
        ctx.quiet(ctx.act('play', { card }));
      };
      hand.append(b);
    }
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
    if (!first && showing.length > seenTrick && showing.some(([, c]) => c === 'QS') && !showing.slice(0, seenTrick).some(([, c]) => c === 'QS')) {
      ctx.sfx('thud'); ctx.buzz(40);
      if (motionOK()) { tr.classList.remove('shake'); void tr.offsetWidth; tr.classList.add('shake'); }
    } else if (!first && showing.length > seenTrick && h.trick.length) ctx.sfx('card');
    if (!first && lastKey && lastKey !== seenLast && !h.trick.length) {
      const w = h.last.winner, target = w === h.me ? $('hhHand') : document.querySelector(`.hh-rival[data-seat="${w}"]`);
      ctx.sfx('card');
      setTimeout(() => {
        if (!tr.isConnected) return;
        [...tr.querySelectorAll('.pc')].forEach((card, k) => Kit.fly(card, target, { ms: 420, delay: k * 50, scale: 0.5 }));
        tr.classList.add('swept');
        ctx.sfx('sweep');
        const pts = h.last.cards.reduce((t, [, c]) => t + (c[1] === 'H' ? 1 : c === 'QS' ? 13 : 0), 0);
        if (pts && target) setTimeout(() => Kit.flyText(target, `+${pts}`, 'bad'), 420);
      }, 900);
    } else tr.classList.remove('swept');
    if (seenBroken === false && h.broken) Kit.callout('💔 Hearts broken', 'bad', { ms: 1200 });
    const hp = JSON.stringify(h.handPoints || null);
    if (!first && h.handPoints && hp !== seenHandPts && h.handPoints.filter((v) => v >= 26).length === h.n - 1) {
      Kit.callout('🌙 Shot the moon!', 'gold', { sound: 'fanfare', ms: 2000 });
    }
    seenHandPts = hp; seenBroken = h.broken; seenLast = lastKey; seenTrick = h.trick.length ? showing.length : 0;
  }

  const turnText = (s) => (s.phase === 'playing' && s.hearts.stage === 'pass' ? (s.hearts.myPass ? '🔁 Waiting for the others to pass…' : '🔁 Pick 3 cards to pass') : null);
  const myMove = (s) => s.phase === 'playing' && s.hearts.stage === 'pass' && !s.hearts.myPass && s.hearts.me != null;

  return { mount, render, turnText, myMove, ownSounds: true };
})();
