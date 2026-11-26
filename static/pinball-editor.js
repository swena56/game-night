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
  const GLYPH = { star: ['⭐', 'Star'], heart: ['💗', 'Heart'], bolt: ['⚡', 'Bolt'], diamond: ['🔷', 'Diamond'], moon: ['🌙', 'Moon'], ring: ['⭕', 'Ring'], dot: ['🔴', 'Dot lamp'] };
  for (const [g, [icon, label]] of Object.entries(GLYPH)) KINDS[g] = { label: label + ' decal', icon, shape: 'pr', color: '#ffd383', r: g === 'dot' ? [.1, 1.6] : [.25, 1.6], r0: g === 'dot' ? .2 : .6, max: 12, paint: true, group: 'Decals',
    hint: 'Painted on the playfield under the glass. It only decorates: the ball rolls over it.' };
  // what each part is for (shown in the inspector when it is selected, and as the tooltip on its palette tile)
  const DESC = {
    bump: 'Pop bumper: kicks the ball away hard when it touches. Scores more the more you hit it (up to 3 levels), and double during a jackpot round.',
    sling: 'Slingshot: a rubber edge that fires the ball back when it is hit firmly; a gentle roll just bounces off. Put one above each flipper.',
    target: 'Standup target: drops flat when hit firmly. Clear every target on the table to light the ramp. Also lights the rollover lanes.',
    lane: 'Rollover lane: scores when the ball rolls over it. Light every lane to raise the bonus multiplier (up to 5x) and re-arm the kickback.',
    post: 'Rubber post: a small bouncy peg for steering the ball. Scores nothing. Its size is set in the Radius box, not by dragging.',
    wall: 'Wall or guide: a solid metal rail. Use it to channel the ball toward a shot, or to keep it away from somewhere.',
    arc: 'Curved wall: a smooth guide rail that bends. Drag the two end dots and the middle dot to shape it.',
    flap: 'One-way flap: the ball can pass through from one side only and cannot come back. The arrow shows the way through.',
    rubber: 'Rubber band: a bouncy dead-rubber wall. It kicks the ball back but scores nothing. Good for soft side walls.',
    spinner: 'Spinner: a flap that spins as the ball passes over it and scores for every spin. The faster the ball, the more spins.',
    saucer: 'Saucer: a dish that catches a slow ball, holds it for a moment, then kicks it back into play (+1,000).',
    hole: 'Kicker hole: swallows the ball, holds it, then fires it out down the table toward the middle (+1,000). Up to three per table.',
    magnet: 'Magnet: during jackpot rounds and multiball it grabs a ball in range and holds it briefly (+1,500). The circle is its reach.',
    ramp: 'Ramp: a raised lane. It lights once every target is cleared; a fast shot up the mouth scores 6,000 and starts a jackpot round.',
    subway: 'Subway: the ball drops in the mouth, travels under the playfield, and comes out the other end, fired down the table (+2,000).',
    orbit: 'Orbit wire: a lane the ball rides around the table. Shoot up into the funnel and it comes out the flared end (+3,000). Drag the grip to move the whole wire.',
    portal: 'Portal pair: two linked holes. A ball that rolls into one comes out of the other at the same speed (+250).',
    mover: 'Moving target: a target that slides back and forth along its track. A firm hit scores 300.',
    flip: 'Extra flipper: a mid-table flipper. Left of the middle it follows the left button, right of the middle the right button.',
  };
  for (const [k, text] of Object.entries(DESC)) if (KINDS[k]) KINDS[k].desc = text;
  for (const g of Object.keys(GLYPH)) KINDS[g].desc = 'Decal: a picture painted on the playfield under the glass. It only decorates: the ball rolls straight over it.';
  const GROUPS = { rubber: 'Walls & guides', wall: 'Walls & guides', post: 'Walls & guides', spinner: 'Mechanisms', saucer: 'Mechanisms', magnet: 'Mechanisms', ramp: 'Mechanisms', subway: 'Mechanisms', orbit: 'Mechanisms' };
  // table-wide choices (the production tables are built from these): [default, label]
  const FEEL = { gravity: [11, 'Gravity'], hurry_seconds: [8, 'Hurry-up seconds'], super_every: [4, 'Super jackpot every'], extra_balls: [[40000, 120000], 'Extra balls at'],
    classic_lamps: [false, 'Classic lamps'], steep_flippers: [false, 'Steeper flippers'] };
  // the table's own point values (defaults match the game's rules)
  const POINTS = { bumper: [100, 'Pop bumper'], sling: [50, 'Slingshot'], target: [250, 'Target'], lane: [500, 'Rollover lane'], spinner: [100, 'Spinner'],
    ramp: [6000, 'Ramp'], saucer: [1000, 'Saucer / kicker hole'], portal: [250, 'Portal'], mover: [300, 'Moving target'],
    bank_points: [2000, 'Target bank cleared (no ramp)'], jackpot: [12000, 'Jackpot'], hurry: [15000, 'Hurry-up top prize'] };
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
  const RAILS_CLASSIC = [[0, 17, 0, 2.2], [0, 2.2, 1.5, 0], [1.5, 0, 7.8, 0], [7.8, 0, 10, 2.8], [10, 2.8, 10, 17], [8.8, 3.1, 8.8, 17], [8.8, 16.25, 10, 16.25],
    [.9, 12.2, .9, 13.5], [.9, 13.5, 3.22, 14.95], [7.9, 12.4, 7.9, 13.8], [7.9, 13.8, 6.78, 14.95]];      // the original sharp cabinet of the production tables
  const FLIP_DEFAULT = [3.22, 14.95, 6.78, 14.95];
  const FLIP_LEN = 1.56;
  const flipPair = (rest, fl = FLIP_DEFAULT) => [[fl[0], fl[1], rest], [fl[2], fl[3], Math.PI - rest]];
  // where the two main flippers may sit (the server clamps the same way): the drain between the tips stays 0.5 to 1.5 wide
  function clampFlips(fl, rest) {
    let [lx, ly, rx, ry] = fl.map(Number);
    ly = clamp(ly, 14.3, 15.4); ry = clamp(ry, 14.3, 15.4);
    lx = clamp(lx, 2.4, 4); rx = clamp(rx, 6, 7.6);
    const gap = rx - lx - 2 * FLIP_LEN * Math.cos(rest), shift = (clamp(gap, .5, 1.5) - gap) / 2;
    lx = clamp(lx - shift, 2.4, 4); rx = clamp(rx + shift, 6, 7.6);
    return [round2(lx), round2(ly), round2(rx), round2(ry)];
  }
  const restOf = () => (state.feel?.steep_flippers ? .46 : .42);
  const flipsNow = () => state.flips || FLIP_DEFAULT;
  const GUIDE_LEN = fillet([[.9, 12.2], [.9, 13.5], [3.22, 14.95]], [.5]).length;
  // the cabinet rails: the inlane guides lead down to wherever the flippers are
  function cabinetRails() {
    // as on the server: each guide ends on top of its resting bat (radius .15), so there is no lip where they meet
    const [px, py, qx, qy] = flipsNow(), nx = .15 * Math.sin(restOf()), ny = .15 * Math.cos(restOf());
    const [lx, ly, rx, ry] = [px + nx, py - ny, qx - nx, qy - ny];
    if (state.cabinet === 'classic') return [...RAILS_CLASSIC.slice(0, 8), [.9, 13.5, lx, ly], RAILS_CLASSIC[9], [7.9, 13.8, rx, ry]];
    if (state.closed) {          // no side drains (as funnel_walls() on the server): one wall per side, from the cabinet onto the bat
      const funnel = [[0, 1, lx, ly], [8.8, -1, rx, ry]].flatMap(([wall, inward, ex, ey]) => {
        const cx = wall + .4 * inward, control = [cx, ey - Math.abs(ex - cx) * Math.tan(restOf())], start = [wall, control[1] - 2];
        const pts = Array.from({ length: 15 }, (_, i) => { const t = i / 14; return [0, 1].map((k) => (1 - t) ** 2 * start[k] + 2 * (1 - t) * t * control[k] + t * t * [ex, ey][k]); });
        return pts.slice(1).map((q, i) => [...pts[i], ...q]);
      });
      return [...RAILS.slice(0, RAILS.length - 2 * GUIDE_LEN), ...funnel];
    }
    return [...RAILS.slice(0, RAILS.length - 2 * GUIDE_LEN), ...fillet([[.9, 12.2], [.9, 13.5], [lx, ly]], [.5]), ...fillet([[7.9, state.even ? 12.2 : 12.4], [7.9, state.even ? 13.5 : 13.8], [rx, ry]], [.5])];
  }

  let state = { name: '', items: [], kick: false, lock: false, pts: {}, cabinet: 'smooth', look: 'custom', feel: {}, flips: null, even: false, closed: false, aim: false };
  let zoom = 1;
  const hiddenLayers = new Set();
  const group = new Set();                        // shift-click adds parts: duplicate, delete, nudge and drag then act on all of them
  const selected = () => {
    for (const i of [...group]) if (!state.items[i]) group.delete(i);       // an undo, load or delete can leave stale numbers behind
    return group.size > 1 ? [...group].sort((a, b) => a - b) : sel >= 0 && state.items[sel] ? [sel] : [];
  };
  const LAYERS = ['Scoring', 'Walls & guides', 'Mechanisms', 'Decals'];
  const layerOf = (k) => KINDS[k].group || GROUPS[k] || 'Scoring';
  const shown = (it) => !hiddenLayers.has(layerOf(it.k));
  let sel = -1;
  let snap = true;
  let history = [], future = [];
  let drag = null;
  const canvas = $('peCanvas'); let ctx = canvas.getContext('2d');
  let scale = 40;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const round2 = (v) => Math.round(v * 100) / 100;
  const grid = (v) => (snap ? Math.round(v / .25) * .25 : v);
  const count = (k) => state.items.filter((i) => i.k === k).length;
  const say = (text) => { $('peMsg').textContent = text || ''; };
  const copy = (o) => JSON.parse(JSON.stringify(o));
  let uidSeq = 0;                                  // a part's identity in memory, so lights can point at the part that triggers them
  const FX_MODES = ['steady', 'flash', 'cycle', 'pulse', 'twinkle'], FX_ON = ['always', 'timer', 'motion', 'hit', 'event'];
  const FX_EVENTS = ['bank', 'multiball', 'jackpot', 'save', 'tilt', 'hurry', 'skill', 'extra', 'mult', 'lock', 'mission', 'orbit', 'kickback', 'special', 'saucer', 'subway', 'magnet', 'drain'];
  const FX_TAG = { bump: 'bumper', sling: 'sling', target: 'target', lane: 'lane', mover: 'mover', spinner: 'spinner', ramp: 'ramp' };
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
    it.uid ||= ++uidSeq;
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
    if (state.cabinet === 'classic') out.cabinet = 'classic';
    if (state.flips) out.fl = state.flips.map(round2);
    if (state.even && state.cabinet !== 'classic') out.even_guides = true;
    if (state.closed && state.cabinet !== 'classic') out.closed_sides = true;
    if (state.aim) out.true_aim = true;
    if (state.look && state.look !== 'custom') out.look = state.look;
    const feel = {};
    for (const [k, v] of Object.entries(state.feel || {})) {
      const def = FEEL[k]?.[0];
      if (def === undefined) continue;
      if (k === 'extra_balls' ? (v[0] !== def[0] || v[1] !== def[1]) : v !== def && v !== false) feel[k] = v;
    }
    if (Object.keys(feel).length) out.feel = feel;
    const fx = [];
    const trigOut = (g) => {
      const o = { on: g.on };
      if (g.on === 'timer') { o.ev = round2(g.ev); o.du = round2(g.du); }
      if (g.on === 'motion') o.nr = round2(g.nr);
      if (g.on === 'event') o.gv = g.gv;
      if (g.on === 'hit') { if (typeof g.src === 'string') o.src = g.src; else { const src = state.items.findIndex((j) => j.uid === g.src); if (src >= 0) o.src = src; } }
      return o;
    };
    state.items.forEach((i, n) => {
      if (!GLYPH[i.k] || !i.fx) return;
      const e = i.fx, o = { m: e.m, c2: e.c2, r: round2(e.r) };
      if (e.c3) { o.c3 = e.c3; if (e.c4) o.c4 = e.c4; }
      if (e.dl > 0) o.dl = round2(e.dl);
      if (e.ho !== undefined && round2(e.ho) !== 1.4) o.ho = round2(e.ho);
      Object.assign(o, trigOut(e.tr[0]));
      if (e.tr.length > 1) o.x = e.tr.slice(1).map(trigOut);
      fx.push([n, o]);
    });
    if (fx.length) out.fx = fx;
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
    const next = { name: typeof spec.name === 'string' ? spec.name.slice(0, 40) : '', items: [], kick: false, lock: spec.lock === true, pts: {}, cabinet: spec.cabinet === 'classic' ? 'classic' : 'smooth', look: ['golden', 'neon'].includes(spec.look) ? spec.look : 'custom', feel: {}, flips: null, closed: spec.closed_sides === true, aim: spec.true_aim === true, even: spec.even_guides === true };
    if (spec.feel && typeof spec.feel === 'object') for (const [k, v] of Object.entries(spec.feel)) if (k in FEEL && (k === 'extra_balls' ? Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) : typeof v === (typeof FEEL[k][0] === 'boolean' ? 'boolean' : 'number') && (typeof v !== 'number' || Number.isFinite(v)))) next.feel[k] = v;
    if (spec.pts && typeof spec.pts === 'object') for (const [k, v] of Object.entries(spec.pts)) if (POINTS[k] && typeof v === 'number' && isFinite(v)) next.pts[k] = clamp(Math.round(v), 0, 20000);
    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
    if (Array.isArray(spec.fl) && spec.fl.length === 4 && spec.fl.every((v) => typeof v === 'number' && isFinite(v))) {
      const fl = clampFlips(spec.fl, next.feel.steep_flippers ? .46 : .42);
      if (fl.some((v, i) => v !== FLIP_DEFAULT[i])) next.flips = fl;
    }
    const uidOf = new Map();                      // spec index -> the part's uid, so a light's "when this part is hit" survives loading
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
      uidOf.set(n, it.uid);
    }
    for (const [n, e] of Array.isArray(spec.fx) ? spec.fx : []) {
      const it = next.items.find((j) => j.uid === uidOf.get(n));
      if (!it || !GLYPH[it.k] || !e || typeof e !== 'object') continue;
      const f = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? clamp(v, lo, hi) : d);
      const hex = (v) => /^#[0-9a-f]{6}$/i.test(v);
      const trig = (g) => {
        const t = { ...TRIG_DEFAULT, on: FX_ON.includes(g.on) ? g.on : 'always', ev: f(g.ev, 1, 120, 6), du: f(g.du, .3, 60, 2), nr: f(g.nr, .3, 5, 1.2),
          src: typeof g.src === 'string' && FX_TAG[g.src] ? g.src : uidOf.get(g.src) ?? null, gv: FX_EVENTS.includes(g.gv) ? g.gv : 'multiball' };
        t.du = Math.min(t.du, t.ev);
        return t;
      };
      it.fx = { m: FX_MODES.includes(e.m) ? e.m : 'flash', c2: hex(e.c2) ? e.c2.toLowerCase() : '#ffffff', r: f(e.r, .2, 10, 1), dl: f(e.dl, 0, 10, 0), ho: f(e.ho, .2, 30, 1.4),
        ...(hex(e.c3) ? { c3: e.c3.toLowerCase(), ...(hex(e.c4) ? { c4: e.c4.toLowerCase() } : {}) } : {}),
        tr: [trig(e), ...(Array.isArray(e.x) ? e.x.filter((g) => g && typeof g === 'object').slice(0, 2).map(trig) : [])] };
    }
    return next;
  }
  // a Golden Hour look-alike: every kind of part in the places the real table has them
  const TEMPLATES = [
    ['Empty table', []],
    ['Demo table', [['bump', 3, 5.5, .65, '#ff9b59'], ['bump', 6.4, 5.5, .65, '#c699ff'], ['bump', 4.7, 7.6, .65, '#58e5d5'],
      ['sling', 1.35, 10.75, 2.85, 12.5, '#ff6854'], ['sling', 7.7, 10.75, 6.5, 12.6, '#ff6854'],
      ['lane', 2.25, 3.5, '#59edd2'], ['lane', 4.25, 3.5, '#59edd2'], ['lane', 6.25, 3.5, '#59edd2'],
      ['target', 1.25, 6.6, 1.25, 7.3, '#ff6854'], ['spinner', 7.95, 7.4, '#c1d2e5'], ['kick', '#ffffff']]],
    // the curated tables (Pop Pit, Speedway...) come from the server: games/pinball_tables/*.json
  ];
  let production = [];              // Golden Hour and Neon Arcade, as editor tables
  fetch('/api/pinball-clones').then((r) => r.json()).then((d) => { production = Array.isArray(d.tables) ? d.tables : []; if (typeof tablesDlg !== 'undefined' && tablesDlg.open) renderTables(); }).catch(() => {});
  let curated = [];                 // the server's curated tables
  let localDev = false;             // on the server's own device: featured tables can be saved, overwritten and deleted (files in games/pinball_tables)
  const loadCurated = () => fetch('/api/pinball-tables').then((r) => r.json()).then((d) => { curated = Array.isArray(d.tables) ? d.tables : []; if (typeof tablesDlg !== 'undefined' && tablesDlg.open) renderTables(); }).catch(() => {});
  loadCurated();
  fetch('/api/dev').then((r) => r.json()).then((d) => { localDev = !!d.local; if (typeof tablesDlg !== 'undefined' && tablesDlg.open) renderTables(); }).catch(() => {});
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
  function restore(text) { state = fromSpec(JSON.parse(text)); sel = -1; group.clear(); try { localStorage.setItem(STORE, text); } catch {} refresh(); }
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
  // the printed art the game would wear for this table (shared painter in games/pinballart.js), redrawn only when something it reads changes
  const artCache = new Map();
  function printedArt() {
    if (!window.PinballArt) return null;
    const of = (k) => state.items.filter((it) => it.k === k);
    const geo = { theme: state.look === 'golden' ? '' : state.look === 'neon' ? 'neon' : 'custom', paint: { name: state.name || 'My Table', decals: [] },
      bumps: of('bump').map((i) => [i.x, i.y, i.r]), targets: of('target').map((i) => [i.x, i.y, i.x2, i.y2]), lanes: of('lane').map((i) => [i.x, i.y]),
      ramp: of('ramp')[0] ? [of('ramp')[0].x, of('ramp')[0].y] : null, spinner: of('spinner')[0] ? [of('spinner')[0].x, of('spinner')[0].y] : null };
    const key = JSON.stringify(geo);
    if (!artCache.has(key)) {
      if (artCache.size > 14) artCache.delete(artCache.keys().next().value);
      let made = null; try { made = window.PinballArt.make(geo); } catch {}
      artCache.set(key, made);
    }
    return artCache.get(key);
  }
  function draw() {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const art = printedArt();
    if (art) ctx.drawImage(art, 0, 0, W, H);                             // the same printed playfield the game paints: sky, sun, canyon, medallion, labels
    else { const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#1b1a44'); bg.addColorStop(.5, '#3b2260'); bg.addColorStop(1, '#2a1740'); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }
    ctx.fillStyle = '#00000040'; ctx.fillRect(8.8, 0, 1.2, H);          // the shooter lane
    if (snap) {                                                         // grid dots
      ctx.fillStyle = '#ffffff18';
      for (let gx = .25; gx < 10; gx += .5) for (let gy = .25; gy < 17; gy += .5) ctx.fillRect(gx - .012, gy - .012, .025, .025);
    }
    ctx.fillStyle = '#ffffff0c'; ctx.fillRect(X[0] - .1, Y[1], X[1] - X[0] + .2, 14.95 - Y[1] + .5);   // too close to the flippers
    for (const r of cabinetRails()) { seg(...r, '#17152f', .3); seg(...r, '#c1d2e5', .14); }
    seg(8.8, 1.2, 8.8, 3.1, '#ffd383', .1);                              // the one-way gate
    flipPair(restOf(), flipsNow()).forEach(([fx, fy, a], i) => {
      seg(fx, fy, fx + FLIP_LEN * Math.cos(a), fy + FLIP_LEN * Math.sin(a), '#211b40', .5); seg(fx, fy, fx + FLIP_LEN * Math.cos(a), fy + FLIP_LEN * Math.sin(a), '#42cfeb', .32);
      ctx.setLineDash([.1, .08]); disc(fx, fy, .34, null, drag?.mode === 'flip' && drag.side === i ? '#ffb703' : '#ffffff99'); ctx.setLineDash([]);      // the grip: drag it to move the flipper
    });
    if (state.kick) for (const x of [.45, 8.35]) { disc(x, 12.9, .26, '#252049'); disc(x, 12.9, .2, '#ffd383'); }
    lamps = liveLamps();
    state.items.forEach((it, i) => { if (shown(it)) { drawItem(it, i === sel); if (group.size > 1 && group.has(i)) { const [gx, gy] = centre(it); ctx.setLineDash([.1, .08]); disc(gx, gy, .55, null, '#ffb703'); ctx.setLineDash([]); } } });
    if (!art) { ctx.fillStyle = '#ffffff55'; ctx.font = '.32px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('DRAIN', 5, 16.6); ctx.fillText('LAUNCH', 9.4, 12); }
  }
  // an orbit wire as the game rides it: a smooth Catmull-Rom curve through your dots, with a funnel at the mouth and a flare at the exit
  const wireCurve = (pts) => {
    if (pts.length < 3) return pts;
    const e = [pts[0], ...pts, pts.at(-1)], out = [];
    for (let i = 1; i < e.length - 2; i++) for (let k = 0; k < 16; k++) {
      const t = k / 16, [p0, p1, p2, p3] = [e[i - 1], e[i], e[i + 1], e[i + 2]];
      out.push([0, 1].map((j) => .5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t ** 3)));
    }
    out.push(pts.at(-1));
    return out;
  };
  function wireEnds(curve) {
    const unit = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1; return [dx / n, dy / n]; };
    const k = Math.min(6, curve.length - 1), d0 = unit(curve[0], curve[k]), d1 = unit(curve.at(-1 - k), curve.at(-1));
    const guides = (from, d, back, near, far) => [1, -1].map((s) => [from[0] - d[0] * back - d[1] * far * s, from[1] - d[1] * back + d[0] * far * s, from[0] - d[1] * near * s, from[1] + d[0] * near * s]);
    return { funnel: guides(curve[0], d0, .5, .17, .42), flare: guides(curve.at(-1), d1, -.5, .17, .42) };
  }
  const wireGrip = (it) => { const c = wireCurve(it.pts); return c[Math.floor(c.length / 2)]; };       // a big handle on the middle of the wire: drag it to move the whole wire
  const rampCurve = (it) => Array.from({ length: 25 }, (_, i) => { const t = i / 24; return [it.x + (it.x2 - it.x) * t, it.y + (it.y2 - it.y) * t - 4.8 * Math.sin(Math.PI * t)]; });
  function exitDir(x, y) { const dx = 5 - x, dy = 6, n = Math.hypot(dx, dy); return [dx / n, dy / n]; }
  let lamps = null;                            // live light colours while Preview lights is on (set at the start of each draw)
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
      const curve = wireCurve(it.pts), ends = wireEnds(curve);
      poly(curve, '#252049', .24); poly(curve, it.c, .09);
      for (const g of [...ends.funnel, ...ends.flare]) { seg(...g, '#252049', .13); seg(...g, it.c, .06); }       // funnel in, flare out
      disc(it.pts[0][0], it.pts[0][1], .22, '#0c0a1c', it.c);
      const [lx, ly] = it.pts.at(-1), [px, py] = curve.at(-4); arrow(lx + (lx - px) * .5, ly + (ly - py) * .5, lx - px, ly - py, it.c);
      if (on) { poly(curve, '#ffffff44', .3); const [gx, gy] = wireGrip(it); disc(gx, gy, .3, '#ffb70333', '#ffb703'); seg(gx - .14, gy, gx + .14, gy, '#ffb703', .05); seg(gx, gy - .14, gx, gy + .14, '#ffb703', .05); }
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
      const live = lamps?.get(it);
      ctx.save(); ctx.translate(it.x, it.y); glyphPath(it.k, it.r); ctx.globalAlpha = live ? live.alpha : .7; ctx.fillStyle = ctx.strokeStyle = live ? live.color : it.c; ctx.lineWidth = it.r * .16;
      it.k === 'ring' ? ctx.stroke() : ctx.fill(); ctx.restore();
      if (it.fx && !live) { ctx.setLineDash([.08, .07]); disc(it.x, it.y, it.r + .14, null, it.fx.c2); ctx.setLineDash([]); }        // marks a decal with a light effect
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
    else if (g === 'dot') ctx.arc(0, 0, u, 0, Math.PI * 2);
    else { ctx.arc(0, 0, u, 0, Math.PI * 2); ctx.moveTo(u * .62, 0); ctx.arc(0, 0, u * .62, 0, Math.PI * 2); }
    ctx.closePath();
  }
  function handles(it) {
    const d = KINDS[it.k];
    if (d.shape === 'a') return [[it.x, it.y], [it.x2, it.y2], [it.cx, it.cy]];
    if (it.k === 'post') return [];                    // a post is tiny: dragging it must move it, never resize it (use the Radius box)
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
  // moving a whole part (a wire, a rail, a ramp...) slides it rigidly: the shift is limited so no point leaves the table, so the shape never squashes at an edge
  function rigidShift(it, sx, sy) {
    const all = []; mapPts(copy(it), (p) => { all.push(p); return p; });
    const [y0, y1] = yRange(it.k), xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    return [clamp(sx, X[0] - Math.min(...xs), X[1] - Math.max(...xs)), clamp(sy, y0 - Math.min(...ys), y1 - Math.max(...ys))];
  }
  function shiftGroup(sx, sy) {
    if (group.size < 2) return;
    for (const g of group) if (g !== sel && state.items[g]) { const o = state.items[g], [mx, my] = KINDS[o.k].shape === 'p' || KINDS[o.k].shape === 'pr' ? [sx, sy] : rigidShift(o, sx, sy); mapPts(o, ([x, y]) => [x + mx, y + my]); normalize(o); }
  }
  function hitList(px, py) {
    const found = [];
    state.items.forEach((it, i) => {
      if (!shown(it)) return;
      const d = KINDS[it.k];
      let dist = 99, weight = 0;
      if (d.shape === 'pr') { dist = Math.hypot(px - it.x, py - it.y); if (!(dist <= (it.k === 'magnet' ? Math.min(it.r, .5) : it.r + .1))) return; }
      else if (it.k === 'ramp') { const c = rampCurve(it); dist = Math.min(...c.slice(1).map(([x, y], j) => distSeg(px, py, c[j][0], c[j][1], x, y))); weight = 2; if (dist > .2) return; }
      else if (d.shape === 'a') { const c = arcCurve(it); dist = Math.min(...c.slice(1).map(([x, y], j) => distSeg(px, py, c[j][0], c[j][1], x, y))); weight = 1; if (dist > .25) return; }
      else if (d.shape === 'w') { const c = wireCurve(it.pts); dist = Math.min(...c.slice(1).map(([x, y], j) => distSeg(px, py, c[j][0], c[j][1], x, y)), ...it.pts.map(([x, y]) => Math.hypot(px - x, py - y) - .15)); weight = 2; if (dist > .26) return; }
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
    if (sel >= 0 && state.items[sel]) {
      const it0 = state.items[sel];
      if (it0.pts) { const [gx, gy] = wireGrip(it0); if (Math.hypot(px - gx, py - gy) <= Math.max(.36, pad)) { drag = { mode: 'move', dx: px - it0.x, dy: py - it0.y }; canvas.setPointerCapture(e.pointerId); return; } }
      const inBody = KINDS[it0.k].shape === 'pr' && Math.hypot(px - it0.x, py - it0.y) < it0.r * .7;      // pressing inside a round part moves it
      const h = inBody ? -1 : handles(it0).findIndex(([hx, hy]) => Math.hypot(px - hx, py - hy) <= pad);
      if (h >= 0) { drag = { mode: 'handle', h }; canvas.setPointerCapture(e.pointerId); return; }
    }
    const stack = hitList(px, py);
    const grip = stack.length ? -1 : flipPair(restOf(), flipsNow()).findIndex(([fx, fy]) => Math.hypot(px - fx, py - fy) <= Math.max(.42, pad));
    if (grip >= 0) { sel = -1; group.clear(); drag = { mode: 'flip', side: grip }; canvas.setPointerCapture(e.pointerId); refresh(false); return; }
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
    if (drag?.mode === 'flip') {
      const [px, py] = world(e), fl = [...flipsNow()], at = drag.side * 2;
      fl[at] = grid(px); fl[at + 1] = grid(py);
      state.flips = clampFlips(fl, restOf());
      draw(); return;
    }
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
      const nx = grid(px - drag.dx), ny = grid(py - drag.dy);
      if (d.shape === 'p' || d.shape === 'pr') { const sx = nx - it.x, sy = ny - it.y; it.x = nx; it.y = ny; normalize(it); shiftGroup(sx, sy); }
      else { const [sx, sy] = rigidShift(it, nx - it.x, ny - it.y); mapPts(it, ([x, y]) => [x + sx, y + sy]); shiftGroup(sx, sy); }
    }
    draw(); fillInspector();
  });
  const endDrag = () => {
    if (!drag) return;
    if (state.flips && state.flips.every((v, i) => v === FLIP_DEFAULT[i])) state.flips = null;
    drag = null; commit();
  };
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
      b.className = 'pe-part'; b.type = 'button'; b.dataset.kind = k; b.title = d.desc || d.hint || d.label;
      b.innerHTML = `<span class="pe-icon">${d.icon}</span><span>${d.label}</span><small></small>`;
      b.addEventListener('pointerdown', (e) => startPaletteDrag(e, k, b));
      b.addEventListener('click', () => { if (b.dataset.touch === '1' && !b.disabled) addPart(k, 4.4 + (count(k) % 4) * .5, 7 + (state.items.length % 6) * .6); });
      box.append(b);
    }
    if (!list.length) { const p = document.createElement('p'); p.className = 'pe-none'; p.textContent = 'No parts match.'; box.append(p); }
  }
  $('peSearch').oninput = () => { query = $('peSearch').value; buildPalette(); refresh(false); };
  function startPaletteDrag(e, k, button) {
    button.dataset.touch = e.pointerType === 'touch' ? '1' : '';
    if (e.pointerType === 'touch') return;          // a finger scrolls the row; a tap (the click below) adds the part
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
    $('peFields').hidden = !it; $('peHint').hidden = !!it; if (!it) $('peDesc').hidden = true;
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
    $('peDesc').textContent = d.desc || ''; $('peDesc').hidden = !d.desc;
    $('peKindHint').textContent = d.hint || ''; $('peKindHint').hidden = !d.hint;
    $('peColorRow').hidden = $('peSwatches').hidden = !d.paint;
    $('peColor').value = it.c;
    for (const c of document.querySelectorAll('#peModes input')) c.checked = !!((it.modes ?? 15) & +c.dataset.bit);
    $('pePvRow').hidden = !OWN_POINTS.has(it.k);
    if (OWN_POINTS.has(it.k)) { $('pePv').value = Number.isFinite(it.pv) ? it.pv : ''; $('pePv').placeholder = String(POINTS[it.k === 'bump' ? 'bumper' : it.k][0]); }
    fillFx(it);
    $('peDup').disabled = count(it.k) >= d.max;
    $('peRotL').disabled = $('peRotR').disabled = d.shape === 'p' || d.shape === 'pr';
  }
  // ---- decal lights: colour effects, and what starts them -----------------------------------------------------
  const TRIG_DEFAULT = { on: 'always', ev: 6, du: 2, nr: 1.2, src: null, gv: 'multiball' };
  const FX_DEFAULT = { m: 'flash', c2: '#ffffff', r: 1, dl: 0, ho: 1.4, tr: [TRIG_DEFAULT] };
  const FX_PRESETS = {
    attract: ['Attract (twinkle)', { m: 'twinkle', c2: '#ff78bc', c3: '#59edd2', r: 1.4, tr: [{ on: 'always' }] }],
    burst: ['Bumper burst', { m: 'flash', c2: '#ffffff', r: .6, ho: .9, tr: [{ on: 'hit', src: 'bump' }] }],
    jackpot: ['Jackpot flash', { m: 'flash', c2: '#ffd383', c3: '#ff6854', r: .9, tr: [{ on: 'event', gv: 'jackpot' }] }],
    multiball: ['Multiball rainbow', { m: 'cycle', c2: '#59edd2', c3: '#c699ff', c4: '#ff78bc', r: 2, tr: [{ on: 'event', gv: 'multiball' }] }],
    warning: ['Warning (tilt or ball save)', { m: 'flash', c2: '#ff0000', r: .7, tr: [{ on: 'event', gv: 'tilt' }, { on: 'event', gv: 'save' }] }],
  };
  const FX_EVENT_NAMES = { bank: 'Target bank cleared', multiball: 'Multiball', jackpot: 'Jackpot round', save: 'Ball save', tilt: 'Tilt', hurry: 'Hurry-up', skill: 'Skill shot', extra: 'Extra ball', mult: 'Multiplier up', lock: 'Ball locked',
    mission: 'Mission complete', orbit: 'Orbit shot', kickback: 'Kickback', special: 'Special', saucer: 'Saucer', subway: 'Subway', magnet: 'Magnet grab', drain: 'Ball drained' };
  const FX_ON_NAMES = { always: 'All the time', timer: 'On a timer', motion: 'Ball passes near (motion)', hit: 'A part is hit', event: 'A game event' };
  function tagOf(it) {                  // the name the game gives a hit on this part (bumper0, lane2, ramp, ...)
    if (!it || !FX_TAG[it.k]) return '';
    const same = state.items.filter((j) => j.k === it.k);
    return FX_TAG[it.k] + (it.k === 'spinner' || it.k === 'ramp' ? '' : same.indexOf(it));
  }
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const option = (value, text) => el('option', { value, textContent: text });
  let trigKey = '';
  function renderTriggers(it) {                  // one block per trigger; rebuilt only when the shape changes, so typing in a field keeps focus
    const box = $('peFxTriggers'), tr = it.fx.tr;
    const parts = state.items.filter((j) => FX_TAG[j.k]);
    const key = JSON.stringify([it.uid, tr.map((g) => g.on), parts.map((j) => [j.uid, round2(j.x), round2(j.y)])]);
    if (key !== trigKey) {
      trigKey = key; box.textContent = '';
      tr.forEach((g, k) => {
        const on = el('select'); for (const [v, t] of Object.entries(FX_ON_NAMES)) on.append(option(v, t));
        const num = (field, label, lo, hi, step) => el('label', { hidden: g.on !== ({ ev: 'timer', du: 'timer', nr: 'motion' })[field] }, label + ' ', el('input', { type: 'number', min: lo, max: hi, step }));
        const ev = num('ev', 'Every (seconds)', 1, 120, 1), du = num('du', 'Stays on for (seconds)', .3, 60, .1), nr = num('nr', 'Ball within (units)', .3, 5, .1);
        const src = el('select'); src.append(option('', parts.length ? 'Pick a part…' : 'No bumpers, slings, targets, lanes, movers, spinner or ramp yet'));
        for (const kind of Object.keys(FX_TAG)) if (parts.some((j) => j.k === kind)) src.append(option(kind, `${KINDS[kind].icon} Any ${KINDS[kind].label.toLowerCase()}`));
        for (const j of parts) src.append(option(j.uid, `${KINDS[j.k].icon} ${KINDS[j.k].label} (${round2(j.x)}, ${round2(j.y)})`));
        const gv = el('select'); for (const [v, t] of Object.entries(FX_EVENT_NAMES)) gv.append(option(v, t));
        const srcRow = el('label', { hidden: g.on !== 'hit' }, 'Part ', src), gvRow = el('label', { hidden: g.on !== 'event' }, 'Event ', gv);
        const set = (field, fn) => (e) => editSel((x) => { if (x.fx?.tr[k]) x.fx.tr[k][field] = fn(e.target.value); });
        const numFn = (lo, hi, d) => (v) => { const n = parseFloat(v); return Number.isFinite(n) ? clamp(n, lo, hi) : d; };
        on.onchange = set('on', (v) => v); ev.lastChild.onchange = set('ev', numFn(1, 120, 6)); du.lastChild.onchange = set('du', numFn(.3, 60, 2)); nr.lastChild.onchange = set('nr', numFn(.3, 5, 1.2));
        src.onchange = set('src', (v) => (!v ? null : FX_TAG[v] ? v : +v)); gv.onchange = set('gv', (v) => v);
        const block = el('div', { className: 'pe-trig' }, el('label', {}, k ? 'Or when ' : 'Runs when ', on), ev, du, nr, srcRow, gvRow);
        if (k) block.append(el('button', { type: 'button', textContent: '✕ Remove', onclick: () => editSel((x) => x.fx.tr.splice(k, 1)) }));
        block.refs = { on, ev: ev.lastChild, du: du.lastChild, nr: nr.lastChild, src, gv };
        box.append(block);
      });
    }
    tr.forEach((g, k) => {
      const r = box.children[k].refs, setv = (c, v) => { if (document.activeElement !== c) c.value = v; };
      setv(r.on, g.on); setv(r.ev, g.ev); setv(r.du, g.du); setv(r.nr, g.nr); setv(r.src, g.src ?? ''); setv(r.gv, g.gv);
    });
    $('peFxAddTrig').hidden = tr.length >= 3;
  }
  function fillFx(it) {
    $('peFx').hidden = !GLYPH[it.k];
    if (!GLYPH[it.k]) return;
    const e = it.fx;
    $('peFxMode').value = e ? e.m : '';
    $('peFxBody').hidden = !e;
    $('peFxPaste').disabled = !fxClip; $('peFxChase').disabled = !e;
    if (!e) return;
    $('peFxCount').value = e.c4 ? 4 : e.c3 ? 3 : 2; $('peFxC3Row').hidden = !e.c3; $('peFxC4Row').hidden = !e.c4;
    if (e.c3) $('peFxC3').value = e.c3;
    if (e.c4) $('peFxC4').value = e.c4;
    $('peFxC2').value = e.c2; $('peFxRate').value = e.r; $('peFxDl').value = e.dl; $('peFxHo').value = e.ho;
    renderTriggers(it);
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let fxClip = null;                              // copy / paste an effect between lights
  $('peFxMode').onchange = () => editSel((it) => { const m = $('peFxMode').value; if (m) it.fx = { ...clone(FX_DEFAULT), ...it.fx, m }; else delete it.fx; });
  const fxSet = (id, key, fn) => { $(id).onchange = () => editSel((it) => { if (it.fx) it.fx[key] = fn($(id).value, it.fx); }); };
  const fxNum = (lo, hi, d) => (v) => { const n = parseFloat(v); return Number.isFinite(n) ? clamp(n, lo, hi) : d; };
  fxSet('peFxC2', 'c2', (v) => v); fxSet('peFxC3', 'c3', (v) => v); fxSet('peFxC4', 'c4', (v) => v);
  fxSet('peFxRate', 'r', fxNum(.2, 10, 1)); fxSet('peFxDl', 'dl', fxNum(0, 10, 0)); fxSet('peFxHo', 'ho', fxNum(.2, 30, 1.4));
  $('peFxCount').onchange = () => editSel((it) => {      // how many colours the effect uses: the light's own plus 1 to 3 more
    if (!it.fx) return;
    const n = +$('peFxCount').value;
    if (n < 3) { delete it.fx.c3; delete it.fx.c4; } else { it.fx.c3 ||= '#59edd2'; if (n > 3) it.fx.c4 ||= '#ffd383'; else delete it.fx.c4; }
  });
  for (const [v, t] of Object.entries(FX_EVENT_NAMES)) $('peFxTest').append(option(v, t));
  $('peFxAddTrig').onclick = () => editSel((it) => { if (it.fx && it.fx.tr.length < 3) it.fx.tr.push({ ...TRIG_DEFAULT, on: 'timer' }); });
  for (const [id, [label]] of Object.entries(FX_PRESETS)) $('peFxPreset').append(option(id, label));
  $('peFxPreset').onchange = () => { const p = FX_PRESETS[$('peFxPreset').value]; $('peFxPreset').value = ''; if (p) editSel((it) => { it.fx = { ...clone(FX_DEFAULT), ...clone(p[1]), tr: p[1].tr.map((g) => ({ ...TRIG_DEFAULT, ...g })) }; }); };
  $('peFxCopy').onclick = () => { const it = state.items[sel]; if (it?.fx) { fxClip = clone(it.fx); fillFx(it); say('Light effect copied. Select another decal and press Paste.'); } };
  $('peFxPaste').onclick = () => { if (fxClip) editSel((it) => { if (GLYPH[it.k]) it.fx = clone(fxClip); }); };
  // a chase: the lights of the shift-click group switch on one after another, left to right, copying this light's effect with a growing delay
  $('peFxChase').onclick = () => {
    const src = state.items[sel]?.fx, lamps = selected().map((i) => state.items[i]).filter((it) => GLYPH[it.k]);
    if (!src || lamps.length < 2) return say('Shift-click two or more decals (one with a light effect), then press Chase.');
    const step = fxNum(.05, 2, .15)($('peFxStep').value);
    lamps.sort((a, b) => a.x - b.x || a.y - b.y).forEach((it, n) => { it.fx = { ...clone(src), dl: round2(n * step) }; });
    commit(); say(`Chase set on ${lamps.length} lights, ${step}s apart.`);
  };
  // Preview lights: the same effects the game runs. The mouse pointer is the ball (motion lights) and the selected part counts as hit.
  let lightsOn = false, ptr = null, lampKey = '', lampCtl = null;
  const liveLamps = () => {
    const items = state.items.filter((i) => GLYPH[i.k] && i.fx);
    if (!lightsOn || !items.length || !window.PinballArt) return new Map();
    const tagFor = (g) => (typeof g.src === 'string' ? FX_TAG[g.src] + '*' : tagOf(state.items.find((j) => j.uid === g.src)));
    const decals = items.map((i) => [i.k, i.x, i.y, i.r, i.c, { ...i.fx, tr: i.fx.tr.map((g) => ({ ...g, tag: g.on === 'hit' ? tagFor(g) : undefined })) }]);
    const key = JSON.stringify(decals);
    if (key !== lampKey) { lampKey = key; lampCtl = window.PinballArt.lights({ paint: { decals } }); }
    const test = $('peFxTest').value;
    const out = lampCtl.update(performance.now(), { balls: ptr ? [ptr] : [], flash: tagOf(state.items[sel]) || test, states: new Set(test ? [test] : []) });
    return new Map(items.map((it, n) => [it, out[n]]));
  };
  const lightLoop = () => { if (!lightsOn) return; draw(); requestAnimationFrame(lightLoop); };
  $('peLights').onclick = () => { lightsOn = !lightsOn; $('peLights').classList.toggle('on', lightsOn); if (lightsOn) lightLoop(); else draw(); };
  canvas.addEventListener('pointermove', (e) => { ptr = world(e); });
  canvas.addEventListener('pointerleave', () => { ptr = null; });
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
    if (!mask) { say('A part has to be active in at least one mode.'); fillInspector(); return; }
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
      delete c.uid;
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
    state.items = out; sel = -1; group.clear(); commit(); say('Left half mirrored onto the right.');
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
  // phones: the board fills the screen and the parts sit below it, so one button flips between them
  const jump = $('peJump');
  const onBoard = () => scrollY < innerHeight * .4;
  jump.onclick = () => scrollTo({ top: onBoard() ? document.querySelector('.pe-side').offsetTop - 56 : 0, behavior: 'smooth' });
  addEventListener('scroll', () => { jump.textContent = onBoard() ? '▼ Parts' : '▲ Board'; }, { passive: true });
  $('peZoom').onclick = () => { zoom = zoom >= 2 ? 1 : zoom + .5; $('peZoom').textContent = `🔍 ${zoom}×`; fit(); };
  $('peName').oninput = () => { state.name = $('peName').value; };
  $('peName').onchange = commit;
  $('peLock').onchange = () => { state.lock = $('peLock').checked; commit(); };
  $('peKick').onchange = () => { state.kick = $('peKick').checked; commit(); };
  $('peSnap').onclick = () => { snap = !snap; $('peSnap').setAttribute('aria-pressed', String(snap)); draw(); };
  $('peClear').onclick = () => { if (!state.items.length && !state.kick) return; if (confirm('Remove every part from this table?')) { state.items = []; state.kick = false; state.lock = false; state.pts = {}; state.cabinet = 'smooth'; state.look = 'custom'; state.feel = {}; state.even = false; state.closed = false; state.aim = false; sel = -1; group.clear(); commit(); } };

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
      if (i === sel) queueMicrotask(() => { const top = b.offsetTop - ol.offsetTop, bottom = top + b.offsetHeight; if (top < ol.scrollTop) ol.scrollTop = top; else if (bottom > ol.scrollTop + ol.clientHeight) ol.scrollTop = bottom - ol.clientHeight; });
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
    fillSetup();
    renderList();
    fillInspector();
    if (redraw) draw();
  }
  // ---- table setup: cabinet, art and feel ----------------------------------------------------------------------
  function fillSetup() {
    const f = state.feel || {}, set = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
    $('peCabinet').value = state.cabinet; $('peLook').value = state.look;
    set('peGravity', f.gravity ?? FEEL.gravity[0]); set('peHurry', f.hurry_seconds ?? FEEL.hurry_seconds[0]); set('peSuper', f.super_every ?? FEEL.super_every[0]);
    set('peEB1', (f.extra_balls ?? FEEL.extra_balls[0])[0]); set('peEB2', (f.extra_balls ?? FEEL.extra_balls[0])[1]);
    $('peSteep').checked = !!f.steep_flippers; $('peClassic').checked = !!f.classic_lamps;
    $('peFlipReset').disabled = !state.flips;
    $('peAim').checked = !!state.aim;
    $('peClosed').checked = !!state.closed; $('peClosed').disabled = state.cabinet === 'classic';
    $('peEven').checked = !!state.even; $('peEven').disabled = state.cabinet === 'classic';
  }
  const numberIn = (id, lo, hi) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? clamp(v, lo, hi) : null; };
  $('peCabinet').onchange = () => { state.cabinet = $('peCabinet').value; commit(); };
  $('peLook').onchange = () => { state.look = $('peLook').value; commit(); };
  $('peSteep').onchange = () => { state.feel = { ...state.feel, steep_flippers: $('peSteep').checked }; if (state.flips) state.flips = clampFlips(state.flips, restOf()); commit(); };
  $('peEven').onchange = () => { state.even = $('peEven').checked; commit(); };
  $('peClosed').onchange = () => { state.closed = $('peClosed').checked; commit(); };
  $('peAim').onchange = () => { state.aim = $('peAim').checked; commit(); };
  $('peFlipReset').onclick = () => { state.flips = null; commit(); };
  $('peClassic').onchange = () => { state.feel = { ...state.feel, classic_lamps: $('peClassic').checked }; commit(); };
  for (const [id, key, lo, hi] of [['peGravity', 'gravity', 8, 16], ['peHurry', 'hurry_seconds', 0, 20], ['peSuper', 'super_every', 1, 10]]) {
    $(id).onchange = () => { const v = numberIn(id, lo, hi); state.feel = { ...state.feel, [key]: v === null ? FEEL[key][0] : key === 'gravity' ? Math.round(v * 10) / 10 : Math.round(v) }; commit(); };
  }
  for (const id of ['peEB1', 'peEB2']) $(id).onchange = () => {
    const a = numberIn('peEB1', 1000, 1e6), b = numberIn('peEB2', 1000, 1e6);
    state.feel = { ...state.feel, extra_balls: [a ?? FEEL.extra_balls[0][0], b ?? FEEL.extra_balls[0][1]].sort((x, y) => x - y).map(Math.round) }; commit();
  };
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
    try { state = fromSpec(await readCode($('peShareText').value)); sel = -1; group.clear(); commit(); dlg.close(); say('Table loaded.'); }
    catch (e) { say(e instanceof SyntaxError || /atob|decode|inflate|deflate|Invalid/i.test(e.message) ? "That isn't a table code." : e.message); }
  };

  // ---- templates and saved tables -----------------------------------------------------------------------
  const readSlots = () => { try { return JSON.parse(localStorage.getItem(SLOTS)) || {}; } catch { return {}; } };
  const writeSlots = (slots) => { try { localStorage.setItem(SLOTS, JSON.stringify(slots)); } catch { say("Couldn't save: the browser's storage is full."); } };
  const tablesDlg = $('peTablesDlg');
  // a small picture of a table, drawn with the editor's own drawing code
  const thumbCache = new Map();
  function thumbnail(spec) {
    const key = JSON.stringify(spec);
    if (thumbCache.has(key)) return thumbCache.get(key);
    const c = document.createElement('canvas'); c.width = 112; c.height = 190;
    const keep = { ctx, scale, state, sel, snap }, grouped = [...group];
    try { ctx = c.getContext('2d'); scale = c.width / W; state = fromSpec(spec); sel = -1; snap = false; group.clear(); draw(); }
    finally { ({ ctx, scale, state, sel, snap } = keep); for (const i of grouped) group.add(i); }
    const url = c.toDataURL();
    thumbCache.set(key, url);
    return url;
  }
  function listItem(name, detail, buttons, tip, spec) {
    const row = document.createElement('div');
    row.className = 'pe-item';
    if (tip) row.title = tip;
    row.dataset.tip = tip || '';
    if (spec) { const img = document.createElement('img'); img.className = 'pe-thumb'; img.alt = ''; img.src = thumbnail(spec); row.append(img); }
    const text = document.createElement('span'); text.className = 'pe-itemtext';
    const label = document.createElement('b'); label.textContent = name;
    const small = document.createElement('small'); small.textContent = tip ? `${detail} · ${tip}` : detail;
    text.append(label, small);
    const btns = document.createElement('span'); btns.className = 'pe-itembtns'; btns.append(...buttons);
    row.append(text, btns);
    return row;
  }
  const button = (text, onclick) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = onclick; return b; };
  function load(spec) { state = fromSpec(spec); sel = -1; group.clear(); commit(); tablesDlg.close(); say(`Loaded "${state.name || 'table'}".`); }
  function renderTables() {
    const templates = $('peTemplates'), saved = $('peSaved'), clones = $('peClones'), featured = $('peFeatured');
    for (const box of [templates, saved, clones, featured]) box.textContent = '';
    for (const t of TEMPLATES) { const spec = templateSpec(t); templates.append(listItem(t[0], `${t[1].length} parts`, [button('Use', () => load(spec))], t[3], spec)); }
    for (const t of production) {                 // exact copies of the tables in the game, read from the server's live layouts
      const spec = { ...t.spec, name: t.name };
      clones.append(listItem(t.name, `${t.spec.items.length} parts`, [button('Clone', () => load(spec)), button('▶ Play', () => playSpec(spec))], t.blurb, spec));
    }
    $('peClonesHead').hidden = !production.length;
    for (const t of curated) {
      const spec = { ...t.spec, name: t.name };
      const btns = [button('Use', () => load(spec)), button('▶ Play', () => playSpec(spec))];
      if (localDev) btns.push(
        button('Overwrite', () => { if (confirm(`Replace "${t.name}" with the table in the editor?`)) saveListed({ slug: t.slug, blurb: t.blurb, author: t.author }, 'Overwrote'); }),
        button('Delete', () => { if (confirm(`Delete "${t.name}" from the table list? Its file is removed.`)) listedCall('/api/pinball-tables/delete', { slug: t.slug }, `Deleted "${t.name}".`); }));
      featured.append(listItem(t.name, `${t.spec.items.length} parts`, btns, t.blurb + (t.author ? ` (by ${t.author})` : ''), spec));
    }
    $('peFeaturedHead').hidden = !curated.length && !localDev;
    $('peLocalHint').hidden = localDev;
    const slots = readSlots(), names = Object.keys(slots);
    if (!names.length) { const p = document.createElement('p'); p.className = 'pe-empty'; p.textContent = 'Nothing saved yet. Name your table and press Save.'; saved.append(p); }
    for (const name of names) {
      saved.append(listItem(name, `${slots[name].items.length} parts`, [
        button('Open', () => load(slots[name])),
        button('▶ Play', () => playSpec(slots[name])),
        button('Delete', () => { const s = readSlots(); delete s[name]; writeSlots(s); renderTables(); }),
      ], '', slots[name]));
    }
  }
  // ---- suggest a table for the curated list ------------------------------------------------------------
  // The suggestion goes to the same inbox as player feedback (kind "table"); the server checks that it builds. What happens next is
  // described in docs/pinball-tables.md: an automatic check, a play-through by a person, then it is added to games/pinball_tables.
  const sugDlg = $('peSuggestDlg');
  $('peSuggest').onclick = () => {
    const spec = toSpec();
    $('peSugName').value = state.name || '';
    $('peSugMsg').textContent = spec.items.length < 6 ? 'A table needs at least 6 parts before it can be suggested.' : '';
    $('peSugSend').disabled = spec.items.length < 6;
    sugDlg.showModal();
  };
  $('peSugSend').onclick = async () => {
    const name = $('peSugName').value.replace(/\s+/g, ' ').trim();
    const msg = $('peSugMsg');
    if (name.length < 3 || name.length > 24) { msg.textContent = 'Give the table a name of 3 to 24 characters.'; return; }
    const spec = { ...toSpec(), name };
    try {
      msg.textContent = 'Sending…'; $('peSugSend').disabled = true;
      const code = await shareCode(spec);
      if (code.length > 8000) throw new Error('This table is too big to send. Remove some parts.');
      const credit = $('peSugBy').value.replace(/\s+/g, ' ').trim().slice(0, 16);
      const r = await post('/api/feedback', { kind: 'table', text: `Table suggestion: "${name}" (${spec.items.length} parts)`, name: credit || undefined, context: { pinball_table: code } });
      msg.textContent = `Thanks! Suggestion #${r.id} is in the queue. If it passes the checks and plays well it joins the table list.`;
    } catch (e) { msg.textContent = e.message; }
    $('peSugSend').disabled = false;
  };
  // On the server's own device only (the server refuses anyone else): write the editor's table into games/pinball_tables.
  async function listedCall(path, body, done) {
    try { await post(path, body); await loadCurated(); say(done); } catch (e) { say(e.message); }
  }
  function saveListed(extra, verb) {
    const spec = toSpec(), name = (state.name || '').replace(/\s+/g, ' ').trim();
    if (name.length < 3 || name.length > 24) return say('Name the table (3 to 24 characters) before putting it on the list.');
    return listedCall('/api/pinball-tables/save', { ...extra, name, spec }, `${verb} "${name}" on the table list.`);
  }
  const LOCAL_ONLY = "That works only when this page is open on the device running the server (http://localhost:8000).";
  $('peListSave').onclick = () => (localDev ? saveListed({ blurb: '', author: '' }, 'Added') : say(LOCAL_ONLY));
  $('peFeature').onclick = () => {
    if (!localDev) return say(LOCAL_ONLY);
    const same = curated.find((t) => t.name.toLowerCase() === (state.name || '').trim().toLowerCase());
    if (!same) return saveListed({ blurb: '', author: '' }, 'Added');
    if (confirm(`"${same.name}" is already featured. Replace it with the table in the editor?`)) saveListed({ slug: same.slug, blurb: same.blurb, author: same.author }, 'Overwrote');
  };
  // Check table: the test bot plays a few games on the table (the server runs it) and the dialog says how it went
  const checkDlg = $('peCheckDlg');
  const DRAINS = [['left_outlane', 'Left outlane'], ['left', 'Left flipper'], ['right', 'Right flipper'], ['right_outlane', 'Right outlane']];
  $('peCheck').onclick = async () => {
    if (!localDev) return say(LOCAL_ONLY);
    const body = $('peCheckBody');
    body.textContent = 'Playing the table and testing every flipper shot (up to a couple of minutes)…';
    checkDlg.showModal();
    try {
      const r = await post('/api/pinball-check', { table: toSpec() }), st = r.stats || {};
      body.textContent = '';
      body.append(el('h3', { textContent: r.ok ? '✅ Plays fine' : '⚠️ Needs work' }));
      if (st.avg_score !== undefined) body.append(el('p', { textContent: `The bot scored ${st.avg_score.toLocaleString()} on average, balls lasted ${st.avg_ball_s ?? '?'} s (shortest ${st.min_ball_s ?? '?'} s).` }));
      if (st.drains) {
        body.append(el('p', { textContent: 'Where balls drained:' }));
        for (const [k, label] of DRAINS) body.append(el('div', { className: 'pe-bar' }, el('span', { textContent: label }), el('i', { style: `width:${st.drains[k] || 0}%` }), el('b', { textContent: `${st.drains[k] || 0}%` })));
      }
      for (const p of r.problems || []) body.append(el('p', { className: 'pe-bad', textContent: '✖ ' + p }));
      for (const n of r.notes || []) body.append(el('p', { textContent: 'ℹ ' + n }));
      if (st.reach) {
        const bar = (label, pct, value) => el('div', { className: 'pe-bar pe-wide' }, el('span', { textContent: label }), el('i', { style: `width:${pct}%` }), el('b', { textContent: value }));
        const { shots, parts, spots } = st.reach;
        body.append(el('h4', { textContent: `What the flippers can hit (${shots} shots, least hit first)` }));
        for (const p of parts) body.append(bar((p.hits ? '' : '✖ ') + p.label, Math.round(100 * p.hits / shots), String(p.hits)));
        body.append(el('h4', { textContent: 'Shots that get up the table, by flipper spot (start = near the pivot, end = near the tip)' }));
        for (const s of spots) body.append(bar(`${s.flipper} ${s.spot}, ball ${s.ball}`, s.up, `${s.up}%`));
      }
    } catch (e) { body.textContent = e.message; }
  };
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
  // start a solo game on any table (the one in the editor, a saved one, a production copy or a featured one)
  async function playSpec(spec) {
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
  }
  $('pePlay').onclick = () => playSpec(toSpec());

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
  window.pinballEditor = { get state() { return state; }, wireGrip: () => wireGrip(state.items[sel]), toSpec, addPart, select: (i) => { sel = i; refresh(); }, shareCode, readCode };
})();
