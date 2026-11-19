// 🔵 Bingo Bash (games/bingo.py): the ball machine (BingoKit.machine) tumbling on a canvas, the called ball slammed
// onto the screen and rolled onto a rail, 1–8 cards to tap-daub with ink splats, and a BINGO! button. A style banner
// says what wins (every line / any line first / the round's shape / the ladder stage) and outlines it on the cards;
// race rounds end on an overlay with the winning cards and the match standings. Power-ups sit in a tray by the
// button. Particles and floating points go through Fx2D on one overlay canvas; everything works with animations off.
UI.bingo = (() => {
  const K = BingoKit;
  const { COLS, GOLD, L, el, motion } = K;
  const $ = (id) => document.getElementById(id);
  const POW = { peek: ['👁️', 'Peek at the next ball'], double: ['✖️2', 'Double your next claim'], freeze: ['❄️', "Freeze a rival's BINGO! button for 2 balls"] };

  let S, ctx, root, fxCv, fxG, fx, mach, raf = 0, last = 0, onResize = null, tickT = 0, gotAt = 0;
  let cardEls = [], cardKeys = [], shownDaub = [], pending = new Set(), seenFeed = -1, seenBalls = -1, seenFree = -1;
  let seenRound = -1, picking = false, seenResult = null;

  // ---------- mount

  function mount(main, side) {
    cardEls = []; cardKeys = []; shownDaub = []; pending = new Set(); seenFeed = -1; seenBalls = -1; seenFree = -1;
    seenRound = -1; picking = false; seenResult = null;
    main.innerHTML = `<div class="bgo" id="bgoRoot">
      <div class="bgo-top">
        <div class="bgo-machine" id="bgoMachine"><canvas id="bgoCv"></canvas></div>
        <div class="bgo-callbox">
          <div class="bgo-call" id="bgoCall"><div class="bgo-ball big empty"><span>?</span></div></div>
          <div class="bgo-rail" id="bgoRail"></div>
          <div class="bgo-info"><span id="bgoInfo"></span><div class="bgo-pace"><span id="bgoPace"></span></div></div>
        </div>
      </div>
      <div class="bgo-banner" id="bgoBanner"></div>
      <div class="bgo-deal" id="bgoDeal" hidden>
        <div class="bgo-deal-h">🎫 How many cards? <small>More cards, more chances, more to watch.</small></div>
        <div class="bgo-count" id="bgoCount"></div>
        <div class="row bgo-deal-go"><span id="bgoSwap" class="muted"></span><button class="primary" id="bgoReady">Ready ✓</button></div>
      </div>
      <div class="bgo-cards" id="bgoCards"></div>
      <div class="bgo-bar">
        <div class="bgo-tray" id="bgoTray"></div>
        <button class="bgo-all" id="bgoAll" hidden></button>
        <button class="bgo-btn" id="bgoBingo"><span>B</span><span>I</span><span>N</span><span>G</span><span>O</span><b>!</b><em id="bgoLock"></em></button>
        <span class="bgo-auto muted" id="bgoAuto" hidden>🤖 Auto-daub is on: just watch the balls</span>
        <div class="bgo-pick" id="bgoPick" hidden></div>
      </div>
      <div class="bgo-over" id="bgoOver" hidden></div>
      <canvas class="bgo-fx" id="bgoFx"></canvas>
    </div>`;
    side.innerHTML = `<div class="panel bgo-side">
      <h3>🎱 Called <small class="muted" id="bgoCalledN"></small></h3>
      <div class="bgo-board" id="bgoBoard"></div>
      <div id="bgoLadder" class="bgo-ladder" hidden></div>
      <h3>🏆 Table</h3>
      <div class="bgo-table" id="bgoTable"></div>
    </div>`;
    root = $('bgoRoot');
    $('bgoReady').onclick = () => ctx.quiet(ctx.act('go'));
    $('bgoBingo').onclick = () => {
      if (S?.bingo?.stage !== 'call') return;
      ctx.quiet(ctx.act('claim'));
    };
    $('bgoAll').onclick = () => {
      const g = S?.bingo;
      if (!g || g.stage !== 'call') return;
      const n = g.called[g.called.length - 1];
      ctx.sfx('pop');
      cardEls.forEach((e, ci) => g.cards[ci]?.nums.forEach((v, i) => {
        if (v === n && !g.cards[ci].daub[i]) { pending.add(`${ci}:${i}`); pending.add(`fx${ci}:${i}`); daubCell(ci, i, e.querySelector('.bgo-grid').children[i], true); }
      }));
      ctx.act('daub_all').catch(() => { pending.clear(); ctx.rerender(); });
    };
    const board = $('bgoBoard');
    for (let c = 0; c < 5; c++) {
      const row = el('div', 'bgo-brow');
      const h = el('b', '', L[c]); h.style.background = COLS[c];
      row.append(h);
      for (let n = c * 15 + 1; n <= c * 15 + 15; n++) { const s = el('span', '', String(n)); s.id = `bgoB${n}`; row.append(s); }
      board.append(row);
    }
    fxCv = $('bgoFx');
    fxG = fxCv.getContext?.('2d') || null;
    fx = K.hasFx() ? Fx2D.create({ cap: 260 }) : null;
    mach = K.machine($('bgoCv'), $('bgoMachine'), { onTop: (gold) => burstAt($('bgoMachine'), gold, 0.1) });
    sizeFx();
    onResize = () => sizeFx();
    window.addEventListener('resize', onResize);
    kick();
    tickT = setInterval(() => { if (S?.bingo && root) renderInfo(S.bingo); }, 500);
  }

  function sizeFx() {
    if (fxCv && K.hasFx()) Fx2D.fit(fxCv, window.innerWidth || 360, window.innerHeight || 640);
  }

  // ---------- the animation loop: the machine tumbles while motion is on; Fx2D draws only while busy

  function kick() { if (!raf && motion()) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function frame(t) {
    raf = 0;
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016); last = t;
    if (!root?.isConnected) return;
    mach?.frame(dt);
    if (fx && fxG) {
      const busy = fx.step(dt);
      fxG.setTransform(1, 0, 0, 1, 0, 0);
      fxG.clearRect(0, 0, fxCv.width, fxCv.height);
      if (busy) { fx.begin(fxG); fx.draw(fxG); fx.end(fxG); }
    }
    if (motion()) raf = requestAnimationFrame(frame);
  }
  function burstAt(e, gold, fy = 0.5) {
    if (!fx) return;
    const [x, y, w] = K.rectPx(e, fy);
    fx.ring(x, y, { r0: w * 0.1, r1: w * 0.6, color: gold ? GOLD : '#fff', width: 4, life: 0.5 });
    fx.spark(x, y, gold ? 18 : 8, { color: gold ? GOLD : '#cfe1ff', speed: [w * 0.6, w * 1.8], size: [3, 6] });
  }

  // ---------- render

  function render(s, c) {
    S = s; ctx = c;
    const g = S.bingo;
    if (!g || !root) return;
    const me = ctx.player(S.me.id);
    root.style.setProperty('--ink', me?.color || '#ef476f');
    root.classList.toggle('dealing', g.stage === 'deal');
    gotAt = performance.now();
    if (g.round !== seenRound) {  // a new race round: fresh cards and balls
      if (seenRound >= 0) { cardKeys = []; cardEls.forEach((e) => e.remove()); cardEls = []; shownDaub = []; pending.clear(); seenBalls = -1; }
      seenRound = g.round;
    }
    renderCalls(g);
    renderInfo(g);
    renderBanner(g);
    renderDeal(g);
    renderCards(g);
    renderBar(g);
    renderSide(g);
    renderFeed(g);
    renderOver(g);
    kick();
  }

  function renderCalls(g) {
    const k = g.called.length, gold = new Set(g.golden);
    if (k !== seenBalls) {
      const fresh = seenBalls >= 0 && k === seenBalls + 1;
      const call = $('bgoCall');
      call.textContent = '';
      if (k) {
        const n = g.called[k - 1], isGold = gold.has(k - 1);
        call.append(K.ballEl(n, `big${fresh && motion() ? ' slam' : ''}`, isGold));
        if (fresh) {
          mach?.launch(n, isGold);
          ctx.sfx(isGold ? 'chip' : 'drop');
          if (isGold && fx) { fx.flash(GOLD, 0.25, 500); burstAt(call, true); }
        }
      } else call.append(Object.assign(el('div', 'bgo-ball big empty'), { innerHTML: '<span>?</span>' }));
      seenBalls = k;
    }
    const rail = $('bgoRail'), peekKey = `${k}:${g.peek ?? ''}`;
    if (rail.dataset.k !== peekKey) {
      const fresh = rail.dataset.k && +rail.dataset.k.split(':')[0] === k - 1;
      rail.dataset.k = peekKey;
      rail.textContent = '';
      for (let i = Math.max(0, k - 6); i < k - 1; i++) rail.prepend(K.ballEl(g.called[i], fresh && motion() ? 'roll' : '', gold.has(i)));
      if (g.peek) {  // 👁️ the next ball, for my eyes only
        const p = K.ballEl(g.peek, 'peek');
        p.title = `Next ball: ${K.name(g.peek)}`;
        p.append(el('em', '', '👁️'));
        rail.prepend(p);
      }
    }
  }

  // the countdown line; ticks between server updates from the time this view arrived
  function renderInfo(g) {
    const info = $('bgoInfo'), pace = $('bgoPace'), k = g.called.length, gone = (performance.now() - gotAt) / 1000;
    const left = (v) => Math.max(0, Math.ceil(v - gone));
    if (g.stage === 'deal') {
      info.textContent = g.next != null ? `Balls start in ${left(g.next)}s` : 'Pick your cards';
      pace.style.width = '0';
    } else if (g.window) {
      info.textContent = `🔵 BINGO! called: checking… ${left(g.window.left)}s`;
      pace.style.width = '100%';
    } else if (g.stage === 'between') {
      info.textContent = g.next != null ? `Next round in ${left(g.next)}s` : '';
      pace.style.width = '100%';
    } else if (g.endIn != null) {
      info.textContent = `🔚 Final claims! ${left(g.endIn)}s`;
      pace.style.width = '100%';
    } else {
      info.textContent = g.style === 'bash' ? `Ball ${k} of ${g.cap}` : `Ball ${k}`;
      pace.style.width = `${(100 * k) / (g.style === 'bash' ? g.cap : 75)}%`;
    }
  }

  // what wins right now, with a little picture of it
  function renderBanner(g) {
    const b = $('bgoBanner'), t = g.target;
    const key = `${g.style}|${g.round}|${g.lstage}|${t.name}`;
    if (b.dataset.k === key) return;
    const changed = !!b.dataset.k;
    b.dataset.k = key;
    b.textContent = '';
    b.className = `bgo-banner s-${g.style}`;
    const cells = t.masks?.[0] || (g.style === 'bash' ? [0, 1, 2, 3, 4, 2, 7, 12, 17, 22] : []);
    b.append(K.miniShape(t.kind === 'line' || t.kind === 'two' ? [10, 11, 12, 13, 14, ...(t.kind === 'two' ? [0, 1, 2, 3, 4] : [])] : cells));
    const txt = el('div', 'bgo-goal');
    txt.append(el('b', '', g.style === 'bash' ? '🎉 Bash: every line scores' : g.style === 'ladder' ? `📈 Stage ${g.lstage + 1}/4: ${t.name}` : t.goal));
    const sub = g.style === 'bash' ? 'Rows, columns, diagonals and corners, on every card. Combos ×1.5!'
      : g.style === 'ladder' ? `First claim takes ${t.prize}. Then: ${['two lines', 'four corners', 'blackout', '—'][g.lstage]}`
        : `Round ${g.round}${g.round > g.rounds ? ' · sudden death!' : ` of ${g.rounds}`}`;
    const extras = [g.power && '⭐ power-ups', g.sleepers && '💤 sleepers', g.penalty !== 'off' && '⛔ false-claim penalty'].filter(Boolean);
    txt.append(el('small', '', sub + (extras.length ? ` · ${extras.join(' · ')}` : '')));
    b.append(txt);
    if (changed && motion()) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
  }

  function renderDeal(g) {
    const deal = $('bgoDeal');
    const mine = !!g.cards;
    deal.hidden = g.stage !== 'deal' || !mine;
    if (deal.hidden) return;
    const count = $('bgoCount');
    if (count.childElementCount !== g.maxcards) {
      count.textContent = '';
      count.style.setProperty('--n', Math.min(g.maxcards, 4));
      for (let n = 1; n <= g.maxcards; n++) {
        const b = el('button', 'bgo-n');
        b.dataset.n = n;
        b.innerHTML = `<span class="bgo-mini">${'<i></i>'.repeat(n)}</span><b>${n}</b>`;
        b.onclick = () => { if (S?.bingo?.stage === 'deal') ctx.quiet(ctx.act('cards', { n })); };
        count.append(b);
      }
    }
    for (const b of count.children) b.classList.toggle('on', +b.dataset.n === g.cards.length);
    $('bgoReady').disabled = !!g.ready;
    $('bgoReady').textContent = g.ready ? 'Waiting for the others…' : 'Ready ✓';
    $('bgoSwap').textContent = g.rerolls > 0 ? '🔄 Swap a card for fresh numbers (once)' : '';
  }

  function buildCard(ci, card, isNew, spin, mini) {
    const box = el('div', `bgo-card${isNew && motion() ? ' deal-in' : ''}${spin && motion() ? ' spin' : ''}`);
    box.style.setProperty('--i', ci);
    const head = el('div', 'bgo-head');
    [...L].forEach((ch, i) => { const h = el('b', '', ch); h.style.background = COLS[i]; head.append(h); });
    const sw = el('button', 'bgo-swap', mini ? '🔄' : '🔄 Swap');
    sw.title = 'Swap this card';
    sw.onclick = () => ctx.quiet(ctx.act('reroll', { card: ci }));
    head.append(sw);
    const grid = el('div', 'bgo-grid');
    const stars = new Set(card.stars);
    card.nums.forEach((n, i) => {
      const b = el('button', 'bgo-cell');
      b.dataset.i = i;
      if (!n) { b.classList.add('free'); b.innerHTML = '<span>★<small>FREE</small></span>'; }
      else b.append(el('span', '', String(n)));
      if (stars.has(i) && n) b.append(el('em', 'bgo-star', '⭐'));
      b.onclick = () => tap(ci, i, b);
      grid.append(b);
    });
    grid.append(K.linesSvg());
    const nearCallout = el('div', 'bgo-near-callout'); nearCallout.hidden = true;
    box.append(head, nearCallout, grid, el('div', 'bgo-word'));
    return box;
  }

  function renderCards(g) {
    const wrap = $('bgoCards');
    const cards = g.cards || [];
    const mini = cards.length >= 5;
    wrap.dataset.n = cards.length;
    wrap.classList.toggle('mini', mini);
    wrap.hidden = !cards.length;
    const called = new Set(g.called);
    const target = new Set(g.style === 'hunt' || ['corners', 'blackout'].includes(g.target.kind) ? g.target.masks.flat() : []);
    while (cardEls.length > cards.length) { cardEls.pop().remove(); cardKeys.pop(); shownDaub.pop(); }
    cards.forEach((card, ci) => {
      const key = `${card.nums.join(',')}|${mini}`;
      if (cardKeys[ci] !== key) {
        const sameNums = cardKeys[ci]?.split('|')[0] === card.nums.join(',');
        const e = buildCard(ci, card, cardKeys[ci] == null && g.stage === 'deal', cardKeys[ci] != null && !sameNums, mini);
        if (cardEls[ci]) cardEls[ci].replaceWith(e); else wrap.append(e);
        cardEls[ci] = e; cardKeys[ci] = key; shownDaub[ci] = card.daub.slice();
      }
      const e = cardEls[ci], cells = e.querySelector('.bgo-grid').children, near = new Set(card.near);
      e.querySelector('.bgo-swap').hidden = !(g.stage === 'deal' && g.rerolls > 0);
      const names = [...new Set((card.nearPatterns || []).map((x) => x.name))];
      const callout = e.querySelector('.bgo-near-callout');
      callout.hidden = !names.length || g.stage !== 'call';
      callout.textContent = names.length
        ? `🔥 One daub away: ${names.slice(0, 2).join(', ')}${names.length > 2 ? ` +${names.length - 2} more` : ''}` : '';
      e.classList.toggle('hot', names.length > 0 && g.stage === 'call');
      for (let i = 0; i < 25; i++) {
        const b = cells[i], n = card.nums[i], d = card.daub[i] || pending.has(`${ci}:${i}`);
        if (card.daub[i]) pending.delete(`${ci}:${i}`);
        b.classList.toggle('called', !d && !!n && g.assist && called.has(n));
        b.classList.toggle('near', !d && near.has(i) && g.stage === 'call');
        b.classList.toggle('tgt', target.has(i) && g.target.kind !== 'blackout');
        if (d && n && !b.classList.contains('d')) {
          daubCell(ci, i, b, !shownDaub[ci][i] && !pending.has(`fx${ci}:${i}`), mini);
        } else if (!d && b.classList.contains('d')) {
          b.classList.remove('d'); b.querySelector('svg')?.remove();
        }
      }
      shownDaub[ci] = card.daub.slice();
      K.drawLines(e.querySelector('.bgo-lines'), card.got.filter((k) => !k.startsWith('s:')), { slept: card.slept.filter((k) => !k.startsWith('s:')) });
      e.classList.toggle('gold', card.got.includes('all'));
    });
  }

  function daubCell(ci, i, b, animate, mini) {
    if (!b || b.classList.contains('d')) return;
    b.classList.add('d');
    b.insertAdjacentHTML('beforeend', K.splat(ci * 31 + i * 7 + 3, !mini));
    if (animate && motion()) {
      b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
      if (fx) {
        const [x, y, w] = K.rectPx(b);
        const ink = getComputedStyle(root).getPropertyValue('--ink').trim() || '#ef476f';
        fx.splat(x, y, mini ? 3 : 5, { color: ink, speed: [w * 1.2, w * 3], size: [2, 5] });
        kick();
      }
    }
  }

  function tap(ci, i, b) {
    const g = S?.bingo;
    if (!g || g.stage !== 'call' || g.auto || !g.cards) return;
    const card = g.cards[ci], n = card.nums[i];
    if (!n || card.daub[i] || pending.has(`${ci}:${i}`)) return;
    if (!g.called.includes(n) && !(g.free > 0)) {   // not called: a little shake, no request
      b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope');
      ctx.sfx('wrong');
      return;
    }
    pending.add(`${ci}:${i}`);
    pending.add(`fx${ci}:${i}`);
    daubCell(ci, i, b, true, g.cards.length >= 5);
    ctx.sfx('pop');
    if (card.stars.includes(i)) coinFly(b);
    ctx.act('daub', { card: ci, cell: i })
      .catch(() => { pending.delete(`${ci}:${i}`); b.classList.remove('d', 'pop'); b.querySelector('svg')?.remove(); })
      .finally(() => setTimeout(() => pending.delete(`fx${ci}:${i}`), 2000));
  }

  function coinFly(from) {
    const to = $('bgoTray');
    if (!motion() || !from.animate) return;
    const a = from.getBoundingClientRect(), z = (to.childElementCount ? to : $('bgoBingo')).getBoundingClientRect();
    const coin = el('div', 'bgo-coin', '⭐');
    coin.style.left = `${a.left + a.width / 2}px`; coin.style.top = `${a.top + a.height / 2}px`;
    root.append(coin);
    coin.animate([
      { transform: 'translate(-50%,-50%) scale(.6)', opacity: 1 },
      { transform: `translate(calc(-50% + ${(z.left - a.left) / 2}px), calc(-50% + ${(z.top - a.top) / 2 - 80}px)) scale(1.8)`, opacity: 1, offset: 0.45 },
      { transform: `translate(calc(-50% + ${z.left + z.width / 2 - a.left - a.width / 2}px), calc(-50% + ${z.top + z.height / 2 - a.top - a.height / 2}px)) scale(.8)`, opacity: 0.9 },
    ], { duration: 900, easing: 'cubic-bezier(.3,.1,.3,1)' }).onfinish = () => coin.remove();
    if (fx) { const [x, y] = K.rectPx(from); fx.spark(x, y, 12, { color: GOLD, speed: [80, 260], size: [3, 6] }); }
  }

  function renderBar(g) {
    const btn = $('bgoBingo'), mine = !!g.cards, playing = g.stage === 'call';
    btn.hidden = !mine || g.auto || g.stage === 'deal';
    $('bgoAuto').hidden = !(mine && g.auto && g.stage !== 'deal');
    const lock = g.frozen ? `❄️${g.frozen}` : g.locked ? `⛔${g.locked}` : '';
    btn.disabled = !playing || !!lock || !!g.window?.who.includes(S.me.id);
    btn.classList.toggle('hot', !!g.can && !lock);
    btn.classList.toggle('frozen', !!g.frozen);
    btn.classList.toggle('locked', !!g.locked && !g.frozen);
    $('bgoLock').textContent = lock;
    // Daub all: worth it from 3 cards up
    const all = $('bgoAll'), n = g.called[g.called.length - 1];
    const has = mine && n && g.cards.some((c) => c.nums.some((v, i) => v === n && !c.daub[i]));
    all.hidden = !mine || g.auto || !playing || g.cards.length < 3;
    all.disabled = !has;
    all.textContent = n ? `🖌️ ${K.name(n)} on all` : '🖌️ Daub all';
    // the tray: free daubs and power-ups
    const tray = $('bgoTray');
    const items = [];
    if (mine && g.free > 0 && !g.auto) items.push(['free', '🪄', g.free, 'Wild daub: tap any number on your cards']);
    if (mine && g.power) for (const k of ['peek', 'double', 'freeze']) if (g.pw?.[k]) items.push([k, POW[k][0], g.pw[k], POW[k][1]]);
    if (mine && g.double) items.push(['on', '✖️2', 0, 'Your next claim is doubled']);
    const sig = items.map((x) => x.join(':')).join();
    if (tray.dataset.k !== sig) {
      tray.dataset.k = sig;
      tray.textContent = '';
      for (const [k, icon, cnt, tip] of items) {
        const b = el('button', `bgo-pw pw-${k}`);
        b.title = tip;
        b.append(el('span', '', icon));
        if (cnt > 1) b.append(el('i', '', String(cnt)));
        if (k === 'free' || k === 'on') b.disabled = k === 'on';
        b.onclick = () => usePower(k);
        if (k === 'free') b.onclick = () => ctx.toast('🪄 Wild daub: tap any number on your cards, called or not.');
        tray.append(b);
      }
      if (seenFree >= 0 && items.length > seenFree && motion()) { tray.classList.remove('pop'); void tray.offsetWidth; tray.classList.add('pop'); }
      seenFree = items.length;
    }
    // freeze picker
    const pick = $('bgoPick');
    pick.hidden = !picking || !playing;
    if (!pick.hidden) {
      pick.textContent = '';
      pick.append(el('b', '', '❄️ Freeze whose BINGO! button?'));
      for (const r of g.table) {
        if (r.id === S.me.id) continue;
        const p = ctx.player(r.id), b = el('button', '', `${p?.name ?? '?'} · ${g.points ? r.score : `${r.rounds} 🏁`}${r.close ? ' 🔥' : ''}`);
        b.style.borderColor = p?.color || '#888';
        b.onclick = () => { picking = false; ctx.quiet(ctx.act('power', { kind: 'freeze', target: r.id })); ctx.rerender(); };
        pick.append(b);
      }
      const x = el('button', 'ghost-btn', 'Cancel');
      x.onclick = () => { picking = false; ctx.rerender(); };
      pick.append(x);
    }
  }

  function usePower(kind) {
    const g = S?.bingo;
    if (!g || g.stage !== 'call') return;
    if (kind === 'freeze') { picking = !picking; return ctx.rerender(); }
    ctx.sfx('chip');
    ctx.quiet(ctx.act('power', { kind }));
  }

  function renderSide(g) {
    const k = g.called.length, gold = new Set(g.golden.map((i) => g.called[i])), called = new Set(g.called);
    $('bgoCalledN').textContent = g.style === 'bash' ? `${k}/${g.cap}` : `${k}`;
    for (let n = 1; n <= 75; n++) {
      const s = $(`bgoB${n}`);
      if (s) s.className = called.has(n) ? `on${gold.has(n) ? ' gold' : ''}${n === g.called[k - 1] ? ' last' : ''}` : '';
    }
    const lad = $('bgoLadder');
    lad.hidden = !g.ladder;
    if (g.ladder) {
      lad.textContent = '';
      lad.append(el('h3', '', '📈 Ladder'));
      g.ladder.forEach(([name, prize, won], i) => {
        const row = el('div', `bgo-rung${i === g.lstage && !won ? ' now' : ''}${won ? ' won' : ''}`);
        row.append(el('span', '', `${i + 1}. ${name}`), el('b', '', String(prize)));
        if (won) row.append(el('small', '', won.map((id) => ctx.player(id)?.name ?? '?').join(' & ')));
        lad.append(row);
      });
    }
    const t = $('bgoTable');
    const val = (r) => (g.points ? r.score : r.rounds);
    const rows = [...g.table].sort((a, b) => val(b) - val(a));
    t.textContent = '';
    rows.forEach((r, i) => {
      const p = ctx.player(r.id), row = el('div', `bgo-row${r.id === S.me.id ? ' me' : ''}`);
      row.dataset.id = r.id;
      const dot = el('span', 'bgo-dot'); dot.style.background = p?.color || '#888';
      const name = el('span', 'bgo-name', p?.name ?? '?');
      const bits = el('span', 'bgo-bits', `🎫${r.cards}${r.close && g.stage === 'call' ? ' 🔥' : ''}${r.frozen ? ' ❄️' : ''}${g.stage === 'deal' && r.ready ? ' ✓' : ''}${g.window?.who.includes(r.id) ? ' 🔵' : ''}`);
      const sc = el('b', 'bgo-score', g.points ? String(r.score) : `${r.rounds} 🏁`);
      const bg = el('small', 'bgo-bcount', r.bingos ? `${r.bingos}🎉` : '');
      row.append(el('span', 'bgo-rank', String(i + 1)), dot, name, bits, bg, sc);
      t.append(row);
    });
  }

  // ---------- bingo celebrations, driven by the server's claim feed

  function renderFeed(g) {
    const feed = g.feed || [];
    const top = feed.length ? feed[feed.length - 1].id : 0;
    if (seenFeed < 0) { seenFeed = top; return; }
    for (const ev of feed) {
      if (ev.id <= seenFeed) continue;
      if (ev.pid === S.me.id && g.cards) celebrate(ev, g);
      else bump(ev.pid);
    }
    seenFeed = Math.max(seenFeed, top);
  }

  function bump(pid) {
    const row = [...($('bgoTable')?.children || [])].find((r) => r.dataset.id === pid);
    if (row && motion()) { row.classList.remove('bump'); void row.offsetWidth; row.classList.add('bump'); }
  }

  function celebrate(ev, g) {
    const byCard = {};
    for (const p of ev.parts) (byCard[p.card] ||= []).push(p.key);
    const combo = ev.parts.length >= 2 && g.style === 'bash', blackout = ev.name === 'BLACKOUT';
    if (!combo && !blackout) ctx.sfx('good');
    for (const [ci, keys] of Object.entries(byCard)) {
      const e = cardEls[+ci], card = g.cards[+ci];
      if (!e || !card) continue;
      const shape = keys.find((k) => k.startsWith('s:'));
      const cells = shape ? (g.target.masks.find((m) => m.every((c) => card.daub[c])) || []) : [];
      K.drawLines(e.querySelector('.bgo-lines'), card.got.filter((k) => !k.startsWith('s:')), { fresh: keys, slept: card.slept.filter((k) => !k.startsWith('s:')), cells });
      K.wordPop(e.querySelector('.bgo-word'), { combo, black: blackout, top: blackout ? 'BLACKOUT' : combo ? ev.name.split(' ')[0] : '' });
      if (fx && motion()) {
        K.confettiAt(fx, e, combo ? 40 : 24);
        const [x, y, w] = K.rectPx(e);
        fx.text(x, y - w * 0.3, g.points ? `+${ev.pts}` : '🏁 +1', { color: GOLD, size: Math.max(22, w * 0.16), big: combo ? 1.4 : 1 });
        if (combo) fx.shake(8);
      }
    }
    if (motion()) {
      root.classList.remove('bgo-shake'); void root.offsetWidth; root.classList.add('bgo-shake');
      if (combo || blackout || !g.points) ctx.confetti();
      if (blackout && fx) for (let i = 0; i < 6; i++) setTimeout(() => {
        const W = fxCv.width, H = fxCv.height;
        fx.burst(W * (0.15 + Math.random() * 0.7), H * (0.15 + Math.random() * 0.4), 30, { colors: [GOLD, '#fff', COLS[i % 5]], speed: [120, 420], gravity: 260, size: [3, 6], life: [0.9, 1.5] });
        kick();
      }, i * 260);
    }
    kick();
  }

  // race styles: who won the round, their winning card(s), the match so far
  function renderOver(g) {
    const box = $('bgoOver');
    const res = g.stage === 'between' ? g.result : null;
    box.hidden = !res;
    if (!res) { seenResult = null; return; }
    const key = `${res.round}`;
    if (seenResult === key) return;
    seenResult = key;
    box.textContent = '';
    const panel = el('div', 'bgo-over-in');
    const names = res.winners.map((w) => ctx.player(w.pid)?.name ?? '?');
    panel.append(el('h2', '', `🏁 Round ${res.round}: ${names.join(' & ')}!`), el('p', 'muted', `${res.target} after ${g.called.length} balls`));
    const cards = el('div', 'bgo-over-cards');
    for (const w of res.winners.slice(0, 3)) {
      const c = el('div', 'bgo-card won');
      const head = el('div', 'bgo-head');
      [...L].forEach((ch, i) => { const h = el('b', '', ch); h.style.background = COLS[i]; head.append(h); });
      const grid = el('div', 'bgo-grid');
      w.nums.forEach((n, i) => {
        const b = el('div', `bgo-cell${n ? '' : ' free'}${w.daub[i] && n ? ' d' : ''}`);
        if (n) b.append(el('span', '', String(n))); else b.innerHTML = '<span>★</span>';
        if (w.daub[i] && n) b.insertAdjacentHTML('beforeend', K.splat(i * 7 + 3, false));
        b.style.setProperty('--ink', ctx.player(w.pid)?.color || '#ef476f');
        grid.append(b);
      });
      const svg = K.linesSvg();
      grid.append(svg);
      const shape = w.keys.find((k) => k.startsWith('s:'));
      K.drawLines(svg, w.keys.filter((k) => !k.startsWith('s:')), { fresh: w.keys, cells: shape ? (res.masks.find((m) => m.every((i) => w.daub[i])) || []) : [] });
      c.append(el('div', 'bgo-over-name', `${ctx.player(w.pid)?.name ?? '?'}`), head, grid);
      cards.append(c);
    }
    panel.append(cards);
    const st = el('div', 'bgo-over-st');
    if (typeof standingsCard === 'function') {
      const rows = [...g.table].sort((a, b) => b.rounds - a.rounds).map((r, i) => ({ id: r.id, total: r.rounds, gain: res.winners.some((w) => w.pid === r.id) ? 1 : 0, rank: i + 1, was: i + 1 }));
      try { standingsCard(st, rows, { title: `Match: best of ${g.rounds}`, unit: '🏁' }); } catch { st.textContent = ''; }
    }
    panel.append(st);
    box.append(panel);
    if (motion()) { box.classList.remove('in'); void box.offsetWidth; box.classList.add('in'); }
  }

  // ---------- room hooks

  function turnText(s) {
    const g = s.bingo;
    if (!g) return null;
    if (g.stage === 'deal') return g.cards && !g.ready ? '🎫 Pick your cards' : '🎫 Dealing cards…';
    if (g.stage === 'between') return `🏁 Round ${g.round} over`;
    if (g.window) return '🔵 BINGO! called — checking…';
    const n = g.called[g.called.length - 1];
    if (g.endIn != null) return '🔚 Final claims! Press BINGO! now';
    return n ? `🎱 ${K.name(n)} · ball ${g.called.length}${g.style === 'bash' ? `/${g.cap}` : ''}` : '🎱 Eyes down…';
  }
  function myMove(s) {
    const g = s.bingo;
    return !!g?.cards && (g.stage === 'call' || (g.stage === 'deal' && !g.ready));
  }
  function unmount() {
    cancelAnimationFrame(raf); raf = 0;
    clearInterval(tickT);
    mach?.stop(); mach = null;
    if (onResize) window.removeEventListener('resize', onResize);
    root = null;
  }

  return { mount, render, unmount, turnText, myMove };
})();
