UI.moonshot = (() => {
  let S, ctx, track, builtFor = '', shownRoll = '';
  const TILE = { star: '⭐', meteor: '☄️', wormhole: '🌀' };
  const DIE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    builtFor = ''; shownRoll = '';
    // The dice and buttons sit right under the track (not in the side panel), so on a phone they're
    // on screen without scrolling past the board.
    main.innerHTML = `<div class="moon-track"></div>
      <div class="panel moon-panel">
        <div id="msDice" class="dice"></div>
        <div class="moon-info"><div id="msFuel" class="fuel"></div><p id="msPreview" class="preview"></p></div>
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
      for (let i = 0; i <= m.goal; i++) {
        const cell = ctx.el('div', 'ms-cell' + (m.tiles[i] ? ' t-' + m.tiles[i] : ''));
        cell.append(ctx.el('span', 'num', i === 0 ? '🛰️' : i === m.goal ? '🌕' : TILE[m.tiles[i]] ?? i));
        cell.append(ctx.el('div', 'rockets'));
        track.append(cell);
      }
    }
    const cells = track.children;
    for (const cell of cells) { cell.querySelector('.rockets').innerHTML = ''; cell.classList.remove('preview'); }
    for (const pid of m.seats) {
      const p = ctx.player(pid);
      if (!p) continue;
      const r = ctx.el('span', 'rocket' + (pid === S.turn ? ' active' : ''), Array.from(p.name.replace('🤖 ', '')).slice(0, 2).join(''));
      r.style.background = p.color;
      r.title = p.name;
      cells[Math.min(m.pos[pid], m.goal)].querySelector('.rockets').append(r);
    }
    if (m.preview && m.preview.cell <= m.goal) cells[m.preview.cell].classList.add('preview');

    $('msDice').textContent = m.dice ? m.dice.map((d) => DIE[d]).join(' ') : '🎲';
    const rk = `${S.turn}|${m.fuel}|${m.dice}|${m.pos[S.turn]}`;
    if (m.dice && shownRoll && rk !== shownRoll) {  // a fresh roll tumbles in
      const d = $('msDice'); d.classList.remove('roll'); void d.offsetWidth; d.classList.add('roll');
    }
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
    $('msRoll').disabled = !ctx.myTurn;
    $('msBank').disabled = !ctx.myTurn || !m.fuel;
  }

  return { mount, render };
})();
