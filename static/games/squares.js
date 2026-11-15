// Dice Squares: the roll for the whole table, and your own grid. Tap an empty square to write the die in
// (with two dice, tap the one you want first). Each finished row and column shows the hand it scored.
UI.squares = (() => {
  let S, ctx, die = 0, rollKey = '';
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    die = 0; rollKey = ''; Kit.reset('dsq:');
    main.innerHTML = `<div class="dsq">
      <div id="dsqTurn" class="dsq-turn"></div>
      <div id="dsqRoll" class="ya-dice dsq-roll"></div>
      <div id="dsqGrid" class="dsq-grid"></div>
      <p id="dsqHint" class="hint"></p></div>`;
    side.innerHTML = `<div class="panel"><h3>Scores</h3><div id="dsqScores"></div>
      <h3>Hands (per row and column)</h3><table id="dsqHands" class="dsq-hands"></table>
      <div id="dsqRivals" class="dsq-rivals"></div></div>`;
  }

  function cellBox(v, cls = '') {
    return v ? Dice.die(v, 'small ' + cls) : ctx.el('span', 'dsq-empty ' + cls);
  }

  function render(s, c) {
    S = s; ctx = c;
    const q = S.squares, n = q.n;
    const playing = S.phase === 'playing', canAct = !!ctx.act && playing && !!q.grid && !q.placed;
    if (die >= q.dice.length) die = 0;
    $('dsqTurn').textContent = !playing ? '' : `Roll ${q.t} of ${q.of}` + (q.placed && q.waiting.length ? ` · waiting for ${q.waiting.map((i) => ctx.player(i)?.name ?? '?').join(', ')}` : '');

    const roll = $('dsqRoll'); roll.innerHTML = '';
    const nodes = q.dice.map((v, i) => {
      const b = Dice.die(v, q.dice.length > 1 && i === die && canAct ? 'held' : '', 'button');
      b.disabled = !canAct || q.dice.length < 2;
      b.setAttribute('aria-label', `Die ${v}`);
      b.onclick = () => { die = i; render(S, ctx); };
      roll.append(b);
      return b;
    });
    const rk = `${S.gameNo}|${q.t}`;
    if (rk !== rollKey && playing) { if (rollKey) Dice.roll(nodes); die = 0; }
    rollKey = rk;

    // the grid with a result column on the right and a result row along the bottom
    const grid = $('dsqGrid'); grid.innerHTML = '';
    grid.style.setProperty('--n', n);
    const mine = q.grid || Array(n * n).fill(0);
    const done = [];   // lines finished by this placement: they pop, and a big hand gets a callout
    const res = (k) => {
      const r = q.lines?.[k];
      const box = ctx.el('div', 'dsq-res' + (r ? (r[1] >= 12 ? ' big' : r[1] ? ' ok' : ' zero') : ''));
      if (r) { box.append(ctx.el('b', '', String(r[1]))); box.title = r[0]; box.append(ctx.el('small', '', r[0])); }
      Kit.onNew(`dsq:${S.gameNo}:${k}`, r ? r[1] : null, () => { box.classList.add('new'); done.push([box, r]); });
      return box;
    };
    for (let r = 0; r < n; r++) {
      for (let col = 0; col < n; col++) {
        const i = r * n + col, v = mine[i];
        const b = ctx.el('button', 'dsq-cell' + (v ? ' full' : '') + (q.recent === i ? ' recent' : ''));
        b.append(cellBox(v));
        b.disabled = !canAct || !!v;
        b.setAttribute('aria-label', v ? `Row ${r + 1}, column ${col + 1}: ${v}` : `Row ${r + 1}, column ${col + 1}: empty`);
        b.onclick = () => ctx.quiet(ctx.act('place', { cell: i, die }));
        grid.append(b);
      }
      grid.append(res(r));
    }
    for (let col = 0; col < n; col++) grid.append(res(n + col));
    grid.append(ctx.el('div', 'dsq-total', String(q.scores[S.me.id] ?? '')));
    for (const [box, r] of done) if (r[1]) Kit.flyText(box, `+${r[1]}`, r[1] >= 12 ? 'gold' : 'good');
    const best = done.filter(([, r]) => r[1] >= 12).sort((a, b) => b[1][1] - a[1][1])[0];
    if (best) Kit.callout(`${best[1][0]}!`, 'gold', { sound: 'good', ms: 1300 });

    $('dsqHint').textContent = !playing || !q.grid ? '' : q.placed ? 'Placed — the next roll comes when everyone is in.'
      : q.dice.length > 1 ? 'Pick a die, then tap an empty square.' : 'Tap an empty square for this roll.';

    const box = $('dsqScores');
    Kit.scoreboard(box, q.seats.filter((pid) => ctx.player(pid)).map((pid) => ({
      p: ctx.player(pid), score: q.scores[pid] ?? 0, me: pid === S.me.id, turn: playing && q.waiting.includes(pid),
    })), { lead: true });
    if (q.solo) box.append(ctx.el('div', 'hint left', `Solo goal: ${q.goal}`));
    const hands = $('dsqHands'); hands.innerHTML = '';
    for (const [lbl, pts] of q.hands) {
      const tr = ctx.el('tr'); tr.append(ctx.el('td', '', lbl), ctx.el('td', '', String(pts))); hands.append(tr);
    }
    const riv = $('dsqRivals'); riv.innerHTML = '';
    for (const [pid, g] of Object.entries(q.rivals)) {
      const p = ctx.player(pid); if (!p) continue;
      const wrap = ctx.el('div', 'dsq-rival');
      const h = ctx.el('div', '', p.name); h.style.color = p.color;
      const mini = ctx.el('div', 'dsq-mini'); mini.style.setProperty('--n', n);
      g.forEach((v) => mini.append(ctx.el('span', v ? 'on' : '', v ? String(v) : '')));
      wrap.append(h, mini);
      riv.append(wrap);
    }
  }

  const myMove = (s) => s.phase === 'playing' && !!s.squares.grid && !s.squares.placed;
  const turnText = (s) => myMove(s) ? `🧮 Place the ${s.squares.dice.join(' or ')}` : null;

  return { mount, render, turnText, myMove };
})();
