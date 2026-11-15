// Dice Derby: six lanes with a horse each, your secret tickets, and three dice. Tap the dice in order:
// the first gallops +2, the second trots +1, and the last one stumbles −1. Ghost marks preview the move.
UI.derby = (() => {
  let S, ctx, order = [], turnKey = '', rollKey = '', seenResult = -1;
  const $ = (id) => document.getElementById(id);
  const JOBS = [['+2', 'gallop'], ['+1', 'trot'], ['−1', 'stumble']];
  const STEP = [2, 1, -1];

  function mount(main, side) {
    order = []; turnKey = ''; rollKey = ''; seenResult = -1;
    main.innerHTML = `<div class="dby">
      <div id="dbyTurn" class="dby-turn"></div>
      <div id="dbyTrack" class="dby-track"></div>
      <div id="dbyTickets" class="dby-tickets"></div>
      <div class="ya-tray"><div id="dbyDice" class="ya-dice dby-dice"></div></div>
      <div id="dbyJobs" class="dby-jobs"></div>
      <div class="row dby-actions"><button id="dbyRoll" class="primary big">🎲 Roll</button><button id="dbyReset" class="big">↺</button><button id="dbyGo" class="primary big">🏇 Go!</button></div>
      <p id="dbyHint" class="hint"></p>
      <div id="dbyResult" class="dby-result"></div></div>`;
    side.innerHTML = `<div class="panel"><h3>Points</h3><div id="dbyScores"></div>
      <p class="hint left">Tickets on 1st, 2nd and 3rd pay 5, 3 and 1.</p></div>`;
    $('dbyRoll').onclick = () => ctx.quiet(ctx.act('roll', {}));
    $('dbyReset').onclick = () => { order = []; render(S, ctx); };
    $('dbyGo').onclick = () => { if (order.length === 3) ctx.quiet(ctx.act('move', { order })); };
  }

  function render(s, c) {
    S = s; ctx = c;
    const d = S.derby;
    const mine = ctx.myTurn && !!ctx.act && S.phase === 'playing';
    const key = `${S.turn}|${d.n}`;
    if (key !== turnKey) { turnKey = key; order = []; }
    if (order.length === 2) order.push([0, 1, 2].find((i) => !order.includes(i)));
    const who = ctx.player(S.turn);
    $('dbyTurn').textContent = S.phase !== 'playing' ? '' : `Race ${d.race}/${d.races} · ${mine ? 'Your turn' : `${who?.name ?? '?'}'s turn`}`;

    // where each horse would land with the jobs picked so far
    const ghost = { ...d.pos };
    order.forEach((di, k) => { const h = d.dice[di]; ghost[h] = Math.max(0, Math.min(d.track, ghost[h] + STEP[k])); });
    const trail = Object.fromEntries((d.trail || []).map(([h, st]) => [h, st]));
    const tickets = d.tickets || [];

    const track = $('dbyTrack'); track.innerHTML = '';
    for (let h = 1; h <= 6; h++) {
      const lane = ctx.el('div', 'dby-lane' + (tickets.includes(h) ? ' mine' : ''));
      lane.style.setProperty('--hue', `${(h - 1) * 60}`);
      lane.append(ctx.el('span', 'dby-num', String(h)));
      const run = ctx.el('div', 'dby-run');
      const pct = (v) => `${v / d.track * 100}%`;
      if (ghost[h] !== d.pos[h]) {
        const g = ctx.el('span', 'dby-ghost', ghost[h] > d.pos[h] ? '▶' : '◀'); g.style.left = pct(ghost[h]); run.append(g);
      }
      const horse = ctx.el('span', 'dby-horse' + (trail[h] ? (trail[h] > 0 ? ' fwd' : ' back') : '') + (d.places[h] === 0 && d.pos[h] ? ' lead' : ''), '🏇');
      horse.style.left = pct(d.pos[h]);
      run.append(horse);
      lane.append(run, ctx.el('span', 'dby-pos', tickets.includes(h) ? `🎟️ ${d.pos[h]}` : String(d.pos[h])));
      track.append(lane);
    }

    const tk = $('dbyTickets'); tk.innerHTML = '';
    if (tickets.length) tk.append(ctx.el('span', '', `🎟️ Your secret tickets: horse ${tickets.join(' and horse ')}`));

    const rk = `${S.turn}|${d.n}`, fresh = d.dice.length && rk !== rollKey && rollKey !== '';
    rollKey = rk;
    const tray = $('dbyDice'); tray.innerHTML = '';
    const nodes = d.dice.map((v, i) => {
      const k = order.indexOf(i);
      const b = Dice.die(v, k >= 0 ? 'held dby-job' + k : '', 'button');
      b.disabled = !mine || k >= 0;
      if (k >= 0) b.dataset.job = JOBS[k][0];
      b.setAttribute('aria-label', `Horse ${v}${k >= 0 ? `: ${JOBS[k][1]}` : ''}`);
      b.onclick = () => { order.push(i); render(S, ctx); };
      tray.append(b);
      return b;
    });
    if (fresh) Dice.roll(nodes);

    const jobs = $('dbyJobs'); jobs.innerHTML = '';
    jobs.hidden = !d.dice.length;
    JOBS.forEach(([st, word], k) => {
      const h = order[k] != null ? d.dice[order[k]] : null;
      jobs.append(ctx.el('span', 'dby-slot dby-job' + k + (h ? ' set' : ''), `${st} ${word}${h ? `: horse ${h}` : ''}`));
    });

    $('dbyRoll').hidden = !mine || d.dice.length > 0;
    $('dbyGo').hidden = $('dbyReset').hidden = !mine || !d.dice.length;
    $('dbyGo').disabled = order.length < 3;
    $('dbyReset').disabled = !order.length;
    $('dbyHint').textContent = !mine ? '' : !d.dice.length ? 'Roll three dice.' : order.length < 3 ? `Tap the die whose horse should ${JOBS[order.length][1]} (${JOBS[order.length][0]}).` : 'Happy with it? Go!';

    const res = $('dbyResult'); res.innerHTML = '';
    if (d.result) {
      const R = d.result;
      if (R.n !== seenResult && seenResult !== -1) Kit.callout(`🏁 Horse ${Object.keys(R.places).filter((h) => R.places[h] === 0).join(' & ')} wins!`, 'gold', { sound: 'fanfare' });
      seenResult = R.n;
      res.append(ctx.el('div', 'dby-rhead', `Race ${R.race} result`));
      for (const [pid, tks] of Object.entries(R.tickets)) {
        const p = ctx.player(pid);
        const row = ctx.el('div', 'dby-rrow');
        const n = ctx.el('b', '', p?.name ?? '?'); n.style.color = p?.color ?? 'inherit';
        row.append(n, ctx.el('span', '', ` 🎟️ ${tks.map((h) => `${h} (${['1st', '2nd', '3rd'][R.places[h]] ?? '–'})`).join(', ')} → +${R.gains[pid] ?? 0}`));
        res.append(row);
      }
    }

    const box = $('dbyScores'); box.innerHTML = '';
    for (const pid of d.seats) {
      const p = ctx.player(pid); if (!p) continue;
      const row = ctx.el('div', 'seat-row' + (S.turn === pid ? ' turn' : ''));
      const dot = ctx.el('span', 'dot'); dot.style.background = p.color;
      row.append(dot, ctx.el('span', '', `${p.name}: ${d.scores[pid] ?? 0}`));
      box.append(row);
    }
  }

  const turnText = (s) => s.phase !== 'playing' || s.turn !== s.me.id ? null : s.derby.dice.length ? '🏇 Give each die a job' : '🏇 Roll!';

  return { mount, render, turnText };
})();
