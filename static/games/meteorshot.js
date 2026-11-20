// Meteor Shot: aim a comet through a floating ring. The server flies and scores each launch (games/meteorshot.py);
// this view plays the flight back on the same arc: three.js when it can, a flat drawing of the same scene when not.
UI.meteorshot = (() => {
  const RING_Y = 2.2, LIM = { angle: [18, 72], power: [8, 20], aim: [-16, 16] };
  const clamp = (v, [a, b]) => Math.max(a, Math.min(b, v));
  const $ = (id) => document.getElementById(id);
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem('gn.meteor')) || {}; } catch { return {}; } })();
  const aimOf = { angle: saved.angle ?? 45, power: saved.power ?? 14, aim: saved.aim ?? 0 };
  let stage, S = null, ctx = null, frame = 0, dirty = true, seen = null, flight = null, sentAt = 0;
  let gl = null, flat = null, ringAt = [0, 10], novaShot = false, clockSync = Date.now(), hudAt = 0;

  // the comet's position t seconds after launch (same maths as fly() on the server); z runs down-range (negative)
  function pos(s, t) {
    const r = s.angle * Math.PI / 180, vz = s.power * Math.cos(r), vy = s.power * Math.sin(r);
    return [Math.tan(s.aim * Math.PI / 180) * vz * t + s.wind * t * t * 0.8, vy * t - (s.gravity ?? 4.9) * t * t, -vz * t];
  }
  const flightTime = (s) => s.target[1] / (s.power * Math.cos(s.angle * Math.PI / 180));
  const elapsedNow = () => flight ? (flight.s.elapsed || 0) + flight.t : (S?.elapsed || 0) + (Date.now() - clockSync) / 1000;
  function targetAt(elapsed) {
    const m = S?.motion || {}, phase = (m.phase || 0) + elapsed * (m.speed || 0);
    return [(S?.target?.[0] || 0) + (m.drift || 0) * Math.sin(phase), RING_Y + (m.drift || 0) * 0.2 * Math.cos(phase * 0.8), -(S?.target?.[1] || ringAt[1])];
  }
  function preview() {
    const s = { ...aimOf, target: ringAt, wind: S?.wind || 0, gravity: S?.gravity ?? 4.9 };
    const T = flightTime(s), hit = pos(s, T);
    const targetHit = targetAt(elapsedNow() + T);
    const base = Math.max(0, 100 - Math.floor(Math.hypot(hit[0] - targetHit[0], hit[1] - targetHit[1]) * 22));
    const me = S?.board?.find((b) => b.id === ctx?.me), streakBonus = base >= 80 ? Math.min(45, (me?.streak || 0) * 15) : 0;
    return { s, T, hit, targetHit, points: Math.floor(base * (novaShot ? 1.5 : 1) * (S?.finale ? 2 : 1)) + streakBonus };
  }

  function mount(main, side) {
    main.innerHTML = `<div class="meteor-wrap">
      <div class="meteor-stage" id="msStage"><div class="meteor-hud" id="msHud"></div><div class="meteor-pop" id="msPop" hidden></div><div class="meteor-wait" id="msWait" hidden></div></div>
      <div class="meteor-controls">
        <label>📐 Angle <input id="msAngle" type="range" min="18" max="72" step="1"><b id="msAngleN"></b></label>
        <label>💪 Power <input id="msPower" type="range" min="8" max="20" step="0.5"><b id="msPowerN"></b></label>
        <label>↔ Aim <input id="msAim" type="range" min="-16" max="16" step="0.5"><b id="msAimN"></b></label>
        <button id="msNova" type="button" aria-pressed="false">🌟 Nova ×1.5</button>
        <button id="msFire" type="button">☄️ Fire</button>
      </div>
      <p class="hint">The ring drifts while your comet flies: lead its ghost ring and fire when the live estimate peaks. Gravity and wind shift each round. Score 80+ for streak bonuses; use your one Nova shot for 1.5× points. Keys: ↑↓ angle, ←→ aim, W/S power, Space fires.</p></div>`;
    side.innerHTML = '<div class="panel"><h3>☄️ Scores</h3><div id="msSide"></div><p class="hint left">The ring and wind change each round. Each player gets one Nova shot worth 1.5×.</p></div>';
    stage = $('msStage');
    for (const k of ['angle', 'power', 'aim']) {
      const inp = $(`ms${k[0].toUpperCase()}${k.slice(1)}`);
      inp.value = aimOf[k];
      inp.oninput = () => setAim(k, +inp.value);
    }
    showAim();
    $('msNova').onclick = () => { novaShot = !novaShot; paint(); };
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
    ctx.act('fire', { angle: aimOf.angle, power: aimOf.power, aim: aimOf.aim, nova: novaShot });
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
    const padGlow = new T.Mesh(new T.TorusGeometry(0.82, 0.035, 8, 40), new T.MeshBasicMaterial({ color: 0x20cfff, transparent: true, opacity: 0.75, blending: T.AdditiveBlending }));
    padGlow.rotation.x = Math.PI / 2; padGlow.position.y = 0.07; scene.add(padGlow);
    const ringMat = new T.MeshStandardMaterial({ color: 0xffc857, emissive: 0x8c4210, roughness: 0.35 });
    const ring = new T.Mesh(new T.TorusGeometry(1.45, 0.13, 16, 64), ringMat); scene.add(ring);
    const haloMat = new T.MeshBasicMaterial({ color: 0xffc857, transparent: true, opacity: 0.34, side: T.DoubleSide, blending: T.AdditiveBlending, depthWrite: false });
    const halo = new T.Mesh(new T.TorusGeometry(1.72, 0.055, 8, 64), haloMat); scene.add(halo);
    const portal = new T.Mesh(new T.TorusGeometry(1.08, 0.025, 8, 64), new T.MeshBasicMaterial({ color: 0x53ddff, transparent: true, opacity: 0.7, blending: T.AdditiveBlending, depthWrite: false })); scene.add(portal);
    const ghostTarget = new T.Mesh(new T.TorusGeometry(1.45, 0.045, 8, 48), new T.MeshBasicMaterial({ color: 0x53ddff, transparent: true, opacity: 0.4, blending: T.AdditiveBlending, depthWrite: false })); scene.add(ghostTarget);
    const core = new T.Mesh(new T.SphereGeometry(0.28, 20, 14), new T.MeshStandardMaterial({ color: 0xfff0a5, emissive: 0xff8c24, emissiveIntensity: 1.3 }));
    ring.add(core);
    const post = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 1, 8), new T.MeshBasicMaterial({ color: 0x24607b }));
    scene.add(post);
    const comet = new T.Mesh(new T.SphereGeometry(0.3, 20, 14), new T.MeshStandardMaterial({ color: 0x64e8ff, emissive: 0x00a0e0, emissiveIntensity: 1.5 }));
    comet.visible = false; scene.add(comet);
    const cometGlow = new T.Mesh(new T.SphereGeometry(0.58, 16, 12), new T.MeshBasicMaterial({ color: 0x32dfff, transparent: true, opacity: 0.2, blending: T.AdditiveBlending, depthWrite: false })); comet.add(cometGlow);
    comet.add(new T.PointLight(0x36dfff, 3, 8));
    const TRAIL = 60, trailGeo = new T.BufferGeometry();
    trailGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    const trail = new T.Line(trailGeo, new T.LineBasicMaterial({ color: 0x9be9ff, transparent: true, opacity: 0.85 }));
    trail.frustumCulled = false; scene.add(trail);
    const sparksGeo = new T.BufferGeometry(); sparksGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    const sparks = new T.Points(sparksGeo, new T.PointsMaterial({ color: 0x9be9ff, size: 0.16, transparent: true, opacity: 0.85, blending: T.AdditiveBlending, depthWrite: false }));
    sparks.frustumCulled = false; scene.add(sparks);
    const arrowGeo = new T.BufferGeometry(); arrowGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(6), 3));
    const arrow = new T.Line(arrowGeo, new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    arrow.frustumCulled = false; scene.add(arrow);
    const previewGeo = new T.BufferGeometry(); previewGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(48 * 3), 3));
    const previewLine = new T.Line(previewGeo, new T.LineBasicMaterial({ color: 0x53ddff, transparent: true, opacity: 0.65 }));
    previewLine.frustumCulled = false; scene.add(previewLine);
    const landing = new T.Mesh(new T.SphereGeometry(0.14, 12, 8), new T.MeshBasicMaterial({ color: 0x53ddff })); scene.add(landing);
    const burst = new T.Mesh(new T.RingGeometry(0.3, 0.5, 32), new T.MeshBasicMaterial({ color: 0xffe08a, transparent: true, side: T.DoubleSide }));
    burst.visible = false; scene.add(burst);
    // a shower of sparks where the comet lands: gold on a bullseye, green on a good one, ember-orange on a graze
    const SH = 48, shDir = Array.from({ length: SH }, () => { const a = Math.random() * 6.283, b = Math.random() * 3.1416, sp = 0.5 + Math.random(); return [Math.sin(b) * Math.cos(a) * sp, Math.cos(b) * sp, Math.sin(b) * Math.sin(a) * sp]; });
    const shGeo = new T.BufferGeometry(); shGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(SH * 3), 3));
    const shower = new T.Points(shGeo, new T.PointsMaterial({ size: 0.22, color: 0xffd166, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
    shower.visible = false; shower.frustumCulled = false; scene.add(shower);
    const stars = new T.BufferGeometry(), sp = new Float32Array(520 * 3), starColors = new Float32Array(520 * 3);
    for (let i = 0; i < 520; i++) {
      sp.set([(Math.random() - 0.5) * 90, 2 + Math.random() * 36, -10 - Math.random() * 75], i * 3);
      const tint = Math.random(); starColors.set([0.45 + tint * 0.45, 0.68 + tint * 0.28, 0.9 + tint * 0.1], i * 3);
    }
    stars.setAttribute('position', new T.BufferAttribute(sp, 3));
    stars.setAttribute('color', new T.BufferAttribute(starColors, 3));
    scene.add(new T.Points(stars, new T.PointsMaterial({ color: 0xffffff, vertexColors: true, size: 0.17, sizeAttenuation: true, transparent: true, opacity: 0.9 })));

    function draw(now) {
      const w = host.clientWidth || 320, h = host.clientHeight || 300;
      if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || camera.aspect !== w / h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
      // behind the launcher, looking down-range; a narrow screen backs off so the ring's sideways range fits
      const back = w / h < 0.8 ? 4 : 0;
      camera.position.set(0, 4.2 + back * 0.3, 7 + back); camera.lookAt(0, 2.2, -10);
      const currentTarget = targetAt(elapsedNow());
      ring.position.set(...currentTarget); ring.rotation.z = Math.sin(now * 0.0008) * 0.12;
      halo.position.copy(ring.position); halo.rotation.z = -ring.rotation.z * 1.4 + now * 0.00012;
      portal.position.copy(ring.position); portal.rotation.z = ring.rotation.z * 0.7 - now * 0.00018;
      haloMat.opacity = 0.25 + (Math.sin(now * 0.003) + 1) * 0.09;
      post.scale.y = currentTarget[1] - 1.45; post.position.set(currentTarget[0], (currentTarget[1] - 1.45) / 2 - 0.12, currentTarget[2]);
      // the launch direction (not the path): a short line from the pad
      const a = aimOf.angle * Math.PI / 180, m = aimOf.aim * Math.PI / 180, L = aimOf.power * 0.16;
      arrowGeo.attributes.position.array.set([0, 0.2, 0, Math.sin(m) * Math.cos(a) * L, 0.2 + Math.sin(a) * L, -Math.cos(m) * Math.cos(a) * L]);
      arrowGeo.attributes.position.needsUpdate = true;
      arrow.visible = !flight && !!ctx?.myTurn;
      previewLine.visible = arrow.visible; landing.visible = arrow.visible;
      ghostTarget.visible = arrow.visible;
      if (previewLine.visible) {
        const pv = preview(), arr = previewGeo.attributes.position.array;
        for (let i = 0; i < 48; i++) arr.set(pos(pv.s, pv.T * i / 47), i * 3);
        previewGeo.attributes.position.needsUpdate = true; landing.position.set(...pv.hit);
        ghostTarget.position.set(...pv.targetHit); ghostTarget.rotation.z = ring.rotation.z;
      }
      const f = flight;
      if (f) {
        const t = f.t, p = pos(f.s, t);
        comet.visible = t <= f.T * 1.12; comet.position.set(...p);
        const arr = trailGeo.attributes.position.array;
        for (let i = 0; i < TRAIL; i++) arr.set(pos(f.s, Math.max(0, t - (TRAIL - 1 - i) * 0.018)), i * 3);
        trailGeo.attributes.position.needsUpdate = true; sparksGeo.attributes.position.array.set(arr); sparksGeo.attributes.position.needsUpdate = true;
        trail.visible = true; sparks.visible = true;
        if (t >= f.T) {
          const k = Math.min(1, (t - f.T) / 0.6);
          burst.visible = k < 1; burst.position.set(f.hit[0], f.hit[1], -f.s.target[1]); burst.scale.setScalar(1 + k * 5);
          burst.material.opacity = 1 - k;
          const pts = f.s.points, kk = Math.min(1, (t - f.T) / 0.9);
          shower.visible = pts > 0 && kk < 1;
          if (shower.visible) {
            shower.material.color.setHex(pts >= 90 ? 0xffd166 : pts >= 60 ? 0x7dffb0 : 0xff9060); shower.material.opacity = 1 - kk;
            const q = shGeo.attributes.position.array, sc = (pts >= 90 ? 4.5 : 3) * kk;
            for (let i = 0; i < SH; i++) { q[i * 3] = f.hit[0] + shDir[i][0] * sc; q[i * 3 + 1] = f.hit[1] + shDir[i][1] * sc - kk * kk * 1.8; q[i * 3 + 2] = -f.s.target[1] + shDir[i][2] * sc; }
            shGeo.attributes.position.needsUpdate = true;
          }
        }
        ringMat.emissive.setHex(f.s.points >= 60 && t >= f.T ? 0xffa030 : 0x8c4210);
      } else { trail.visible = false; sparks.visible = false; comet.visible = false; burst.visible = false; shower.visible = false; ringMat.emissive.setHex(0x8c4210); }
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
      const nebula = g.createRadialGradient(w * 0.68, h * 0.22, 0, w * 0.68, h * 0.22, w * 0.65);
      nebula.addColorStop(0, '#6040b533'); nebula.addColorStop(0.55, '#1c86a51a'); nebula.addColorStop(1, '#07142600');
      g.fillStyle = nebula; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) {
        const x = ((i * 97.31) % 997) / 997 * w, y = ((i * 61.73) % 991) / 991 * h;
        const r = i % 11 === 0 ? 1.7 : 0.7 + (i % 3) * 0.35;
        g.fillStyle = i % 5 === 0 ? '#8ceaffaa' : '#d9edff99'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        if (i % 11 === 0) { g.strokeStyle = '#8ceaff55'; g.lineWidth = 1; g.beginPath(); g.moveTo(x - 4, y); g.lineTo(x + 4, y); g.moveTo(x, y - 4); g.lineTo(x, y + 4); g.stroke(); }
      }
      g.strokeStyle = '#24607b55'; g.lineWidth = 1;
      for (let z = -2; z >= -40; z -= 3) { const [x1, y1] = P([-30, -0.12, z]), [x2] = P([30, -0.12, z]); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y1); g.stroke(); }
      for (let x = -30; x <= 30; x += 3) { const a = P([x, -0.12, 0]), b = P([x, -0.12, -40]); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
      const [ringX, ringY, ringZ] = targetAt(elapsedNow());
      const [rx, ry, rs] = P([ringX, ringY, ringZ]);
      const pulse = 0.5 + (Math.sin(performance.now() * 0.003) + 1) * 0.12;
      g.shadowColor = '#ffc857'; g.shadowBlur = rs * 0.85;
      g.lineWidth = Math.max(2, rs * 0.2); g.strokeStyle = '#ffc857'; g.beginPath(); g.arc(rx, ry, rs * 1.45, 0, Math.PI * 2); g.stroke();
      g.shadowBlur = 0; g.lineWidth = Math.max(1, rs * 0.035); g.strokeStyle = `rgba(83,221,255,${pulse})`; g.beginPath(); g.arc(rx, ry, rs * 1.68, 0, Math.PI * 2); g.stroke();
      g.setLineDash([Math.max(2, rs * 0.12), Math.max(3, rs * 0.18)]); g.lineWidth = Math.max(1, rs * 0.025); g.strokeStyle = '#fff4c788'; g.beginPath(); g.arc(rx, ry, rs * 1.83, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      const coreGlow = g.createRadialGradient(rx, ry, 0, rx, ry, rs * 0.75); coreGlow.addColorStop(0, '#fff7cfff'); coreGlow.addColorStop(0.24, '#ff9d35dd'); coreGlow.addColorStop(1, '#ff8c2400');
      g.fillStyle = coreGlow; g.beginPath(); g.arc(rx, ry, rs * 0.75, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ff8c24'; g.beginPath(); g.arc(rx, ry, Math.max(2, rs * 0.25), 0, Math.PI * 2); g.fill();
      const pad = P([0, 0, 0]); g.shadowColor = '#20cfff'; g.shadowBlur = pad[2] * 0.6; g.fillStyle = '#2b5a7a'; g.beginPath(); g.ellipse(pad[0], pad[1], pad[2] * 0.8, pad[2] * 0.25, 0, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0; g.strokeStyle = '#53ddff'; g.lineWidth = 2; g.beginPath(); g.ellipse(pad[0], pad[1], pad[2] * 0.8, pad[2] * 0.25, 0, 0, Math.PI * 2); g.stroke();
      if (!flight && ctx?.myTurn) {
        const a = aimOf.angle * Math.PI / 180, m = aimOf.aim * Math.PI / 180, L = aimOf.power * 0.16;
        const tip = P([Math.sin(m) * Math.cos(a) * L, 0.2 + Math.sin(a) * L, -Math.cos(m) * Math.cos(a) * L]), base = P([0, 0.2, 0]);
        g.strokeStyle = '#ffffffb0'; g.lineWidth = 3; g.beginPath(); g.moveTo(base[0], base[1]); g.lineTo(tip[0], tip[1]); g.stroke();
        const pv = preview();
        g.strokeStyle = '#53ddff99'; g.lineWidth = 2; g.setLineDash([4, 5]); g.beginPath();
        for (let i = 0; i < 48; i++) { const q = P(pos(pv.s, pv.T * i / 47)); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }
        g.stroke(); g.setLineDash([]);
        const [gx, gy, gr] = P(pv.targetHit); g.strokeStyle = '#53ddff88'; g.lineWidth = Math.max(1, gr * 0.06); g.setLineDash([4, 5]);
        g.beginPath(); g.arc(gx, gy, gr * 1.45, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
        const q = P(pv.hit); g.fillStyle = '#53ddff'; g.beginPath(); g.arc(q[0], q[1], Math.max(4, q[2] * 0.14), 0, Math.PI * 2); g.fill();
      }
      const f = flight;
      if (f) {
        g.shadowColor = '#53ddff'; g.shadowBlur = 10; g.strokeStyle = '#9be9ff'; g.lineWidth = 3; g.beginPath();
        for (let i = 0; i <= 50; i++) { const q = P(pos(f.s, Math.max(0, f.t - (50 - i) * 0.02))); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }
        g.stroke(); g.shadowBlur = 0;
        if (f.t <= f.T * 1.12) {
          const q = P(pos(f.s, f.t)), glow = g.createRadialGradient(q[0], q[1], 0, q[0], q[1], Math.max(12, q[2] * 0.8));
          glow.addColorStop(0, '#ffffff'); glow.addColorStop(0.16, '#9ff5ff'); glow.addColorStop(0.5, '#26cfffaa'); glow.addColorStop(1, '#26cfff00');
          g.fillStyle = glow; g.beginPath(); g.arc(q[0], q[1], Math.max(12, q[2] * 0.8), 0, Math.PI * 2); g.fill();
        }
        if (f.t >= f.T) {
          const k = Math.min(1, (f.t - f.T) / 0.6), q = P([f.hit[0], f.hit[1], -f.s.target[1]]);
          g.strokeStyle = `rgba(255,224,138,${1 - k})`; g.lineWidth = 3; g.beginPath(); g.arc(q[0], q[1], q[2] * (0.4 + k * 2.5), 0, Math.PI * 2); g.stroke();
        }
      }
    }
    return { draw, dispose: () => c.remove() };
  }

  // ---- playback ----------------------------------------------------------------------------------------
  let lastT = 0, lastFlat = 0;
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
    if (S && !gl && now - lastFlat > 66) { dirty = true; lastFlat = now; }
    if (S && ctx?.myTurn && !flight && now - hudAt > 120) { updateHud(); hudAt = now; }
    if (!dirty && !gl) return;
    if (!dirty && now % 66 > 17) return;   // idle: ~15 fps keeps the ring's sway alive without burning a phone
    dirty = false;
    (gl || flat)?.draw(now);
  }

  function pop(s) {
    const el = $('msPop'); if (!el) return;
    const who = ctx?.me === s.pid ? 'You' : (S?.board?.find((b) => b.id === s.pid)?.name || '');
    el.textContent = `${s.nova ? '🌟 ' : ''}${s.points >= 90 ? '🎯 ' : ''}${s.points}${s.bonus ? ` (+${s.bonus} streak!)` : ''}${who ? ` · ${who}` : ''}`;
    el.className = `meteor-pop ${s.points >= 90 ? 'gold' : s.points >= 60 ? 'good' : s.points > 0 ? '' : 'miss'}`;
    el.hidden = false; void el.offsetWidth; el.classList.add('show');
    clearTimeout(pop.t); pop.t = setTimeout(() => { el.hidden = true; }, 1500);
  }

  function updateHud() {
    if (!S || !$('msHud')) return;
    const wind = Math.abs(S.wind) < 0.1 ? 'calm' : `${S.wind > 0 ? '→' : '←'} ${Math.abs(S.wind).toFixed(1)}`;
    const grav = S.gravity < 4 ? '🌕 Low-G' : S.gravity > 5.5 ? '🪨 Heavy-G' : '🪐 Standard-G';
    const mine = S.score != null;
    const pv = ctx?.myTurn && !flight ? preview() : null;
    $('msHud').innerHTML = `${mine ? `<span>☄️ ${S.score}</span>` : ''}<span>${S.finale ? '🏁 FINALE ×2' : `Round ${Math.min(S.round, S.shotsMax)}/${S.shotsMax}`}</span><span>💨 ${wind}</span>${S.twist ? `<span>${S.twist === 'gale' ? '🌪️ GALE' : '🍀 LUCKY ×1.5'}</span>` : ''}<span>${grav}</span>${pv ? `<span>${novaShot ? '🌟' : '🎯'} Est. ${pv.points}${pv.points >= 80 ? ' 🔥' : ''}</span>` : ''}`;
    const turnName = S.board?.find((b) => b.id === ctx?.turn)?.name;
    const wait = $('msWait');
    wait.hidden = !!ctx?.myTurn || !!flight || !turnName;
    if (turnName) wait.textContent = `${turnName} is aiming…`;
    $('msFire').disabled = !ctx?.myTurn || !!flight;
    const me = S.board?.find((b) => b.id === ctx?.me), nova = !!me?.nova;
    const novaBtn = $('msNova');
    novaBtn.disabled = !ctx?.myTurn || !!flight || !nova;
    novaBtn.classList.toggle('selected', novaShot && nova);
    novaBtn.setAttribute('aria-pressed', String(novaShot && nova));
    novaBtn.textContent = nova ? `${novaShot ? '✅' : '🌟'} Nova ×1.5` : '✦ Nova used';
  }

  function paint() {
    if (!S || !$('msHud')) return;
    updateHud();
    const board = [...(S.board || [])].sort((a, b) => b.score - a.score);
    $('msSide').innerHTML = board.map((b) => `<div class="meteor-row${b.id === ctx?.me ? ' ms-me' : ''}${b.id === ctx?.turn ? ' ms-now' : ''}"><span>${esc(b.name)}${b.streak >= 2 ? ` 🔥${b.streak}` : ''}</span><span class="dots">${b.nova ? '🌟' : '✦'} ${'●'.repeat(b.shots)}${'○'.repeat(Math.max(0, S.shotsMax - b.shots))}</span><b>${b.score}</b></div>`).join('')
      + (S.mvp ? `<p class="hint left">🏅 Round ${S.mvp.round} MVP: ${S.mvp.pids.map((id) => esc(S.board?.find((b) => b.id === id)?.name || '')).join(', ')} +${S.mvp.bonus}</p>` : '')
      + (S.last ? `<p class="hint left">Last: ${esc(S.board?.find((b) => b.id === S.last.pid)?.name || '')} ${S.last.points} pts${S.last.bonus ? ` (includes +${S.last.bonus} streak)` : ''} (${S.last.angle}°, power ${S.last.power}, aim ${S.last.aim}°)</p>` : '');
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

  function render(view, c) {
    const state = view.meteor;
    if (!state) return;
    S = state; clockSync = Date.now(); ctx = { ...c, me: view.me?.id, turn: view.turn };
    const L = state.last;
    if (L && seen !== L.n) {
      const fresh = seen !== null || Date.now() - sentAt < 5000;
      seen = L.n;
      if (L.pid === view.me?.id) novaShot = false;
      if (fresh && L.target) {   // play the new shot (not an old one found on (re)join)
        const s = { ...L, wind: L.wind ?? state.wind, gravity: L.gravity ?? state.gravity ?? 4.9 };
        ringAt = L.target;
        flight = { s, t: 0, T: flightTime(s), hit: L.landing, targetImpact: L.targetImpact };
      }
    } else if (!L) seen = 0;
    if (Date.now() - sentAt > 1500 || !c.myTurn) sentAt = 0;
    paint(); dirty = true;
  }

  return {
    mount, render,
    unmount() { mount.off?.(); cancelAnimationFrame(frame); gl?.dispose(); flat?.dispose(); gl = flat = null; flight = null; seen = null; stage = null; novaShot = false; },
  };
})();
