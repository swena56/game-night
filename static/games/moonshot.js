UI.moonshot = (() => {
  let S, ctx, track, builtFor = '', shownRoll = '', shownPos = null;
  const TILE = { star: '⭐', meteor: '☄️', wormhole: '🌀' };
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    builtFor = ''; shownRoll = ''; shownPos = null;
    // The dice and buttons sit right under the track (not in the side panel), so on a phone they're
    // on screen without scrolling past the board.
    main.innerHTML = `<div class="moon-track"></div>
      <div class="panel moon-panel">
        <div id="msDice" class="dice"></div>
        <div class="moon-info"><div id="msFuel" class="fuel"></div><p id="msRisk" class="ms-risk"></p><p id="msPreview" class="preview"></p></div>
        <div class="row moon-btns"><button id="msRoll" class="primary">🎲 Roll</button><button id="msBank">🚀 Fly!</button></div>
      </div>`;
    side.innerHTML = `<div class="panel">
      <ul class="rules">
        <li>🎲 Each roll adds fuel. Any <b>1</b> loses this turn's fuel.</li>
        <li>💥 <b>Double 1s</b> crash you back to the start (a 🛡️ shield saves you).</li>
        <li>🛡️ Other doubles give a shield (max 2).</li>
        <li>Stop on ⭐ +5 · ☄️ −5 · 🌀 swap with the leader.</li>
      </ul></div>`;
    track = main.querySelector('.moon-track');
    $('msRoll').onclick = () => ctx.quiet(ctx.act('roll'));
    $('msBank').onclick = () => ctx.quiet(ctx.act('bank'));
  }

  function render(s, c) {
    S = s; ctx = c;
    const m = S.moon;
    const key = `${m.goal}:${JSON.stringify(m.tiles)}`;
    if (key !== builtFor) {
      builtFor = key; track.innerHTML = '';
      // the route snakes up through space: left to right, then back, from Earth at the bottom to the moon
      const rows = Math.ceil((m.goal + 1) / 10);
      for (let i = 0; i <= m.goal; i++) {
        const cell = ctx.el('div', 'ms-cell' + (m.tiles[i] ? ' t-' + m.tiles[i] : '') + (i === 0 ? ' pad' : i === m.goal ? ' moon' : ''));
        const row = Math.floor(i / 10), col = row % 2 ? 9 - (i % 10) : i % 10;
        cell.style.gridRow = String(rows - row); cell.style.gridColumn = String(col + 1);
        if (i % 10 === 9 && i < m.goal) cell.classList.add(row % 2 ? 'turn-l' : 'turn-r');  // the route bends up here
        cell.append(ctx.el('span', 'num', i === 0 ? '🌍' : i === m.goal ? '🌕' : TILE[m.tiles[i]] ?? i));
        cell.append(ctx.el('div', 'rockets'));
        track.append(cell);
      }
    }
    const cells = track.children;
    const before = Kit.snap(track);  // where each rocket was, so a move flies cell to cell
    for (const cell of cells) { cell.querySelector('.rockets').innerHTML = ''; cell.classList.remove('preview'); }
    for (const pid of m.seats) {
      const p = ctx.player(pid);
      if (!p) continue;
      const r = ctx.el('span', 'rocket' + (pid === S.turn ? ' active' : ''), Array.from(p.name.replace('🤖 ', '')).slice(0, 2).join(''));
      r.style.background = p.color;
      r.title = p.name;
      r.dataset.k = pid;
      if (m.shields?.[pid]) { r.classList.add('shielded'); r.dataset.shields = '🛡️'.repeat(m.shields[pid]); }
      cells[Math.min(m.pos[pid], m.goal)].querySelector('.rockets').append(r);
    }
    if (m.preview && m.preview.cell <= m.goal) cells[m.preview.cell].classList.add('preview');

    Kit.glide(track, before, 650);
    // what the move did: a flight, a crash to the pad, a boost, a meteor, a wormhole swap
    if (shownPos) for (const pid of m.seats) {
      const was = shownPos[pid] ?? 0, now = m.pos[pid] ?? 0, cell = cells[Math.min(now, m.goal)];
      if (now === was) continue;
      if (now === 0 && was > 0 && m.dice?.[0] === 1 && m.dice?.[1] === 1) { Kit.callout('💥 CRASH', 'bad'); ctx.sfx('boom'); ctx.buzz(90); }
      else if (now > was) { ctx.sfx('whoosh'); if (m.tiles[now] === 'star' || m.tiles[now - 5] === 'star') Kit.flyText(cell, '⭐ +5', 'gold'); }
      else Kit.flyText(cell, m.tiles[now + 5] === 'meteor' ? '☄️ −5' : '🌀', 'bad');
    }
    shownPos = { ...m.pos };
    // real dice with pips, tumbling in on a fresh roll
    const dice = $('msDice');
    dice.replaceChildren(...(m.dice || [0, 0]).map((v) => Dice.die(v, m.dice ? '' : 'blank')));
    const rk = `${S.turn}|${m.fuel}|${m.dice}|${m.pos[S.turn]}`;
    if (m.dice && shownRoll && rk !== shownRoll) Dice.roll(dice.children, { sound: false });
    shownRoll = rk;
    $('msFuel').textContent = `⛽ ${m.fuel} fuel this turn` + (m.turnsLeft != null ? ` · ⏳ ${m.turnsLeft} turn${m.turnsLeft === 1 ? '' : 's'} left` : '');
    const turnPlayer = ctx.player(S.turn);
    let preview = '';
    if (m.preview && turnPlayer) {
      const who = S.turn === S.me.id ? 'Fly now' : `${turnPlayer.name} could fly`;
      preview = m.preview.cell >= m.goal ? `${who} → 🌕 the moon!`
        : `${who} → ${m.preview.cell}${m.preview.tile ? ' ' + m.tileText[m.preview.tile] : ''}`;
    }
    $('msPreview').textContent = preview;
    // the odds of the next roll: any 1 on two dice is 11 in 36; double 1s are 1 in 36
    const mine = m.pos[S.turn] ?? 0, shield = m.shields?.[S.turn];
    $('msRisk').textContent = !ctx.myTurn ? '' : `Next roll: 💨 31% lose ${m.fuel ? `${m.fuel} fuel` : 'the turn'}` +
      (mine > 0 && !shield ? ' · 💥 3% crash to Earth' : '');
    $('msRoll').disabled = !ctx.myTurn;
    $('msBank').disabled = !ctx.myTurn || !m.fuel;
  }

  return { mount, render };
})();
