(() => {
  const [X, Y, VX, VY, Z, LEFT, RIGHT, SCORE, BALLS, BANK, NUDGES, TILT, STAGED, CHARGE, EVENT_ID, EVENT, SPIN, SAVE, JACKPOT, MULT, BONUS, LANES, KICK, COMBO, LIT, LOCKED, OTHERS, POINTS, HOLD, HURRY, STATS] =
    Array.from({ length: 31 }, (_, i) => i);
  const keys = {
    KeyA: 1, ArrowLeft: 1, KeyZ: 1, ShiftLeft: 1, KeyD: 2, ArrowRight: 2, Slash: 2, ShiftRight: 2, Space: 4,
    KeyQ: -1, KeyW: -2, KeyE: -3,
  };
  const messages = {
    skill: 'Skill shot +5,000', spinner: 'Spinner +100', ramp: 'Ramp +6,000 · Jackpot lit', jackpot: 'Jackpot +12,000', save: 'Ball saved · Auto launch',
    tilt: 'TILT · scoring suspended', nudge: 'Table nudged', mult: 'Multiplier up!', kickback: 'Kickback!', extra: 'EXTRA BALL!', post: 'Centre post save!', hurry: 'HURRY-UP +15,000', super: 'SUPER JACKPOT +50,000',
    mystery_points: 'Mystery · +10,000', mystery_save: 'Mystery · Ball save 10s', mystery_mult: 'Mystery · Multiplier up!', mystery_hold: 'Mystery · Bonus held', lock: 'Ball locked', mission: 'Mission complete +5,000', bank: 'Target bank cleared +2,000', wizard: 'WIZARD MODE · Four balls, jackpots lit!', multiball: 'MULTIBALL · Shoot the ramp for jackpots +5,000',
    frenzy: 'BUMPER FRENZY +2,500', portal: 'Portal +250', hole: 'Kicker hole +1,000', mover: 'Moving target +300', saucer: 'Saucer +1,000', subway: 'Subway +2,000', magnet: 'Magnet grab +1,500', special: 'SPECIAL · Ball save +5,000', danger: 'DANGER · One more nudge tilts', rampfall: 'Ramp shot fell back', orbit: 'Orbit +3,000', search: 'Ball search', drain: 'Ball drained', done: 'Run complete', recovery: 'Ball freed',
  };
  const sounds = { frenzy: 'pbank', portal: 'psave', skill: 'pskill', ramp: 'pramp', jackpot: 'pjackpot', save: 'psave', tilt: 'wrong', nudge: 'thud', mult: 'cheer', kickback: 'pkick', extra: 'pknock', danger: 'wrong', rampfall: 'rail', search: 'pkick', post: 'psave', hurry: 'pjackpot', super: 'pjackpot', mystery_points: 'cheer', mystery_save: 'psave', mystery_mult: 'cheer', mystery_hold: 'pskill', lock: 'psave', multiball: 'pjackpot', wizard: 'pjackpot', mission: 'cheer', saucer: 'ptarget', subway: 'pramp', magnet: 'pskill', special: 'psave', orbit: 'pramp', search: 'pkick', bonus: 'cheer', spinner: 'pspin', drain: 'groan', done: 'groan' };
  const prefixes = { bumper: 'Bumper +100', sling: 'Slingshot +50', lane: 'Rollover +500', target: 'Target +250', mover: 'Moving target +300' };
  const label = (event, row) => {
    if (event === 'bonus' && row) return `Ball bonus +${row[BONUS].toLocaleString()}`;
    const text = messages[event] || prefixes[event?.replace(/[0-9]$/, '')] || '';
    // levelled and multiplied awards: show what was actually paid
    return row?.[POINTS] > 0 && !event.startsWith('mystery_') ? text.replace(/\+[\d,]+/, `+${row[POINTS].toLocaleString()}`) : text;
  };
  const sound = (event) => sounds[event] || (/^bumper/.test(event) ? 'pbumper' : /^sling/.test(event) ? 'psling' :
    /^lane/.test(event) ? 'plane' : /^target/.test(event) ? 'ptarget' : 'pop');
  const soundArg = (event, row) => (/^bumper/.test(event) ? (Number(event.slice(6)) || 0) + 100 * (row?.[STATS]?.streak || 0) : /^lane/.test(event) ? Number(event.slice(4)) || 0 :
    /^target/.test(event) ? Number(event.slice(6)) || 0 : undefined);
  // each table keeps its own personal best and top-scores list
  // the ball's trail warms from ivory to hot orange as the bonus multiplier climbs (1x..5x)
  const TRAIL_TINT = ['255,240,202', '255,226,150', '255,200,110', '255,160,90', '255,110,90'];
  const TRAIL_HEX = ['#fff0ca', '#ffe296', '#ffc86e', '#ffa05a', '#ff6e5a'];
  // personal bests are kept per table and per mode (practice keeps none)
  const modeTag = (g) => (g.mode && g.mode !== 'classic' ? '.' + g.mode : '');
  // an orbit wire's mouth and tail: a funnel at the entrance (two guide rails flaring out) and a flare at the exit, both lined up with the wire
  const orbitEnds = (geo) => {
    const p = geo.orbit_path, k = Math.min(3, p.length - 1), unit = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1; return [dx / n, dy / n]; };
    const d0 = unit(p[0], p[k]), d1 = unit(p[p.length - 1 - k], p[p.length - 1]);
    const guides = (from, d, back, near, far) => {           // two rails either side of `from`, opening out `back` units behind it
      const [nx, ny] = [-d[1], d[0]];
      return [1, -1].map((s) => [from[0] - d[0] * back + nx * far * s, from[1] - d[1] * back + ny * far * s, from[0] + nx * near * s, from[1] + ny * near * s]);
    };
    return { funnel: guides(p[0], d0, .5, .17, .42), flare: guides(p[p.length - 1], d1, -.5, .17, .42) };
  };
  const tableTag = (g) => g.table === 'neon' ? '.neon' : g.table === 'star' ? '.star' : g.table === 'custom' ? '.custom' : g.table?.startsWith('t_') ? '.' + g.table : '';   // t_<slug> = a curated table, with its own records
  const bestKey = (g) => `pinball.best${tableTag(g)}${modeTag(g)}`;
  const topKey = (g) => `pinball.top${tableTag(g)}${modeTag(g)}`;
  const clockText = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const palette = { gold: '#ffd383', ivory: '#fff0ca', teal: '#59edd2', red: '#ff6854', steel: '#c1d2e5' };
  const bumperColors = ['#ff9b59', '#c699ff', '#58e5d5', '#ff78bc'];
  // custom tables carry their own colours per part (geo.paint); everything else keeps the built-in look
  const paintOf = (geo, part, i, fallback) => (i === undefined ? geo.paint?.[part] : geo.paint?.[part]?.[i]) || fallback;
  // rails from geo.guides on are the metal guides; a custom table's own walls start after its smooth cabinet base
  const railTrim = (geo, i, fallback) => {
    const base = geo.paint?.base ?? 11, from = geo.guides ?? 9;
    if (geo.paint?.base != null && i >= base) return paintOf(geo, 'walls', i - base, fallback);       // a table built in the editor keeps its own wall colours under any art
    return i >= from ? (i - from < (geo.guide_run ?? 2) ? '#a896ff' : '#ffcf76') : fallback;
  };
  const flipperColors = ['#42cfeb', '#ff78bc'];
  const guideColors = ['#a896ff', '#a896ff', '#ffcf76', '#ffcf76'];
  const rampPoints = ({ ramp, exit }) => Array.from({ length: 33 }, (_, i) => {
    const t = i / 32, arch = Math.sin(t * Math.PI);
    return [ramp[0] + (exit[0] - ramp[0]) * t, ramp[1] + (exit[1] - ramp[1]) * t - 4.8 * arch, 1.6 * arch];
  });

  const jackpotLit = row => !row[TILT] && (row[JACKPOT] > 0 || row[OTHERS]?.length > 0);
  // a table has any number of drop targets: the ramp opens when every one of them is down
  const targetCount = row => row[STATS]?.targets ?? 3;
  const targetsDown = row => { let n = 0; for (let b = row[BANK]; b; b >>= 1) n += b & 1; return n; };
  const lastTarget = (row, i) => !row[TILT] && targetCount(row) > 1 && targetCount(row) - targetsDown(row) === 1 && !(row[BANK] >> i & 1);   // the one still standing
  const rampLit = row => !row[TILT] && (row[BANK] === (1 << targetCount(row)) - 1 || jackpotLit(row));
  const rampColor = row => jackpotLit(row) ? palette.gold : palette.teal;

  // players who ask for reduced motion get no speed halo, squash/stretch, ripples or score roll
  const calm = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // The backglass: an animated skyline painted behind the score panel. Golden Hour is a dusk with a sun, drifting
  // ridges and twinkling stars; Neon Arcade a magenta sun over a scrolling city. Big events flare through it.
  function glassArt(marquee, neon) {
    const canvas = document.createElement('canvas');
    canvas.className = 'pb-glass';
    canvas.setAttribute('aria-hidden', 'true');
    marquee.prepend(canvas);
    const c = canvas.getContext('2d');
    if (!c) return null;
    const size = sizeOf(marquee);
    const stars = Array.from({ length: 26 }, (_, i) => [((i * 37) % 100) / 100, ((i * 53) % 55) / 100, (i % 5) + 1]);
    const towers = Array.from({ length: 22 }, (_, i) => [i / 22, .05 + (((i * 7) % 9) / 9) * .5, .035 + (i % 3) * .012]);
    let react = { kind: '', at: -1e9 };
    const ridge = (w, h, base, amp, speed, now, color, seed) => {
      c.beginPath(); c.moveTo(0, h);
      for (let x = 0; x <= w; x += 6) c.lineTo(x, base - amp * (Math.sin((x + now * speed) / 34 + seed) * .6 + Math.sin((x + now * speed) / 13 + seed * 2) * .4) - amp);
      c.lineTo(w, h); c.closePath(); c.fillStyle = color; c.fill();
    };
    return {
      react(kind) { react = { kind, at: performance.now() }; },
      draw(now, row, calmMode) {
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.round(size.w * ratio), h = Math.round(size.h * ratio);
        if (!w || !h) return;
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        c.setTransform(ratio, 0, 0, ratio, 0, 0);
        const W = size.w, H = size.h, t = calmMode ? 0 : now;
        const age = (now - react.at) / 1000;
        const flare = Math.max(0, 1 - age / 1.6);
        const sky = c.createLinearGradient(0, 0, 0, H);
        if (neon) { sky.addColorStop(0, '#0c0624'); sky.addColorStop(.6, '#3a0f55'); sky.addColorStop(1, '#8a1f78'); }
        else { sky.addColorStop(0, '#241a45'); sky.addColorStop(.55, '#7a3a5c'); sky.addColorStop(1, '#f08a4b'); }
        c.fillStyle = sky; c.fillRect(0, 0, W, H);
        if (!neon) for (const [x, y, k] of stars) { c.globalAlpha = .35 + .35 * Math.sin(t / 500 * k + x * 9); c.fillStyle = '#fff0ca'; c.fillRect(x * W, y * H, 1.4, 1.4); }
        c.globalAlpha = 1;
        // the sun, swelling with jackpot-type events
        const sx = W * .5, sy = H * (neon ? .5 : .8), sr = H * (.34 + .12 * flare * (react.kind === 'jackpot' || react.kind === 'super' ? 1 : .4)) + Math.sin(t / 1800) * 1.5;
        if (flare && ['jackpot', 'super', 'hurry', 'mission', 'extra'].includes(react.kind)) {
          c.save(); c.translate(sx, sy); c.rotate(t / 4000); c.fillStyle = `rgba(255,222,150,${.35 * flare})`;
          for (let i = 0; i < 12; i++) { c.rotate(Math.PI / 6); c.beginPath(); c.moveTo(0, 0); c.lineTo(W * .7, -7); c.lineTo(W * .7, 7); c.closePath(); c.fill(); }
          c.restore();
        }
        const sun = c.createLinearGradient(0, sy - sr, 0, sy + sr);
        if (neon) { sun.addColorStop(0, '#ff6ad5'); sun.addColorStop(1, '#ff3ea5'); } else { sun.addColorStop(0, '#fff0ca'); sun.addColorStop(1, '#ffb25a'); }
        c.fillStyle = sun; c.beginPath(); c.arc(sx, sy, sr, 0, Math.PI * 2); c.fill();
        if (neon) { c.fillStyle = '#3a0f55'; for (let i = 1; i < 5; i++) c.fillRect(sx - sr, sy + (i - 2) * sr * .28, sr * 2, i * .9); }
        if (neon) {
          for (const [x, hgt, wid] of towers) {
            const tx = ((x * W - t * .012) % W + W) % W, th = hgt * H * .8 + H * .1;
            c.fillStyle = '#150a2e'; c.fillRect(tx, H - th, wid * W, th);
            c.fillStyle = '#ff9bf0'; for (let r = 0; r < 3; r++) c.fillRect(tx + 2 + r * 4, H - th + 4 + ((x * 100 | 0) % 3) * 5, 1.5, 1.5);
          }
        } else {
          ridge(W, H, H * .98, H * .1, .004, t, '#3a2a5e', 1);
          ridge(W, H, H * 1.0, H * .09, .009, t, '#2a2049', 3);
          ridge(W, H, H * 1.04, H * .08, .016, t, '#1a1633', 5);
        }
        // aurora ribbons for multiball and wizard mode, while they last
        if ((row?.[OTHERS]?.length || flare) && (row?.[OTHERS]?.length || ['multiball', 'wizard'].includes(react.kind))) {
          const a = row?.[OTHERS]?.length ? .5 : flare * .6;
          for (let k = 0; k < 3; k++) {
            c.beginPath(); c.moveTo(0, H * .2 + k * 5);
            for (let x = 0; x <= W; x += 8) c.lineTo(x, H * (.2 + k * .09) + Math.sin(x / 28 + t / 420 + k) * 5);
            c.strokeStyle = k % 2 ? `rgba(198,153,255,${a})` : `rgba(88,229,213,${a})`; c.lineWidth = 5; c.stroke();
          }
        }
        if (row?.[TILT]) { c.fillStyle = 'rgba(255,45,45,.38)'; c.fillRect(0, 0, W, H); }
        else if (flare && (react.kind === 'drain' || react.kind === 'done')) { c.fillStyle = `rgba(8,4,20,${.55 * flare})`; c.fillRect(0, 0, W, H); }
        else if (flare && (react.kind === 'extra' || react.kind === 'wizard')) { c.fillStyle = `rgba(255,255,255,${.4 * flare})`; c.fillRect(0, 0, W, H); }
        c.fillStyle = 'rgba(10,8,30,.28)'; c.fillRect(0, 0, W, H);    // a veil so the score stays readable
      },
    };
  }

  // A full set of lanes chases its lights across the rollovers for a moment (the 'mult' callout).
  // Shot-arrow insert lamps, as on a real playfield: each lights while its shot is live, and the lit 2x shot pulses.
  const INSERT_OFF = '#38325c';
  function insertLamps(geo) {
    const lamps = [];
    if (geo.ramp) lamps.push({ tag: 'ins_ramp', x: geo.ramp[0], y: geo.ramp[1] + .75, shot: 3 });
    if (geo.spinner) lamps.push({ tag: 'ins_spinner', x: geo.spinner[0], y: geo.spinner[1] + .8, shot: 2 });
    geo.targets.forEach((r, i) => lamps.push({ tag: 'ins_target' + i, x: r[0] - .55, y: (r[1] + r[3]) / 2, shot: 1, target: i }));
    if (geo.outlane) lamps.push({ tag: 'ins_kick', x: geo.outlane[0] - .45, y: geo.outlane[1] - .5 });
    if (geo.orbit) lamps.push({ tag: 'ins_orbit', x: geo.orbit[0] + .3, y: geo.orbit[1] + .75 });
    if (geo.saucer) lamps.push({ tag: 'ins_saucer', x: geo.saucer[0], y: geo.saucer[1] + .6 });
    if (geo.subway) lamps.push({ tag: 'ins_subway', x: geo.subway[0], y: geo.subway[1] + .6 });
    return lamps;
  }
  // The colour of one insert for this state, or the dark "off" colour.
  function insertColor(l, row) {
    if (row[TILT]) return INSERT_OFF;
    if (l.tag === 'ins_ramp') return rampLit(row) ? rampColor(row) : row[LIT] === 3 ? palette.gold + '88' : INSERT_OFF;
    if (l.tag === 'ins_spinner') return row[HURRY] ? palette.teal : row[LIT] === 2 ? palette.gold : INSERT_OFF;
    if (l.target !== undefined) return row[BANK] >> l.target & 1 ? INSERT_OFF : row[LIT] === 1 ? palette.gold : palette.red;
    if (l.tag === 'ins_kick') return row[KICK] ? palette.gold : INSERT_OFF;
    if (l.tag === 'ins_orbit') return row[STATS]?.orbit ? palette.teal : INSERT_OFF;
    return palette.teal;     // saucer and subway are always open
  }

  // Flasher domes: bright lamps under coloured domes that flare on big awards and glow while a jackpot round runs.
  const FLASHERS = [[3, 1.8], [5.5, 1.8]];
  const FLASH_EVENTS = new Set(['ramp', 'jackpot', 'super', 'multiball', 'wizard', 'lock', 'mission', 'extra', 'hurry', 'mult']);
  const flasherColor = (row, flash) => row[TILT] ? null : FLASH_EVENTS.has(flash) ? palette.ivory : row[OTHERS]?.length ? palette.teal :
    row[JACKPOT] ? palette.gold : null;

  // Attract mode: before the first flip of a game the lamps chase around the table, like a machine waiting for a coin.
  function attractTag(geo, now) {
    const tags = [...geo.lanes.map((_, i) => 'lane' + i), 'ramp', ...geo.bumps.map((_, i) => 'bumper' + i), 'sling0', 'spinner',
      'sling1', ...geo.targets.map((_, i) => 'target' + i)];
    return tags[Math.floor(now / 260) % tags.length];
  }

  function laneSweep(state, flash, lanes) {
    if (flash !== 'mult') { state.at = 0; return -1; }
    const now = performance.now();
    state.at ||= now;
    return Math.floor((now - state.at) / 110) % lanes;
  }

  // The stage size is cached and refreshed by a ResizeObserver, so drawing never forces a layout read.
  function sizeOf(stage) {
    const size = { w: stage.clientWidth, h: stage.clientHeight };
    if (window.ResizeObserver) {
      new ResizeObserver(() => { size.w = stage.clientWidth; size.h = stage.clientHeight; }).observe(stage);
    } else {
      Object.defineProperties(size, { w: { get: () => stage.clientWidth }, h: { get: () => stage.clientHeight } });
    }
    return size;
  }

  // When each part was last hit (by event id, so two quick hits on the same bumper both count) and when a held ball was last kicked out,
  // so a part's hit animation runs its full length even if another event arrives first. age(tag, now, ms) is 0 at the hit and 1 when it is over.
  const hitTracker = () => {
    const at = new Map();
    let id = null, held = false;
    return {
      note(row, now) {
        if (row[EVENT_ID] !== id) { if (id !== null && row[EVENT]) at.set(row[EVENT], now); id = row[EVENT_ID]; }
        const hold = !!row[STATS]?.hold;
        if (held && !hold) at.set('eject', now);
        held = hold;
      },
      age(tag, now, ms) { const t = at.get(tag); return t === undefined ? 1 : Math.min(1, Math.max(0, (now - t) / ms)); },
    };
  };
  // The plunger head follows the pull while it is held; on release it springs past rest and settles (a damped spring) instead of snapping back.
  const plungerSpring = () => {
    const st = { x: 0, v: 0, at: 0 };
    return (target, now, still) => {
      const dt = Math.min(.05, (now - (st.at || now)) / 1000);
      st.at = now;
      if (target > 0 || still) { st.x = target; st.v = 0; } else { st.v += (-170 * st.x - 9 * st.v) * dt; st.x += st.v * dt; }
      return st.x;
    };
  };
  // The two inlane guides as thick bars, as thick as the bats they feed. Their top face is the line the ball rolls on (physics is
  // unchanged), so each bar is drawn half a width underneath it and ends on its flipper's pivot: guide and bat read as one piece.
  const GUIDE_WIDTH = .3;
  const guideBars = (geo) => {
    const from = geo.guides ?? 9, run = geo.guide_run ?? 2;
    if (!run || from - run < 0 || from + run > geo.rails.length) return [];
    return [0, 1].map((side) => {
      const first = from - run + side * run, parts = geo.rails.slice(first, first + run);
      const line = [parts[0].slice(0, 2), ...parts.map((r) => r.slice(2, 4))];
      const down = parts.map(([ax, ay, bx, by]) => {              // each piece's normal toward the outside of the inlane
        const dx = bx - ax, dy = by - ay, n = Math.hypot(dx, dy) || 1, sign = side ? -1 : 1;
        return [-dy / n * sign, dx / n * sign];
      });
      const points = line.map(([x, y], k) => {
        const a = down[Math.max(0, k - 1)], b = down[Math.min(down.length - 1, k)], nx = a[0] + b[0], ny = a[1] + b[1], n = Math.hypot(nx, ny) || 1;
        return [x + nx / n * GUIDE_WIDTH / 2, y + ny / n * GUIDE_WIDTH / 2];
      });
      points[points.length - 1] = geo.flips[side].slice(0, 2);
      return { points, top: line, indexes: parts.map((_, k) => first + k) };
    });
  };
  // A slingshot's rubber, stretched between its two pegs. On a kick the middle snaps out toward the playfield and twangs back (a damped
  // spring). points runs peg to peg along the rubber; (nx, ny) faces the playfield; bow is how far the middle is pushed out right now.
  const SLING_MS = 620, SLING_PIECES = 10;
  const slingPose = ([ax, ay, bx, by], age, still, width) => {
    let nx = by - ay, ny = ax - bx;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    if (nx * (width * .44 - (ax + bx) / 2) + ny * (8 - (ay + by) / 2) < 0) { nx = -nx; ny = -ny; }
    const bow = still || age >= 1 ? 0 : .42 * Math.exp(-4.2 * age) * Math.cos(age * 19) * (1 - age);
    const points = Array.from({ length: SLING_PIECES + 1 }, (_, k) => {
      const t = k / SLING_PIECES, lift = bow * Math.pow(Math.sin(Math.PI * t), 1.4);
      return [ax + (bx - ax) * t + nx * lift, ay + (by - ay) * t + ny * lift];
    });
    return { points, nx, ny, bow };
  };
  // A kicker or saucer: a ring closes in on the hole when it catches the ball, and when it fires the ball out a bright ring and rays burst
  // away (along the eject direction for a kicker hole). Only the hole nearest the ball animates, as the engine's events do not say which.
  function kickerBurst(c, x, y, r, ball, holes, i, hits, now, angle) {
    if (calm()) return;
    const nearest = holes.reduce((best, h, k) => (Math.hypot(h[0] - ball[0], h[1] - ball[1]) < Math.hypot(holes[best][0] - ball[0], holes[best][1] - ball[1]) ? k : best), 0);
    if (nearest !== i && holes.length > 1) return;
    const take = hits.age('hole', now, 520), take2 = hits.age('saucer', now, 520), eject = hits.age('eject', now, 520);
    const grab = Math.min(take, take2);
    if (grab < 1) {
      c.beginPath(); c.arc(x, y, r + .08 + .9 * grab, 0, Math.PI * 2);
      c.strokeStyle = `rgba(255,240,202,${.8 * (1 - grab)})`; c.lineWidth = .07 * (1 - grab) + .01; c.stroke();
    }
    if (eject < 1) {
      const reach = .35 + 1.3 * eject;
      c.strokeStyle = `rgba(255,211,131,${.9 * (1 - eject)})`; c.lineWidth = .06 * (1 - eject) + .01;
      c.beginPath(); c.arc(x, y, r + .08 + .5 * eject, 0, Math.PI * 2); c.stroke();
      for (let k = 0; k < 8; k++) {
        const th = angle === null || angle === undefined ? k * Math.PI / 4 : angle + (k - 3.5) * .22, co = Math.cos(th), si = Math.sin(th);
        c.beginPath(); c.moveTo(x + co * (r + .1), y + si * (r + .1)); c.lineTo(x + co * (r + .1 + reach), y + si * (r + .1 + reach)); c.stroke();
      }
    }
  }
  // what a decal light can react to: the ball(s), the last event, and the game states that last (multiball, a jackpot round, a ball save, tilt, hurry-up)
  const lampEnv = (row, ball, others, flash) => {
    const states = new Set();
    if (row[OTHERS]?.length) states.add('multiball');
    if (row[JACKPOT] > 0) states.add('jackpot');
    if (row[SAVE] > 0 && !row[STAGED]) states.add('save');
    if (row[TILT]) states.add('tilt');
    if (row[HURRY] > 0) states.add('hurry');
    return { balls: row[BALLS] ? [ball, ...others] : [], flash, states, calm: calm() };
  };
  function flatRenderer(stage, geo, art) {
    const still = calm();
    const size = sizeOf(stage);
    const canvas = document.createElement('canvas');
    canvas.className = 'pb-flat';
    const c = canvas.getContext('2d');
    if (!c) return null;
    stage.prepend(canvas);
    // The static table art lives on its own canvas underneath, painted once per resize instead of every frame.
    const back = document.createElement('canvas');
    back.className = 'pb-flat-bg';
    back.setAttribute('aria-hidden', 'true');
    stage.prepend(back);
    const bc = back.getContext('2d');
    const track = geo.ramp ? rampPoints(geo) : [];
    const line = (points, width, color) => {
      c.beginPath();
      points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
      c.lineWidth = width;
      c.strokeStyle = color;
      c.stroke();
    };
    // The ball and its halo are pre-rendered once per canvas size: building radial gradients every
    // frame (for each multiball ball too) was the flat renderer's main per-frame cost.
    let sprites = null;
    const makeSprites = (unit) => {
      const size = Math.max(8, Math.round(geo.radius * 2 * unit)), mid = size / 2;
      const ball = document.createElement('canvas');
      ball.width = ball.height = size;
      const b = ball.getContext('2d');
      const shine = b.createRadialGradient(mid - .055 * unit, mid - .065 * unit, .018 * unit, mid, mid, mid);
      shine.addColorStop(0, '#fffaf0');
      shine.addColorStop(.45, '#c3d2d7');
      shine.addColorStop(.8, '#657882');
      shine.addColorStop(1, '#26313a');
      b.fillStyle = shine;
      b.beginPath();
      b.arc(mid, mid, mid, 0, Math.PI * 2);
      b.fill();
      const halo = document.createElement('canvas');
      halo.width = halo.height = 64;
      const h = halo.getContext('2d');
      const glow = h.createRadialGradient(32, 32, 6, 32, 32, 32);
      glow.addColorStop(0, 'rgba(255,214,130,1)');
      glow.addColorStop(1, 'rgba(255,214,130,0)');
      h.fillStyle = glow;
      h.fillRect(0, 0, 64, 64);
      return { ball, halo, unit };
    };
    // the ball keeps one size and stays round: swelling or stretching it reads as the ball itself changing size
    const drawBall = (x, y) => c.drawImage(sprites.ball, x - geo.radius, y - geo.radius, geo.radius * 2, geo.radius * 2);
    let rippleTag = '', rippleAt = 0;
    const sweepState = {};
    const disc = (x, y, radius, color) => {
      c.beginPath();
      c.arc(x, y, radius, 0, 2 * Math.PI);
      c.fillStyle = color;
      c.fill();
    };
    const rail = ([ax, ay, bx, by], color, width) => line([[ax, ay], [bx, by]], width, color);
    const lamps = PinballArt.lights(geo);       // decals with a light effect are drawn live, not baked into the art
    const hits = hitTracker(), plungeAt = plungerSpring();
    return {
      draw(row, ball, flash, trail = [], gate = 0, others = []) {
        const tNow = performance.now();
        hits.note(row, tNow);
        const ratio = GL3.level() === 'low' ? 1 : Math.min(1.5, window.devicePixelRatio || 1);
        const width = Math.round(size.w * ratio);
        const height = Math.round(size.h * ratio);
        if (!width || !height) return;
        if (!flash?.startsWith('bumper')) rippleTag = '';
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = back.width = width;
          canvas.height = back.height = height;
          sprites = null;
          bc.setTransform(width / 11, 0, 0, height / 18.7, width / 22, height * .85 / 18.7);
          bc.fillStyle = '#211c3d';
          bc.fillRect(-.46, -.78, 10.92, 18.56);
          bc.drawImage(art, 0, 0, geo.width, geo.height);
        }
        if (!sprites) sprites = makeSprites(width / 11);
        c.setTransform(width / 11, 0, 0, height / 18.7, width / 22, height * .85 / 18.7);
        c.clearRect(-.5, -.85, 11, 18.7);
        c.lineCap = 'round';
        if (lamps.count) {
          for (const l of lamps.update(performance.now(), lampEnv(row, ball, others, flash))) {
            c.save(); c.translate(l.x, l.y); c.globalAlpha = l.alpha * .8; c.fillStyle = c.strokeStyle = l.color; c.lineWidth = l.r * .16; c.lineJoin = 'round';
            PinballArt.glyphPath(c, l.glyph, l.r); l.glyph === 'ring' ? c.stroke() : c.fill(); c.restore();
          }
        }
        const bars = guideBars(geo), thick = new Set(bars.flatMap((b) => b.indexes));
        geo.rails.forEach((r, i) => {
          if (thick.has(i)) return;
          rail(r, '#17152f', .3);
          rail(r, railTrim(geo, i, palette.steel), .14);
        });
        c.lineJoin = 'round';
        for (const { points, top, indexes } of bars) {
          line(points.map(([x, y]) => [x + .04, y + .07]), GUIDE_WIDTH + .04, '#00000055');
          line(points, GUIDE_WIDTH + .05, '#17152f');
          line(points, GUIDE_WIDTH - .02, railTrim(geo, indexes[indexes.length - 1], palette.steel));
          line(top.map(([x, y], k) => [x + (points[k][0] - x) * .45, y + (points[k][1] - y) * .45]), .06, '#ffffff77');
        }
        if (geo.gate) {
          const [hx, hy, , ey] = geo.gate, a = 1.25 * gate, len = ey - hy;
          const tip = [hx + len * Math.sin(a), hy + len * Math.cos(a)];
          rail([hx, hy, ...tip], '#17152f', .26);
          rail([hx, hy, ...tip], palette.steel, .13);
          rail([hx, hy, ...tip], '#ffffff55', .035);
          disc(...tip, .08, palette.gold);
          disc(hx, hy, .19, '#17152f');
          disc(hx, hy, .13, palette.gold);
          disc(hx, hy, .045, '#17152f');
        }
        insertLamps(geo).forEach((l) => {
          const color = insertColor(l, row), on = color !== INSERT_OFF;
          const blink = on && l.shot === row[LIT] && Math.floor(performance.now() / 220) % 2;
          disc(l.x, l.y, .17, '#17152f');
          disc(l.x, l.y, .12, flash === l.tag ? palette.ivory : blink ? palette.ivory : color);
        });
        if (geo.orbit) {
          const [ox, oy, orad] = geo.orbit, open = row[STATS]?.orbit;
          line(geo.orbit_path, .3, '#252049');
          line(geo.orbit_path, .08, open || flash === 'orbit' ? palette.teal : paintOf(geo, 'orbit', undefined, palette.steel));
          disc(ox, oy, orad * .6, flash === 'orbit' ? palette.ivory : open ? '#59edd266' : '#0c0a1c');
          const ends = orbitEnds(geo), rim = open || flash === 'orbit' ? palette.teal : paintOf(geo, 'orbit', undefined, palette.steel);
          for (const g of [...ends.funnel, ...ends.flare]) { rail(g, '#252049', .13); rail(g, rim, .06); }
        }
        // the two outlane lamps: gold = ready; once the kickback has fired (red ✕) or the special has paid out (green ✓) it goes dark until re-armed
        const lampMark = (sx, sy, mark, color) => {
          c.beginPath(); c.strokeStyle = color; c.lineWidth = .05; c.lineCap = 'round';
          if (mark === 'x') { c.moveTo(sx - .09, sy - .09); c.lineTo(sx + .09, sy + .09); c.moveTo(sx + .09, sy - .09); c.lineTo(sx - .09, sy + .09); }
          else { c.moveTo(sx - .1, sy + .01); c.lineTo(sx - .03, sy + .08); c.lineTo(sx + .1, sy - .08); }
          c.stroke();
        };
        if (geo.outlane) {
          const sx = geo.outlane[0] / 2, sy = geo.outlane[1] - 1, armed = row[KICK], pulse = .55 + .45 * Math.abs(Math.sin(performance.now() / 280));
          disc(sx, sy, .26, '#252049');
          disc(sx, sy, .2, flash === 'kickback' ? palette.ivory : armed ? palette.gold : '#3a1f2e');
          if (armed && flash !== 'kickback') { c.globalAlpha = pulse * .5; disc(sx, sy, .3, palette.gold); c.globalAlpha = 1; }
          if (!armed) lampMark(sx, sy, 'x', '#ff6854');
        }
        if (geo.special) {
          const sx = (geo.special[0] + geo.width - 1.2) / 2, sy = geo.special[1] - 1, lit = row[STATS]?.special, used = row[STATS]?.special_used;
          disc(sx, sy, .26, '#252049');
          disc(sx, sy, .2, flash === 'special' ? palette.ivory : lit ? palette.gold : used ? '#1f3a33' : '#38325c');
          if (lit && flash !== 'special') { c.globalAlpha = (.55 + .45 * Math.abs(Math.sin(performance.now() / 280))) * .5; disc(sx, sy, .3, palette.gold); c.globalAlpha = 1; }
          if (used) lampMark(sx, sy, 'tick', '#59edd2');
        }
        if (geo.magnet) {
          const [mx, my, mr] = geo.magnet, mag = row[STATS]?.magnet || 0;
          if (mag) disc(mx, my, mr * (mag === 2 ? .8 : .5), mag === 2 ? '#59edd233' : '#59edd214');
          disc(mx, my, .24, '#252049');
          disc(mx, my, .16, mag === 2 ? palette.ivory : mag ? palette.teal : '#38325c');
        }
        (geo.rubbers || []).forEach((r, i) => { rail(r, '#252049', .24); rail(r, row[STATS]?.post > 0 ? palette.gold : paintOf(geo, 'rubbers', i, palette.ivory), .15); });
        (geo.movers || []).forEach(([x1, y1, x2, y2], i) => {          // a sliding target: dotted track plus the paddle itself
          const [mx, my] = row[STATS]?.movers?.[i] || [x1, y1], nx = y2 - y1, ny = x1 - x2, n = Math.hypot(nx, ny) || 1;
          c.setLineDash([.08, .1]); rail([x1, y1, x2, y2], '#ffffff33', .04); c.setLineDash([]);
          const hit = flash === 'mover' + i, col = hit ? palette.ivory : paintOf(geo, 'movers', i, palette.red);
          rail([mx - nx / n * .3, my - ny / n * .3, mx + nx / n * .3, my + ny / n * .3], '#252049', .38); rail([mx - nx / n * .3, my - ny / n * .3, mx + nx / n * .3, my + ny / n * .3], col, .28);
        });
        (geo.holes || []).forEach(([hx, hy, hr, ha], i) => {
          const col = paintOf(geo, 'holes', i, palette.gold), a = ha * Math.PI / 180;
          disc(hx, hy, hr + .07, '#252049'); disc(hx, hy, hr, row[EVENT] === 'hole' ? '#fff0ca88' : '#0c0a1c');
          rail([hx + Math.cos(a) * hr * .6, hy + Math.sin(a) * hr * .6, hx + Math.cos(a) * (hr + .3), hy + Math.sin(a) * (hr + .3)], col, .08);
          kickerBurst(c, hx, hy, hr, ball, geo.holes, i, hits, tNow, a);
        });
        (geo.flaps || []).forEach((r, i) => {          // one-way flaps: a thin hinged gate with a hinge dot
          rail(r, '#17152f', .2); rail(r, paintOf(geo, 'flaps', i, palette.gold), .09); disc(r[0], r[1], .1, palette.ivory);
        });
        if (geo.portals) {
          const [x1, y1, x2, y2, pr] = geo.portals, col = paintOf(geo, 'portal', undefined, palette.teal), t = performance.now() / 600;
          for (const [px, py] of [[x1, y1], [x2, y2]]) {
            disc(px, py, pr + .1, '#252049'); disc(px, py, pr, '#0c0a1c');
            c.beginPath(); c.arc(px, py, pr * (.55 + .25 * Math.abs(Math.sin(t))), 0, Math.PI * 2); c.strokeStyle = col; c.lineWidth = .05; c.stroke();
          }
          if (row[EVENT] === 'portal') { disc(x1, y1, pr, '#ffffff66'); disc(x2, y2, pr, '#ffffff66'); }
        }
        // a post is a peg in a rubber ring: a shadow, the ring, a metal cap and a glint
        (geo.posts || []).forEach(([x, y, r], i) => {
          disc(x + .04, y + .06, r + .07, '#00000055');
          disc(x, y, r + .05, '#17152f');
          disc(x, y, r, row[STATS]?.post > 0 ? palette.gold : paintOf(geo, 'posts', i, palette.ivory));
          disc(x, y, r * .55, '#9fb0c8');
          disc(x - r * .18, y - r * .2, r * .22, '#ffffff');
        });
        geo.slings.forEach((r, i) => {
          // a kick: the rubber bows out toward the ball and twangs back while the kicker arm drives in behind it; the pegs flare and sparks fly
          const age = hits.age('sling' + i, tNow, SLING_MS), kick = 1 - age, lit = !still && age < 1;
          const { points, nx, ny, bow } = slingPose(r, age, still, geo.width);
          const colour = lit && age < .22 ? palette.ivory : paintOf(geo, 'slings', i, palette.red);
          const mx = (r[0] + r[2]) / 2, my = (r[1] + r[3]) / 2;
          rail(r, '#252049', .3);                                                              // the channel the rubber sits in
          rail([mx - nx * .3, my - ny * .3, mx + nx * (bow - .13), my + ny * (bow - .13)], '#9fb0c8', .1);      // the kicker arm
          disc(mx + nx * (bow - .13), my + ny * (bow - .13), .11, lit && kick > .5 ? palette.gold : '#c1d2e5');
          if (lit) line(points, .3 + .45 * kick, `rgba(255,243,168,${.45 * kick})`);
          line(points.map(([x, y]) => [x + .04, y + .07]), .22, '#00000055');
          line(points, .24, '#17152f');
          line(points, .17, colour);
          line(points.map(([x, y]) => [x + nx * .035, y + ny * .035]), .04, '#ffffff88');
          for (const [px, py] of [[r[0], r[1]], [r[2], r[3]]]) {
            disc(px, py, .17 + (lit ? .04 * kick : 0), '#17152f'); disc(px, py, .12, colour); disc(px, py, .065, '#c1d2e5'); disc(px - .02, py - .025, .025, '#ffffff');
          }
          if (lit) {
            c.strokeStyle = `rgba(255,243,168,${.9 * kick})`;
            c.lineWidth = .045;
            for (let k = -2; k <= 2; k++) {
              const t = .5 + k * .17, bx = r[0] + (r[2] - r[0]) * t, by = r[1] + (r[3] - r[1]) * t, reach = .25 + .75 * age;
              c.beginPath();
              c.moveTo(bx + nx * .45, by + ny * .45);
              c.lineTo(bx + nx * (.45 + reach) + ny * k * .06, by + ny * (.45 + reach) - nx * k * .06);
              c.stroke();
            }
          }
        });
        geo.targets.forEach((r, i) => {
          const age = hits.age('target' + i, tNow, 420), down = row[BANK] & (1 << i);
          // a standing target is a raised face with a shadow and a stripe; a hit rocks it back, a dropped one lies flush
          const away = slingPose(r, 1, true, geo.width), rock = still || age >= 1 ? 0 : .16 * Math.exp(-4 * age) * Math.cos(age * 14);
          const face = [r[0] - away.nx * rock, r[1] - away.ny * rock, r[2] - away.nx * rock, r[3] - away.ny * rock];
          if (!down) rail([r[0] + .07, r[1] + .09, r[2] + .07, r[3] + .09], '#00000066', .3);
          rail(face, '#17152f', .34);
          rail(face, flash === 'target' + i ? palette.ivory : down ? '#38325c' : paintOf(geo, 'targets', i, palette.red), down ? .16 : .26);
          if (lastTarget(row, i)) {          // the last one standing in the bank: a blinking gold ring
            const on = still || Math.floor(tNow / 220) % 2;
            c.beginPath(); c.arc((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, .5 + (still ? 0 : .08 * Math.sin(tNow / 140)), 0, Math.PI * 2);
            c.strokeStyle = on ? palette.gold : '#ffd38355'; c.lineWidth = .06; c.stroke();
          }
          if (!down) rail([face[0] + away.nx * .06, face[1] + away.ny * .06, face[2] + away.nx * .06, face[3] + away.ny * .06], '#ffffff99', .05);
          if (!still && age < 1) {            // a hit: a flash along the target and sparks off its face
            rail(r, `rgba(255,243,168,${.6 * (1 - age)})`, .28 + .3 * (1 - age));
            const mx = (r[0] + r[2]) / 2, my = (r[1] + r[3]) / 2;
            c.strokeStyle = `rgba(255,243,168,${.9 * (1 - age)})`; c.lineWidth = .04;
            for (let k = 0; k < 5; k++) {
              const th = (k - 2) * .5, co = Math.cos(th), si = Math.sin(th), d0 = .22, d1 = .22 + .7 * age;
              c.beginPath(); c.moveTo(mx + co * d0, my + si * d0); c.lineTo(mx + co * d1, my + si * d1); c.stroke();
            }
          }
        });
        FLASHERS.forEach(([fx, fy], i) => {
          const color = flasherColor(row, flash);
          disc(fx, fy, .26, '#17152f');
          if (color) {
            const wave = .6 + .4 * Math.sin(performance.now() / 120 + i * Math.PI);
            disc(fx, fy, .6, color + '22');
            disc(fx, fy, .38, color + (wave > .8 ? 'aa' : '66'));
          }
          disc(fx, fy, .17, color ? color : '#4a2e46');
        });
        // during a jackpot round or multiball the bumper caps chase in gold
        const chase = !row[TILT] && (jackpotLit(row) || row[STATS]?.streak >= 2) ? Math.floor(performance.now() / 180) % geo.bumps.length : -1;
        geo.bumps.forEach(([x, y, radius], i) => {
          // a hit: the whole bumper pops out and rings back to rest, two shock rings and a starburst fly out, and a bloom lights the felt
          const age = hits.age('bumper' + i, tNow, 600), pop = 1 - age, hit = age < .3;
          const spring = still ? 1 : 1 + .22 * Math.exp(-5 * age) * Math.cos(age * 15), rr = radius * spring;
          if (!still && age < 1) {
            disc(x, y, radius + .55 * pop, `rgba(255,243,168,${.32 * pop * pop})`);
            for (const [delay, grow, width] of [[0, 1.3, .1], [.22, 1, .06]]) {
              const a = Math.min(1, Math.max(0, age - delay) / (1 - delay));
              if (a > 0 && a < 1) {
                c.beginPath();
                c.arc(x, y, radius + .1 + a * grow, 0, Math.PI * 2);
                c.strokeStyle = `rgba(255,243,168,${.85 * (1 - a)})`;
                c.lineWidth = width * (1 - a) + .01;
                c.stroke();
              }
            }
            if (age < .55) {
              c.strokeStyle = `rgba(255,255,255,${.9 * (1 - age / .55)})`;
              c.lineWidth = .05;
              for (let k = 0; k < 8; k++) {
                const th = k * Math.PI / 4 + Math.PI / 8, co = Math.cos(th), si = Math.sin(th);
                c.beginPath();
                c.moveTo(x + co * (radius + .14 + age * .5), y + si * (radius + .14 + age * .5));
                c.lineTo(x + co * (radius + .32 + age * 1.2), y + si * (radius + .32 + age * 1.2));
                c.stroke();
              }
            }
          }
          disc(x, y, rr, '#252049');
          if (hit) { disc(x, y, rr + .12, '#fff3a8'); disc(x, y, rr + .02, '#211c3d'); }
          disc(x, y - .035, rr - (hit ? .14 : .08), hit ? palette.ivory : chase === i ? palette.gold : paintOf(geo, 'bumps', i, bumperColors[i]));   // the skirt dips on a hit
          disc(x, y - .07, rr - .24, '#30244f');
          disc(x, y - .12, .18 * spring, palette.ivory);
        });
        const sweep = laneSweep(sweepState, flash, geo.lanes.length);
        geo.lanes.forEach(([x, y], i) => {
          disc(x, y, .26, '#252049');
          disc(x, y, .2, flash === 'lane' + i || flash === 'skill' || sweep === i ? palette.ivory : row[STAGED] && row[STATS]?.skill_lane === i ? palette.gold : paintOf(geo, 'lanes', i, palette.teal));
        });
        const lit = rampLit(row);
        const rampHit = flash === 'ramp' || flash === 'jackpot';
        const glow = rampHit ? palette.ivory : rampColor(row);
        if (geo.ramp) {
          line(track, .4, lit || rampHit ? glow + '55' : '#252049');
          line(track, .09, rampHit || lit ? glow : paintOf(geo, 'ramp', undefined, palette.steel));
          if (rampHit || lit) disc(...geo.ramp, .35, glow + '55');
          disc(...geo.ramp, .21, rampHit || lit ? glow : '#38325c');
        }
        if (geo.saucer) {
          const [ux, uy, ur] = geo.saucer;
          disc(ux, uy, ur + .07, '#252049');
          disc(ux, uy, ur, row[EVENT] === 'saucer' ? '#fff0ca88' : row[STATS]?.hold && Math.floor(performance.now() / 150) % 2 ? palette.gold : '#0c0a1c');   // the lamp flashes while the ball is held
          kickerBurst(c, ux, uy, ur, ball, [geo.saucer], 0, hits, tNow, null);
        }
        if (geo.subway) {
          const [wx, wy, wr] = geo.subway;
          disc(wx, wy, wr + .07, paintOf(geo, 'subway', undefined, '#252049'));
          disc(wx, wy, wr, row[EVENT] === 'subway' || row[STATS]?.under ? '#59edd288' : '#0c0a1c');   // lit while a ball is underneath
        }
        if (geo.spinner) {
          const [sx, sy] = geo.spinner;
          disc(sx, sy, .18, flash === 'spinner' ? '#fff0ca88' : '#c1d2e522');
          rail([sx - .47, sy, sx + .47, sy], flash === 'spinner' ? palette.ivory : paintOf(geo, 'spinner', undefined, palette.steel),
            .08 + .19 * Math.abs(Math.cos(row[SPIN] * 2 * Math.PI)));
        }
        geo.flips.forEach(([x, y], i) => {
          const angle = i < 2 ? ball[3 + i] : row[STATS]?.flips2?.[i - 2] ?? geo.flips[i][2];
          // tapered rubber: round pivot end (r .26) to round tip (r .15)
          const ex = x + geo.length * Math.cos(angle), ey = y + geo.length * Math.sin(angle);
          const nx = -Math.sin(angle), ny = Math.cos(angle);
          for (const [color, grow] of [['#211b40', .05], [flipperColors[i % 2], 0]]) {
            c.beginPath();
            c.moveTo(x + nx * (.26 + grow), y + ny * (.26 + grow));
            c.lineTo(ex + nx * (.15 + grow), ey + ny * (.15 + grow));
            c.arc(ex, ey, .15 + grow, angle + Math.PI / 2, angle - Math.PI / 2, true);
            c.lineTo(x - nx * (.26 + grow), y - ny * (.26 + grow));
            c.arc(x, y, .26 + grow, angle - Math.PI / 2, angle + Math.PI / 2, true);
            c.closePath();
            c.fillStyle = color;
            c.fill();
          }
          disc(x, y, .1, palette.gold);
        });
        const [launchX, launchY] = geo.launch;
        const pull = plungeAt(row[CHARGE] / 240, tNow, still), plungerY = launchY + .39 + .25 * pull, baseY = 17.15;
        // the launch spring: a coil that squeezes (and warms to gold) as the plunger is pulled, a rod down its middle and a domed head
        const coil = [];
        for (let i = 0; i <= 18; i++) coil.push([launchX + (i % 2 ? .19 : -.19) * (i && i < 18 ? 1 : 0), plungerY + .12 + (baseY - plungerY - .12) * i / 18]);
        rail([launchX, plungerY, launchX, baseY, ], '#2b2750', .09);
        line(coil, .085, '#17152f');
        line(coil, .05, pull > .8 ? palette.gold : palette.steel);
        line(coil.map(([x, y]) => [x - .02, y]), .014, '#ffffff66');
        if (pull > .02) disc(launchX, plungerY, .34, `rgba(255,211,131,${.28 * pull})`);
        rail([launchX - .2, plungerY, launchX + .2, plungerY], '#17152f', .27);
        rail([launchX - .2, plungerY, launchX + .2, plungerY], palette.gold, .19);
        rail([launchX - .15, plungerY - .05, launchX + .15, plungerY - .05], '#fff0ca99', .035);
        if (row[BALLS] && ball[2] > -.5) {
          const tint = TRAIL_TINT[Math.min(row[MULT], 5) - 1] || TRAIL_TINT[0];
          trail.forEach(([tx, ty], i) => disc(tx, ty, geo.radius * (.3 + .5 * i / trail.length), `rgba(${tint},${.05 + .14 * i / trail.length})`));
          const [x, y, z] = ball;
          // a fast ball burns brighter: a warm halo that grows with its speed
          const last = trail[trail.length - 1], speed = last ? Math.hypot(x - last[0], y - last[1]) : 0;
          if (!still && speed > .12) {
            const reach = geo.radius * (2 + 4 * Math.min(speed, .6));
            c.globalAlpha = Math.min(.45, speed);
            c.drawImage(sprites.halo, x - reach, y - z * .14 - reach, reach * 2, reach * 2);
            c.globalAlpha = 1;
          }
          disc(x + .1, y + .1, geo.radius * 1.25, '#26141483');
          const ballY = y - z * .14;
          const bumperHit = flash?.startsWith('bumper');
          if (bumperHit) {
            c.beginPath();
            c.arc(x, ballY, geo.radius * 1.8, 0, Math.PI * 2);
            c.strokeStyle = '#fff3a8';
            c.lineWidth = .055;
            c.stroke();
          }
          if (row[SAVE] > 0 && !row[STAGED]) {
            c.beginPath();
            c.arc(x, ballY, geo.radius * 1.9, 0, Math.PI * 2);
            c.fillStyle = 'rgba(94,230,200,.16)';
            c.fill();
            c.strokeStyle = 'rgba(94,230,200,.7)';
            c.lineWidth = .03;
            c.stroke();
          }
          drawBall(x, ballY);
        }
        // multiball: the other balls in play
        others.forEach(([ox, oy, oz]) => {
          const oyy = oy - oz * .14;
          disc(ox + .1, oy + .1, geo.radius * 1.25, '#26141483');
          drawBall(ox, oyy);
        });
      },
      dispose: () => { canvas.remove(); back.remove(); },
    };
  }

  function threeRenderer(T, stage, geo, art, onLost) {
    const renderer = GL3.renderer({ alpha: false }, { onLost, cap: GL3.level() === 'low' ? 1 : undefined });
    if (!renderer) return null;
    const scene = new T.Scene();
    scene.background = new T.Color('#17172f');
    const lighting = GL3.stage(renderer, scene, {
      exposure: 1.02, hemi: [0xd9dcff, 0x42356f, .82],
      key: { color: 0xc9d8ff, i: 1.28, pos: [-4, 14, 2], area: 11 },
      env: { walls: 0x252047, lamp: 0xffe5b2, accent: 0x7360c5 },
    });
    // Keep the shadow volume centered on the whole playfield.
    lighting.key.position.add(new T.Vector3(5, 0, 8.5));
    lighting.key.target.position.set(5, 0, 8.5);
    const camera = new T.OrthographicCamera(-5.5, 5.5, 9.35, -9.35, .1, 80);
    camera.position.set(5, 23, 12.3);
    camera.lookAt(5, 0, 8.5);

    const material = (color, metalness = .05, roughness = .48) =>
      new T.MeshStandardMaterial({ color, metalness, roughness });
    // Procedural grey maps: fine speckle for rubber, long streaks for brushed metal. Skipped on Low graphics.
    function grain(w, h, paint) {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const g2 = cv.getContext('2d');
      paint(g2, w, h);
      const t = new T.Texture(cv);
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.needsUpdate = true;
      return t;
    }
    const rubberBump = lighting.low ? null : grain(128, 128, (g2, w, h) => {
      g2.fillStyle = '#808080'; g2.fillRect(0, 0, w, h);
      for (let i = 0; i < 1800; i++) {
        const v = 90 + Math.random() * 110 | 0;
        g2.fillStyle = `rgb(${v},${v},${v})`;
        g2.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
      }
    });
    const brushed = lighting.low ? null : grain(256, 64, (g2, w, h) => {
      g2.fillStyle = '#d0d0d0'; g2.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) {
        const v = 150 + Math.random() * 105 | 0;
        g2.fillStyle = `rgba(${v},${v},${v},.55)`;
        g2.fillRect(Math.random() * w, Math.random() * h, 30 + Math.random() * 160, 1);
      }
    });
    const chrome = material(palette.steel, lighting.low ? .28 : .95, .2);
    if (brushed) { chrome.roughnessMap = brushed; chrome.envMapIntensity = 1.5; }
    // the ball is a polished mirror: no roughness map, a stronger reflection
    const ballSteel = material('#f3f6ff', lighting.low ? .3 : 1, lighting.low ? .3 : .06);
    if (!lighting.low) ballSteel.envMapIntensity = 1.9;
    const rubber = (color) => {
      const m = material(color, 0, .92);
      if (rubberBump) { m.bumpMap = rubberBump; m.bumpScale = .8; }
      return m;
    };
    const rubberRed = rubber('#d94a38');
    const rubberDark = rubber('#2b2548');
    const brass = material(palette.gold, .38, .32);
    const dark = material('#26204a');
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
    // decals with a light effect: a white glyph texture tinted and faded every frame, just above the printed art
    const lamps = PinballArt.lights(geo), lampMeshes = [];
    for (const [glyph, x, y, r] of (geo.paint?.decals || []).filter((d) => d[5])) {
      const glyphCanvas = document.createElement('canvas');
      glyphCanvas.width = glyphCanvas.height = 128;
      const gc = glyphCanvas.getContext('2d');
      gc.translate(64, 64); gc.fillStyle = gc.strokeStyle = '#fff'; gc.lineWidth = 8; gc.lineJoin = 'round';
      PinballArt.glyphPath(gc, glyph, 50); glyph === 'ring' ? gc.stroke() : gc.fill();
      const lampMesh = new T.Mesh(new T.PlaneGeometry(r * 2.56, r * 2.56), new T.MeshBasicMaterial({ map: new T.CanvasTexture(glyphCanvas), transparent: true, depthWrite: false }));
      lampMesh.position.set(x, .02, y);
      lampMesh.rotation.x = -Math.PI / 2;
      scene.add(lampMesh);
      lampMeshes.push(lampMesh);
    }
    for (const x of [-.26, 10.26]) rail([x, -.37, x, 17.4], .24, .23, .1, chrome);
    for (const y of [-.37, 17.4]) rail([-.23, y, 10.23, y], .22, .23, .1, brass);
    const bars = guideBars(geo), thick = new Set(bars.flatMap((b) => b.indexes));
    geo.rails.forEach((r, i) => {
      if (thick.has(i)) return;
      const trim = i >= (geo.guides ?? 9) ? material(railTrim(geo, i, palette.steel), .35, .34) : chrome;
      rail(r, .18, .35, .15, trim);
    });
    for (const { points, indexes } of bars) {
      const trim = material(railTrim(geo, indexes[indexes.length - 1], palette.steel), .35, .34);
      points.slice(1).forEach((b, k) => rail([...points[k], ...b], GUIDE_WIDTH, .38, .19, trim));
      for (const [x, y] of points) disc(x, y, GUIDE_WIDTH / 2, .38, .19, trim);        // rounded joints and ends
    }
    let gateFlap;
    if (geo.gate) {
      const [hx, hy, , ey] = geo.gate, len = ey - hy;
      gateFlap = new T.Group();
      gateFlap.position.set(hx, .3, hy);
      gateFlap.add(box(len, .1, .3, chrome, len / 2, 0, 0), box(.2, .16, .08, brass, len - .1, 0, .19));
      scene.add(gateFlap);
      disc(hx, hy, .2, .5, .3, brass);
      disc(hx, hy, .07, .05, .58, dark);
      disc(hx, hy + len, .1, .5, .3, brass);
    }
    FLASHERS.forEach(([fx, fy], i) => {
      disc(fx, fy, .26, .03, .03, dark);
      disc(fx, fy, .17, .06, .06, lamp('flash' + i, '#4a2e46', null));
    });
    insertLamps(geo).forEach((l) => {
      disc(l.x, l.y, .17, .02, .035, dark);
      disc(l.x, l.y, .12, .03, .06, lamp(l.tag, INSERT_OFF, (row) => { const c = insertColor(l, row); return c === INSERT_OFF ? null : c.slice(0, 7); }));
    });
    if (geo.orbit) {
      const orbitRail = lamp('orbit', paintOf(geo, 'orbit', undefined, palette.steel), row => row[STATS]?.orbit ? palette.teal : paintOf(geo, 'orbit', undefined, palette.steel));
      orbitRail.metalness = chrome.metalness;
      orbitRail.roughness = chrome.roughness;
      const base = new T.CatmullRomCurve3(geo.orbit_path.map(([x, y]) => new T.Vector3(x, .45, y)));
      for (const side of [-.16, .16]) {       // two wire rails, offset square to the wire all the way round
        const points = Array.from({ length: 64 }, (_, i) => { const u = i / 63, q = base.getPointAt(u), t = base.getTangentAt(u); return new T.Vector3(q.x - t.z * side, .45, q.z + t.x * side); });
        mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points), 64, .04, 6, false), orbitRail, 0, 0, 0);
      }
      const ends = orbitEnds(geo);
      for (const g of [...ends.funnel, ...ends.flare]) rail(g, .07, .3, .32, chrome);
    }
    if (geo.special) {
      const sx = (geo.special[0] + geo.width - 1.2) / 2, sy = geo.special[1] - 1;
      disc(sx, sy, .27, .03, .04, brass);
      disc(sx, sy, .2, .04, .08, lamp('special', '#38325c', row => row[STATS]?.special ? palette.gold : row[STATS]?.special_used ? '#59edd2' : '#38325c'));
    }
    if (geo.outlane) {      // the kickback lamp on the left: gold while armed, red once it has fired
      const sx = geo.outlane[0] / 2, sy = geo.outlane[1] - 1;
      disc(sx, sy, .27, .03, .04, brass);
      disc(sx, sy, .2, .04, .08, lamp('kicklamp', '#ff6854', row => row[KICK] ? palette.gold : '#ff6854'));
    }
    if (geo.magnet) {
      const [mx, my] = geo.magnet;
      disc(mx, my, .24, .03, .03, brass);
      disc(mx, my, .16, .05, .05, lamp('magnet', '#38325c', row => row[STATS]?.magnet === 2 ? palette.ivory : row[STATS]?.magnet ? palette.teal : '#38325c'));
    }
    (geo.rubbers || []).forEach((r, i) => rail(r, .15, .3, .2, material(paintOf(geo, 'rubbers', i, '#f2ecdd'), .8, .1)));
    (geo.holes || []).forEach(([hx, hy, hr], i) => { disc(hx, hy, hr + .07, .05, .03, brass); disc(hx, hy, hr, .06, .02, material('#0c0a1c', .9, .1)); });
    const moverMeshes = (geo.movers || []).map(([x1, y1, x2, y2], i) => {
      const len = Math.hypot(x2 - x1, y2 - y1), ang = Math.atan2(y2 - y1, x2 - x1);
      rail([x1, y1, x2, y2], .04, .5, .05, chrome);
      const m = box(.12, .3, .6, lamp('mover' + i, paintOf(geo, 'movers', i, palette.red)), x1, .3, y1);
      m.rotation.y = -ang; return m;
    });
    (geo.flaps || []).forEach((r, i) => rail(r, .1, .5, .12, material(paintOf(geo, 'flaps', i, palette.gold), .4, .3)));
    if (geo.portals) {
      const [x1, y1, x2, y2, pr] = geo.portals, col = paintOf(geo, 'portal', undefined, palette.teal);
      for (const [px, py] of [[x1, y1], [x2, y2]]) { disc(px, py, pr + .07, .05, .03, brass); disc(px, py, pr, .06, .05, lamp('portal', col, row => row[EVENT] === 'portal' ? palette.ivory : null)); }
    }
    (geo.posts || []).forEach(([x, y, r], i) => disc(x, y, r, .4, .2, lamp('post', paintOf(geo, 'posts', i, '#f2ecdd'), (row) => row[STATS]?.post > 0 ? palette.gold : null)));
    const hits = hitTracker(), plungeAt = plungerSpring(), slingBars = [], bumperParts = [], bumperRings = [];
    const flashRing = (x, y, r, color) => {            // a flat ring that expands and fades: shock rings for bumpers, pulses for kickers
      const ring = new T.Mesh(new T.TorusGeometry(r, .035, 6, 36), new T.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }));
      ring.position.set(x, .4, y);
      ring.rotation.x = Math.PI / 2;
      ring.visible = false;
      scene.add(ring);
      return ring;
    };
    geo.slings.forEach((r, i) => {
      rail(r, .4, .2, .17, rubberDark);
      const colour = lamp('sling' + i, paintOf(geo, 'slings', i, palette.red)), pose = slingPose(r, 1, true, geo.width);
      const piece = Math.hypot(r[2] - r[0], r[3] - r[1]) / SLING_PIECES;
      const band = pose.points.slice(1).map((b, k) => rail([...pose.points[k], ...b], .17, .2, .36, colour));
      for (const [px, py] of [[r[0], r[1]], [r[2], r[3]]]) { disc(px, py, .15, .46, .25, rubberDark); disc(px, py, .075, .1, .52, chrome); }
      const arm = disc((r[0] + r[2]) / 2 - pose.nx * .13, (r[1] + r[3]) / 2 - pose.ny * .13, .11, .24, .3, chrome);
      slingBars.push({ r, band, piece, arm });
    });
    geo.targets.forEach((r, i) =>
      rail(r, .26, .58, .3, lamp('target' + i, paintOf(geo, 'targets', i, palette.red), row => row[BANK] & (1 << i) ? '#38325c' : lastTarget(row, i) && Math.floor(performance.now() / 220) % 2 ? palette.gold : paintOf(geo, 'targets', i, palette.red))));
    geo.bumps.forEach(([x, y, radius], i) => {
      const parts = [
        disc(x, y, radius - .05, .31, .18, chrome),
        disc(x, y, radius, .14, .33, rubberRed),
        disc(x, y, radius - .09, .13, .46, lamp('bumper' + i, paintOf(geo, 'bumps', i, bumperColors[i]),
          (row) => !row[TILT] && (jackpotLit(row) || row[STATS]?.streak >= 2) && Math.floor(performance.now() / 180) % geo.bumps.length === i ? palette.gold : null)),
        disc(x, y, radius - .25, .09, .55, dark),
        disc(x, y, .18, .03, .61, brass),
      ];
      parts.forEach((part) => { part.userData.y0 = part.position.y; });
      bumperParts.push(parts);
      bumperRings.push([flashRing(x, y, radius + .1, '#fff3a8'), flashRing(x, y, radius + .1, '#ffffff')]);
    });
    const kickerRings = [...(geo.holes || []).map(([x, y, r]) => [x, y, r]), ...(geo.saucer ? [geo.saucer] : [])].map(([x, y, r]) => ({ x, y, r, grab: flashRing(x, y, r + .08, '#fff0ca'), out: flashRing(x, y, r + .08, '#ffd383') }));
    geo.lanes.forEach(([x, y], i) => {
      disc(x, y, .29, .075, .05, brass);
      disc(x, y, .21, .04, .1, lamp('lane' + i, paintOf(geo, 'lanes', i, palette.teal), (row) => row[STAGED] && row[STATS]?.skill_lane === i ? palette.gold : null));
    });
    const track = geo.ramp ? rampPoints(geo) : [];
    const rampRail = lamp('ramp', paintOf(geo, 'ramp', undefined, palette.steel), row => rampLit(row) ? rampColor(row) : paintOf(geo, 'ramp', undefined, palette.steel));
    rampRail.metalness = chrome.metalness;
    rampRail.roughness = chrome.roughness;
    for (const offset of geo.ramp ? [-.24, .24] : []) {
      const points = track.map(([x, y, z]) => new T.Vector3(x + offset, z + .07, y));
      const tube = new T.TubeGeometry(new T.CatmullRomCurve3(points), 32, .045, 6, false);
      mesh(tube, rampRail, 0, 0, 0);
    }
    if (geo.ramp) disc(...geo.ramp, .26, .06, .04, lamp('ramp', '#38325c', row => rampLit(row) ? rampColor(row) : '#38325c'));
    if (geo.saucer) {
      const [ux, uy, ur] = geo.saucer;
      disc(ux, uy, ur + .07, .05, .03, brass);
      disc(ux, uy, ur, .06, .06, material('#0c0a1c', .6, .2));
    }
    if (geo.subway) {
      const [wx, wy, wr] = geo.subway;
      disc(wx, wy, wr + .07, .05, .03, geo.paint?.subway ? material(geo.paint.subway, .4, .3) : brass);
      disc(wx, wy, wr, .06, .06, material('#0c0a1c', .6, .2));
    }
    const [sx, sy] = geo.spinner || [0, 0];
    if (geo.spinner) {
      disc(sx, sy, .2, .04, .08, material('#c1d2e5', .2, .3));
      for (const dx of [-.57, .57]) disc(sx + dx, sy, .094, .57, .28, brass);
    }
    const spinner = geo.spinner ? box(.91, .085, .3, lamp('spinner', paintOf(geo, 'spinner', undefined, palette.steel)), sx, sy, .35) : null;

    const paddles = geo.flips.map(([x, y], i) => {
      // a rubber-sleeved flipper: fat at the pivot (.26), tapering to the tip (.15, the collision radius)
      const paddle = rubber(flipperColors[i % 2]);
      const pivot = new T.Group();
      scene.add(pivot);
      pivot.position.set(x, .15, y);
      const taper = new T.CylinderGeometry(.15, .26, geo.length, lighting.low ? 14 : 28, 1);
      taper.rotateZ(-Math.PI / 2);
      taper.translate(geo.length / 2, 0, 0);
      taper.scale(1, .66, 1);
      const body = new T.Mesh(taper, paddle);
      const cap = (r, px) => {
        const m = new T.Mesh(new T.SphereGeometry(r, lighting.low ? 10 : 20, lighting.low ? 8 : 14), paddle);
        m.position.set(px, 0, 0);
        m.scale.y = .66;
        return m;
      };
      for (const m of [body, cap(.26, 0), cap(.15, geo.length)]) {
        m.castShadow = m.receiveShadow = !lighting.low;
        pivot.add(m);
      }
      pivot.add(disc(0, 0, .17, .12, .2, brass));   // the brass pivot screw on the thick end
      return pivot;
    });
    const sphere = mesh(new T.SphereGeometry(geo.radius, lighting.low ? 20 : 32, lighting.low ? 14 : 22), ballSteel, 0, 0, 0);
    const extraBalls = [];
    const still = calm();
    const size = sizeOf(stage);
    const sweepState = {};
    // a fast ball glows on the table beneath it; a ball save wraps it in a teal bubble
    const halo = new T.Mesh(new T.CircleGeometry(geo.radius * 3.2, 28),
      new T.MeshBasicMaterial({ color: '#ffd382', transparent: true, opacity: 0, depthWrite: false }));
    halo.rotation.x = -Math.PI / 2;
    scene.add(halo);
    const bubble = new T.Mesh(new T.SphereGeometry(geo.radius * 1.9, 20, 12),
      new T.MeshBasicMaterial({ color: '#5ee6c8', transparent: true, opacity: .2, depthWrite: false }));
    bubble.visible = false;
    scene.add(bubble);
    const dots = Array.from({ length: 8 }, () => {
      const m = material(palette.ivory);
      m.transparent = true;
      const dot = mesh(new T.SphereGeometry(geo.radius * .7, 8, 6), m, 0, 0, 0);
      dot.castShadow = false;
      dot.visible = false;
      return dot;
    });
    // the plunger: a brass head on a rod, over a coil spring that squeezes when the plunger is pulled back
    const plunger = disc(geo.launch[0], geo.launch[1] + .4, .22, .16, .16, brass);
    box(.09, 1.1, .09, chrome, geo.launch[0], 16.75, .14);
    const springRings = Array.from({ length: 10 }, () => {
      const ring = new T.Mesh(new T.TorusGeometry(.17, .028, 6, 16), chrome);
      ring.position.set(geo.launch[0], .15, 0);
      scene.add(ring);
      return ring;
    });
    const canvas = renderer.domElement;
    canvas.className = 'pb-three';
    stage.prepend(canvas);
    let width = 0, height = 0;
    return {
      draw(row, ball, flash, trail = [], gate = 0, others = [], idle = false) {
        if (!size.w || !size.h) return;
        if (width !== size.w || height !== size.h) {
          width = size.w;
          height = size.h;
          renderer.setSize(width, height, false);
          const halfHeight = Math.max(9.35, 5.5 * height / width);
          camera.top = halfHeight;
          camera.bottom = -halfHeight;
          camera.left = -halfHeight * width / height;
          camera.right = -camera.left;
          camera.updateProjectionMatrix();
        }
        dots.forEach((dot, i) => {
          dot.material.color.set(TRAIL_HEX[Math.min(row[MULT], 5) - 1] || TRAIL_HEX[0]);
          const point = trail[i - (dots.length - trail.length)];
          dot.visible = !!point && row[BALLS] > 0;
          if (point) {
            dot.position.set(point[0], geo.radius, Math.min(17.25, point[1]));
            dot.scale.setScalar(.35 + .55 * (i + 1) / dots.length);
            dot.material.opacity = .08 + .25 * (i + 1) / dots.length;
          }
        });
        const tNow = performance.now();
        hits.note(row, tNow);
        geo.bumps.forEach((_, i) => {
          // a hit: the whole bumper pops up and rings back to rest while two shock rings expand across the felt
          const age = hits.age('bumper' + i, tNow, 600), spring = still ? 1 : 1 + .22 * Math.exp(-5 * age) * Math.cos(age * 15);
          bumperParts[i].forEach((part) => { part.scale.set(spring, 1, spring); part.position.y = part.userData.y0 + Math.max(0, spring - 1) * .9; });
          bumperRings[i].forEach((ring, k) => {
            const a = Math.min(1, Math.max(0, age - k * .22) / (1 - k * .22));
            ring.visible = !still && age < 1 && a > 0 && a < 1;
            if (ring.visible) { ring.scale.setScalar(1 + a * (k ? 1.4 : 1.9)); ring.material.opacity = .85 * (1 - a); }
          });
        });
        slingBars.forEach(({ r, band, piece, arm }, i) => {
          const { points, nx, ny, bow } = slingPose(r, hits.age('sling' + i, tNow, SLING_MS), still, geo.width);
          band.forEach((part, k) => {
            const [ax, ay] = points[k], [bx, by] = points[k + 1];
            part.position.x = (ax + bx) / 2; part.position.z = (ay + by) / 2;
            part.rotation.y = -Math.atan2(by - ay, bx - ax);
            part.scale.x = Math.hypot(bx - ax, by - ay) / piece * 1.08;        // a little overlap hides the joints
          });
          arm.position.x = (r[0] + r[2]) / 2 + nx * (bow - .13); arm.position.z = (r[1] + r[3]) / 2 + ny * (bow - .13);
        });
        const grabAge = Math.min(hits.age('hole', tNow, 520), hits.age('saucer', tNow, 520)), ejectAge = hits.age('eject', tNow, 520);
        const near = kickerRings.reduce((best, k, n) => (Math.hypot(k.x - ball[0], k.y - ball[1]) < Math.hypot(kickerRings[best].x - ball[0], kickerRings[best].y - ball[1]) ? n : best), 0);
        kickerRings.forEach((k, n) => {
          const mine = n === near, g = mine && !still && grabAge < 1, e = mine && !still && ejectAge < 1;
          k.grab.visible = g; k.out.visible = e;
          if (g) { k.grab.scale.setScalar(1 + 2.2 * (1 - grabAge)); k.grab.material.opacity = .8 * (1 - grabAge); }      // closes in on the hole
          if (e) { k.out.scale.setScalar(1 + 3 * ejectAge); k.out.material.opacity = .9 * (1 - ejectAge); }             // bursts out
        });
        if (lampMeshes.length) lamps.update(performance.now(), lampEnv(row, ball, others, flash)).forEach((l, i) => { lampMeshes[i].material.color.set(l.color); lampMeshes[i].material.opacity = l.alpha; });
        if (gateFlap) gateFlap.rotation.y = -(Math.PI / 2 - 1.25 * gate);
        while (extraBalls.length < others.length) extraBalls.push(mesh(new T.SphereGeometry(geo.radius, 20, 14), ballSteel, 0, 0, 0));
        extraBalls.forEach((m, i) => {
          m.visible = i < others.length;
          if (m.visible) m.position.set(others[i][0], geo.radius + others[i][2], Math.min(17.25, others[i][1]));
        });
        {
          const last = trail[trail.length - 1];
          const speed = last ? Math.hypot(ball[0] - last[0], ball[1] - last[1]) : 0;
          halo.visible = row[BALLS] > 0 && speed > .12 && !still;
          halo.material.opacity = Math.min(.4, speed * .8);
          halo.scale.setScalar(.6 + Math.min(speed, .6) * 1.6);
          halo.position.set(ball[0], .03, Math.min(17.25, ball[1]));
          bubble.visible = row[BALLS] > 0 && row[SAVE] > 0 && !row[STAGED];
          bubble.position.set(ball[0], geo.radius + ball[2], Math.min(17.25, ball[1]));
        }
        sphere.visible = row[BALLS] > 0 && ball[2] > -.5;
        sphere.position.set(ball[0], geo.radius + ball[2], Math.min(17.25, ball[1]));
        moverMeshes.forEach((m, i) => { const p = row[STATS]?.movers?.[i]; if (p) m.position.set(p[0], .3, p[1]); });
        paddles.forEach((paddle, i) => { paddle.rotation.y = -(i < 2 ? ball[3 + i] : row[STATS]?.flips2?.[i - 2] ?? geo.flips[i][2]); });
        plunger.position.z = geo.launch[1] + .4 + .33 * plungeAt(row[CHARGE] / 240, tNow, still);
        springRings.forEach((ring, i) => { ring.position.z = plunger.position.z + .14 + (17.1 - plunger.position.z - .14) * (i + .5) / springRings.length; });
        if (spinner) spinner.rotation.x = row[SPIN] * 2 * Math.PI;
        const pulse = .58 + .32 * Math.sin(performance.now() / 190);
        const sweep = laneSweep(sweepState, flash, geo.lanes.length);
        for (const { m, tag, normal, active, color } of lights) {
          const hit = tag.startsWith('flash') && !row[TILT] && FLASH_EVENTS.has(flash) || flash === tag || flash === 'jackpot' && tag === 'ramp' || flash === 'skill' && tag.startsWith('lane') ||
            flash === 'mult' && tag === 'lane' + sweep;
          const lit = active?.(row);
          const glow = hit ? color : rampLit(row) && tag === 'ramp' ? rampColor(row) : tag.startsWith('ins_') && lit ? lit : tag.startsWith('flash') ? flasherColor(row, '') : null;
          m.color.set(hit ? palette.ivory : lit || normal);
          m.emissive.set(glow || '#000000');
          m.emissiveIntensity = hit ? 1.8 + pulse : glow ? pulse : 0;
        }
        // idle redraws are deliberate, slow ones: renderStill keeps them out of the adaptive-resolution timing
        if (idle) renderer.renderStill(scene, camera); else renderer.render(scene, camera);
      },
      dispose() {
        lighting.key.shadow.map?.dispose();
        lighting.dispose();
        texture.dispose();
        lampMeshes.forEach((m) => m.material.map.dispose());
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
        <div class="pb-stage" aria-label="Golden Hour pinball playfield">
          <span class="pb-pull" hidden>Pull ↓</span>
          <span class="pb-popup" aria-hidden="true" hidden></span>
          <div class="pb-inserts" aria-hidden="true">
            <span class="pb-save">Ball save</span>
            <span class="pb-mult" hidden></span>
            <span class="pb-shot"></span>
            <span class="pb-jackpot" hidden></span>
          </div>
        </div>
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
        <button type="button" class="pb-gear" aria-label="Options" aria-expanded="false" title="Options">⚙</button>
        <div class="pb-opts" role="group" aria-label="Display and control options" hidden>
          <button type="button" data-opt="lefty" aria-pressed="false" title="Put Launch on the left">↔ Left-handed</button>
          <button type="button" data-opt="contrast" aria-pressed="false" title="Stronger contrast and saturation">◐ Contrast</button>
          <button type="button" data-opt="cb" aria-pressed="false" title="Colour-blind safe palette (applies from the next game)">🎨 Colour-safe</button>
          <button type="button" class="pb-edit" hidden title="Back to the table editor">🛠️ Edit this table</button>
        </div>
        <ol class="pb-standings" aria-label="Scores" hidden></ol>
        <div class="pb-run" hidden><span class="pb-caption">Run highlights</span><p></p></div>
        <div class="pb-top" hidden><span class="pb-caption">Top scores</span><ol></ol></div>
      </section>`;
    const root = arena.querySelector('.pb-cabinet');
    // display / control options, remembered on this device
    const optKey = 'pinball.opts';
    let opts = {};
    try { opts = JSON.parse(localStorage.getItem(optKey)) || {}; } catch {}
    const applyOpts = () => {
      root.classList.toggle('pb-lefty', !!opts.lefty);
      root.classList.toggle('pb-contrast', !!opts.contrast);
      for (const b of root.querySelectorAll('button[data-opt]')) b.setAttribute('aria-pressed', String(!!opts[b.dataset.opt]));
    };
    for (const b of root.querySelectorAll('button[data-opt]')) {
      b.addEventListener('click', () => {
        opts[b.dataset.opt] = !opts[b.dataset.opt];
        try { localStorage.setItem(optKey, JSON.stringify(opts)); } catch {}
        applyOpts();
      });
    }
    const gear = root.querySelector('.pb-gear'), panel = root.querySelector('.pb-opts');
    const editBtn = root.querySelector('.pb-edit');
    editBtn.addEventListener('click', () => { location.href = '/pinball-editor.html'; });
    gear.addEventListener('click', () => {
      editBtn.hidden = !(window.gnEditor && game?.geo?.theme === 'custom');       // only on an editor table, and only where the editor is switched on
      panel.hidden = !panel.hidden;
      gear.setAttribute('aria-expanded', String(!panel.hidden));
    });
    applyOpts();
    if (opts.cb) {   // colour-blind safe: blue / amber / white instead of cyan / pink / violet / teal
      flipperColors.splice(0, 2, '#4aa8ff', '#ffb000');
      bumperColors.splice(0, 4, '#ffb000', '#4aa8ff', '#ffffff', '#ffd9a0');
    } else {
      flipperColors.splice(0, 2, '#42cfeb', '#ff78bc');
      bumperColors.splice(0, 4, '#ff9b59', '#c699ff', '#58e5d5', '#ff78bc');
    }
    const found = new Map();
    const find = (s) => found.get(s) || (found.set(s, root.querySelector('.pb-' + s)), found.get(s));
    const stage = find('stage');
    const listeners = new AbortController();
    const g = game = { root, stage, find, listeners, trail: [], sources: new Map(), pulls: new Map(), held: 0, tick: -1, flashAt: 0 };
    const on = (target, event, handler) => target.addEventListener(event, handler, { signal: listeners.signal });
    const setHeld = () => {
      const previous = g.held;
      g.held = [...g.sources.values()].reduce((mask, value) => mask | value, 0);
      if (previous !== g.held) {
        // a flipper's solenoid clack on press (bits 1 and 2), a softer one on release
        const flip = (g.held ^ previous) & 3;
        if (flip && g.enabled && !g.ctx.readOnly) g.ctx.sfx((g.held & flip) ? 'pflip' : 'pflipup');
        if (flip & g.held) navigator.vibrate?.(6);
        send(g, {}, true);
      }
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
    // Gamepads: triggers, bumpers and the d-pad flip; A launches; X / Y / B nudge left / up / right.
    const PAD = [[[4, 6, 14], 1], [[5, 7, 15], 2], [[0], 4], [[2], -1], [[3], -2], [[1], -3]];
    const padDown = new Set();
    g.pollPad = () => {
      const pad = [...(navigator.getGamepads?.() || [])].find(Boolean);
      if (!pad) {
        if (padDown.size) {
          if (g.sources.has('pad:4')) clearControls(g, true);
          else padDown.forEach((key) => release('pad:' + key));
          padDown.clear();
        }
        return;
      }
      PAD.forEach(([buttons, control]) => {
        const down = buttons.some((i) => pad.buttons[i]?.pressed) ||
          (control === 1 && pad.axes[0] < -.6) || (control === 2 && pad.axes[0] > .6);
        const key = String(control);
        if (down && !padDown.has(key)) { padDown.add(key); press('pad:' + key, control); }
        else if (!down && padDown.has(key)) { padDown.delete(key); release('pad:' + key); }
      });
    };
    const source = (e) => 'pointer' + e.pointerId;
    const bindPointer = (element, start) => {
      on(element, 'pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('button') && element === stage) return;
        e.preventDefault();
        element.setPointerCapture(e.pointerId);
        start(e, source(e));
      });
      on(element, 'pointerup', (e) => {
        g.pulls.delete(source(e));
        release(source(e));
      });
      on(element, 'pointercancel', () => clearControls(g, true));
      on(element, 'lostpointercapture', (e) => {
        if (g.sources.has(source(e))) clearControls(g, true);
      });
    };
    bindPointer(stage, (e, key) => {
      const rect = stage.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      press(key, x < .5 ? 1 : 2);
      const y = (e.clientY - rect.top) / rect.height;
      if (g.sources.has(key) && g.row[STAGED] && x >= .82 && x <= .95 && y >= .78 && y <= .95) {
        g.pulls.set(key, e.clientY);
        g.find('pull').hidden = false;
      }
    });
    on(stage, 'pointermove', (e) => {
      const key = source(e);
      const startY = g.pulls.get(key);
      if (startY === undefined || e.clientY - startY < 10) return;
      g.pulls.delete(key);
      if (!g.enabled || !g.row[STAGED]) return;
      g.sources.set(key, 4);
      setHeld();
    });
    for (const button of root.querySelectorAll('button[data-control]')) {
      const control = Number(button.dataset.control);
      bindPointer(button, (_e, key) => press(key, control));
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
    g.pulls.clear();
    g.held = 0;
    if (notify && held) send(g, { reset: true }, true);
    paintControls(g);
  }

  function paintControls(g) {
    if (!g.row) return;
    g.find('pull').hidden = !g.enabled || !g.row[STAGED] || !!(g.held & 4);
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
    const scoreEl = find('score');
    if (g.lastScore !== undefined && row[SCORE] - g.lastScore >= 1000 && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      scoreEl.classList.remove('jump');
      void scoreEl.offsetWidth;
      scoreEl.classList.add('jump');
    }
    g.lastScore = row[SCORE];
    g.scoreTarget = row[SCORE];
    if (g.scoreShown === undefined || g.scoreShown > row[SCORE]) g.scoreShown = row[SCORE];
    setText(find('score'), Math.round(g.scoreShown).toLocaleString());
    setText(find('balls'), g.mode === 'practice' || g.mode === 'timeattack' ? '∞' : row[BALLS]);
    find('nudges').classList.toggle('warn', !row[TILT] && row[NUDGES] >= 2);
    const nextExtra = (g.extra || []).find((v) => v > row[SCORE]);
    const timer = g.mode === 'timeattack' ? ` · ⏱ ${clockText(row[STATS]?.clock ?? 0)}` : '';
    setText(find('nudges'), row[TILT] ? 'Tilted' : g.mode === 'zen' ? 'Zen · no tilt' : g.mode === 'practice' ? 'Practice · not scored' :
      `Nudges ${3 - row[NUDGES]}${nextExtra ? ` · Extra ball ${nextExtra.toLocaleString()}` : ''}${timer}`);
    setText(find('ramp'), row[OTHERS]?.length ? `MULTIBALL ×${row[OTHERS].length + 1}` : row[JACKPOT] ? 'Jackpot lit' : rampLit(row) ? 'Ramp ready' : `Targets ${targetsDown(row)}/${targetCount(row)}${row[LOCKED] ? ` · ${row[LOCKED]} locked` : ''}`);
    find('ramp').classList.toggle('lit', !!rampLit(row));
    g.stage.classList.toggle('tilted', !!row[TILT]);
    g.stage.classList.toggle('saving', row[SAVE] > 0 && !row[STAGED]);
    find('save').classList.toggle('lit', row[SAVE] > 0);
    find('save').classList.toggle('urgent', row[SAVE] === 1);   // the last second blinks, like the real ball-save lamp
    setText(find('save'), row[SAVE] > 0 ? `Ball save ${row[SAVE]}s` : 'Ball save');
    const lanes = '●'.repeat([0, 1, 2].filter(i => row[LANES] >> i & 1).length).padEnd(3, '○');
    find('mult').hidden = !(row[MULT] > 1 || row[LANES] || row[HOLD] || !row[STAGED] && row[BONUS]);
    setText(find('mult'), `${row[MULT]}× ${lanes}${!row[STAGED] && row[BONUS] ? ` · Bonus ${row[BONUS].toLocaleString()}` : ''}${row[HOLD] ? ' · Hold' : ''}`);
    const shot = ['Lane', 'Targets', 'Spinner', 'Ramp'][row[LIT]];
    const mission = row[STATS]?.mission;
    setText(find('shot'), `${row[COMBO] > 1 ? `Combo ${row[COMBO]} · ` : ''}2× ${shot}${row[KICK] ? ' · Kickback' : ''}${mission ? ` · ${mission[0]} ${mission[1]}/${mission[2]} · ${mission[3]}s` : ''}`);
    find('jackpot').hidden = !jackpotLit(row) && !(row[HURRY] && !row[TILT]);
    setText(find('jackpot'), row[HURRY] ? `Spinner hurry-up · ${row[HURRY]}s` :
      row[OTHERS]?.length ? 'Multiball · Jackpot lit' : row[JACKPOT] ? `Jackpot · ${row[JACKPOT]}s` : '');
    const [skillStart, skillEnd] = g.skill;
    const inBand = !!row[STAGED] && row[CHARGE] >= skillStart && row[CHARGE] <= skillEnd;
    const skillLane = ['left', 'middle', 'right'][row[STATS]?.skill_lane] || 'lit';
    const launchCue = inBand ? `Release for skill shot · ${skillLane} lane pays most` : row[CHARGE] > skillEnd ? 'Release to launch' :
      row[CHARGE] ? 'Charge into the gold band' : 'Pull the plunger shaft down or hold Launch';
    const feedback = performance.now() < g.flashAt ? label(row[EVENT], row) : '';
    setText(find('message'), g.record ? 'New personal best' : row[TILT] ? messages.tilt :
      row[STAGED] && row[CHARGE] ? launchCue : feedback || (row[STAGED] ? launchCue : row[BALLS] ? '' : 'Run complete'));
    find('charge-fill').style.width = `${100 * row[CHARGE] / 240}%`;
    const meter = find('charge');
    meter.setAttribute('aria-valuenow', row[CHARGE]);
    meter.classList.toggle('ready', !!row[STAGED]);
    meter.classList.toggle('in-band', inBand);
    const meterText = inBand ? 'Skill shot window' : `${Math.round(100 * row[CHARGE] / 240)}% power`;
    if (meter.getAttribute('aria-valuetext') !== meterText) meter.setAttribute('aria-valuetext', meterText);
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
    const run = find('run');
    run.hidden = !g.over || !g.me || !row[STATS];
    if (!run.hidden) {
      const st = row[STATS], plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
      const bits = [st.jackpot && plural(st.jackpot, 'jackpot'), st.multiball && plural(st.multiball, 'multiball'),
        st.hurry && plural(st.hurry, 'hurry-up'), st.mystery && plural(st.mystery, 'mystery prize'),
        st.extra && plural(st.extra, 'extra ball'), st.combo >= 2 && `best combo ×${st.combo}`].filter(Boolean);
      setText(run.querySelector('p'), bits.length ? bits.join(' · ') : 'No jackpots this time - light the ramp next run!');
    }
    const top = find('top');
    top.hidden = !g.solo || !g.over || !g.topScores?.length;
    if (!top.hidden) {
      const items = g.topScores.map(value => value.toLocaleString());
      if (JSON.stringify(items) !== g.topKey) {
        g.topKey = JSON.stringify(items);
        top.querySelector('ol').replaceChildren(...items.map((text) => {
          const item = document.createElement('li');
          item.textContent = text;
          return item;
        }));
      }
    }
    paintControls(g);
  }

  const popupText = (row) => {
    const text = label(row[EVENT], row);
    if (row[EVENT]?.startsWith('mystery_')) return text.replace('Mystery · ', '? ');
    if (row[EVENT] === 'extra') return '★ EXTRA BALL ★';
    if (row[EVENT] === 'frenzy') return `FRENZY! ${/\+[\d,]+/.exec(text)?.[0] || ''}`;
    if (row[EVENT] === 'mission') return `MISSION ✓ ${/\+[\d,]+/.exec(text)?.[0] || ''}`;
    const points = /\+[\d,]+/.exec(text)?.[0] || '';
    return row[COMBO] >= 5 && points ? `COMBO ×${row[COMBO]}! ${points}` : points;
  };

  function popup(g, row) {
    const el = g.find('popup'), text = popupText(row);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (text && g.me === g.viewer && !reduce) {
      el.textContent = text;
      // the end-of-ball bonus is tallied up from zero instead of appearing at once
      clearInterval(g.tally);
      if (row[EVENT] === 'bonus' && row[BONUS] > 0) {
        const total = row[BONUS], t0 = performance.now();
        g.tally = setInterval(() => {
          const k = Math.min(1, (performance.now() - t0) / 700);
          el.textContent = `Ball bonus +${Math.round(total * (1 - (1 - k) ** 2)).toLocaleString()}`;
          if (k >= 1) clearInterval(g.tally);
        }, 40);
      }
      el.hidden = false;
      el.style.left = `${100 * (g.ball?.[0] ?? row[X]) / 10}%`;
      el.style.top = `${100 * ((g.ball?.[1] ?? row[Y]) + .85) / 18.7}%`;
      el.classList.toggle('big', ['ramp', 'jackpot', 'super', 'hurry', 'bonus', 'skill', 'multiball', 'wizard', 'mission', 'frenzy'].includes(row[EVENT]));
      el.classList.toggle('huge', row[EVENT] === 'extra' || row[EVENT] === 'wizard');
      el.classList.remove('go');
      void el.offsetWidth;
      el.classList.add('go');
    }
    // table shake scales with the moment: a nudge is a shove, a jackpot or multiball a slam
    const shove = { nudge: 3, danger: 4, tilt: 4, jackpot: 5, super: 8, multiball: 7, extra: 6, wizard: 9 }[row[EVENT]];
    if (shove && !reduce) {
      g.stage.style.setProperty('--shake', `${shove}px`);
      g.stage.classList.remove('shake');
      void g.stage.offsetWidth;
      g.stage.classList.add('shake');
    }
    g.stage.classList.toggle('white', ['extra', 'super', 'wizard'].includes(row[EVENT]));
    // a jackpot, super, multiball or extra ball throws a ring of sparks from the ball; the table pulse takes the event's colour
    const sparks = { jackpot: 14, super: 28, multiball: 22, extra: 22, hurry: 14, wizard: 40, frenzy: 18 }[row[EVENT]];
    g.stage.dataset.pulse = row[EVENT];
    if (sparks && !reduce && g.me === g.viewer) {
      const cx = 100 * (g.ball?.[0] ?? row[X]) / 10, cy = 100 * (g.ball?.[1] ?? row[Y]) / 18.7;
      for (let i = 0; i < sparks; i++) {
        const spark = document.createElement('span');
        const angle = (i / sparks) * Math.PI * 2 + Math.random() * .4, reach = 40 + Math.random() * 60;
        spark.className = 'pb-spark';
        spark.style.cssText = `left:${cx}%;top:${cy}%;--dx:${Math.cos(angle) * reach}px;--dy:${Math.sin(angle) * reach}px`;
        spark.addEventListener('animationend', () => spark.remove());
        g.stage.appendChild(spark);
      }
    }
    if (['ramp', 'jackpot', 'super', 'kickback', 'bonus', 'extra', 'lock', 'multiball', 'wizard', 'drain', 'done'].includes(row[EVENT]) && !reduce) {
      g.stage.classList.remove('thump');
      void g.stage.offsetWidth;
      g.stage.classList.add('thump');
    }
    if (g.me === g.viewer) {
      if (/^(bumper|sling)/.test(row[EVENT])) navigator.vibrate?.(12);
      else if (['jackpot', 'super', 'extra'].includes(row[EVENT])) navigator.vibrate?.([30, 40, 30, 40, 60]);
      else if (['ramp', 'kickback'].includes(row[EVENT])) navigator.vibrate?.(30);
    }
  }

  // Looping beds that follow the table: a low rumble that rises with the ball's speed, and a whirring spinner.
  function ambience(g, row, prior, viewer) {
    const Snd = window.Snd;
    if (!Snd || viewer !== g.me || g.ctx.readOnly) return;
    const now = performance.now();
    const rolling = row[BALLS] && !row[STAGED] && !row[TILT] && !row[Z] ? Math.min(1, Math.hypot(row[VX], row[VY]) / 30) : 0;
    Snd.bed('pin-roll', (K, dst) => {
      const src = K.loopSrc('brown'), lp = K.ctx.createBiquadFilter(), gain = K.ctx.createGain();
      lp.type = 'lowpass'; lp.frequency.value = 220; gain.gain.value = 0;
      src.connect(lp).connect(gain).connect(dst);
      return {
        set(level) { const t = K.ctx.currentTime; gain.gain.setTargetAtTime(level * .5, t, .08); lp.frequency.setTargetAtTime(160 + level * 520, t, .08); },
        stop() { try { src.stop(); src.disconnect(); } catch {} },
      };
    }).set(rolling * rolling);
    // spin rate from how far the blade turned since the last packet
    if (prior) {
      const dt = Math.max(.016, (now - (g.spinSeen ?? now)) / 1000);
      const turned = ((row[SPIN] - prior[SPIN]) % 1 + 1) % 1;
      if (prior !== row) g.spinRate = turned < .001 ? (g.spinRate || 0) * .6 : Math.min(8, turned / dt);
    }
    g.spinSeen = now;
    const whirl = Math.min(1, (g.spinRate || 0) / 6);
    Snd.bed('pin-whir', (K, dst) => {
      const o = K.ctx.createOscillator(), gain = K.ctx.createGain();
      o.type = 'triangle'; o.frequency.value = 220; gain.gain.value = 0;
      o.connect(gain).connect(dst); o.start();
      return {
        set(level) { const t = K.ctx.currentTime; gain.gain.setTargetAtTime(level * .05, t, .05); o.frequency.setTargetAtTime(200 + level * 420, t, .05); },
        stop() { try { o.stop(); o.disconnect(); } catch {} },
      };
    }).set(whirl > .12 ? whirl : 0);
    // the magnet hums while it is energised
    Snd.bed('pin-hum', (K, dst) => {
      const o = K.ctx.createOscillator(), gain = K.ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = 60; gain.gain.value = 0;
      o.connect(gain).connect(dst); o.start();
      return {
        set(level) { gain.gain.setTargetAtTime(level * .035, K.ctx.currentTime, .1); },
        stop() { try { o.stop(); o.disconnect(); } catch {} },
      };
    }).set(row[STATS]?.magnet === 2 && !row[TILT] ? 1 : 0);
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
    if (!prior || prior[BALLS] !== row[BALLS] || prior[STAGED] !== row[STAGED] || ['recovery', 'save'].includes(row[EVENT]) &&
        prior[EVENT_ID] !== row[EVENT_ID]) g.ball = null;
    if (prior && prior[BALLS] !== row[BALLS]) clearControls(g);
    // the final seconds of a jackpot or hurry-up window tick down
    if (prior && viewer === g.me && !g.ctx.readOnly && !row[STAGED]) {
      const ending = (now, before) => now > 0 && now <= 3 && before > now;
      if (!row[TILT] && ((!row[OTHERS]?.length && ending(row[JACKPOT], prior[JACKPOT])) ||
          ending(row[HURRY], prior[HURRY]))) g.ctx.sfx('ptick');
    }
    if (prior && viewer === g.me && !g.ctx.readOnly && prior[BANK] && prior[BANK] === (1 << targetCount(prior)) - 1 && row[BANK] === 0) g.ctx.sfx('pbank');
    // the last nudge before tilt: a warning buzz for the player
    if (prior && viewer === g.me && !g.ctx.readOnly && row[NUDGES] === 3 && prior[NUDGES] < 3) g.ctx.sfx('alarm');
    if (prior && prior[EVENT_ID] !== row[EVENT_ID]) {
      g.flashAt = performance.now() + 780;
      g.glass?.react(row[EVENT]);
      popup(g, row);
      if (viewer === g.me && !g.ctx.readOnly) g.ctx.sfx(sound(row[EVENT]), soundArg(row[EVENT], row));
    }
    // the plunger lets go: a spring thwack as the ball shoots up the lane
    if (prior && prior[STAGED] && !row[STAGED] && prior[BALLS] === row[BALLS] && viewer === g.me && !g.ctx.readOnly) g.ctx.sfx('plaunch');
    g.enabled = !!(g.active && g.me && row[BALLS]);
    if (!g.enabled || row[TILT] && !prior?.[TILT]) clearControls(g);
    g.row = row;
    if (prior !== row) g.receivedAt = performance.now();
    ambience(g, row, prior, viewer);
    if (g.over && g.solo && g.me && !row[BALLS] && !g.topSaved && g.mode !== 'practice') {
      g.topSaved = true;
      const saved = load(topKey(g));
      const entries = (Array.isArray(saved) ? saved : [])
        .map(entry => Number.isSafeInteger(entry) ? { score: entry } : entry)
        .filter(entry => Number.isSafeInteger(entry?.score) && entry.run !== g.run);
      entries.push({ run: g.run, score: row[SCORE] });
      const top = entries.sort((a, b) => b.score - a.score).slice(0, 5);
      g.topScores = top.map(entry => entry.score);
      store(topKey(g), top);
    }
    if (g.over && g.solo && g.me && !row[BALLS] && g.mode !== 'practice' && (g.best === null || row[SCORE] > g.best)) {
      g.best = row[SCORE];
      g.record = true;
      store(bestKey(g), g.best);
    }
    updateHud(g, row);
  }

  function draw(g, now) {
    g.raf = requestAnimationFrame((next) => draw(g, next));
    g.pollPad?.();
    const row = g.row;
    if (!row || g.root.hidden || document.hidden) return;
    // Idle: ball parked in the plunger lane, no event animating, gate shut. Redraw at ~10 fps (lamp pulses only).
    const idle = row[STAGED] && now >= g.flashAt && !g.trail.length && (g.gate || 0) < .01 && g.ball &&
      Math.hypot(g.ball[0] - row[X], g.ball[1] - row[Y]) < .01;
    if (idle && g.drawnAt !== undefined && now - g.drawnAt < 100) return;
    // Predict at most one fast packet ahead; converge on each authoritative sample.
    const ahead = g.active && !row[STAGED] && !row[Z] ? Math.min(.034, Math.max(0, (now - g.receivedAt) / 1000)) : 0;
    const target = [row[X] + row[VX] * ahead, row[Y] + row[VY] * ahead, row[Z], row[LEFT], row[RIGHT]];
    const blend = 1 - Math.exp(-Math.min(60, now - (g.drawnAt ?? now)) / 25);
    g.ball = g.ball ? g.ball.map((value, i) => value + (target[i] - value) * blend) : target;
    g.drawnAt = now;
    // the score counts up to its new value instead of snapping
    if (g.scoreShown !== undefined && g.scoreShown < g.scoreTarget && calm()) g.scoreShown = g.scoreTarget;
    if (g.scoreShown !== undefined && g.scoreShown < g.scoreTarget) {
      g.scoreShown = Math.min(g.scoreTarget, g.scoreShown + Math.max(10, (g.scoreTarget - g.scoreShown) * .2));
      setText(g.find('score'), Math.round(g.scoreShown).toLocaleString());
    }
    const flash = now < g.flashAt ? row[EVENT] : '';
    const attract = g.geo && idle && !flash && !row[SCORE] && !row[CHARGE] && row[BALLS] > 0 && !calm();
    const shown = flash || (attract ? attractTag(g.geo, now) : '');
    if (!flash && g.flashing) updateHud(g, row);
    g.flashing = !!flash;
    const last = g.trail.at(-1);
    if (!row[BALLS] || row[STAGED] || last && Math.hypot(last[0] - g.ball[0], last[1] - g.ball[1]) > 2) g.trail.length = 0;
    if (!row[STAGED] && !(now < (g.trailAt ?? 0))) {
      g.trail.push([g.ball[0], g.ball[1]]);
      if (g.trail.length > 8) g.trail.shift();
      g.trailAt = now + 24;
    }
    // The gate flap swings open for a ball rising through the shooter lane, then drops shut.
    const rising = !row[STAGED] && g.ball[0] > 8.9 && g.ball[1] < 5;
    g.gate = (g.gate || 0) + ((rising ? 1 : 0) - (g.gate || 0)) * (1 - Math.exp(-Math.min(60, now - (g.gateAt ?? now)) / (rising ? 40 : 90)));
    g.gateAt = now;
    // the other multiball balls are extrapolated by their velocity from the last packet
    const others = (row[OTHERS] || []).filter((o) => o[4] > -.5).map(([x, y, vx, vy, z]) => [x + vx * ahead, y + vy * ahead, z]);
    // the backglass repaints at ~20 fps (10 on Low graphics) and only crawls under reduced motion
    if (g.glass && now - (g.glassAt ?? -1e9) > (window.gfxLevel?.() === 'low' ? 100 : 50)) { g.glassAt = now; g.glass.draw(now, row, calm()); }
    (g.three || g.flat)?.draw(row, g.ball, shown, g.trail, g.gate, others, !!idle);
  }

  function initRenderer(g, geo) {
    g.geo = geo;
    const art = PinballArt.make(geo);
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
        g.table = data.table || 'golden';
        g.mode = Object.values(data.tables)[0]?.[STATS]?.mode || 'classic';
        g.stage.setAttribute('aria-label', `${g.table === 'neon' ? 'Neon Arcade' : g.table === 'star' ? 'Star Cadet' : g.table === 'custom' ? 'Custom' : g.table?.startsWith('t_') ? 'Curated' : 'Golden Hour'} pinball playfield`);
        g.skill = data.layout.skill;
        g.extra = data.extra || [];
        const saved = load(bestKey(g));
        g.best = Number.isSafeInteger(saved) && saved >= 0 ? saved : null;
        const band = g.find('skill-band');
        band.style.left = `${100 * data.layout.skill[0] / 240}%`;
        band.style.width = `${100 * (data.layout.skill[1] - data.layout.skill[0] + 1) / 240}%`;
        initRenderer(g, data.layout);
        g.glass = glassArt(g.find('marquee'), g.table === 'neon');
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
      clearInterval(game.tally);
      window.Snd?.bed('pin-roll').set(0);
      window.Snd?.bed('pin-whir').set(0);
      game.three?.dispose();
      game.flat?.dispose();
      game.root.remove();
      game = null;
    },
  };
})();
