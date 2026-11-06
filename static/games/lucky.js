// Lucky Letters: a three.js prize wheel (SVG fallback without WebGL) and a phrase board.
// The server picks where the wheel stops; every client animates the same spin to it.
UI.lucky = (() => {
  let S, ctx, gfx = null, raf = 0, resizeObs = null;
  let rest = 0, anim = null, seenSpin = 0, prevBoard = '', cheered = 0, prevBank = null, prevTotal = null, flipAt = {};
  const N = 16, SLICE = (Math.PI * 2) / N;
  const COLORS = ['#e63946', '#f4a261', '#2a9d8f', '#264653', '#e9c46a', '#8338ec', '#3a86ff', '#06d6a0'];
  const SPECIAL = { bust: '#111111', skip: '#6c757d', wild: '#9b5de5', steal: '#f77f00', jackpot: '#ffd60a', vowel: '#00b4d8' };
  const CONS = 'BCDFGHJKLMNPQRSTVWXYZ', VOW = 'AEIOU';
  const $ = (id) => document.getElementById(id);
  const colorOf = (w, i) => SPECIAL[w.value] || COLORS[i % COLORS.length];
  // dark text on the light wedges (yellow, sand, mint, orange, cyan, jackpot), white on the rest (#74)
  const inkOf = (hex) => {
    const lin = (i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5) > 0.3 ? '#111' : '#fff';
  };
  const textOf = (w) => (typeof w.value === 'number' ? String(w.value) : w.label);
  const num = (n) => Number(n || 0).toLocaleString();

  // ---------- where to stop: same answer on every client
  function targetAngle(spin, from) {
    const jitter = ((((spin.id * 9301 + 49297) % 233280) / 233280) - 0.5) * SLICE * 0.7;
    const centre = (spin.wedge + 0.5) * SLICE + jitter;               // clockwise from the top
    const need = (((-centre - from) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return from + spin.turns * Math.PI * 2 + need;
  }
  const ease = (t) => 1 - (1 - t) ** 3;

  function currentAngle(now) {
    if (!anim) return rest;
    const t = Math.min(1, (now - anim.start) / anim.dur);
    if (t >= 1) { rest = anim.to % (Math.PI * 2); anim = null; return rest; }
    return anim.from + (anim.to - anim.from) * ease(t);
  }

  // ---------- three.js wheel
  function wheelTexture(T, wedges) {
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const g = c.getContext('2d');
    if (!g) return null;
    const R = 512;
    wedges.forEach((w, i) => {
      const a0 = -Math.PI / 2 + i * SLICE, a1 = a0 + SLICE;
      g.beginPath(); g.moveTo(R, R); g.arc(R, R, R, a0, a1); g.closePath();
      g.fillStyle = colorOf(w, i); g.fill();
      g.strokeStyle = '#ffffffaa'; g.lineWidth = 4; g.stroke();
      g.save(); g.translate(R, R); g.rotate(a0 + SLICE / 2);
      g.fillStyle = inkOf(colorOf(w, i));
      g.font = 'bold 50px system-ui, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle';
      g.fillText(textOf(w), R - 34, 0);
      g.restore();
    });
    const tex = new T.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  function initThree() {
    const T = window.THREE, stage = $('lkStage');
    const renderer = GL3.renderer({ alpha: true }, { onLost: () => {
      if (!gfx || gfx.renderer !== renderer) return;
      renderer.dispose(); renderer.domElement.remove(); gfx = null;
      if (stage.isConnected) { initThree(); resize(); }
    } });
    if (!renderer) return;
    const tex = wheelTexture(T, S.lucky.wedges);
    if (!tex) { renderer.dispose(); return; }
    stage.prepend(renderer.domElement);
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, -1.2, 15); camera.lookAt(0, 0.2, 0);
    scene.add(new T.AmbientLight(0xffffff, 0.6));
    const key = new T.SpotLight(0xffffff, 1.0, 60, Math.PI / 5, 0.4); key.position.set(4, 8, 14); scene.add(key);
    const wheel = new T.Group(); scene.add(wheel);
    const face = new T.Mesh(new T.CircleGeometry(5, 96), new T.MeshStandardMaterial({ map: tex, roughness: 0.55 }));
    face.position.z = 0.31; wheel.add(face);
    const body = new T.Mesh(new T.CylinderGeometry(5, 5, 0.6, 96), new T.MeshStandardMaterial({ color: 0x3b2a12, metalness: 0.3 }));
    body.rotation.x = Math.PI / 2; wheel.add(body);
    const rim = new T.Mesh(new T.TorusGeometry(5.05, 0.18, 16, 120), new T.MeshStandardMaterial({ color: 0xffd166, metalness: 0.8, roughness: 0.25 }));
    rim.position.z = 0.32; wheel.add(rim);
    const pegGeo = new T.CylinderGeometry(0.09, 0.09, 0.45, 12), pegMat = new T.MeshStandardMaterial({ color: 0xffffff, metalness: 0.6 });
    for (let i = 0; i < N; i++) {
      const a = Math.PI / 2 - i * SLICE, peg = new T.Mesh(pegGeo, pegMat);
      peg.rotation.x = Math.PI / 2; peg.position.set(Math.cos(a) * 4.75, Math.sin(a) * 4.75, 0.55); wheel.add(peg);
    }
    const hub = new T.Mesh(new T.CylinderGeometry(0.75, 0.75, 0.5, 48), new T.MeshStandardMaterial({ color: 0xffd166, metalness: 0.8, roughness: 0.3 }));
    hub.rotation.x = Math.PI / 2; hub.position.z = 0.5; wheel.add(hub);
    const pointer = new T.Mesh(new T.ConeGeometry(0.45, 1.1, 24), new T.MeshStandardMaterial({ color: 0xef476f, metalness: 0.3 }));
    pointer.rotation.z = Math.PI; pointer.position.set(0, 5.45, 0.8); scene.add(pointer);
    gfx = { renderer, scene, camera, wheel, pointer };
    $('lkSvg').hidden = true;
    resize();
  }

  // ---------- SVG fallback wheel
  function buildSvg(wedges) {
    const r = 100, parts = [];
    wedges.forEach((w, i) => {
      const a0 = -Math.PI / 2 + i * SLICE, a1 = a0 + SLICE;
      const p = (a) => `${r + r * Math.cos(a)},${r + r * Math.sin(a)}`;
      parts.push(`<path d="M${r},${r} L${p(a0)} A${r},${r} 0 0,1 ${p(a1)} Z" fill="${colorOf(w, i)}" stroke="#fff8"/>`);
      const mid = (a0 + SLICE / 2) * 180 / Math.PI;
      parts.push(`<text x="${r * 1.88}" y="${r}" transform="rotate(${mid} ${r} ${r})" text-anchor="end" dominant-baseline="middle"
        font-size="9" font-weight="700" fill="${inkOf(colorOf(w, i))}">${textOf(w)}</text>`);
    });
    return `<svg viewBox="0 0 200 200" class="lk-wheel"><g id="lkSvgWheel">${parts.join('')}</g>
      <circle cx="100" cy="100" r="14" fill="#ffd166"/></svg><div class="lk-pointer">▼</div>`;
  }

  function resize() {
    const stage = $('lkStage'); if (!stage || !gfx) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    gfx.renderer.setSize(w, h); gfx.camera.aspect = w / h;
    // Back the camera off until the whole wheel (rim ±5.3, pointer up to 6) fits with a margin, at any aspect.
    const t = Math.tan((gfx.camera.fov * Math.PI) / 360), dist = Math.max(6.4 / t, 5.8 / (t * (w / h || 1)));
    gfx.camera.position.set(0, -1.0, dist); gfx.camera.lookAt(0, 0.35, 0);
    gfx.camera.updateProjectionMatrix();
  }

  // the letter clock (#63): a bar that empties while a letter is due, for everyone at the table
  let clockFrom = 0, clockLeft = null;
  function tickClock(now) {
    const bar = $('lkClock'), L = S?.lucky;
    const due = L && S.phase === 'playing' && (L.stage === 'letter' || L.stage === 'vowel') && clockLeft != null && L.clock;
    if (!bar) return;
    bar.hidden = !due;
    if (!due) return;
    const left = Math.max(0, clockLeft - (now - clockFrom) / 1000), fill = bar.firstElementChild;
    fill.firstElementChild.style.width = `${(left / L.clock) * 100}%`;
    fill.classList.toggle('last', left < 5);
    bar.lastElementChild.textContent = `⏱️ ${Math.ceil(left)}s to call a letter`;
  }

  function tick(now) {
    raf = requestAnimationFrame(tick);
    tickClock(now);
    const spinning = !!anim, a = currentAngle(now);
    // a ratchet click each time a peg passes the pointer, and the wedge's own sound where it stops
    const peg = Math.floor(a / SLICE);
    if (anim && peg !== lastPeg && lastPeg != null) ctx?.sfx?.('tick');
    lastPeg = peg;
    if (spinning && !anim) landSound();
    if (gfx) {
      gfx.wheel.rotation.z = -a;
      // the pointer flicks as pegs pass under it
      const phase = ((a % SLICE) + SLICE) % SLICE / SLICE;
      gfx.pointer.rotation.z = Math.PI + (anim ? Math.max(0, 0.35 - phase) : 0);
      gfx.renderer.render(gfx.scene, gfx.camera);
    } else {
      const g = $('lkSvgWheel');
      if (g) g.setAttribute('transform', `rotate(${(a * 180) / Math.PI} 100 100)`);
    }
  }

  let lastPeg = null;
  function landSound() {
    const L = S?.lucky, w = L?.spin && L.wedges[L.spin.wedge];
    if (!w) return;
    const v = w.value;
    if (v === 'bust') { ctx.sfx('wrong'); Kit.callout('💀 BUST', 'bad', { ms: 1100 }); }
    else if (v === 'jackpot') { ctx.sfx('fanfare'); Kit.callout('⚡ JACKPOT', 'gold'); }
    else if (v === 'steal') { ctx.sfx('whoosh'); Kit.callout('🦊 Steal!', 'gold', { ms: 1100 }); }
    else if (v === 'skip') ctx.sfx('thud');
    else {
      ctx.sfx('place');  // a cash wedge is only a chance: a neutral clack, the chime waits for a right letter
      const stage = document.getElementById('lkStage');
      if (stage && typeof v === 'number') Kit.stamp(stage, `💰 ${num(v)}`, 'gold', 900);  // the value it landed on
    }
  }
  // the game plays its own sounds (ownSounds), so the turn's outcome gets one clear cue here
  let heard = null;
  function outcomeSound() {
    const e = S.log?.at(-1);
    if (!e || e.id === heard) return;
    const first = heard == null; heard = e.id;
    if (first || ctx.peek == null) return;
    if (/^(❌|🙅|🔁|⏰)/.test(e.text)) ctx.sfx('bad');
    else if (/^✅/.test(e.text)) ctx.sfx('good');
  }

  // ---------- mount / render
  function mount(main, side) {
    rest = 0; anim = null; seenSpin = 0; prevBoard = ''; cheered = 0; prevBank = null; prevTotal = null; flipAt = {};
    main.innerHTML = `<div class="lucky">
      <div id="lkStage" class="lk-stage"><div id="lkSvg"></div><div id="lkResult" class="lk-result"></div><div id="lkStand" class="st-float" hidden></div></div>
      <div class="lk-cat" id="lkCat"></div>
      <div id="lkBoard" class="lk-board"></div>
    </div>`;
    side.innerHTML = `<div class="panel">
      <div id="lkStatus" class="seat-row"></div>
      <div id="lkJackpot" class="hint left"></div>
      <div class="lk-actions">
        <div id="lkClock" class="lk-clock" hidden><div class="dd-bar"><span></span></div><small></small></div>
        <button id="lkSpin" class="primary big">🎡 SPIN</button>
        <button id="lkBuy" class="lk-buy" hidden></button>
        <div id="lkKeys" class="lk-keys"></div>
        <form id="lkSolveForm" class="row"><input id="lkSolve" placeholder="Solve the puzzle…" autocomplete="off"><button>Solve</button></form>
      </div>
      <table id="lkScores" class="scores"></table></div>`;
    $('lkSpin').onclick = () => ctx.quiet(ctx.act('spin'));
    $('lkBuy').onclick = () => ctx.quiet(ctx.act('buy'));
    $('lkSolveForm').onsubmit = (e) => {
      e.preventDefault();
      const guess = $('lkSolve').value.trim();
      if (guess) { ctx.quiet(ctx.act('solve', { guess })); $('lkSolve').value = ''; }
    };
    resizeObs = window.ResizeObserver ? new ResizeObserver(resize) : null;
    resizeObs?.observe($('lkStage'));
    raf = requestAnimationFrame(tick);
  }

  function unmount() {
    cancelAnimationFrame(raf);
    resizeObs?.disconnect();
    if (gfx) { gfx.renderer.dispose(); gfx = null; }
  }

  function render(s, c) {
    S = s; ctx = c;
    const L = S.lucky;
    if (!$('lkSvg').innerHTML) {
      $('lkSvg').innerHTML = buildSvg(L.wedges);
      GL3.load().then(initThree).catch(() => {});
    }
    // start (or join) the spin animation when the server reports a new spin
    if (L.spin && L.spin.id !== seenSpin) {
      seenSpin = L.spin.id;
      const now = performance.now();
      const from = currentAngle(now);
      const dur = L.spin.secs * 1000;
      if (L.spin.left > 0) anim = { from, to: targetAngle(L.spin, from), start: now - (dur - L.spin.left * 1000), dur };
      else { rest = targetAngle(L.spin, from) % (Math.PI * 2); anim = null; }
      $('lkResult').textContent = '';
    }
    standingsCard($('lkStand'), L.standings, { title: `After puzzle ${L.round} of ${L.rounds}`, fmt: num });
    if (L.stage === 'solved' && L.last) {
      $('lkResult').textContent = `🎉 ${L.last.by} +${num(L.last.won)}`;
      if (cheered !== L.round) { cheered = L.round; ctx.confetti?.(); }
    } else if (L.stage !== 'wheel' && L.spin && L.wedge != null) {
      const w = L.wedges[L.spin.wedge];
      $('lkResult').textContent = L.stage === 'spin' && typeof w.value === 'number' ? '' : textOf(w);
    }

    // board: new letters flip in
    outcomeSound();
    $('lkCat').textContent = `Round ${L.round}/${L.rounds} · ${L.category}`;
    const board = $('lkBoard'); board.innerHTML = '';
    // newly found letters turn over one after another, each with a click, like a host turning tiles
    let k = 0, turned = 0;
    const now = performance.now();
    if (L.board.length !== prevBoard.length) flipAt = {};
    const solving = L.stage === 'solved' || S.phase !== 'playing';
    for (const word of L.board.split(' ')) {
      const wEl = ctx.el('div', 'lk-word');
      for (const ch of word) {
        const shown = ch !== '_';
        const fresh = shown && prevBoard && prevBoard[k] === '_';
        if (fresh && motionOK()) {
          const at = turned++ * (solving ? 0.06 : 0.32);
          flipAt[k] = now + at * 1000;
          if (!solving) setTimeout(() => ctx.sfx('flip'), at * 1000);
        }
        // a tile still turning (its flip may have been scheduled a render or two ago) carries on where it was
        const turning = shown && flipAt[k] != null && flipAt[k] + 500 > now;
        const t = ctx.el('span', 'lk-tile' + (shown ? ' on' : '') + (turning ? ' flip' : ''), shown ? ch : '');
        if (turning) t.style.animationDelay = (flipAt[k] - now) / 1000 + 's';
        wEl.append(t); k++;
      }
      board.append(wEl); k++;
    }
    prevBoard = L.board;
    // money won this turn floats up off the board
    if (prevBank && S.turn) {
      const gain = (L.bank[S.turn] ?? 0) - (prevBank[S.turn] ?? 0);
      if (gain > 0) setTimeout(() => Kit.flyText(board, `+${num(gain)}`, 'gold'), Math.min(turned, 6) * 320);
    }

    const mine = ctx.myTurn, stage = L.stage;
    const turnName = ctx.player(S.turn)?.name ?? '';
    $('lkStatus').textContent = S.phase !== 'playing' ? `Answer: ${L.board}`
      : stage === 'solved' ? `🎉 ${L.last?.by ?? ''} solved it! Next puzzle coming up…`
      : stage === 'wheel' ? `🎡 ${turnName} is spinning…`
      : !mine ? `${turnName}'s turn`
      : stage === 'letter' ? `Call a consonant — ${num(L.value)} each${L.wedge === 'jackpot' ? ` + ⚡ ${num(L.jackpot)}` : L.wedge === 'steal' ? ' + 🦊 steal' : ''}`
      : stage === 'vowel' ? (L.wedge === 'bought' ? 'Call your vowel 💰' : 'Call a vowel ✨') : 'Spin the wheel or solve!';
    $('lkJackpot').textContent = `⚡ Jackpot: ${num(L.jackpot)}`;
    clockFrom = performance.now(); clockLeft = S.timeLeft ?? null;
    $('lkSpin').hidden = !(mine && stage === 'spin');
    const buy = $('lkBuy'), bank = L.bank[S.me.id] ?? 0, vowelsLeft = [...VOW].some((v) => !L.called.includes(v));
    buy.hidden = !(mine && stage === 'spin' && L.buy);
    buy.disabled = bank < (L.buy ?? 0) || !vowelsLeft;
    buy.textContent = !vowelsLeft ? '💰 No vowels left' : `💰 Buy a vowel (${num(L.buy)})`;
    buy.title = bank < (L.buy ?? 0) ? `You need ${num(L.buy)} in this round's bank.` : '';
    $('lkSolveForm').hidden = !(mine && stage === 'spin');
    const keys = $('lkKeys'); keys.innerHTML = '';
    if (mine && (stage === 'letter' || stage === 'vowel')) {
      for (const ch of stage === 'vowel' ? VOW : CONS) {
        const b = ctx.el('button', 'lk-key', ch);
        b.disabled = L.called.includes(ch);
        b.onclick = () => ctx.quiet(ctx.act('letter', { letter: ch }));
        keys.append(b);
      }
    }
    const table = $('lkScores'); table.innerHTML = '';
    const head = ctx.el('tr'); head.append(ctx.el('th', '', 'Player'), ctx.el('th', '', 'Round'), ctx.el('th', '', 'Total'));
    table.append(head);
    for (const pid of L.seats) {
      const p = ctx.player(pid); if (!p) continue;
      const tr = ctx.el('tr', pid === S.turn ? 'now' : '');
      const n = ctx.el('td', '', p.name); n.style.color = p.color;
      const bankTd = ctx.el('td', '', num(L.bank[pid])), totalTd = ctx.el('td', '', num(L.total[pid]));
      if (prevBank && prevBank[pid] !== L.bank[pid]) Kit.tally(bankTd, prevBank[pid] ?? 0, L.bank[pid] ?? 0, 700);
      if (prevTotal && prevTotal[pid] !== L.total[pid]) Kit.tally(totalTd, prevTotal[pid] ?? 0, L.total[pid] ?? 0, 900);
      tr.append(n, bankTd, totalTd);
      table.append(tr);
    }
    prevBank = { ...L.bank }; prevTotal = { ...L.total };
  }

  const turnText = (s) => s.phase !== 'playing' ? null
    : s.lucky.stage === 'wheel' ? '🎡 Spinning…' : s.lucky.stage === 'solved' ? '🎉 Solved!' : null;
  const ownTimer = (s) => s.lucky.stage === 'solved';  // the reveal pause isn't anyone's turn clock
  return { mount, render, unmount, turnText, ownTimer, ownSounds: true };
})();
