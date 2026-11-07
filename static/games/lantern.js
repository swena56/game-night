UI.lantern = (() => {
  let S, ctx, lit = false, seenRound = null;
  const GOODS = { 1: ['🥚', 'Eggs'], 2: ['🍋', 'Lemons'], 3: ['🧄', 'Garlic'], 4: ['🍯', 'Honey'], 5: ['🧶', 'Yarn'], 6: ['🫖', 'Teapot'], 7: ['🪁', 'Kite'],
    8: ['🏺', 'Vase'], 9: ['🪔', 'Oil lamp'], 10: ['🧭', 'Compass'], 11: ['🪞', 'Mirror'], 12: ['💍', 'Ring'], 13: ['👑', 'Crown'] };

  function mount(main, side) {
    lit = false; seenRound = null;
    main.innerHTML = `<div class="lm">
      <div class="lm-string" aria-hidden="true">${'<i></i>'.repeat(7)}</div>
      <div class="lm-stall panel">
        <div class="lm-head"><b id="lmRound"></b><span id="lmWorth" class="lm-worth"></span></div>
        <div class="lm-lots"><div id="lmTable" class="lm-table"></div><div id="lmNext" class="lm-next"></div></div>
      </div>
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
      </ul>
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
    c.append(ctx.el('span', 'lm-good', GOODS[v][0]), ctx.el('b', '', String(v)));
    c.title = `${GOODS[v][1]}: ${v} points`;
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
  }

  function paint() {
    const L = S.lantern, me = S.me.id;
    const playing = S.phase === 'playing';
    document.getElementById('lmRound').textContent = playing ? `🏮 Lot ${L.round} of ${L.lots}` : '🌅 The market has closed';
    const worth = L.table.reduce((a, b) => a + b, 0);
    document.getElementById('lmWorth').textContent = L.table.length ? `worth ⭐${worth}` + (lit ? ` → ⭐${worth * 2} lit` : '') : '';
    const t = document.getElementById('lmTable');
    const key = L.table.join(',');
    if (t.dataset.key !== key) {
      t.dataset.key = key;
      t.replaceChildren(...L.table.map((v, i) => lotCard(v, i === L.table.length - 1 && motionOK() ? 'fresh' : '')));
    }
    const n = document.getElementById('lmNext');
    n.replaceChildren();
    if (L.next && playing) n.append(ctx.el('small', '', 'Next'), lotCard(L.next, 'small'));
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
    for (const b of tiles.children) {
      const v = +b.dataset.v, have = hand?.includes(v);
      b.classList.toggle('spent', !have);
      b.classList.toggle('on', !!L.mine && L.mine[0] === v);
      b.disabled = !canPlay || !have;
      b.setAttribute('aria-label', have ? `Bid ${v}` : `${v} (spent)`);
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

  // the reveal: each bid turns over in turn, clashing bids are struck through, the winner glows
  function paintLast(L) {
    const box = document.getElementById('lmLast');
    box.hidden = !L.last;
    if (!L.last) { seenRound = 0; return; }
    if (L.last.round === seenRound && box.childElementCount) return;
    const fresh = seenRound !== null && motionOK();
    seenRound = L.last.round;
    box.replaceChildren(ctx.el('h3', '', `Lot ${L.last.round}: the bids`));
    const lots = ctx.el('div', 'lm-lots-mini');
    lots.append(...L.last.lots.map((v) => ctx.el('span', '', GOODS[v][0])), ctx.el('small', '', ` ⭐${L.last.pot}`));
    const counts = {};
    for (const [b] of Object.values(L.last.bids)) counts[b] = (counts[b] || 0) + 1;
    const row = ctx.el('div', 'reveal-row');
    const tags = Object.entries(L.last.bids).sort((a, b) => b[1][0] - a[1][0]).map(([pid, [b, on]]) => {
      const p = ctx.player(pid);
      const tag = ctx.el('span', 'reveal-tag lm-reveal' + (fresh ? ' down' : '')
        + (pid === L.last.winner ? ' win' : '') + (counts[b] > 1 ? ' clash' : ''));
      tag.style.borderColor = p?.color ?? '#777';
      tag.append(ctx.el('b', 'lm-num', String(b)), `${on ? '🏮 ' : ''}${p?.name ?? '?'}`);
      return tag;
    });
    row.append(...tags);
    const text = ctx.el('p', 'lm-outcome' + (fresh ? ' wait' : ''), L.last.text);
    box.append(lots, row, text);
    const done = () => {
      text.classList.remove('wait');
      if (!fresh) return;
      const winTag = tags.find((t) => t.classList.contains('win'));
      if (L.last.winner === S.me.id) { ctx.sfx('fanfare'); if (L.last.bids[S.me.id][1]) Kit.callout('🏮 DOUBLED!', 'gold'); }
      else if (L.last.winner) ctx.sfx('chip');
      else { ctx.sfx('bad'); Kit.callout('🤝 Matched!', 'cool'); }
      if (winTag) Kit.flyText(winTag, `+${L.last.bids[L.last.winner][1] ? L.last.pot * 2 : L.last.pot}`, 'gold');
    };
    if (fresh) Kit.reveal(tags, 380, (t) => t.classList.remove('down'), { done });
    else done();
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
    for (const r of rounds) head.append(ctx.el('th', '', r.table.map((v) => GOODS[v][0]).join('')));
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

  const turnText = (s) => s.phase !== 'playing' ? null
    : s.me.ghost || s.me.spectator || !s.lantern.hands[s.me.id] ? '🏮 Watching the market'
    : s.lantern.mine ? `Bid ${s.lantern.mine[0]} locked in — waiting…` : '🏮 Place your bid!';
  const myMove = (s) => s.phase === 'playing' && !!s.lantern.hands[s.me.id] && !s.lantern.mine && !s.me.spectator && !s.me.ghost;

  return { mount, render, turnText, myMove };
})();
