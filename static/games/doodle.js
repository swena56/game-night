// Doodle Dash: strokes arrive from the server as they start; each new stroke animates over its time slot.
UI.doodle = (() => {
  let hintSeen = { round: 0, hint: '' };
  let S, ctx, svg, drawnRound = 0, drawnCount = 0, receivedAt = 0, tickTimer = 0, seenSolved = '', lastTick = 0;
  const NS = 'http://www.w3.org/2000/svg';
  const MARKERS = ['#2b2140', '#1d4ed8', '#b91c1c', '#047857', '#7c3aed', '#c2410c'];
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    drawnRound = 0; drawnCount = 0; seenSolved = '';
    main.innerHTML = `<div class="dd">
      <div class="dd-head"><span id="ddCat" class="dd-cat"></span><span id="ddRound" class="dd-round"></span></div>
      <div class="dd-paper"><svg id="ddSvg" viewBox="-4 -4 108 108"></svg><div id="ddAnswer" class="dd-answer" hidden></div><div id="ddWait" class="dd-wait" hidden>🖍️ Get ready…</div></div>
      <div class="dd-bar"><span id="ddBar"></span></div>
      <div id="ddHint" class="dd-hint"></div>
      <form id="ddForm" class="row dd-form" autocomplete="off">
        <input id="ddGuess" maxlength="40" placeholder="What is it?" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send">
        <button class="primary" id="ddSend">Guess</button>
      </form>
      <div id="ddStatus" class="dd-status"></div></div>`;
    side.innerHTML = '<div class="panel"><h3>This picture</h3><div id="ddSolvers"></div></div>';
    svg = $('ddSvg');
    $('ddForm').onsubmit = (e) => {
      e.preventDefault();
      const text = $('ddGuess').value.trim();
      if (!text) return;
      $('ddGuess').value = '';
      ctx.quiet(ctx.act('guess', { text }));
    };
    tickTimer = setInterval(tick, 200);
  }

  function unmount() { clearInterval(tickTimer); }

  // progress bar and lockout countdown move smoothly between server updates
  function tick() {
    if (!S?.doodle || !$('ddBar')) return;
    const d = S.doodle, since = (performance.now() - receivedAt) / 1000;
    const drawn = d.stage === 'draw' ? d.drawn + since / d.secs : 1;
    const last = drawn >= 1 && d.stage === 'draw';  // finished drawing: the bar becomes the last-chance timer
    const width = last ? (d.left - since) / d.grace : drawn;
    $('ddBar').style.width = `${Math.max(0, Math.min(1, width)) * 100}%`;
    $('ddBar').parentElement.classList.toggle('last', last);
    // hurry: the last five seconds tick
    const secsLeft = last ? d.left - since : Infinity;
    if (secsLeft < 5 && secsLeft > 0 && Math.ceil(secsLeft) !== lastTick && !S.doodle.solvers.some(([pid]) => pid === S.me.id) && S.phase === 'playing') {
      lastTick = Math.ceil(secsLeft); ctx.sfx('tickfast');
    }
    const locked = Math.max(0, d.locked - since);
    const me = S.doodle.solvers.some(([pid]) => pid === S.me.id);
    const live = S.phase === 'playing' && d.stage === 'draw' && !S.me.spectator && !me && ctx.act;
    $('ddGuess').disabled = $('ddSend').disabled = !live || locked > 0;
    $('ddStatus').textContent = locked > 0 ? `❌ Locked for ${Math.ceil(locked)}s` : me ? `✅ You got it: ${(d.answer || '').toUpperCase()}` : '';
  }

  function addStroke(dPath, animSecs, delay) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', dPath);
    p.setAttribute('pathLength', '1');
    p.setAttribute('class', 'dd-ink');
    if (animSecs > 0) p.style.animation = `dddraw ${animSecs}s linear ${-delay}s both`;
    svg.append(p);
  }

  function render(s, c) {
    S = s; ctx = c; receivedAt = performance.now();
    const d = S.doodle;
    if (d.round !== drawnRound || d.strokes.length < drawnCount) {
      // a fresh sheet, with a marker of its own colour (and a slightly wobbly, inky line)
      svg.innerHTML = '<defs><filter id="ddMarker" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="1" seed="3"/><feDisplacementMap in="SourceGraphic" scale="1.1"/></filter></defs>';
      svg.style.setProperty('--ink', MARKERS[d.round % MARKERS.length]);
      drawnRound = d.round; drawnCount = 0;
    }
    for (let i = drawnCount; i < d.strokes.length; i++) {
      const newest = i === d.strokes.length - 1;
      if (d.stage === 'reveal') addStroke(d.strokes[i], 0.35, -(i - drawnCount) * 0.12);  // finish quickly
      else if (newest && d.age < d.per) addStroke(d.strokes[i], d.per * 0.9, Math.min(d.age, d.per * 0.9));
      else addStroke(d.strokes[i], 0, 0);
    }
    drawnCount = d.strokes.length;

    $('ddCat').textContent = `🏷️ ${d.category}`;
    $('ddRound').textContent = `${d.round} / ${d.rounds}`;
    const hint = $('ddHint'); hint.innerHTML = '';
    const shownLetters = hintSeen.round === d.round ? hintSeen.hint : '';
    [...d.hint].forEach((ch, i) => hint.append(ctx.el('span', (ch === ' ' ? 'gap' : ch === '_' ? 'blank' : 'letter') + (ch !== '_' && ch !== ' ' && shownLetters[i] === '_' && d.stage === 'draw' ? ' late' : ''), ch === '_' ? '' : ch)));
    if (d.stage === 'draw' && shownLetters && [...d.hint].some((ch, i) => ch !== '_' && shownLetters[i] === '_')) ctx.sfx('pop');
    hintSeen = { round: d.round, hint: d.hint };
    hint.classList.toggle('reveal', d.stage === 'reveal');
    const ans = $('ddAnswer');
    ans.hidden = d.stage !== 'reveal';
    $('ddWait').hidden = !(d.stage === 'draw' && !d.strokes.length);
    // the reveal card: what it was, its category, and who got it (first)
    ans.innerHTML = '';
    if (d.stage === 'reveal') {
      const first = d.solvers[0] && ctx.player(d.solvers[0][0]);
      const mineAt = d.solvers.findIndex(([pid]) => pid === S.me.id);
      ans.append(ctx.el('small', 'dd-card-cat', `🏷️ ${d.category}`), ctx.el('b', 'dd-card-word', d.answer.toUpperCase()),
        ctx.el('span', 'dd-card-who', !first ? '🙈 Nobody got it'
          : `⚡ ${first.id === S.me.id ? 'You' : first.name} got it first (+${d.solvers[0][1]})`
            + (d.solvers.length > 1 ? ` · ${d.solvers.length} got it` : '')
            + (mineAt > 0 ? ` · you were #${mineAt + 1}` : '')));
      const st = ctx.el('div', 'dd-stand'); ans.append(st);
      standingsCard(st, d.standings, { title: `After picture ${d.round} of ${d.rounds}` });
    }

    // someone getting it pops up over the picture with a ding (a big one when it's me)
    const solvedKey = `${d.round}:${d.solvers.length}`;
    if (seenSolved && solvedKey !== seenSolved && d.solvers.length && seenSolved.split(':')[0] === String(d.round)) {
      const [pid, pts] = d.solvers.at(-1), p = ctx.player(pid);
      if (pid === S.me.id) { ctx.sfx('good'); Kit.callout(`✅ +${pts}`, 'good', { ms: 1100 }); if (d.solvers.length === 1) ctx.confetti(); }
      else { ctx.sfx('pop'); Kit.flyText(svg, `${p?.name ?? '?'} got it!`, 'info'); }
    }
    seenSolved = solvedKey;
    const box = $('ddSolvers'); box.innerHTML = '';
    if (!d.solvers.length) box.append(ctx.el('p', 'hint left', d.stage === 'draw' ? 'Nobody has it yet…' : 'Nobody got it.'));
    for (const [pid, pts] of d.solvers) {
      const p = ctx.player(pid);
      const row = ctx.el('div', 'seat-row');
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = p?.color ?? '#888';
      row.append(dot, `${p?.name ?? '?'} +${pts}`);
      box.append(row);
    }
    box.append(ctx.el('p', 'hint left', d.mode === 'race' ? '⚡ First correct guess takes the picture.' : '🙌 Everyone can score; the first gets +2.'));
    tick();
  }

  function turnText(s) {
    const d = s.doodle;
    if (s.phase !== 'playing') return null;
    return d.stage === 'reveal' ? `🎨 It was ${d.answer}!` : `✏️ Picture ${d.round}/${d.rounds} — ${d.category}`;
  }
  const myMove = (s) => s.doodle.stage === 'draw' && !s.doodle.solvers.some(([pid]) => pid === s.me.id) && !s.me.spectator;

  return { mount, render, unmount, turnText, myMove };
})();
