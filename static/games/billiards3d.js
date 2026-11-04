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
  // tileable value noise: a random lattice of `cells` per side, smoothly interpolated
  function tileNoise(size, cells) {
    const lat = Array.from({ length: cells * cells }, Math.random), out = new Float32Array(size * size);
    const L = (i, j) => lat[((j + cells) % cells) * cells + ((i + cells) % cells)], s = (t) => t * t * (3 - 2 * t);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells, fy = (y / size) * cells, i = Math.floor(fx), j = Math.floor(fy), u = s(fx - i), v = s(fy - j);
        out[y * size + x] = (L(i, j) * (1 - u) + L(i + 1, j) * u) * (1 - v) + (L(i, j + 1) * (1 - u) + L(i + 1, j + 1) * u) * v;
      }
    }
    return out;
  }
  // woollen baize at 512px a tile: soft mottling, a fine twill weave, a lengthwise nap and loose fibres lying
  // on top. The colour map and the bump map share every fibre, so the light catches the ones you can see.
  function feltTextures(T, aniso) {
    const size = 512, grain = new Float32Array(size * size);
    for (let i = 0; i < grain.length; i++) grain[i] = Math.random();
    const at = (x, y) => grain[((y + size) % size) * size + ((x + size) % size)];
    const fuzz = (x, y) => (at(x, y) * 2 + at(x + 1, y) + at(x - 1, y) + at(x + 2, y) * 0.5 + at(x - 2, y) * 0.5 + at(x, y + 1) * 0.6 + at(x, y - 1) * 0.6) / 5.2;
    const mottle = tileNoise(size, 4), clump = tileNoise(size, 24);
    const weave = (x, y) => (((x + y) >> 1) % 2 ? 0.5 : -0.5) * (((x - y + size) >> 1) % 3 ? 0.6 : 1);  // a tight twill
    const level = (x, y) => {
      const i = y * size + x;
      return (fuzz(x, y) - 0.5) * 0.9 + (mottle[i] - 0.5) * 0.35 + (clump[i] - 0.5) * 0.4 + weave(x, y) * 0.16;
    };
    const [cc, cg] = noiseCanvas(size, (d, k, x, y) => {
      const v = level(x, y);
      d[k] = 17 + v * 13; d[k + 1] = 104 + v * 30; d[k + 2] = 58 + v * 16; d[k + 3] = 255;
    });
    const [bc, bg] = noiseCanvas(size, (d, k, x, y) => { const v = 128 + level(x, y) * 120; d[k] = d[k + 1] = d[k + 2] = v; d[k + 3] = 255; });
    // loose fibres: short curled strokes, mostly along the nap, light or dark, wrapped across the tile's edges
    for (let f = 0; f < 9000; f++) {
      const x0 = Math.random() * size, y0 = Math.random() * size, len = 3 + Math.random() * 9;
      const a = (Math.random() < 0.7 ? 0 : Math.PI / 2) + (Math.random() - 0.5) * 1.2, bend = (Math.random() - 0.5) * 0.6;
      const light = Math.random() < 0.55, alpha = 0.08 + Math.random() * 0.16, w = 0.5 + Math.random() * 0.6;
      const pts = [];
      for (let t = 0; t <= 4; t++) { const aa = a + bend * t; pts.push([x0 + Math.cos(aa) * len * t / 4, y0 + Math.sin(aa) * len * t / 4]); }
      for (const [g, col] of [[cg, light ? `rgba(120,200,140,${alpha})` : `rgba(4,40,18,${alpha})`], [bg, light ? `rgba(255,255,255,${alpha * 1.6})` : `rgba(0,0,0,${alpha * 1.4})`]]) {
        g.strokeStyle = col; g.lineWidth = w;
        for (const ox of [-size, 0, size]) {
          for (const oy of [-size, 0, size]) {
            if ((ox && Math.abs(x0 + ox - size / 2) > size / 2 + len) || (oy && Math.abs(y0 + oy - size / 2) > size / 2 + len)) continue;
            g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px + ox, py + oy) : g.moveTo(px + ox, py + oy))); g.stroke();
          }
        }
      }
    }
    return [cc, bc].map((c, i) => {
      const t = new T.CanvasTexture(c);
      t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = aniso;
      if (!i) t.encoding = T.sRGBEncoding;  // the colour map (the bump map is plain heights)
      return t;
    });
  }
  function woodTexture(T, aniso) {
    const c = Object.assign(document.createElement('canvas'), { width: 1024, height: 256 }), g = c.getContext('2d');
    const base = g.createLinearGradient(0, 0, 0, 256);
    base.addColorStop(0, '#6a3f1f'); base.addColorStop(0.5, '#7b4a25'); base.addColorStop(1, '#5e3519');
    g.fillStyle = base; g.fillRect(0, 0, 1024, 256);
    for (let i = 0; i < 140; i++) {  // grain lines that wander along the board
      const y0 = Math.random() * 256, amp = 2 + Math.random() * 6, f = 0.004 + Math.random() * 0.01, ph = Math.random() * 7;
      g.strokeStyle = `rgba(${Math.random() < 0.5 ? '40,20,8' : '150,95,50'}, ${0.08 + Math.random() * 0.22})`;
      g.lineWidth = 0.6 + Math.random() * 2.2;
      g.beginPath();
      for (let x = 0; x <= 1024; x += 8) g.lineTo(x, y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph) * amp * 0.3);
      g.stroke();
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
  // rails' reflections. Colours are given linear: this scene is rendered straight into the environment map.
  const LAMPS = [-0.33, 0, 0.33], LAMP_Y = 72;  // shades along the table's length (× its width), and their height
  function lampRoom(T, renderer, W) {
    const room = new T.Scene(), lin = (hex) => new T.Color(hex).convertSRGBToLinear();
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

  function dashTexture(T) {
    const c = Object.assign(document.createElement('canvas'), { width: 64, height: 8 }), g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 36, 8);
    const t = new T.CanvasTexture(c);
    t.wrapS = T.RepeatWrapping;
    return t;
  }

  function create(stage, b, hooks = {}) {
    const T = window.THREE;
    const renderer = GL3.renderer({ alpha: true }, { onLost: hooks.onLost });
    if (!renderer) return null;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    // sharper than the screen on a plain desktop display (GL3 still drops it if frames get slow)
    renderer.setPixelRatio(Math.min(2, Math.max(window.devicePixelRatio || 1, 1.5)));
    const canvas = renderer.domElement;
    const { W, H, R } = b;
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 1);
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
        lamp.castShadow = true; lamp.shadow.mapSize.set(1024, 1024);
        Object.assign(lamp.shadow.camera, { near: 40, far: 140 });
        lamp.shadow.bias = -0.0006;
      }
    });

    // the table, built in table units: shapes are drawn as (x, -y) and turned flat so they extrude upward
    const flat = (pts) => new T.Shape(pts.map(([x, y]) => new T.Vector2(x, -y)));
    const lay = (geo, mat, y = 0) => { const m = new T.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.y = y; table.add(m); return m; };
    const FELT = 12;  // table units per tile of the baize texture
    const [feltMap, feltBump] = feltTextures(T, aniso);
    feltMap.repeat.set(1 / FELT, 1 / FELT); feltBump.repeat.set(1 / FELT, 1 / FELT);
    const cloth = new T.MeshStandardMaterial({ map: feltMap, bumpMap: feltBump, bumpScale: 0.09, roughness: 0.93, metalness: 0 });
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
    const lipMat = new T.MeshStandardMaterial({ map: feltMap, bumpMap: feltBump, bumpScale: 0.05, color: 0xb8c4b8, roughness: 0.95, side: T.DoubleSide });
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
    const cushMat = new T.MeshStandardMaterial({ map: feltMap, bumpMap: feltBump, bumpScale: 0.05, color: 0xd6dcd6, roughness: 0.95 });
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
    const dGeo = new T.CircleGeometry(0.75, 4);  // a diamond: a four-sided circle
    for (const d of [0.25, 0.5, 0.75]) {
      for (const [x, y] of [[W * d / 2, -RAIL / 2 - 1], [W / 2 + W * d / 2, -RAIL / 2 - 1], [W * d / 2, H + RAIL / 2 + 1], [W / 2 + W * d / 2, H + RAIL / 2 + 1], [-RAIL / 2 - 1, H * d], [W + RAIL / 2 + 1, H * d]]) {
        const m = lay(dGeo, pearl, RAIL_TOP + 0.02); m.position.set(x, RAIL_TOP + 0.02, y); m.scale.set(0.8, 1.3, 1);
        if (x < 0 || x > W) m.rotation.z = Math.PI / 2;
      }
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
    const part = (r0, r1, len, at, color, rough = 0.5) => {
      const m = new T.Mesh(new T.CylinderGeometry(r0, r1, len, 32), new T.MeshStandardMaterial({ color, roughness: rough }));
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
    part(0.53, 0.95, 82, 2.77, 0xe8c88f, 0.4); part(0.95, 1.25, 56, 84.77, 0x2b1a10, 0.35); part(1.25, 1.25, 1.2, 140.77, 0x111111);
    tilt.rotation.z = -0.09;  // butt raised over the rails

    // aim guide: flat strips just above the cloth (a dashed texture for the aim line), a ghost ball, rings
    const strip = (color, opacity, dashed) => {
      const mat = new T.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, map: dashed ? dashTexture(T) : null });
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
      const mat = new T.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: T.DoubleSide, map: dashed ? dashTexture(T) : null });
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
    const ringMesh = (r0, r1, color) => {
      const m = new T.Mesh(new T.RingGeometry(r0, r1, 64), new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: T.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.renderOrder = 3; m.visible = false; table.add(m); return m;
    };
    const handRing = ringMesh(R * 1.9, R * 2.25, 0xffb703);
    const callRings = b.pockets.map(([x, y, cap]) => { const m = ringMesh(cap + 2.3, cap + 3.1, 0xffd166); m.position.set(x, RAIL_TOP + 0.6, y); return m; });

    // the colours above were picked as sRGB: light works in linear, so convert them once; the overlays (aim
    // guide, ghost ball, rings) skip tone mapping so they keep exactly the colours picked
    const overlays = new Set([ghost.material, handRing.material, objPath.material, cuePath.material, ...callRings.map((m) => m.material)]);
    scene.traverse((o) => {
      const m = o.material;
      if (!m || m.userData.lin) return;
      m.userData.lin = true;
      m.color?.convertSRGBToLinear();
      if (overlays.has(m) || (m.isMeshBasicMaterial && m.depthWrite === false && m !== blotMat)) m.toneMapped = false;
    });

    // ---------- camera
    const camNow = { pos: new T.Vector3(), look: new T.Vector3() }, camGoal = { pos: new T.Vector3(), look: new T.Vector3() };
    let size = [300, 150], portrait = false, mode = 'table', fitted = null, settle = 0;
    // overview: tilted over the table's near side, far enough back that every rail fits, then centred
    function fitTable() {
      const el = 1.1, dir = portrait ? new T.Vector3(-Math.cos(el), Math.sin(el), 0) : new T.Vector3(0, Math.sin(el), Math.cos(el));
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
      camera.setViewOffset(size[0], size[1], fitted.off[0], fitted.off[1], size[0], size[1]);
    }
    // behind the cue: at least ~56° across, so a tall phone screen still shows the balls either side of the aim
    function cueLens() {
      camera.clearViewOffset(); camera.aspect = size[0] / size[1];
      camera.fov = Math.min(80, Math.max(46, (2 * Math.atan(Math.tan((28 * Math.PI) / 180) / camera.aspect) * 180) / Math.PI));
      camera.updateProjectionMatrix();
    }
    function resize(w, h, port) {
      size = [Math.max(50, w), Math.max(50, h)]; portrait = port;
      renderer.setSize(size[0], size[1], false);
      if (mode === 'table') fitTable(); else cueLens();
      key = '';
    }
    function setMode(m) {
      mode = m; key = '';
      if (m === 'table') fitTable(); else { cueLens(); settle = 0; }
    }

    // ---------- each frame
    let key = '', last = 0;
    const tmp = new T.Vector3();
    function render(st) {
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
      // balls
      const seen = new Set();
      for (const [n, x, y] of st.balls) { const o = ball(n); o.m.visible = o.shadow.visible = true; o.falling = false; roll(o, x, y); seen.add(n); }
      for (const [n, o] of balls) {
        if (seen.has(n) || !o.m.visible || o.falling) continue;
        o.shadow.visible = false;
        if (st.animating && o.x != null) {  // gone mid-shot: it dropped into the nearest pocket
          const p = b.pockets.reduce((a, q) => (Math.hypot(q[0] - o.x, q[1] - o.y) < Math.hypot(a[0] - o.x, a[1] - o.y) ? q : a));
          falling.push({ o, from: [o.x, o.y], to: p, t0: now }); o.falling = true;
        } else o.m.visible = false;
        o.x = null;
      }
      for (let i = falling.length - 1; i >= 0; i--) {
        const f = falling[i], t = Math.min(1, (now - f.t0) / 380);
        if (!f.o.falling) { falling.splice(i, 1); continue; }  // back on the table (the 8 on the break)
        f.o.m.position.set(f.from[0] + (f.to[0] - f.from[0]) * Math.min(1, t * 1.6), R - t * t * 9, f.from[1] + (f.to[1] - f.from[1]) * Math.min(1, t * 1.6));
        if (t >= 1) { f.o.m.visible = false; f.o.falling = false; falling.splice(i, 1); }
      }
      // cue stick and guide
      const s = st.stick;
      stick.visible = !!s;
      if (s) {
        stick.position.set(s.x, R, s.y); stick.rotation.y = -s.aim;
        tilt.position.set(-(R + 0.6 + s.power * 14), s.spin * R * 0.55, s.english * R * 0.55);
      }
      const gd = st.guide;
      aimLine.visible = objLine.visible = cueLine.visible = objPath.visible = cuePath.visible = ghost.visible = false;
      if (gd && gd.mode !== 'off') {
        const [cx, cy] = gd.cue, [gx, gy] = gd.g, full = gd.mode === 'full', L = Math.hypot(gx - cx, gy - cy) || 1;
        const light = gd.mode === 'light';  // #50: the ghost ball and a short hint of the object ball's line
        const k = full || light ? 1 : Math.min(1, 26 / L);
        aimLine.set(cx + ((gx - cx) / L) * R, cy + ((gy - cy) / L) * R, cx + (gx - cx) * k, cy + (gy - cy) * k, 0.45);
        if (light) {
          ghost.visible = true; ghost.position.set(gx, R, gy);
          ghost.material.color.set(0xffffff).convertSRGBToLinear(); ghost.material.opacity = 0.18;
          if (gd.ball) {
            const [bx, by] = gd.ball, nx = bx - gx, ny = by - gy, n = Math.hypot(nx, ny) || 1;
            objLine.set(bx, by, bx + (nx / n) * 9, by + (ny / n) * 9, 0.4);
          }
        } else if (full) {
          ghost.visible = true; ghost.position.set(gx, R, gy);
          // red: the cue ball would drop; fainter: it runs out of pace and stops here
          ghost.material.color.set(gd.scratch ? 0xef476f : 0xffffff).convertSRGBToLinear(); ghost.material.opacity = gd.stop ? 0.12 : 0.22;
          if (gd.objPath || gd.cuePath) {  // the engine's own prediction: the paths really taken
            if (gd.objPath) objPath.set(gd.objPath, 0.5);
            if (gd.cuePath) cuePath.set(gd.cuePath, 0.4);
          } else if (gd.ball) {
            const [bx, by] = gd.ball, nx = bx - gx, ny = by - gy, n = Math.hypot(nx, ny) || 1;
            objLine.set(bx, by, bx + (nx / n) * 28, by + (ny / n) * 28, 0.5);
          }
          if (gd.deflect) cueLine.set(gx, gy, gx + gd.deflect[0], gy + gd.deflect[1], 0.4);
        }
      }
      handRing.visible = !!st.ring;
      if (st.ring) { handRing.position.set(st.ring.x, 0.1, st.ring.y); handRing.material.color.set(st.ring.ok ? 0xffb703 : 0xef476f); }
      const pulse = 0.45 + 0.35 * Math.sin(now / 250);
      callRings.forEach((m, i) => { m.visible = st.call === i || (st.callAll && st.call == null); m.material.opacity = st.call === i ? 0.95 : pulse; });
      // camera: the overview stays put; behind-the-cue eases after the aim
      let moving = false;
      if (mode === 'cue' && st.cam) {
        const { x, y, aim } = st.cam, dx = Math.cos(aim), dy = Math.sin(aim);
        camGoal.pos.set(x - dx * 46 - W / 2, 21, y - dy * 46 - H / 2);
        camGoal.look.set(x + dx * 22 - W / 2, 0, y + dy * 22 - H / 2);
        const a = settle++ === 0 ? 1 : 1 - Math.exp(-dt * 9);
        camNow.pos.lerp(camGoal.pos, a); camNow.look.lerp(camGoal.look, a);
        camera.position.copy(camNow.pos); camera.lookAt(camNow.look);
        moving = camNow.pos.distanceToSquared(camGoal.pos) > 0.0004 || camNow.look.distanceToSquared(camGoal.look) > 0.0004;
      } else if (mode === 'table' && fitted) camera.position.copy(fitted.pos), camera.lookAt(0, 0, 0);
      // draw only when something changed
      const k = JSON.stringify([st.balls, s && [s.x, s.y, s.aim, s.power, s.spin, s.english], gd && [gd.mode, gd.g, gd.objPath?.length, gd.cuePath?.length, gd.cuePath?.at(-1)], st.ring, st.call, mode]);
      if (k === key && !st.animating && !falling.length && !moving && !(st.callAll && st.call == null)) return;
      key = k;
      renderer.render(scene, camera);
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
      env.dispose();
      renderer.dispose(); canvas.remove();
    }
    return { canvas, resize, render, pick, setMode, dispose, mode: () => mode };
  }

  return { create };
})();
