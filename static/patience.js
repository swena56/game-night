// The shared screen for the patience games (FreeCell, Solitaire): a top row (free cells or stock and
// waste, then the four foundations), the tableau columns, and a tool row. Cards are dragged (a run moves
// with the card you grab), or tapped to pick up and tapped again where they go; tapping a picked-up card
// again sends it to its best spot (home first). The server is the referee: this file only mirrors the
// rules to light up legal drops, and redraws from the state it sends back, gliding cards from where they
// were. Loaded after kit.js; each game calls Patience.screen({...}) for its UI module.
const Patience = (() => {
  const RANKS = 'A23456789TJQK', SUITS = 'SHDC';
  const rank = (c) => RANKS.indexOf(c[0]) + 1;
  const red = (c) => 'HD'.includes(c[1]);
  const fits = (card, under) => rank(card) === rank(under) - 1 && red(card) !== red(under);
  const runOk = (cards) => cards.every((c, i) => i === 0 || fits(c, cards[i - 1]));

  function screen(cfg) {
    const K = cfg.key, P = cfg.prefix, NCOL = cfg.cols;
    let S, ctx, B, view, receivedAt = 0, tickTimer = 0, lastTick = 0, busy = false;
    let sel = null, drag = null, flyFrom = null, seenCards = null, seenRound = null, seenDone = false, ro = null;
    let lastTap = { at: 0, card: null };
    const $ = (id) => document.getElementById(P + id);

    function mount(main, side) {
      sel = drag = flyFrom = seenCards = null; seenRound = null; seenDone = false; busy = false;
      main.innerHTML = `<div class="pt pt-${P}" id="${P}Root">
        <div class="pt-head"><span id="${P}Round"></span><b id="${P}Clock" class="pt-clock"></b><span id="${P}Info" class="pt-info"></span></div>
        <div class="dd-bar"><span id="${P}Bar"></span></div>
        <div class="pt-top" id="${P}Top"></div>
        <div class="pt-tab" id="${P}Tab"></div>
        <div class="pt-tools" id="${P}Tools">
          <button type="button" id="${P}Undo" title="Take back a move (free)">↩<small>Undo</small></button>
          <button type="button" id="${P}Hint" title="Show a good move (costs 1 point)">💡<small>Hint</small></button>
          <button type="button" id="${P}Auto" title="Send every card that can go home">⏫<small>Home</small></button>
          <button type="button" id="${P}Bank" title="Stop here and keep the cards you've sent home">🏳️<small>Done</small></button>
        </div>
        <div class="pt-note" id="${P}Note"></div></div>`;
      side.innerHTML = `<div class="panel"><h3>Racers</h3><div id="${P}Racers"></div><p class="hint left">Everyone plays the same deal. 1 point per card home, +10 for clearing it, +5 for clearing it first; 💡 costs a point.</p></div>`;
      $('Undo').onclick = () => send('undo');
      $('Hint').onclick = () => send('hint');
      $('Auto').onclick = () => send('auto');
      $('Bank').onclick = async () => {
        if (!live()) return;
        if (await ctx.ask('Call it a day? You keep the cards you\'ve sent home but can\'t move again this deal.', { ok: '🏳️ Done' })) send('bank');
      };
      const root = $('Root');
      root.addEventListener('pointerdown', down);
      root.addEventListener('contextmenu', (e) => { if (e.target.closest('.pc')) e.preventDefault(); });
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      ro = window.ResizeObserver ? new ResizeObserver(() => B && layout()) : null;
      ro?.observe(root);
      tickTimer = setInterval(tick, 250);
    }

    function unmount() {
      clearInterval(tickTimer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      ro?.disconnect();
      drag?.ghost.remove();
      drag = null;
    }

    const live = () => S?.phase === 'playing' && view?.stage === 'play' && view.playing && !view.done && !view.banked && !!ctx?.act;

    function send(type, extra = {}) {
      if (!live() || busy) return Promise.resolve(false);
      busy = true;
      return ctx.act(type, extra).then(() => true).catch((err) => {
        ctx.toast(err?.message || 'Not there.');
        ctx.sfx('wrong'); ctx.buzz?.(30);
        flyFrom = null;
        return false;
      }).finally(() => { busy = false; });
    }

    // -- the rules, mirrored for highlighting (games/freecell.py, games/klondike.py are the referee)

    function pile(id) {
      if (id[0] === 't') return B.t[+id.slice(1)] || [];
      if (id[0] === 'c') return B.c[+id.slice(1)] ? [B.c[+id.slice(1)]] : [];
      if (id[0] === 'f') { const s = SUITS[+id.slice(1)], n = B.f[s]; return n ? [RANKS[n - 1] + s] : []; }
      if (id === 'w') return B.waste.length ? [B.waste.at(-1)] : [];
      return [];
    }
    // the cards you'd pick up by grabbing card i of a pile, or null if it can't move from there
    function grab(id, i) {
      const cards = pile(id);
      if (id[0] === 't') {
        const run = cards.slice(i);
        if (!run.length || run.includes('??') || !runOk(run)) return null;
        return run;
      }
      if (id[0] === 'f' && !cfg.foundationBack) return null;
      if (id === 'w' || id[0] === 'f' || id[0] === 'c') return cards.length ? [cards.at(-1)] : null;
      return null;
    }
    function capacity(dst) {
      const free = B.c ? B.c.filter((x) => !x).length : 0;
      const empty = B.t.filter((col, k) => !col.length && `t${k}` !== dst).length;
      return (1 + free) * 2 ** empty;   // games/freecell.py capacity(): empty columns other than the target
    }
    function legal(src, cards, dst) {
      if (!cards || src === dst) return false;
      const c = cards[0], n = cards.length;
      if (dst[0] === 'f') return n === 1 && src[0] !== 'f' && SUITS[+dst.slice(1)] === c[1] && B.f[c[1]] === rank(c) - 1;
      if (dst[0] === 'c') return n === 1 && !B.c[+dst.slice(1)];
      if (dst[0] === 't') {
        const col = B.t[+dst.slice(1)];
        if (!col.length) return cfg.kingsOnly ? c[0] === 'K' : (!B.c || n <= capacity(dst));
        if (!fits(c, col.at(-1))) return false;
        return !B.c || n <= capacity(dst);
      }
      return false;
    }
    // where a picked-up card should go when tapped again: home, then a column with cards, then an
    // empty column, then a free cell
    function best(src, cards) {
      const order = [...SUITS].map((_, k) => `f${k}`).concat(
        B.t.map((col, k) => col.length ? `t${k}` : null).filter(Boolean),
        B.t.map((col, k) => col.length ? null : `t${k}`).filter(Boolean),
        (B.c || []).map((_, k) => `c${k}`));
      return order.find((d) => legal(src, cards, d)) || null;
    }
    const wire = (dst) => (dst[0] === 'f' ? 'f' : dst);

    function moveTo(src, cards, dst) {
      if (!legal(src, cards, dst)) { ctx.sfx('wrong'); ctx.buzz?.(30); return; }
      sel = null;
      ctx.sfx('card');
      send('move', { src, n: cards.length, dst: wire(dst) }).then((ok) => { if (!ok) paint(); });
      paint();
    }

    // -- pointer input

    function down(e) {
      if (e.button > 0 || !live()) return;
      const card = e.target.closest('.pc[data-pile]'), slot = e.target.closest('[data-pile]');
      if (!slot) return;
      const id = slot.dataset.pile;
      if (id === 's') { e.preventDefault(); sel = null; ctx.sfx('flip'); send('draw'); return; }
      if (!card) {      // an empty spot: drop the picked-up card here
        if (sel) moveTo(sel.src, sel.cards, id);
        return;
      }
      const cards = grab(card.dataset.pile, +card.dataset.i);
      if (!cards) {
        if (sel && card.dataset.pile !== sel.src) moveTo(sel.src, sel.cards, card.dataset.pile);
        return;
      }
      e.preventDefault();
      drag = { src: card.dataset.pile, i: +card.dataset.i, cards, x: e.clientX, y: e.clientY, id: e.pointerId, moving: false, node: card };
    }

    function move(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moving) {
        if (Math.hypot(dx, dy) < 7) return;
        startDrag();
      }
      drag.ghost.style.transform = `translate(${dx}px, ${dy}px)`;
      const g = drag.ghost.firstElementChild.getBoundingClientRect();
      const under = document.elementFromPoint(g.left + g.width / 2, g.top + Math.min(g.height / 2, 24))?.closest('[data-pile]');
      const dst = under?.closest('.pt')?.id === P + 'Root' ? (under.dataset.pile === 's' ? null : under.dataset.pile) : null;
      if (dst !== drag.over) {
        document.querySelectorAll(`#${P}Root .pt-over`).forEach((n) => n.classList.remove('pt-over', 'pt-no'));
        drag.over = dst;
        const zone = dst && pileEl(dst);
        if (zone) zone.classList.add('pt-over', legal(drag.src, drag.cards, dst) ? 'pt-yes' : 'pt-no');
      }
    }

    function startDrag() {
      drag.moving = true;
      sel = null;
      paintSel();
      const nodes = [...$('Root').querySelectorAll(`.pc[data-pile="${drag.src}"]`)].filter((n) => +n.dataset.i >= drag.i);
      const first = nodes[0].getBoundingClientRect();
      const ghost = ctx.el('div', 'pt-ghost');
      ghost.style.setProperty('--ptw', getComputedStyle($('Root')).getPropertyValue('--ptw'));
      Object.assign(ghost.style, { left: first.left + 'px', top: first.top + 'px' });
      for (const n of nodes) {
        const r = n.getBoundingClientRect(), c = n.cloneNode(true);
        c.style.left = '0px'; c.style.top = (r.top - first.top) + 'px';
        ghost.append(c);
        n.classList.add('pt-lifted');
      }
      document.body.append(ghost);
      drag.ghost = ghost;
      ctx.sfx('card');
    }

    function up(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      document.querySelectorAll(`#${P}Root .pt-over`).forEach((n) => n.classList.remove('pt-over', 'pt-yes', 'pt-no'));
      if (d.moving) {
        if (d.over && legal(d.src, d.cards, d.over)) {
          // the cards glide on from where they were dropped once the server's answer arrives
          flyFrom = new Map([...d.ghost.children].map((n) => [n.dataset.k, n.getBoundingClientRect()]));
          d.ghost.remove();
          sel = null;
          ctx.sfx('card');
          send('move', { src: d.src, n: d.cards.length, dst: wire(d.over) }).then((ok) => { if (!ok) paint(); });
          // keep them hidden at the source until the redraw, so they don't flash back
          return;
        }
        snapBack(d);
        return;
      }
      tap(d);
    }

    function cancel(e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.moving) snapBack(drag);
      drag = null;
    }

    function snapBack(d) {
      if (d.over) { ctx.sfx('wrong'); ctx.buzz?.(30); }
      const g = d.ghost;
      const done = () => { g.remove(); $('Root')?.querySelectorAll('.pt-lifted').forEach((n) => n.classList.remove('pt-lifted')); };
      if (motionOK() && g.animate) g.animate([{ transform: g.style.transform }, { transform: 'none' }], { duration: 180, easing: 'ease-out' }).onfinish = done;
      else done();
    }

    function tap(d) {
      const now = performance.now(), card = d.cards[0];
      const again = (sel && sel.src === d.src && sel.i === d.i) || (lastTap.card === card && now - lastTap.at < 350);
      lastTap = { at: now, card };
      if (again) {   // a second tap (or a double-tap): off to its best spot
        const dst = best(d.src, d.cards);
        sel = null;
        if (dst) moveTo(d.src, d.cards, dst);
        else { ctx.sfx('wrong'); paintSel(); }
        return;
      }
      if (sel && sel.src !== d.src) {     // tapped a card in another pile: put the picked-up cards there
        const target = d.src;
        if (legal(sel.src, sel.cards, target)) return moveTo(sel.src, sel.cards, target);
      }
      sel = { src: d.src, i: d.i, cards: d.cards };
      ctx.sfx('pickup');
      paintSel();
    }

    // -- drawing

    const pileEl = (id) => $('Root')?.querySelector(`.pt-slot[data-pile="${id}"]`);

    function cardNode(c, id, i, extra = '') {
      const n = c === '??' ? Cards.back('pt-card') : Cards.face(c, 'pt-card');
      if (c !== '??') n.dataset.k = c;
      n.dataset.pile = id; n.dataset.i = i;
      if (extra) n.classList.add(...extra.split(' '));
      return n;
    }

    function slot(id, cls, label = null) {
      const s = ctx.el('div', `pt-slot ${cls}`);
      s.dataset.pile = id;
      if (label) s.append(label);
      return s;
    }

    function paint() {
      if (!B) return;
      const before = Kit.snap($('Root'));
      if (flyFrom) for (const [k, r] of flyFrom) before.set(k, r);
      const visible = new Set();
      // the top row
      const top = $('Top'); top.innerHTML = '';
      top.style.gridTemplateColumns = `repeat(${NCOL}, var(--cw))`;
      cfg.drawTop(top, { B, view, slot, cardNode, Cards });
      // foundations: an empty one shows its suit
      [...SUITS].forEach((s, k) => {
        const n = B.f[s], f = slot(`f${k}`, 'pt-found' + (n === 13 ? ' full' : ''));
        if (!n) f.append(Cards.suit(s, 'pt-mark ' + (red('x' + s) ? 'red' : 'black')));
        else {
          if (n > 1) f.append(cardNode(RANKS[n - 2] + s, `f${k}`, 0, 'pt-under'));
          f.append(cardNode(RANKS[n - 1] + s, `f${k}`, 1));
        }
        top.append(f);
      });
      // the columns
      const tab = $('Tab'); tab.innerHTML = '';
      tab.style.gridTemplateColumns = `repeat(${NCOL}, var(--cw))`;
      B.t.forEach((col, k) => {
        const p = slot(`t${k}`, 'pt-col' + (col.length ? '' : ' empty'));
        if (!col.length && cfg.kingsOnly) p.append(ctx.el('span', 'pt-k', 'K'));
        col.forEach((c, i) => p.append(cardNode(c, `t${k}`, i, c === '??' ? 'down' : '')));
        tab.append(p);
      });
      layout();
      // cards turned face up since last time flip over; everything else glides from where it was
      $('Root').querySelectorAll('.pc[data-k]').forEach((n) => {
        visible.add(n.dataset.k);
        if (seenCards && !seenCards.has(n.dataset.k) && n.dataset.pile?.[0] === 't' && motionOK()) n.classList.add('flip-in');
      });
      const fresh = seenCards && [...visible].some((c) => !seenCards.has(c));
      seenCards = visible;
      Kit.glide($('Root'), before, 240);
      flyFrom = null;
      if (fresh) ctx.sfx('flip');
      paintSel();
    }

    // card spacing in the columns: as roomy as the screen allows, tighter for long columns
    function layout() {
      const root = $('Root'), tab = $('Tab');
      if (!root || !tab) return;
      const W = root.clientWidth || 360;
      const gap = Math.round(Math.max(3, Math.min(10, W * 0.012)));
      const cw = Math.floor(Math.min(cfg.maxCw || 88, (W - gap * (NCOL - 1)) / NCOL));
      const ch = cw * 1.4;
      root.style.setProperty('--ptw', cw + 'px');
      root.style.setProperty('--gap', gap + 'px');
      const tools = $('Tools').offsetHeight + $('Note').offsetHeight + 16;
      const avail = Math.max(ch * 3, window.innerHeight - tab.getBoundingClientRect().top - tools);
      let tallest = ch;
      for (const p of tab.children) {
        const cards = [...p.querySelectorAll('.pc')];
        const downs = cards.filter((n) => n.classList.contains('down')).length, ups = cards.length - downs;
        const dOff = ch * 0.13;
        let uOff = ch * 0.36;
        if (ups > 1) uOff = Math.max(ch * 0.27, Math.min(ch * 0.36, (avail - ch - downs * dOff) / (ups - 1)));
        let y = 0;
        cards.forEach((n, i) => {
          n.style.top = y + 'px';
          n.style.zIndex = i + 1;
          y += n.classList.contains('down') ? dOff : uOff;
        });
        tallest = Math.max(tallest, cards.length ? y - (cards.at(-1).classList.contains('down') ? dOff : uOff) + ch : ch);
      }
      tab.style.minHeight = Math.max(tallest, Math.min(avail, ch * 3.2)) + 'px';
    }

    function paintSel() {
      const root = $('Root');
      if (!root) return;
      root.querySelectorAll('.pt-sel, .pt-hint, .pt-target').forEach((n) => n.classList.remove('pt-sel', 'pt-hint', 'pt-target'));
      if (sel) {
        root.querySelectorAll(`.pc[data-pile="${sel.src}"]`).forEach((n) => { if (+n.dataset.i >= sel.i) n.classList.add('pt-sel'); });
        root.querySelectorAll('.pt-slot').forEach((s) => { if (legal(sel.src, sel.cards, s.dataset.pile)) s.classList.add('pt-target'); });
      }
      const h = view?.hint;
      if (h && !sel) {
        if (h.type === 'draw') pileEl('s')?.classList.add('pt-hint');
        else {
          const nodes = [...root.querySelectorAll(`.pc[data-pile="${h.src}"]`)].filter((n) => n.dataset.k);
          nodes.slice(-h.n).forEach((n) => n.classList.add('pt-hint'));
          const dst = h.dst === 'f' ? `f${SUITS.indexOf((nodes.at(-h.n)?.dataset.k || 'x?')[1])}` : h.dst;
          pileEl(dst)?.classList.add('pt-hint');
        }
      }
    }

    function tick() {
      if (!view || !$('Bar')) return;
      const left = Math.max(0, view.left - (performance.now() - receivedAt) / 1000);
      const playing = S.phase === 'playing' && view.stage === 'play';
      $('Bar').style.width = `${playing ? (left / view.secs) * 100 : 0}%`;
      $('Bar').parentElement.classList.toggle('last', playing && left < 30);
      const m = Math.floor(left / 60), s = Math.floor(left % 60);
      $('Clock').textContent = playing ? `${m}:${String(s).padStart(2, '0')}` : '';
      const sec = Math.ceil(left);
      if (playing && live() && sec <= 10 && sec > 0 && sec !== lastTick) { lastTick = sec; ctx.sfx('tickfast'); }
    }

    // a clear: the cards bounce off the foundations, as solitaire games always did
    function cascade() {
      if (!motionOK() || !document.body.animate) return;
      const low = typeof gfxLevel === 'function' && gfxLevel() === 'low';
      const found = [...$('Root').querySelectorAll('.pt-found')];
      if (!found.length) return;
      const H = window.innerHeight, total = low ? 12 : 32;
      for (let n = 0; n < total; n++) {
        const f = found[n % found.length], r = f.getBoundingClientRect();
        const c = Cards.face(RANKS[12 - Math.floor(n / found.length) % 13] + SUITS[n % 4], 'pt-fly');
        c.style.setProperty('--ptw', getComputedStyle($('Root')).getPropertyValue('--ptw'));
        Object.assign(c.style, { left: r.left + 'px', top: r.top + 'px' });
        document.body.append(c);
        const vx = (Math.random() < 0.5 ? -1 : 1) * (60 + Math.random() * 160), frames = [];
        let x = 0, y = 0, vy = -150 - Math.random() * 200;
        const floor = H - r.top - r.height;
        for (let t = 0; t < 60; t++) {
          vy += 30; x += vx / 20; y += vy / 20;
          if (y > floor) { y = floor; vy *= -0.72; }
          frames.push({ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)` });
        }
        frames.push({ transform: frames.at(-1).transform, opacity: 0 });
        const a = c.animate(frames, { duration: 2400, delay: n * 70, easing: 'linear', fill: 'both' });
        a.onfinish = () => c.remove();
        setTimeout(() => c.remove(), 2400 + n * 70 + 300);
      }
    }

    function render(s, c) {
      S = s; ctx = c; receivedAt = performance.now();
      view = S[K];
      B = view.board;
      if (seenRound !== `${view.round}:${view.deal}`) { seenCards = null; sel = null; seenDone = view.done; seenRound = `${view.round}:${view.deal}`; }
      // a stale selection (the board moved under it) is dropped
      if (sel && JSON.stringify(grab(sel.src, sel.i)) !== JSON.stringify(sel.cards)) sel = null;
      $('Round').textContent = `${cfg.icon} Deal ${view.round}/${view.rounds}`;
      $('Info').textContent = `${Object.values(B.f).reduce((a, b) => a + b, 0)}/52 home · ${view.moves} moves`;
      if (!drag) paint();
      const can = live();
      $('Undo').disabled = !can || !view.undo;
      $('Hint').disabled = !can;
      $('Auto').disabled = !can || !view.auto;
      $('Auto').classList.toggle('pt-glow', can && !!B.clear && view.auto);
      $('Bank').disabled = !can;
      $('Tools').hidden = !view.playing;
      let note = '';
      if (view.gained) note = view.gained[S.me.id] != null ? `Deal ${view.round}: +${view.gained[S.me.id]} points` : '';
      else if (view.done) note = '🏁 Cleared! Waiting for the others…';
      else if (view.banked) note = '🏳️ You called it a day. Waiting for the others…';
      else if (view.playing && B.clear && view.auto) note = '⏫ Everything is face up: tap Home to finish!';
      else if (view.playing) note = cfg.note(view);
      $('Note').textContent = note;
      if (view.done && !seenDone) {
        seenDone = true;
        Kit.callout('🏁 Cleared!', 'gold', { sound: 'fanfare' });
        cascade();
      }
      // racers
      const box = $('Racers'); box.innerHTML = '';
      for (const r of [...view.rivals].sort((a, b) => b.score - a.score || b.home - a.home)) {
        const p = ctx.player(r.id);
        if (!p) continue;
        const row = ctx.el('div', 'seat-row pt-racer');
        const dot = ctx.el('span', 'dot'); dot.style.background = p.color;
        const flag = r.done != null ? ` · 🏁 ${Math.floor(r.done / 60)}:${String(r.done % 60).padStart(2, '0')}` : r.banked ? ' · 🏳️' : '';
        row.append(dot, ctx.el('span', 'grow', `${r.id === S.me.id ? 'You' : p.name}: ${r.score} pts${flag}`));
        const bar = ctx.el('span', 'pt-prog');
        const fill = ctx.el('i'); fill.style.width = `${(r.home / 52) * 100}%`; fill.style.background = p.color;
        bar.append(fill, ctx.el('b', '', String(r.home)));
        row.append(bar);
        box.append(row);
      }
      tick();
    }

    const turnText = (s) => {
      const v = s[K];
      if (s.phase !== 'playing' || !v) return null;
      return v.stage === 'reveal' ? `${cfg.icon} Deal ${v.round} over` : !v.playing ? `${cfg.icon} Watching` : v.done ? '🏁 Cleared — waiting' : v.banked ? '🏳️ Waiting' : `${cfg.icon} Play!`;
    };
    const myMove = (s) => s.phase === 'playing' && s[K]?.stage === 'play' && s[K].playing && !s[K].done && !s[K].banked;

    // the deal's clock is drawn on the board; the top bar's countdown would only show the next bot move
    return { mount, render, unmount, turnText, myMove, ownTimer: () => true };
  }

  return { screen, rank, fits };
})();
