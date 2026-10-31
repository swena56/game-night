// Trivia Rush: the question, a shrinking time bar and four big answer buttons. After everyone answers
// (or time runs out) the right answer lights up with who picked what.
UI.trivia = (() => {
  let S, ctx, receivedAt = 0, tickTimer = 0;
  const $ = (id) => document.getElementById(id);
  const LETTERS = 'ABCD';

  function mount(main, side) {
    main.innerHTML = `<div class="tv">
      <div class="tv-head"><span id="tvNum"></span><span id="tvTopic" class="tv-topic"></span></div>
      <div class="dd-bar"><span id="tvBar"></span></div>
      <div id="tvQ" class="tv-q"></div>
      <div id="tvOpts" class="tv-opts"></div>
      <div id="tvNote" class="tv-note"></div></div>`;
    side.innerHTML = '<div class="panel"><h3>Scores</h3><div id="tvScores"></div><p class="hint left">Right answers score 100, plus up to 100 for speed. The last question counts double.</p></div>';
    tickTimer = setInterval(tick, 150);
  }

  function unmount() { clearInterval(tickTimer); }

  function tick() {
    if (!S?.trivia || !$('tvBar')) return;
    const t = S.trivia;
    const left = Math.max(0, t.left - (performance.now() - receivedAt) / 1000);
    const asking = S.phase === 'playing' && t.stage === 'ask';
    $('tvBar').style.width = `${asking ? (left / t.secs) * 100 : 0}%`;
    $('tvBar').parentElement.classList.toggle('last', asking && left < 4);
  }

  function render(s, c) {
    S = s; ctx = c; receivedAt = performance.now();
    const t = S.trivia, rv = t.reveal;
    $('tvNum').textContent = `Q${t.n}/${t.total}${t.final ? ' · 🔥 double points' : ''}`;
    $('tvTopic').textContent = t.topic;
    $('tvQ').textContent = t.text;

    const opts = $('tvOpts'); opts.innerHTML = '';
    const canPick = S.phase === 'playing' && t.stage === 'ask' && t.playing && t.mine == null && !!ctx.act;
    t.options.forEach((text, i) => {
      const b = ctx.el('button', `tv-opt c${i}`);
      b.append(ctx.el('b', '', LETTERS[i]), ctx.el('span', '', text));
      if (t.mine === i) b.classList.add('mine');
      if (rv) {
        b.classList.add(i === rv.right ? 'right' : t.mine === i ? 'wrong' : 'dim');
        const who = Object.entries(rv.picks).filter(([, k]) => k === i).map(([pid]) => ctx.player(pid));
        if (who.length) {
          const dots = ctx.el('span', 'tv-who');
          for (const p of who) {
            const d = ctx.el('span', 'dot' + (p && p.id === rv.fastest ? ' fastest' : '')); d.style.background = p?.color ?? '#777'; d.title = p?.name ?? '?';
            dots.append(d);
          }
          b.append(dots);
        }
      }
      b.disabled = !canPick;
      b.onclick = () => ctx.quiet(ctx.act('answer', { i }));
      opts.append(b);
    });

    let note = '';
    if (rv) {
      const g = rv.gained[S.me.id];
      note = !t.playing ? '' : t.mine == null ? '⏰ No answer this time.' : g ? `✅ Right! +${g}${t.streak > 1 ? ` · 🔥 ${t.streak} in a row` : ''}` : '❌ Not this time.';
      const quick = rv.fastest && ctx.player(rv.fastest);
      if (quick) note += `${note ? ' · ' : ''}⚡ ${rv.fastest === S.me.id ? 'You were' : `${quick.name} was`} quickest!`;
    } else if (t.playing && t.mine != null) {
      const waiting = S.players.filter((p) => !p.spectator && !p.eliminated && !t.answered.includes(p.id)).length;
      note = `Locked in! ${waiting ? `Waiting for ${waiting} more…` : ''}`;
    }
    if (t.solo) note += `${note ? ' · ' : ''}${t.right} right so far (need ${t.goal})`;
    $('tvNote').textContent = note;

    const box = $('tvScores'); box.innerHTML = '';
    const rows = S.players.filter((p) => !p.spectator).slice().sort((a, b) => (parseInt(b.meta) || 0) - (parseInt(a.meta) || 0));
    for (const p of rows) {
      const row = ctx.el('div', 'seat-row');
      const dot = ctx.el('span', 'dot'); dot.style.background = p.color;
      const gain = rv?.gained[p.id];
      row.append(dot, ctx.el('span', '', `${p.name}: ${p.meta || '0 pts'}${gain ? ` (+${gain})` : ''}`));
      box.append(row);
    }
    tick();
  }

  const turnText = (s) => s.phase !== 'playing' ? null
    : s.trivia.stage === 'reveal' ? '🧠 The answer is…' : !s.trivia.playing ? '🧠 Watching' : s.trivia.mine == null ? '🧠 Pick an answer!' : '🧠 Locked in';
  const myMove = (s) => s.phase === 'playing' && s.trivia.stage === 'ask' && s.trivia.playing && s.trivia.mine == null;

  return { mount, render, unmount, turnText, myMove };
})();
