UI.lantern = (() => {
  let S, ctx, lit = false, seenRound = null, playing = [];
  const GOODS = { 1: ['🥚', 'Eggs'], 2: ['🍋', 'Lemons'], 3: ['🧄', 'Garlic'], 4: ['🍯', 'Honey'], 5: ['🧶', 'Yarn'], 6: ['🫖', 'Teapot'], 7: ['🪁', 'Kite'],
    8: ['🏺', 'Vase'], 9: ['🪔', 'Oil lamp'], 10: ['🧭', 'Compass'], 11: ['🪞', 'Mirror'], 12: ['💍', 'Ring'], 13: ['👑', 'Crown'],
    0: ['🎁', 'Mystery lot'] };  // 0: a mystery lot, its value hidden until someone buys it
  const EVENTS = { mystery: '🎁 Mystery lot: its value stays hidden until someone buys it.',
    rain: '🌧 Rain clouds: if nobody buys this round, the whole table washes away.' };
  const goods = (v) => GOODS[v][0];

  function mount(main, side) {
    lit = false; seenRound = null; playing.forEach((f) => f()); playing = [];
    main.innerHTML = `<div class="lm">
      <div class="lm-string" aria-hidden="true">${'<i></i>'.repeat(7)}</div>
      <div class="lm-stall panel">
        <div class="lm-head"><b id="lmRound"></b><span id="lmWorth" class="lm-worth"></span></div>
        <div class="lm-lots"><div id="lmTable" class="lm-table"></div><div id="lmNext" class="lm-next"></div></div>
        <p id="lmEvent" class="lm-event" hidden></p>
      </div>
      <div id="lmRecap" class="panel lm-recap" hidden></div>
      <div class="lm-bid">
        <div id="lmTiles" class="lm-tiles"></div>
        <div class="row center"><button id="lmLamp" class="lm-lamp" aria-pressed="false">🏮 Light my lantern</button></div>
        <p id="lmWait" class="hint"></p>
      </div>
      <div id="lmLast" class="panel" hidden></div>
      <div class="panel"><h3>Tiles left</h3><table id="lmLeft" class="lm-left"></table></div>
      <div id="lmHist" class="panel lm-hist-wrap" hidden><h3>Lot by lot</h3><table id="lmHistT" class="lm-hist"></table></div>
    </div>`;
    side.innerHTML = `<div class="panel"><h3>How it works</h3>
      <ul class="rules">
        <li>Everyone plays one bid tile in secret; all bids are shown together.</li>
        <li>🏆 The <b>highest bid nobody matched</b> buys the lots on the table.</li>
        <li>🤝 Matching bids cancel out. If every bid is matched, the lot stays and the next one joins it.</li>
        <li>Each tile is used once, win or lose.</li>
        <li>🏮 Once a game, light your lantern: a winning bid counts the lots double. It burns out either way.</li>
        <li id="lmEvRule" hidden>🎁 A mystery lot hides its value until bought; 🌧 rain washes an unsold table away.</li>
      </ul>
      <p class="hint left">The small number on a tile is how many rivals still hold it: those bids could clash. ✓ means nobody does.</p>
      <p class="hint left">You can change your bid until the last player locks in.</p></div>`;
    main.querySelector('#lmLamp').onclick = () => {
      lit = !lit;
      const mine = S?.lantern?.mine;
      if (mine) ctx.quiet(ctx.act('bid', { bid: mine[0], lit }));
      else paint();
    };
  }

  const lotCard = (v, cls = '') => {
    const c = ctx.el('div', 'lm-lot ' + cls);
    c.append(ctx.el('span', 'lm-good', goods(v)), ctx.el('b', '', v ? String(v) : '?'));
    c.title = v ? `${GOODS[v][1]}: ${v} points` : 'Mystery lot: its value shows when someone buys it';
    if (!v) c.classList.add('mystery');
    return c;
  };

  function render(s, c) {
    S = s; ctx = c;
    const L = S.lantern;
    if (L.mine) lit = L.mine[1];
    if (!L.lamps[S.me.id]) lit = false;
    paint();
    paintLast(L);
    paintLeft(L);
    paintHist(L);
    paintRecap(L);
    const rule = document.getElementById('lmEvRule');
    if (rule) rule.hidden = !S.settings?.events;
  }

  function paint() {
    const L = S.lantern, me = S.me.id;
    const playing = S.phase === 'playing';
    document.getElementById('lmRound').textContent = playing ? `🏮 Lot ${L.round} of ${L.lots}` : '🌅 The market has closed';
    const worth = L.table.reduce((a, b) => a + b, 0), gift = L.table.includes(0);
    const val = worth ? `⭐${worth}${gift ? ' + 🎁' : ''}` : '🎁 ?';
    document.getElementById('lmWorth').textContent = L.table.length ? `worth ${val}` + (lit ? (worth ? ` → ⭐${worth * 2}${gift ? ' + 🎁×2' : ''} lit` : ' ×2 lit') : '') : '';
    document.querySelector('.lm-lots').hidden = !playing;
    const ev = document.getElementById('lmEvent');
    ev.hidden = !(playing && L.event);
    ev.textContent = playing && L.event ? EVENTS[L.event] : '';
    ev.className = 'lm-event ' + (L.event || '');
    const t = document.getElementById('lmTable');
    const key = L.table.join(',');
    if (t.dataset.key !== key) {
      t.dataset.key = key;
      t.replaceChildren(...L.table.map((v, i) => {
        const newest = i === L.table.length - 1;
        const card = lotCard(v, newest && motionOK() ? 'fresh' : '');
        if (newest && L.event === 'rain') card.append(ctx.el('span', 'lm-ev', '🌧'));
        return card;
      }));
    }
    const n = document.getElementById('lmNext');
    n.replaceChildren();
    if (L.next != null && playing) {
      const card = lotCard(L.next, 'small');
      if (L.nextEvent === 'rain') card.append(ctx.el('span', 'lm-ev', '🌧'));
      n.append(ctx.el('small', '', 'Next'), card);
    }
    else if (L.left && playing) n.append(ctx.el('small', '', `${L.left} more`));

    const hand = L.hands[me];
    const canPlay = playing && hand && !S.me.ghost && !S.me.spectator;
    const tiles = document.getElementById('lmTiles');
    tiles.hidden = !hand;
    tiles.style.setProperty('--n', L.lots); tiles.style.setProperty('--half', Math.ceil(L.lots / 2));
    if (hand && tiles.childElementCount !== L.lots) {
      tiles.replaceChildren(...Array.from({ length: L.lots }, (_, k) => {
        const b = ctx.el('button', 'lm-tile', String(k + 1));
        b.dataset.v = k + 1;
        b.onclick = () => ctx.quiet(ctx.act('bid', { bid: k + 1, lit }));
        return b;
      }));
    }
    // clash hints: every hand is public, so count the rivals still holding each tile
    const rivals = Object.keys(L.hands).filter((id) => id !== me && !ctx.player(id)?.eliminated && ctx.player(id));
    for (const b of tiles.children) {
      const v = +b.dataset.v, have = hand?.includes(v);
      const held = rivals.filter((id) => L.hands[id].includes(v)).length;
      b.classList.toggle('spent', !have);
      b.classList.toggle('on', !!L.mine && L.mine[0] === v);
      b.disabled = !canPlay || !have;
      let tag = b.querySelector('.lm-held');
      if (!tag) { tag = ctx.el('small', 'lm-held'); tag.setAttribute('aria-hidden', 'true'); b.append(tag); }
      const show = have && playing && rivals.length;
      tag.hidden = !show;
      tag.textContent = held ? String(held) : '✓';
      tag.classList.toggle('safe', !held);
      b.setAttribute('aria-label', !have ? `${v} (spent)` : show ? `Bid ${v}, ${held ? `${held} ${held > 1 ? 'rivals hold' : 'rival holds'} it` : 'no rival holds it'}` : `Bid ${v}`);
    }
    const lamp = document.getElementById('lmLamp');
    lamp.hidden = !hand || !L.lamps[me] || !canPlay;
    lamp.classList.toggle('on', lit);
    lamp.setAttribute('aria-pressed', String(lit));
    lamp.textContent = lit ? '🏮 Lantern lit: a win counts double' : '🏮 Light my lantern';
    const waiting = L.waiting.map((id) => ctx.player(id)?.name).filter(Boolean);
    document.getElementById('lmWait').textContent = !playing ? ''
      : L.mine ? (waiting.length ? `You bid ${L.mine[0]}${L.mine[1] ? ' 🏮' : ''}. Waiting for: ${waiting.join(', ')}` : '')
      : canPlay ? 'Tap a tile to bid it.' : waiting.length ? `Waiting for: ${waiting.join(', ')}` : '';
  }

  // the reveal: each bid turns over in turn, clashing bids are struck through, the winner glows. The auto-played
  // last lot arrives in the same update as the lot before it, so new reveals queue up and play one after another.
  function paintLast(L) {
    const box = document.getElementById('lmLast');
    const reveals = L.reveals || [];
    box.hidden = !reveals.length;
    if (!reveals.length) { seenRound = 0; return; }
    const latest = reveals[reveals.length - 1].round;
    if (latest === seenRound && box.childElementCount) return;
    const fresh = seenRound !== null && motionOK();
    const queue = fresh ? reveals.filter((x) => x.round > seenRound) : [reveals[reveals.length - 1]];
    seenRound = latest;
    playing.forEach((f) => f()); playing = [];
    const next = () => { const x = queue.shift(); if (x) showReveal(box, x, fresh, queue.length ? next : null); };
    next();
  }

  function showReveal(box, x, fresh, then) {
    box.replaceChildren(ctx.el('h3', '', x.auto ? `🌅 Last lot: everyone's last tile` : `Lot ${x.round}: the bids`));
    const lots = ctx.el('div', 'lm-lots-mini');
    lots.append(...x.table.map((v) => ctx.el('span', '', goods(v))), ctx.el('small', '', ` ⭐${x.pot}${x.table.includes(0) ? ' + 🎁' : ''}`));
    if (x.event === 'rain') lots.append(ctx.el('small', '', ' 🌧'));
    const counts = {};
    for (const [b] of Object.values(x.bids)) counts[b] = (counts[b] || 0) + 1;
    const row = ctx.el('div', 'reveal-row');
    const tags = Object.entries(x.bids).sort((a, b) => b[1][0] - a[1][0]).map(([pid, [b, on]]) => {
      const p = ctx.player(pid);
      const tag = ctx.el('span', 'reveal-tag lm-reveal' + (fresh ? ' down' : '')
        + (pid === x.winner ? ' win' : '') + (counts[b] > 1 ? ' clash' : ''));
      tag.style.borderColor = p?.color ?? '#777';
      tag.append(ctx.el('b', 'lm-num', String(b)), `${on ? '🏮 ' : ''}${p?.name ?? '?'}`);
      return tag;
    });
    row.append(...tags);
    const text = ctx.el('p', 'lm-outcome' + (fresh ? ' wait' : ''), x.text);
    box.append(lots, row, text);
    const done = () => {
      text.classList.remove('wait');
      if (fresh) {
        const winTag = tags.find((t) => t.classList.contains('win'));
        if (x.winner === S.me.id) { ctx.sfx('fanfare'); if (x.bids[S.me.id][1]) Kit.callout('🏮 DOUBLED!', 'gold'); }
        else if (x.winner) ctx.sfx('chip');
        else { ctx.sfx('bad'); Kit.callout(x.washed ? '🌧 Washed away!' : '🤝 Matched!', 'cool'); }
        if (winTag) Kit.flyText(winTag, `+${x.bids[x.winner][2]}`, 'gold');
      }
      if (then) playing.push(((t) => () => clearTimeout(t))(setTimeout(then, 1600)));
    };
    if (fresh) {
      if (x.auto) Kit.callout('🌅 Last lot!', 'gold');
      playing.push(Kit.reveal(tags, 380, (t) => t.classList.remove('down'), { done }));
    } else done();
  }

  // everyone's tiles are public: which ones each player still holds, their score and lantern
  function paintLeft(L) {
    const t = document.getElementById('lmLeft');
    t.replaceChildren();
    const ids = Object.keys(L.hands).sort((a, b) => L.score[b] - L.score[a]);
    for (const pid of ids) {
      const p = ctx.player(pid); if (!p) continue;
      const tr = ctx.el('tr', pid === S.me.id ? 'me' : '');
      const name = ctx.el('td', 'lm-name', p.name); name.style.color = p.color;
      const tiles = ctx.el('td', 'lm-mini');
      for (let v = 1; v <= L.lots; v++) tiles.append(ctx.el('i', L.hands[pid].includes(v) ? '' : 'gone', String(v)));
      const lockedIn = S.phase === 'playing' && !L.waiting.includes(pid);
      tr.append(name, tiles, ctx.el('td', 'lm-lampcell', L.lamps[pid] ? '🏮' : ''), ctx.el('td', 'lm-score', `⭐${L.score[pid]}${lockedIn ? ' ✅' : ''}`));
      t.append(tr);
    }
  }

  // one row per player, one column per lot: what they bid, the winning bid ringed
  function paintHist(L) {
    const rounds = L.rounds || [];
    const wrap = document.getElementById('lmHist');
    wrap.hidden = !rounds.length;
    const t = document.getElementById('lmHistT');
    t.replaceChildren();
    if (!rounds.length) return;
    const head = ctx.el('tr'); head.append(ctx.el('th'));
    for (const r of rounds) head.append(ctx.el('th', '', r.table.map(goods).join('') + (r.washed ? '🌧' : '')));
    t.append(head);
    for (const pid of Object.keys(L.hands)) {
      const p = ctx.player(pid); if (!p) continue;
      const tr = ctx.el('tr');
      const name = ctx.el('td', 'lm-name', p.name); name.style.color = p.color;
      tr.append(name);
      for (const r of rounds) {
        const b = r.bids[pid];
        const td = ctx.el('td', r.winner === pid ? 'won' : '', b ? String(b[0]) + (b[1] ? '🏮' : '') : '·');
        if (r.winner === pid) td.title = `+${b[2]}`;
        tr.append(td);
      }
      t.append(tr);
    }
  }

  // when the market closes: everyone's night in one table, plus a few highlights
  function paintRecap(L) {
    const box = document.getElementById('lmRecap');
    const over = S.phase !== 'playing' && (L.rounds || []).length;
    box.hidden = !over;
    document.querySelector('.lm-bid').hidden = !!over;
    if (!over) { box.replaceChildren(); delete box.dataset.key; return; }
    const key = String(L.rounds.length);
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    const rounds = L.rounds, ids = Object.keys(L.hands).filter((id) => ctx.player(id));
    const stat = Object.fromEntries(ids.map((id) => [id, { buys: 0, lots: 0, clashes: 0, best: null, lamp: null }]));
    for (const r of rounds) {
      const counts = {};
      for (const [b] of Object.values(r.bids)) counts[b] = (counts[b] || 0) + 1;
      for (const [pid, [b, on, gain]] of Object.entries(r.bids)) {
        const st = stat[pid]; if (!st) continue;
        if (counts[b] > 1) st.clashes++;
        if (on) st.lamp = { round: r.round, gain };
        if (pid === r.winner) {
          st.buys++; st.lots += r.table.length;
          if (!st.best || gain - b > st.best.gain - st.best.bid) st.best = { gain, bid: b, table: r.table };
        }
      }
    }
    ids.sort((a, b) => L.score[b] - L.score[a] || L.bought[b] - L.bought[a]);
    const t = ctx.el('table', 'lm-recap-t');
    const head = ctx.el('tr');
    head.append(...['', '⭐', 'Lots', 'Best buy', '🏮', '🤝'].map((h) => ctx.el('th', '', h)));
    head.lastChild.title = 'Bids that clashed';
    t.append(head);
    for (const id of ids) {
      const p = ctx.player(id), st = stat[id];
      const tr = ctx.el('tr', id === S.me.id ? 'me' : '');
      const name = ctx.el('td', 'lm-name', p.name); name.style.color = p.color;
      tr.append(name, ctx.el('td', 'lm-score', String(L.score[id])), ctx.el('td', '', String(st.lots)),
        ctx.el('td', '', st.best ? `${st.best.table.map(goods).join('')} ⭐${st.best.gain} for ${st.best.bid}` : '—'),
        ctx.el('td', '', !st.lamp ? (L.lamps[id] ? '—' : '') : st.lamp.gain ? `+${st.lamp.gain}` : '💨'),
        ctx.el('td', '', String(st.clashes)));
      t.append(tr);
    }
    const lines = [];
    const steals = rounds.filter((r) => r.winner).map((r) => ({ r, b: r.bids[r.winner][0], g: r.bids[r.winner][2] }));
    const steal = steals.sort((a, b) => (b.g - b.b) - (a.g - a.b))[0];
    if (steal) lines.push(`💎 Steal of the night: ${ctx.player(steal.r.winner)?.name ?? '?'} bought ${steal.r.table.map(goods).join('')} (⭐${steal.g}) with a ${steal.b}.`);
    const pile = rounds.reduce((m, r) => (r.table.length > (m?.table.length ?? 1) ? r : m), null);
    if (pile) lines.push(`📦 Biggest pile: ${pile.table.length} lots on lot ${pile.round}, ${pile.winner ? `taken by ${ctx.player(pile.winner)?.name ?? '?'}` : pile.washed ? 'washed away by the rain' : 'left unsold'}.`);
    const clashes = rounds.filter((r) => !r.winner).length;
    lines.push(clashes ? `🤝 ${clashes} ${clashes > 1 ? 'lots' : 'lot'} went unsold because every bid was matched.` : '🤝 Every lot found a buyer.');
    box.replaceChildren(ctx.el('h3', '', '🌅 The night at the market'), t, ...lines.map((l) => ctx.el('p', 'lm-line', l)));
  }

  const turnText = (s) => s.phase !== 'playing' ? null
    : s.me.ghost || s.me.spectator || !s.lantern.hands[s.me.id] ? '🏮 Watching the market'
    : s.lantern.mine ? `Bid ${s.lantern.mine[0]} locked in — waiting…` : '🏮 Place your bid!';
  const myMove = (s) => s.phase === 'playing' && !!s.lantern.hands[s.me.id] && !s.lantern.mine && !s.me.spectator && !s.me.ghost;

  return { mount, render, turnText, myMove };
})();
