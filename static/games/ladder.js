// Word Ladder: the start word at the top, your steps below it, an entry box, and the goal word at the
// bottom. Each step shows which letter changed. After the round everyone's ladders are revealed.
UI.ladder = (() => {
  let S, ctx, receivedAt = 0, tickTimer = 0, busy = false, seenProgress = {}, seenLen = null;
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    busy = false; seenProgress = {}; seenLen = null;
    main.innerHTML = `<div class="ld">
      <div class="ld-head"><span id="ldRound"></span><span id="ldPar" class="ld-par"></span></div>
      <div class="dd-bar"><span id="ldBar"></span></div>
      <div id="ldLadder" class="ld-ladder"></div>
      <form id="ldForm" class="ld-entry" autocomplete="off">
        <button type="button" id="ldUndo" title="Take back a step">↩</button>
        <input id="ldInput" maxlength="5" autocapitalize="characters" spellcheck="false" enterkeyhint="go" aria-label="Next word">
        <button type="submit" id="ldGo" class="primary">Step</button>
        <button type="button" id="ldPeek" title="Show which letter to change next (1 point)">🔎</button>
        <button type="button" id="ldHint" title="Fill in the next step (3 points)">💡</button>
      </form>
      <div id="ldNote" class="ld-note"></div>
      <div id="ldGoal" class="ld-ladder ld-goal"></div>
      <div id="ldReveal" class="ld-reveal" hidden></div></div>`;
    side.innerHTML = '<div class="panel"><h3>Climbers</h3><div id="ldScores"></div><p class="hint left">Change one letter per step. 🔎 shows which letter to change for 1 point, 💡 fills in a step for 3; taking a step back is free.</p></div>';
    $('ldForm').onsubmit = (e) => {
      e.preventDefault();
      const w = $('ldInput').value.trim().toUpperCase();
      if (w) send('step', { word: w }, true);
    };
    $('ldUndo').onclick = () => send('undo', {});
    $('ldHint').onclick = () => send('hint', {});
    $('ldPeek').onclick = () => send('peek', {});
    tickTimer = setInterval(tick, 200);
  }

  let lastTick = 0;
  function unmount() { clearInterval(tickTimer); }

  const live = () => S?.phase === 'playing' && S.ladder.stage === 'climb' && S.ladder.playing && !S.ladder.done && !!ctx.act;

  function send(type, extra, clear) {
    if (!live() || busy) return;
    busy = true;
    ctx.act(type, extra).then(() => { if (clear) $('ldInput').value = ''; })
      .catch((err) => {
        ctx.toast(err?.message || 'Try another word.');
        if (type === 'step') {  // a word that won't do: the entry shakes and buzzes
          ctx.sfx('wrong'); ctx.buzz?.(40);
          const f = $('ldForm'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
        }
      })
      .finally(() => { busy = false; $('ldInput')?.focus?.(); });
  }

  function tick() {
    if (!S?.ladder || !$('ldBar')) return;
    const l = S.ladder;
    const left = Math.max(0, l.left - (performance.now() - receivedAt) / 1000);
    const climbing = S.phase === 'playing' && l.stage === 'climb';
    $('ldBar').style.width = `${climbing ? (left / l.secs) * 100 : 0}%`;
    $('ldBar').parentElement.classList.toggle('last', climbing && left < 10);
    // the last ten seconds tick
    const sec = Math.ceil(left);
    if (climbing && live() && sec <= 10 && sec > 0 && sec !== lastTick) { lastTick = sec; ctx.sfx('tickfast'); }
  }

  // One row of letter tiles; the letter that changed from `prev` is marked, and letters already matching the
  // goal word in the same spot are green, so you can see how close each rung is.
  function rung(word, prev, cls = '', goal = null) {
    const row = ctx.el('div', `ld-rung ${cls}`);
    [...word].forEach((ch, i) => row.append(ctx.el('span', 'ld-tile' + (prev && prev[i] !== ch ? ' new' : '') + (goal && goal[i] === ch ? ' hit' : ''), ch)));
    return row;
  }

  function ladderOf(path, target, box, fresh = -1) {
    path.forEach((w, i) => box.append(rung(w, i ? path[i - 1] : null, (i === 0 ? 'start' : w === target ? 'goal done' : '') + (i === fresh ? ' fresh' : ''), w === target ? null : target)));
  }

  function render(s, c) {
    S = s; ctx = c; receivedAt = performance.now();
    const l = S.ladder, rv = l.reveal;
    $('ldRound').textContent = `🧗 Ladder ${l.round}/${l.rounds}`;
    $('ldPar').textContent = `${l.start} → ${l.target} · par ${l.par}`;
    $('ldInput').maxLength = l.len;
    $('ldInput').placeholder = `${l.len} letters`;

    const box = $('ldLadder'); box.innerHTML = '';
    // a new rung: its changed letter flips over and the climber's step clicks
    const key = `${l.round}:${l.path.length}`, fresh = seenLen && seenLen.split(':')[0] === String(l.round) && l.path.length > +seenLen.split(':')[1] ? l.path.length - 1 : -1;
    seenLen = key;
    ladderOf(l.path, l.target, box, fresh);
    if (fresh > 0) ctx.sfx(l.path[fresh] === l.target ? 'fanfare' : 'flip');
    // reaching the top: how it went
    if (fresh > 0 && l.path[fresh] === l.target) {
      const steps = l.path.length - 1, first = !Object.entries(l.progress).some(([pid, [, d]]) => d && pid !== S.me.id);
      Kit.callout(steps < l.par ? '🦅 Under par!' : steps === l.par ? '⛳ On par!' : first && !l.solo ? '🥇 First up!' : `🏁 ${steps} steps`, steps <= l.par || first ? 'gold' : 'good', { ms: 1400 });
    }
    // 🔎 a peek: the rung to come, with the letter to change marked
    if (l.peek != null && !l.done) {
      const ghost = ctx.el('div', 'ld-rung ghost');
      [...l.path.at(-1)].forEach((ch, i) => ghost.append(ctx.el('span', 'ld-tile' + (i === l.peek ? ' peek' : ''), i === l.peek ? '?' : ch)));
      box.append(ghost);
    }
    const goal = $('ldGoal'); goal.innerHTML = '';
    if (!l.done) goal.append(rung(l.target, null, 'goal'));

    const can = live();
    for (const id of ['ldInput', 'ldGo', 'ldHint']) $(id).disabled = !can;
    $('ldPeek').disabled = !can || l.peek != null;
    $('ldUndo').disabled = !can || l.path.length < 2;
    $('ldForm').hidden = !l.playing;
    // keep the entry row's space when you finish or the clock runs out, so the goal and note don't jump (#73)
    $('ldForm').classList.toggle('off', l.done || l.stage !== 'climb');

    const steps = l.path.length - 1;
    let note = '';
    if (rv) note = rv.gained[S.me.id] ? `🏁 +${rv.gained[S.me.id]} this ladder` : l.playing ? '⏰ Not this time.' : '';
    else if (l.done) note = `🏁 Done in ${steps} steps! Waiting for the others…`;
    else if (l.playing) note = `${steps} step${steps === 1 ? '' : 's'} so far`;
    $('ldNote').textContent = note;

    const rev = $('ldReveal'); rev.innerHTML = ''; rev.hidden = !rv;
    if (rv) {
      const best = ctx.el('div', 'ld-card');
      best.append(ctx.el('b', '', `🧗 A shortest ladder (${rv.solution.length - 1})`), ctx.el('div', 'ld-line', rv.solution.join(' → ')));
      rev.append(best);
      for (const [pid, path] of Object.entries(rv.paths)) {
        const p = ctx.player(pid);
        if (!p || pid === S.me.id) continue;
        const card = ctx.el('div', 'ld-card');
        const name = ctx.el('b', '', `${p.name}${path[path.length - 1] === l.target ? ` · 🏁 ${path.length - 1}` : ' · ✗'}`);
        name.style.color = p.color;
        card.append(name, ctx.el('div', 'ld-line', path.join(' → ')));
        rev.append(card);
      }
    }

    const scores = $('ldScores'); scores.innerHTML = '';
    const rows = S.players.filter((p) => !p.spectator).slice().sort((a, b) => (parseInt(b.meta) || 0) - (parseInt(a.meta) || 0));
    for (const p of rows) {
      const [n, done] = l.progress[p.id] ?? [0, false];
      const row = ctx.el('div', 'seat-row');
      const dot = ctx.el('span', 'dot'); dot.style.background = p.color;
      row.append(dot, ctx.el('span', 'grow', `${p.name}: ${parseInt(p.meta) || 0} pts · ${done ? '🏁' : `${n} step${n === 1 ? '' : 's'}`}`));
      // a little ladder per climber: one rung per step of par, lit as they climb, a flag when they're up
      const mini = ctx.el('span', 'ld-mini' + (done ? ' done' : ''));
      const rungs = Math.max(l.par, n);
      for (let k = 0; k < rungs; k++) mini.append(ctx.el('i', k < n ? 'on' : ''));
      mini.style.setProperty('--c', p.color);
      row.append(mini);
      scores.append(row);
      const was = seenProgress[p.id];
      if (was && p.id !== S.me.id && done && !was[1]) Kit.flyText(row, `🏁 ${p.name}`, 'info');
      seenProgress[p.id] = [n, done];
    }
    tick();
  }

  const turnText = (s) => s.phase !== 'playing' ? null
    : s.ladder.stage === 'reveal' ? '🧗 Ladders revealed' : !s.ladder.playing ? '🧗 Watching' : s.ladder.done ? '🧗 Done — waiting' : '🧗 Climb!';
  const myMove = (s) => s.phase === 'playing' && s.ladder.stage === 'climb' && s.ladder.playing && !s.ladder.done;

  return { mount, render, unmount, turnText, myMove };
})();
