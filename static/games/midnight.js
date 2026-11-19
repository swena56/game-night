// Midnight (1-4-24): the qualifier slots for the 1 and the 4, the kept dice, and the fresh roll. Tap
// dice in the roll to pick which to keep (at least one), then Keep: the rest are rolled again.
UI.midnight = (() => {
  let S, ctx, pick = new Set(), rollKey = '', seenLast = -1;
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    pick = new Set(); rollKey = ''; seenLast = -1; Kit.reset('md:');
    main.innerHTML = `<div class="md">
      <div id="mdTurn" class="md-turn"></div>
      <div class="md-clock" aria-hidden="true"><i class="md-ticks"></i><div id="mdHand" class="md-hand"></div><span>12</span><b class="md-moon">🌙</b></div>
      <div class="md-quals"><div id="mdQ1" class="md-q"></div><div id="mdQ4" class="md-q"></div><div id="mdPts" class="md-pts"></div></div>
      <div id="mdKept" class="ya-dice md-kept"></div>
      <div class="ya-tray"><div id="mdDice" class="ya-dice"></div></div>
      <div class="row md-actions"><button id="mdRoll" class="primary big">🎲 Roll</button><button id="mdKeep" class="primary big"></button></div>
      <p id="mdHint" class="hint"></p>
      <div id="mdOdds" class="md-odds"></div>
      <div id="mdLast" class="md-last"></div></div>`;
    side.innerHTML = `<div class="panel"><h3>Scores</h3><div id="mdScores"></div>
      <p class="hint left">Keep a 1 and a 4; the other four dice score. 24 is 🕛 midnight.</p>
      <div id="mdBest" hidden><h3>🏅 Best solo games</h3><ol class="ya-best"></ol><p class="hint left">Kept on this device.</p></div></div>`;
    $('mdRoll').onclick = () => ctx.quiet(ctx.act('roll', {}));
    $('mdKeep').onclick = () => { const d = [...pick].sort(); pick = new Set(); ctx.quiet(ctx.act('keep', { dice: d })); };
  }

  function render(s, c) {
    S = s; ctx = c;
    const m = S.midnight;
    const mine = ctx.myTurn && !!ctx.act && S.phase === 'playing';
    const who = ctx.player(S.turn);
    $('mdTurn').textContent = S.phase !== 'playing' ? '' : `Round ${m.round}/${m.rounds} · ${mine ? 'Your turn' : `${who?.name ?? '?'}'s turn`}`;

    // the clock hand creeps toward midnight as the score climbs
    $('mdHand').style.setProperty('--turn', `${(m.h1 && m.h4 ? m.pts : Math.min(m.pts, 20)) / 24 * 360 - 180}deg`);
    $('mdHand').classList.toggle('dead', m.kept.length === 6 && !(m.h1 && m.h4));

    for (const [id, v, have] of [['mdQ1', 1, m.h1], ['mdQ4', 4, m.h4]]) {
      const q = $(id); q.innerHTML = ''; q.classList.toggle('got', have);
      Kit.onNew(`md:${id}`, `${S.turn}|${m.round}|${!!have}`, () => { if (have) { q.classList.remove('lit'); void q.offsetWidth; q.classList.add('lit'); } });
      q.append(have ? Dice.die(v, 'small') : ctx.el('span', 'md-need', String(v)), ctx.el('small', '', have ? 'got it' : `need a ${v}`));
    }
    $('mdPts').textContent = `${m.pts} pts` + (m.h1 && m.h4 ? '' : ' (if you qualify)');

    const kept = $('mdKept'); kept.innerHTML = '';
    // the 1 and 4 that qualify sit in their slots; everything else kept is score
    const rest = [...m.kept];
    for (const [v, h] of [[1, m.h1], [4, m.h4]]) if (h) rest.splice(rest.indexOf(v), 1);
    rest.forEach((v) => kept.append(Dice.die(v, 'small' + (v === 6 ? ' md-six' : ''))));
    for (let i = rest.length; i < 4; i++) kept.append(Dice.die(0, 'small blank'));

    const rk = `${S.turn}|${m.n}`;
    const fresh = m.dice.length && rk !== rollKey && rollKey !== '';
    if (rk !== rollKey) pick = new Set();
    rollKey = rk;
    const tray = $('mdDice'); tray.innerHTML = '';
    const nodes = m.dice.map((v, i) => {
      const b = Dice.die(v, pick.has(i) ? 'held' : '', 'button');
      b.disabled = !mine;
      b.setAttribute('aria-label', `${v}${pick.has(i) ? ', keeping' : ''}`);
      b.onclick = () => { pick.has(i) ? pick.delete(i) : pick.add(i); render(S, ctx); };
      tray.append(b);
      return b;
    });
    if (fresh) Dice.roll(nodes);

    $('mdRoll').hidden = !mine || m.dice.length > 0;
    $('mdKeep').hidden = !mine || !m.dice.length;
    $('mdKeep').disabled = !pick.size;
    const all = pick.size === m.dice.length;
    $('mdKeep').textContent = !pick.size ? 'Tap dice to keep' : all ? `✋ Keep ${pick.size} and finish` : `✋ Keep ${pick.size}, roll ${m.dice.length - pick.size}`;
    $('mdHint').textContent = !mine ? '' : !m.dice.length ? 'Roll all six dice.'
      : (!m.h1 && m.dice.includes(1)) || (!m.h4 && m.dice.includes(4)) ? 'Grab the 1 and the 4 when you see them!' : 'Keep at least one die each roll.';

    // 📊 keep everything now vs. keep your pick and reroll the rest (exact odds from the server)
    const odds = $('mdOdds'); odds.innerHTML = '';
    if (mine && m.risk) {
      const R = m.risk, key = [...pick].map((i) => m.dice[i]).sort((a, b) => b - a).join('');
      const line = (label, ev, q, cls = '') => {
        const row = ctx.el('div', 'md-orow ' + cls);
        row.append(ctx.el('span', '', label), ctx.el('b', '', `avg ${ev}`), ctx.el('span', q < 100 ? 'md-risk' : 'md-safe', `${q}% to qualify`));
        return row;
      };
      const allKey = m.dice.join('');
      odds.append(ctx.el('div', 'md-orow', `✋ Keep all ${m.dice.length} now: ${R.stop ? `${R.stop} pts` : '0 (no 1 and 4)'}`));
      if (key && key !== allKey && R.options[key]) odds.append(line(`🎲 Keep ${key.split('').join(' ')}, reroll ${m.dice.length - pick.size}:`, ...R.options[key], 'pick'));
      if (R.best !== key) odds.append(line(`⭐ Best: keep ${R.best.split('').join(' ')}${R.best === allKey ? '' : `, reroll ${m.dice.length - R.best.length}`}:`, ...R.options[R.best]));
      odds.append(ctx.el('small', 'hint', 'Averages assume best play from here.'));
    }

    const last = $('mdLast'); last.innerHTML = '';
    if (m.last) {
      const p = ctx.player(m.last.by);
      if (m.last.n !== seenLast && seenLast !== -1) {
        if (m.last.ok && m.last.pts === 24) Kit.callout('🕛 MIDNIGHT!', 'gold', { sound: 'fanfare' });
        else if (!m.last.ok) Kit.callout('💤 No qualifier', 'bad', { ms: 1100 });
      }
      seenLast = m.last.n;
      const line = ctx.el('div', 'md-lastline');
      const name = ctx.el('b', '', p?.name ?? '?'); name.style.color = p?.color ?? 'inherit';
      line.append(name, ctx.el('span', '', m.last.ok ? ` scored ${m.last.pts} ` : ' missed the 1-4: 0 '));
      m.last.kept.forEach((v) => line.append(Dice.die(v, 'small')));
      last.append(line);
    }

    const box = $('mdScores');
    Kit.scoreboard(box, m.seats.filter((pid) => ctx.player(pid)).map((pid) => ({
      p: ctx.player(pid), score: m.scores[pid] ?? 0, note: m.moons ? `${m.moons[pid] ?? 0} 🌙` : '', me: pid === S.me.id, turn: S.turn === pid,
    })), { lead: true });
    if (m.solo) box.append(ctx.el('div', 'hint left', `Solo goal: ${m.goal}`));
    if (m.solo && m.seats[0] === S.me.id && !!ctx.act) soloBest($('mdBest'), `midnight.best.${m.rounds}`, `${S.code}#${S.gameNo}`, m.scores[S.me.id] ?? 0, S.phase === 'over', { fmt: (v) => `${v} pts` });
  }

  const turnText = (s) => s.phase !== 'playing' || s.turn !== s.me.id ? null : s.midnight.dice.length ? '🕛 Keep some dice' : '🕛 Roll!';

  return { mount, render, turnText };
})();
