// Farkle: tap scoring dice to set them aside (the live total shows what they're worth), then roll the
// rest or bank. Dice buttons are built once per roll and updated in place.
UI.farkle = (() => {
  let S, ctx, picked = new Set(), rollKey = '', seenEvent = 0;
  const $ = (id) => document.getElementById(id);
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const num = (n) => Number(n || 0).toLocaleString();

  // same scoring as games/farkle.py: every kept die must score
  const memo = new Map();
  function best(dice) {
    if (!dice.length) return 0;
    const key = dice.join('');
    if (memo.has(key)) return memo.get(key);
    const c = {}; for (const d of dice) c[d] = (c[d] || 0) + 1;
    const counts = Object.values(c).sort();
    const opts = [];
    if (dice.length === 6) {
      if (Object.keys(c).length === 6) opts.push(1500);
      if (counts.join() === '2,2,2' || counts.join() === '2,4') opts.push(1500);
      if (counts.join() === '3,3') opts.push(2500);
    }
    for (const [f, n] of Object.entries(c)) {
      const face = +f;
      for (let k = 3; k <= n; k++) {
        const pts = k === 3 ? (face === 1 ? 1000 : face * 100) : { 4: 1000, 5: 2000, 6: 3000 }[k];
        const rest = [...dice]; for (let i = 0; i < k; i++) rest.splice(rest.indexOf(face), 1);
        const sub = best(rest); if (sub != null) opts.push(pts + sub);
      }
      if (face === 1 || face === 5) {
        const rest = [...dice]; rest.splice(rest.indexOf(face), 1);
        const sub = best(rest); if (sub != null) opts.push((face === 1 ? 100 : 50) + sub);
      }
    }
    const v = opts.length ? Math.max(...opts) : null;
    memo.set(key, v);
    return v;
  }
  const keptScore = () => best([...picked].map((i) => S.farkle.roll[i]).sort());

  function die(value, cls = '') {
    const b = ctx.el('button', 'ya-die ' + cls);
    const on = new Set(PIPS[value]);
    for (let k = 0; k < 9; k++) b.append(ctx.el('span', on.has(k) ? 'on' : ''));
    return b;
  }

  function mount(main, side) {
    picked = new Set(); rollKey = ''; seenEvent = 0;
    main.innerHTML = `<div class="fk">
      <div id="fkTurn" class="fk-turn"></div>
      <div id="fkDice" class="ya-dice fk-dice"></div>
      <div id="fkEvent" class="fk-event"></div>
      <div class="row fk-buttons">
        <button id="fkBest" class="ghost-btn">✨ Pick the best</button>
      </div>
      <div class="row fk-actions"><button id="fkRoll" class="primary big"></button><button id="fkBank" class="big"></button></div>
      <p id="fkHint" class="hint"></p>
      <div id="fkScores" class="fk-scores"></div>
    </div>`;
    side.innerHTML = `<div class="panel"><h3>Scoring</h3><ul class="rules fk-rules">
      <li>1 = 100 · 5 = 50</li><li>Three of a kind = face × 100 (three 1s = 1,000)</li>
      <li>Four / five / six of a kind = 1,000 / 2,000 / 3,000</li>
      <li>All six: straight or three pairs 1,500 · four + a pair 1,500 · two triplets 2,500</li>
      <li>Nothing scores? FARKLE: the turn's points are gone.</li></ul></div>`;
    $('fkRoll').onclick = () => ctx.quiet(ctx.act('roll', { keep: S.farkle.rolled ? [...picked] : [] }));
    $('fkBank').onclick = () => ctx.quiet(ctx.act('bank', { keep: [...picked] }));
    $('fkBest').onclick = () => { const o = S.farkle.options[0]; if (o) { picked = new Set(o[1]); paint(); } };
  }

  function paint() {
    const f = S.farkle, mine = ctx.myTurn && S.phase === 'playing';
    const box = $('fkDice');
    [...box.children].forEach((b, i) => {
      b.classList.toggle('held', picked.has(i));
      b.disabled = !mine || !f.rolled;
    });
    const pts = picked.size ? keptScore() : 0;
    const valid = picked.size > 0 && pts != null && pts > 0;
    const left = f.rolled ? (f.roll.length - picked.size || 6) : 6;
    $('fkRoll').disabled = !mine || (f.rolled && !valid);
    $('fkRoll').textContent = !f.rolled ? '🎲 Roll 6 dice' : valid ? `🎲 Keep ${num(pts)}, roll ${left}${left === 6 && picked.size ? ' (hot dice!)' : ''}` : '🎲 Set aside scoring dice';
    const bankPts = f.turnPts + (valid ? pts : 0);
    const need = !f.onBoard[S.me.id] && f.opening ? f.opening : 0;
    $('fkBank').disabled = !mine || !f.rolled || !valid || bankPts < need;
    $('fkBank').textContent = `🏦 Bank ${num(bankPts)}` + (need && bankPts < need ? ` (need ${num(need)})` : '');
    $('fkBest').hidden = !mine || !f.rolled;
    $('fkHint').textContent = !mine ? '' : !f.rolled ? 'Roll to start your turn.'
      : picked.size && !valid ? 'Every die you set aside has to score.' : 'Tap scoring dice to set them aside, then roll the rest or bank.';
  }

  function render(s, c) {
    S = s; ctx = c;
    const f = S.farkle, me = S.me.id;
    const turnName = ctx.player(S.turn)?.name ?? '';
    $('fkTurn').textContent = S.phase !== 'playing' ? '' : `${S.turn === me ? 'Your' : `${turnName}'s`} turn · ${num(f.turnPts)} on the line`
      + (f.final ? ' · 🏁 final round' : '');

    // dice: rebuilt only when there's a new roll
    const key = `${S.turn}:${f.roll.join('')}:${f.turnPts}:${f.diceLeft}`;
    if (key !== rollKey) {
      rollKey = key; picked = new Set();
      const box = $('fkDice'); box.innerHTML = '';
      const dice = f.rolled ? f.roll : [1, 2, 3, 4, 5, 6].slice(0, f.diceLeft);
      dice.forEach((v, i) => {
        const b = die(v, f.rolled ? 'roll' : 'blank');
        b.onclick = () => { picked.has(i) ? picked.delete(i) : picked.add(i); paint(); };
        box.append(b);
      });
    }
    paint();

    // the last farkle or bank, shown to everyone
    if (f.event && f.event.id !== seenEvent) {
      seenEvent = f.event.id;
      const who = ctx.player(f.event.by)?.name ?? '?';
      const ev = $('fkEvent');
      ev.className = 'fk-event ' + f.event.kind;
      ev.textContent = f.event.kind === 'farkle' ? `💥 ${who} FARKLED (${f.event.roll.join(' ')})${f.event.lost ? ` and lost ${num(f.event.lost)}` : ''}!`
        : `🏦 ${who} banked ${num(f.event.pts)}`;
      void ev.offsetWidth; ev.classList.add('show');
    }

    // scores: a bar each toward the target
    const sc = $('fkScores'); sc.innerHTML = '';
    for (const pid of f.seats) {
      const p = ctx.player(pid); if (!p) continue;
      const row = ctx.el('div', 'fk-row' + (pid === S.turn ? ' now' : ''));
      const name = ctx.el('b', '', p.name); name.style.color = p.color;
      if (f.opening && !f.onBoard[pid]) name.title = `Needs ${num(f.opening)} in one turn to get on the board`;
      const bar = ctx.el('div', 'fk-bar'); const fill = ctx.el('span');
      fill.style.width = `${Math.min(100, (100 * Math.max(0, f.scores[pid])) / f.target)}%`; fill.style.background = p.color;
      bar.append(fill);
      row.append(name, bar, ctx.el('span', 'fk-num', num(f.scores[pid])));
      sc.append(row);
    }
  }

  return { mount, render };
})();
