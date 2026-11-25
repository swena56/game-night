// Rift Split: grow walls to seal off bouncing orbs. three.js field (flat canvas fallback); the server owns the physics.
(() => {
  const MSG = {
    seal: 'Sealed!', big: 'Huge seal!', hit: 'Wall shattered · life lost', shield: 'Shield absorbed it',
    'shield+': 'Shield ready', slow: 'Orbs slowed', clear: 'Level clear!', over: 'Out of lives',
  };
  const SND = { seal: 'lock', big: 'cheer', hit: 'wrong', shield: 'lock', 'shield+': 'pop', slow: 'pop', clear: 'cheer', over: 'groan' };
  const COLORS = ['#3cf5e0', '#ff6fb5', '#ffd166', '#9d8bff', '#7dff8a', '#ff9a4d'];
  const bestKey = 'riftsplit.best';
  const HALF = ['#3cf5e0', '#ffd166'];   // the two sides of a growing wall: cyan and gold
  const RED = '#ff4d4d';                  // orbs are red on one hemisphere and white on the other
  let g;

  const store = {
    get() { try { const v = Number(localStorage.getItem(bestKey)); return Number.isFinite(v) && v > 0 ? v : 0; } catch { return 0; } },
    set(v) { try { localStorage.setItem(bestKey, String(v)); } catch { /* private mode */ } },
  };

  // ---------- shared geometry ----------
  // A wall: [vertical, cx, cy, len0, room0, st0, len1, room1, st1]. Returns board-space rects [x0, x1, y0, y1, state].
  function wallRects(w) {
    if (!w || !w.length) return [];
    const v = w[0], cx = w[1], cy = w[2], c = v ? cy : cx, out = [];
    for (let i = 0; i < 2; i++) {
      const len = w[3 + i * 3], st = w[5 + i * 3];
      if (!len || st === 'd' || st === 'x') continue;   // locked into the grid, or shattered
      const lo = i === 0 ? c + 1 - len : c + 1, hi = i === 0 ? c + 1 : c + 1 + len;
      out.push(v ? [cx, cx + 1, lo, hi, st, i] : [lo, hi, cy, cy + 1, st, i]);   // i: which half
    }
    return out;
  }
  const cellFree = (grid, x, y) => x >= 0 && y >= 0 && x < g.W && y < g.H && grid[y * g.W + x] === '0';


  // The seal ripples inward: each new cell waits in proportion to its distance from the cells that were already solid.
  // Sets born[] (ms timestamps) and returns when the animation ends plus sparks to fire: [time, x, y, count].
  function ripple(prev, grid, now, born) {
    const dist = new Int16Array(grid.length).fill(-1), queue = [];
    for (let i = 0; i < grid.length; i++) if (prev[i] === '1') { dist[i] = 0; queue.push(i); }
    let far = 0;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q], x = i % g.W, y = (i - x) / g.W;
      for (const j of [x > 0 ? i - 1 : -1, x < g.W - 1 ? i + 1 : -1, y > 0 ? i - g.W : -1, y < g.H - 1 ? i + g.W : -1]) {
        if (j < 0 || dist[j] >= 0 || grid[j] !== '1') continue;
        dist[j] = dist[i] + 1; far = Math.max(far, dist[j]); queue.push(j);
      }
    }
    const step = Math.min(24, 420 / Math.max(1, far)), fresh = [];
    for (let i = 0; i < grid.length; i++) if (grid[i] === '1' && prev[i] !== '1') { born[i] = now + Math.max(0, dist[i]) * step; fresh.push(i); }
    const every = Math.max(1, Math.floor(fresh.length / 40)), big = fresh.length >= 90, sparks = [];
    for (let q = 0; q < fresh.length; q += every) sparks.push([born[fresh[q]], fresh[q] % g.W + 0.5, Math.floor(fresh[q] / g.W) + 0.5, big ? 5 : 3]);
    return { until: now + far * step + 450, sparks };
  }

  // A wall half that was growing and is now gone was struck by an orb. Updates `prev` and returns the head [x, y] of each shattered half.
  function shatters(prev, w) {
    const out = [];
    for (let i = 0; i < 2; i++) {
      const st = w.length ? w[5 + i * 3] : '';
      if (prev[i] === 'g' && st === 'x') {
        const v = w[0], c = v ? w[2] : w[1], head = i === 0 ? c + 1 - w[3 + i * 3] : c + 1 + w[3 + i * 3];
        out.push(v ? [w[1] + 0.5, head, i] : [head, w[2] + 0.5, i]);
      }
      prev[i] = st;
    }
    return out;
  }

  // Pickup icons drawn with canvas paths (no emoji font needed): a shield with a check, an hourglass. 128x128 box.
  function drawPickupIcon(x, kind) {
    x.save(); x.translate(64, 64); x.lineJoin = x.lineCap = 'round';
    const grad = x.createLinearGradient(0, -48, 0, 48);
    if (kind === 'shield') {
      grad.addColorStop(0, '#b9ffd6'); grad.addColorStop(1, '#19b86a');
      x.beginPath(); x.moveTo(0, -48); x.lineTo(38, -34); x.lineTo(38, 2); x.quadraticCurveTo(36, 34, 0, 50); x.quadraticCurveTo(-36, 34, -38, 2); x.lineTo(-38, -34); x.closePath();
      x.fillStyle = grad; x.fill(); x.lineWidth = 6; x.strokeStyle = '#eafff3'; x.stroke();
      x.beginPath(); x.moveTo(-16, 2); x.lineTo(-4, 16); x.lineTo(18, -12); x.lineWidth = 10; x.strokeStyle = '#0b5c36'; x.stroke();
    } else {
      grad.addColorStop(0, '#fff2b0'); grad.addColorStop(1, '#f2a516');
      x.beginPath(); x.moveTo(-30, -44); x.lineTo(30, -44); x.lineTo(6, -2); x.lineTo(30, 44); x.lineTo(-30, 44); x.lineTo(-6, -2); x.closePath();
      x.fillStyle = grad; x.fill(); x.lineWidth = 6; x.strokeStyle = '#fff8dc'; x.stroke();
      x.beginPath(); x.moveTo(-18, 38); x.lineTo(18, 38); x.lineTo(0, 16); x.closePath(); x.fillStyle = '#7a4a00'; x.fill();   // the sand
    }
    x.restore();
  }

  // ---------- flat renderer ----------
  function flatRenderer(stage) {
    const canvas = document.createElement('canvas');
    canvas.className = 'rs-canvas';
    stage.append(canvas);
    const c = canvas.getContext('2d');
    if (!c) { canvas.remove(); return null; }
    const fx = GL3.level() !== 'low';
    let size = [0, 0], lastGrid = '0'.repeat(g.W * g.H), animUntil = 0, last = 0, shake = 0;
    const born = new Float32Array(g.W * g.H), pending = [], parts = [], hist = [], prevHalf = ['', ''];
    const icons = {};
    const icon = (kind) => icons[kind] ||= (() => { const k = document.createElement('canvas'); k.width = k.height = 128; const x = k.getContext('2d'); if (x) drawPickupIcon(x, kind); return k; })();
    const burst = (x, y, n, color, speed = 6) => {
      if (!fx) return;
      for (let i = 0; i < n && parts.length < 240; i++) {
        const a = Math.random() * 6.283, v = speed * (0.35 + Math.random() * 0.8);
        parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, l: 0.5 + Math.random() * 0.5, c: Math.random() < 0.35 ? '#fff' : color });
      }
    };
    return {
      pick(e) {
        const r = canvas.getBoundingClientRect();
        return { x: Math.floor((e.clientX - r.left) / r.width * g.W), y: Math.floor((e.clientY - r.top) / r.height * g.H) };
      },
      draw(s, now) {
        const w = canvas.clientWidth, h = canvas.clientHeight, dpr = devicePixelRatio || 1;
        if (!w || !h) return;   // mid-zoom or hidden: nothing to draw into
        if (size[0] !== w || size[1] !== h || size[2] !== dpr) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); size = [w, h, dpr]; }
        const dt = Math.min(0.05, Math.max(0, (now - (last || now)) / 1000)); last = now;
        const k = canvas.width / g.W;
        c.setTransform(k, 0, 0, k, 0, 0);
        if (shake > 0.02) { c.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= Math.exp(-dt * 7); } else shake = 0;
        const bg = c.createRadialGradient(g.W / 2, g.H / 2, 2, g.W / 2, g.H / 2, g.W * 0.65);
        bg.addColorStop(0, '#1a2b6a'); bg.addColorStop(1, '#0a1030');
        c.fillStyle = bg; c.fillRect(0, 0, g.W, g.H);
        c.strokeStyle = '#3358b8'; c.lineWidth = 0.04;
        c.beginPath();
        for (let x = 0; x <= g.W; x++) { c.moveTo(x, 0); c.lineTo(x, g.H); }
        for (let y = 0; y <= g.H; y++) { c.moveTo(0, y); c.lineTo(g.W, y); }
        c.stroke();
        if (s.grid !== lastGrid) {
          const r = ripple(lastGrid, s.grid, now, born);
          if (fx) pending.push(...r.sparks);
          lastGrid = s.grid; animUntil = r.until;
        }
        // sealed cells: interior darker, cells touching open space lit like a rim; new ones rise in
        const open = (i, x, y) => (x > 0 && s.grid[i - 1] === '0') || (x < g.W - 1 && s.grid[i + 1] === '0') || (y > 0 && s.grid[i - g.W] === '0') || (y < g.H - 1 && s.grid[i + g.W] === '0');
        for (let i = 0; i < s.grid.length; i++) {
          if (s.grid[i] !== '1') continue;
          const x = i % g.W, y = (i - x) / g.W, t = now < animUntil + 60 ? Math.max(0, Math.min(1, (now - born[i]) / 350)) : 1;
          if (t <= 0) continue;
          const e = 1 - (1 - t) ** 3, inset = (1 - e) * 0.4;
          c.globalAlpha = e;
          c.fillStyle = s.color;
          c.fillRect(x + inset, y + inset, 1 - inset * 2, 1 - inset * 2);
          c.fillStyle = open(i, x, y) ? '#ffffffaa' : '#ffffff38';
          c.fillRect(x + inset, y + inset, 1 - inset * 2, 1 - inset * 2);
        }
        c.globalAlpha = 1;
        for (const p of s.p) {
          const sz = 1.35 + 0.12 * Math.sin(now / 260 + p[0]), tint = p[2] === 'shield' ? '#59ff9a' : '#ffd84a';
          const gl = c.createRadialGradient(p[0] + 0.5, p[1] + 0.5, 0, p[0] + 0.5, p[1] + 0.5, 1.3);
          gl.addColorStop(0, tint + '88'); gl.addColorStop(1, tint + '00');
          c.fillStyle = gl; c.fillRect(p[0] - 1, p[1] - 1, 3, 3);
          c.drawImage(icon(p[2]), p[0] + 0.5 - sz / 2, p[1] + 0.5 - sz / 2, sz, sz);
        }
        // growing walls: a bright core inside a pulsing glow
        c.save();
        c.shadowBlur = fx ? 0.9 * k : 0;
        for (const [x0, x1, y0, y1, st, i] of wallRects(s.w)) {
          const wide = x1 - x0 >= y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hc = HALF[i];
          c.shadowColor = hc;
          c.globalAlpha = 0.3 + 0.2 * Math.sin(now / 90); c.fillStyle = hc; c.fillRect(x0, y0, x1 - x0, y1 - y0);
          c.globalAlpha = 1; c.fillStyle = '#fff';
          if (wide) c.fillRect(x0, cy - 0.15, x1 - x0, 0.3); else c.fillRect(cx - 0.15, y0, 0.3, y1 - y0);
          const hx = wide ? (i === 0 ? x0 : x1) : cx, hy = wide ? cy : (i === 0 ? y0 : y1);
          if (fx && Math.random() < 0.4) burst(hx, hy, 1, hc, 2);
          const tip = c.createRadialGradient(hx, hy, 0, hx, hy, 1.4);
          tip.addColorStop(0, '#ffffffee'); tip.addColorStop(0.4, hc + 'aa'); tip.addColorStop(1, hc + '00');
          c.fillStyle = tip; c.fillRect(hx - 1.5, hy - 1.5, 3, 3);
        }
        c.restore();
        for (const [x, y, i] of shatters(prevHalf, s.w)) { burst(x, y, 34, HALF[i], 8); shake = 0.3; }
        if (s.ghost) {   // where the wall would run: a faint fill with a dashed outline
          c.fillStyle = '#ffffff18'; c.fillRect(...s.ghost);
          c.setLineDash([0.35, 0.22]); c.lineWidth = 0.09; c.strokeStyle = '#ffffffdd'; c.strokeRect(s.ghost[0] + 0.045, s.ghost[1] + 0.045, s.ghost[2] - 0.09, s.ghost[3] - 0.09); c.setLineDash([]);
        }
        // orbs: tail, glow, core
        s.b.forEach((b, i) => {
          const hh = hist[i] ||= [];
          if (!hh.at || now - hh.at > 22) { hh.unshift([b[0], b[1]]); hh.length = Math.min(hh.length, 7); hh.at = now; }
          if (fx && i < 16) hh.forEach((q, j) => {
            const f = 1 - (j + 1) / 8, gl = c.createRadialGradient(q[0], q[1], 0, q[0], q[1], 0.75 * f);
            gl.addColorStop(0, RED + '77'); gl.addColorStop(1, RED + '00');
            c.fillStyle = gl; c.fillRect(q[0] - 1, q[1] - 1, 2, 2);
          });
          const gl = c.createRadialGradient(b[0], b[1], 0, b[0], b[1], 1.2);
          gl.addColorStop(0, '#ffffffcc'); gl.addColorStop(0.35, RED + '55'); gl.addColorStop(1, RED + '00');
          c.fillStyle = gl; c.fillRect(b[0] - 1.3, b[1] - 1.3, 2.6, 2.6);
          // two hemispheres, red and white, turning as the orb travels
          c.save(); c.translate(b[0], b[1]); c.rotate(now / 180 + i);
          c.fillStyle = RED; c.beginPath(); c.arc(0, 0, 0.36, Math.PI, 0); c.fill();
          c.fillStyle = '#fff'; c.beginPath(); c.arc(0, 0, 0.36, 0, Math.PI); c.fill();
          c.restore();
        });
        hist.length = s.b.length;
        for (let q = pending.length - 1; q >= 0; q--) if (pending[q][0] <= now) { burst(pending[q][1], pending[q][2], pending[q][3], s.color, 4); pending.splice(q, 1); }
        for (let i = parts.length - 1; i >= 0; i--) {
          const q = parts[i]; q.l -= dt;
          if (q.l <= 0) { parts.splice(i, 1); continue; }
          q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= Math.exp(-3 * dt); q.vy *= Math.exp(-3 * dt);
          c.globalAlpha = Math.min(1, q.l * 2); c.fillStyle = q.c; c.fillRect(q.x - 0.07, q.y - 0.07, 0.14, 0.14);
        }
        c.globalAlpha = 1;
      },
      dispose() { canvas.remove(); },
    };
  }

  // ---------- three.js renderer ----------
  function threeRenderer(T, stage, onLost) {
    const renderer = GL3.renderer({}, { onLost });
    if (!renderer) return null;
    // GL3 stores every colour linear and marks canvas textures sRGB; the output has to be sRGB too (as GL3.stage does)
    // or the whole scene, sealed cells included, comes out dark. No tone mapping, so colours stay as authored.
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.setClearColor(0x060a1c, 1);
    const canvas = renderer.domElement;
    canvas.className = 'rs-canvas';
    stage.append(canvas);
    const scene = new T.Scene();
    const cam = new T.PerspectiveCamera(34, 1, 1, 200);
    const gx = (x) => x - g.W / 2, gy = (y) => g.H / 2 - y;
    // cool sky / warm floor bounce, one soft key from the upper left, and a faint rim from the opposite side
    scene.add(new T.HemisphereLight(0x8fb4ff, 0x1a1030, 0.6));
    const sun = new T.DirectionalLight(0xfff1dc, 0.85); sun.position.set(-12, 10, 22); scene.add(sun);
    const rim = new T.DirectionalLight(0x4aa8ff, 0.35); rim.position.set(14, -8, 10); scene.add(rim);
    // the first few orbs light the field around them (skipped on the Low graphics setting)
    const orbLights = GL3.level() === 'low' ? [] : [0, 1, 2].map(() => { const l = new T.PointLight(0xffffff, 0, 9, 1.6); l.position.z = 1.4; scene.add(l); return l; });

    // Floor with a grid.
    const tex = document.createElement('canvas'); tex.width = 1024; tex.height = 614;
    const t = tex.getContext('2d');
    t.fillStyle = '#15245a'; t.fillRect(0, 0, 1024, 614);
    t.strokeStyle = '#3d62c4'; t.lineWidth = 1.5;
    for (let i = 0; i <= g.W; i++) { t.beginPath(); t.moveTo(i * 1024 / g.W, 0); t.lineTo(i * 1024 / g.W, 614); t.stroke(); }
    for (let i = 0; i <= g.H; i++) { t.beginPath(); t.moveTo(0, i * 614 / g.H); t.lineTo(1024, i * 614 / g.H); t.stroke(); }
    const floor = new T.Mesh(new T.PlaneGeometry(g.W, g.H), new T.MeshStandardMaterial({ map: new T.CanvasTexture(tex), emissive: 0xffffff, emissiveMap: new T.CanvasTexture(tex), emissiveIntensity: 0.85, roughness: 0.85, metalness: 0 }));
    scene.add(floor);
    const frame = new T.Mesh(new T.BoxGeometry(g.W + 1, g.H + 1, 0.5), new T.MeshStandardMaterial({ color: 0x1a2650, roughness: 0.6 }));
    frame.position.z = -0.4; scene.add(frame);
    // a deep gradient backdrop with a scatter of faint stars behind the field
    const bgc = document.createElement('canvas'); bgc.width = 256; bgc.height = 160;
    const bgx = bgc.getContext('2d'), bgg = bgx.createRadialGradient(128, 80, 10, 128, 80, 150);
    bgg.addColorStop(0, '#24367d'); bgg.addColorStop(0.6, '#121c52'); bgg.addColorStop(1, '#070b22');
    bgx.fillStyle = bgg; bgx.fillRect(0, 0, 256, 160);
    const backdrop = new T.Mesh(new T.PlaneGeometry(g.W * 3.2, g.H * 3.2), new T.MeshBasicMaterial({ map: new T.CanvasTexture(bgc) }));
    backdrop.position.z = -3; scene.add(backdrop);
    if (GL3.level() !== 'low') {
      const n = 140, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) pos.set([(Math.random() - 0.5) * g.W * 2.6, (Math.random() - 0.5) * g.H * 2.6, -2.5], i * 3);
      const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.BufferAttribute(pos, 3));
      scene.add(new T.Points(sg, new T.PointsMaterial({ size: 0.28, color: 0x9bb8ff, transparent: true, opacity: 0.55, depthWrite: false })));
    }
    // lit edges: four thin bars in the board colour, pulsing softly
    const edgeMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
    const edges = [[g.W + 1, 0.16, 0, g.H / 2 + 0.5], [g.W + 1, 0.16, 0, -g.H / 2 - 0.5], [0.16, g.H + 1, g.W / 2 + 0.5, 0], [0.16, g.H + 1, -g.W / 2 - 0.5, 0]]
      .map(([ew, eh, ex, ey]) => { const m = new T.Mesh(new T.BoxGeometry(ew, eh, 0.3), edgeMat); m.position.set(ex, ey, -0.1); scene.add(m); return m; });

    // Sealed cells: one instanced mesh; new cells rise up.
    const blocks = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial({ color: 0xffffff }), g.W * g.H);   // unlit: colour is exactly what is set per cell
    blocks.count = 0; scene.add(blocks);
    blocks.setColorAt(0, new T.Color(0xffffff));
    const rimCol = new T.Color(), pending = [];   // pending: seal sparks waiting for the ripple to reach their cell
    const born = new Float32Array(g.W * g.H);
    let lastGrid = '0'.repeat(g.W * g.H), animUntil = 0;
    const dummy = new T.Object3D();

    // Effects (glow, trails, sparks) are skipped on the app's Low graphics setting.
    const fx = GL3.level() !== 'low';
    const glowTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d'), grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, '#fff'); grad.addColorStop(0.3, '#ffffffaa'); grad.addColorStop(1, '#fff0');
      x.fillStyle = grad; x.fillRect(0, 0, 64, 64);
      return new T.CanvasTexture(c);
    })();
    const sprite = (opacity) => {
      const m = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, opacity, blending: T.AdditiveBlending, depthWrite: false }));
      m.visible = false; scene.add(m); return m;
    };
    // One pooled Points object carries every spark; dead slots sit far off-screen.
    const CAP = 320, pPos = new Float32Array(CAP * 3).fill(-999), pCol = new Float32Array(CAP * 3);
    const pVel = new Float32Array(CAP * 3), pLife = new Float32Array(CAP);
    const pGeo = new T.BufferGeometry();
    pGeo.setAttribute('position', new T.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new T.BufferAttribute(pCol, 3));
    const sparks = new T.Points(pGeo, new T.PointsMaterial({ size: 0.38, map: glowTex, vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
    sparks.frustumCulled = false; scene.add(sparks);
    let pNext = 0;
    const tmpCol = new T.Color();
    const burst = (x, y, n, color, speed = 6) => {
      if (!fx) return;
      tmpCol.set(color);
      for (let k = 0; k < n; k++) {
        const i = pNext++ % CAP, a = Math.random() * 6.283, v = speed * (0.35 + Math.random() * 0.8);
        pPos.set([gx(x), gy(y), 0.6], i * 3);
        pVel.set([Math.cos(a) * v, -Math.sin(a) * v, (Math.random() - 0.3) * v * 0.5], i * 3);
        const white = Math.random() < 0.35;
        pCol.set(white ? [1, 1, 1] : [tmpCol.r, tmpCol.g, tmpCol.b], i * 3);
        pLife[i] = 0.5 + Math.random() * 0.5;
      }
    };
    const stepSparks = (dt) => {
      let live = false;
      for (let i = 0; i < CAP; i++) {
        if (pLife[i] <= 0) continue;
        pLife[i] -= dt; live = true;
        const k = i * 3;
        if (pLife[i] <= 0) { pPos[k + 2] = -999; continue; }
        pPos[k] += pVel[k] * dt; pPos[k + 1] += pVel[k + 1] * dt; pPos[k + 2] += pVel[k + 2] * dt;
        const d = Math.exp(-3 * dt); pVel[k] *= d; pVel[k + 1] *= d; pVel[k + 2] *= d;
      }
      if (live || sparks.userData.live) pGeo.attributes.position.needsUpdate = pGeo.attributes.color.needsUpdate = true;
      sparks.userData.live = live;
    };
    const mats = {
      ball: new T.MeshBasicMaterial({ map: (() => {   // red upper hemisphere, white lower; the mesh spins so the split turns
        const c = document.createElement('canvas'); c.width = 64; c.height = 128;
        const x = c.getContext('2d');
        if (x) { x.fillStyle = '#e8262b'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#ffffff'; x.fillRect(0, 64, 64, 64); }
        return new T.CanvasTexture(c);
      })() }),
      core: HALF.map((hex) => new T.MeshBasicMaterial({ color: new T.Color(hex).lerp(new T.Color(0xffffff), 0.55) })),
      glow: HALF.map((hex) => new T.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.4, blending: T.AdditiveBlending, depthWrite: false })),
      ghost: new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, depthWrite: false }),
    };
    const balls = [], trails = [];
    const beamGeo = new T.BoxGeometry(1, 1, 0.9);
    const halves = [0, 1].map((i) => { const m = new T.Mesh(beamGeo, mats.core[i]); m.visible = false; scene.add(m); return m; });
    const glows = [0, 1].map((i) => { const m = new T.Mesh(beamGeo, mats.glow[i]); m.visible = false; scene.add(m); return m; });
    const tips = [sprite(0.9), sprite(0.9)];
    const prevHalf = ['', ''];
    const ghost = new T.Mesh(new T.BoxGeometry(1, 1, 0.3), mats.ghost); ghost.visible = false; scene.add(ghost);
    ghost.add(new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(1, 1, 1)), new T.LineBasicMaterial({ color: 0xffffff })));   // the outline hint
    const pickMeshes = new Map();
    const pickTexs = {};
    const pickTex = (kind) => pickTexs[kind] ||= (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const x = c.getContext('2d');
      if (x) drawPickupIcon(x, kind);
      return new T.CanvasTexture(c);
    })();
    const sphere = new T.SphereGeometry(0.34, 20, 14);
    let lastNow = 0;
    const ray = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 0, 1), 0), hit = new T.Vector3();
    let w = 0, h = 0, lastDpr = 0, lastTilt = null;
    const camBase = new T.Vector3();

    function resize() {
      const cw = stage.clientWidth, ch = stage.clientHeight, dpr = devicePixelRatio || 1;
      if (!cw || !ch || (cw === w && ch === h && dpr === lastDpr && g.tilt === lastTilt)) return;   // zooming changes the pixel ratio even when the CSS size holds
      w = cw; h = ch; lastDpr = dpr; lastTilt = g.tilt; renderer.setSize(w, h, false);
      cam.aspect = w / h;
      const need = Math.max((g.H / 2 + 1.2) / Math.tan(cam.fov * Math.PI / 360), (g.W / 2 + 1.2) / (Math.tan(cam.fov * Math.PI / 360) * cam.aspect));
      const tilt = g.tilt && cam.aspect <= g.W / g.H ? 0.22 : 0;   // straight down by default; a very wide stage has no spare height for the tilt
      cam.position.set(0, -need * tilt, need * (tilt ? 0.97 : 1)); cam.lookAt(0, 0, 0); cam.updateProjectionMatrix();
      camBase.copy(cam.position);
    }
    // cross < 1 thins the box across its short side (a bright core inside a wider glow)
    const box = (m, x0, x1, y0, y1, z, cross = 1) => {
      const wide = x1 - x0 >= y1 - y0;
      m.visible = true; m.scale.set(wide ? x1 - x0 : cross * (x1 - x0), wide ? cross * (y1 - y0) : y1 - y0, 0.9);
      m.position.set(gx((x0 + x1) / 2), gy((y0 + y1) / 2), z);
    };
    return {
      pick(e) {
        const r = canvas.getBoundingClientRect();
        ray.setFromCamera(new T.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height * 2 - 1)), cam);
        if (!ray.ray.intersectPlane(plane, hit)) return null;
        return { x: Math.floor(hit.x + g.W / 2), y: Math.floor(g.H / 2 - hit.y) };
      },
      draw(s, now) {
        resize();
        const col = new T.Color(s.color);
        mats.ghost.color.set(0xffffff);
        edgeMat.color.copy(col); edgeMat.opacity = 0.6 + 0.2 * Math.sin(now / 700);
        const dt = Math.min(0.05, Math.max(0, (now - (lastNow || now)) / 1000)); lastNow = now;
        if (s.grid !== lastGrid) {
          const r = ripple(lastGrid, s.grid, now, born);
          if (fx) pending.push(...r.sparks);
          lastGrid = s.grid; animUntil = r.until;
        }
        if (now < animUntil + 60 || blocks.userData.col !== s.color) {
          let n = 0;
          for (let i = 0; i < s.grid.length; i++) {
            if (s.grid[i] !== '1') continue;
            const k = Math.max(0, Math.min(1, (now - born[i]) / 350)), z = 0.15 + 0.35 * (1 - (1 - k) ** 3);
            dummy.position.set(gx(i % g.W + 0.5), gy(Math.floor(i / g.W) + 0.5), z / 2 - 0.05);
            dummy.scale.set(1, 1, z); dummy.updateMatrix();
            const x = i % g.W, y = (i - x) / g.W;
            const open = (j, ok) => ok && s.grid[j] === '0';
            const rim = open(i - 1, x > 0) || open(i + 1, x < g.W - 1) || open(i - g.W, y > 0) || open(i + g.W, y < g.H - 1);
            rimCol.copy(col).lerp(new T.Color(0xffffff), rim ? 0.65 : 0.22);
            blocks.setColorAt(n, rimCol);
            blocks.setMatrixAt(n++, dummy.matrix);
          }
          if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;
          blocks.count = n; blocks.instanceMatrix.needsUpdate = true;
          blocks.userData.col = s.color;
        }
        while (balls.length < s.b.length) {
          const m = new T.Mesh(sphere, mats.ball), halo = sprite(0.55);
          halo.visible = true; halo.scale.set(2.4, 2.4, 1); m.add(halo); m.userData = { halo, pulse: 0, last: null };
          scene.add(m); balls.push(m);
          if (fx && balls.length <= 16) trails[balls.length - 1] = Array.from({ length: 7 }, () => sprite(0));
        }
        balls.forEach((m, i) => {
          m.visible = i < s.b.length;
          if (orbLights[i]) orbLights[i].intensity = 0;
          if (!m.visible) return;
          const bx = s.b[i][0], by = s.b[i][1], u = m.userData;
          // a flip in direction is a bounce: flare the glow and throw a few sparks
          if (u.last && u.dir) {
            const dx = bx - u.last[0], dy = by - u.last[1];
            if (Math.abs(dx) > 0.004 && Math.abs(u.dir[0]) > 0.004 && dx * u.dir[0] < 0 || Math.abs(dy) > 0.004 && Math.abs(u.dir[1]) > 0.004 && dy * u.dir[1] < 0) {
              u.pulse = 1; burst(bx, by, 4, RED, 3);
            }
            if (Math.abs(dx) + Math.abs(dy) > 0.002) u.dir = [dx, dy];
          } else if (u.last) u.dir = [bx - u.last[0], by - u.last[1]];
          u.last = [bx, by]; u.pulse = Math.max(0, u.pulse - dt * 4);
          m.position.set(gx(bx), gy(by), 0.5);
          m.rotation.z = now / 180 + i;
          const light = orbLights[i];
          if (light) { light.position.set(gx(bx), gy(by), 1.4); light.color.set('#ff8a8a'); light.intensity = 1.1 + u.pulse * 1.2; }
          const gs = 2.4 + u.pulse * 1.6;
          u.halo.scale.set(gs, gs, 1); u.halo.material.color.set('#ff6a6a');
          const tr = trails[i];
          if (tr) {   // a fading tail: each sprite follows the one ahead of it
            u.hist = u.hist || [];
            if (!u.histAt || now - u.histAt > 22) { u.hist.unshift([bx, by]); u.hist.length = Math.min(u.hist.length, tr.length); u.histAt = now; }
            tr.forEach((sp, j) => {
              const q = u.hist[j];
              sp.visible = !!q;
              if (!q) return;
              sp.position.set(gx(q[0]), gy(q[1]), 0.45);
              const k = 1 - (j + 1) / (tr.length + 1);
              sp.scale.set(1.5 * k, 1.5 * k, 1); sp.material.opacity = 0.4 * k; sp.material.color.set('#ff6a6a');
            });
          }
        });
        const rects = [];
        for (const r of wallRects(s.w)) rects[r[5]] = r;
        const pulse = 0.35 + 0.15 * Math.sin(now / 90);
        halves.forEach((m, i) => {
          m.visible = glows[i].visible = tips[i].visible = false;
          const r = rects[i];
          if (r) {
            box(m, r[0], r[1], r[2], r[3], 0.45, 0.3);
            box(glows[i], r[0], r[1], r[2], r[3], 0.45, 1.0);
            mats.glow[i].opacity = 0.3 + 0.2 * Math.sin(now / 90);
            const v = s.w[0], head = i === 0 ? [v ? r[2] : r[0]] : [v ? r[3] : r[1]];
            tips[i].visible = true;
            tips[i].position.set(gx(v ? s.w[1] + 0.5 : head[0]), gy(v ? head[0] : s.w[2] + 0.5), 0.8);
            tips[i].scale.set(2.6 + pulse, 2.6 + pulse, 1); tips[i].material.color.set(HALF[i]);
            if (fx && Math.random() < 0.4) burst(v ? s.w[1] + 0.5 : head[0], v ? head[0] : s.w[2] + 0.5, 1, HALF[i], 2);
          }
        });
        for (const [x, y, i] of shatters(prevHalf, s.w)) { burst(x, y, 34, HALF[i], 8); GL3.shake(cam, 0.32); }
        if (s.ghost) box(ghost, s.ghost[0], s.ghost[0] + s.ghost[2], s.ghost[1], s.ghost[1] + s.ghost[3], 0.2); else ghost.visible = false;
        // pickups persist between frames (keyed by cell) and only spin
        const keep = new Set();
        for (const p of s.p) {
          const key = `${p[0]},${p[1]},${p[2]}`;
          keep.add(key);
          let m = pickMeshes.get(key);
          if (!m) {
            m = new T.Sprite(new T.SpriteMaterial({ map: pickTex(p[2]), transparent: true, depthWrite: false }));
            m.position.set(gx(p[0] + 0.5), gy(p[1] + 0.5), 0.7);
            m.userData = { pos: [p[0] + 0.5, p[1] + 0.5], tint: p[2] === 'shield' ? 0x59ff9a : 0xffd84a };
            const halo = sprite(0.5); halo.visible = true; halo.material.color.set(m.userData.tint); halo.scale.set(2.6, 2.6, 1); m.add(halo);
            scene.add(m); pickMeshes.set(key, m);
          }
          const bob = 1.35 + 0.12 * Math.sin(now / 260 + p[0]);
          m.scale.set(bob, bob, 1);
        }
        for (const [key, m] of pickMeshes) {
          if (keep.has(key)) continue;
          burst(m.userData.pos[0], m.userData.pos[1], 22, m.userData.tint, 6);   // collected (sealed in)
          scene.remove(m); m.material.dispose(); pickMeshes.delete(key);
        }
        for (let q = pending.length - 1; q >= 0; q--) if (pending[q][0] <= now) { burst(pending[q][1], pending[q][2], pending[q][3], s.color, 4); pending.splice(q, 1); }
        stepSparks(dt);
        cam.position.copy(camBase); GL3.tickShake(cam, dt);
        renderer.render(scene, cam);
      },
      dispose() { renderer.dispose(); canvas.remove(); },
    };
  }

  // ---------- state ----------
  function receive(data) {
    if (!g || !data?.boards) return;
    if (data.tick < g.tick && data.rift === g.run) return;
    g.tick = data.tick; g.receivedAt = performance.now();
    Object.entries(data.boards).forEach(([pid, b], i) => {
      const prev = g.boards[pid] || (g.boards[pid] = { grid: '0'.repeat(g.W * g.H), color: COLORS[g.order.indexOf(pid) % 6] || COLORS[i % 6], b: [], bs: [], evSeen: b.ev[0], lv: b.lv });
      if (b.g) prev.grid = b.g;
      else if (b.rev !== prev.rev) prev.stale = true;
      prev.rev = b.rev;
      Object.assign(prev, { w: b.w, p: b.p, lives: b.lives, score: b.score, pct: b.pct, st: b.st, lv: b.lv, sh: b.sh, slow: b.slow, b: b.b });
      if (!prev.bs || prev.bs.length !== b.b.length) { prev.bs = b.b.map((q) => q.slice()); prev.bv = b.b.map(() => [0, 0]); }
      // orb velocity from the last two packets, so the drawn orbs keep moving between the ~30 Hz updates
      const dt = (g.receivedAt - (prev.at ?? 0)) / 1000;
      if (prev.last && prev.last.length === b.b.length && dt > 0.01 && dt < 0.2) {
        prev.bv = b.b.map((q, j) => [Math.max(-20, Math.min(20, (q[0] - prev.last[j][0]) / dt)), Math.max(-20, Math.min(20, (q[1] - prev.last[j][1]) / dt))]);
      }
      if (dt > 0.01 || !prev.at) { prev.last = b.b; prev.at = g.receivedAt; }
      if (b.ev[0] !== prev.evSeen) {
        prev.evSeen = b.ev[0];
        if (pid === g.me && g.ctx && !g.ctx.readOnly) { g.ctx.sfx(SND[b.ev[1]] || 'pop'); g.msg(MSG[b.ev[1]] || ''); }
      }
    });
    paint();
  }

  function mine() { return g.boards[g.me] || g.boards[g.watch]; }

  function paint() {
    const s = mine();
    if (!s) return;
    g.find('score').textContent = s.score.toLocaleString();
    g.find('level').textContent = s.lv;
    g.find('lives').textContent = '❤️'.repeat(Math.max(0, s.lives)) + (s.sh ? '🛡️' : '');
    g.find('slow').hidden = !(s.slow > 0);
    if (s.slow > 0) g.find('slow').textContent = '⏳ ' + Math.ceil(s.slow);
    if (s === g.boards[g.me] && g.lastScore != null && s.score > g.lastScore && s.st === 'play') g.pop('+' + (s.score - g.lastScore).toLocaleString());
    if (s === g.boards[g.me]) g.lastScore = s.score;
    if (g.me && s.score > g.best && g.solo) { g.best = s.score; store.set(g.best); }
    g.find('best').textContent = g.best ? g.best.toLocaleString() : '—';
    const list = g.find('standings');
    list.hidden = Object.keys(g.boards).length < 2;
    if (!list.hidden) {
      list.replaceChildren(...Object.entries(g.boards).sort((a, b) => b[1].score - a[1].score).map(([pid, b]) => {
        const li = document.createElement('li');
        li.style.setProperty('--rs-c', b.color);
        li.textContent = `${g.ctx.player(pid)?.name || '?'} · Lv ${b.lv} · ${Math.floor(b.pct * 100)}% · ${b.score.toLocaleString()}${b.st === 'over' ? ' ✖' : ''}`;
        if (pid === g.me) li.className = 'rs-me';
        return li;
      }));
    }
  }

  function place(cell, vertical) {
    const s = g.boards[g.me];
    if (!cell || !s || !g.enabled || s.st !== 'play' || s.w.length) return;
    if (!cellFree(s.grid, cell.x, cell.y)) return;
    g.ctx.input({ x: cell.x, y: cell.y, v: vertical });
    g.ctx.sfx('pop');
  }

  function ghostFor(cell) {
    const s = mine();
    if (!cell || !s || s.st !== 'play' || s.w.length || !g.enabled || !cellFree(s.grid, cell.x, cell.y)) return null;
    // Preview the whole line until it meets a sealed cell or the edge.
    let a = cell.x, b = cell.x, c = cell.y, d = cell.y;
    if (g.vertical) { while (cellFree(s.grid, cell.x, c - 1)) c--; while (cellFree(s.grid, cell.x, d + 1)) d++; return [cell.x, c, 1, d - c + 1]; }
    while (cellFree(s.grid, a - 1, cell.y)) a--; while (cellFree(s.grid, b + 1, cell.y)) b++;
    return [a, cell.y, b - a + 1, 1];
  }

  function setDirection(vertical) {
    g.vertical = vertical;
    for (const b of g.root.querySelectorAll('.rs-dir')) b.setAttribute('aria-pressed', String((b.dataset.v === '1') === vertical));
  }
  const toggle = () => setDirection(!g.vertical);

  function loop(now) {
    g.raf = requestAnimationFrame(loop);
    const s = mine();
    const r = g.three || g.flat;
    if (!s || !r) return;
    g.find('view').hidden = !g.three;   // the flat view has no camera to tilt
    g.stage.classList.toggle('rs-slowed', s.slow > 0);
    g.stage.classList.toggle('rs-shielded', !!s.sh);
    const k = 1 - Math.exp(-Math.min(60, now - (g.drawn ?? now)) / 38);
    g.drawn = now;
    const lead = Math.min(0.06, Math.max(0, (now - (s.at ?? now)) / 1000));
    s.bs.forEach((q, i) => {
      const t = s.b[i] || q, v = s.bv?.[i] || [0, 0];
      q[0] += (t[0] + v[0] * lead - q[0]) * k; q[1] += (t[1] + v[1] * lead - q[1]) * k;
    });
    // the sealed-percent readout and bar glide to the new value instead of stepping
    s.shown = (s.shown ?? s.pct) + (s.pct - (s.shown ?? s.pct)) * (1 - Math.exp(-Math.min(60, now - (g.pctAt ?? now)) / 160));
    g.pctAt = now;
    const pct = Math.floor(s.shown * 100 + 0.001) + '%', fill = Math.min(100, s.shown * 100).toFixed(1) + '%';
    if (g.pctText !== pct) g.find('pct').textContent = g.pctText = pct;
    if (g.pctFill !== fill) g.find('fill').style.width = g.pctFill = fill;
    r.draw({ ...s, b: s.bs, ghost: g.hover ? ghostFor(g.hover) : null }, now);
  }

  function mount(arena) {
    arena.innerHTML = `
      <section class="rs-cabinet" aria-label="Rift Split">
        <div class="rs-hud">
          <div><span class="rs-cap">Score</span><strong class="rs-score">0</strong></div>
          <div><span class="rs-cap">Level</span><strong class="rs-level">1</strong></div>
          <div><span class="rs-cap">Lives</span><strong class="rs-lives"></strong></div>
          <div class="rs-best-tile"><span class="rs-cap">Best</span><strong class="rs-best">—</strong></div>
        </div>
        <div class="rs-bar" role="meter" aria-label="Field sealed" aria-valuemin="0" aria-valuemax="100"><div class="rs-fill"></div><div class="rs-goal" title="75% to clear"></div><span class="rs-pct">0%</span><span class="rs-slow" hidden></span></div>
        <div class="rs-stage" aria-label="Rift Split field"><span class="rs-msg" role="status"></span></div>
        <div class="rs-controls"><button type="button" class="rs-view" aria-label="Camera view" title="Camera view" hidden>⬓</button><button type="button" class="rs-bright" aria-label="Brightness" title="Brightness">☀</button><div class="rs-dirs" role="group" aria-label="Wall direction"><button type="button" class="rs-dir" data-v="0" aria-pressed="true"><svg viewBox="0 0 28 28" aria-hidden="true"><path d="M4 14h20M4 14l5-5M4 14l5 5M24 14l-5-5M24 14l-5 5"/></svg><span>Horizontal</span></button><button type="button" class="rs-dir rs-v" data-v="1" aria-pressed="false"><svg viewBox="0 0 28 28" aria-hidden="true"><path d="M4 14h20M4 14l5-5M4 14l5 5M24 14l-5-5M24 14l-5 5"/></svg><span>Vertical</span></button></div><span class="rs-tip">Hold to preview, release to grow a wall · Space / right-click turns it · ⛶ for fullscreen</span></div>
        <ol class="rs-standings" aria-label="Scores" hidden></ol>
      </section>`;
    const root = arena.querySelector('.rs-cabinet');
    const stage = root.querySelector('.rs-stage');
    const listeners = new AbortController();
    const on = (el, ev, fn) => el.addEventListener(ev, fn, { signal: listeners.signal });
    g = {
      root, stage, listeners, W: 40, H: 24, boards: {}, order: [], tick: -1, vertical: false, best: store.get(), msgTimer: 0,
      find: (c) => root.querySelector('.rs-' + c),
      pop(text) {
        const el = document.createElement('span');
        el.className = 'rs-pop'; el.textContent = text;
        stage.append(el);
        setTimeout(() => el.remove(), 1200);
      },
      msg(text) {
        const el = stage.querySelector('.rs-msg');
        el.textContent = text; el.classList.toggle('on', !!text);
        clearTimeout(g.msgTimer); g.msgTimer = setTimeout(() => el.classList.remove('on'), 1600);
      },
    };
    try { g.tilt = localStorage.getItem('riftsplit.tilt') === '1'; } catch { g.tilt = false; }   // straight down unless the player chose the tilted view
    on(g.find('view'), 'click', () => {
      g.tilt = !g.tilt;
      try { localStorage.setItem('riftsplit.tilt', g.tilt ? '1' : '0'); } catch { /* private mode */ }
      g.msg(g.tilt ? 'Tilted view' : 'Top-down view');
    });
    const BRIGHT = [1, 1.3, 1.6, 2];
    const loadB = () => { try { const v = Number(localStorage.getItem('riftsplit.bright')); return BRIGHT.includes(v) ? v : 1.3; } catch { return 1.3; } };
    g.bright = loadB();
    stage.style.setProperty('--rs-bright', g.bright);
    on(g.find('bright'), 'click', () => {
      g.bright = BRIGHT[(BRIGHT.indexOf(g.bright) + 1) % BRIGHT.length];
      stage.style.setProperty('--rs-bright', g.bright);
      try { localStorage.setItem('riftsplit.bright', String(g.bright)); } catch { /* private mode */ }
      g.msg('Brightness ' + Math.round(g.bright * 100) + '%');
    });
    for (const b of root.querySelectorAll('.rs-dir')) on(b, 'click', () => setDirection(b.dataset.v === '1'));
    let down = false;
    // Hold to see where the wall would run, slide to aim, release to place it (a mouse previews on hover).
    const fingers = new Set();
    let pinched = false;   // a second finger landed: this gesture is a zoom, not a wall
    on(stage, 'pointerdown', (e) => {
      if (e.button === 2) return;
      e.preventDefault();
      fingers.add(e.pointerId);
      if (fingers.size > 1) { pinched = true; down = false; g.hover = null; return; }
      stage.setPointerCapture?.(e.pointerId);
      g.touching = e.pointerType !== 'mouse';
      down = true;
      g.hover = (g.three || g.flat)?.pick(e);
    });
    on(stage, 'pointermove', (e) => {
      const r = g.three || g.flat;
      if (r && !pinched && (down || e.pointerType === 'mouse')) g.hover = r.pick(e);
    });
    const lift = (e, placeIt) => {
      fingers.delete(e.pointerId);
      if (placeIt && down && !pinched) place((g.three || g.flat)?.pick(e) || g.hover, g.vertical);
      if (!fingers.size) { down = false; pinched = false; if (g.touching || !placeIt) g.hover = null; }
    };
    on(stage, 'pointerup', (e) => lift(e, true));
    on(stage, 'pointercancel', (e) => lift(e, false));
    on(stage, 'pointerleave', () => { if (!down) g.hover = null; });
    on(stage, 'contextmenu', (e) => { e.preventDefault(); toggle(); });
    on(window, 'keydown', (e) => {
      if (e.code !== 'Space' || e.target.closest?.('input, textarea, select, button, [contenteditable], dialog[open]')) return;
      e.preventDefault();
      toggle();
    });
    g.flat = flatRenderer(stage);
    GL3.load().then((T) => {
      const me = g;
      if (g !== me) return;
      const build = () => {
        if (g !== me) return false;
        me.three = threeRenderer(T, stage, () => { me.three?.dispose(); me.three = null; GL3.revive(stage, { build, flat, unflat }); });
        return me.three;
      };
      const flat = () => { me.flat ||= flatRenderer(stage); };
      const unflat = () => { me.flat?.dispose(); me.flat = null; };
      try { if (build()) { unflat(); return; } } catch (err) { console.warn('Rift Split could not start 3D', err); }
      unflat(); flat();
      GL3.revive(stage, { build, flat, unflat });
    }).catch(() => {});
    g.raf = requestAnimationFrame(loop);
  }

  UI.riftsplit = {
    focus: true,
    mount,
    turnText: (view) => view.phase === 'over' ? 'Rift Split results' : 'Seal 75% of the field',
    render(view, ctx) {
      const d = view.riftsplit;
      if (!g || !d) return;
      g.ctx = ctx;
      if (g.run !== d.rift) {
        g.run = d.rift; g.tick = -1; g.lastScore = null; g.W = d.layout.w; g.H = d.layout.h; g.solo = d.solo; g.boards = {};
        g.order = Object.keys(d.boards);
      }
      g.me = d.me;
      g.watch = g.watch || Object.keys(d.boards)[0];
      g.enabled = view.phase === 'playing' && !view.paused && !ctx.readOnly && !view.me?.eliminated && !!d.me;
      receive(d);
    },
    fast(data) { receive(data); },
    testPlace(x, y, v) { place({ x, y }, v); },
    disconnect() { if (g) g.enabled = false; },
    unmount() {
      if (!g) return;
      g.listeners.abort();
      cancelAnimationFrame(g.raf);
      clearTimeout(g.msgTimer);
      g.three?.dispose(); g.flat?.dispose();
      g.root.remove();
      g = null;
    },
  };
})();
