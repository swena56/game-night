// Speed: your rival's hand across the top, the two centre piles in the middle, your hand at the bottom.
// Tap a card to play it; if it fits both piles it lifts, and you tap the pile you want.
UI.speed = (() => {
  let S, ctx, chosen = null, seen = -1, receivedAt = 0, tickTimer = 0, drag = null, dragged = false, streak = 0, lastMine = 0, prevTops = [];
  const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const RANKS = 'A23456789TJQK';
  const $ = (id) => document.getElementById(id);
  const fits = (c, top) => [1, 12].includes((RANKS.indexOf(c[0]) - RANKS.indexOf(top[0]) + 13) % 13);

  const face = (card, cls = '') => Cards.face(card, cls);

  function back(n, cls = '') {
    const f = ctx.el('span', `pc back ${cls}`);
    f.append(ctx.el('small', '', String(n)));
    return f;
  }

  function mount(main, side) {
    chosen = null; seen = -1; drag = null; dragged = false;
    main.innerHTML = `<div class="sp">
      <div id="spThem" class="sp-row"></div>
      <div class="sp-table"><div id="spSide0" class="sp-side"></div><button id="spPile0" class="sp-pile"></button>
        <button id="spPile1" class="sp-pile"></button><div id="spSide1" class="sp-side"></div></div>
      <div id="spNote" class="sp-note"></div>
      <div id="spHand" class="sp-row sp-hand"></div>
      <div id="spMine" class="sp-mine"></div></div>`;
    side.innerHTML = '<div class="panel"><h3>Speed</h3><div id="spScore"></div><p class="hint left">Cards fit one rank up or down, any suit. K and A wrap round. No turns!</p></div>';
    for (const k of [0, 1]) $(`spPile${k}`).onclick = () => { if (chosen) send(chosen, k); };
    tickTimer = setInterval(tick, 200);
  }

  function unmount() { clearInterval(tickTimer); drag?.ghost.remove(); drag = null; }

  // drag a card onto a pile: a floating copy follows the finger (hand re-renders can't drop it);
  // letting go over a pile plays there, anywhere else cancels. A plain tap still works as before.
  function startDrag(e, card) {
    if (!live() || e.button > 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    drag = { card, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, ghost: null };
    const move = (ev) => {
      if (!drag) return;
      if (!drag.ghost) {
        if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 10) return;
        drag.ghost = face(card, 'big-card sp-ghost');
        document.body.append(drag.ghost);
        dragged = true; chosen = null; paint();
      }
      drag.ghost.style.left = `${ev.clientX - drag.dx}px`; drag.ghost.style.top = `${ev.clientY - drag.dy}px`;
      const over = document.elementFromPoint?.(ev.clientX, ev.clientY)?.closest?.('.sp-pile');
      for (const k of [0, 1]) $(`spPile${k}`)?.classList.toggle('over', over?.id === `spPile${k}`);
    };
    const up = (ev) => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      const d = drag; drag = null;
      if (!d?.ghost) return;
      setTimeout(() => { dragged = false; }, 0);  // swallow only the click that ends this drag
      d.ghost.remove();
      for (const k of [0, 1]) $(`spPile${k}`)?.classList.remove('over');
      const over = ev.type === 'pointerup' && document.elementFromPoint?.(ev.clientX, ev.clientY)?.closest?.('.sp-pile');
      if (over && live() && S.speed.hand.includes(d.card)) send(d.card, +over.id.slice(-1)); else paint();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }

  const live = () => S?.phase === 'playing' && S.speed.stage === 'play' && S.speed.me != null && !!ctx.act;

  function send(card, pile) {
    chosen = null;
    paint();
    ctx.act('play', { card, pile }).catch((err) => { ctx.toast(err?.message || 'Too slow!'); });
  }

  function tap(card) {
    if (!live()) return;
    const sp = S.speed;
    const ok = [0, 1].filter((k) => fits(card, sp.piles[k]));
    if (!ok.length) { chosen = null; paint(); return ctx.toast("That card doesn't fit either pile."); }
    if (ok.length === 1) return send(card, ok[0]);
    chosen = chosen === card ? null : card;
    paint();
  }

  function tick() {
    if (!S?.speed || !$('spNote')) return;
    const sp = S.speed;
    const left = sp.wait == null ? 0 : Math.max(0, sp.wait - (performance.now() - receivedAt) / 1000);
    let note = '';
    if (S.phase !== 'playing') note = sp.result;
    else if (sp.stage === 'between') note = `${sp.result} Next round in ${Math.ceil(left)}…`;
    else if (sp.stuck) note = `🔄 Nobody can play — flipping in ${Math.ceil(left)}…`;
    else if (chosen) note = 'It fits both piles: tap one.';
    $('spNote').textContent = note;
  }

  function paint() {
    const sp = S.speed;
    const hand = $('spHand'); hand.innerHTML = '';
    for (const card of sp.hand) {
      const ok = live() && sp.piles.some((t) => fits(card, t));
      const b = ctx.el('button', 'card-btn' + (ok ? ' ok' : '') + (chosen === card ? ' chosen' : ''));
      b.append(face(card, 'big-card'));
      b.disabled = !live();
      b.setAttribute('aria-label', `${card[0] === 'T' ? '10' : card[0]} of ${SUIT[card[1]]}${ok ? ', playable' : ''}`);
      b.onclick = () => { if (dragged) { dragged = false; return; } tap(card); };
      b.onpointerdown = (e) => startDrag(e, card);
      if (drag?.ghost && drag.card === card) b.classList.add('lifted');
      hand.append(b);
    }
    for (const k of [0, 1]) {
      const pile = $(`spPile${k}`);
      pile.classList.toggle('target', !!chosen && fits(chosen, sp.piles[k]));
      pile.disabled = !chosen;
    }
    tick();
  }

  function render(s, c) {
    S = s; ctx = c; receivedAt = performance.now();
    const sp = S.speed, me = sp.me ?? 0, them = 1 - me;
    if (chosen && !sp.hand.includes(chosen)) chosen = null;
    const rival = ctx.player(sp.seats[them]);

    const top = $('spThem'); top.innerHTML = '';
    const tag = ctx.el('div', 'sp-who', `${rival?.name ?? '?'} · ${sp.hands[them] + sp.stock[them]} cards left`);
    tag.style.color = rival?.color ?? 'inherit';
    top.append(tag);
    for (let i = 0; i < sp.hands[them]; i++) top.append(back('', 'small'));

    for (const k of [0, 1]) {
      const pile = $(`spPile${k}`); pile.innerHTML = '';
      const fresh = sp.seq !== seen && sp.last && sp.last[2] === k;
      if (fresh && seen !== -1) {
        slap();
        // a streak: my own plays coming fast, one after another
        const now = performance.now();
        if (sp.last[0] === me) {
          streak = now - lastMine < 1800 ? streak + 1 : 1;
          lastMine = now;
          if (streak >= 3) { ctx.sfx('rise', streak); Kit.flyText(pile, `🔥 ×${streak}`, 'gold'); }
          if (streak === 6) Kit.callout('On fire!', 'gold', { ms: 1000 });
        } else if (sp.last[0] === them) {
          // the rival just beat me to a pile I could have used: a near miss flash
          if (sp.hand.some((c2) => fits(c2, prevTops[k] || ''))) { pile.classList.remove('near'); void pile.offsetWidth; pile.classList.add('near'); }
        }
      }
      pile.append(face(sp.piles[k], 'big-card' + (fresh ? ' toss' : '')));
      pile.setAttribute('aria-label', `Pile ${k + 1}: ${sp.piles[k][0] === 'T' ? '10' : sp.piles[k][0]} of ${SUIT[sp.piles[k][1]]}`);
      const sideEl = $(`spSide${k}`); sideEl.innerHTML = '';
      if (sp.side[k]) sideEl.append(back(sp.side[k], 'small'));
    }
    seen = sp.seq;
    prevTops = [...sp.piles];

    $('spMine').textContent = sp.me == null ? '' : `Your stock: ${sp.stock[me]} · ${sp.hands[me] + sp.stock[me]} cards to go`;
    const score = $('spScore'); score.innerHTML = '';
    for (const i of [0, 1]) {
      const p = ctx.player(sp.seats[i]);
      const row = ctx.el('div', 'seat-row');
      const dot = ctx.el('span', 'dot'); dot.style.background = p?.color ?? '#777';
      row.append(dot, ctx.el('span', '', `${p?.name ?? '?'}: ${sp.hands[i] + sp.stock[i]} cards` + (sp.rounds > 1 ? ` · ${sp.wins[i]} round${sp.wins[i] === 1 ? '' : 's'}` : '')));
      score.append(row);
    }
    if (sp.rounds > 1) score.append(ctx.el('div', 'hint left', `Round ${sp.round} · first to ${sp.rounds} wins`));
    paint();
  }

  const turnText = (s) => s.phase !== 'playing' ? null
    : s.speed.me == null ? '⚡ Watching Speed' : s.speed.stage === 'between' ? '⚡ Next round soon…' : '⚡ Go go go!';
  const myMove = (s) => s.phase === 'playing' && s.speed.stage === 'play' && s.speed.me != null;

  return { mount, render, unmount, turnText, myMove, ownSounds: true };
})();
