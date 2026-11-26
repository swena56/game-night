// Pinball table editor: drag parts onto the cabinet, move / resize / recolour them, then play the table.
// The cabinet (outer walls, shooter lane, flippers, drain) is fixed; the server checks and clamps every part again.
(() => {
  const $ = (id) => document.getElementById(id);
  const W = 10, H = 17;
  const X = [.45, 8.35], Y = [.45, 14.2], SEG = [.25, 4.5];
  const MAX_BYTES = 40000;     // a table's raw JSON; big ones travel as a deflated share code (the server caps requests at 10,000 bytes)
  const MAX_CODE = 9500;       // ...so the share code, not the JSON, must fit
  const MAX_PARTS = 120;
  const STORE = 'pinball.editor.table', SLOTS = 'pinball.editor.slots';
  // shape: p = point, pr = point + radius, s = segment (two ends), w = a wire of 2-6 points; paint: the game draws it in your colour
  const KINDS = {
    bump: { label: 'Pop bumper', icon: '🔴', shape: 'pr', color: '#ff9b59', r: [.3, 1], r0: .6, max: 12, paint: true },
    sling: { label: 'Slingshot', icon: '🔺', shape: 's', color: '#ff6854', len: 1.8, max: 6, paint: true },
    target: { label: 'Target', icon: '🎯', shape: 's', color: '#ff6854', len: .8, max: 8, paint: true },
    lane: { label: 'Rollover lane', icon: '🛤️', shape: 'p', color: '#59edd2', max: 6, paint: true },
    post: { label: 'Rubber post', icon: '⚫', shape: 'pr', color: '#fff0ca', r: [.07, .3], r0: .11, max: 16, paint: true },
    wall: { label: 'Wall / guide', icon: '▬', shape: 's', color: '#c1d2e5', len: 2, max: 16, paint: true },
    spinner: { label: 'Spinner', icon: '🌀', shape: 'p', color: '#c1d2e5', max: 1, paint: true },
    saucer: { label: 'Saucer', icon: '🥣', shape: 'pr', color: '#ffd383', r: [.25, .6], r0: .3, max: 1 },
    magnet: { label: 'Magnet', icon: '🧲', shape: 'pr', color: '#59edd2', r: [.6, 2], r0: 1.1, max: 1 },
    ramp: { label: 'Ramp', icon: '🛝', shape: 's', color: '#59edd2', len: 2.6, max: 1, paint: true, seg: [1.5, 9], yMin: 4.8,
      hint: 'Start = the mouth: shoot a fast ball up into it once the targets are cleared. End = where the ball comes out.' },
    subway: { label: 'Subway', icon: '🚇', shape: 's', color: '#c699ff', len: 3, max: 1, paint: true, seg: [.6, 9],
      hint: 'Start = the mouth that swallows the ball. End = where it comes back, fired down the table.' },
    orbit: { label: 'Orbit wire', icon: '🔄', shape: 'w', color: '#9ce9ff', max: 1, paint: true,
      hint: 'The first point is the mouth: shoot up into it and the ball rides the wire to the last point. Drag the dots to bend it.' },
  };
  Object.assign(KINDS, {
    arc: { label: 'Curved wall', icon: '◠', shape: 'a', color: '#c1d2e5', len: 2.4, max: 6, paint: true, seg: [.8, 6], group: 'Walls & guides',
      hint: 'Drag the two end dots, then the middle dot to bend the wall like a curved guide rail.' },
    flap: { label: 'One-way flap', icon: '⤵️', shape: 's', color: '#ffd383', len: 1, max: 4, paint: true, seg: [.4, 2.5], group: 'Walls & guides',
      hint: 'The ball passes through from the right-hand side of the line (looking from the start dot to the end dot) and cannot come back.' },
    portal: { label: 'Portal pair', icon: '🌀', shape: 's', color: '#59edd2', len: 4, max: 1, paint: true, seg: [.8, 9], group: 'Mechanisms',
      hint: 'Two linked holes: a ball that rolls into one leaves from the other, keeping its speed.' },
  });
  Object.assign(KINDS, {
    rubber: { label: 'Rubber band', icon: '➰', shape: 's', color: '#f2ecdd', len: 1.2, max: 6, paint: true, seg: [.3, 4.5], group: 'Walls & guides',
      hint: 'Bouncy dead rubber: it kicks the ball back but scores nothing.' },
    mover: { label: 'Moving target', icon: '↔️', shape: 's', color: '#ff6854', len: 3, max: 3, paint: true, seg: [.8, 4.5], group: 'Mechanisms',
      hint: 'The two dots are the ends of its track. The target slides back and forth along it; a firm hit scores 300.' },
    hole: { label: 'Kicker hole', icon: '🕳️', shape: 'pr', color: '#ffd383', r: [.25, .6], r0: .3, max: 3, paint: true, group: 'Mechanisms',
      hint: 'Holds the ball for a moment, then fires it down the table toward the middle (+1,000).' },
    flip: { label: 'Extra flipper', icon: '🏓', shape: 'p', color: '#42cfeb', max: 4, group: 'Mechanisms', yMin: 5, yMax: 12.2,
      hint: 'A mid-table flipper. Left of the middle it follows the left button, right of the middle the right button.' },
  });
  const GLYPH = { star: ['⭐', 'Star'], heart: ['💗', 'Heart'], bolt: ['⚡', 'Bolt'], diamond: ['🔷', 'Diamond'], moon: ['🌙', 'Moon'], ring: ['⭕', 'Ring'] };
  for (const [g, [icon, label]] of Object.entries(GLYPH)) KINDS[g] = { label: label + ' decal', icon, shape: 'pr', color: '#ffd383', r: [.25, 1.6], r0: .6, max: 4, paint: true, group: 'Decals',
    hint: 'Painted on the playfield under the glass. It only decorates: the ball rolls over it.' };
  const GROUPS = { rubber: 'Walls & guides', wall: 'Walls & guides', post: 'Walls & guides', spinner: 'Mechanisms', saucer: 'Mechanisms', magnet: 'Mechanisms', ramp: 'Mechanisms', subway: 'Mechanisms', orbit: 'Mechanisms' };
  // the table's own point values (defaults match the game's rules)
  const POINTS = { bumper: [100, 'Pop bumper'], sling: [50, 'Slingshot'], target: [250, 'Target'], lane: [500, 'Rollover lane'], spinner: [100, 'Spinner'],
    ramp: [6000, 'Ramp'], saucer: [1000, 'Saucer / kicker hole'], portal: [250, 'Portal'], mover: [300, 'Moving target'] };
  const OWN_POINTS = new Set(['bump', 'sling', 'target', 'lane', 'mover']);   // parts that can carry their own score
  const SWATCHES = ['#ff6854', '#ff9b59', '#ffd383', '#fff0ca', '#59edd2', '#42cfeb', '#c699ff', '#ff78bc', '#c1d2e5'];
  // the fixed cabinet, as in the game: outer walls, shooter lane, outlane walls, inlane guides, flippers
  // same corner rounding as games/pinball.py fillet(): arcs instead of sharp joins
  const fillet = (pts, radii, steps = 7) => {
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1];
      const v1 = [ax - bx, ay - by], v2 = [cx - bx, cy - by], l1 = Math.hypot(...v1), l2 = Math.hypot(...v2);
      const u1 = [v1[0] / l1, v1[1] / l1], u2 = [v2[0] / l2, v2[1] / l2];
      const ang = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));
      let r = radii[i - 1];
      if (r <= 0 || ang > Math.PI - 1e-3) { out.push([bx, by]); continue; }
      const d = Math.min(r / Math.tan(ang / 2), i > 1 ? l1 / 2 : l1 * .9, i < pts.length - 2 ? l2 / 2 : l2 * .9);
      r = d * Math.tan(ang / 2);
      const p1 = [bx + u1[0] * d, by + u1[1] * d], p2 = [bx + u2[0] * d, by + u2[1] * d];
      const bis = [u1[0] + u2[0], u1[1] + u2[1]], bl = Math.hypot(...bis), cd = r / Math.sin(ang / 2);
      const ctr = [bx + bis[0] / bl * cd, by + bis[1] / bl * cd];
      const a1 = Math.atan2(p1[1] - ctr[1], p1[0] - ctr[0]), a2 = Math.atan2(p2[1] - ctr[1], p2[0] - ctr[0]);
      const da = ((a2 - a1 + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      for (let k = 0; k <= steps; k++) { const a = a1 + da * k / steps; out.push([ctr[0] + r * Math.cos(a), ctr[1] + r * Math.sin(a)]); }
    }
    out.push(pts[pts.length - 1]);
    return out.slice(1).map((b, i) => [...out[i], ...b]);
  };
  // the fixed cabinet, as in the game: smooth outer wall, shooter lane, outlane walls, inlane guides, flippers
  const RAILS = [...fillet([[0, 17], [0, 2.2], [1.5, 0], [7.8, 0], [10, 2.8], [10, 17]], [1.9, 1.3, 1.6, 1.9]),
    [8.8, 3.1, 8.8, 17], [8.8, 16.25, 10, 16.25],
    ...fillet([[.9, 12.2], [.9, 13.5], [3.22, 14.95]], [.5]), ...fillet([[7.9, 12.4], [7.9, 13.8], [6.78, 14.95]], [.5])];
  const FLIPS = [[3.22, 14.95, .42], [6.78, 14.95, Math.PI - .42]];
  const FLIP_LEN = 1.56;

  let state = { name: '', items: [], kick: false, lock: false, pts: {} };
  let zoom = 1;
  const hiddenLayers = new Set();
  const group = new Set();                        // shift-click adds parts: duplicate, delete, nudge and drag then act on all of them
  const selected = () => (group.size > 1 ? [...group].sort((a, b) => a - b) : sel >= 0 ? [sel] : []);
  const LAYERS = ['Scoring', 'Walls & guides', 'Mechanisms', 'Decals'];
  const layerOf = (k) => KINDS[k].group || GROUPS[k] || 'Scoring';
  const shown = (it) => !hiddenLayers.has(layerOf(it.k));
  let sel = -1;
  let snap = true;
  let history = [], future = [];
  let drag = null;
  const canvas = $('peCanvas'), ctx = canvas.getContext('2d');
  let scale = 40;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const round2 = (v) => Math.round(v * 100) / 100;
  const grid = (v) => (snap ? Math.round(v / .25) * .25 : v);
  const count = (k) => state.items.filter((i) => i.k === k).length;
  const say = (text) => { $('peMsg').textContent = text || ''; };
  const copy = (o) => JSON.parse(JSON.stringify(o));
  const yRange = (k) => [KINDS[k].yMin ?? Y[0], KINDS[k].yMax ?? Y[1]];
  const segRange = (k) => KINDS[k].seg || SEG;

  // every coordinate pair of a part, so rotate / mirror / nudge work for any shape
  function mapPts(it, f) {
    const d = KINDS[it.k];
    if (d.shape === 'w') { it.pts = it.pts.map(f); [it.x, it.y] = it.pts[0]; return it; }
    [it.x, it.y] = f([it.x, it.y]);
    if ('x2' in it) [it.x2, it.y2] = f([it.x2, it.y2]);
    if ('cx' in it) [it.cx, it.cy] = f([it.cx, it.cy]);
    return it;
  }
  const centre = (it) => {
    const all = []; mapPts(copy(it), (p) => { all.push(p); return p; });
    return [all.reduce((a, p) => a + p[0], 0) / all.length, all.reduce((a, p) => a + p[1], 0) / all.length];
  };

  // ---- model --------------------------------------------------------------------------------------------
  function fixLength(it) {
    const [lo, hi] = segRange(it.k), [y0, y1] = yRange(it.k);
    let dx = it.x2 - it.x, dy = it.y2 - it.y, len = Math.hypot(dx, dy);
    if (len < lo) { const a = len ? Math.atan2(dy, dx) : 0; dx = Math.cos(a) * lo; dy = Math.sin(a) * lo; len = lo; }
    if (len > hi) { dx *= hi / len; dy *= hi / len; }
    it.x2 = clamp(it.x + dx, ...X); it.y2 = clamp(it.y + dy, y0, y1);
  }
  function normalize(it) {
    const d = KINDS[it.k], [y0, y1] = yRange(it.k);
    if (d.shape === 'w') { it.pts = it.pts.map(([x, y]) => [clamp(x, ...X), clamp(y, y0, y1)]); [it.x, it.y] = it.pts[0]; return it; }
    it.x = clamp(it.x, ...X); it.y = clamp(it.y, y0, y1);
    if (d.shape === 'pr') it.r = clamp(it.r, ...d.r);
    if (d.shape === 'a') { it.x2 = clamp(it.x2, ...X); it.y2 = clamp(it.y2, y0, y1); fixLength(it); it.cx = clamp(it.cx, ...X); it.cy = clamp(it.cy, y0, y1); }
    if (d.shape === 's') { it.x2 = clamp(it.x2, ...X); it.y2 = clamp(it.y2, y0, y1); fixLength(it); }
    return it;
  }
  function make(k, x, y) {
    const d = KINDS[k], it = { k, x, y, c: d.color };
    if (d.shape === 'pr') it.r = d.r0;
    if (d.shape === 's' || d.shape === 'a') { const across = k !== 'target'; it.x2 = x + (across ? d.len : 0); it.y2 = y + (across ? 0 : d.len); }
    if (d.shape === 'a') { it.cx = (x + it.x2) / 2; it.cy = y - 1.2; }
    if (d.shape === 'w') it.pts = [[x, y], [x, y - 1.2], [x + 1.2, y - 2.2]];
    return normalize(it);
  }
  function toSpec() {
    const items = state.items.map((i) => {
      const d = KINDS[i.k];
      return d.shape === 's' ? [i.k, round2(i.x), round2(i.y), round2(i.x2), round2(i.y2), i.c]
        : d.shape === 'a' ? [i.k, round2(i.x), round2(i.y), round2(i.x2), round2(i.y2), round2(i.cx), round2(i.cy), i.c]
        : d.shape === 'w' ? [i.k, ...i.pts.flat().map(round2), i.c]
        : d.shape === 'pr' ? [i.k, round2(i.x), round2(i.y), round2(i.r), i.c] : [i.k, round2(i.x), round2(i.y), i.c];
    });
    if (state.kick) items.push(['kick', '#ffffff']);
    const lock = state.lock;
    const out = { v: 1, name: state.name.trim().slice(0, 40), items };
    if (lock) out.lock = true;
    const pv = [];
    state.items.forEach((i, n) => { if (OWN_POINTS.has(i.k) && Number.isFinite(i.pv)) pv.push([n, i.pv]); });
    if (pv.length) out.pv = pv;
    const modes = [];
    state.items.forEach((i, n) => { if (Number.isInteger(i.modes) && i.modes > 0 && i.modes < 15) modes.push([n, i.modes]); });
    if (modes.length) out.modes = modes;
    const pts = Object.fromEntries(Object.entries(state.pts || {}).filter(([k, v]) => POINTS[k] && v !== POINTS[k][0]));
    if (Object.keys(pts).length) out.pts = pts;
    return out;
  }
  function fromSpec(spec) {
    if (!spec || !Array.isArray(spec.items)) throw new Error("That isn't a table.");
    const next = { name: typeof spec.name === 'string' ? spec.name.slice(0, 40) : '', items: [], kick: false, lock: spec.lock === true, pts: {} };
    if (spec.pts && typeof spec.pts === 'object') for (const [k, v] of Object.entries(spec.pts)) if (POINTS[k] && typeof v === 'number' && isFinite(v)) next.pts[k] = clamp(Math.round(v), 0, 20000);
    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
    const own = new Map((Array.isArray(spec.pv) ? spec.pv : []).filter((p) => Array.isArray(p) && Number.isInteger(p[0]) && Number.isFinite(p[1])).map((p) => [p[0], clamp(Math.round(p[1]), 0, 20000)]));
    const live = new Map((Array.isArray(spec.modes) ? spec.modes : []).filter((p) => Array.isArray(p) && Number.isInteger(p[0]) && Number.isInteger(p[1]) && p[1] > 0 && p[1] < 15));
    for (const [n, a] of spec.items.entries()) {
      if (!Array.isArray(a)) continue;
      if (a[0] === 'kick') { next.kick = true; continue; }
      const d = KINDS[a[0]];
      if (!d || next.items.filter((i) => i.k === a[0]).length >= d.max) continue;
      const color = /^#[0-9a-f]{6}$/i.test(a[a.length - 1]) ? a[a.length - 1].toLowerCase() : d.color;
      const it = { k: a[0], x: num(a[1]), y: num(a[2]), c: color };
      if (d.shape === 'pr') it.r = num(a[3]) || d.r0;
      if (d.shape === 's') { it.x2 = num(a[3]); it.y2 = num(a[4]); }
      if (d.shape === 'a') { it.x2 = num(a[3]); it.y2 = num(a[4]); it.cx = num(a[5]); it.cy = num(a[6]); }
      if (d.shape === 'w') {
        const flat = a.slice(1, -1).map(num);
        if (flat.length < 4 || flat.length % 2) continue;
        it.pts = [];
        for (let i = 0; i < Math.min(flat.length, 12); i += 2) it.pts.push([flat[i], flat[i + 1]]);
      }
      if (OWN_POINTS.has(it.k) && own.has(n)) it.pv = own.get(n);
      if (live.has(n)) it.modes = live.get(n);
      next.items.push(normalize(it));
    }
    return next;
  }
  // a Golden Hour look-alike: every kind of part in the places the real table has them
  const GOLDEN = ['Golden Hour copy', [
    ['bump', 3.12, 5.65, .68, '#ff9b59'], ['bump', 6.62, 5.7, .68, '#c699ff'], ['bump', 4.05, 7.64, .68, '#58e5d5'],
    ['sling', 1.35, 10.75, 2.85, 12.5, '#ff6854'], ['sling', 7.73, 10.75, 6.48, 12.6, '#ff6854'],
    ['target', 1.25, 6.6, 1.25, 7.3, '#ff6854'], ['target', 1.25, 7.48, 1.25, 8.18, '#ff6854'], ['target', 1.25, 8.36, 1.25, 9.06, '#ff6854'],
    ['lane', 2.25, 3.5, '#59edd2'], ['lane', 4.25, 3.5, '#59edd2'], ['lane', 6.25, 3.5, '#59edd2'],
    ['wall', 3.25, 2.95, 3.25, 4.15, '#c1d2e5'], ['wall', 5.25, 2.95, 5.25, 4.15, '#c1d2e5'],
    ['wall', 2.55, 9.55, 3.15, 10.35, '#ffcf76'], ['wall', 7.45, 9.55, 6.85, 10.35, '#ffcf76'],
    ['post', 3.25, 2.85, .11, '#fff0ca'], ['post', 5.25, 2.85, .11, '#fff0ca'], ['post', 3.55, 12.9, .11, '#fff0ca'], ['post', 6.45, 12.9, .11, '#fff0ca'],
    ['spinner', 7.95, 7.4, '#c1d2e5'], ['saucer', 1.6, 4.7, .3, '#ffd383'], ['magnet', 5, 9.6, 1.1, '#59edd2'],
    ['ramp', 5.25, 6.02, 7.75, 8.6, '#59edd2'], ['subway', 8.15, 4.8, 2, 8.9, '#c699ff'],
    ['orbit', .5, 5.6, .45, 3.2, 1, 1.2, 2.2, .7, 7, .8, '#9ce9ff'], ['kick', '#ffffff']]];
  const TEMPLATES = [
    ['Empty table', []],
    ['Demo table', [['bump', 3, 5.5, .65, '#ff9b59'], ['bump', 6.4, 5.5, .65, '#c699ff'], ['bump', 4.7, 7.6, .65, '#58e5d5'],
      ['sling', 1.35, 10.75, 2.85, 12.5, '#ff6854'], ['sling', 7.7, 10.75, 6.5, 12.6, '#ff6854'],
      ['lane', 2.25, 3.5, '#59edd2'], ['lane', 4.25, 3.5, '#59edd2'], ['lane', 6.25, 3.5, '#59edd2'],
      ['target', 1.25, 6.6, 1.25, 7.3, '#ff6854'], ['spinner', 7.95, 7.4, '#c1d2e5'], ['kick', '#ffffff']]],
    GOLDEN,
    // hand-built tables: each is tuned by simulated play (ball lasts 13-20 s, every part gets used)
    ['Pop Pit', [
      ['bump',4.4,4.7,0.62,'#ff9b59'],
      ['bump',3.1,6.3,0.62,'#c699ff'],
      ['bump',5.7,6.3,0.62,'#59edd2'],
      ['bump',1.9,7.9,0.6,'#ff78bc'],
      ['bump',4.4,7.8,0.64,'#ffd383'],
      ['bump',6.9,7.9,0.6,'#42cfeb'],
      ['lane',3.3,2.5,'#59edd2'],
      ['lane',4.4,2.5,'#59edd2'],
      ['lane',5.5,2.5,'#59edd2'],
      ['wall',3.85,1.9,3.85,3.1,'#c1d2e5'],
      ['wall',4.95,1.9,4.95,3.1,'#c1d2e5'],
      ['spinner',7.6,4.4,'#c1d2e5'],
      ['arc',0.8,10.0,2.6,9.2,0.9,8.6,'#ffd383'],
      ['arc',7.9,10.0,6.2,9.2,7.8,8.6,'#ffd383'],
      ['sling',1.35,10.75,2.85,12.5,'#ff6854'],
      ['sling',7.73,10.75,6.48,12.6,'#ff6854'],
      ['post',3.55,12.9,0.11,'#fff0ca'],
      ['post',6.45,12.9,0.11,'#fff0ca'],
      ['kick','#ffffff']],
      {'pts':{'bumper':150}}, 'Arcade chaos: six pop bumpers worth 150 each, a spinner and curved kickers.'],
    ['Wizard Tower', [
      ['target',1.25,6.0,1.25,6.7,'#ff6854'],
      ['target',1.25,6.9,1.25,7.6,'#ff6854'],
      ['target',1.25,7.8,1.25,8.5,'#ff6854'],
      ['target',1.25,8.7,1.25,9.4,'#ff6854'],
      ['bump',3.0,4.3,0.6,'#ff9b59'],
      ['bump',6.8,4.3,0.6,'#c699ff'],
      ['ramp',5.25,6.02,7.75,8.6,'#59edd2'],
      ['subway',8.15,4.8,2.0,8.9,'#c699ff'],
      ['magnet',4.0,9.6,1.0,'#59edd2'],
      ['saucer',1.6,4.7,0.3,'#ffd383'],
      ['spinner',7.95,7.4,'#c1d2e5'],
      ['lane',2.25,3.0,'#59edd2'],
      ['lane',4.25,3.0,'#59edd2'],
      ['lane',6.25,3.0,'#59edd2'],
      ['wall',3.25,2.5,3.25,3.7,'#c1d2e5'],
      ['wall',5.25,2.5,5.25,3.7,'#c1d2e5'],
      ['star',4.4,11.0,0.55,'#ffd383'],
      ['moon',4.4,2.0,0.45,'#42cfeb'],
      ['sling',1.35,10.75,2.85,12.5,'#ff6854'],
      ['sling',7.73,10.75,6.48,12.6,'#ff6854'],
      ['post',3.55,12.9,0.11,'#fff0ca'],
      ['post',6.45,12.9,0.11,'#fff0ca'],
      ['kick','#ffffff']],
      {'lock':true}, 'Clear the 4-target bank to light the ramp; ramp shots lock balls for multiball. Magnet, saucer and subway too.'],
    ['Portal Run', [
      ['portal',1.2,5.0,7.4,9.0,'#59edd2'],
      ['arc',0.7,11.0,2.0,7.0,0.5,8.4,'#42cfeb'],
      ['arc',8.1,11.0,6.9,7.0,8.3,8.4,'#42cfeb'],
      ['flap',3.4,6.2,4.4,6.2,'#ffd383'],
      ['flap',5.4,6.2,4.4,6.2,'#ffd383'],
      ['mover',2.6,4.2,6.2,4.2,'#ff6854'],
      ['bump',3.2,8.0,0.55,'#ff9b59'],
      ['bump',5.6,8.0,0.55,'#c699ff'],
      ['bump',4.4,9.6,0.55,'#ff78bc'],
      ['lane',3.4,2.4,'#59edd2'],
      ['lane',4.4,2.4,'#59edd2'],
      ['lane',5.4,2.4,'#59edd2'],
      ['spinner',4.4,3.4,'#c1d2e5'],
      ['heart',4.4,7.0,0.6,'#ff78bc'],
      ['sling',1.35,10.75,2.85,12.5,'#ff6854'],
      ['sling',7.73,10.75,6.48,12.6,'#ff6854'],
      ['post',3.55,12.9,0.11,'#fff0ca'],
      ['post',6.45,12.9,0.11,'#fff0ca'],
      ['kick','#ffffff']],
      {}, 'A portal pair teleports the ball across the table. One-way flaps, curved lanes and a sliding target.'],
    ['Zen Garden', [
      ['orbit',0.6,8.5,0.5,4.0,1.2,1.8,3.0,1.2,6.9,1.4,'#59edd2'],
      ['bump',3.4,6.0,0.5,'#42cfeb'],
      ['bump',5.4,7.2,0.5,'#c699ff'],
      ['bump',2.6,8.8,0.45,'#59edd2'],
      ['arc',0.8,12.0,2.4,9.8,0.9,10.4,'#ffd383'],
      ['arc',7.9,12.0,6.4,9.8,7.8,10.4,'#ffd383'],
      ['moon',4.4,4.2,0.9,'#42cfeb'],
      ['star',2.0,6.0,0.4,'#ffd383'],
      ['star',6.6,5.0,0.35,'#ffd383'],
      ['ring',4.4,9.0,1.1,'#ff78bc'],
      ['rubber',0.8,6.8,1.1,8.0,'#fff0ca'],
      ['sling',1.35,10.75,2.85,12.5,'#ff6854'],
      ['sling',7.73,10.75,6.48,12.6,'#ff6854'],
      ['post',3.55,12.9,0.11,'#fff0ca'],
      ['post',6.45,12.9,0.11,'#fff0ca'],
      ['kick','#ffffff']],
      {'pts':{'bumper':50,'lane':250}}, 'Calm and low-scoring: a long orbit, soft bumpers and moon, star and ring decals. Good for relaxed play.'],
    ['Double Decker', [
      ['flip',2.0,9.2,'#42cfeb'],
      ['flip',6.8,9.2,'#ff78bc'],
      ['bump',3.4,4.4,0.6,'#ff9b59'],
      ['bump',5.4,4.4,0.6,'#c699ff'],
      ['bump',4.4,6.2,0.6,'#59edd2'],
      ['mover',2.4,7.4,6.4,7.4,'#ff6854'],
      ['hole',1.0,5.6,0.3,'#ffd383'],
      ['hole',7.8,5.6,0.3,'#ffd383'],
      ['rubber',0.7,6.8,1.0,8.0,'#fff0ca'],
      ['rubber',8.1,6.8,7.8,8.0,'#fff0ca'],
      ['lane',3.4,2.4,'#59edd2'],
      ['lane',4.4,2.4,'#59edd2'],
      ['lane',5.4,2.4,'#59edd2'],
      ['sling',1.35,10.75,2.85,12.5,'#ff6854'],
      ['sling',7.73,10.75,6.48,12.6,'#ff6854'],
      ['post',3.55,12.9,0.11,'#fff0ca'],
      ['post',6.45,12.9,0.11,'#fff0ca'],
      ['kick','#ffffff']],
      {}, 'Two extra mid-table flippers, a sliding target and kicker holes in the upper corners.'],
    ['Target Range', [
      ['target',1.0,5.0,1.0,5.8,'#ff6854'],
      ['target',1.0,6.2,1.0,7.0,'#ff6854'],
      ['target',1.0,7.4,1.0,8.2,'#ff6854'],
      ['target',7.6,5.0,7.6,5.8,'#ff9b59'],
      ['target',7.6,6.2,7.6,7.0,'#ff9b59'],
      ['target',7.6,7.4,7.6,8.2,'#ff9b59'],
      ['mover',2.4,5.0,6.2,5.0,'#ff6854'],
      ['mover',2.4,7.4,6.2,7.4,'#ff9b59'],
      ['bump',4.4,9.4,0.6,'#ffd383'],
      ['bump',3.0,3.8,0.5,'#c699ff'],
      ['bump',5.8,3.8,0.5,'#c699ff'],
      ['lane',3.4,2.2,'#59edd2'],
      ['lane',4.4,2.2,'#59edd2'],
      ['lane',5.4,2.2,'#59edd2'],
      ['sling',1.35,10.75,2.85,12.5,'#ff6854'],
      ['sling',7.73,10.75,6.48,12.6,'#ff6854'],
      ['post',3.55,12.9,0.11,'#fff0ca'],
      ['post',6.45,12.9,0.11,'#fff0ca'],
      ['kick','#ffffff']],
      {'pv':[[0,500],[1,500],[2,500],[3,500],[4,500],[5,500],[6,1000],[7,1000]]}, 'Eight high-value targets (500 and 1,000) and two sliding targets. Aim for accuracy.'],
    ['Speedway', [
      ['orbit',0.6,9.0,0.5,4.0,1.0,1.5,2.4,1.0,7.0,1.2,'#42cfeb'],
      ['ramp',4.4,6.4,6.9,9.4,'#59edd2'],
      ['lane',1.6,2.4,'#59edd2'],
      ['lane',2.7,2.4,'#59edd2'],
      ['lane',3.8,2.4,'#59edd2'],
      ['lane',4.9,2.4,'#59edd2'],
      ['lane',6.0,2.4,'#59edd2'],
      ['lane',7.1,2.4,'#59edd2'],
      ['spinner',7.6,5.6,'#c1d2e5'],
      ['bump',2.6,5.2,0.55,'#ff9b59'],
      ['bump',4.4,4.2,0.55,'#c699ff'],
      ['arc',0.9,12.2,2.1,10.0,0.8,10.8,'#ffd383'],
      ['arc',7.9,12.2,6.7,10.0,7.9,10.8,'#ffd383'],
      ['target',2.0,7.8,2.8,7.8,'#ff6854'],
      ['target',3.0,7.8,3.8,7.8,'#ff6854'],
      ['sling',1.35,10.75,2.85,12.5,'#ff6854'],
      ['sling',7.73,10.75,6.48,12.6,'#ff6854'],
      ['post',3.55,12.9,0.11,'#fff0ca'],
      ['post',6.45,12.9,0.11,'#fff0ca'],
      ['kick','#ffffff']],
      {'pv':[[2,1000],[3,1000],[4,1000],[5,1000],[6,1000],[7,1000]]}, 'Six rollover lanes worth 1,000 each, a long orbit and a ramp. Chase speed combos.'],
    ['Portals & curves', [['arc', .9, 9.6, 3.2, 9.6, 1.2, 7.6, '#ffd383'], ['arc', 7.8, 9.6, 5.4, 9.6, 7.6, 7.6, '#ffd383'],
      ['portal', 1.4, 4.2, 7.4, 6.2, '#59edd2'], ['bump', 4.4, 6.2, .65, '#ff78bc'], ['flap', 4.4, 11.4, 4.4, 10.4, '#ffd383'],
      ['star', 4.4, 8.6, .8, '#ff9b59'], ['heart', 4.4, 3.2, .6, '#ff78bc'], ['kick', '#ffffff']]],
    ['Mid-table flippers', [['flip', 2.2, 9.4, '#42cfeb'], ['flip', 6.6, 9.4, '#ff78bc'], ['mover', 2.4, 5.2, 6.4, 5.2, '#ff6854'],
      ['hole', 1.5, 6.8, .3, '#ffd383'], ['rubber', 1, 11.8, 2.4, 12.4, '#f2ecdd'], ['rubber', 7.8, 11.8, 6.4, 12.4, '#f2ecdd'],
      ['bump', 4.4, 7.2, .6, '#c699ff'], ['kick', '#ffffff']]],
    ['Wire playground', [['ramp', 4, 8, 7, 10, '#59edd2'], ['orbit', .6, 8, .6, 4, 2, 1.2, 6.5, 1.2, '#9ce9ff'], ['subway', 7.8, 6, 2.5, 10.5, '#c699ff'],
      ['bump', 4.5, 5.2, .6, '#ff78bc'], ['kick', '#ffffff']]],
  ];
  const templateSpec = ([name, items, extra]) => ({ v: 1, name, items, ...(extra || {}) });
  const demo = () => fromSpec(templateSpec(TEMPLATES[1]));

  // ---- history ------------------------------------------------------------------------------------------
  const snapshot = () => JSON.stringify(toSpec());
  function commit() {
    const now = snapshot();
    if (history.at(-1) === now) return;
    history.push(now); future = [];
    if (history.length > 100) history.shift();
    try { localStorage.setItem(STORE, now); } catch {}
    refresh();
  }
  function restore(text) { state = fromSpec(JSON.parse(text)); sel = -1; try { localStorage.setItem(STORE, text); } catch {} refresh(); }
  $('peUndo').onclick = () => { if (history.length > 1) { future.push(history.pop()); restore(history.at(-1)); } };
  $('peRedo').onclick = () => { if (future.length) { const t = future.pop(); history.push(t); restore(t); } };
  addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); (e.shiftKey ? $('peRedo') : $('peUndo')).click(); }
    else if (!typing && (e.key === 'Delete' || e.key === 'Backspace') && sel >= 0) { e.preventDefault(); removeSel(); }
  });

  // ---- drawing ------------------------------------------------------------------------------------------
  function fit() {
    const stage = canvas.parentElement, pad = 8;          // the board is sized to the stage, so the whole cabinet is visible
    const w = Math.max(160, (stage.clientWidth || 380) - pad), h = Math.max(272, (stage.clientHeight || 700) - pad);
    const cssW = Math.max(160, Math.min(w, h / 1.7)) * zoom;
    const dpr = devicePixelRatio || 1;
    canvas.style.width = cssW + 'px'; canvas.style.height = cssW * 1.7 + 'px';
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssW * 1.7 * dpr);
    scale = canvas.width / W;
    draw();
  }
  const seg = (x1, y1, x2, y2, color, width) => {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.stroke();
  };
  const poly = (points, color, width) => {
    ctx.beginPath(); points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  };
  const disc = (x, y, r, fill, stroke) => {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = .05; ctx.stroke(); }
  };
  const arrow = (x, y, dx, dy, color) => {                 // a small arrowhead at (x, y) pointing along (dx, dy)
    const n = Math.hypot(dx, dy) || 1, ux = dx / n, uy = dy / n;
    ctx.beginPath(); ctx.moveTo(x + ux * .3, y + uy * .3); ctx.lineTo(x - uy * .2 - ux * .1, y + ux * .2 - uy * .1); ctx.lineTo(x + uy * .2 - ux * .1, y - ux * .2 - uy * .1);
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  };
  function draw() {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1b1a44'); bg.addColorStop(.5, '#3b2260'); bg.addColorStop(1, '#2a1740');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#00000040'; ctx.fillRect(8.8, 0, 1.2, H);          // the shooter lane
    if (snap) {                                                         // grid dots
      ctx.fillStyle = '#ffffff18';
      for (let gx = .25; gx < 10; gx += .5) for (let gy = .25; gy < 17; gy += .5) ctx.fillRect(gx - .012, gy - .012, .025, .025);
    }
    ctx.fillStyle = '#ffffff0c'; ctx.fillRect(X[0] - .1, Y[1], X[1] - X[0] + .2, 14.95 - Y[1] + .5);   // too close to the flippers
    for (const r of RAILS) { seg(...r, '#17152f', .3); seg(...r, '#c1d2e5', .14); }
    seg(8.8, 1.2, 8.8, 3.1, '#ffd383', .1);                              // the one-way gate
    for (const [fx, fy, a] of FLIPS) { seg(fx, fy, fx + FLIP_LEN * Math.cos(a), fy + FLIP_LEN * Math.sin(a), '#211b40', .5); seg(fx, fy, fx + FLIP_LEN * Math.cos(a), fy + FLIP_LEN * Math.sin(a), '#42cfeb', .32); }
    if (state.kick) for (const x of [.9, 7.9]) { disc(x, 13.9, .2, '#ffd383'); }
    state.items.forEach((it, i) => { if (shown(it)) { drawItem(it, i === sel); if (group.size > 1 && group.has(i)) { const [gx, gy] = centre(it); ctx.setLineDash([.1, .08]); disc(gx, gy, .55, null, '#ffb703'); ctx.setLineDash([]); } } });
    ctx.fillStyle = '#ffffff55'; ctx.font = '.32px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('DRAIN', 5, 16.6); ctx.fillText('LAUNCH', 9.4, 12);
  }
  const rampCurve = (it) => Array.from({ length: 25 }, (_, i) => { const t = i / 24; return [it.x + (it.x2 - it.x) * t, it.y + (it.y2 - it.y) * t - 4.8 * Math.sin(Math.PI * t)]; });
  function exitDir(x, y) { const dx = 5 - x, dy = 6, n = Math.hypot(dx, dy); return [dx / n, dy / n]; }
  function drawItem(it, on) {
    const d = KINDS[it.k], glow = on ? '#ffffff' : null;
    if (it.k === 'ramp') {
      poly(rampCurve(it), '#252049', .34); poly(rampCurve(it), it.c + 'aa', .1);
      seg(it.x - .65, it.y, it.x + .65, it.y, it.c, .08);                 // the entry gate the ball must pass
      disc(it.x, it.y, .22, it.c); disc(it.x2, it.y2, .2, '#0c0a1c', it.c);
      arrow(it.x, it.y - .45, 0, -1, it.c);
      if (on) { poly(rampCurve(it), '#ffffff44', .3); }
    } else if (it.k === 'subway') {
      ctx.setLineDash([.14, .14]); seg(it.x, it.y, it.x2, it.y2, it.c + '99', .08); ctx.setLineDash([]);
      disc(it.x, it.y, .37, it.c); disc(it.x, it.y, .3, '#0c0a1c');
      disc(it.x2, it.y2, .3, '#0c0a1c', it.c);
      const [ux, uy] = exitDir(it.x2, it.y2); arrow(it.x2 + ux * .5, it.y2 + uy * .5, ux, uy, it.c);
      if (on) disc(it.x, it.y, .5, null, glow);
    } else if (it.k === 'orbit') {
      poly(it.pts, '#252049', .24); poly(it.pts, it.c, .09);
      disc(it.pts[0][0], it.pts[0][1], .4, '#0c0a1c', it.c);
      const [lx, ly] = it.pts.at(-1), [ux, uy] = exitDir(lx, ly); arrow(lx + ux * .35, ly + uy * .35, ux, uy, it.c);
      if (on) poly(it.pts, '#ffffff44', .3);
    } else if (it.k === 'rubber') {
      seg(it.x, it.y, it.x2, it.y2, '#252049', .24); seg(it.x, it.y, it.x2, it.y2, it.c, .15);
      if (on) seg(it.x, it.y, it.x2, it.y2, '#ffffff55', .3);
    } else if (it.k === 'mover') {
      ctx.setLineDash([.08, .1]); seg(it.x, it.y, it.x2, it.y2, '#ffffff55', .04); ctx.setLineDash([]);
      const mx = (it.x + it.x2) / 2, my = (it.y + it.y2) / 2, nx = it.y2 - it.y, ny = it.x - it.x2, n = Math.hypot(nx, ny) || 1;
      seg(mx - nx / n * .3, my - ny / n * .3, mx + nx / n * .3, my + ny / n * .3, '#252049', .38); seg(mx - nx / n * .3, my - ny / n * .3, mx + nx / n * .3, my + ny / n * .3, it.c, .28);
      disc(it.x, it.y, .1, '#fff0ca'); disc(it.x2, it.y2, .1, '#fff0ca');
      if (on) seg(it.x, it.y, it.x2, it.y2, '#ffffff44', .3);
    } else if (it.k === 'hole') {
      disc(it.x, it.y, it.r + .07, '#252049'); disc(it.x, it.y, it.r, '#0c0a1c', it.c);
      const a = Math.atan2(6, 5 - it.x); arrow(it.x + Math.cos(a) * (it.r + .3), it.y + Math.sin(a) * (it.r + .3), Math.cos(a), Math.sin(a), it.c);
      if (on) disc(it.x, it.y, it.r + .16, null, glow);
    } else if (it.k === 'flip') {
      const left = it.x < W * .44, a0 = left ? .3 : Math.PI - .3, ex = it.x + FLIP_LEN * Math.cos(a0), ey = it.y + FLIP_LEN * Math.sin(a0);
      seg(it.x, it.y, ex, ey, '#211b40', .5); seg(it.x, it.y, ex, ey, left ? '#42cfeb' : '#ff78bc', .32); disc(it.x, it.y, .2, '#fff0ca');
      if (on) disc(it.x, it.y, .5, null, glow);
    } else if (GLYPH[it.k]) {
      ctx.save(); ctx.translate(it.x, it.y); glyphPath(it.k, it.r); ctx.globalAlpha = .7; ctx.fillStyle = ctx.strokeStyle = it.c; ctx.lineWidth = it.r * .16;
      it.k === 'ring' ? ctx.stroke() : ctx.fill(); ctx.restore();
      if (on) disc(it.x, it.y, it.r + .1, null, glow);
    } else if (d.shape === 'pr') {
      if (it.k === 'magnet') { ctx.setLineDash([.12, .12]); disc(it.x, it.y, it.r, '#59edd214', '#59edd2'); ctx.setLineDash([]); disc(it.x, it.y, .16, it.c); }
      else if (it.k === 'saucer') { disc(it.x, it.y, it.r + .07, '#252049'); disc(it.x, it.y, it.r, '#0c0a1c', it.c); }
      else if (it.k === 'post') { disc(it.x, it.y, it.r + .05, '#252049'); disc(it.x, it.y, it.r, it.c); }
      else { disc(it.x, it.y, it.r + .1, '#fff3a8'); disc(it.x, it.y, it.r + .02, '#211c3d'); disc(it.x, it.y, it.r - .08, it.c); disc(it.x, it.y, .18, '#fff0ca'); }
      if (on) disc(it.x, it.y, it.r + .16, null, glow);
    } else if (d.shape === 'a') {
      const curve = arcCurve(it);
      poly(curve, '#17152f', .3); poly(curve, it.c, .14);
      if (on) { poly(curve, '#ffffff55', .3); ctx.setLineDash([.1, .1]); seg(it.x, it.y, it.cx, it.cy, '#ffffff55', .03); seg(it.x2, it.y2, it.cx, it.cy, '#ffffff55', .03); ctx.setLineDash([]); }
    } else if (it.k === 'flap') {
      seg(it.x, it.y, it.x2, it.y2, '#17152f', .2); seg(it.x, it.y, it.x2, it.y2, it.c, .09); disc(it.x, it.y, .1, '#fff0ca');
      const mx = (it.x + it.x2) / 2, my = (it.y + it.y2) / 2, nx = (it.y2 - it.y), ny = -(it.x2 - it.x), n = Math.hypot(nx, ny) || 1;
      arrow(mx + nx / n * .35, my + ny / n * .35, -nx, -ny, it.c);                       // the way the ball may pass
      if (on) seg(it.x, it.y, it.x2, it.y2, '#ffffff55', .3);
    } else if (it.k === 'portal') {
      ctx.setLineDash([.12, .12]); seg(it.x, it.y, it.x2, it.y2, it.c + '55', .05); ctx.setLineDash([]);
      for (const [px, py] of [[it.x, it.y], [it.x2, it.y2]]) { disc(px, py, .42, '#252049'); disc(px, py, .32, '#0c0a1c', it.c); disc(px, py, .16, null, it.c); }
      if (on) for (const [px, py] of [[it.x, it.y], [it.x2, it.y2]]) disc(px, py, .5, null, glow);
    } else if (d.shape === 's') {
      const w = it.k === 'wall' ? .14 : it.k === 'target' ? .28 : .23;
      if (it.k !== 'wall') seg(it.x, it.y, it.x2, it.y2, '#252049', w + .1);
      seg(it.x, it.y, it.x2, it.y2, it.c, w);
      if (on) seg(it.x, it.y, it.x2, it.y2, '#ffffff55', w + .16);
    } else if (it.k === 'spinner') {
      disc(it.x, it.y, .18, '#c1d2e522'); seg(it.x - .47, it.y, it.x + .47, it.y, it.c, .14);
      if (on) disc(it.x, it.y, .6, null, glow);
    } else {
      disc(it.x, it.y, .26, '#252049'); disc(it.x, it.y, .2, it.c);
      if (on) disc(it.x, it.y, .34, null, glow);
    }
    if (on) handles(it).forEach(([hx, hy], i) => disc(hx, hy, .17, d.shape === 'w' && i === 0 ? '#ffffff' : '#ffb703', '#1a1630'));
  }
  const arcCurve = (it) => Array.from({ length: 21 }, (_, i) => { const t = i / 20, u = 1 - t;
    return [u * u * it.x + 2 * u * t * it.cx + t * t * it.x2, u * u * it.y + 2 * u * t * it.cy + t * t * it.y2]; });
  function glyphPath(g, u) {      // same shapes the game paints under the glass
    ctx.beginPath();
    if (g === 'star') for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? u * .45 : u; ctx[i ? 'lineTo' : 'moveTo'](r * Math.cos(a), r * Math.sin(a)); }
    else if (g === 'heart') { ctx.moveTo(0, u * .85); ctx.bezierCurveTo(-u * 1.3, u * .1, -u * .55, -u * .9, 0, -u * .3); ctx.bezierCurveTo(u * .55, -u * .9, u * 1.3, u * .1, 0, u * .85); }
    else if (g === 'bolt') { ctx.moveTo(u * .2, -u); ctx.lineTo(-u * .55, u * .1); ctx.lineTo(-u * .05, u * .1); ctx.lineTo(-u * .2, u); ctx.lineTo(u * .55, -u * .2); ctx.lineTo(u * .05, -u * .2); }
    else if (g === 'diamond') { ctx.moveTo(0, -u); ctx.lineTo(u * .65, 0); ctx.lineTo(0, u); ctx.lineTo(-u * .65, 0); }
    else if (g === 'moon') { ctx.arc(0, 0, u, -Math.PI * .1, Math.PI * 1.1, false); ctx.arc(u * .38, -u * .1, u * .8, Math.PI * .85, -Math.PI * .2, true); }
    else { ctx.arc(0, 0, u, 0, Math.PI * 2); ctx.moveTo(u * .62, 0); ctx.arc(0, 0, u * .62, 0, Math.PI * 2); }
    ctx.closePath();
  }
  function handles(it) {
    const d = KINDS[it.k];
    if (d.shape === 'a') return [[it.x, it.y], [it.x2, it.y2], [it.cx, it.cy]];
    if (d.shape === 'pr') return [[it.x + it.r, it.y]];
    if (d.shape === 's') return [[it.x, it.y], [it.x2, it.y2]];
    if (d.shape === 'w') return it.pts;
    return [];
  }

  // ---- hit testing and dragging -------------------------------------------------------------------------
  const world = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H]; };
  function distSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, t = clamp(((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
  }
  // every part under the pointer, best first: round parts and short ones beat long lines and wires that happen to pass under them
  function hitList(px, py) {
    const found = [];
    state.items.forEach((it, i) => {
      if (!shown(it)) return;
      const d = KINDS[it.k];
      let dist = 99, weight = 0;
      if (d.shape === 'pr') { dist = Math.hypot(px - it.x, py - it.y); if (!(dist <= (it.k === 'magnet' ? Math.min(it.r, .5) : it.r + .1))) return; }
      else if (it.k === 'ramp') { const c = rampCurve(it); dist = Math.min(...c.slice(1).map(([x, y], j) => distSeg(px, py, c[j][0], c[j][1], x, y))); weight = 2; if (dist > .2) return; }
      else if (d.shape === 'a') { const c = arcCurve(it); dist = Math.min(...c.slice(1).map(([x, y], j) => distSeg(px, py, c[j][0], c[j][1], x, y))); weight = 1; if (dist > .25) return; }
      else if (d.shape === 'w') { dist = Math.min(...it.pts.map(([x, y], j) => (j ? distSeg(px, py, it.pts[j - 1][0], it.pts[j - 1][1], x, y) : 9)), ...it.pts.map(([x, y]) => Math.hypot(px - x, py - y) - .15)); weight = 2; if (dist > .18) return; }
      else if (it.k === 'subway' || it.k === 'portal') { dist = Math.min(Math.hypot(px - it.x, py - it.y), Math.hypot(px - it.x2, py - it.y2)) - .1; weight = 0; if (dist > .32) return; }      // the dotted run underneath is not clickable
      else if (d.shape === 's') { dist = Math.min(distSeg(px, py, it.x, it.y, it.x2, it.y2), Math.hypot(px - it.x, py - it.y) - .1); weight = 1; if (dist > .28) return; }
      else if (it.k === 'spinner') { if (!(Math.abs(px - it.x) <= .55 && Math.abs(py - it.y) <= .3)) return; dist = Math.hypot(px - it.x, py - it.y) * .5; }
      else { dist = Math.hypot(px - it.x, py - it.y); if (dist > .38) return; }
      found.push({ i, weight, dist, order: i });
    });
    found.sort((p, q) => p.weight - q.weight || p.dist - q.dist || q.order - p.order);
    return found.map((f) => f.i);
  }
  const hit = (px, py) => hitList(px, py)[0] ?? -1;
  let lastTap = null;        // a quick second tap on the same spot steps through the parts stacked there

  canvas.addEventListener('pointerdown', (e) => {
    const [px, py] = world(e);
    const pad = Math.max(.3, 14 * (devicePixelRatio || 1) / scale);
    if (sel >= 0) {
      const h = handles(state.items[sel]).findIndex(([hx, hy]) => Math.hypot(px - hx, py - hy) <= pad);
      if (h >= 0) { drag = { mode: 'handle', h }; canvas.setPointerCapture(e.pointerId); return; }
    }
    const stack = hitList(px, py);
    let i = stack[0] ?? -1;
    if (stack.length > 1 && lastTap && performance.now() - lastTap.t < 600 && Math.hypot(px - lastTap.x, py - lastTap.y) < .2 && stack.includes(sel)) i = stack[(stack.indexOf(sel) + 1) % stack.length];
    lastTap = { x: px, y: py, t: performance.now() };
    if (e.shiftKey && i >= 0) {
      if (sel >= 0) group.add(sel);
      if (group.has(i) && group.size > 1) group.delete(i); else group.add(i);
      sel = i; refresh(); return;
    }
    if (!group.has(i)) group.clear();
    sel = i;
    if (i >= 0) { drag = { mode: 'move', dx: px - state.items[i].x, dy: py - state.items[i].y }; canvas.setPointerCapture(e.pointerId); }
    refresh(false);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || sel < 0) return;
    const it = state.items[sel], d = KINDS[it.k], [px, py] = world(e);
    if (drag.mode === 'handle') {
      if (d.shape === 'pr') it.r = round2(clamp(Math.hypot(px - it.x, py - it.y), ...d.r));
      else if (d.shape === 'w') { it.pts[drag.h] = [grid(px), grid(py)]; normalize(it); }
      else if (d.shape === 'a' && drag.h === 2) { it.cx = grid(px); it.cy = grid(py); normalize(it); }
      else {
        if (drag.h === 0) { it.x = grid(px); it.y = grid(py); } else { it.x2 = grid(px); it.y2 = grid(py); }
        normalize(it);
      }
    } else {
      const nx = grid(px - drag.dx), ny = grid(py - drag.dy), sx = nx - it.x, sy = ny - it.y;
      if (d.shape === 's') { it.x2 += sx; it.y2 += sy; it.x = nx; it.y = ny; }
      else if (d.shape === 'a') { it.x2 += sx; it.y2 += sy; it.cx += sx; it.cy += sy; it.x = nx; it.y = ny; }
      else if (d.shape === 'w') it.pts = it.pts.map(([x, y]) => [x + sx, y + sy]);
      else { it.x = nx; it.y = ny; }
      normalize(it);
      if (group.size > 1) for (const g of group) if (g !== sel && state.items[g]) { mapPts(state.items[g], ([x, y]) => [x + sx, y + sy]); normalize(state.items[g]); }
    }
    draw(); fillInspector();
  });
  const endDrag = () => { if (drag) { drag = null; commit(); } };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---- palette (pointer-based drag so it works with touch too) ------------------------------------------
  const TABS = ['All', 'Scoring', 'Walls & guides', 'Mechanisms', 'Decals'];
  let tab = 'All', query = '';
  const groupOf = (k) => KINDS[k].group || GROUPS[k] || 'Scoring';
  function buildPalette() {
    const tabs = $('peTabs'), box = $('pePalette');
    tabs.textContent = ''; box.textContent = '';
    for (const t of TABS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pe-tab'; b.textContent = t; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(t === tab));
      b.onclick = () => { tab = t; buildPalette(); refresh(false); };
      tabs.append(b);
    }
    const order = TABS.slice(1), q = query.trim().toLowerCase();
    const list = Object.entries(KINDS)
      .filter(([k, d]) => (tab === 'All' || groupOf(k) === tab) && (!q || (d.label + ' ' + groupOf(k)).toLowerCase().includes(q)))
      .sort((a, b) => order.indexOf(groupOf(a[0])) - order.indexOf(groupOf(b[0])));
    let group = '';
    for (const [k, d] of list) {
      const g = groupOf(k);
      if (tab === 'All' && g !== group) { group = g; const h = document.createElement('h3'); h.className = 'pe-group'; h.textContent = g; box.append(h); }
      const b = document.createElement('button');
      b.className = 'pe-part'; b.type = 'button'; b.dataset.kind = k; b.title = d.hint || d.label;
      b.innerHTML = `<span class="pe-icon">${d.icon}</span><span>${d.label}</span><small></small>`;
      b.addEventListener('pointerdown', (e) => startPaletteDrag(e, k, b));
      box.append(b);
    }
    if (!list.length) { const p = document.createElement('p'); p.className = 'pe-none'; p.textContent = 'No parts match.'; box.append(p); }
  }
  $('peSearch').oninput = () => { query = $('peSearch').value; buildPalette(); refresh(false); };
  function startPaletteDrag(e, k, button) {
    if (button.disabled || e.button > 0) return;
    e.preventDefault();
    const ghost = document.createElement('div');
    ghost.className = 'pe-ghost'; ghost.textContent = KINDS[k].icon + ' ' + KINDS[k].label;
    document.body.append(ghost);
    const startX = e.clientX, startY = e.clientY;
    const move = (ev) => { ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px'; };
    move(e);
    const done = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', done); ghost.remove(); };
    const up = (ev) => {
      done();
      const r = canvas.getBoundingClientRect();
      const over = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      const tapped = Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6;
      if (over) addPart(k, ...world(ev)); else if (tapped) addPart(k, 4.4 + (count(k) % 4) * .5, 7 + (state.items.length % 6) * .6);
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', done);
  }
  function addPart(k, x, y) {
    const d = KINDS[k];
    if (count(k) >= d.max) return say(`A table can have ${d.max} ${d.label.toLowerCase()}${d.max > 1 ? 's' : ''}.`);
    if (state.items.length >= MAX_PARTS) return say('That is a lot of parts. Remove some first.');
    state.items.push(make(k, grid(x), grid(y)));
    sel = state.items.length - 1;
    say('');
    commit();
  }
  function removeSel() { const all = selected(); if (!all.length) return; for (const i of all.reverse()) state.items.splice(i, 1); sel = -1; group.clear(); commit(); }

  // ---- inspector ----------------------------------------------------------------------------------------
  function fillInspector() {
    const it = state.items[sel];
    $('peFields').hidden = !it; $('peHint').hidden = !!it;
    $('peTitle').textContent = it ? `${KINDS[it.k].icon} ${KINDS[it.k].label}` : 'Nothing selected';
    if (!it) return;
    const d = KINDS[it.k], segment = d.shape === 's' || d.shape === 'a', wire = d.shape === 'w';
    const cx = segment ? (it.x + it.x2) / 2 : it.x, cy = segment ? (it.y + it.y2) / 2 : it.y;
    $('peX').value = round2(cx); $('peY').value = round2(cy);
    $('peSizeRow').hidden = d.shape === 'p' || wire;
    $('peSizeLabel').textContent = segment ? 'Length' : it.k === 'magnet' ? 'Pull radius' : 'Radius';
    $('peSize').value = round2(segment ? Math.hypot(it.x2 - it.x, it.y2 - it.y) : it.r || 0);
    $('peAngleRow').hidden = !segment;
    if (segment) $('peAngle').value = Math.round(Math.atan2(it.y2 - it.y, it.x2 - it.x) * 180 / Math.PI);
    $('pePointRow').hidden = !wire;
    if (wire) { $('peAddPt').disabled = it.pts.length >= 6; $('peDelPt').disabled = it.pts.length <= 2; }
    $('peKindHint').textContent = d.hint || ''; $('peKindHint').hidden = !d.hint;
    $('peColorRow').hidden = $('peSwatches').hidden = !d.paint;
    $('peColor').value = it.c;
    for (const c of document.querySelectorAll('#peModes input')) c.checked = !!((it.modes ?? 15) & +c.dataset.bit);
    $('pePvRow').hidden = !OWN_POINTS.has(it.k);
    if (OWN_POINTS.has(it.k)) { $('pePv').value = Number.isFinite(it.pv) ? it.pv : ''; $('pePv').placeholder = String(POINTS[it.k === 'bump' ? 'bumper' : it.k][0]); }
    $('peDup').disabled = count(it.k) >= d.max;
    $('peRotL').disabled = $('peRotR').disabled = d.shape === 'p' || d.shape === 'pr';
  }
  function editSel(fn) { const it = state.items[sel]; if (!it) return; fn(it, KINDS[it.k]); normalize(it); draw(); commit(); }
  const num = (id) => { const v = parseFloat($(id).value); return isFinite(v) ? v : null; };
  function reposition(it, d) {
    const x = num('peX'), y = num('peY');
    if (x === null || y === null) return;
    if (d.shape === 'a') { const sx = x - (it.x + it.x2) / 2, sy = y - (it.y + it.y2) / 2; mapPts(it, ([px, py]) => [px + sx, py + sy]); }
    else if (d.shape === 's') { const hx = (it.x2 - it.x) / 2, hy = (it.y2 - it.y) / 2; it.x = x - hx; it.y = y - hy; it.x2 = x + hx; it.y2 = y + hy; }
    else if (d.shape === 'w') { const sx = x - it.x, sy = y - it.y; it.pts = it.pts.map(([px, py]) => [px + sx, py + sy]); }
    else { it.x = x; it.y = y; }
  }
  $('peX').onchange = $('peY').onchange = () => editSel(reposition);
  const turn = (it, length, angle) => {     // rebuild a segment about its midpoint
    if ('cx' in it) {                        // a curved wall turns as a whole
      const mx = (it.x + it.x2) / 2, my = (it.y + it.y2) / 2, cur = Math.atan2(it.y2 - it.y, it.x2 - it.x), old = Math.hypot(it.x2 - it.x, it.y2 - it.y) || 1;
      const k = length / old, da = angle - cur, co = Math.cos(da), si = Math.sin(da);
      mapPts(it, ([px, py]) => [mx + ((px - mx) * co - (py - my) * si) * k, my + ((px - mx) * si + (py - my) * co) * k]);
      return;
    }
    const mx = (it.x + it.x2) / 2, my = (it.y + it.y2) / 2, h = length / 2;
    it.x = mx - h * Math.cos(angle); it.y = my - h * Math.sin(angle); it.x2 = mx + h * Math.cos(angle); it.y2 = my + h * Math.sin(angle);
  };
  $('peSize').onchange = () => editSel((it, d) => {
    const v = num('peSize'); if (v === null) return;
    if (d.shape === 'pr') it.r = v;
    else turn(it, clamp(v, ...segRange(it.k)), Math.atan2(it.y2 - it.y, it.x2 - it.x));
  });
  $('peAngle').onchange = () => editSel((it) => {
    const deg = num('peAngle'); if (deg === null) return;
    turn(it, Math.hypot(it.x2 - it.x, it.y2 - it.y), deg * Math.PI / 180);
  });
  $('peAddPt').onclick = () => editSel((it) => {
    if (it.pts.length >= 6) return;
    const [ax, ay] = it.pts.at(-2), [bx, by] = it.pts.at(-1);
    it.pts.push([bx + (bx - ax || 1) * .8, by + (by - ay) * .8 - .4]);
  });
  $('peDelPt').onclick = () => editSel((it) => { if (it.pts.length > 2) it.pts.pop(); });
  $('peColor').oninput = () => { const it = state.items[sel]; if (it) { it.c = $('peColor').value; draw(); } };
  $('peColor').onchange = () => editSel((it) => { it.c = $('peColor').value; });
  $('pePrev').onclick = () => step(-1); $('peNext').onclick = () => step(1);
  $('pePv').onchange = () => editSel((it) => { const v = parseInt($('pePv').value, 10); if (Number.isFinite(v)) it.pv = clamp(v, 0, 20000); else delete it.pv; });
  for (const c of document.querySelectorAll('#peModes input')) c.onchange = () => editSel((it) => {
    let mask = 0;
    for (const x of document.querySelectorAll('#peModes input')) if (x.checked) mask |= +x.dataset.bit;
    if (!mask) { say('A part has to be active in at least one mode.'); return; }
    if (mask === 15) delete it.modes; else it.modes = mask;
  });
  $('peDel').onclick = removeSel;
  $('peDup').onclick = () => {                     // one part, or the whole shift-click group
    const picks = selected(), made = [], left = {};
    for (const i of picks) {
      const it = state.items[i];
      left[it.k] ??= KINDS[it.k].max - count(it.k);
      if (!it || left[it.k]-- <= 0 || state.items.length + made.length >= MAX_PARTS) continue;
      const c = copy(it);
      mapPts(c, ([x, y]) => [x + .5, y + .5]);
      made.push(normalize(c));
    }
    if (!made.length) return say('No room for copies of that.');
    group.clear();
    for (const c of made) { state.items.push(c); group.add(state.items.length - 1); }
    sel = state.items.length - 1; if (made.length < 2) group.clear();
    commit();
  };
  // ---- transform tools: rotate, mirror, nudge, target bank ---------------------------------------------------
  const MID = W * .44;                                                       // the playfield's middle line (inside the shooter lane)
  function rotateSel(deg) {
    const it = state.items[sel]; if (!it) return;
    const a = deg * Math.PI / 180, co = Math.cos(a), si = Math.sin(a), [mx, my] = centre(it);
    mapPts(it, ([x, y]) => [mx + (x - mx) * co - (y - my) * si, my + (x - mx) * si + (y - my) * co]);
    normalize(it); draw(); commit();
  }
  const mirrored = (it) => mapPts(copy(it), ([x, y]) => [2 * MID - x, y]);
  function mirrorSel() {                      // flip the part left <-> right in place
    const it = state.items[sel]; if (!it) return;
    mapPts(it, ([x, y]) => [2 * MID - x, y]);
    normalize(it); draw(); commit();
  }
  function mirrorTable() {                    // copy the left half onto the right half (parts that only come once stay put)
    const keep = state.items.filter((i) => centre(i)[0] <= MID + .01);
    const out = keep.slice();
    for (const it of keep) {
      if (Math.abs(centre(it)[0] - MID) < .15 || KINDS[it.k].max === 1) continue;
      const m = normalize(mirrored(it));
      if (out.filter((i) => i.k === m.k).length < KINDS[m.k].max && out.length < MAX_PARTS) out.push(m);
    }
    state.items = out; sel = -1; commit(); say('Left half mirrored onto the right.');
  }
  function nudgeSel(dx, dy) { for (const i of selected()) { const it = state.items[i]; mapPts(it, ([x, y]) => [x + dx, y + dy]); normalize(it); } draw(); fillInspector(); commit(); }
  function addBank() {                        // five standup targets in a tidy column, one placement
    const room = KINDS.target.max - count('target'), n = Math.min(5, room);
    if (n < 2) return say('Not enough room for a target bank (a table can have 8 targets).');
    const x = 1.25, y0 = 6.2;
    for (let i = 0; i < n; i++) { const it = make('target', x, y0 + i * .9); it.y2 = it.y + .7; state.items.push(normalize(it)); }
    sel = state.items.length - 1; commit(); say(`A bank of ${n} targets: clear them all to light the ramp.`);
  }
  $('peRotL').onclick = () => rotateSel(-15); $('peRotR').onclick = () => rotateSel(15);
  $('peMirror').onclick = mirrorSel; $('peMirrorAll').onclick = mirrorTable; $('peBank').onclick = addBank;
  addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {
      e.preventDefault(); group.clear(); state.items.forEach((it, i) => { if (shown(it)) group.add(i); }); sel = group.size ? [...group][0] : -1; refresh(); return;
    }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.ctrlKey || e.metaKey) return;
    if (e.key === ']' || e.key === '[') { e.preventDefault(); step(e.key === ']' ? 1 : -1); return; }
    if (sel < 0) return;
    const amount = e.shiftKey ? .25 : .05, k = e.key;
    if (k === 'ArrowLeft') nudgeSel(-amount, 0); else if (k === 'ArrowRight') nudgeSel(amount, 0);
    else if (k === 'ArrowUp') nudgeSel(0, -amount); else if (k === 'ArrowDown') nudgeSel(0, amount);
    else if (k === 'r' || k === 'R') rotateSel(e.shiftKey ? -15 : 15); else if (k === 'm' || k === 'M') mirrorSel();
    else if (k === 'd' || k === 'D') $('peDup').click(); else return;
    e.preventDefault();
  });
  $('peZoom').onclick = () => { zoom = zoom >= 2 ? 1 : zoom + .5; $('peZoom').textContent = `🔍 ${zoom}×`; fit(); };
  $('peName').oninput = () => { state.name = $('peName').value; };
  $('peName').onchange = commit;
  $('peLock').onchange = () => { state.lock = $('peLock').checked; commit(); };
  $('peKick').onchange = () => { state.kick = $('peKick').checked; commit(); };
  $('peSnap').onclick = () => { snap = !snap; $('peSnap').setAttribute('aria-pressed', String(snap)); draw(); };
  $('peClear').onclick = () => { if (!state.items.length && !state.kick) return; if (confirm('Remove every part from this table?')) { state.items = []; state.kick = false; state.lock = false; state.pts = {}; sel = -1; commit(); } };

  function renderList() {
    const ol = $('peList'), n = state.items.length;
    $('peListSum').textContent = `Parts on the table (${n})`;
    $('peNavCount').textContent = n ? (sel >= 0 ? `${sel + 1} of ${n}` : `${n} parts`) : 'no parts yet';
    ol.textContent = '';
    state.items.forEach((it, i) => {
      const d = KINDS[it.k], [cx, cy] = centre(it), li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.className = 'pe-pitem' + (i === sel ? ' on' : '') + (group.has(i) ? ' grp' : '') + (shown(it) ? '' : ' dim');
      b.innerHTML = `<span>${d.icon}</span><span>${d.label}</span><small>${cx.toFixed(1)}, ${cy.toFixed(1)}</small>`;
      b.onclick = (e) => { if (e.shiftKey) { if (sel >= 0) group.add(sel); group.add(i); } else group.clear(); sel = i; refresh(); };
      li.append(b); ol.append(li);
      if (i === sel) queueMicrotask(() => b.scrollIntoView({ block: 'nearest' }));
    });
    $('pePrev').disabled = $('peNext').disabled = n < 2;
  }
  function step(dir) {                       // walk through the parts one by one (skipping hidden layers)
    const n = state.items.length; if (!n) return;
    let i = sel;
    for (let k = 0; k < n; k++) { i = (i + dir + n) % n; if (shown(state.items[i])) break; }
    group.clear(); sel = i; refresh();
  }
  function refresh(redraw = true) {
    for (const b of document.querySelectorAll('.pe-part')) {
      const k = b.dataset.kind, d = KINDS[k];
      b.disabled = count(k) >= d.max;
      b.querySelector('small').textContent = `${count(k)}/${d.max}`;
    }
    $('peName').value = state.name; $('peKick').checked = state.kick; $('peLock').checked = state.lock;
    $('peUndo').disabled = history.length < 2; $('peRedo').disabled = !future.length;
    const bytes = new Blob([snapshot()]).size;
    $('peCount').textContent = `${state.items.length + (state.kick ? 1 : 0)} parts · ${bytes.toLocaleString()} of ${MAX_BYTES.toLocaleString()} bytes`;
    fillPoints();
    renderList();
    fillInspector();
    if (redraw) draw();
  }
  function fillPoints() {
    const body = $('pePtsBody');
    if (!body.children.length) for (const [k, [def, label]] of Object.entries(POINTS)) {
      const l = document.createElement('label'), i = document.createElement('input');
      l.textContent = label + ' '; i.type = 'number'; i.min = 0; i.max = 20000; i.step = 50; i.dataset.k = k;
      i.onchange = () => { const v = parseInt(i.value, 10); state.pts[k] = isFinite(v) ? clamp(v, 0, 20000) : def; commit(); };
      l.append(i); body.append(l);
    }
    for (const i of body.querySelectorAll('input')) if (document.activeElement !== i) i.value = state.pts?.[i.dataset.k] ?? POINTS[i.dataset.k][0];
  }
  for (const name of LAYERS) {
    const l = document.createElement('label'), c = document.createElement('input');
    c.type = 'checkbox'; c.checked = true; c.onchange = () => { c.checked ? hiddenLayers.delete(name) : hiddenLayers.add(name); if (sel >= 0 && !shown(state.items[sel])) sel = -1; refresh(); };
    l.append(c, ' ' + name); $('peLayersBody').append(l);
  }
  const swatches = $('peSwatches');
  for (const c of SWATCHES) {
    const b = document.createElement('button');
    b.type = 'button'; b.style.background = c; b.setAttribute('aria-label', 'Colour ' + c);
    b.onclick = () => { $('peColor').value = c; editSel((it) => { it.c = c; }); };
    swatches.append(b);
  }

  // ---- share codes --------------------------------------------------------------------------------------
  // PT1.<base64url of the deflated JSON> (PT0. when the browser can't compress); a pasted raw JSON table works too
  const b64 = (bytes) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const unb64 = (text) => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
  async function pipe(bytes, stream) {
    const out = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(out).arrayBuffer());
  }
  async function shareCode(spec) {
    const json = new TextEncoder().encode(JSON.stringify(spec));
    if (typeof CompressionStream === 'undefined') return 'PT0.' + b64(json);
    return 'PT1.' + b64(await pipe(json, new CompressionStream('deflate-raw')));
  }
  async function readCode(text) {
    text = text.trim();
    if (text.startsWith('{')) return JSON.parse(text);
    const [tag, body] = [text.slice(0, 4), text.slice(4).replace(/\s+/g, '')];
    if (tag === 'PT0.') return JSON.parse(new TextDecoder().decode(unb64(body)));
    if (tag === 'PT1.' && typeof DecompressionStream !== 'undefined') return JSON.parse(new TextDecoder().decode(await pipe(unb64(body), new DecompressionStream('deflate-raw'))));
    throw new Error("That isn't a table code.");
  }
  const dlg = $('peShareDlg');
  $('peShare').onclick = async () => { $('peShareText').value = await shareCode(toSpec()); dlg.showModal(); };
  $('peCopy').onclick = () => { $('peShareText').select(); try { navigator.clipboard?.writeText($('peShareText').value); } catch {} say('Copied.'); };
  $('peLoad').onclick = async () => {
    try { state = fromSpec(await readCode($('peShareText').value)); sel = -1; commit(); dlg.close(); say('Table loaded.'); }
    catch (e) { say(e instanceof SyntaxError || /atob|decode|inflate|deflate|Invalid/i.test(e.message) ? "That isn't a table code." : e.message); }
  };

  // ---- templates and saved tables -----------------------------------------------------------------------
  const readSlots = () => { try { return JSON.parse(localStorage.getItem(SLOTS)) || {}; } catch { return {}; } };
  const writeSlots = (slots) => { try { localStorage.setItem(SLOTS, JSON.stringify(slots)); } catch { say("Couldn't save: the browser's storage is full."); } };
  const tablesDlg = $('peTablesDlg');
  function listItem(name, detail, buttons, tip) {
    const row = document.createElement('div');
    row.className = 'pe-item';
    if (tip) row.title = tip;
    row.dataset.tip = tip || '';
    const label = document.createElement('span'); label.textContent = name;
    const small = document.createElement('small'); small.textContent = detail;
    row.append(label, small, ...buttons);
    if (tip) { const p = document.createElement('p'); p.className = 'pe-blurb'; p.textContent = tip; row.append(p); }
    return row;
  }
  const button = (text, onclick) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = onclick; return b; };
  function load(spec) { state = fromSpec(spec); sel = -1; commit(); tablesDlg.close(); say(`Loaded "${state.name || 'table'}".`); }
  function renderTables() {
    const templates = $('peTemplates'), saved = $('peSaved');
    templates.textContent = ''; saved.textContent = '';
    for (const t of TEMPLATES) templates.append(listItem(t[0], `${t[1].length} parts`, [button('Use', () => load(templateSpec(t)))], t[3]));
    const slots = readSlots(), names = Object.keys(slots);
    if (!names.length) { const p = document.createElement('p'); p.className = 'pe-empty'; p.textContent = 'Nothing saved yet. Name your table and press Save.'; saved.append(p); }
    for (const name of names) {
      saved.append(listItem(name, `${slots[name].items.length} parts`, [
        button('Open', () => load(slots[name])),
        button('Delete', () => { const s = readSlots(); delete s[name]; writeSlots(s); renderTables(); }),
      ]));
    }
  }
  $('peTables').onclick = () => { renderTables(); tablesDlg.showModal(); };
  $('peSaveAs').onclick = () => {
    const name = (state.name || '').trim() || prompt('Name this table:');
    if (!name) return;
    const slots = readSlots();
    if (!(name in slots) && Object.keys(slots).length >= 30) return say('You can keep up to 30 tables. Delete one first.');
    state.name = name.trim().slice(0, 40);
    slots[state.name] = toSpec();
    writeSlots(slots); commit(); renderTables(); say(`Saved "${state.name}".`);
  };

  // ---- play ---------------------------------------------------------------------------------------------
  async function post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({ error: 'Bad response' }));
    if (!r.ok) throw new Error(j.error || 'Request failed');
    return j;
  }
  $('pePlay').onclick = async () => {
    const spec = toSpec();
    if (new Blob([JSON.stringify(spec)]).size > MAX_BYTES) return say('This table is too big to play. Remove some parts.');
    const raw = JSON.stringify(spec).length;
    const code = raw > 2500 ? await shareCode(spec) : null;      // requests are capped at 10,000 bytes: big tables go as a deflated code
    if (code && code.length > MAX_CODE) return say('This table is too big to play. Remove some parts.');
    const stored = (() => { try { return JSON.parse(localStorage.getItem('unmask.name')); } catch { return null; } })();
    const name = (stored || prompt('Your name for the game:') || '').trim();
    if (!name) return say('Enter a name to play.');
    const play = $('pePlay');
    play.disabled = true; say('Starting your table…');
    try {
      const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      const act = (session, type, extra = {}) => post('/api/action', { ...session, type, ...extra, aid: id() });
      const table = code || spec;
      // coming back from the game: reuse the same room (every Play used to open a new one and hit the room limits)
      let session = null;
      try { session = JSON.parse(localStorage.getItem('unmask.session')); } catch {}
      const reuse = async () => {
        if (!session?.code || localStorage.getItem('pinball.editor.room') !== session.code) return false;     // only a room this editor made
        try {
          await act(session, 'end_game').catch(() => {});           // a game still running -> over
          await act(session, 'lobby').catch(() => {});              // over -> lobby (already there is fine)
          await act(session, 'settings', { settings: { game: 'pinball' } });
          await act(session, 'pinball_table', { table });
          await act(session, 'settings', { settings: { table: 'custom' } });
          await act(session, 'start');
          return true;
        } catch { return false; }
      };
      if (!(await reuse())) {
        session = await post('/api/create', { name, game: 'pinball' });
        try { localStorage.setItem('pinball.editor.room', session.code); } catch {}
        await act(session, 'pinball_table', { table });
        await act(session, 'settings', { settings: { table: 'custom' } });
        await act(session, 'start');
      }
      localStorage.setItem('unmask.session', JSON.stringify(session));
      localStorage.setItem('unmask.name', JSON.stringify(name));
      location.href = '/';
    } catch (e) { say(e.message); play.disabled = false; }
  };

  // ---- start --------------------------------------------------------------------------------------------
  buildPalette();
  try {
    const saved = localStorage.getItem(STORE);
    state = saved ? fromSpec(JSON.parse(saved)) : demo();
  } catch { state = demo(); }
  history = [snapshot()];
  new ResizeObserver(fit).observe(canvas.parentElement);
  addEventListener('resize', fit);
  refresh();
  fit();
  window.pinballEditor = { get state() { return state; }, toSpec, addPart, select: (i) => { sel = i; refresh(); }, shareCode, readCode };
})();
