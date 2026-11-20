// 3D table for UI.billiards, drawn with three.js. billiards.js keeps all the game state and input; each frame
// it hands this scene a plain description (balls, cue stick, aim guide, rings) and the scene draws it,
// only re-rendering when something changed. pick() maps a screen point back to table units for the input code.
// Table units: x along the long side (0..W), y across it (0..H); in 3D they're x and z, with y up.
const Billiards3D = (() => {
  const COLORS = ['#ffffff', '#f5c518', '#1f5fd1', '#d62828', '#6a2c91', '#f77f00', '#138a36', '#7a1f1f', '#111111'];
  const RAIL = 9, CUSH = 3, RAIL_TOP = 3.6, CUSH_TOP = 3.3;

  // the edge of a rectangle with pocket circles cut in (inward: the cloth) or bulged out (outward: the rail opening)
  function outline(x0, y0, x1, y1, circles, outward) {
    const P = [], step = 0.25;
    for (const [ax, ay, bx, by] of [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]]) {
      const n = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
      for (let i = 0; i < n; i++) P.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n]);
    }
    const inC = ([x, y]) => circles.findIndex(([cx, cy, r]) => Math.hypot(x - cx, y - cy) < r);
    const inRect = ([x, y]) => x > x0 && x < x1 && y > y0 && y < y1;
    const s = P.findIndex((p) => inC(p) < 0), N = P.length, out = [];
    for (let k = 0; k < N; k++) {
      const p = P[(s + k) % N], c = inC(p);
      if (c < 0) { out.push(p); continue; }
      let j = k; while (j < N && inC(P[(s + j) % N]) === c) j++;
      const [cx, cy, r] = circles[c], a = P[(s + k - 1 + N) % N], b = P[(s + j) % N];
      const a0 = Math.atan2(a[1] - cy, a[0] - cx), a1 = Math.atan2(b[1] - cy, b[0] - cx);
      let d = (((a1 - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const mid = (dd) => [cx + r * 1.01 * Math.cos(a0 + dd / 2), cy + r * 1.01 * Math.sin(a0 + dd / 2)];
      if (inRect(mid(d)) === outward) d -= 2 * Math.PI;
      for (let i = 0; i <= 48; i++) out.push([cx + r * Math.cos(a0 + (d * i) / 48), cy + r * Math.sin(a0 + (d * i) / 48)]);
      k = j - 1;
    }
    return out;
  }

  // ball skins at 1024×512, so the numbers stay sharp close up
  function ballTexture(T, n, aniso) {
    const c = Object.assign(document.createElement('canvas'), { width: 1024, height: 512 }), g = c.getContext('2d');
    const col = COLORS[n > 8 ? n - 8 : n];
    g.fillStyle = n > 8 || n === 0 ? '#fbfbf2' : col; g.fillRect(0, 0, 1024, 512);
    if (n > 8) { g.fillStyle = col; g.fillRect(0, 256 - 100, 1024, 200); }
    for (const u of [256, 768]) {
      if (n === 0) { g.fillStyle = '#c1121f'; g.beginPath(); g.arc(u, 256, 18, 0, 7); g.fill(); continue; }
      g.fillStyle = '#fbfbf2'; g.beginPath(); g.ellipse(u, 256, 76, 72, 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 3; g.stroke();  // the spot's printed edge
      g.fillStyle = '#111'; g.font = 'bold 88px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(n), u, 262);
      if (n === 6 || n === 9) g.fillRect(u - 24, 300, 48, 8);  // underline tells a 6 from a 9
    }
    if (n === 0) for (const u of [0, 512, 1024]) { g.fillStyle = '#c1121f'; g.beginPath(); g.arc(u, 256, 18, 0, 7); g.fill(); }
    const t = new T.CanvasTexture(c);
    t.anisotropy = aniso; t.encoding = T.sRGBEncoding;
    return t;
  }

  // procedural textures: woollen baize (colour + a bump map of its nap) and varnished wood grain
  function noiseCanvas(size, paint) {
    const c = Object.assign(document.createElement('canvas'), { width: size, height: size }), g = c.getContext('2d');
    const im = g.createImageData(size, size);
    for (let i = 0; i < size * size; i++) paint(im.data, i * 4, i % size, Math.floor(i / size));
    g.putImageData(im, 0, 0);
    return [c, g];
  }
  // value noise on a w×h grid: a random lattice of cx×cy cells, smoothly interpolated (it tiles across both edges)
  function valueNoise(w, h, cx, cy = cx) {
    const lat = Array.from({ length: cx * cy }, Math.random), out = new Float32Array(w * h);
    const L = (i, j) => lat[(j % cy) * cx + (i % cx)], s = (t) => t * t * (3 - 2 * t);
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * cy, j = Math.floor(fy), v = s(fy - j);
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * cx, i = Math.floor(fx), u = s(fx - i);
        out[y * w + x] = (L(i, j) * (1 - u) + L(i + 1, j) * u) * (1 - v) + (L(i, j + 1) * (1 - u) + L(i + 1, j + 1) * u) * v;
      }
    }
    return out;
  }
  // The baize is two layers, so neither the detail nor the colour shows a repeat:
  //  - feltDetail: a tile (FELT_TILE table units, 64 texels a unit) of the cloth's surface: a tight twill weave
  //    under a soft fuzz and loose fibres lying along the nap, over a grain of small soft clumps (an eighth
  //    to one unit across) that still shows from across the table. There's nothing bigger than a unit in it,
  //    and the bed samples it twice at unrelated scales, so its repeat never lines up into a pattern. Its
  //    colour map is a plain brightness (multiplied into the cloth's colour) and its bump map shares every fibre.
  //  - feltMacro: one texture over the whole bed, with the colour itself: its slow unevenness, the wear where
  //    the balls run most (the long string, the rack, the break), and a few dabs of blue chalk.
  const FELT_TILE = 8;
  function feltDetail(T, aniso) {
    const size = 512, N = size * size, noise = new Float32Array(N), h = new Float32Array(N);
    for (let i = 0; i < N; i++) noise[i] = Math.random();
    const at = (x, y) => noise[((y + size) % size) * size + ((x + size) % size)];
    const fine = valueNoise(size, size, 64), mid = valueNoise(size, size, 16), clump = valueNoise(size, size, 8);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // fuzz: the noise smeared along the nap (x) and a little across it
        const fuzz = (at(x, y) * 2 + at(x - 1, y) + at(x + 1, y) + (at(x - 2, y) + at(x + 2, y) + at(x, y - 1) + at(x, y + 1)) * 0.6) / 6.4 - 0.5;
        const twill = Math.sin(((x + y) * Math.PI * 2) / 4) * (0.75 + 0.25 * Math.sin((x - y) * Math.PI * 2 / 16));
        const i = y * size + x;
        // #102: worsted pool cloth is smooth and even: mostly fine fuzz and weave, only a whisper of clumping
        h[i] = fuzz * 0.6 + twill * 0.12 + (fine[i] - 0.5) * 0.3 + (mid[i] - 0.5) * 0.16 + (clump[i] - 0.5) * 0.1;
      }
    }
    const [cc, cg] = noiseCanvas(size, (d, k, x, y) => { const v = 222 + h[y * size + x] * 40; d[k] = d[k + 1] = d[k + 2] = v; d[k + 3] = 255; });
    const [bc, bg] = noiseCanvas(size, (d, k, x, y) => { const v = 128 + h[y * size + x] * 80; d[k] = d[k + 1] = d[k + 2] = v; d[k + 3] = 255; });
    // loose fibres: short curled strokes, mostly along the nap, light or dark, wrapped across the tile's edges
    for (let f = 0; f < 1400; f++) {
      const x0 = Math.random() * size, y0 = Math.random() * size, len = 6 + Math.random() * 16;
      const a = (Math.random() < 0.75 ? 0 : Math.PI / 2) + (Math.random() - 0.5) * 1.1, bend = (Math.random() - 0.5) * 0.5;
      const light = Math.random() < 0.55, alpha = 0.05 + Math.random() * 0.1, w = 0.9 + Math.random() * 0.9;
      const pts = [];
      for (let t = 0; t <= 4; t++) { const aa = a + bend * t; pts.push([x0 + Math.cos(aa) * len * t / 4, y0 + Math.sin(aa) * len * t / 4]); }
      for (const [g, col] of [[cg, light ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`], [bg, light ? `rgba(255,255,255,${alpha * 1.5})` : `rgba(0,0,0,${alpha * 1.3})`]]) {
        g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round';
        for (const ox of [-size, 0, size]) {
          for (const oy of [-size, 0, size]) {
            if ((ox && Math.abs(x0 + ox - size / 2) > size / 2 + len) || (oy && Math.abs(y0 + oy - size / 2) > size / 2 + len)) continue;
            g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px + ox, py + oy) : g.moveTo(px + ox, py + oy))); g.stroke();
          }
        }
      }
    }
    return [cc, bc].map((c) => {
      const t = new T.CanvasTexture(c);
      t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = aniso;  // both linear: a brightness and heights
      return t;
    });
  }
  // the bed's colour, 1024×512 over the whole W×H table: canvas x, y are table x, y
  function feltMacro(T, aniso, W, H, headX) {
    const w = 1024, h = 512, sx = w / W, sy = h / H;
    const slow = valueNoise(w, h, 6, 3), soft = valueNoise(w, h, 28, 14);
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h }), g = c.getContext('2d');
    const im = g.createImageData(w, h), d = im.data;
    for (let i = 0; i < w * h; i++) {
      const v = (slow[i] - 0.5) * 0.05 + (soft[i] - 0.5) * 0.025, k = i * 4;
      d[k] = 22 * (1 + v); d[k + 1] = 114 * (1 + v); d[k + 2] = 64 * (1 + v * 0.8); d[k + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    const blob = (x, y, rx, ry, col, a) => {
      g.save(); g.translate(x * sx, y * sy); g.scale(rx * sx, ry * sy);
      const r = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      r.addColorStop(0, `rgba(${col},${a})`); r.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = r; g.beginPath(); g.arc(0, 0, 1, 0, 7); g.fill(); g.restore();
    };
    // wear: a faint pale track down the long string, worn patches where the rack sits and where the break is struck
    blob(W / 2, H / 2, W * 0.42, H * 0.16, '150,200,160', 0.07);
    blob(W * 0.76, H / 2, 13, 11, '150,200,160', 0.08);
    blob(headX - 4, H / 2, 10, 14, '150,200,160', 0.06);
    // blue chalk, rubbed off the cue tip on the cloth around the head string and the rack
    for (let i = 0; i < 5; i++) {
      const x = i < 3 ? headX + (Math.random() - 0.6) * 22 : W * 0.7 + Math.random() * 18, y = H / 2 + (Math.random() - 0.5) * H * 0.5;
      blob(x, y, 0.7 + Math.random() * 0.9, 0.5 + Math.random() * 0.5, '80,130,190', 0.05 + Math.random() * 0.05);
    }
    // the bed falls off a little toward the rails and corners, away from the lamp (on top of the spotlights' own falloff)
    g.save(); g.scale(1, h / w);
    const vg = g.createRadialGradient(w / 2, w / 2, w * 0.22, w / 2, w / 2, w * 0.62);
    vg.addColorStop(0, 'rgba(0,16,6,0)'); vg.addColorStop(1, 'rgba(0,16,6,0.2)');
    g.fillStyle = vg; g.fillRect(0, 0, w, w); g.restore();
    // the cloth darkens a touch where it tucks under the cushions
    for (const [x0, y0, x1, y1] of [[0, 0, 0, 3], [0, H, 0, H - 3]]) {
      const gr = g.createLinearGradient(x0 * sx, y0 * sy, x1 * sx, y1 * sy);
      gr.addColorStop(0, 'rgba(0,20,8,0.22)'); gr.addColorStop(1, 'rgba(0,20,8,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }
    for (const [x0, x1] of [[0, 3], [W, W - 3]]) {
      const gr = g.createLinearGradient(x0 * sx, 0, x1 * sx, 0);
      gr.addColorStop(0, 'rgba(0,20,8,0.22)'); gr.addColorStop(1, 'rgba(0,20,8,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }
    const t = new T.CanvasTexture(c);
    t.anisotropy = aniso; t.encoding = T.sRGBEncoding;
    return t;
  }
  // varnished wood at 2048×512 (about 30 texels a unit along the rail): broad figure, wandering grain lines and
  // fine pores, so the rail still reads as wood in the behind-the-cue view where it's right under the camera
  function woodTexture(T, aniso) {
    const w = 2048, h = 512, c = Object.assign(document.createElement('canvas'), { width: w, height: h }), g = c.getContext('2d');
    const base = g.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, '#6a3f1f'); base.addColorStop(0.5, '#7b4a25'); base.addColorStop(1, '#5e3519');
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const wander = (y0, amp, f, ph) => (x) => y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph) * amp * 0.3;
    for (let i = 0; i < 14; i++) {  // figure: broad, soft bands of darker and lighter wood
      const y = wander(Math.random() * h, 10 + Math.random() * 20, 0.002 + Math.random() * 0.003, Math.random() * 7);
      g.strokeStyle = `rgba(${Math.random() < 0.6 ? '45,22,8' : '160,100,55'}, ${0.06 + Math.random() * 0.08})`;
      g.lineWidth = 12 + Math.random() * 30;
      g.beginPath(); for (let x = 0; x <= w; x += 16) g.lineTo(x, y(x)); g.stroke();
    }
    for (let i = 0; i < 300; i++) {  // grain lines that wander along the board
      const y = wander(Math.random() * h, 4 + Math.random() * 12, 0.002 + Math.random() * 0.005, Math.random() * 7);
      g.strokeStyle = `rgba(${Math.random() < 0.5 ? '40,20,8' : '150,95,50'}, ${0.08 + Math.random() * 0.2})`;
      g.lineWidth = 0.8 + Math.random() * 3.5;
      g.beginPath(); for (let x = 0; x <= w; x += 8) g.lineTo(x, y(x)); g.stroke();
    }
    g.lineCap = 'round';
    for (let i = 0; i < 5000; i++) {  // pores: short dark flecks along the grain
      const x = Math.random() * w, y = Math.random() * h, len = 4 + Math.random() * 18;
      g.strokeStyle = `rgba(30,14,5,${0.1 + Math.random() * 0.2})`; g.lineWidth = 0.7 + Math.random() * 0.8;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y + (Math.random() - 0.5) * 1.5); g.stroke();
    }
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = aniso; t.encoding = T.sRGBEncoding;
    return t;
  }
  // the inside of a pocket: dark leather, with a knotted net of cord over it that catches the lamp light
  function pocketTexture(T, aniso) {
    const c = Object.assign(document.createElement('canvas'), { width: 256, height: 128 }), g = c.getContext('2d');
    g.fillStyle = '#2a1b12'; g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 900; i++) {  // creased, worn leather
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '120,80,50'},${0.05 + Math.random() * 0.08})`;
      g.fillRect(Math.random() * 256, Math.random() * 128, 1 + Math.random() * 6, 1 + Math.random() * 2);
    }
    g.lineCap = 'round';
    for (const [col, w] of [['#0b0705', 4.5], ['#6b4a30', 2.2], ['#8d6745', 0.8]]) {  // cord: shadow, body, sheen
      g.strokeStyle = col; g.lineWidth = w;
      for (let k = -8; k < 16; k++) {
        g.beginPath(); g.moveTo(k * 32, 0); g.lineTo(k * 32 + 128, 128); g.stroke();
        g.beginPath(); g.moveTo(k * 32 + 128, 0); g.lineTo(k * 32, 128); g.stroke();
      }
    }
    g.fillStyle = '#4a3220';
    for (let k = 0; k < 16; k++) for (let j = 0; j < 8; j++) if ((k + j) % 2 === 0) { g.beginPath(); g.arc(k * 16, j * 16, 2.4, 0, 7); g.fill(); }
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = aniso; t.encoding = T.sRGBEncoding;
    return t;
  }

  // a rectangle with rounded corners, as a three.js shape in the table's flat (x, -y) space
  function roundedRect(T, x0, y0, x1, y1, r) {
    const s = new T.Shape();
    s.moveTo(x0 + r, -y0); s.lineTo(x1 - r, -y0); s.absarc(x1 - r, -y0 - r, r, Math.PI / 2, 0, true);
    s.lineTo(x1, -y1 + r); s.absarc(x1 - r, -y1 + r, r, 0, -Math.PI / 2, true);
    s.lineTo(x0 + r, -y1); s.absarc(x0 + r, -y1 + r, r, -Math.PI / 2, -Math.PI, true);
    s.lineTo(x0, -y0 - r); s.absarc(x0 + r, -y0 - r, r, Math.PI, Math.PI / 2, true);
    return s;
  }

  // a dim room with the pool lamp's three bright shades (where the scene's lamps are), for the balls' and
  // rails' reflections (colours are managed by GL3: written as on screen, stored linear).
  const LAMPS = [-0.33, 0, 0.33], LAMP_Y = 72;  // shades along the table's length (× its width), and their height
  function lampRoom(T, renderer, W) {
    const room = new T.Scene(), lin = (hex) => new T.Color(hex);
    room.add(new T.Mesh(new T.BoxGeometry(400, 200, 300), new T.MeshBasicMaterial({ color: lin(0x1c1511), side: T.BackSide })));
    for (const f of LAMPS) {
      // a glowing disc under each shade, with the shade's dark rim around it
      const lamp = new T.Mesh(new T.CircleGeometry(11, 40), new T.MeshBasicMaterial({ color: new T.Color(0xfff1d8).multiplyScalar(2.2), side: T.DoubleSide }));
      lamp.rotation.x = Math.PI / 2; lamp.position.set(f * W, LAMP_Y, 0); room.add(lamp);
      const shade = new T.Mesh(new T.RingGeometry(11, 15, 40), new T.MeshBasicMaterial({ color: lin(0x0e2a1a), side: T.DoubleSide }));
      shade.rotation.x = Math.PI / 2; shade.position.set(f * W, LAMP_Y + 0.1, 0); room.add(shade);
    }
    const floor = new T.Mesh(new T.PlaneGeometry(400, 300), new T.MeshBasicMaterial({ color: lin(0x0f3a22), side: T.DoubleSide }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -1; room.add(floor);  // the green of the cloth, reflected low on the balls
    const pm = new T.PMREMGenerator(renderer);
    const env = pm.fromScene(room, 0.03).texture;
    pm.dispose();
    room.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    return env;
  }

  // the cue's maple shaft: pale wood with faint grain running along it (canvas x goes round the shaft, y along it)
  function mapleTexture(T) {
    const c = Object.assign(document.createElement('canvas'), { width: 64, height: 512 }), g = c.getContext('2d');
    const base = g.createLinearGradient(0, 0, 0, 512);
    base.addColorStop(0, '#efd9ac'); base.addColorStop(1, '#d9b277');
    g.fillStyle = base; g.fillRect(0, 0, 64, 512);
    for (let i = 0; i < 26; i++) {
      const x0 = Math.random() * 64, amp = 1 + Math.random() * 3, f = 0.004 + Math.random() * 0.01, ph = Math.random() * 7;
      g.strokeStyle = `rgba(${Math.random() < 0.6 ? '120,80,40' : '255,240,210'},${0.06 + Math.random() * 0.1})`; g.lineWidth = 0.5 + Math.random() * 1.2;
      g.beginPath(); for (let y = 0; y <= 512; y += 8) g.lineTo(x0 + Math.sin(y * f + ph) * amp, y); g.stroke();
    }
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    return t;
  }
  // a canvas of white whose alpha rises along x (0 → 1), or across y fades out at both edges (soft lines)
  function alphaTexture(T, along) {
    const c = Object.assign(document.createElement('canvas'), { width: along ? 64 : 4, height: along ? 4 : 32 }), g = c.getContext('2d');
    const gr = along ? g.createLinearGradient(0, 0, 64, 0) : g.createLinearGradient(0, 0, 0, 32);
    if (along) { gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,1)'); }
    else { gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.3, 'rgba(255,255,255,1)'); gr.addColorStop(0.7, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); }
    g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
    return new T.CanvasTexture(c);
  }
  // a soft round glow, for glints and puffs
  function glowTexture(T) {
    const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), g = c.getContext('2d');
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    return new T.CanvasTexture(c);
  }

  function dashTexture(T) {
    const c = Object.assign(document.createElement('canvas'), { width: 64, height: 8 }), g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 36, 8);
    const t = new T.CanvasTexture(c);
    t.wrapS = T.RepeatWrapping;
    return t;
  }

  function create(stage, b, hooks = {}) {
    const T = window.THREE;
    // sharper than the screen on a plain desktop display. GL3 lowers it while balls roll if frames get
    // slow, and the table at rest (aiming, between shots) is always drawn at the full ratio (renderStill)
    const renderer = GL3.renderer({ alpha: true }, { onLost: hooks.onLost, cap: Math.min(2, Math.max(window.devicePixelRatio || 1, 1.5)), min: 0.75 });
    if (!renderer) return null;
    renderer.shadowMap.enabled = GL3.level() !== 'low'; renderer.shadowMap.type = T.PCFSoftShadowMap;  // 🎨 Low: no shadows
    const canvas = renderer.domElement;
    const { W, H, R } = b;
    const aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy?.() || 1);
    // colour managed: sRGB textures and colours, lit in linear light, filmic tone mapping so the lamps'
    // hot spots on the balls and the cloth roll off softly instead of clipping
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    const env = lampRoom(T, renderer, W);

    const scene = new T.Scene(), camera = new T.PerspectiveCamera(30, 1, 1, 1000);
    const table = new T.Group(); table.position.set(-W / 2, 0, -H / 2); scene.add(table);
    // lighting: a dim room, and a three-shade pool lamp hanging over the table. Each shade is a spotlight
    // aimed straight down, so the cloth is brightest under the lamp and falls off toward the rails and the
    // corners; the two outer shades cast soft shadows (two faint shadows per ball, as under a real lamp).
    scene.add(new T.HemisphereLight(0xffeedd, 0x1a140f, 0.2));
    LAMPS.forEach((f, i) => {
      const lamp = new T.SpotLight(0xfff0d6, i === 1 ? 1.15 : 1.3, 230, 0.82, 0.9, 1);
      lamp.position.set(f * W, LAMP_Y, 0); lamp.target.position.set(f * W * 1.15, 0, 0);
      scene.add(lamp, lamp.target);
      if (i !== 1) {
        lamp.castShadow = true; lamp.shadow.mapSize.set(2048, 2048);
        Object.assign(lamp.shadow.camera, { near: 40, far: 140 });
        lamp.shadow.bias = -0.0006;
      }
    });

    // the table, built in table units: shapes are drawn as (x, -y) and turned flat so they extrude upward
    const flat = (pts) => new T.Shape(pts.map(([x, y]) => new T.Vector2(x, -y)));
    const lay = (geo, mat, y = 0) => { const m = new T.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.y = y; table.add(m); return m; };
    const FELT = FELT_TILE;  // table units per tile of the baize's detail
    const [feltMap, feltBump] = feltDetail(T, aniso);
    // wool: rough, with a soft sheen that rises where you look along the cloth (the behind-the-cue view)
    const wool = (o) => new T.MeshPhysicalMaterial({ bumpScale: 0.025, roughness: 0.9, metalness: 0, sheen: new T.Color(0x3d7a52), ...o });
    // the bed: detail tiled at FELT units, the colour from feltMacro laid once over the whole table
    const tiled = (t, u, v) => { const c = t.clone(); c.needsUpdate = true; c.repeat.set(u, v); return c; };
    const macro = feltMacro(T, aniso, W, H, b.headX);
    const cloth = wool({ map: tiled(feltMap, 1 / FELT, 1 / FELT), bumpMap: tiled(feltBump, 1 / FELT, 1 / FELT) });
    cloth.onBeforeCompile = (sh) => {
      // the shape's uv is (x, -y) in table units, so vUv (after the map's 1/FELT repeat) * FELT/W is 0..1 across
      sh.uniforms.macroMap = { value: macro };
      sh.uniforms.macroXf = { value: new T.Vector4(FELT / W, FELT / H, 0, 1) };
      sh.fragmentShader = 'uniform sampler2D macroMap;\nuniform vec4 macroXf;\n' + sh.fragmentShader.replace('#include <map_fragment>',
        '#include <map_fragment>\n\tdiffuseColor.rgb *= sRGBToLinear( texture2D( macroMap, vUv * macroXf.xy + macroXf.zw ) ).rgb' +
        ' * ( 0.5 + 0.6 * texture2D( map, vUv * 0.613 + vec2( 0.37, 0.71 ) ).r );');  // the second, unaligned look at the grain
    };
    const HOLE = 0.8, ROLL = 0.3;  // the cloth's hole, and the round of its edge (so it reads as cap + 0.5)
    const holes = b.pockets.map(([x, y, cap]) => [x, y, cap + HOLE]);
    lay(new T.ShapeGeometry(flat(outline(0, 0, W, H, holes, false)), 8), cloth).receiveShadow = true;
    const notch = (cap) => cap + 1.2;
    // the angles (from a0, through L radians) where a circle round a pocket passes through a region
    const arcWhere = (px, py, r, inside) => {
      const N = 360, hit = [];
      for (let i = 0; i < N; i++) { const a = (i / N) * 2 * Math.PI; hit.push(inside(px + r * Math.cos(a), py + r * Math.sin(a))); }
      const first = hit.findIndex((h, i) => h && !hit[(i + N - 1) % N]);
      if (first < 0) return null;
      let n = 0; while (n < N && hit[(first + n) % N]) n++;
      return [(first / N) * 2 * Math.PI, (n / N) * 2 * Math.PI];
    };
    // three.js measures a cylinder's / lathe's sweep from +z towards +x; table angles run from +x towards +z (y)
    const sweep = ([a0, L]) => [Math.PI / 2 - a0 - L, L];
    // pockets: the cloth rolls over the slate's edge into each hole, and below it hangs a leather pocket with a
    // net over it, lit by the lamps so you can see down into it (it is deeper than a ball, which drops out of sight)
    const netMap = pocketTexture(T, aniso);
    netMap.repeat.set(3, 1);
    const pocketMat = new T.MeshStandardMaterial({ map: netMap, roughness: 0.75, side: T.DoubleSide, envMap: env, envMapIntensity: 0.15 });
    const lipMat = wool({ map: tiled(feltMap, 7, 0.4), bumpMap: tiled(feltBump, 7, 0.4), color: 0x146a3b, side: T.DoubleSide });
    for (const [x, y, cap] of b.pockets) {
      const r = cap + HOLE, arc = arcWhere(x, y, r, (qx, qy) => qx > 0 && qx < W && qy > 0 && qy < H);
      if (arc) {  // the cloth's rolled edge: a bullnose from the hole's rim, curling down inside it
        const lip = [];
        for (let i = 0; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2); lip.push(new T.Vector2(r - ROLL * Math.sin(a), -ROLL * (1 - Math.cos(a)))); }
        lip.push(new T.Vector2(r - ROLL, -1.1));
        const m = new T.Mesh(new T.LatheGeometry(lip, 64, ...sweep(arc)), lipMat);
        m.position.set(x, 0, y); m.receiveShadow = true; table.add(m);
      }
      // the bag: wide under the cut, then gathered to a rounded bottom
      const top = notch(cap) + 0.1, bag = [[top, -0.15], [top, -1.1], [top * 0.94, -2.2], [top * 0.8, -3.2], [top * 0.6, -3.9], [top * 0.35, -4.3], [0.01, -4.45]]
        .map(([rr, h]) => new T.Vector2(rr, h));
      const m = new T.Mesh(new T.LatheGeometry(bag, 64), pocketMat);
      m.position.set(x, 0, y); m.receiveShadow = true; table.add(m);
    }
    // varnished wooden rails with rounded outer corners, and the pocket openings cut out
    const CORNER = RAIL - 1;
    const frame = roundedRect(T, -RAIL, -RAIL, W + RAIL, H + RAIL, CORNER);
    frame.holes.push(new T.Path(outline(-CUSH, -CUSH, W + CUSH, H + CUSH, b.pockets.map(([x, y, cap]) => [x, y, notch(cap)]), true).map(([x, y]) => new T.Vector2(x, -y))));
    const grain = woodTexture(T, aniso);
    grain.repeat.set(1 / 70, 1 / 18);
    const wood = new T.MeshStandardMaterial({ map: grain, roughness: 0.32, metalness: 0.05, envMap: env, envMapIntensity: 0.45 });
    const rails = lay(new T.ExtrudeGeometry(frame, { depth: RAIL_TOP + 3.5, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.5, bevelSegments: 4, curveSegments: 16 }), wood, -4);
    rails.castShadow = rails.receiveShadow = true;
    const apronGrain = grain.clone(); apronGrain.needsUpdate = true; apronGrain.repeat.set(1 / 40, 1 / 6);
    lay(new T.ExtrudeGeometry(roundedRect(T, -RAIL - 0.5, -RAIL - 0.5, W + RAIL + 0.5, H + RAIL + 0.5, CORNER + 0.5),
      { depth: 8, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.3, bevelSegments: 3, curveSegments: 24 }),
    new T.MeshStandardMaterial({ map: apronGrain, color: 0x8a7a70, roughness: 0.45, envMap: env, envMapIntensity: 0.3 }), -12.2);

    // felt cushions: a rubber nose that bulges out at about two thirds of a ball's height, then a top that
    // rolls back up to the rail. The profile is swept along each rail; its ends lean back into the pocket jaws.
    const PROFILE = [[0.7, 0], [0.45, 0.55], [0.25, 1.15], [0.11, 1.75], [0.03, 2.35], [0, 2.8], [0.04, 3.08], [0.18, 3.28],
      [0.42, 3.4], [0.8, 3.47], [1.4, 3.52], [CUSH + 0.3, 3.55]];
    const cushMat = wool({ map: feltMap, bumpMap: feltBump, color: 0x146b3a });  // (its uvs are already in FELT tiles)
    function cushionGeo(p0, p1, out, jaw0, jaw1) {
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), u = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len];
      const at = (d, h, end) => {  // a profile point at one end of the cushion, in table space
        const slide = end ? len + jaw1 * (d / CUSH) : -jaw0 * (d / CUSH);
        return [p0[0] + u[0] * slide + out[0] * d, h, p0[1] + u[1] * slide + out[1] * d, slide];
      };
      const pos = [], uv = [], idx = [];
      const add = (v, uu, vv) => { pos.push(v[0], v[1], v[2]); uv.push(uu, vv); return pos.length / 3 - 1; };
      const P = (i) => new T.Vector3(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
      const facesAway = (i0, i1, i2, want) => P(i1).sub(P(i0)).cross(P(i2).sub(P(i0))).dot(want) < 0;
      // add triangles, all flipped if the one at `k` faces away from `want` (they're all wound alike)
      const tri = (list, want, k = 0) => {
        if (facesAway(list[k], list[k + 1], list[k + 2], want)) for (let i = 0; i < list.length; i += 3) [list[i + 1], list[i + 2]] = [list[i + 2], list[i + 1]];
        idx.push(...list);
      };
      // the swept body (smooth across the profile)
      let arc = 0;
      const rows = PROFILE.map(([d, h], i) => {
        if (i) arc += Math.hypot(d - PROFILE[i - 1][0], h - PROFILE[i - 1][1]);
        const a0 = at(d, h, false), a1 = at(d, h, true);
        return [add(a0, a0[3] / FELT, arc / FELT), add(a1, a1[3] / FELT, arc / FELT)];
      });
      const body = [];
      for (let i = 0; i + 1 < rows.length; i++) body.push(rows[i][0], rows[i + 1][0], rows[i + 1][1], rows[i][0], rows[i + 1][1], rows[i][1]);
      // judged at the nose, which must face the table (away from the rail)
      tri(body, new T.Vector3(-out[0], 0, -out[1]), (PROFILE.findIndex(([d]) => d === 0) - 1) * 6);
      // flat end caps, closed down to the cloth
      const cap = [...PROFILE, [CUSH + 0.3, 0]];
      const tris = T.ShapeUtils.triangulateShape(cap.map(([d, h]) => new T.Vector2(d, h)), []);
      for (const end of [false, true]) {
        const ids = cap.map(([d, h]) => add(at(d, h, end), d / FELT, h / FELT));
        tri(tris.flatMap((t) => t.map((k) => ids[k])), new T.Vector3(u[0] * (end ? 1 : -1), 0, u[1] * (end ? 1 : -1)));
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      return g;
    }
    const gap = (i) => b.pockets[i][2] + 3.4;  // where the cushion nose starts (the server's pocket mouth)
    const jaw = 2.6;
    const cushion = (p0, p1, out) => { const m = new T.Mesh(cushionGeo(p0, p1, out, jaw, jaw), cushMat); m.castShadow = m.receiveShadow = true; table.add(m); };
    const E = b.edges || [];
    if (E.length && E.length % 3 === 0) {
      // the server's cushion line: per pocket, [in facing, out facing, rail to the next pocket]. Each rail's
      // cushion runs between two jaw points, and its ends lean back along that jaw's facing.
      const lean = (px, py, fx, fy, u, out) => {  // rail units back per unit of depth, along the facing
        const vx = fx - px, vy = fy - py, d = vx * out[0] + vy * out[1];
        return d > 0.01 ? Math.min(3, Math.abs(vx * u[0] + vy * u[1]) / d) : jaw / CUSH;
      };
      for (let i = 0; i < E.length; i += 3) {
        const [x1, y1, x2, y2] = E[i + 2], len = Math.hypot(x2 - x1, y2 - y1);
        if (len < 1) continue;
        const u = [(x2 - x1) / len, (y2 - y1) / len];
        let out = [u[1], -u[0]];
        if (out[0] * ((x1 + x2) / 2 - W / 2) + out[1] * ((y1 + y2) / 2 - H / 2) < 0) out = [-out[0], -out[1]];
        const f0 = E[i + 1], f1 = E[(i + 3) % E.length];  // this pocket's out facing (f_out -> p_out), the next one's in facing
        // the back of the cushion's end stays clear of the hole (and the leather rim round it)
        const fit = (px, py, j, back) => {
          const [cx, cy, cap] = b.pockets.reduce((a, q) => (Math.hypot(q[0] - px, q[1] - py) < Math.hypot(a[0] - px, a[1] - py) ? q : a));
          while (j > 0 && Math.hypot(px + back * u[0] * j + out[0] * CUSH - cx, py + back * u[1] * j + out[1] * CUSH - cy) < cap + 1) j -= 0.1;
          return Math.max(0, j);
        };
        const j0 = fit(x1, y1, CUSH * lean(x1, y1, f0[0], f0[1], u, out), -1), j1 = fit(x2, y2, CUSH * lean(x2, y2, f1[2], f1[3], u, out), 1);
        const m = new T.Mesh(cushionGeo([x1, y1], [x2, y2], out, j0, j1), cushMat);
        m.castShadow = m.receiveShadow = true; table.add(m);
      }
    } else {
      for (const [y, out, a, z] of [[0, -1, 0, 1], [0, -1, 1, 2], [H, 1, 3, 4], [H, 1, 4, 5]]) {  // long rails: pockets a..z
        cushion([b.pockets[a][0] + gap(a), y], [b.pockets[z][0] - gap(z), y], [0, out]);
      }
      for (const [x, out, a, z] of [[0, -1, 0, 3], [W, 1, 2, 5]]) {  // short rails
        cushion([x, b.pockets[a][1] + gap(a)], [x, b.pockets[z][1] - gap(z)], [out, 0]);
      }
    }

    // pockets: a leather lining down the cut in the rail, and a rounded leather rim over its top edge
    const leather = new T.MeshStandardMaterial({ color: 0x2b1c12, roughness: 0.5, envMap: env, envMapIntensity: 0.35 });
    const lining = new T.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.6, side: T.BackSide, envMap: env, envMapIntensity: 0.2 });
    for (const [px, py, cap] of b.pockets) {
      // the arc of the cut that runs through wood (outside the cushions' back line)
      const r = notch(cap), arc = arcWhere(px, py, r, (x, y) => x < -CUSH || x > W + CUSH || y < -CUSH || y > H + CUSH);
      if (!arc) continue;
      const [a0, L] = arc;
      const wall = new T.Mesh(new T.CylinderGeometry(r - 0.04, r - 0.04, RAIL_TOP + 1.2, 64, 1, true, ...sweep(arc)), lining);
      wall.position.set(px, (RAIL_TOP - 1.2) / 2, py); wall.receiveShadow = true; table.add(wall);
      const rim = new T.Group(), torus = new T.Mesh(new T.TorusGeometry(r + 0.05, 0.5, 14, 72, L), leather);
      torus.rotation.x = Math.PI / 2; rim.add(torus);
      rim.rotation.y = -a0; rim.position.set(px, RAIL_TOP - 0.05, py); table.add(rim);
      torus.castShadow = true;
    }

    // rail diamonds (inlaid mother-of-pearl), head string and foot spot
    const pearl = new T.MeshStandardMaterial({ color: 0xf3ead2, roughness: 0.2, envMap: env, envMapIntensity: 0.8 });
    const dGeo = new T.CircleGeometry(0.75, 4), bGeo = new T.RingGeometry(0.75, 0.98, 4);  // a diamond: a four-sided circle, in a brass setting
    const brass = new T.MeshStandardMaterial({ color: 0xc9a14e, metalness: 0.85, roughness: 0.32, envMap: env, envMapIntensity: 1.1 });
    for (const d of [0.25, 0.5, 0.75]) {
      for (const [x, y] of [[W * d / 2, -RAIL / 2 - 1], [W / 2 + W * d / 2, -RAIL / 2 - 1], [W * d / 2, H + RAIL / 2 + 1], [W / 2 + W * d / 2, H + RAIL / 2 + 1], [-RAIL / 2 - 1, H * d], [W + RAIL / 2 + 1, H * d]]) {
        for (const [geo, mat] of [[dGeo, pearl], [bGeo, brass]]) {
          const m = lay(geo, mat, RAIL_TOP + 0.02); m.position.set(x, RAIL_TOP + 0.02, y); m.scale.set(0.8, 1.3, 1);
          if (x < 0 || x > W) m.rotation.z = Math.PI / 2;
        }
      }
    }
    // the table's shadow on the floor, round its edges (the page shows through beyond it)
    {
      const c = Object.assign(document.createElement('canvas'), { width: 128, height: 128 }), g = c.getContext('2d');
      const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      r.addColorStop(0, 'rgba(0,0,0,0.6)'); r.addColorStop(0.6, 'rgba(0,0,0,0.45)'); r.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = r; g.fillRect(0, 0, 128, 128);
      const m = lay(new T.PlaneGeometry(W + 110, H + 90), new T.MeshBasicMaterial({ map: new T.CanvasTexture(c), transparent: true, depthWrite: false }), -30);
      m.position.set(W / 2, -30, H / 2);
    }
    const chalk = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false });
    lay(new T.PlaneGeometry(0.4, H), chalk, 0.02).position.set(b.headX, 0.02, H / 2);
    lay(new T.CircleGeometry(0.7, 24), chalk, 0.02).position.set(W * 0.73, 0.02, H / 2);

    // balls: glossy, clear-coated spheres that reflect the lamps, each turned as it rolls, each with a soft
    // dark patch on the cloth right under it where the ball shuts out the room's light (contact shadow)
    const ballGeo = new T.SphereGeometry(R, 64, 40), balls = new Map();
    const blot = (() => {
      const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), g = c.getContext('2d');
      const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, 'rgba(0,0,0,0.85)'); r.addColorStop(0.35, 'rgba(0,0,0,0.5)'); r.addColorStop(0.7, 'rgba(0,0,0,0.12)'); r.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = r; g.fillRect(0, 0, 64, 64);
      return new T.CanvasTexture(c);
    })();
    const blotGeo = new T.PlaneGeometry(R * 2.7, R * 2.7), blotMat = new T.MeshBasicMaterial({ map: blot, transparent: true, depthWrite: false });
    function ball(n) {
      let o = balls.get(n);
      if (o) return o;
      const m = new T.Mesh(ballGeo, new T.MeshPhysicalMaterial({ map: ballTexture(T, n, aniso), roughness: 0.16, metalness: 0,
        clearcoat: 1, clearcoatRoughness: 0.04, envMap: env, envMapIntensity: 0.9 }));
      m.castShadow = true;
      // number spot facing up, a little turned so the rack doesn't look stamped out
      m.quaternion.setFromEuler(new T.Euler(-Math.PI / 2 + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.6, 0));
      table.add(m);
      const shadow = new T.Mesh(blotGeo, blotMat);
      shadow.rotation.x = -Math.PI / 2; shadow.renderOrder = 1; shadow.visible = false; table.add(shadow);
      o = { m, shadow, x: null, y: null };
      balls.set(n, o);
      return o;
    }
    const qd = new T.Quaternion(), axis = new T.Vector3();
    function roll(o, x, y) {
      if (o.x != null) {
        const dx = x - o.x, dy = y - o.y, d = Math.hypot(dx, dy);
        if (d > 0.005 && d < R * 12) { axis.set(dy / d, 0, -dx / d); qd.setFromAxisAngle(axis, d / R); o.m.quaternion.premultiply(qd); }
      }
      o.x = x; o.y = y;
      o.m.position.set(x, R, y);
      o.shadow.position.set(x, 0.03, y);
    }
    const falling = [];  // balls dropping into a pocket

    // cue stick: shaft, dark butt, white ferrule, blue tip. It points along +x in its group, tip at the origin.
    const stick = new T.Group(), tilt = new T.Group(); stick.add(tilt); table.add(stick);
    const part = (r0, r1, len, at, color, rough = 0.5, more = {}) => {
      const m = new T.Mesh(new T.CylinderGeometry(r0, r1, len, 32), new T.MeshStandardMaterial({ color, roughness: rough, ...more }));
      // the cylinder's top (r0) turns to face the tip (+x), so each piece widens toward the butt
      m.rotation.z = -Math.PI / 2; m.position.x = -(at + len / 2); m.castShadow = true; tilt.add(m);
      return m;
    };
    // a chalked leather tip, rounded at the front, on a white ferrule
    const tipBlue = 0x4a78c8;
    part(0.47, 0.5, 0.45, 0.12, tipBlue, 0.95);
    const dome = new T.Mesh(new T.SphereGeometry(0.47, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), new T.MeshStandardMaterial({ color: tipBlue, roughness: 0.95 }));
    dome.rotation.z = -Math.PI / 2; dome.scale.set(1, 0.3, 1); dome.position.x = -0.12; tilt.add(dome);
    part(0.5, 0.53, 2.2, 0.57, 0xf6f4ee, 0.25);
    const maple = mapleTexture(T);
    part(0.53, 0.95, 82, 2.77, 0xffffff, 0.35, { map: maple, envMap: env, envMapIntensity: 0.5 });
    const buttR = (d) => 0.95 + (0.3 * (d - 84.77)) / 56;  // the butt's radius d from the tip
    const varnish = { envMap: env, envMapIntensity: 0.6 };
    part(buttR(84.77) + 0.02, buttR(85.77) + 0.02, 1, 84.77, 0xf0ece0, 0.3, varnish);  // the joint
    part(buttR(85.77), buttR(110), 24.23, 85.77, 0x3a1f0f, 0.3, varnish);  // the forearm
    part(buttR(110), buttR(128), 18, 110, 0x1b1b20, 0.85);  // the wrap
    part(buttR(128) + 0.03, buttR(128.8) + 0.03, 0.8, 128, 0xc9a14e, 0.3, { metalness: 0.85, envMap: env, envMapIntensity: 1 });  // a brass ring
    part(buttR(128.8), buttR(140.77), 11.97, 128.8, 0x2b160a, 0.3, varnish);  // the sleeve
    part(1.25, 1.25, 1.2, 140.77, 0x111111);
    tilt.rotation.z = -0.09;  // butt raised over the rails

    // aim guide: flat strips just above the cloth (a dashed texture for the aim line), a ghost ball, rings
    const soft = alphaTexture(T, false);  // the guide's lines fade out at their edges instead of stopping hard
    const strip = (color, opacity, dashed) => {
      const mat = new T.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, map: dashed ? dashTexture(T) : null, alphaMap: soft });
      const m = new T.Mesh(new T.PlaneGeometry(1, 1), mat); m.rotation.x = -Math.PI / 2; m.renderOrder = 2;
      const g = new T.Group(); g.add(m); table.add(g); g.visible = false;
      g.set = (ax, ay, bx, by, w) => {
        const len = Math.hypot(bx - ax, by - ay);
        g.visible = len > 0.01;
        g.position.set((ax + bx) / 2, 0.08, (ay + by) / 2); g.rotation.y = -Math.atan2(by - ay, bx - ax);
        m.scale.set(len, w, 1);
        if (dashed) mat.map.repeat.x = len / 4.2;
      };
      return g;
    };
    // a ribbon along a path (the engine's predicted paths bend with spin and off cushions); rebuilt only
    // when it's handed a new path
    const ribbon = (color, opacity, dashed) => {
      const mat = new T.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: T.DoubleSide, map: dashed ? dashTexture(T) : null, alphaMap: soft });
      const m = new T.Mesh(new T.BufferGeometry(), mat);
      m.renderOrder = 2; m.visible = false; m.frustumCulled = false; table.add(m);
      m.set = (pts, w) => {
        if (pts === m.pts) { m.visible = true; return; }
        m.pts = pts;
        const P = [pts[0]];
        for (const q of pts) { const l = P[P.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) >= 0.5) P.push(q); }
        const end = pts[pts.length - 1];
        if (P[P.length - 1] !== end && Math.hypot(end[0] - P[P.length - 1][0], end[1] - P[P.length - 1][1]) > 0.05) P.push(end);
        m.visible = P.length > 1;
        if (!m.visible) return;
        const pos = [], uv = [], idx = [];
        let along = 0;
        P.forEach((q, i) => {
          const a = P[Math.max(0, i - 1)], c = P[Math.min(P.length - 1, i + 1)];
          const tl = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1, nx = (-(c[1] - a[1]) / tl) * (w / 2), ny = ((c[0] - a[0]) / tl) * (w / 2);
          if (i) along += Math.hypot(q[0] - P[i - 1][0], q[1] - P[i - 1][1]);
          pos.push(q[0] + nx, 0.08, q[1] + ny, q[0] - nx, 0.08, q[1] - ny);
          uv.push(along / 4.2, 0, along / 4.2, 1);
          if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
        });
        m.geometry.dispose();
        m.geometry = new T.BufferGeometry();
        m.geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
        m.geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
        m.geometry.setIndex(idx);
      };
      return m;
    };
    const aimLine = strip(0xffffff, 0.75, true), objLine = strip(0xffd166, 0.9, false), cueLine = strip(0xbfe9ff, 0.8, true);
    const objPath = ribbon(0xffd166, 0.9, false), cuePath = ribbon(0xbfe9ff, 0.8, true);
    const ghost = new T.Mesh(ballGeo, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }));
    table.add(ghost);
    // a bright rim round the ghost ball: its back faces, a little larger, show only at the edge
    const ghostRim = new T.Mesh(ballGeo, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, side: T.BackSide }));
    ghostRim.scale.setScalar(1.09); ghost.add(ghostRim);
    // an arrowhead at the end of the object ball's line
    const arrowShape = new T.Shape([new T.Vector2(1.6, 0), new T.Vector2(-0.6, 1.05), new T.Vector2(-0.2, 0), new T.Vector2(-0.6, -1.05)]);
    const arrow = new T.Mesh(new T.ShapeGeometry(arrowShape), new T.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.95, depthWrite: false, side: T.DoubleSide }));
    arrow.rotation.order = 'YXZ'; arrow.renderOrder = 3; arrow.visible = false; table.add(arrow);
    const pointArrow = (pts) => {  // at the last point of a path, pointing along its last stretch
      const b = pts[pts.length - 1];
      let a = pts[pts.length - 2];
      for (let i = pts.length - 2; i >= 0 && Math.hypot(b[0] - pts[i][0], b[1] - pts[i][1]) < 1; i--) a = pts[i];
      if (!a) return;
      arrow.visible = true; arrow.position.set(b[0], 0.1, b[1]);
      arrow.rotation.set(-Math.PI / 2, -Math.atan2(b[1] - a[1], b[0] - a[0]), 0);
    };
    const ringMesh = (r0, r1, color) => {
      const m = new T.Mesh(new T.RingGeometry(r0, r1, 64), new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: T.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.renderOrder = 3; m.visible = false; table.add(m); return m;
    };
    const handRing = ringMesh(R * 1.9, R * 2.25, 0xffb703);
    const luckyRing = ringMesh(R * 1.35, R * 1.7, 0xffd166);  // ⭐ the lucky ball's gold ring
    const callRings = b.pockets.map(([x, y, cap]) => { const m = ringMesh(cap + 2.3, cap + 3.1, 0xffd166); m.position.set(x, RAIL_TOP + 0.6, y); return m; });

    // the colours above were picked as sRGB: light works in linear, so convert them once; the overlays (aim
    // guide, ghost ball, rings) skip tone mapping so they keep exactly the colours picked
    const overlays = new Set([ghost.material, ghostRim.material, arrow.material, handRing.material, luckyRing.material, objPath.material, cuePath.material, ...callRings.map((m) => m.material)]);
    scene.traverse((o) => {
      const m = o.material;
      if (!m || m.userData.lin) return;
      m.userData.lin = true;
      if (overlays.has(m) || (m.isMeshBasicMaterial && m.depthWrite === false && m !== blotMat)) m.toneMapped = false;
    });

    // ---------- the shot's life (not on 🎨 Low): a glint where balls meet, chalk off the tip, dust off the
    // cushions, a ring round the pocket a ball drops into, and short streaks behind fast balls
    const fine = GL3.level() !== 'low', glow = glowTexture(T), fade = alphaTexture(T, true);
    const parts = [], spares = [], potRings = [];
    function puff(x, y, h, color, n, size, speed, life, rise, additive) {
      for (let i = 0; i < n; i++) {
        let sp = spares.pop();
        // #114: the soft edge is read as an alpha map (the canvas's green channel is its alpha, premultiplied): as a colour
        // map its clear texels upload as black and filtering smeared a dark rim round every puff, left lying on the cloth
        if (!sp) { sp = new T.Sprite(new T.SpriteMaterial({ alphaMap: glow, transparent: true, depthWrite: false, toneMapped: false })); sp.renderOrder = 4; table.add(sp); }
        sp.material.color.set(color); sp.material.blending = additive ? T.AdditiveBlending : T.NormalBlending; sp.visible = true;
        const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.6);
        sp.position.set(x, h, y);
        parts.push({ sp, vx: Math.cos(a) * v, vz: Math.sin(a) * v, vy: rise * (0.5 + Math.random() * 0.5), t: 0, max: life * (0.7 + Math.random() * 0.6),
          s0: size * 0.6, s1: size * (1.3 + Math.random() * 0.7), a0: additive ? 0.9 : 0.55 });
      }
    }
    function effect(e, aim) {
      if (!e.p || !fine) return;
      const h = Math.min(1, e.v / 12), [x, y] = e.p;
      if (e.kind === 'pocket') {
        const [px, py, cap] = b.pockets.reduce((a, q) => (Math.hypot(q[0] - x, q[1] - y) < Math.hypot(a[0] - x, a[1] - y) ? q : a));
        let m = potRings.find((r) => !r.visible);
        if (!m) { m = ringMesh(1, 1.25, 0xffd166); m.material.toneMapped = false; potRings.push(m); }
        m.position.set(px, RAIL_TOP + 0.4, py); m.userData = { t: 0, r: cap + 1.2 }; m.scale.setScalar(cap + 1.2); m.visible = true;
      } else if (e.kind === 'ball') {
        if (h > 0.1) puff(x, y, R, 0xfff2d0, 1, R * (1.2 + 1.8 * h), 0, 0.2, 0, true);
        if (h > 0.35) puff(x, y, R, 0xffffff, 1 + Math.round(h * 3), R * 0.35, 12 + 30 * h, 0.3, 3, true);
      } else if (e.kind === 'rail') {
        if (h > 0.25) puff(x, y, R * 0.5, 0xcdeedd, 2, R * 0.8, 3, 0.55, 1.5, false);
      } else {  // the tip on the cue ball: a puff of blue chalk, and the break shakes the room a little
        const cx = aim == null ? x : x - Math.cos(aim) * R, cy = aim == null ? y : y - Math.sin(aim) * R;
        puff(cx, cy, R, 0x86a8e6, 3 + Math.round(h * 3), R * 0.5, 4 + 10 * h, 0.65, 2, false);
        if (h > 0.45) puff(cx, cy, R, 0xffffff, 1, R * 1.4, 0, 0.12, 0, true);
        if (h > 0.7) GL3.shake(camera, 0.4 + (h - 0.7) * 1.5);
      }
    }
    function stepFx(dt) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.t += dt;
        if (p.t >= p.max) { p.sp.visible = false; spares.push(p.sp); parts.splice(i, 1); continue; }
        const k = p.t / p.max, drag = Math.exp(-3 * dt);
        p.vx *= drag; p.vz *= drag; p.vy *= drag;
        p.sp.position.x += p.vx * dt; p.sp.position.y += p.vy * dt; p.sp.position.z += p.vz * dt;
        const sz = p.s0 + (p.s1 - p.s0) * k;
        p.sp.scale.set(sz, sz, 1); p.sp.material.opacity = p.a0 * (1 - k) ** 1.5;
      }
      let rings = false;
      for (const m of potRings) {
        if (!m.visible) continue;
        const k = (m.userData.t += dt) / 0.5;
        if (k >= 1) { m.visible = false; continue; }
        rings = true; m.scale.setScalar(m.userData.r * (1 + k * 0.5)); m.material.opacity = 0.9 * (1 - k);
      }
      return parts.length > 0 || rings;
    }
    // a streak behind each fast ball: its last tenth of a second, widening and brightening toward the ball
    const trails = new Map();
    function trail(n, x, y, now, on) {
      let t = trails.get(n);
      if (!t) {
        if (!on) return false;
        // (an alpha map, not a colour map: see puff(); and the darkest balls' streaks are lightened, so the 8 doesn't drag a black smear)
        const col = new T.Color(COLORS[n > 8 ? n - 8 : n]), lum = col.r * 0.3 + col.g * 0.59 + col.b * 0.11;
        if (lum < 0.3) col.lerp(new T.Color(0xffffff), 0.45);
        const mat = new T.MeshBasicMaterial({ color: col, alphaMap: fade, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false, side: T.DoubleSide });
        const m = new T.Mesh(new T.BufferGeometry(), mat);
        m.frustumCulled = false; m.renderOrder = 1; m.visible = false; table.add(m);
        trails.set(n, (t = { m, pts: [] }));
      }
      if (!on) { t.pts.length = 0; t.m.visible = false; return false; }
      const l = t.pts[t.pts.length - 1];
      if (!l || l[0] !== x || l[1] !== y) t.pts.push([x, y, now]);
      while (t.pts.length && t.pts[0][2] < now - 110) t.pts.shift();
      const P = t.pts, len = P.length > 2 ? Math.hypot(x - P[0][0], y - P[0][1]) : 0;
      t.m.visible = len > R * 2.5;
      if (!t.m.visible) return P.length > 1;
      const pos = [], uv = [], idx = [];
      P.forEach((q, i) => {
        const a = P[Math.max(0, i - 1)], c = P[Math.min(P.length - 1, i + 1)], f = i / (P.length - 1);
        const tl = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1, w = R * 0.85 * f, nx = (-(c[1] - a[1]) / tl) * w, ny = ((c[0] - a[0]) / tl) * w;
        pos.push(q[0] + nx, R, q[1] + ny, q[0] - nx, R, q[1] - ny); uv.push(f, 0, f, 1);
        if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
      });
      t.m.material.opacity = 0.32 * Math.min(1, len / (R * 7));
      t.m.geometry.dispose(); t.m.geometry = new T.BufferGeometry();
      t.m.geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      t.m.geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      t.m.geometry.setIndex(idx);
      return true;
    }

    // ---------- camera
    const camNow = { pos: new T.Vector3(), look: new T.Vector3() }, camGoal = { pos: new T.Vector3(), look: new T.Vector3() };
    let size = [300, 150], portrait = false, mode = 'table', fitted = null, settle = 0, zoom = { z: 1, x: 0, y: 0 }, yaw = 0;
    let lifted = false, ease = 9;  // the follow-the-shot lift (#103) and how fast the camera eases to its goal
    const moving0 = () => camNow.pos.distanceToSquared(camGoal.pos) > 1;
    // the lens's crop: the overview's centring offset, and the two-finger zoom (canvas point p shows (p - x) / z),
    // done by rendering the image z times bigger and showing the part on screen, so it's drawn sharp, not scaled up
    function crop() {
      const [w, h] = size, { z, x, y } = zoom, off = mode === 'table' && fitted ? fitted.off : [0, 0];
      if (z === 1 && !x && !y && !off[0] && !off[1]) camera.clearViewOffset();
      else camera.setViewOffset(w * z, h * z, off[0] * z - x, off[1] * z - y, w, h);
    }
    // overview: tilted over the table's near side, far enough back that every rail fits, then centred
    function fitTable() {
      // a tall phone: nearer top-down, so the far end doesn't shrink and the table fills the width (#101)
      const el = portrait ? 0.98 : 1.1, dir = portrait ? new T.Vector3(-Math.cos(el), Math.sin(el), 0) : new T.Vector3(0, Math.sin(el), Math.cos(el));
      dir.applyAxisAngle(new T.Vector3(0, 1, 0), yaw);  // #115: turned round the table
      camera.fov = 30; camera.aspect = size[0] / size[1]; camera.clearViewOffset();
      const pts = [];
      for (const x of [-RAIL, W + RAIL]) for (const y of [-RAIL, H + RAIL]) for (const h of [-1, RAIL_TOP]) pts.push(new T.Vector3(x - W / 2, h, y - H / 2));
      const box = (d) => {
        camera.position.copy(dir).multiplyScalar(d); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
        let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
        for (const p of pts) { const q = p.clone().project(camera); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
        return { x0, x1, y0, y1 };
      };
      let lo = 50, hi = 2000;
      for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2, bx = box(m); if (bx.x1 - bx.x0 > 1.96 || bx.y1 - bx.y0 > 1.96) lo = m; else hi = m; }
      const bx = box(hi);
      fitted = { pos: camera.position.clone(), off: [((bx.x0 + bx.x1) / 2) * size[0] / 2, -((bx.y0 + bx.y1) / 2) * size[1] / 2] };
      crop();
    }
    // behind the cue: at least ~56° across, so a tall phone screen still shows the balls either side of the aim
    function cueLens() {
      camera.clearViewOffset(); camera.aspect = size[0] / size[1];
      camera.fov = Math.min(80, Math.max(46, (2 * Math.atan(Math.tan((28 * Math.PI) / 180) / camera.aspect) * 180) / Math.PI));
      crop(); camera.updateProjectionMatrix();
    }
    function resize(w, h, port) {
      size = [Math.max(50, w), Math.max(50, h)]; portrait = port;
      renderer.setSize(size[0], size[1], false);
      if (mode === 'table') fitTable(); else cueLens();
      key = '';
    }
    function setZoom(z, x, y) {
      zoom = { z, x, y }; crop(); camera.updateProjectionMatrix(); key = '';
    }
    // #115: the overview turns round the table (the behind-the-cue view already turns with the aim)
    function setYaw(a) {
      yaw = Math.atan2(Math.sin(a), Math.cos(a)); key = '';
      if (mode === 'table') fitTable();
    }
    function setMode(m) {
      mode = m; key = '';
      if (m === 'table') fitTable(); else { cueLens(); settle = 0; }
    }

    // ---------- each frame
    let key = '', last = 0, sharp = false, cueLift = null, cueNeed = null;
    const tmp = new T.Vector3();
    function render(st) {
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
      // balls
      const seen = new Set();
      let streaks = false;
      const trailsOn = fine && st.animating && !(window.motionOK && !motionOK());
      for (const [n, x, y] of st.balls) {
        const o = ball(n); o.m.visible = o.shadow.visible = true; o.falling = false; roll(o, x, y); seen.add(n);
        if (trail(n, x, y, now, trailsOn)) streaks = true;
      }
      for (const [n] of trails) if (!seen.has(n)) trail(n, 0, 0, now, false);
      for (const [n, o] of balls) {
        if (seen.has(n) || !o.m.visible || o.falling) continue;
        o.shadow.visible = false;
        if (st.animating && o.x != null) {  // gone mid-shot: it dropped into the nearest pocket
          const p = b.pockets.reduce((a, q) => (Math.hypot(q[0] - o.x, q[1] - o.y) < Math.hypot(a[0] - o.x, a[1] - o.y) ? q : a));
          falling.push({ o, from: [o.x, o.y], to: p, t0: now, at: [o.x, o.y] }); o.falling = true;
        } else o.m.visible = false;
        o.x = null;
      }
      for (let i = falling.length - 1; i >= 0; i--) {
        const f = falling[i], t = Math.min(1, (now - f.t0) / 560);
        if (!f.o.falling) { falling.splice(i, 1); continue; }  // back on the table (the 8 on the break)
        // it runs on over the lip into the jaws, then drops into the bag, still turning
        const run = 1 - (1 - Math.min(1, t / 0.45)) ** 2, drop = Math.max(0, (t - 0.18) / 0.82);
        const x = f.from[0] + (f.to[0] - f.from[0]) * run, y = f.from[1] + (f.to[1] - f.from[1]) * run, dx = x - f.at[0], dy = y - f.at[1], d = Math.hypot(dx, dy);
        if (d > 0.005) { axis.set(dy / d, 0, -dx / d); qd.setFromAxisAngle(axis, d / R); f.o.m.quaternion.premultiply(qd); }
        f.at = [x, y];
        f.o.m.position.set(x, R - drop * drop * (R + 2.05), y);
        if (t >= 1) { f.o.m.visible = false; f.o.falling = false; falling.splice(i, 1); }
      }
      // cue stick and guide
      const s = st.stick;
      stick.visible = !!s;
      if (s) {
        stick.position.set(s.x, R, s.y); stick.rotation.y = -s.aim;
        const pull = R + 0.6 + s.power * 14, lift0 = s.spin * R * 0.55;
        tilt.position.set(-pull, lift0, s.english * R * 0.55);
        // #112: near a cushion the butt ran through the rail and vanished into it. Jack it up just enough that
        // the cue clears the cushion and rail tops along its whole length, as a player would
        const ux = Math.cos(s.aim), uy = Math.sin(s.aim);
        let need = 0.09;
        for (let d = 2; d <= 141; d += 2) {
          const px = s.x - ux * (pull + d), py = s.y - uy * (pull + d);
          if (px > 0 && px < W && py > 0 && py < H) continue;  // over the cloth
          if (px < -RAIL - 1.5 || px > W + RAIL + 1.5 || py < -RAIL - 1.5 || py > H + RAIL + 1.5) break;  // past the table
          const r = d < 84.77 ? 0.53 + (0.42 * (d - 2.77)) / 82 : buttR(d);
          need = Math.max(need, Math.atan2(RAIL_TOP + 0.45 + r - (R + lift0), d));
        }
        need = Math.min(0.55, need); cueNeed = need;
        cueLift = cueLift == null ? need : cueLift + (need - cueLift) * Math.min(1, dt * 12);
        if (Math.abs(need - cueLift) < 0.002) cueLift = need;
        tilt.rotation.z = -cueLift;
      }
      const lifting = !!s && cueLift !== cueNeed;
      const gd = st.guide;
      aimLine.visible = objLine.visible = cueLine.visible = objPath.visible = cuePath.visible = ghost.visible = arrow.visible = false;
      if (gd && gd.mode !== 'off') {
        const [cx, cy] = gd.cue, [gx, gy] = gd.g, full = gd.mode === 'full', L = Math.hypot(gx - cx, gy - cy) || 1;
        const light = gd.mode === 'light';  // #50: the ghost ball and a short hint of the object ball's line
        const k = full || light ? 1 : Math.min(1, 26 / L);
        // the aim line shows the power (#82): thin and green for a soft touch, thick and red for a break
        const pw = Math.min(1, Math.max(0, s?.power ?? 0.5));
        aimLine.children[0].material.color.setHSL(0.36 * (1 - pw), 0.95, 0.62).convertSRGBToLinear();
        aimLine.set(cx + ((gx - cx) / L) * R, cy + ((gy - cy) / L) * R, cx + (gx - cx) * k, cy + (gy - cy) * k, 0.45 + pw * 0.7);
        if (light) {
          ghost.visible = true; ghost.position.set(gx, R, gy);
          ghost.material.color.set(0xffffff); ghost.material.opacity = 0.18; ghostRim.material.color.set(0xffffff);
          if (gd.ball) {
            const [bx, by] = gd.ball, nx = bx - gx, ny = by - gy, n = Math.hypot(nx, ny) || 1;
            objLine.set(bx, by, bx + (nx / n) * 9, by + (ny / n) * 9, 0.6);
            pointArrow([[bx, by], [bx + (nx / n) * 9, by + (ny / n) * 9]]);
          }
        } else if (full) {
          ghost.visible = true; ghost.position.set(gx, R, gy);
          // red: the cue ball would drop; fainter: it runs out of pace and stops here
          ghost.material.color.set(gd.scratch ? 0xef476f : 0xffffff); ghost.material.opacity = gd.stop ? 0.12 : 0.22;
          ghostRim.material.color.set(gd.scratch ? 0xef476f : 0xffffff); ghostRim.material.opacity = gd.stop ? 0.25 : 0.5;
          if (gd.objPath || gd.cuePath) {  // the engine's own prediction: the paths really taken
            if (gd.objPath) { objPath.set(gd.objPath, 0.7); if (gd.objPath.length > 1) pointArrow(gd.objPath); }
            if (gd.cuePath) cuePath.set(gd.cuePath, 0.55);
          } else if (gd.ball) {
            const [bx, by] = gd.ball, nx = bx - gx, ny = by - gy, n = Math.hypot(nx, ny) || 1;
            objLine.set(bx, by, bx + (nx / n) * 28, by + (ny / n) * 28, 0.7);
            pointArrow([[bx, by], [bx + (nx / n) * 28, by + (ny / n) * 28]]);
          }
          if (gd.deflect) cueLine.set(gx, gy, gx + gd.deflect[0], gy + gd.deflect[1], 0.55);
        }
      }
      const lk = st.lucky != null && st.balls.find(([n]) => n === st.lucky);
      luckyRing.visible = !!lk;
      if (lk) { luckyRing.position.set(lk[1], 0.1, lk[2]); luckyRing.material.opacity = 0.65 + 0.3 * Math.sin(now / 300); }
      handRing.visible = !!st.ring;
      if (st.ring) { handRing.position.set(st.ring.x, 0.1, st.ring.y); handRing.material.color.set(st.ring.ok ? 0xffb703 : 0xef476f); }
      const pulse = 0.45 + 0.35 * Math.sin(now / 250);
      callRings.forEach((m, i) => { m.visible = st.call === i || (st.callAll && st.call == null); m.material.opacity = st.call === i ? 0.95 : pulse; });
      // camera: the overview stays put; behind-the-cue eases after the aim
      let moving = false;
      if (mode === 'cue' && st.cam) {
        const { x, y, aim } = st.cam, dx = Math.cos(aim), dy = Math.sin(aim);
        // #103: while the balls run, rise up and back over the table (looking down the shot, at the middle of
        // the table), so you can see where everything goes; then drop back behind the cue
        const up = st.animating && st.follow;
        if (up) {
          const lx = (x + dx * 50) * 0.5 + W / 4, ly = (y + dy * 50) * 0.5 + H / 4;
          camGoal.pos.set(x - dx * 70 - W / 2, 150, y - dy * 70 - H / 2);
          camGoal.look.set(lx - W / 2, 0, ly - H / 2);
        } else {
          camGoal.pos.set(x - dx * 46 - W / 2, Math.max(21, 46 * Math.tan(cueLift ?? 0) + 12), y - dy * 46 - H / 2);  // (over a jacked-up cue)
          camGoal.look.set(x + dx * 22 - W / 2, 0, y + dy * 22 - H / 2);
        }
        if (up !== lifted) { lifted = up; ease = 3.2; }
        if (!up && !moving0()) ease = 9;
        const a = settle++ === 0 ? 1 : 1 - Math.exp(-dt * ease);
        camNow.pos.lerp(camGoal.pos, a); camNow.look.lerp(camGoal.look, a);
        camera.position.copy(camNow.pos); camera.lookAt(camNow.look);
        moving = camNow.pos.distanceToSquared(camGoal.pos) > 0.0004 || camNow.look.distanceToSquared(camGoal.look) > 0.0004;
      } else if (mode === 'table' && fitted) camera.position.copy(fitted.pos), camera.lookAt(0, 0, 0);
      const fxOn = stepFx(dt), shaking = !!camera.userData.shake;
      if (shaking) GL3.tickShake(camera, dt);
      // draw only when something changed
      const k = JSON.stringify([st.lucky, st.balls, s && [s.x, s.y, s.aim, s.power, s.spin, s.english], gd && [gd.mode, gd.g, gd.objPath?.length, gd.cuePath?.length, gd.cuePath?.at(-1)], st.ring, st.call, mode]);
      // (once the balls stop, one more frame at full resolution: the shot may have drawn at a lower one)
      const busy = st.animating || falling.length || moving || fxOn || shaking || streaks || lifting;
      if (k === key && !busy && sharp && !(st.callAll && st.call == null)) return;
      key = k; sharp = !busy;
      if (busy) renderer.render(scene, camera); else renderer.renderStill(scene, camera);
    }

    // screen point -> table units, on the plane through the balls' centres
    const ray = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 1, 0), -R), ndc = new T.Vector2();
    function pick(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      if (!r.width) return null;
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      camera.updateMatrixWorld();
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectPlane(plane, tmp) ? [tmp.x + W / 2, tmp.z + H / 2] : null;
    }

    function dispose() {
      scene.traverse((o) => { o.geometry?.dispose(); const m = o.material; if (m) { m.map?.dispose(); m.bumpMap?.dispose(); m.dispose(); } });
      env.dispose(); macro.dispose(); glow.dispose(); fade.dispose(); soft.dispose(); maple.dispose();
      renderer.dispose(); canvas.remove();
    }
    return { canvas, resize, render, pick, setMode, setZoom, setYaw, yaw: () => yaw, dispose, effect, mode: () => mode };
  }

  return { create };
})();
