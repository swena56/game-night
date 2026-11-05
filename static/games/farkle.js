// Farkle: tap scoring dice to set them aside (the live total shows what they're worth), then roll the
// rest or bank. Dice buttons are built once per roll and updated in place.
UI.farkle = (() => {
  let S, ctx, picked = new Set(), rollKey = '', seenEvent = 0, scoreSeen = {};
  const $ = (id) => document.getElementById(id);
  const PIPS = Dice.PIPS;
  const num = (n) => Number(n || 0).toLocaleString();
  const FARKLE_PCT = { 1: 67, 2: 44, 3: 28, 4: 16, 5: 8, 6: 2 };  // chance a roll of n dice scores nothing

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

  const die = (value, cls = '') => Dice.die(value, cls, 'button');

  function mount(main, side) {
    picked = new Set(); rollKey = ''; seenEvent = 0; scoreSeen = {};
    main.innerHTML = `<div class="fk">
      <div id="fkTurn" class="fk-turn"></div>
      <div class="ya-tray fk-tray"><div id="fkDice" class="ya-dice fk-dice"></div>
        <div id="fkAside" class="fk-aside"></div></div>
      <div id="fkRisk" class="fk-risk"><span class="fk-risk-bar"><i></i></span><small></small></div>
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
      : picked.size && !valid ? 'Every die you set aside has to score.'
      : valid ? `Rolling ${left} ${left === 1 ? 'die' : 'dice'}: ${FARKLE_PCT[left]}% chance to farkle.` : 'Tap scoring dice to set them aside, then roll the rest or bank.';
    // the risk gauge: what's on the line and the chance the next roll farkles (with my picks, or, watching,
    // after the best keep)
    const risk = $('fkRisk'), best0 = f.options[0];
    const next = valid ? left : best0 ? (f.roll.length - best0[1].length || 6) : 0;
    const onLine = f.turnPts + (valid ? pts : best0 ? best0[0] : 0);
    risk.hidden = !(S.phase === 'playing' && f.rolled && !f.farkled && next);
    if (!risk.hidden) {
      const pct = FARKLE_PCT[next] ?? 0;
      risk.style.setProperty('--p', pct / 100);
      risk.classList.toggle('hot', pct >= 40);
      risk.querySelector('small').textContent = `${num(onLine)} on the line · roll ${next} more: ${pct}% to farkle`;
    }
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
        const b = die(v, f.rolled ? '' : 'blank');
        b.onclick = () => { picked.has(i) ? picked.delete(i) : picked.add(i); paint(); };
        box.append(b);
      });
      if (f.rolled) Dice.roll(box.children, { sound: false });
    }
    paint();

    // the dice set aside so far this turn, and how risky the next roll is: shown to the whole table, so
    // everyone feels it when someone pushes their luck
    const aside = $('fkAside'), as = f.aside || [];
    const ak = as.join('');
    if (aside.dataset.k !== ak) {
      const grew = aside.dataset.k != null && ak.startsWith(aside.dataset.k) && ak.length > aside.dataset.k.length;
      const from = grew ? aside.dataset.k.length : as.length;
      aside.innerHTML = '';
      as.forEach((v, i) => aside.append(Dice.die(v, 'small' + (i >= from ? ' in' : ''))));
      aside.dataset.k = ak;
    }
    aside.hidden = !as.length;

    // the last farkle or bank, shown to everyone
    if (f.event && f.event.id !== seenEvent) {
      seenEvent = f.event.id;
      const who = ctx.player(f.event.by)?.name ?? '?';
      const ev = $('fkEvent');
      ev.className = 'fk-event ' + f.event.kind;
      ev.textContent = f.event.kind === 'farkle' ? `💥 ${who} FARKLED (${f.event.roll.join(' ')})${f.event.lost ? ` and lost ${num(f.event.lost)}` : ''}!`
        : f.event.kind === 'hot' ? `🔥 HOT DICE! ${who} rolls all six again with ${num(f.event.pts)} on the line`
          : `🏦 ${who} banked ${num(f.event.pts)}`;
      void ev.offsetWidth; ev.classList.add('show');
      if (f.event.kind === 'farkle') {
        // a bust: the dice shake and go grey, with a thud
        const box = $('fkDice'); box.classList.remove('bust', 'shake'); void box.offsetWidth; box.classList.add('bust', 'shake');
        Kit.stamp(box, 'Farkle!', 'bad', 1300);
        ctx.sfx('wrong'); if (f.event.by === me) ctx.buzz([40, 40, 80]);
      } else if (f.event.kind === 'bank' && f.event.pts >= 1500) Kit.callout(`🏦 ${num(f.event.pts)}`, 'gold', { ms: 1300 });
      if (f.event.kind === 'hot') {
        const box = $('fkDice'); box.classList.remove('hot'); void box.offsetWidth; box.classList.add('hot');
        if (f.event.by === me) ctx.confetti();
      }
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
      // the turn's points on the line show as a ghost extension of the bar
      if (pid === S.turn && f.turnPts > 0 && S.phase === 'playing') {
        const ghost = ctx.el('i', 'fk-ghost');
        ghost.style.left = fill.style.width;
        ghost.style.width = `${Math.max(0, Math.min(100 - parseFloat(fill.style.width), (100 * f.turnPts) / f.target))}%`;
        ghost.style.background = p.color;
        bar.append(ghost);
      }
      const n = ctx.el('span', 'fk-num'), was = scoreSeen[pid];
      if (was != null && was !== f.scores[pid]) Kit.tally(n, was, f.scores[pid], 700); else n.textContent = num(f.scores[pid]);
      scoreSeen[pid] = f.scores[pid];
      row.append(name, bar, n);
      sc.append(row);
    }
  }

  return { mount, render };
})();
