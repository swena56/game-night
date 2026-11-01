// 3D chessboard for UI.chess, drawn with three.js. It mirrors the 2D board (which stays the source of
// truth for selection, targets and promotion): sync() copies the 2D squares' highlight classes onto
// 3D tiles, and taps are mapped back to the same square index. Drag sideways to turn the board.
const Chess3D = (() => {
  const LIGHT = 0xf0d9b5, DARK = 0xb58863;
  const MARK = { sel: 0x2b8a3e, check: 0xef476f, last: 0xffe066, capture: 0xe8590c };

  function create(stage, onSquare, onLost) {
    const T = window.THREE;
    const renderer = GL3.renderer({ alpha: true }, { onLost });
    if (!renderer) return null;
    renderer.shadowMap.enabled = true;
    stage.append(renderer.domElement);

    const scene = new T.Scene(), camera = new T.PerspectiveCamera(36, 1, 0.1, 100);
    scene.add(new T.HemisphereLight(0xfff4e0, 0x302040, 0.75));
    const sun = new T.DirectionalLight(0xffffff, 0.8);
    sun.position.set(-4, 10, 6); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
    scene.add(sun);

    // board: frame + 64 tiles (tile index = 2D board's display index: row 0 is the far side)
    const frame = new T.Mesh(new T.BoxGeometry(9, 0.4, 9), new T.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 0.6 }));
    frame.position.y = -0.21; frame.receiveShadow = true; scene.add(frame);
    const tileGeo = new T.BoxGeometry(1, 0.06, 1), tiles = [];
    for (let i = 0; i < 64; i++) {
      const r = Math.floor(i / 8), c = i % 8;
      const tile = new T.Mesh(tileGeo, new T.MeshStandardMaterial({ color: (r + c) % 2 ? DARK : LIGHT, roughness: 0.7 }));
      tile.position.set(c - 3.5, -0.03, r - 3.5); tile.receiveShadow = true; tile.userData.i = i;
      scene.add(tile); tiles.push(tile);
    }
    const dotGeo = new T.CylinderGeometry(0.14, 0.14, 0.02, 24), dotMat = new T.MeshBasicMaterial({ color: MARK.sel, transparent: true, opacity: 0.75 });
    const dots = tiles.map((t) => { const d = new T.Mesh(dotGeo, dotMat); d.position.set(t.position.x, 0.01, t.position.z); d.visible = false; scene.add(d); return d; });

    // pieces: shared geometry per kind, two materials
    const mats = {
      w: new T.MeshStandardMaterial({ color: 0xf7efe0, roughness: 0.35, metalness: 0.05 }),
      b: new T.MeshStandardMaterial({ color: 0x24201c, roughness: 0.3, metalness: 0.2 }),
    };
    const kinds = buildKinds(T);
    const pieces = new T.Group(); scene.add(pieces);

    let yaw = 0, raf = 0, anim = null, dirty = true;
    function place() {
      const dist = 13.5, pitch = 0.95;
      camera.position.set(Math.sin(yaw) * dist * Math.cos(pitch), dist * Math.sin(pitch), Math.cos(yaw) * dist * Math.cos(pitch));
      camera.lookAt(Math.sin(yaw) * 0.5, -0.4, Math.cos(yaw) * 0.5);
    }
    function resize() {
      const w = stage.clientWidth || 300, h = stage.clientHeight || 300;
      renderer.setSize(w, h, false); camera.aspect = w / h;
      // the board's near edge needs ~49° across, so narrow stages get a taller field of view
      camera.fov = Math.max(38, (2 * Math.atan(Math.tan((24.5 * Math.PI) / 180) / camera.aspect) * 180) / Math.PI);
      camera.updateProjectionMatrix(); dirty = true; kick();
    }
    function frameLoop(now) {
      raf = 0;
      if (anim) {
        const t = Math.min(1, (now - anim.start) / anim.dur), e = 1 - (1 - t) ** 3;
        anim.mesh.position.set(anim.from.x + (anim.to.x - anim.from.x) * e, anim.lift * Math.sin(Math.PI * t), anim.from.z + (anim.to.z - anim.from.z) * e);
        if (t >= 1) anim = null;
        dirty = true;
      }
      if (dirty) { place(); renderer.render(scene, camera); dirty = false; }
      if (anim) kick();
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(frameLoop); };

    // input: tap picks a square, sideways drag turns the board
    const ray = new T.Raycaster(), ptr = new T.Vector2();
    let down = null;
    const el = renderer.domElement;
    el.style.touchAction = 'pan-y';
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, yaw, moved: false }; });
    el.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - down.x;
      if (Math.abs(dx) > 8) down.moved = true;
      if (down.moved) { yaw = Math.max(-1.1, Math.min(1.1, down.yaw - dx / 180)); dirty = true; kick(); }
    });
    el.addEventListener('pointerup', (e) => {
      const d = down; down = null;
      if (!d || d.moved) return;
      const rect = el.getBoundingClientRect();
      ptr.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      const hit = ray.intersectObjects([...tiles, ...pieces.children], true)[0];
      let o = hit?.object;
      while (o && o.userData.i == null) o = o.parent;
      if (o) onSquare(o.userData.i);
    });
    el.addEventListener('pointerleave', () => { down = null; });
    el.addEventListener('dblclick', () => { yaw = 0; dirty = true; kick(); });
    const ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    ro?.observe(stage);
    resize();

    /** pieces: [{i, color, kind}], squares: the 2D board's square elements, slide: {from, to} display indices or null */
    function sync(list, squares, bottom, slide) {
      pieces.clear();
      for (const p of list) {
        const g = new T.Group();
        for (const geo of kinds[p.kind]) {
          const m = new T.Mesh(geo, mats[p.color]); m.castShadow = true; g.add(m);
        }
        if (p.kind === 'N' && p.color !== bottom) g.rotation.y = Math.PI;  // knights face the enemy
        const t = tiles[p.i].position;
        g.position.set(t.x, 0, t.z); g.userData.i = p.i;
        pieces.add(g);
        if (slide && slide.to === p.i) {
          const f = tiles[slide.from].position;
          anim = { mesh: g, from: { x: f.x, z: f.z }, to: { x: t.x, z: t.z }, lift: p.kind === 'N' ? 0.9 : 0.25, start: performance.now(), dur: 380 };
          g.position.set(f.x, 0, f.z);
        }
      }
      squares.forEach((sq, i) => {
        const cl = sq.classList, base = (Math.floor(i / 8) + (i % 8)) % 2 ? DARK : LIGHT;
        const mark = cl.contains('check') ? MARK.check : cl.contains('sel') ? MARK.sel : cl.contains('capture') ? MARK.capture : cl.contains('last') ? MARK.last : null;
        const mat = tiles[i].material;
        mat.color.setHex(base);
        if (mark != null) mat.color.lerp(new T.Color(mark), cl.contains('last') && !cl.contains('sel') ? 0.45 : 0.7);
        dots[i].visible = cl.contains('target');
      });
      dirty = true; kick();
    }

    function dispose() {
      cancelAnimationFrame(raf); ro?.disconnect();
      renderer.dispose(); el.remove();
    }
    return { sync, dispose };
  }

  // Lathe profiles (radius, height) for each piece, plus a few extra parts.
  function buildKinds(T) {
    const lathe = (pts) => new T.LatheGeometry(pts.map(([x, y]) => new T.Vector2(x, y)), 40);
    const at = (geo, x, y, z) => { geo.translate(x, y, z); return geo; };
    const base = (r) => [[0, 0], [r, 0], [r, 0.06], [r - 0.06, 0.1], [r - 0.11, 0.15]];
    const kinds = {
      P: [lathe([...base(0.3), [0.12, 0.3], [0.1, 0.36], [0.17, 0.38], [0.17, 0.41], [0, 0.42]]), at(new T.SphereGeometry(0.13, 24, 16), 0, 0.52, 0)],
      R: [lathe([...base(0.32), [0.19, 0.5], [0.25, 0.53], [0.25, 0.7], [0.15, 0.7], [0.15, 0.64], [0, 0.64]])],
      B: [lathe([...base(0.3), [0.11, 0.5], [0.18, 0.53], [0.18, 0.56], [0, 0.58]]),
        at(new T.SphereGeometry(0.14, 24, 16).scale(1, 1.45, 1), 0, 0.74, 0), at(new T.SphereGeometry(0.045, 12, 8), 0, 0.97, 0)],
      Q: [lathe([...base(0.33), [0.12, 0.6], [0.2, 0.64], [0.2, 0.67], [0.13, 0.7], [0.21, 0.86], [0, 0.84]]),
        at(new T.SphereGeometry(0.075, 16, 12), 0, 0.92, 0)],
      K: [lathe([...base(0.34), [0.13, 0.65], [0.21, 0.69], [0.21, 0.72], [0.14, 0.75], [0.19, 0.9], [0, 0.9]]),
        at(new T.BoxGeometry(0.07, 0.26, 0.07), 0, 1.03, 0), at(new T.BoxGeometry(0.19, 0.07, 0.07), 0, 1.06, 0)],
      N: [lathe([...base(0.31), [0.18, 0.2], [0, 0.21]])],
    };
    for (let k = 0; k < 4; k++) {  // rook battlements
      const a = (k * Math.PI) / 2 + Math.PI / 4;
      kinds.R.push(at(new T.BoxGeometry(0.1, 0.09, 0.1), Math.cos(a) * 0.2, 0.745, Math.sin(a) * 0.2));
    }
    for (let k = 0; k < 8; k++) {  // queen crown
      const a = (k * Math.PI) / 4;
      kinds.Q.push(at(new T.SphereGeometry(0.035, 10, 8), Math.cos(a) * 0.2, 0.87, Math.sin(a) * 0.2));
    }
    // knight head: a horse profile extruded sideways, nose pointing to -z (away from its owner)
    const s = new T.Shape();
    [[-0.2, 0.18], [0.14, 0.18], [0.1, 0.4], [0.27, 0.52], [0.3, 0.63], [0.12, 0.8], [-0.02, 0.86], [-0.05, 0.95],
      [-0.11, 0.85], [-0.2, 0.72], [-0.23, 0.45]].forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
    const head = new T.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
    head.translate(0, 0, -0.08); head.rotateY(Math.PI / 2);
    kinds.N.push(head);
    return kinds;
  }

  return { create };
})();
