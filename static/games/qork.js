// Qork: the Cupper rolls; on doubles or a seven, Corkers YANK and the Cupper SLAMs.
// Reaction times are measured here, from the moment the dice land on this screen.
UI.qork = (() => {
  let S, ctx, shownNo, shownAt, pressedNo, tumbleTimer, rollTimer;
  const $ = (id) => document.getElementById(id);
  const PIPS = Dice.PIPS;
  const replay = () => !ctx || ctx.peek == null;

  function face(box, v) {
    box.replaceChildren();
    const on = new Set(PIPS[v] || []);
    for (let k = 0; k < 9; k++) box.append(ctx.el('span', on.has(k) ? 'on' : ''));
  }

  function onKey(e) {
    if (e.key === ' ' && !e.repeat && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) { e.preventDefault(); press(); }
  }

  let seenRes = null;
  function mount(main, side) {
    seenRes = null;
    shownNo = -1; shownAt = 0; pressedNo = -1;
    main.innerHTML = `<div class="qk">
      <div id="qkInfo" class="qk-info"></div>
      <div class="qk-dice"><div id="qkD0" class="ya-die qk-die"></div><div id="qkD1" class="ya-die qk-die"></div></div>
      <div id="qkCall" class="qk-call"></div>
      <div id="qkMat" class="qk-mat"><svg id="qkStrings" viewBox="0 0 100 100" aria-hidden="true"></svg>
        <div class="qk-ring"></div><div id="qkPieces"></div><div id="qkCup" class="qk-cup"></div></div>
      <div class="row qk-buttons"><button id="qkRoll" class="big">🎲 Roll</button><button id="qkGo" class="primary big qk-go"></button></div>
      <p id="qkHint" class="hint"></p>
      <div id="qkTimes" class="qk-times"></div>
    </div>`;
    side.innerHTML = `<div class="panel"><h3>Recent rolls</h3><div id="qkRolls" class="qk-rolls"></div>
      <p class="hint">Triggers: any doubles, or a total of 7. Tap the mat or press Space.</p></div>`;
    $('qkGo').addEventListener('pointerdown', (e) => { e.preventDefault(); press(); });
    $('qkMat').addEventListener('pointerdown', (e) => { e.preventDefault(); press(); });
    $('qkRoll').onclick = () => ctx.quiet(ctx.act('roll'));
    window.addEventListener('keydown', onKey);
  }

  function unmount() {
    clearInterval(tumbleTimer); clearTimeout(rollTimer); tumbleTimer = null;
    window.removeEventListener('keydown', onKey);
  }

  const role = () => {
    const g = S.qork;
    return g.cupper === S.me.id ? 'cup' : g.corkers.includes(S.me.id) ? 'cork' : null;
  };

  function press() {
    if (!S || replay() || !role()) return;
    const g = S.qork;
    if (g.stage === 'wait' || g.stage === 'result' || pressedNo === g.rollNo) return;
    pressedNo = g.rollNo;
    const ms = g.stage === 'tumble' || shownNo !== g.rollNo ? -1 : performance.now() - shownAt;
    if (!g.trigger) $('qkMat').classList.add('flinch');
    ctx.quiet(ctx.act('yank', { ms: Math.round(ms) }));
    draw();
  }

  function render(s, c) {
    S = s; ctx = c;
    const g = S.qork;
    if (g.dice && shownNo !== g.rollNo) {
      shownNo = g.rollNo; shownAt = performance.now();
      $('qkMat').classList.remove('flinch');
    }
    draw();
  }

  function draw() {
    const g = S.qork, me = role(), cupName = ctx.player(g.cupper)?.name ?? '?';
    $('qkInfo').textContent = `Round ${g.round}/${g.rounds} · 🥤 ${g.cupper === S.me.id ? 'You hold' : cupName + ' holds'} the cup`;

    // dice
    const tumbling = g.stage === 'tumble';
    if (tumbling && !tumbleTimer) {
      tumbleTimer = setInterval(() => { for (const i of [0, 1]) face($('qkD' + i), 1 + Math.floor(Math.random() * 6)); }, 90);
    } else if (!tumbling && tumbleTimer) { clearInterval(tumbleTimer); tumbleTimer = null; }
    for (const i of [0, 1]) {
      const d = $('qkD' + i);
      d.classList.toggle('tumble', tumbling);
      d.classList.toggle('blank', !tumbling && !g.dice);
      if (!tumbling) face(d, g.dice ? g.dice[i] : 0);
    }
    const call = $('qkCall');
    call.className = 'qk-call' + (g.trigger ? ' hot' : '');
    call.textContent = g.stage === 'wait' ? (g.cupper === S.me.id ? 'Roll when ready…' : `Waiting for ${cupName} to roll…`)
      : tumbling ? 'Rolling…'
      : g.trigger ? (g.trigger === 'doubles' ? 'DOUBLES!' : 'SEVEN!')
      : g.dice ? `${g.dice[0] + g.dice[1]} — hold still…` : '';

    // the mat: one Qork per Corker, strings out to the edge
    const n = g.corkers.length, svg = $('qkStrings'), pieces = $('qkPieces');
    svg.replaceChildren(); pieces.replaceChildren();
    const res = g.result, slammed = res ? res.slam != null : g.acted[g.cupper] === true;
    g.corkers.forEach((pid, i) => {
      const p = ctx.player(pid), ang = (i / n) * 2 * Math.PI - Math.PI / 2;
      const out = res ? res.escaped.includes(pid) : g.acted[pid] === true;
      const r = n === 1 ? 0 : 14, far = out ? 44 : r;
      const x = 50 + Math.cos(ang) * far, y = 50 + Math.sin(ang) * far;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x); line.setAttribute('y1', y);
      line.setAttribute('x2', 50 + Math.cos(ang) * 52); line.setAttribute('y2', 50 + Math.sin(ang) * 52);
      line.setAttribute('stroke', p?.color ?? '#888');
      svg.append(line);
      const q = ctx.el('div', 'qk-qork' + (pid === S.me.id ? ' me' : '') + (res?.trapped.includes(pid) ? ' trapped' : ''));
      q.style.left = x + '%'; q.style.top = y + '%';
      q.style.background = p?.color ?? '#888';
      q.title = p?.name ?? '';
      if (p) q.append(ctx.mark(pid));
      pieces.append(q);
    });
    $('qkCup').classList.toggle('down', slammed);

    // buttons
    const go = $('qkGo'), roll = $('qkRoll');
    go.hidden = !me;
    go.textContent = me === 'cup' ? '🥤 SLAM!' : '💪 YANK!';
    go.disabled = replay() || g.stage === 'wait' || g.stage === 'result' || pressedNo === g.rollNo || g.acted[S.me.id] !== undefined;
    go.classList.toggle('hot', !!g.trigger && g.stage === 'snap');
    roll.hidden = me !== 'cup' || !(g.stage === 'wait' || g.stage === 'dice');
    clearTimeout(rollTimer);
    roll.disabled = replay() || (g.canRoll ?? 0) > 0;
    if (!roll.hidden && roll.disabled && !replay()) rollTimer = setTimeout(() => { roll.disabled = false; }, g.canRoll * 1000);
    $('qkHint').textContent = me === 'cup' ? 'Roll, then SLAM the cup the instant you see doubles or a 7 — but not before!'
      : me === 'cork' ? 'YANK your Qork the instant you see doubles or a 7. Jumping early costs a point.'
      : 'You are watching this game.';

    // reaction times after a trigger
    const times = $('qkTimes');
    times.replaceChildren();
    if (res) {
      const rows = Object.entries(res.times).filter(([, ms]) => ms >= 0).sort((a, b) => a[1] - b[1]);
      for (const [pid, ms] of rows) {
        const tag = pid === g.cupper ? '🥤' : res.escaped.includes(pid) ? '💨' : '🔒';
        const row = ctx.el('div', 'qk-time');
        row.append(ctx.el('span', '', `${tag} ${ctx.player(pid)?.name ?? '?'}`), ctx.el('b', '', `${ms} ms`));
        // my own best reaction on this device: a new record gets its moment
        if (pid === S.me.id && !replay()) {
          let best = null;
          try { best = JSON.parse(localStorage.getItem('qork.best')); } catch {}
          if (JSON.stringify(res) !== seenRes && (best == null || ms < best)) {
            try { localStorage.setItem('qork.best', JSON.stringify(ms)); } catch {}
            if (best != null) Kit.callout(`⚡ ${ms} ms — new best!`, 'gold', { sound: 'fanfare', ms: 1800 });
            best = ms;
          }
          row.append(ctx.el('small', 'hint', ` · best ${best} ms`));
        }
        times.append(row);
      }
      seenRes = JSON.stringify(res);
      for (const pid of res.trapped.filter((id) => !(id in res.times && res.times[id] >= 0))) {
        times.append(ctx.el('div', 'qk-time', `🔒 ${ctx.player(pid)?.name ?? '?'} — didn't move`));
      }
    }

    // recent rolls
    const list = $('qkRolls');
    list.replaceChildren(...g.rolls.slice().reverse().map(([a, b]) => ctx.el('span', 'qk-roll' + (a === b || a + b === 7 ? ' hot' : ''), `${a}·${b}`)));
  }

  function turnText(s) {
    const g = s.qork;
    if (g.stage === 'snap') return g.cupper === s.me.id ? '🥤 SLAM!' : '💪 YANK!';
    return g.cupper === s.me.id ? '🥤 You are the Cupper' : null;
  }

  function myMove(s) {
    const g = s.qork;
    return g.stage === 'snap' || (g.cupper === s.me.id && (g.stage === 'wait' || g.stage === 'dice'));
  }

  return { mount, render, unmount, turnText, myMove };
})();
