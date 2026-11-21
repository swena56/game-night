// The 🃏 card table: one screen for the card games built on games/cardbase.py. The server describes the
// table (seats, a trick or piles in the middle, my hand, what I may tap, buttons) and this draws it:
// everyone round an oval felt (me at the bottom), the trick in front of whoever played each card, piles
// in the middle, my hand fanned below. A game's own file is just `UI.<id> = CardTable.screen('<id>')`,
// with optional hooks: { decorate(t, parts, ctx) } to add its own touches after each render.
var CardTable = window.CardTable || (() => {   // var: several games load this helper; the first copy wins
  function screen(id, hooks = {}) {
    let S, ctx, t, R = {}, keyCard = new Map(), picked = [], pickKey = '', choice = null, seenLast = null, seenTrick = 0, seenPiles = {};

    function mount(main, side) {
      picked = []; pickKey = ''; choice = null; seenLast = null; seenTrick = 0; seenPiles = {};
      main.innerHTML = `<div class="ct ct-${id}">
        <div class="table ct-table"><div class="ct-seats"></div><div class="ct-trick"></div>
          <div class="ct-mid"><div class="ct-banner"></div><div class="ct-piles"></div></div><div class="ct-corner"></div></div>
        <div class="ct-note"></div><div class="ct-rows"></div><div class="ct-hand"></div>
        <div class="ct-choice"></div><div class="ct-btns"></div></div>`;
      side.innerHTML = '<div class="panel"><h3 class="ct-st">Scores</h3><div class="ct-scores"></div><p class="hint left ct-hint"></p></div>';
      for (const k of ['table', 'seats', 'trick', 'mid', 'banner', 'piles', 'corner', 'note', 'rows', 'hand', 'choice', 'btns'])
        R[k] = main.querySelector('.ct-' + k);
      for (const k of ['st', 'scores', 'hint']) R[k] = side.querySelector('.ct-' + k);
    }

    const name = (i) => (i === t.me ? 'You' : ctx.player(t.seats[i])?.name ?? '?');
    // where seat i sits: k steps round from the bottom seat (me), going left, over the top and right
    function spot(i) {
      const k = (i - (t.me ?? 0) + t.n) % t.n, a = (k * 2 * Math.PI) / t.n;
      return { k, x: -Math.sin(a), y: Math.cos(a) };
    }
    const send = (a) => { if (!a) return; const { type, ...rest } = a; ctx.quiet(ctx.act(type, rest)); };
    const place = (node, at) => { node.style.setProperty('--x', at.x.toFixed(3)); node.style.setProperty('--y', at.y.toFixed(3)); };

    function render(s, c) {
      S = s; ctx = c; t = S[id];
      if (!t) return;
      const key = JSON.stringify([t.stage, t.hand, t.pick?.act, t.rows]);
      if (key !== pickKey) { picked = []; pickKey = key; choice = null; }
      seatsView(); middle(); handView(); buttons(); scores();
      R.note.textContent = t.note || '';
      hooks.decorate?.(t, R, ctx);
    }

    function seatsView() {
      R.seats.innerHTML = '';
      for (let i = 0; i < t.n; i++) {
        const p = ctx.player(t.seats[i]), at = spot(i), inf = t.info?.[i] || {};
        const box = ctx.el('div', 'ct-seat' + (S.turn === t.seats[i] || t.waiting?.includes(i) ? ' turn' : '') + (at.k === 0 ? ' bottom' : '') + (inf.out ? ' out' : ''));
        box.dataset.seat = i;
        place(box, at);
        box.style.setProperty('--pc', p?.color ?? '#888');
        const head = ctx.el('span', 'ct-who');
        if (p && typeof avatar === 'function') head.append(avatar(p));
        const nm = ctx.el('b', '', name(i));
        nm.style.color = p?.color ?? 'inherit';
        head.append(nm);
        if (inf.badge) head.append(ctx.el('span', 'ct-badge', inf.badge));  // a team or role mark: never cut off with a long name
        box.append(head);
        // a rival's hand as a little fan of card backs with the count on it
        if (inf.count != null && i !== t.me) {
          const backs = ctx.el('span', 'ct-backs');
          for (let k = 0; k < Math.min(3, inf.count); k++) backs.append(ctx.el('span', 'pc back'));
          backs.append(ctx.el('i', '', String(inf.count)));
          backs.title = `${inf.count} card${inf.count === 1 ? '' : 's'}`;
          box.append(backs);
        }
        if (inf.tags?.length) box.append(ctx.el('small', '', inf.tags.join(' · ')));
        if (inf.show?.length && i !== t.me) {
          const row = ctx.el('span', 'ct-show');
          for (const card of inf.show) row.append(Cards.face(card, 'tiny'));
          box.append(row);
        }
        R.seats.append(box);
      }
    }

    function middle() {
      // the trick, each card in front of whoever played it; the last trick stays up until the next lead
      R.trick.innerHTML = '';
      const trick = t.trick || [];
      const showing = trick.length ? trick : (t.stage === 'play' && t.last ? t.last.cards : []);
      const fresh = seenLast !== null && trick.length;
      showing.forEach(([i, card], k) => {
        const slot = ctx.el('div', 'ct-slot' + (!trick.length && t.last?.winner === i ? ' won' : '') + (fresh && k >= seenTrick ? ' in' : ''));
        place(slot, spot(i));
        slot.style.setProperty('--r', `${((i * 37) % 11) - 5}deg`);
        slot.style.zIndex = k + 1;
        slot.append(Cards.face(card));
        R.trick.append(slot);
      });
      if (fresh && showing.length > seenTrick) ctx.sfx('card');
      const lastKey = t.last ? JSON.stringify(t.last) : null;
      if (seenLast !== null && lastKey && lastKey !== seenLast && !trick.length) {
        const target = R.seats.querySelector(`.ct-seat[data-seat="${t.last.winner}"]`);
        setTimeout(() => {
          if (!R.trick.isConnected) return;
          [...R.trick.querySelectorAll('.pc')].forEach((card, k) => Kit.fly(card, target, { ms: 420, delay: k * 50, scale: 0.4 }));
          R.trick.classList.add('swept');
          ctx.sfx('sweep');
          // the winner's plate flares as the cards land on it
          if (target && motionOK()) { target.classList.remove('took'); void target.offsetWidth; target.classList.add('took'); }
        }, 800);
      } else R.trick.classList.remove('swept');
      seenLast = lastKey ?? seenLast ?? ''; seenTrick = trick.length;

      R.banner.textContent = t.banner || '';
      R.banner.hidden = !t.banner;
      R.piles.innerHTML = '';
      R.corner.innerHTML = '';
      R.mid.classList.toggle('with-trick', !!showing.length);
      for (const [k, pile] of (t.piles || []).entries()) {
        const box = ctx.el(pile.act ? 'button' : 'div', 'ct-pile' + (pile.act ? ' tap' : '') + (pile.glow ? ' glow' : '') + (pile.fan ? ' fan' : ''));
        const cards = pile.cards || [];
        const top = JSON.stringify(cards.slice(-1));
        const stack = ctx.el('span', 'ct-stack');
        if (!cards.length) stack.append(ctx.el('span', 'pc empty'));
        cards.forEach((card, j) => {
          const f = Cards.face(card, pile.small ? 'small' : '');
          if (hooks.previewCards) f.dataset.previewCard = card;
          if (j === cards.length - 1 && seenPiles[k] !== undefined && seenPiles[k] !== top && motionOK()) f.classList.add('toss');
          stack.append(f);
        });
        seenPiles[k] = top;
        box.append(stack);
        if (pile.count != null) box.append(ctx.el('span', 'ct-count', String(pile.count)));
        if (pile.label) box.append(ctx.el('small', '', pile.label));
        if (pile.act) box.onclick = () => { ctx.sfx('card'); send(pile.act); };
        (pile.corner ? R.corner : R.piles).append(box);
      }
      if (t.trump) {
        const tr = ctx.el('div', 'ct-trumpbox');
        if (t.trump.length > 1) tr.append(Cards.face(t.trump, 'small'));
        else tr.append(Cards.suit(t.trump, 'ct-suit ' + ('HD'.includes(t.trump) ? 'red' : 'black')));
        tr.append(ctx.el('small', '', t.trumpLabel || 'Trumps'));
        R.corner.prepend(tr);
      }
    }

    function handView() {
      // my other cards (face-up / face-down rows), then the hand
      const moves = new Map();
      for (const m of t.moves || []) if (m.card != null) (moves.get(m.card) || moves.set(m.card, []).get(m.card)).push(m);
      const pick = t.pick;
      const tappable = (key) => (pick ? (pick.from ? pick.from.includes(key) : true) : moves.has(key));
      keyCard = new Map((t.hand || []).map((c) => [c, c]));
      for (const row of t.rows || []) row.cards.forEach((c, j) => keyCard.set(row.keys ? row.keys[j] : c, c));
      const button = (card, key) => {
        const on = pick ? picked.includes(key) : choice === key;
        const can = tappable(key) && !(pick?.same && picked.length && !picked.includes(key) && card.slice(0, -1) !== pickedRank());
        const b = ctx.el('button', 'card-btn' + (on || (!pick && can) ? ' ok' : '') + (on && pick ? ' picked' : ''));
        b.append(card ? Cards.face(card) : ctx.el('span', 'pc empty'));
        b.disabled = !can;
        b.onclick = () => {
          if (pick) {
            picked = picked.includes(key) ? picked.filter((x) => x !== key) : picked.length < pick.max ? [...picked, key] : picked;
            ctx.sfx('tick');
            return ctx.rerender();
          }
          const ms = moves.get(key) || [];
          if (ms.length === 1 && !hooks.previewCards) { choice = null; return send(ms[0].a); }
          choice = choice === key ? null : key;
          ctx.rerender();
        };
        return b;
      };
      R.rows.innerHTML = '';
      for (const row of t.rows || []) {
        const line = ctx.el('div', 'ct-row');
        line.append(ctx.el('small', '', row.label || ''));
        const cards = ctx.el('div', 'ct-rowcards');
        row.cards.forEach((card, j) => cards.append(button(card, row.keys ? row.keys[j] : card)));
        line.append(cards);
        R.rows.append(line);
      }
      R.hand.innerHTML = '';
      const hand = t.hand || [];
      const fresh = Kit.fresh(id, hand), dealt = [];
      for (const card of hand) {
        const b = button(card, card);
        if (fresh?.has(card)) dealt.push(b);
        R.hand.append(b);
      }
      Kit.fan(R.hand, fresh && fresh.size ? dealt : []);
      // several moves with one card: pick which
      R.choice.innerHTML = '';
      const opts = choice != null ? moves.get(choice) || [] : [];
      const highlight = (options) => {
        const cards = new Set(options.flatMap(hooks.previewCards));
        for (const face of R.piles.querySelectorAll('[data-preview-card]')) {
          face.classList.toggle('ct-capture-preview', cards.has(face.dataset.previewCard));
        }
      };
      if (hooks.previewCards) highlight(opts);
      for (const m of opts) {
        const b = ctx.el('button', 'primary', m.label || 'Play');
        if (hooks.previewCards) {
          b.onpointerenter = b.onfocus = () => highlight([m]);
          b.onpointerleave = b.onblur = () => highlight(opts);
        }
        b.onclick = () => { choice = null; send(m.a); };
        R.choice.append(b);
      }
      if (opts.length) { const x = ctx.el('button', '', 'Cancel'); x.onclick = () => { choice = null; ctx.rerender(); }; R.choice.append(x); }
    }
    const pickedRank = () => (keyCard.get(picked[0]) || '').slice(0, -1);

    function buttons() {
      R.btns.innerHTML = '';
      const pick = t.pick;
      if (pick) {
        const b = ctx.el('button', 'primary big', `${pick.label}${pick.max > 1 ? ` (${picked.length})` : ''}`);
        b.disabled = picked.length < (pick.min ?? 1) || picked.length > pick.max;
        b.onclick = () => { const cards = picked.slice(); picked = []; ctx.sfx('card'); send({ type: pick.act, cards, ...(pick.extra || {}) }); };
        R.btns.append(b);
        // the same picked cards can go to another action (Canasta: meld them, or discard one)
        for (const alt of pick.alts || []) {
          const a = ctx.el('button', 'primary big alt', alt.label);
          a.disabled = picked.length < (alt.min ?? 1) || picked.length > (alt.max ?? pick.max);
          a.onclick = () => { const cards = picked.slice(); picked = []; ctx.sfx('card'); send({ type: alt.act, cards, ...(alt.extra || {}) }); };
          R.btns.append(a);
        }
      }
      for (const btn of t.buttons || []) {
        const b = ctx.el('button', (btn.kind || '') + (btn.big ? ' big' : ''), btn.label);
        b.onclick = () => send(btn.a);
        R.btns.append(b);
      }
    }

    function scores() {
      const sc = t.scores;
      R.st.textContent = sc?.title || 'Scores';
      Kit.scoreboard(R.scores, (sc?.rows || []).map((row) => ({
        p: ctx.player(t.seats[row.seat]), score: row.value, note: row.sub || '', me: row.seat === t.me,
        turn: S.turn === t.seats[row.seat], out: !!t.info?.[row.seat]?.out,
      })));
      R.hint.textContent = sc?.hint || '';
    }

    const turnText = (s) => (s.phase === 'playing' ? s[id]?.turnText ?? null : null);
    const myMove = (s) => s.phase === 'playing' && !!s[id]?.mine;
    return { mount, render, turnText, myMove, ownSounds: true };
  }
  return { screen };
})();
