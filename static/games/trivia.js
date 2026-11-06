// Trivia Rush: the question, a shrinking time bar and four big answer buttons. After everyone answers
// (or time runs out) the right answer lights up with who picked what.
UI.trivia = (() => {
  let S, ctx, receivedAt = 0, tickTimer = 0, seenQ = '', myRank = null, lastTick = 0;
  const $ = (id) => document.getElementById(id);
  const LETTERS = 'ABCD';

  function mount(main, side) {
    seenQ = ''; myRank = null;
    main.innerHTML = `<div class="tv">
      <div class="tv-head"><span id="tvNum"></span><span id="tvTopic" class="tv-topic"></span></div>
      <div class="dd-bar"><span id="tvBar"></span></div>
      <div id="tvQ" class="tv-q"></div>
      <div id="tvOpts" class="tv-opts"></div>
      <button id="tvFifty" class="tv-fifty" hidden>✂️ 50:50</button>
      <div id="tvNote" class="tv-note"></div></div>`;
    side.innerHTML = '<div class="panel"><h3>Scores</h3><div id="tvScores"></div><p class="hint left">Right answers score 100, plus up to 100 for speed. The last question counts double.</p></div>';
    tickTimer = setInterval(tick, 150);
    $('tvFifty').onclick = () => { ctx.sfx('whoosh'); ctx.quiet(ctx.act('fifty')); };
  }

  function unmount() { clearInterval(tickTimer); }

  function tick() {
    if (!S?.trivia || !$('tvBar')) return;
    const t = S.trivia;
    const left = Math.max(0, t.left - (performance.now() - receivedAt) / 1000);
    const asking = S.phase === 'playing' && t.stage === 'ask';
    $('tvBar').style.width = `${asking ? (left / t.secs) * 100 : 0}%`;
    $('tvBar').parentElement.classList.toggle('last', asking && left < 4);
    // the last few seconds tick, louder for anyone still to answer
    if (asking && left < 4 && left > 0 && Math.ceil(left) !== lastTick) { lastTick = Math.ceil(left); if (t.playing && t.mine == null) ctx.sfx('tickfast'); }
  }

  function render(s, c) {
    S = s; ctx = c; receivedAt = performance.now();
    const t = S.trivia, rv = t.reveal;
    $('tvNum').textContent = `Q${t.n}/${t.total}${t.final ? ' · 🔥 double points' : ''}`;
    $('tvTopic').textContent = t.topic;
    // each topic tints the question card, with its emoji large in the corner
    const hue = [...t.topic].reduce((h, ch) => (h * 31 + ch.codePointAt(0)) % 360, 7);
    $('tvQ').style.setProperty('--tv-hue', hue);
    $('tvQ').dataset.emoji = [...t.topic][0] || '';
    $('tvQ').textContent = t.text;
    if (t.claim) $('tvQ').append(ctx.el('div', 'tv-claim', `→ ${t.claim}`), ctx.el('small', 'tv-tf', 'True or false?'));

    const opts = $('tvOpts'); opts.innerHTML = '';
    opts.classList.toggle('two', t.options.length === 2);
    const canPick = S.phase === 'playing' && t.stage === 'ask' && t.playing && t.mine == null && !!ctx.act;
    const cut = new Set(t.cut || []);
    const picks = rv ? Object.values(rv.picks) : [];
    t.options.forEach((text, i) => {
      const b = ctx.el('button', `tv-opt c${i}` + (cut.has(i) && !rv ? ' cut' : ''));
      // at the reveal each answer fills with the share of the table that picked it
      if (rv && picks.length > 1) b.style.setProperty('--share', picks.filter((k) => k === i).length / picks.length);
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
      b.disabled = !canPick || (cut.has(i) && !rv);
      b.onclick = () => { ctx.sfx('lock'); ctx.quiet(ctx.act('answer', { i })); };
      opts.append(b);
    });
    const ff = $('tvFifty');
    ff.hidden = t.fifty == null || (!t.fifty && !cut.size) || t.options.length < 4 || (!canPick && !cut.size) || !!rv;
    ff.disabled = !t.fifty || !canPick;
    ff.textContent = t.fifty ? '✂️ Use your 50:50' : '✂️ 50:50 used';

    // the answer lands: a chime or a buzz, and my points float up off my button
    const qk = `${t.n}:${t.stage}`;
    if (rv && seenQ && qk !== seenQ && t.playing) {
      const g = rv.gained[S.me.id];
      if (t.mine != null) {
        ctx.sfx(g ? 'good' : 'wrong');
        if (g) Kit.flyText(opts.children[t.mine], `+${g}`, 'good');
        else { const w = opts.children[t.mine]; w.classList.add('shake'); }
      }
      if (g && t.streak >= 3) Kit.callout(`🔥 ${t.streak} in a row!`, 'gold', { ms: 1200 });
    }
    seenQ = qk;
    let note = '';
    if (rv) {
      const g = rv.gained[S.me.id];
      note = !t.playing ? '' : t.mine == null ? '⏰ No answer this time.' : g ? `✅ Right! +${g}${t.streak > 2 ? ` · 🔥 ${t.streak} in a row (+${50 * Math.min(t.streak - 2, 3)} streak bonus)` : t.streak > 1 ? ' · 🔥 2 in a row: one more for a bonus' : ''}` : '❌ Not this time.';
      const quick = rv.fastest && ctx.player(rv.fastest);
      if (quick) note += `${note ? ' · ' : ''}⚡ ${rv.fastest === S.me.id ? 'You were' : `${quick.name} was`} quickest!`;
    } else if (t.playing && t.mine != null) {
      const waiting = S.players.filter((p) => !p.spectator && !p.eliminated && !t.answered.includes(p.id)).length;
      note = `Locked in! ${waiting ? `Waiting for ${waiting} more…` : ''}`;
    }
    if (t.solo) note += `${note ? ' · ' : ''}${t.right} right so far (need ${t.goal})`;
    $('tvNote').textContent = note;

    // the scoreboard re-sorts with rows sliding to their new places; taking or losing the lead is called out
    const box = $('tvScores'), before = Kit.snap(box); box.innerHTML = '';
    const rows = S.players.filter((p) => !p.spectator).slice().sort((a, b) => (parseInt(b.meta) || 0) - (parseInt(a.meta) || 0));
    const rank = rows.findIndex((p) => p.id === S.me.id);
    if (rv && myRank != null && rank >= 0 && rank !== myRank && rows.length > 1) {
      if (rank === 0) Kit.callout('👑 You take the lead!', 'gold', { ms: 1300 });
      else if (rank > myRank) Kit.flyText(box, '⬇ Overtaken!', 'bad');
    }
    if (rank >= 0 && (rv || myRank == null)) myRank = rank;
    for (const p of rows) {
      const row = ctx.el('div', 'seat-row');
      row.dataset.k = p.id;
      const dot = ctx.el('span', 'dot'); dot.style.background = p.color;
      const gain = rv?.gained[p.id];
      row.append(dot, ctx.el('span', '', `${p.name}: ${p.meta || '0 pts'}${gain ? ` (+${gain})` : ''}`));
      box.append(row);
    }
    Kit.glide(box, before, 450);
    tick();
  }

  const turnText = (s) => s.phase !== 'playing' ? null
    : s.trivia.stage === 'reveal' ? '🧠 The answer is…' : !s.trivia.playing ? '🧠 Watching' : s.trivia.mine == null ? '🧠 Pick an answer!' : '🧠 Locked in';
  const myMove = (s) => s.phase === 'playing' && s.trivia.stage === 'ask' && s.trivia.playing && s.trivia.mine == null;

  return { mount, render, unmount, turnText, myMove };
})();
