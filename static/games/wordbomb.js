// 💣 Word Bomb: the players sit in a ring around the bomb, which shows the letters to use. Whoever holds it
// types a word (everyone sees the letters appear under their seat) and presses Enter to pass it on. The fuse
// is a secret: the spark only flickers. A blast shakes the table, and the alphabet strip shows the letters
// you've used towards the 🔤 bonus heart.
UI.wordbomb = (() => {
  let S, ctx, seen = null, busy = false, myTurnWas = false, typedBy = null, typed = '', miss = null, missTimer = 0;
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    seen = null; busy = false; myTurnWas = false; typedBy = null; typed = ''; miss = null;
    main.innerHTML = `<div class="wb">
      <div class="wb-head"><span id="wbBomb"></span><span id="wbUsed" class="wb-used"></span></div>
      <div id="wbTable" class="wb-table">
        <div id="wbArrow" class="wb-arrow"></div>
        <div id="wbCore" class="wb-core"><div class="wb-fuse"><i></i></div><b id="wbChunk"></b><small id="wbSub"></small></div>
      </div>
      <form id="wbForm" class="wb-entry" autocomplete="off">
        <input id="wbInput" maxlength="24" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="send" aria-label="Your word">
        <button type="submit" id="wbGo" class="primary">💣 Pass</button>
      </form>
      <div id="wbNote" class="wb-note" aria-live="polite"></div>
      <div id="wbAlpha" class="wb-alpha" aria-label="Letters you've used"></div></div>`;
    side.innerHTML = '<div class="panel"><h3>Hearts</h3><div id="wbScores"></div><p class="hint left">Type a word containing the letters on the bomb and press Enter. The fuse is hidden: don\'t hold it long!</p></div>';
    $('wbForm').onsubmit = (e) => { e.preventDefault(); submit(); };
    $('wbInput').oninput = () => {
      const v = $('wbInput').value.toUpperCase().replace(/[^A-Z]/g, '');
      if (v !== $('wbInput').value) $('wbInput').value = v;
      if (mine()) { typed = v; typedBy = S.me.id; ctx.input({ t: v }); paintSeats(); }
    };
  }
  function unmount() { clearTimeout(missTimer); }

  const W = () => S.wordbomb;
  const mine = () => !!S && S.phase === 'playing' && W().stage === 'lit' && W().holder === S.me.id && ctx?.myTurn;

  function submit() {
    if (!mine() || busy) return;
    const w = $('wbInput').value.trim().toUpperCase();
    if (!w) return;
    busy = true;
    ctx.act('word', { word: w }).then(() => { $('wbInput').value = ''; typed = ''; })
      .catch((err) => {
        showMiss(S.me.id, w, err?.message || 'Try another word.');
        ctx.sfx('wrong'); ctx.buzz?.(40);
        const f = $('wbForm'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
      })
      .finally(() => { busy = false; $('wbInput')?.focus?.(); });
  }

  // a refused word: shown crossed out under the player's seat for a moment
  function showMiss(by, word, why) {
    miss = { by, word, why };
    $('wbNote').textContent = by === S.me.id ? why : `${ctx.player(by)?.name ?? '?'}: ${why}`;
    clearTimeout(missTimer);
    missTimer = setTimeout(() => { miss = null; paintSeats(); }, 1300);
    paintSeats();
  }

  // a word with the bomb's letters lit up
  function spell(word, chunk, cls = '') {
    const box = ctx.el('span', 'wb-word ' + cls), at = chunk ? word.indexOf(chunk) : -1;
    if (at < 0) { box.textContent = word; return box; }
    box.append(word.slice(0, at), ctx.el('mark', '', chunk), word.slice(at + chunk.length));
    return box;
  }

  function seatXY(i, n) {
    const a = (i / n) * Math.PI * 2;
    return [50 + 39 * Math.sin(a), 50 - 37 * Math.cos(a), a];
  }

  function paintSeats() {
    if (!S?.wordbomb || !$('wbTable')) return;
    const w = W(), table = $('wbTable'), n = w.seats.length;
    table.querySelectorAll('.wb-seat').forEach((e) => e.remove());
    w.seats.forEach((pid, i) => {
      const p = ctx.player(pid); if (!p) return;
      const [x, y] = seatXY(i, n), lives = w.lives[pid] ?? 0, holding = w.holder === pid && w.stage === 'lit';
      const seat = ctx.el('div', 'wb-seat' + (holding ? ' holding' : '') + (lives ? '' : ' out') + (pid === S.me.id ? ' me' : ''));
      seat.style.left = x + '%'; seat.style.top = y + '%'; seat.style.setProperty('--pc', p.color || '#888');
      const name = ctx.el('b', 'wb-name', p.name);
      const hearts = ctx.el('span', 'wb-hearts', lives ? '♥'.repeat(lives) + '♡'.repeat(Math.max(0, w.maxLives - lives)) : '💀');
      seat.append(name, hearts);
      // under the seat: their typing (holder), a refused word, or the last word they played
      let bubble = null;
      if (miss && miss.by === pid) bubble = spell(miss.word, w.chunk, 'no');
      else if (holding && typedBy === pid && typed) bubble = spell(typed, w.chunk, 'typing');
      else if (holding) bubble = ctx.el('span', 'wb-word typing dots', '…');
      else if (w.last?.by === pid) bubble = spell(w.last.word, w.last.chunk, 'played');
      if (bubble) seat.append(bubble);
      table.append(seat);
    });
    // the arrow from the bomb to whoever holds it
    const at = w.seats.indexOf(w.holder);
    $('wbArrow').hidden = at < 0 || w.stage !== 'lit';
    if (at >= 0) $('wbArrow').style.transform = `rotate(${seatXY(at, n)[2]}rad)`;
  }

  function render(s, c) {
    S = s; ctx = c;
    const w = W(), me = S.me.id, playing = S.phase === 'playing';
    const first = seen === null;
    // whose typing we show follows the bomb; a new holder starts with what the server has
    if (typedBy !== w.holder) { typedBy = w.holder; typed = w.typed || ''; }

    // events since the last render, once each
    if (!first && seen !== w.seq) {
      if (w.boom && w.boom.seq > seen) {
        const b = w.boom, who = ctx.player(b.by)?.name ?? '?';
        ctx.sfx('boom');
        if (b.by === me) ctx.buzz?.([90, 60, 200]);
        const core = $('wbCore'); core.classList.remove('blast'); void core.offsetWidth; core.classList.add('blast');
        const t = $('wbTable'); t.classList.remove('shake'); void t.offsetWidth; t.classList.add('shake');
        $('wbNote').textContent = `💥 ${b.by === me ? 'Your' : who + "'s"} bomb went off${b.example ? ` — ${b.example} had ${b.chunk}` : ''}.`;
      } else if (w.last && w.last.seq > seen) {
        ctx.sfx(w.last.long ? 'rise' : 'whoosh', 4);
        if (w.last.by === me && w.last.long) Kit.callout('📏 Long word: +2 s on the fuse', 'cool', { ms: 1100 });
        $('wbNote').textContent = '';
      }
      if (w.alphaWin && w.alphaWin.seq > seen && w.alphaWin.by === me) ctx.confetti?.();
    }
    seen = w.seq;

    const holder = ctx.player(w.holder);
    $('wbBomb').textContent = `💣 Bomb ${w.bomb}`;
    $('wbUsed').textContent = `${w.used} word${w.used === 1 ? '' : 's'} played`;
    $('wbChunk').textContent = w.stage === 'lit' ? w.chunk : '💥';
    $('wbSub').textContent = w.stage === 'lit' ? (w.holder === me ? 'your bomb!' : holder ? `${holder.name}` : '') : 'next bomb…';
    $('wbCore').classList.toggle('mine', w.holder === me && w.stage === 'lit');
    $('wbCore').classList.toggle('dark', w.stage !== 'lit' || !playing);

    // the entry: live on your turn, and it stays focused between turns so a phone keyboard doesn't bounce
    const now = mine();
    const seated = w.seats.includes(me) && (w.lives[me] ?? 0) > 0;
    $('wbForm').hidden = !seated || !playing;
    $('wbGo').disabled = !now;
    $('wbInput').readOnly = !now;
    $('wbInput').placeholder = now ? `a word with ${w.chunk}` : w.stage === 'lit' ? `wait for the bomb…` : '';
    if (now && !myTurnWas) {
      $('wbInput').value = ''; typed = '';
      ctx.sfx('tick'); ctx.buzz?.(30);
      if (!first) $('wbInput').focus?.({ preventScroll: true });
    }
    if (!now && myTurnWas) $('wbInput').value = '';
    myTurnWas = now;

    // 🔤 your alphabet
    const alpha = $('wbAlpha'); alpha.innerHTML = '';
    alpha.hidden = !w.alphabet || !w.seats.includes(me);
    const have = w.letters[me] || '';
    for (const ch of w.alphabet) alpha.append(ctx.el('span', have.includes(ch) ? 'on' : '', ch));
    if (w.alphabet) alpha.title = `${have.length}/${w.alphabet.length} letters: use them all for a ♥ back`;

    paintSeats();

    const box = $('wbScores'); box.innerHTML = '';
    const rows = w.seats.map((pid) => ctx.player(pid)).filter(Boolean)
      .sort((a, b) => (w.lives[b.id] ?? 0) - (w.lives[a.id] ?? 0) || (w.words[b.id] ?? 0) - (w.words[a.id] ?? 0));
    for (const p of rows) {
      const row = ctx.el('div', 'wb-row' + (p.id === w.holder ? ' holding' : ''));
      const nm = ctx.el('b', '', p.name); nm.style.color = p.color;
      const lives = w.lives[p.id] ?? 0;
      row.append(nm, ctx.el('span', 'wb-hearts', lives ? '♥'.repeat(lives) : '💀'),
        ctx.el('span', 'wb-count', `${w.words[p.id] ?? 0} words` + (w.alphabet ? ` · 🔤 ${(w.letters[p.id] || '').length}/${w.alphabet.length}` : '')));
      box.append(row);
    }
    if (w.longest) box.append(ctx.el('p', 'hint left', `📏 Longest: ${w.longest.word} (${ctx.player(w.longest.by)?.name ?? '?'})`));
  }

  // live updates: the holder's typing, and refused words
  function fast(d) {
    if (!S?.wordbomb) return;
    if (d.no) { if (d.by !== S.me.id) { showMiss(d.by, d.w, d.no); ctx.sfx('wrong'); } return; }
    if (d.ty != null && d.by === W().holder && d.by !== S.me.id) { typedBy = d.by; typed = d.ty; ctx.sfx('tick', 6); paintSeats(); }
  }

  function turnText(s) {
    const w = s.wordbomb;
    if (s.phase !== 'playing') return null;
    if (w.stage !== 'lit') return '💥 Boom! Next bomb coming…';
    if (w.holder === s.me.id) return `💣 Your bomb! A word with ${w.chunk}`;
    return `💣 ${s.players.find((p) => p.id === w.holder)?.name ?? '…'} has the bomb`;
  }

  return { mount, render, unmount, fast, turnText, ownTimer: () => true };
})();
