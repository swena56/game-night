(() => {
  const [X, Y, VX, VY, Z, LEFT, RIGHT, SCORE, BALLS, BANK, NUDGES, TILT, STAGED, CHARGE, EVENT_ID, EVENT, SPIN] =
    Array.from({ length: 17 }, (_, i) => i);
  const keys = {
    KeyA: 1, ArrowLeft: 1, KeyD: 2, ArrowRight: 2, Space: 4,
    KeyQ: -1, KeyW: -2, KeyE: -3,
  };
  const messages = {
    skill: 'Skill shot +5,000', spinner: 'Spinner +100', ramp: 'Ramp jackpot +6,000',
    tilt: 'TILT · scoring suspended', nudge: 'Table nudged',
    drain: 'Ball drained', done: 'Run complete', recovery: 'Ball freed',
  };
  const prefixes = { bumper: 'Bumper +100', sling: 'Slingshot +50', lane: 'Rollover +500', target: 'Target +250' };
  const label = (event) => messages[event] || prefixes[event?.replace(/[0-9]$/, '')] || '';
  const bestKey = 'pinball.best';
  const palette = { gold: '#ffd383', ivory: '#fff0ca', teal: '#59edd2', red: '#f46044', steel: '#b2bcc0' };
  const rampPoints = ({ ramp, exit }) => Array.from({ length: 33 }, (_, i) => {
    const t = i / 32, arch = Math.sin(t * Math.PI);
    return [ramp[0] + (exit[0] - ramp[0]) * t, ramp[1] + (exit[1] - ramp[1]) * t - 4.8 * arch, 1.6 * arch];
  });

  function makeArt(geo) {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 1020;
    const c = canvas.getContext('2d');
    c.scale(60, 60);
    const grain = c.createLinearGradient(0, 0, 10, 17);
    grain.addColorStop(0, '#7c301b');
    grain.addColorStop(.48, '#b7652e');
    grain.addColorStop(1, '#532017');
    c.fillStyle = grain;
    c.fillRect(0, 0, 10, 17);
    for (let i = 0; i < 400; i++) {
      const x = (i * 0.28391) % 10;
      c.strokeStyle = i % 3 === 0 ? '#ffd69328' : '#39130934';
      c.lineWidth = 0.01 + (i % 5) * 0.004;
      c.beginPath();
      c.moveTo(x, 0);
      c.bezierCurveTo(x - .25, 4, x + .3, 10, x - .1, 17);
      c.stroke();
    }
    c.fillStyle = '#281a17';
    c.fillRect(8.83, 2.85, 1.17, 13.4);
    c.fillRect(0, 16.4, 8.8, .6);
    c.save();
    c.translate(4.9, 10.15);
    c.strokeStyle = '#ffe0a583';
    c.lineWidth = .025;
    for (let i = 0; i < 28; i++) {
      const theta = i * Math.PI / 14;
      c.beginPath();
      c.moveTo(1.95 * Math.cos(theta), 1.55 * Math.sin(theta));
      c.lineTo(4.45 * Math.cos(theta), 3.9 * Math.sin(theta));
      c.stroke();
    }
    c.scale(1.2, 1);
    c.fillStyle = '#392322';
    c.strokeStyle = palette.gold;
    c.lineWidth = .04;
    c.beginPath();
    c.ellipse(0, 0, 1.75, 1.05, 0, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.fillStyle = palette.ivory;
    c.textAlign = 'center';
    c.scale(.01, .01);
    c.font = 'bold 55px Georgia';
    c.fillText('Golden Hour', 0, -3);
    c.fillStyle = palette.gold;
    c.font = 'bold 24px sans-serif';
    c.fillText('P I N B A L L', 0, 48);
    c.restore();

    c.fillStyle = palette.ivory;
    c.textAlign = 'center';
    c.scale(.01, .01);
    c.font = 'bold 25px sans-serif';
    c.fillText('S K I L L   S H O T', 425, 268);
    c.fillText('RAMP', geo.ramp[0] * 100, (geo.ramp[1] + .64) * 100);
    c.fillText('D R A I N', 500, 1681);
    c.translate(940, 1100);
    c.rotate(-Math.PI / 2);
    c.fillText('L A U N C H', 0, 9);
    return canvas;
  }

  function flatRenderer(stage, geo, art) {
    const canvas = document.createElement('canvas');
    canvas.className = 'pb-flat';
    const c = canvas.getContext('2d');
    if (!c) return null;
    stage.prepend(canvas);
    const track = rampPoints(geo);
    const line = (points, width, color) => {
      c.beginPath();
      points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
      c.lineWidth = width;
      c.strokeStyle = color;
      c.stroke();
    };
    const disc = (x, y, radius, color) => {
      c.beginPath();
      c.arc(x, y, radius, 0, 2 * Math.PI);
      c.fillStyle = color;
      c.fill();
    };
    const rail = ([ax, ay, bx, by], color, width) => line([[ax, ay], [bx, by]], width, color);
    return {
      draw(row, ball, flash) {
        const width = Math.round(stage.clientWidth * Math.min(2, window.devicePixelRatio || 1));
        const height = Math.round(stage.clientHeight * Math.min(2, window.devicePixelRatio || 1));
        if (!width || !height) return;
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        c.setTransform(width / 11, 0, 0, height / 18.7, width / 22, height * .85 / 18.7);
        c.clearRect(-.5, -.85, 11, 18.7);
        c.fillStyle = '#382019';
        c.fillRect(-.46, -.78, 10.92, 18.56);
        c.drawImage(art, 0, 0, geo.width, geo.height);
        c.lineCap = 'round';
        geo.rails.forEach((r) => { rail(r, '#37271f', .28); rail(r, palette.steel, .13); });
        geo.slings.forEach((r, i) => rail(r, flash === 'sling' + i ? palette.ivory : palette.red, .24));
        geo.targets.forEach((r, i) => rail(r, flash === 'target' + i ? palette.ivory : row[BANK] & (1 << i) ? '#513330' : palette.red, .28));
        geo.bumps.forEach(([x, y, radius], i) => {
          disc(x, y, radius, '#512922');
          disc(x, y - .035, radius - .08, flash === 'bumper' + i ? palette.ivory : palette.gold);
          disc(x, y - .07, radius - .24, '#a83d28');
          disc(x, y - .12, .18, palette.ivory);
        });
        geo.lanes.forEach(([x, y], i) => {
          disc(x, y, .26, '#492d25');
          disc(x, y, .2, flash === 'lane' + i || flash === 'skill' ? palette.ivory : palette.teal);
        });
        line(track, .4, '#372f2c');
        line(track, .09, row[BANK] === 7 ? palette.teal : palette.steel);
        disc(...geo.ramp, .21, row[BANK] === 7 ? palette.teal : '#54362d');
        const [sx, sy] = geo.spinner;
        rail([sx - .47, sy, sx + .47, sy], flash === 'spinner' ? palette.ivory : palette.steel,
          .08 + .19 * Math.abs(Math.cos(row[SPIN] * 2 * Math.PI)));
        geo.flips.forEach(([x, y], i) => {
          const angle = ball[3 + i];
          rail([x, y, x + geo.length * Math.cos(angle), y + geo.length * Math.sin(angle)], '#652a24', .29);
          rail([x, y, x + geo.length * Math.cos(angle), y + geo.length * Math.sin(angle)], palette.ivory, .17);
          disc(x, y, .18, palette.gold);
        });
        if (row[BALLS]) {
          const [x, y, z] = ball;
          disc(x + .1, y + .1, geo.radius * 1.25, '#26141483');
          disc(x, y - z * .14, geo.radius, palette.steel);
          disc(x - .055, y - z * .14 - .055, geo.radius * .5, '#fff');
        }
      },
      dispose: () => canvas.remove(),
    };
  }

  function threeRenderer(T, stage, geo, art, onLost) {
    const renderer = GL3.renderer({ alpha: false }, { onLost, cap: GL3.level() === 'low' ? 1 : undefined });
    if (!renderer) return null;
    const scene = new T.Scene();
    scene.background = new T.Color('#261917');
    const lighting = GL3.stage(renderer, scene, {
      exposure: .89, hemi: [0xffebcc, 0xa44d32, .68],
      key: { color: 0xffe0b8, i: 1.15, pos: [-4, 14, 2], area: 11 },
      env: { walls: 0x2c211d, lamp: 0xffe7c8, accent: 0x805337 },
    });
    // Keep the shadow volume centered on the whole playfield.
    lighting.key.position.add(new T.Vector3(5, 0, 8.5));
    lighting.key.target.position.set(5, 0, 8.5);
    const camera = new T.OrthographicCamera(-5.5, 5.5, 9.35, -9.35, .1, 80);
    camera.position.set(5, 23, 12.3);
    camera.lookAt(5, 0, 8.5);

    const material = (color, metalness = .05, roughness = .48) =>
      new T.MeshStandardMaterial({ color, metalness, roughness });
    const chrome = material(palette.steel, lighting.low ? .28 : .72, .29);
    const brass = material(palette.gold, .38, .32);
    const dark = material('#482d22');
    const red = material('#ba402b');
    const ivory = material(palette.ivory);
    const lights = [];
    function lamp(tag, normal, active, color = palette.ivory) {
      const m = material(normal, .17, .38);
      lights.push({ m, tag, normal, active, color });
      return m;
    }
    function mesh(geometry, m, x, y, z) {
      const obj = new T.Mesh(geometry, m);
      obj.position.set(x, z, y);
      obj.castShadow = obj.receiveShadow = !lighting.low;
      scene.add(obj);
      return obj;
    }
    function box(w, d, h, m, x, y, z) {
      return mesh(new T.BoxGeometry(w, h, d), m, x, y, z);
    }
    function disc(x, y, radius, h, z, m) {
      return mesh(new T.CylinderGeometry(radius, radius, h, lighting.low ? 12 : 24), m, x, y, z);
    }
    function rail([ax, ay, bx, by], w, h, z, m) {
      const dx = bx - ax, dy = by - ay;
      const railMesh = box(Math.hypot(dx, dy), w, h, m, (ax + bx) / 2, (ay + by) / 2, z);
      railMesh.rotation.y = -Math.atan2(dy, dx);
      return railMesh;
    }
    const texture = new T.CanvasTexture(art);
    texture.anisotropy = lighting.low ? 1 : Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const bedMaterial = material('#ffffff', 0, .7);
    bedMaterial.map = texture;
    box(10.8, 18.3, .55, dark, 5, 8.5, -.31);
    const bed = mesh(new T.PlaneGeometry(10, 17), bedMaterial, 5, 8.5, 0);
    bed.rotation.x = -Math.PI / 2;
    bed.castShadow = false;
    for (const x of [-.26, 10.26]) rail([x, -.37, x, 17.4], .24, .23, .1, chrome);
    for (const y of [-.37, 17.4]) rail([-.23, y, 10.23, y], .22, .23, .1, brass);
    geo.rails.forEach((r) => rail(r, .16, .34, .15, chrome));
    geo.slings.forEach((r, i) => {
      rail(r, .48, .2, .17, red);
      rail(r, .27, .15, .33, lamp('sling' + i, palette.red));
    });
    geo.targets.forEach((r, i) =>
      rail(r, .26, .58, .3, lamp('target' + i, palette.red, row => row[BANK] & (1 << i) ? '#553944' : palette.red)));
    geo.bumps.forEach(([x, y, radius], i) => {
      disc(x, y, radius - .05, .31, .18, chrome);
      disc(x, y, radius, .08, .36, red);
      disc(x, y, radius - .09, .13, .46, lamp('bumper' + i, palette.gold));
      disc(x, y, radius - .25, .09, .55, red);
      disc(x, y, .18, .03, .61, brass);
    });
    geo.lanes.forEach(([x, y], i) => {
      disc(x, y, .29, .075, .05, brass);
      disc(x, y, .21, .04, .1, lamp('lane' + i, palette.teal));
    });
    const track = rampPoints(geo);
    for (const offset of [-.24, .24]) {
      const points = track.map(([x, y, z]) => new T.Vector3(x + offset, z + .07, y));
      const tube = new T.TubeGeometry(new T.CatmullRomCurve3(points), 32, .045, 6, false);
      mesh(tube, chrome, 0, 0, 0);
    }
    disc(...geo.ramp, .26, .06, .04, lamp('ramp', '#60463c', row => row[BANK] === 7 ? palette.teal : '#60463c'));
    const [sx, sy] = geo.spinner;
    for (const dx of [-.57, .57]) disc(sx + dx, sy, .094, .57, .28, brass);
    const spinner = box(.91, .085, .3, lamp('spinner', palette.steel), sx, sy, .35);

    const paddles = geo.flips.map(([x, y]) => {
      const pivot = new T.Group();
      scene.add(pivot);
      pivot.position.set(x, .15, y);
      pivot.add(box(geo.length, .24, .23, red, geo.length / 2, 0, 0),
        box(geo.length, .18, .1, ivory, geo.length / 2, 0, .14),
        disc(0, 0, .18, .36, .04, brass), disc(geo.length, 0, .12, .23, 0, red));
      return pivot;
    });
    const sphere = mesh(new T.SphereGeometry(geo.radius, 20, 14), chrome, 0, 0, 0);
    const plunger = box(.43, .49, .32, brass, geo.launch[0], geo.launch[1] + .4, .16);
    const canvas = renderer.domElement;
    canvas.className = 'pb-three';
    stage.prepend(canvas);
    let width = 0, height = 0;
    return {
      draw(row, ball, flash) {
        if (!stage.clientWidth || !stage.clientHeight) return;
        if (width !== stage.clientWidth || height !== stage.clientHeight) {
          width = stage.clientWidth;
          height = stage.clientHeight;
          renderer.setSize(width, height, false);
          const halfHeight = Math.max(9.35, 5.5 * height / width);
          camera.top = halfHeight;
          camera.bottom = -halfHeight;
          camera.left = -halfHeight * width / height;
          camera.right = -camera.left;
          camera.updateProjectionMatrix();
        }
        sphere.visible = row[BALLS] > 0;
        sphere.position.set(ball[0], geo.radius + ball[2], Math.min(17.25, ball[1]));
        paddles.forEach((paddle, i) => { paddle.rotation.y = -ball[3 + i]; });
        plunger.position.z = geo.launch[1] + .4 + .33 * row[CHARGE] / 240;
        spinner.rotation.x = row[SPIN] * 2 * Math.PI;
        for (const { m, tag, normal, active, color } of lights) {
          const hit = flash === tag || flash === 'skill' && tag.startsWith('lane');
          m.color.set(hit ? color : active?.(row) || normal);
          m.emissive.set(hit ? color : row[BANK] === 7 && tag === 'ramp' ? palette.teal : '#000000');
          m.emissiveIntensity = .45;
        }
        renderer.render(scene, camera);
      },
      dispose() {
        lighting.key.shadow.map?.dispose();
        lighting.dispose();
        texture.dispose();
        const materials = new Set();
        scene.traverse((obj) => {
          obj.geometry?.dispose();
          if (obj.material) materials.add(obj.material);
        });
        for (const m of materials) m.dispose();
        renderer.dispose();
        canvas.remove();
      },
    };
  }

  let game;
  function mount(arena) {
    arena.innerHTML = `
      <section class="pb-cabinet" aria-label="Pinball">
        <div class="pb-marquee">
          <div><span class="pb-caption">Score</span><strong class="pb-score">0</strong></div>
          <div><span class="pb-caption">Balls left</span><strong class="pb-balls">3</strong></div>
          <div class="pb-best-tile" hidden><span class="pb-caption">Best</span><strong class="pb-best">—</strong></div>
        </div>
        <div class="pb-status"><span class="pb-ramp">Ramp</span><span class="pb-message" role="status"></span><span class="pb-nudges"></span></div>
        <div class="pb-stage" role="img" aria-label="Golden Hour pinball playfield"></div>
        <div class="pb-charge" role="meter" aria-label="Launch power" aria-valuemin="0" aria-valuemax="240" aria-valuenow="0">
          <div class="pb-charge-fill"></div><div class="pb-skill-band" title="Skill shot window"></div>
        </div>
        <div class="pb-controls">
          <button type="button" data-control="1" aria-label="Left flipper (A or left arrow)">◀ Flip</button>
          <button type="button" data-control="4" aria-label="Hold and release Launch (Space)">Launch</button>
          <button type="button" data-control="2" aria-label="Right flipper (D or right arrow)">Flip ▶</button>
        </div>
        <div class="pb-nudge-buttons" aria-label="Nudge controls">
          <button type="button" data-control="-1" aria-label="Nudge left (Q)">↤</button>
          <button type="button" data-control="-2" aria-label="Nudge up (W)">Nudge ↑</button>
          <button type="button" data-control="-3" aria-label="Nudge right (E)">↦</button>
        </div>
        <ol class="pb-standings" aria-label="Scores" hidden></ol>
      </section>`;
    const root = arena.querySelector('.pb-cabinet');
    const find = (s) => root.querySelector('.pb-' + s);
    const stage = find('stage');
    const listeners = new AbortController();
    const g = game = { root, stage, find, listeners, sources: new Map(), held: 0, tick: -1, flashAt: 0 };
    const on = (target, event, handler) => target.addEventListener(event, handler, { signal: listeners.signal });
    const setHeld = () => {
      const previous = g.held;
      g.held = [...g.sources.values()].reduce((mask, value) => mask | value, 0);
      if (previous !== g.held) send(g, {}, true);
      paintControls(g);
    };
    const press = (source, control) => {
      if (!g.enabled || g.sources.has(source)) return;
      if (control < 0) {
        if (!g.row[STAGED] && !g.row[TILT]) send(g, { nudge: [-1, 2, 1][-control - 1] }, true);
        return;
      }
      if (control === 4 ? !g.row[STAGED] : g.row[TILT]) return;
      g.sources.set(source, control);
      setHeld();
    };
    const release = (source) => { if (g.sources.delete(source)) setHeld(); };
    for (const button of root.querySelectorAll('button')) {
      const control = Number(button.dataset.control);
      const source = (e) => 'pointer' + e.pointerId;
      on(button, 'pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        button.setPointerCapture(e.pointerId);
        press(source(e), control);
      });
      on(button, 'pointerup', (e) => release(source(e)));
      on(button, 'pointercancel', () => clearControls(g, true));
      on(button, 'lostpointercapture', (e) => {
        if (g.sources.has(source(e))) clearControls(g, true);
      });
      on(button, 'keydown', (e) => {
        if (!['Enter', 'Space'].includes(e.code)) return;
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) press('button:' + e.code, control);
      });
      on(button, 'blur', () => {
        if ([...g.sources.keys()].some(key => key.startsWith('button:'))) clearControls(g, true);
      });
    }
    on(window, 'keydown', (e) => {
      if (!Object.hasOwn(keys, e.code) || e.target.closest?.('input, textarea, select, [contenteditable], dialog[open]') ||
          e.altKey || e.ctrlKey || e.metaKey || !g.enabled) return;
      e.preventDefault();
      if (!e.repeat) press(e.code, keys[e.code]);
    });
    on(window, 'keyup', (e) => { release(e.code); release('button:' + e.code); });
    on(window, 'blur', () => clearControls(g, true));
    on(document, 'visibilitychange', () => { if (document.hidden) clearControls(g, true); });
    g.heartbeat = setInterval(() => { if (g.held) send(g); }, 100);
    g.raf = requestAnimationFrame((now) => draw(g, now));
  }

  function send(g, extra = {}, keep = false) {
    if (g.enabled && g.row) g.ctx.input({ epoch: g.epoch, ball: g.row[BALLS], held: g.held, ...extra }, keep);
  }

  function clearControls(g, notify = false) {
    const held = g.held;
    g.sources.clear();
    g.held = 0;
    if (notify && held) send(g, { reset: true }, true);
    paintControls(g);
  }

  function paintControls(g) {
    if (!g.row) return;
    for (const button of g.root.querySelectorAll('button[data-control]')) {
      const control = Number(button.dataset.control);
      button.disabled = !g.enabled || (control === 4 ? !g.row[STAGED] : !!g.row[TILT] || control < 0 && !!g.row[STAGED]);
      if (control > 0) button.setAttribute('aria-pressed', String(!!(g.held & control)));
    }
  }

  function setText(element, value) {
    if (element.textContent !== String(value)) element.textContent = value;
  }

  function updateHud(g, row) {
    const { find } = g;
    setText(find('score'), row[SCORE].toLocaleString());
    setText(find('balls'), row[BALLS]);
    setText(find('nudges'), row[TILT] ? 'Tilted' : `Nudges ${3 - row[NUDGES]}`);
    setText(find('ramp'), row[BANK] === 7 ? 'Ramp ×3' : `Targets ${(row[BANK] & 1) + (row[BANK] >> 1 & 1) + (row[BANK] >> 2 & 1)}/3`);
    find('ramp').classList.toggle('lit', row[BANK] === 7);
    setText(find('message'), g.record ? 'New personal best' : row[TILT] ? messages.tilt :
      (performance.now() < g.flashAt ? label(row[EVENT]) : '') || (row[STAGED] ? 'Hold to launch' : row[BALLS] ? '' : 'Run complete'));
    find('charge-fill').style.width = `${100 * row[CHARGE] / 240}%`;
    const meter = find('charge');
    meter.setAttribute('aria-valuenow', row[CHARGE]);
    meter.classList.toggle('ready', !!row[STAGED]);
    find('best-tile').hidden = !g.solo;
    setText(find('best'), g.best === null ? '—' : g.best.toLocaleString());

    const list = find('standings');
    list.hidden = g.solo || Object.keys(g.tables).length < 2;
    if (!list.hidden) {
      const entries = Object.entries(g.tables).sort((a, b) => b[1][SCORE] - a[1][SCORE]);
      const items = entries.map(([pid, other]) =>
        `${g.ctx.player(pid)?.name || 'Player'} · ${other[SCORE].toLocaleString()} · ${other[BALLS]} left`);
      if (JSON.stringify(items) !== g.standingsKey) {
        g.standingsKey = JSON.stringify(items);
        list.replaceChildren(...items.map((text) => {
          const item = document.createElement('li');
          item.textContent = text;
          return item;
        }));
      }
    }
    paintControls(g);
  }

  function receive(g, data) {
    if (!g || data?.pin !== g.run || data.tick < g.tick) return;
    g.tick = data.tick;
    g.tables = data.tables;
    const viewer = g.me || (data.tables[g.viewer] ? g.viewer : Object.keys(data.tables)[0]);
    const row = data.tables[viewer];
    if (!row) {
      g.row = null;
      g.enabled = false;
      g.root.hidden = true;
      return;
    }
    g.root.hidden = false;
    const prior = g.viewer === viewer ? g.row : null;
    g.viewer = viewer;
    if (!prior || prior[BALLS] !== row[BALLS] || prior[STAGED] !== row[STAGED] || row[EVENT] === 'recovery' &&
        prior[EVENT_ID] !== row[EVENT_ID]) g.ball = null;
    if (prior && prior[BALLS] !== row[BALLS]) clearControls(g);
    if (prior && prior[EVENT_ID] !== row[EVENT_ID]) {
      g.flashAt = performance.now() + 780;
      if (viewer === g.me && !g.ctx.readOnly) g.ctx.sfx(row[TILT] ? 'wrong' : 'pop');
    }
    g.enabled = !!(g.active && g.me && row[BALLS]);
    if (!g.enabled || row[TILT] && !prior?.[TILT]) clearControls(g);
    g.row = row;
    if (prior !== row) g.receivedAt = performance.now();
    if (g.over && g.solo && g.me && !row[BALLS] && (g.best === null || row[SCORE] > g.best)) {
      g.best = row[SCORE];
      g.record = true;
      store(bestKey, g.best);
    }
    updateHud(g, row);
  }

  function draw(g, now) {
    g.raf = requestAnimationFrame((next) => draw(g, next));
    const row = g.row;
    if (!row) return;
    // Predict at most one fast packet ahead; converge on each authoritative sample.
    const ahead = g.active && !row[STAGED] && !row[Z] ? Math.min(.034, Math.max(0, (now - g.receivedAt) / 1000)) : 0;
    const target = [row[X] + row[VX] * ahead, row[Y] + row[VY] * ahead, row[Z], row[LEFT], row[RIGHT]];
    const blend = 1 - Math.exp(-Math.min(60, now - (g.drawnAt ?? now)) / 25);
    g.ball = g.ball ? g.ball.map((value, i) => value + (target[i] - value) * blend) : target;
    g.drawnAt = now;
    const flash = now < g.flashAt ? row[EVENT] : '';
    if (!flash && g.flashing) updateHud(g, row);
    g.flashing = !!flash;
    (g.three || g.flat)?.draw(row, g.ball, flash);
  }

  function initRenderer(g, geo) {
    const art = makeArt(geo);
    const flat = () => { g.flat ||= flatRenderer(g.stage, geo, art); };
    const unflat = () => { g.flat?.dispose(); g.flat = null; };
    // Draw immediately while the shared Three.js bundle loads.
    flat();
    const retry = (T) => {
      if (game !== g) return;
      const build = () => {
        if (game !== g) return false;
        g.three = threeRenderer(T, g.stage, geo, art, () => {
          if (game !== g || !g.three) return;
          g.three.dispose();
          g.three = null;
          GL3.revive(g.stage, { build, flat, unflat });
        });
        return g.three;
      };
      try {
        if (build()) { unflat(); return; }
      } catch (error) {
        console.warn('Pinball could not start 3D', error);
      }
      // Let the shared recovery helper own the fallback canvas and retry button.
      unflat();
      GL3.revive(g.stage, { build, flat, unflat });
    };
    GL3.load().then(retry).catch(() => {});
  }

  UI.pinball = {
    focus: true,
    mount,
    turnText: (view) => view.phase === 'over' ? 'Pinball results' : 'Three-ball run',
    render(view, ctx) {
      const g = game, data = view.pinball;
      if (!g || !data) return;
      if (!g.run) {
        g.run = data.pin;
        g.solo = data.solo;
        const saved = load(bestKey);
        g.best = Number.isSafeInteger(saved) && saved >= 0 ? saved : null;
        const band = g.find('skill-band');
        band.style.left = `${100 * data.layout.skill[0] / 240}%`;
        band.style.width = `${100 * (data.layout.skill[1] - data.layout.skill[0] + 1) / 240}%`;
        initRenderer(g, data.layout);
      }
      g.ctx = ctx;
      g.me = data.me;
      g.active = view.phase === 'playing' && !view.paused && !ctx.readOnly && !view.me?.eliminated;
      g.over = view.phase === 'over' && !ctx.readOnly;
      if (g.epoch !== data.epoch || !g.active) clearControls(g);
      g.epoch = data.epoch;
      if (data.tick >= g.tick) receive(g, data);
      else if (g.row) {
        g.enabled = !!(g.active && g.me && g.row[BALLS]);
        updateHud(g, g.row);
      }
    },
    fast(data) { receive(game, data); },
    disconnect() {
      if (!game) return;
      game.active = game.enabled = false;
      clearControls(game);
    },
    unmount() {
      if (!game) return;
      game.listeners.abort();
      cancelAnimationFrame(game.raf);
      clearInterval(game.heartbeat);
      game.three?.dispose();
      game.flat?.dispose();
      game.root.remove();
      game = null;
    },
  };
})();
