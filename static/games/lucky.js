// Lucky Letters: a three.js prize wheel (SVG fallback without WebGL) and a phrase board.
// The server picks where the wheel stops; every client animates the same spin to it.
UI.lucky = (() => {
  let S, ctx, gfx = null, raf = 0, resizeObs = null;
  let rest = 0, anim = null, seenSpin = 0, prevBoard = '';
  const N = 16, SLICE = (Math.PI * 2) / N;
  const COLORS = ['#e63946', '#f4a261', '#2a9d8f', '#264653', '#e9c46a', '#8338ec', '#3a86ff', '#06d6a0'];
  const SPECIAL = { bust: '#111111', skip: '#6c757d', wild: '#9b5de5', steal: '#f77f00', jackpot: '#ffd60a', vowel: '#00b4d8' };
  const CONS = 'BCDFGHJKLMNPQRSTVWXYZ', VOW = 'AEIOU';
  const $ = (id) => document.getElementById(id);
  const colorOf = (w, i) => SPECIAL[w.value] || COLORS[i % COLORS.length];
  const textOf = (w) => (typeof w.value === 'number' ? String(w.value) : w.label);

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
      g.fillStyle = w.value === 'jackpot' ? '#111' : '#fff';
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
    let renderer;
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true }); } catch { return; }
    const tex = wheelTexture(T, S.lucky.wedges);
    if (!tex) { renderer.dispose(); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
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
        font-size="9" font-weight="700" fill="${w.value === 'jackpot' ? '#111' : '#fff'}">${textOf(w)}</text>`);
    });
    return `<svg viewBox="0 0 200 200" class="lk-wheel"><g id="lkSvgWheel">${parts.join('')}</g>
      <circle cx="100" cy="100" r="14" fill="#ffd166"/></svg><div class="lk-pointer">▼</div>`;
  }

  function resize() {
    const stage = $('lkStage'); if (!stage || !gfx) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    gfx.renderer.setSize(w, h); gfx.camera.aspect = w / h; gfx.camera.updateProjectionMatrix();
  }

  function tick(now) {
    raf = requestAnimationFrame(tick);
    const a = currentAngle(now);
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

  // ---------- mount / render
  function mount(main, side) {
    rest = 0; anim = null; seenSpin = 0; prevBoard = '';
    main.innerHTML = `<div class="lucky">
      <div id="lkStage" class="lk-stage"><div id="lkSvg"></div><div id="lkResult" class="lk-result"></div></div>
      <div class="lk-cat" id="lkCat"></div>
      <div id="lkBoard" class="lk-board"></div>
    </div>`;
    side.innerHTML = `<div class="panel">
      <div id="lkStatus" class="seat-row"></div>
      <div id="lkJackpot" class="hint left"></div>
      <button id="lkSpin" class="primary big">🎡 SPIN</button>
      <div id="lkKeys" class="lk-keys"></div>
      <form id="lkSolveForm" class="row"><input id="lkSolve" placeholder="Solve the puzzle…" autocomplete="off"><button>Solve</button></form>
      <table id="lkScores" class="scores"></table></div>`;
    $('lkSpin').onclick = () => ctx.quiet(ctx.act('spin'));
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
      const load = window.THREE ? Promise.resolve() : new Promise((res, rej) => {
        const sc = document.createElement('script'); sc.src = '/vendor/three.min.js'; sc.onload = res; sc.onerror = rej; document.head.append(sc);
      });
      load.then(initThree).catch(() => {});
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
    if (L.stage !== 'wheel' && L.spin && L.wedge != null) {
      const w = L.wedges[L.spin.wedge];
      $('lkResult').textContent = L.stage === 'spin' && typeof w.value === 'number' ? '' : textOf(w);
    }

    // board: new letters flip in
    $('lkCat').textContent = `Round ${L.round}/${L.rounds} · ${L.category}`;
    const board = $('lkBoard'); board.innerHTML = '';
    let k = 0;
    for (const word of L.board.split(' ')) {
      const wEl = ctx.el('div', 'lk-word');
      for (const ch of word) {
        const shown = ch !== '_';
        const t = ctx.el('span', 'lk-tile' + (shown ? ' on' : '') + (shown && prevBoard && prevBoard[k] === '_' ? ' flip' : ''), shown ? ch : '');
        wEl.append(t); k++;
      }
      board.append(wEl); k++;
    }
    prevBoard = L.board;

    const mine = ctx.myTurn, stage = L.stage;
    const turnName = ctx.player(S.turn)?.name ?? '';
    $('lkStatus').textContent = S.phase !== 'playing' ? `Answer: ${L.board}`
      : stage === 'wheel' ? `🎡 ${turnName} is spinning…`
      : !mine ? `${turnName}'s turn`
      : stage === 'letter' ? `Call a consonant — ${L.value} each${L.wedge === 'jackpot' ? ` + ⚡ ${L.jackpot}` : L.wedge === 'steal' ? ' + 🦊 steal' : ''}`
      : stage === 'vowel' ? 'Call a vowel ✨' : 'Spin the wheel or solve!';
    $('lkJackpot').textContent = `⚡ Jackpot: ${L.jackpot}`;
    $('lkSpin').hidden = !(mine && stage === 'spin');
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
      tr.append(n, ctx.el('td', '', L.bank[pid] || 0), ctx.el('td', '', L.total[pid]));
      table.append(tr);
    }
  }

  const turnText = (s) => s.phase === 'playing' && s.lucky.stage === 'wheel' ? '🎡 Spinning…' : null;
  return { mount, render, unmount, turnText };
})();
