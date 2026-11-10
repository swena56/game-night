// Shared three.js helpers for the 3D games (Putt Party, Hover Rally, Light Riders, Sumo Saucers,
// Spire Siege, Lucky Letters, Chess 3D, Billiards 3D).
//  - GL3.load(): loads /vendor/three.min.js once (every game used to add its own <script> tag), and turns on
//      colour management: a colour a game writes (0xef476f, '#fff', 'red') is sRGB, as on screen; it is stored
//      linear so lights and tone mapping work in real light, and read back (getHex, getHexString) as written.
//      This is what newer three.js versions do by default; r128 renders raw values unless told otherwise.
//  - GL3.renderer(opts, hooks): a WebGLRenderer, or null when WebGL is missing, with
//      * adaptive resolution: the pixel ratio drops a step when frames get slow (phones, big screens)
//        and creeps back up when they're smooth again, so the game keeps its frame rate;
//        hooks.cap / hooks.min override the top and bottom of that range, and r.renderStill(scene, camera)
//        draws one frame at the top of it (not timed): for on-demand games, so the view you look at
//        between moves is always sharp even when motion runs at a lower resolution;
//      * context-loss recovery: phones throw the GPU context away when you switch apps; hooks.onLost()
//        lets the game build a new renderer instead of showing a frozen or black view;
//      * on 🎨 Graphics: Low (gfxLevel in app.js) no antialiasing and a pixel ratio of 1.
//  - GL3.stage(renderer, scene, opts): one call for the look every 3D game shares: sRGB output, ACES filmic tone
//      mapping, a hemisphere light and a key light (with soft shadows unless Low), a room environment so metal
//      and glossy materials have something to reflect (skipped on Low), and optionally a sky dome with stars.
//  - GL3.strained(): true once a renderer had to sit at its lowest resolution for a while: Auto graphics go Low.
//  - GL3.shake(camera, amount): a short camera shake for hits; GL3.tickShake(camera, dt) each frame.
(function () {
  let loading = null;
  function load() {
    if (window.THREE) { manageColors(window.THREE); return Promise.resolve(window.THREE); }
    loading ||= new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = '/vendor/three.min.js';
      sc.onload = () => { manageColors(window.THREE); res(window.THREE); };
      sc.onerror = () => { loading = null; rej(new Error('three.js failed to load')); };
      document.head.append(sc);
    });
    return loading;
  }

  // Colour management for r128: every way a colour is written from a number or a CSS string converts it from
  // sRGB to linear, and the readbacks convert back. setStyle('#rrggbb') parses on its own but setStyle('red')
  // goes through setHex, so a flag stops that path converting twice. setRGB / setHSL / lerp stay raw (linear).
  function manageColors(T) {
    const P = T?.Color?.prototype;
    if (!P || P.managed) return;
    const setHex = P.setHex, setStyle = P.setStyle, getHex = P.getHex, getStyle = P.getStyle;
    let inStyle = false;
    P.setHex = function (h) { setHex.call(this, h); return inStyle ? this : this.convertSRGBToLinear(); };
    P.setStyle = function (s) { inStyle = true; try { setStyle.call(this, s); } finally { inStyle = false; } return this.convertSRGBToLinear(); };
    P.getHex = function () { return getHex.call(this.clone().convertLinearToSRGB()); };
    P.getStyle = function () { return getStyle.call(this.clone().convertLinearToSRGB()); };
    P.managed = true;
    // canvas textures are painted with CSS colours, so they are sRGB too (bump and roughness maps are read raw anyway)
    const CT = T.CanvasTexture;
    T.CanvasTexture = class extends CT { constructor(...a) { super(...a); this.encoding = T.sRGBEncoding; } };
  }

  const level = () => (window.gfxLevel?.() === 'low' ? 'low' : 'high');
  const CAP = Math.min(window.devicePixelRatio || 1, 2);
  let strain = 0;
  try { if (sessionStorage.getItem('gn.strain') === '1') strain = 3; } catch {}
  const strained = () => strain >= 3;
  function renderer(opts = {}, hooks = {}) {
    const T = window.THREE;
    if (!T) return null;
    const low = level() === 'low';
    let r;
    try { r = new T.WebGLRenderer({ antialias: !low, powerPreference: 'high-performance', ...opts }); } catch { return null; }
    if (!r.getContext()) { r.dispose(); return null; }
    const cap = low ? Math.min(1, hooks.cap ?? CAP) : (hooks.cap ?? CAP), min = Math.min(cap, hooks.min ?? Math.min(1, cap) * 0.6);
    let pr = cap, shown = pr;
    r.setPixelRatio(pr);
    const use = (p) => { if (p !== shown) { shown = p; r.setPixelRatio(p); } };
    // adaptive resolution: watch the time between renders (ignore pauses: on-demand games, hidden tabs)
    let last = 0, sum = 0, n = 0, smooth = 0;
    const render = r.render.bind(r);
    r.render = (scene, camera) => {
      const now = performance.now(), dt = now - last; last = now;
      if (dt > 0 && dt < 120) { sum += dt; n++; }
      if (n >= 90) {
        const avg = sum / n; sum = 0; n = 0;
        if (avg > 24) {
          if (pr > min) { pr = Math.max(min, pr - 0.25); smooth = 0; }
          else if (!low && ++strain === 3) { try { sessionStorage.setItem('gn.strain', '1'); } catch {} }
        } else if (avg < 17 && pr < cap && ++smooth >= 4) { pr = Math.min(cap, pr + 0.25); smooth = 0; }
      }
      use(pr);
      return render(scene, camera);
    };
    r.renderStill = (scene, camera) => { last = 0; use(cap); return render(scene, camera); };
    r.quality = () => shown;
    const canvas = r.domElement;
    const lost = (e) => {
      e.preventDefault();
      // let the game rebuild with a fresh renderer once the old one is gone
      setTimeout(() => hooks.onLost?.(), 50);
    };
    canvas.addEventListener('webglcontextlost', lost);
    const dispose = r.dispose.bind(r);
    r.dispose = () => { canvas.removeEventListener('webglcontextlost', lost); dispose(); };
    return r;
  }

  // A dim room with a bright ceiling panel, baked into an environment map: what glossy and metal surfaces
  // reflect. Nothing of it is drawn directly.
  function roomEnv(T, renderer, o = {}) {
    const room = new T.Scene();
    room.add(new T.Mesh(new T.BoxGeometry(60, 30, 60), new T.MeshBasicMaterial({ color: o.walls ?? 0x1a1626, side: T.BackSide })));
    const panel = new T.Mesh(new T.PlaneGeometry(22, 14), new T.MeshBasicMaterial({ color: new T.Color(o.lamp ?? 0xfff4e6).multiplyScalar(o.glow ?? 2.4), side: T.DoubleSide }));
    panel.rotation.x = Math.PI / 2; panel.position.y = 14.5; room.add(panel);
    const strip = new T.Mesh(new T.PlaneGeometry(40, 3), new T.MeshBasicMaterial({ color: o.accent ?? 0x6b4bd6, side: T.DoubleSide }));
    strip.position.set(0, 4, -29.5); room.add(strip);
    const floor = new T.Mesh(new T.PlaneGeometry(60, 60), new T.MeshBasicMaterial({ color: o.floor ?? 0x2a2340, side: T.DoubleSide }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -14.5; room.add(floor);
    const pm = new T.PMREMGenerator(renderer);
    const env = pm.fromScene(room, 0.04).texture;
    pm.dispose();
    room.traverse((m) => { m.geometry?.dispose(); m.material?.dispose(); });
    return env;
  }

  // A sky that rides along with the camera: a dome shaded bottom → horizon → top by height, and stars.
  // Fog leaves it alone. Put the fog colour in `bottom` so the ground fades into the sky without a seam.
  function sky(T, o = {}) {
    const g = new T.Group(), R = o.radius ?? 280;
    const dome = new T.SphereGeometry(R, 24, 16), cols = [], c = new T.Color();
    const lo = new T.Color(o.bottom ?? 0x070512), mid = new T.Color(o.horizon ?? 0x2a1450), top = new T.Color(o.top ?? 0x020108);
    const band = o.band ?? 0.15, pa = dome.attributes.position;
    for (let k = 0; k < pa.count; k++) {
      const y = pa.getY(k) / R;  // -1 .. 1
      if (y < 0) c.copy(lo); else if (y < band) c.copy(lo).lerp(mid, y / band); else c.copy(mid).lerp(top, Math.min(1, (y - band) / 0.5));
      cols.push(c.r, c.g, c.b);
    }
    dome.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    g.add(new T.Mesh(dome, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, fog: false, depthWrite: false })));
    if (o.stars) {
      const pts = [];
      for (let k = 0; k < o.stars; k++) {
        const a = Math.random() * Math.PI * 2, y = 0.06 + Math.random() * 0.94, rr = Math.sqrt(1 - y * y);
        pts.push(Math.cos(a) * rr * R * 0.95, y * R * 0.95, Math.sin(a) * rr * R * 0.95);
      }
      const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
      g.add(new T.Points(sg, new T.PointsMaterial({ size: 1.6, sizeAttenuation: false, color: o.star ?? 0xdfe6ff, fog: false, transparent: true, opacity: 0.85, depthWrite: false })));
    }
    g.renderOrder = -1;
    g.traverse((m) => { m.frustumCulled = false; });
    return g;
  }

  // opts: exposure (ACES; 'none' keeps the game's own look), hemi [sky, ground, intensity] | false,
  //       key { color, i, pos, shadow, area, near, far, map } | false, env 'room' | {…} | false,
  //       sky {top, horizon, bottom, stars, radius} | null, fog [colour, near, far] | false,
  //       still: true for on-demand games (shadows are redrawn only when st.relight() is called),
  //       level: 'high' | 'low' (defaults to the 🎨 Graphics setting)
  function stage(renderer, scene, o = {}) {
    const T = window.THREE, lv = o.level || level(), low = lv === 'low';
    const st = { level: lv, low, hemi: null, key: null, sky: null, env: null };
    renderer.outputEncoding = T.sRGBEncoding;
    if (o.exposure !== 'none') { renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = o.exposure ?? 1.1; }
    // r128 clears to a Color's raw numbers (no encoding), so a background colour goes back to its sRGB values
    if (o.sky) {
      if (scene.background?.isColor) scene.background = null;
      st.sky = sky(T, o.sky); scene.add(st.sky);
    } else if (scene.background?.isColor) scene.background.convertLinearToSRGB();
    if (o.fog) scene.fog = new T.Fog(o.fog[0], o.fog[1], o.fog[2]);
    if (o.hemi !== false) {
      const [s, g, i] = o.hemi || [0xbfd9ff, 0x221133, 0.75];
      st.hemi = new T.HemisphereLight(s, g, i); scene.add(st.hemi);
    }
    if (o.key !== false) {
      const k = { color: 0xffffff, i: 0.8, pos: [-8, 20, 10], shadow: true, area: 24, near: 1, far: 80, map: 1024, ...(o.key || {}) };
      const L = new T.DirectionalLight(k.color, k.i); L.position.set(...k.pos);
      const shadow = k.shadow && !low;
      renderer.shadowMap.enabled = shadow; renderer.shadowMap.type = T.PCFSoftShadowMap;
      if (shadow) {
        L.castShadow = true; L.shadow.mapSize.set(k.map, k.map);
        Object.assign(L.shadow.camera, { left: -k.area, right: k.area, top: k.area, bottom: -k.area, near: k.near, far: k.far });
        L.shadow.bias = -0.0005; L.shadow.normalBias = 0.02;
        if (o.still) renderer.shadowMap.autoUpdate = false;
      }
      scene.add(L, L.target); st.key = L;
    }
    if (o.env !== false && !low) { st.env = roomEnv(T, renderer, o.env === 'room' || !o.env ? {} : o.env); scene.environment = st.env; }
    st.follow = (camera) => { st.sky?.position.copy(camera.position); };
    st.relight = () => { renderer.shadowMap.needsUpdate = true; };
    st.dispose = () => {
      st.sky?.traverse((m) => { m.geometry?.dispose(); m.material?.dispose(); });
      if (st.sky) scene.remove(st.sky);
      if (st.env) { st.env.dispose(); if (scene.environment === st.env) scene.environment = null; }
      st.sky = st.env = null;
    };
    return st;
  }

  // camera shake: an offset that decays, applied on top of wherever the game put the camera
  function shake(camera, amount = 0.3) {
    if (window.motionOK ? !motionOK() : document.body.classList.contains('calm')) return;
    camera.userData.shake = Math.max(camera.userData.shake || 0, amount);
  }
  function tickShake(camera, dt) {
    const s = camera.userData.shake;
    if (!s) return;
    const k = s * s;
    camera.position.x += (Math.random() - 0.5) * k;
    camera.position.y += (Math.random() - 0.5) * k;
    camera.position.z += (Math.random() - 0.5) * k;
    camera.userData.shake = s > 0.02 ? s * Math.exp(-dt * 7) : 0;
  }

  window.GL3 = { load, renderer, stage, sky, roomEnv, strained, shake, tickShake, level };
})();
