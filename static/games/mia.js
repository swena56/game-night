// Mia: the call on the table, the cup (your own dice under it once you've rolled), and the buttons for
// this stage: roll, believe or lift, then pick the value to announce from the ladder of every value.
UI.mia = (() => {
  let S, ctx, choice = null, turnKey = '', seenReveal = -1, rollKey = '';
  const $ = (id) => document.getElementById(id);
  const DOUBLES = new Set([11, 22, 33, 44, 55, 66]);
  const label = (v) => v === 21 ? '🎭 Mia' : DOUBLES.has(v) ? `${v / 11}·${v / 11}` : String(v);
  const long = (v) => v === 21 ? 'Mia (21)' : DOUBLES.has(v) ? `double ${v / 11}s` : String(v);
  const read = (d) => Math.max(...d) * 10 + Math.min(...d);

  function mount(main, side) {
    choice = null; turnKey = ''; seenReveal = -1; rollKey = '';
    main.innerHTML = `<div class="mia">
      <div id="miaTurn" class="mia-turn"></div>
      <div id="miaCall" class="mia-call"></div>
      <div id="miaBluff" class="mia-bluff"></div>
      <div class="mia-table"><div id="miaCup" class="mia-cup" aria-hidden="true"><i class="mia-rim"></i></div><div id="miaDice" class="ya-dice mia-dice"></div></div>
      <div id="miaReveal" class="mia-reveal"></div>
      <div class="row mia-actions"><button id="miaRoll" class="primary big">🥤 Roll</button><button id="miaLift" class="big danger">🫳 Lift the cup</button><button id="miaConcede" class="big">🏳️ Concede 1 ❤️</button></div>
      <div id="miaLadder" class="mia-ladder"></div>
      <button id="miaSay" class="primary big mia-say"></button>
      <p id="miaHint" class="hint"></p></div>`;
    side.innerHTML = `<div class="panel"><h3>Lives</h3><div id="miaLives"></div><h3>This round</h3><ol id="miaCalls" class="mia-calls"></ol>
      <p class="hint left">Lowest to highest: 31 … 65, then doubles 1·1 … 6·6, then 🎭 Mia (2-1).</p></div>`;
    $('miaRoll').onclick = () => ctx.quiet(ctx.act('roll', {}));
    $('miaLift').onclick = () => ctx.quiet(ctx.act('lift', {}));
    $('miaConcede').onclick = () => ctx.quiet(ctx.act('concede', {}));
    $('miaSay').onclick = () => { if (choice) ctx.quiet(ctx.act('claim', { value: choice })); };
  }

  function render(s, c) {
    S = s; ctx = c;
    const m = S.mia;
    const mine = ctx.myTurn && !!ctx.act && S.phase === 'playing';
    const who = ctx.player(S.turn);
    const key = `${S.turn}|${m.n}`;
    if (key !== turnKey) { turnKey = key; choice = null; }
    $('miaTurn').textContent = S.phase !== 'playing' ? '' : mine ? 'Your turn' : `${who?.name ?? '?'}'s turn`;

    const call = $('miaCall'); call.innerHTML = '';
    if (m.claim) {
      const p = ctx.player(m.claimer);
      const n = ctx.el('b', '', p?.name ?? '?'); n.style.color = p?.color ?? 'inherit';
      call.append(n, ctx.el('span', '', ' says '), ctx.el('strong', 'mia-value' + (m.claim === 21 ? ' mia-mia' : ''), long(m.claim)));
    } else call.append(ctx.el('span', 'hint', 'A fresh round: any roll opens.'));

    // 🕵️ bluff meter: an estimate from the public calls and lives only, gone once the cup is shaken again
    const bl = $('miaBluff'); bl.innerHTML = '';
    if (m.bluff && m.claim) {
      const B = m.bluff, cl = ctx.player(m.claimer), heart = (n) => `${n} ❤️`;
      const meter = ctx.el('div', 'mia-meter'); const fill = ctx.el('i'); fill.style.width = `${B.pct}%`; meter.append(fill);
      bl.append(ctx.el('div', 'mia-blhead', `🕵️ About ${B.pct}% likely a bluff`), meter);
      const odds = [];
      if (m.claim !== 21) odds.push(`believe: a fresh roll beats it ${B.beat}% of the time`);
      odds.push(`lift: a true call costs the lifter ${heart(B.cost)}, a bluff costs ${cl?.name ?? '?'} ${heart(B.cost)}` + (B.claimerLives != null && B.claimerLives <= B.cost ? ' (their last!)' : ''));
      bl.append(ctx.el('div', 'mia-blodds', odds.join(' · ')), ctx.el('small', 'hint', 'An estimate from the calls alone — nobody has seen the dice.'));
    }

    // the cup: lifted to show your own dice once you've rolled; otherwise shut
    const cup = $('miaCup'), dice = $('miaDice');
    cup.classList.toggle('up', !!m.dice);
    cup.classList.toggle('shaken', m.rolled && !m.dice);
    dice.innerHTML = '';
    if (m.dice) {
      const nodes = m.dice.map((v) => Dice.die(v));
      dice.append(...nodes);
      const rk = `${S.turn}|${m.n}`;
      if (rk !== rollKey) Dice.roll(nodes);
      rollKey = rk;
      dice.append(ctx.el('div', 'mia-mine', `You rolled ${long(read(m.dice))}`));
    }

    // the last lift
    const rev = $('miaReveal'); rev.innerHTML = '';
    if (m.reveal) {
      const r = m.reveal, loser = ctx.player(r.loser), by = ctx.player(r.by);
      if (r.n !== seenReveal && seenReveal !== -1) {
        Kit.callout(r.honest === null ? '🏳️ Conceded' : r.honest ? '✅ True!' : '🤥 A bluff!', r.honest === false ? 'good' : 'gold', { ms: 1300, sound: 'whoosh' });
        setTimeout(() => {
          if (!$('miaLives')) return;
          Kit.stamp(document.querySelector('.mia-table'), r.honest === null ? 'Conceded' : r.honest ? 'True!' : 'Bluff!', r.honest === false ? 'bad' : 'good');
          Kit.flyText($('miaLives').querySelector(`[data-pid="${r.loser}"]`), `−${r.cost} ❤️`, 'bad');
        }, 350);
      }
      seenReveal = r.n;
      const line = ctx.el('div', 'mia-revline');
      if (r.dice) {
        line.append(ctx.el('span', '', `${by?.name ?? '?'} called ${long(r.claim)} and had `));
        r.dice.forEach((v) => line.append(Dice.die(v, 'small')));
      } else line.append(ctx.el('span', '', `${loser?.name ?? '?'} wouldn't lift ${by?.name ?? '?'}'s Mia.`));
      line.append(ctx.el('span', 'mia-loss', ` · ${loser?.name ?? '?'} −${r.cost} ❤️`));
      rev.append(line);
    }

    const st = m.stage;
    $('miaRoll').hidden = !mine || st === 'claim' || m.claim === 21;
    $('miaRoll').textContent = st === 'decide' ? '🤝 Believe & roll' : '🥤 Roll';
    $('miaLift').hidden = !mine || st !== 'decide';
    $('miaConcede').hidden = !mine || st !== 'decide' || m.claim !== 21;

    // the ladder of values to announce
    const lad = $('miaLadder'); lad.innerHTML = '';
    lad.hidden = !mine || st !== 'claim';
    $('miaSay').hidden = lad.hidden;
    if (!lad.hidden) {
      const truth = read(m.dice), min = m.claim ? m.order.indexOf(m.claim) + 1 : 0;
      if (choice == null) choice = m.order.indexOf(truth) >= min ? truth : m.order[min];
      m.order.forEach((v, i) => {
        const b = ctx.el('button', 'mia-step' + (v === truth ? ' truth' : '') + (v === choice ? ' on' : '') + (DOUBLES.has(v) ? ' dbl' : '') + (v === 21 ? ' top' : ''), label(v));
        b.disabled = i < min;
        b.onclick = () => { choice = v; render(S, ctx); };
        lad.append(b);
      });
      $('miaSay').textContent = `📣 Say “${long(choice)}”` + (choice === truth ? '' : ' (bluff!)');
    }
    $('miaHint').textContent = !mine ? (st === 'claim' ? `${who?.name ?? '?'} is peeking under the cup…` : '')
      : st === 'decide' ? (m.claim === 21 ? 'Nothing beats a Mia. Lift it (2 ❤️ on the line) or concede 1.' : `Believe it and you must beat ${long(m.claim)}.`)
      : st === 'claim' ? 'Your true roll is outlined. Say anything higher than the last call.' : 'Shake the cup to open the round.';

    const lives = $('miaLives');
    Kit.scoreboard(lives, m.seats.filter((pid) => ctx.player(pid)).map((pid) => {
      const n = m.lives[pid] ?? 0;
      return { p: ctx.player(pid), score: n, me: pid === S.me.id, turn: S.turn === pid, out: !n };
    }), { fmt: (r) => (r.score ? '❤️'.repeat(r.score) + '🤍'.repeat(Math.max(0, m.maxLives - r.score)) : '☠️') });
    [...lives.children].forEach((row, k) => { row.dataset.pid = m.seats.filter((pid) => ctx.player(pid))[k]; });
    lives.querySelectorAll('.kit-sb-score').forEach((b) => b.classList.add('mia-hearts'));
    const calls = $('miaCalls'); calls.innerHTML = '';
    for (const [pid, v] of m.calls) calls.append(ctx.el('li', '', `${ctx.player(pid)?.name ?? '?'}: ${long(v)}`));
  }

  const turnText = (s) => s.phase !== 'playing' || s.turn !== s.me.id ? null
    : s.mia.stage === 'claim' ? '🎭 Announce!' : s.mia.stage === 'decide' ? '🎭 Believe or lift?' : '🎭 Roll!';

  return { mount, render, turnText };
})();
