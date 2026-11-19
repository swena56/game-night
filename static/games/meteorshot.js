// Meteor Shot: aim a comet through a floating ring. The server flies and scores each launch (games/meteorshot.py);
// this view plays the flight back on the same arc: three.js when it can, a flat drawing of the same scene when not.
UI.meteorshot = (() => {
  const RING_Y = 2.2, LIM = { angle: [18, 72], power: [8, 20], aim: [-16, 16] };
  const clamp = (v, [a, b]) => Math.max(a, Math.min(b, v));
  const $ = (id) => document.getElementById(id);
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem('gn.meteor')) || {}; } catch { return {}; } })();
  const aimOf = { angle: saved.angle ?? 45, power: saved.power ?? 14, aim: saved.aim ?? 0 };
  let stage, S = null, ctx = null, frame = 0, dirty = true, seen = null, flight = null, sentAt = 0;
  let gl = null, flat = null, ringAt = [0, 10];

  // the comet's position t seconds after launch (same maths as fly() on the server); z runs down-range (negative)
  function pos(s, t) {
    const r = s.angle * Math.PI / 180, vz = s.power * Math.cos(r), vy = s.power * Math.sin(r);
    return [Math.tan(s.aim * Math.PI / 180) * vz * t + s.wind * t * t * 0.8, vy * t - 4.9 * t * t, -vz * t];
  }
  const flightTime = (s) => s.target[1] / (s.power * Math.cos(s.angle * Math.PI / 180));

  function mount(main, side) {
    main.innerHTML = `<div class="meteor-wrap">
      <div class="meteor-stage" id="msStage"><div class="meteor-hud" id="msHud"></div><div class="meteor-pop" id="msPop" hidden></div><div class="meteor-wait" id="msWait" hidden></div></div>
      <div class="meteor-controls">
        <label>📐 Angle <input id="msAngle" type="range" min="18" max="72" step="1"><b id="msAngleN"></b></label>
        <label>💪 Power <input id="msPower" type="range" min="8" max="20" step="0.5"><b id="msPowerN"></b></label>
        <label>↔ Aim <input id="msAim" type="range" min="-16" max="16" step="0.5"><b id="msAimN"></b></label>
        <button id="msFire" type="button">☄️ Fire</button>
      </div>
      <p class="hint">Angle = how high, power = how far, aim = left/right. Wind pushes the comet sideways the longer it flies. Keys: ↑↓ angle, ←→ aim, W/S power, Space fires.</p></div>`;
    side.innerHTML = '<div class="panel"><h3>☄️ Scores</h3><div id="msSide"></div><p class="hint left">The ring and the wind change every round. 100 is dead centre.</p></div>';
    stage = $('msStage');
    for (const k of ['angle', 'power', 'aim']) {
      const inp = $(`ms${k[0].toUpperCase()}${k.slice(1)}`);
      inp.value = aimOf[k];
      inp.oninput = () => setAim(k, +inp.value);
    }
    showAim();
    $('msFire').onclick = fire;
    const key = (e) => {
      if (e.target?.matches?.('input[type=text], input[type=search], textarea')) return;
      const step = { ArrowUp: ['angle', 1], ArrowDown: ['angle', -1], ArrowRight: ['aim', 0.5], ArrowLeft: ['aim', -0.5], KeyW: ['power', 0.5], KeyS: ['power', -0.5] }[e.code];
      if (step) { e.preventDefault(); setAim(step[0], aimOf[step[0]] + step[1]); }
      else if (e.code === 'Space' && e.target?.tagName !== 'BUTTON') { e.preventDefault(); fire(); }
    };
    addEventListener('keydown', key);
    const ro = new ResizeObserver(() => { dirty = true; });
    ro.observe(stage);
    mount.off = () => { removeEventListener('keydown', key); ro.disconnect(); };
    flat = makeFlat(stage);
    GL3.load().then(() => {
      if (!stage?.isConnected || gl) return;
      GL3.revive(stage, { build: () => { gl?.dispose(); gl = make3d(stage); if (gl) { flat?.dispose(); flat = null; } return gl; },
        flat: () => { flat ||= makeFlat(stage); }, unflat: () => { flat?.dispose(); flat = null; } });
      dirty = true;
    }).catch(() => {});
    loop();
  }

  function setAim(k, v) {
    aimOf[k] = +clamp(v, LIM[k]).toFixed(1);
    const inp = $(`ms${k[0].toUpperCase()}${k.slice(1)}`);
    if (inp && +inp.value !== aimOf[k]) inp.value = aimOf[k];
    try { sessionStorage.setItem('gn.meteor', JSON.stringify(aimOf)); } catch {}
    showAim(); dirty = true;
  }
  function showAim() {
    $('msAngleN').textContent = `${aimOf.angle}°`;
    $('msPowerN').textContent = aimOf.power;
    const a = aimOf.aim;
    $('msAimN').textContent = Math.abs(a) < 0.25 ? '0' : `${a < 0 ? '◀' : ''}${Math.abs(a)}°${a > 0 ? '▶' : ''}`;
  }

  function fire() {
    if (!ctx?.myTurn || !S || flight || Date.now() - sentAt < 1500) return;
    sentAt = Date.now();
    $('msFire').disabled = true;
    ctx.act('fire', { angle: aimOf.angle, power: aimOf.power, aim: aimOf.aim });
  }

  // ---- 3D -----------------------------------------------------------------------------------------------
  function make3d(host) {
    const T = THREE;
    const renderer = GL3.renderer({ alpha: false }, { onLost: () => GL3.revive(host, { build: () => { gl?.dispose(); gl = make3d(host); return gl; }, flat: () => { flat ||= makeFlat(host); }, unflat: () => { flat?.dispose(); flat = null; } }) });
    if (!renderer) return null;
    const canvas = renderer.domElement; canvas.className = 'meteor-gl';
    host.prepend(canvas);
    const scene = new T.Scene(); scene.background = new T.Color('#071426');
    const st = GL3.stage(renderer, scene, { fog: ['#071426', 24, 60], hemi: [0x6f9fd8, 0x0a1424, 0.55], key: { i: 0.45, shadow: false }, env: false, exposure: 0.95 });
    const camera = new T.PerspectiveCamera(50, 1, 0.1, 120);
    const light = new T.PointLight(0x53ddff, 6, 22); light.position.set(0, 7, -8); scene.add(light);
    const floor = new T.Mesh(new T.PlaneGeometry(90, 70), new T.MeshStandardMaterial({ color: 0x0b1a2b, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, -0.15, -15); scene.add(floor);
    const grid = new T.GridHelper(70, 35, 0x24607b, 0x18364d); grid.position.set(0, -0.12, -15); scene.add(grid);
    const pad = new T.Mesh(new T.CylinderGeometry(0.7, 0.9, 0.3, 24), new T.MeshStandardMaterial({ color: 0x1f4560, roughness: 0.6 }));
    pad.position.y = -0.1; scene.add(pad);
    const ringMat = new T.MeshStandardMaterial({ color: 0xffc857, emissive: 0x8c4210, roughness: 0.35 });
    const ring = new T.Mesh(new T.TorusGeometry(1.45, 0.13, 16, 64), ringMat); scene.add(ring);
    const core = new T.Mesh(new T.SphereGeometry(0.28, 20, 14), new T.MeshStandardMaterial({ color: 0xfff0a5, emissive: 0xff8c24, emissiveIntensity: 1.3 }));
    ring.add(core);
    const post = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 1, 8), new T.MeshBasicMaterial({ color: 0x24607b }));
    scene.add(post);
    const comet = new T.Mesh(new T.SphereGeometry(0.3, 20, 14), new T.MeshStandardMaterial({ color: 0x64e8ff, emissive: 0x00a0e0, emissiveIntensity: 1.5 }));
    comet.visible = false; scene.add(comet);
    const TRAIL = 60, trailGeo = new T.BufferGeometry();
    trailGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    const trail = new T.Line(trailGeo, new T.LineBasicMaterial({ color: 0x9be9ff, transparent: true, opacity: 0.85 }));
    trail.frustumCulled = false; scene.add(trail);
    const arrowGeo = new T.BufferGeometry(); arrowGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(6), 3));
    const arrow = new T.Line(arrowGeo, new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    arrow.frustumCulled = false; scene.add(arrow);
    const burst = new T.Mesh(new T.RingGeometry(0.3, 0.5, 32), new T.MeshBasicMaterial({ color: 0xffe08a, transparent: true, side: T.DoubleSide }));
    burst.visible = false; scene.add(burst);
    const stars = new T.BufferGeometry(), sp = new Float32Array(240 * 3);
    for (let i = 0; i < 240; i++) sp.set([(Math.random() - 0.5) * 90, 3 + Math.random() * 30, -10 - Math.random() * 60], i * 3);
    stars.setAttribute('position', new T.BufferAttribute(sp, 3));
    scene.add(new T.Points(stars, new T.PointsMaterial({ color: 0xb8dfff, size: 0.12 })));

    function draw(now) {
      const w = host.clientWidth || 320, h = host.clientHeight || 300;
      if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || camera.aspect !== w / h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
      // behind the launcher, looking down-range; a narrow screen backs off so the ring's sideways range fits
      const back = w / h < 0.8 ? 4 : 0;
      camera.position.set(0, 4.2 + back * 0.3, 7 + back); camera.lookAt(0, 2.2, -10);
      ring.position.set(ringAt[0], RING_Y, -ringAt[1]); ring.rotation.z = Math.sin(now * 0.0008) * 0.12;
      post.scale.y = RING_Y - 1.45; post.position.set(ringAt[0], (RING_Y - 1.45) / 2 - 0.12, -ringAt[1]);
      // the launch direction (not the path): a short line from the pad
      const a = aimOf.angle * Math.PI / 180, m = aimOf.aim * Math.PI / 180, L = aimOf.power * 0.16;
      arrowGeo.attributes.position.array.set([0, 0.2, 0, Math.sin(m) * Math.cos(a) * L, 0.2 + Math.sin(a) * L, -Math.cos(m) * Math.cos(a) * L]);
      arrowGeo.attributes.position.needsUpdate = true;
      arrow.visible = !flight && !!ctx?.myTurn;
      const f = flight;
      if (f) {
        const t = f.t, p = pos(f.s, t);
        comet.visible = t <= f.T * 1.12; comet.position.set(...p);
        const arr = trailGeo.attributes.position.array;
        for (let i = 0; i < TRAIL; i++) arr.set(pos(f.s, Math.max(0, t - (TRAIL - 1 - i) * 0.018)), i * 3);
        trailGeo.attributes.position.needsUpdate = true; trail.visible = true;
        if (t >= f.T) {
          const k = Math.min(1, (t - f.T) / 0.6);
          burst.visible = k < 1; burst.position.set(f.hit[0], f.hit[1], -f.s.target[1]); burst.scale.setScalar(1 + k * 5);
          burst.material.opacity = 1 - k;
        }
        ringMat.emissive.setHex(f.s.points >= 60 && t >= f.T ? 0xffa030 : 0x8c4210);
      } else { trail.visible = false; comet.visible = false; burst.visible = false; ringMat.emissive.setHex(0x8c4210); }
      st.follow(camera);
      renderer.render(scene, camera);
    }
    function dispose() {
      scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
      st.dispose(); renderer.dispose(); canvas.remove();
    }
    return { draw, dispose };
  }

  // ---- flat (no WebGL): the same scene from the same spot, drawn on a 2D canvas ------------------------------
  function makeFlat(host) {
    const c = document.createElement('canvas'); c.className = 'meteor-flat';
    host.prepend(c);
    const g = c.getContext('2d');
    function draw() {
      if (!g) return;
      const w = host.clientWidth || 320, h = host.clientHeight || 300, dpr = Math.min(devicePixelRatio || 1, 2);
      if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const F = Math.min(w, h) * 1.1, cy = h * 0.42;
      const P = ([x, y, z]) => { const d = Math.max(0.5, 7 - z); return [w / 2 + x / d * F, cy - (y - 2.6) / d * F, F / d]; };
      const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#071426'); sky.addColorStop(1, '#12395b');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#24607b55'; g.lineWidth = 1;
      for (let z = -2; z >= -40; z -= 3) { const [x1, y1] = P([-30, -0.12, z]), [x2] = P([30, -0.12, z]); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y1); g.stroke(); }
      for (let x = -30; x <= 30; x += 3) { const a = P([x, -0.12, 0]), b = P([x, -0.12, -40]); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
      const [rx, ry, rs] = P([ringAt[0], RING_Y, -ringAt[1]]);
      g.lineWidth = Math.max(2, rs * 0.14); g.strokeStyle = '#ffc857'; g.beginPath(); g.arc(rx, ry, rs * 1.45, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#ff8c24'; g.beginPath(); g.arc(rx, ry, Math.max(2, rs * 0.28), 0, Math.PI * 2); g.fill();
      const pad = P([0, 0, 0]); g.fillStyle = '#2b5a7a'; g.beginPath(); g.ellipse(pad[0], pad[1], pad[2] * 0.8, pad[2] * 0.25, 0, 0, Math.PI * 2); g.fill();
      if (!flight && ctx?.myTurn) {
        const a = aimOf.angle * Math.PI / 180, m = aimOf.aim * Math.PI / 180, L = aimOf.power * 0.16;
        const tip = P([Math.sin(m) * Math.cos(a) * L, 0.2 + Math.sin(a) * L, -Math.cos(m) * Math.cos(a) * L]), base = P([0, 0.2, 0]);
        g.strokeStyle = '#ffffffb0'; g.lineWidth = 3; g.beginPath(); g.moveTo(base[0], base[1]); g.lineTo(tip[0], tip[1]); g.stroke();
      }
      const f = flight;
      if (f) {
        g.strokeStyle = '#9be9ff'; g.lineWidth = 2; g.beginPath();
        for (let i = 0; i <= 50; i++) { const q = P(pos(f.s, Math.max(0, f.t - (50 - i) * 0.02))); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }
        g.stroke();
        if (f.t <= f.T * 1.12) { const q = P(pos(f.s, f.t)); g.fillStyle = '#64e8ff'; g.beginPath(); g.arc(q[0], q[1], Math.max(3, q[2] * 0.3), 0, Math.PI * 2); g.fill(); }
        if (f.t >= f.T) {
          const k = Math.min(1, (f.t - f.T) / 0.6), q = P([f.hit[0], f.hit[1], -f.s.target[1]]);
          g.strokeStyle = `rgba(255,224,138,${1 - k})`; g.lineWidth = 3; g.beginPath(); g.arc(q[0], q[1], q[2] * (0.4 + k * 2.5), 0, Math.PI * 2); g.stroke();
        }
      }
    }
    return { draw, dispose: () => c.remove() };
  }

  // ---- playback ----------------------------------------------------------------------------------------
  let lastT = 0;
  function loop(now = performance.now()) {
    frame = requestAnimationFrame(loop);
    if (!stage?.isConnected) return;
    const dt = Math.min(0.05, (now - (lastT || now)) / 1000); lastT = now;
    if (flight) {
      flight.t += dt / 1.4;   // a little slower than real time, so the arc can be followed
      if (flight.t >= flight.T && !flight.popped) { flight.popped = true; pop(flight.s); }
      if (flight.t > flight.T + 1.3) { flight = null; ringAt = S?.target || ringAt; paint(); }
      dirty = true;
    } else if (S && (ringAt[0] !== S.target[0] || ringAt[1] !== S.target[1])) ringAt = S.target, dirty = true;
    if (!dirty && !gl) return;
    if (!dirty && now % 66 > 17) return;   // idle: ~15 fps keeps the ring's sway alive without burning a phone
    dirty = false;
    (gl || flat)?.draw(now);
  }

  function pop(s) {
    const el = $('msPop'); if (!el) return;
    const who = ctx?.me === s.pid ? 'You' : (S?.board?.find((b) => b.id === s.pid)?.name || '');
    el.textContent = `${s.points >= 90 ? '🎯 ' : ''}${s.points}${who ? ` · ${who}` : ''}`;
    el.className = `meteor-pop ${s.points >= 90 ? 'gold' : s.points >= 60 ? 'good' : s.points > 0 ? '' : 'miss'}`;
    el.hidden = false; void el.offsetWidth; el.classList.add('show');
    clearTimeout(pop.t); pop.t = setTimeout(() => { el.hidden = true; }, 1500);
  }

  function paint() {
    if (!S || !$('msHud')) return;
    const wind = Math.abs(S.wind) < 0.1 ? 'calm' : `${S.wind > 0 ? '→' : '←'} ${Math.abs(S.wind).toFixed(1)}`;
    const mine = S.score != null;
    $('msHud').innerHTML = `${mine ? `<span>☄️ ${S.score}</span>` : ''}<span>Round ${Math.min(S.round, S.shotsMax)}/${S.shotsMax}</span><span>💨 ${wind}</span>`;
    const turnName = S.board?.find((b) => b.id === ctx?.turn)?.name;
    const wait = $('msWait');
    wait.hidden = !!ctx?.myTurn || !!flight || !turnName;
    if (turnName) wait.textContent = `${turnName} is aiming…`;
    $('msFire').disabled = !ctx?.myTurn || !!flight;
    const board = [...(S.board || [])].sort((a, b) => b.score - a.score);
    $('msSide').innerHTML = board.map((b) => `<div class="meteor-row${b.id === ctx?.me ? ' ms-me' : ''}${b.id === ctx?.turn ? ' ms-now' : ''}"><span>${esc(b.name)}</span><span class="dots">${'●'.repeat(b.shots)}${'○'.repeat(Math.max(0, S.shotsMax - b.shots))}</span><b>${b.score}</b></div>`).join('')
      + (S.last ? `<p class="hint left">Last: ${esc(S.board?.find((b) => b.id === S.last.pid)?.name || '')} ${S.last.points} pts (${S.last.angle}°, power ${S.last.power}, aim ${S.last.aim}°)</p>` : '');
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

  function render(view, c) {
    const state = view.meteor;
    if (!state) return;
    S = state; ctx = { ...c, me: view.me?.id, turn: view.turn };
    const L = state.last;
    if (L && seen !== L.n) {
      const fresh = seen !== null || Date.now() - sentAt < 5000;
      seen = L.n;
      if (fresh && L.target) {   // play the new shot (not an old one found on (re)join)
        const s = { ...L, wind: L.wind ?? state.wind };
        ringAt = L.target;
        flight = { s, t: 0, T: flightTime(s), hit: L.landing };
      }
    } else if (!L) seen = 0;
    if (Date.now() - sentAt > 1500 || !c.myTurn) sentAt = 0;
    paint(); dirty = true;
  }

  return {
    mount, render,
    unmount() { mount.off?.(); cancelAnimationFrame(frame); gl?.dispose(); flat?.dispose(); gl = flat = null; flight = null; seen = null; stage = null; },
  };
})();
