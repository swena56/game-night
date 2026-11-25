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
    mystery_points: 'Mystery · +10,000', mystery_save: 'Mystery · Ball save 10s', mystery_mult: 'Mystery · Multiplier up!', mystery_hold: 'Mystery · Bonus held', lock: 'Ball locked', multiball: 'MULTIBALL · Shoot the ramp for jackpots +5,000',
    drain: 'Ball drained', done: 'Run complete', recovery: 'Ball freed',
  };
  const sounds = { skill: 'pskill', ramp: 'pramp', jackpot: 'pjackpot', save: 'psave', tilt: 'wrong', nudge: 'thud', mult: 'cheer', kickback: 'pkick', extra: 'pjackpot', post: 'psave', hurry: 'pjackpot', super: 'pjackpot', mystery_points: 'cheer', mystery_save: 'psave', mystery_mult: 'cheer', mystery_hold: 'pskill', lock: 'psave', multiball: 'pjackpot', bonus: 'cheer', spinner: 'pspin', drain: 'groan', done: 'groan' };
  const prefixes = { bumper: 'Bumper +100', sling: 'Slingshot +50', lane: 'Rollover +500', target: 'Target +250' };
  const label = (event, row) => {
    if (event === 'bonus' && row) return `Ball bonus +${row[BONUS].toLocaleString()}`;
    const text = messages[event] || prefixes[event?.replace(/[0-9]$/, '')] || '';
    // levelled and multiplied awards: show what was actually paid
    return row?.[POINTS] > 0 && !event.startsWith('mystery_') ? text.replace(/\+[\d,]+/, `+${row[POINTS].toLocaleString()}`) : text;
  };
  const sound = (event) => sounds[event] || (/^bumper/.test(event) ? 'pbumper' : /^sling/.test(event) ? 'psling' :
    /^lane/.test(event) ? 'plane' : /^target/.test(event) ? 'ptarget' : 'pop');
  const soundArg = (event) => (/^bumper/.test(event) ? Number(event.slice(6)) || 0 : /^lane/.test(event) ? Number(event.slice(4)) || 0 :
    /^target/.test(event) ? Number(event.slice(6)) || 0 : undefined);
  // each table keeps its own personal best and top-scores list
  // the ball's trail warms from ivory to hot orange as the bonus multiplier climbs (1x..5x)
  const TRAIL_TINT = ['255,240,202', '255,226,150', '255,200,110', '255,160,90', '255,110,90'];
  const TRAIL_HEX = ['#fff0ca', '#ffe296', '#ffc86e', '#ffa05a', '#ff6e5a'];
  const bestKey = (g) => g.table === 'neon' ? 'pinball.best.neon' : 'pinball.best';
  const topKey = (g) => g.table === 'neon' ? 'pinball.top.neon' : 'pinball.top';
  const palette = { gold: '#ffd383', ivory: '#fff0ca', teal: '#59edd2', red: '#ff6854', steel: '#c1d2e5' };
  const bumperColors = ['#ff9b59', '#c699ff', '#58e5d5', '#ff78bc'];
  const flipperColors = ['#42cfeb', '#ff78bc'];
  const guideColors = ['#a896ff', '#a896ff', '#ffcf76', '#ffcf76'];
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
    const sky = c.createLinearGradient(0, 0, 0, 17);
    sky.addColorStop(0, '#151940');
    sky.addColorStop(.37, '#47256a');
    sky.addColorStop(.64, '#963f68');
    sky.addColorStop(1, '#101936');
    c.fillStyle = sky;
    c.fillRect(0, 0, 10, 17);
    for (let i = 0; i < 145; i++) {
      c.fillStyle = i % 4 === 0 ? '#ffe0a5af' : '#f9ccff55';
      const size = i % 7 === 0 ? .039 : .021;
      c.fillRect(.22 + (i * 1.71828) % 8.5, .27 + (i * 2.41421) % 9.8, size, size);
    }
    const sun = c.createLinearGradient(0, 6, 0, 11);
    sun.addColorStop(0, '#fff0ba');
    sun.addColorStop(.48, '#ffab70');
    sun.addColorStop(1, '#e65e8c');
    c.save();
    c.beginPath();
    c.arc(4.64, 8.65, 2.55, 0, 2 * Math.PI);
    c.clip();
    c.fillStyle = sun;
    for (let i = 0; i < 15; i++) c.fillRect(2, 6.1 + i * .34, 5.3, .33 - i * .014);
    c.restore();
    const ridge = [[0, 9.8], [1.3, 8.9], [2.6, 9.8], [3.55, 9.25], [4.6, 10.4],
      [6.05, 9.6], [7.25, 8.65], [8.8, 9.65]];
    c.beginPath();
    ridge.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
    c.lineTo(8.8, 17);
    c.lineTo(0, 17);
    c.closePath();
    c.fillStyle = '#171937';
    c.fill();
    // Layered canyon silhouettes make the upper playfield read as a landscape.
    const peaks = [
      { points: [[0, 7.1], [.65, 6.4], [1.35, 7.15], [2.3, 6.3], [3.2, 7.05], [4.2, 6.55], [5.1, 7.2], [6.2, 6.45], [7.15, 7.05], [8.1, 6.2], [8.8, 6.9]], color: '#302653' },
      { points: [[0, 8.2], [.8, 7.6], [1.75, 8.25], [2.7, 7.45], [3.65, 8.3], [4.65, 7.7], [5.7, 8.35], [6.65, 7.55], [7.75, 8.15], [8.8, 7.45]], color: '#211f47' },
    ];
    peaks.forEach(({ points, color }) => {
      c.beginPath();
      points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
      c.lineTo(8.8, 10.1);
      c.lineTo(0, 10.1);
      c.closePath();
      c.fillStyle = color;
      c.fill();
    });
    c.save();
    c.clip();
    c.strokeStyle = '#c578bc53';
    c.lineWidth = .028;
    c.beginPath();
    for (let i = -8; i <= 8; i++) {
      c.moveTo(4.5, 9.2);
      c.lineTo(4.5 + i * 1.65, 17);
    }
    for (const y of [10.3, 10.7, 11.2, 11.85, 12.7, 13.8, 15.25, 17]) {
      c.moveTo(0, y);
      c.lineTo(8.8, y);
    }
    c.stroke();
    c.restore();
    c.fillStyle = '#161f3c';
    c.fillRect(8.83, 2.85, 1.17, 13.4);
    c.fillRect(0, 16.4, 8.8, .6);
    const fieldWash = c.createRadialGradient(5, 7.1, .3, 5, 7.1, 5.8);
    fieldWash.addColorStop(0, '#a995ff18');
    fieldWash.addColorStop(1, '#16224e00');
    c.fillStyle = fieldWash;
    c.fillRect(.25, 4.2, 8.35, 6.4);
    const inserts = c.createLinearGradient(0, 3.25, 0, 4.15);
    inserts.addColorStop(0, '#75dfff00');
    inserts.addColorStop(.5, '#75dfff25');
    inserts.addColorStop(1, '#75dfff00');
    c.fillStyle = inserts;
    c.fillRect(.35, 3.15, 8.1, 1.1);
    c.fillStyle = '#161f3c';
    c.fillRect(.35, 3.02, 8.1, .09);
    c.fillRect(.35, 4.28, 8.1, .09);
    c.save();
    c.translate(4.6, 11.45);
    c.scale(1.2, 1);
    c.fillStyle = '#282050';
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

    c.save();
    c.lineCap = 'round';
    c.setLineDash([.12, .14]);
    c.lineWidth = .035;
    c.strokeStyle = '#9ce9ff88';
    c.beginPath();
    c.moveTo(1.35, 4.32);
    c.bezierCurveTo(2.3, 3.82, 7.7, 3.82, 8.65, 4.32);
    c.stroke();
    for (const x of [3.25, 5.25]) {
      c.setLineDash([]);
      c.strokeStyle = '#d9dcffbb';
      c.lineWidth = .07;
      c.beginPath();
      c.moveTo(x, 2.95);
      c.lineTo(x, 4.15);
      c.stroke();
    }
    c.setLineDash([]);
    c.strokeStyle = '#ffd3837a';
    c.lineWidth = .045;
    const [targetX, targetY] = geo.targets[0];
    const targetEnd = geo.targets.at(-1)[3];
    c.strokeRect(targetX - .43, targetY - .25, .86, targetEnd - targetY + .5);
    for (const [x, y, radius] of geo.bumps) {
      c.beginPath();
      c.arc(x, y, radius + .18, 0, Math.PI * 2);
      c.strokeStyle = '#ffffff30';
      c.lineWidth = .035;
      c.stroke();
    }
    const [rx, ry] = geo.ramp;
    c.strokeStyle = '#59edd270';
    c.lineWidth = .04;
    c.beginPath();
    c.moveTo(rx - .5, ry + .6);
    c.lineTo(rx + .5, ry + .6);
    c.stroke();
    c.fillStyle = '#ffd383aa';
    c.beginPath();
    c.arc(5, 10.15, .07, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc(4.9, 15.8, .14, 0, Math.PI * 2);
    c.fill();
    c.restore();

    c.save();
    c.strokeStyle = '#c699ff52';
    c.lineWidth = .035;
    c.beginPath();
    c.moveTo(.55, 4.55);
    c.lineTo(.55, 9.5);
    c.quadraticCurveTo(.55, 10.1, 1.05, 10.45);
    c.moveTo(8.45, 4.55);
    c.lineTo(8.45, 9.5);
    c.quadraticCurveTo(8.45, 10.1, 7.95, 10.45);
    c.stroke();
    c.restore();

    c.fillStyle = palette.ivory;
    c.textAlign = 'center';
    c.scale(.01, .01);
    c.font = 'bold 25px sans-serif';
    c.fillText('S K I L L   S H O T', 425, 268);
    c.fillText('3× RAMP', geo.ramp[0] * 100, (geo.ramp[1] + .94) * 100);
    c.fillText('D R A I N', 500, 1681);
    c.fillStyle = palette.teal;
    c.font = 'bold 21px sans-serif';
    c.fillText('ROLLOVER LANES', 500, 231);
    c.fillText('TARGET BANK', targetX * 100, (targetEnd + .5) * 100);
    c.fillStyle = palette.gold;
    c.fillText('SPINNER', geo.spinner[0] * 100, (geo.spinner[1] + .42) * 100);
    c.fillText('BUMPERS', 487, 451);
    c.translate(940, 1100);
    c.rotate(-Math.PI / 2);
    c.fillText('L A U N C H', 0, 9);
    if (geo.theme === 'neon') {
      // restyle the sunset cabinet as a night arcade: a hue shift when the browser can filter canvases
      const tinted = document.createElement('canvas');
      tinted.width = canvas.width;
      tinted.height = canvas.height;
      const t = tinted.getContext('2d');
      if ('filter' in t) {
        t.filter = 'hue-rotate(-75deg) saturate(1.35) brightness(.92)';
        t.drawImage(canvas, 0, 0);
        return tinted;
      }
    }
    return canvas;
  }

  const jackpotLit = row => !row[TILT] && (row[JACKPOT] > 0 || row[OTHERS]?.length > 0);
  const rampLit = row => !row[TILT] && (row[BANK] === 7 || jackpotLit(row));
  const rampColor = row => jackpotLit(row) ? palette.gold : palette.teal;

  // players who ask for reduced motion get no speed halo, squash/stretch, ripples or score roll
  const calm = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

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
    const track = rampPoints(geo);
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
    // the ball stretches along its direction of travel and squashes across it, like a fast-moving sphere
    const drawBall = (x, y, scale = 1, dx = 0, dy = 0, speed = 0) => {
      const r = geo.radius * scale;
      if (still || speed < .12) return c.drawImage(sprites.ball, x - r, y - r, r * 2, r * 2);
      const k = Math.min(.22, (speed - .12) * .4);
      c.save();
      c.translate(x, y);
      c.rotate(Math.atan2(dy, dx));
      c.scale(1 + k, 1 - k * .7);
      c.drawImage(sprites.ball, -r, -r, r * 2, r * 2);
      c.restore();
    };
    let rippleTag = '', rippleAt = 0;
    const disc = (x, y, radius, color) => {
      c.beginPath();
      c.arc(x, y, radius, 0, 2 * Math.PI);
      c.fillStyle = color;
      c.fill();
    };
    const rail = ([ax, ay, bx, by], color, width) => line([[ax, ay], [bx, by]], width, color);
    return {
      draw(row, ball, flash, trail = [], gate = 0, others = []) {
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
        geo.rails.forEach((r, i) => {
          rail(r, '#17152f', .3);
          rail(r, i >= 9 ? guideColors[i - 9] : palette.steel, .14);
        });
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
        geo.slings.forEach((r, i) => {
          rail(r, '#252049', .34);
          rail(r, flash === 'sling' + i ? palette.ivory : palette.red, .23);
        });
        geo.targets.forEach((r, i) => rail(r, flash === 'target' + i ? palette.ivory : row[BANK] & (1 << i) ? '#38325c' : palette.red, .28));
        geo.bumps.forEach(([x, y, radius], i) => {
          disc(x, y, radius, '#252049');
          if (flash === 'bumper' + i) {
            if (rippleTag !== flash) { rippleTag = flash; rippleAt = performance.now(); }
            const age = Math.min(1, (performance.now() - rippleAt) / 420);
            if (!still) {
            c.beginPath();
            c.arc(x, y, radius + .1 + age * .75, 0, Math.PI * 2);
            c.strokeStyle = `rgba(255,243,168,${.8 * (1 - age)})`;
            c.lineWidth = .07 * (1 - age) + .01;
            c.stroke();
            }
            disc(x, y, radius + .12, '#fff3a8');
            disc(x, y, radius + .02, '#211c3d');
          }
          disc(x, y - .035, radius - .08, flash === 'bumper' + i ? palette.ivory : bumperColors[i]);
          disc(x, y - .07, radius - .24, '#30244f');
          disc(x, y - .12, .18, palette.ivory);
        });
        geo.lanes.forEach(([x, y], i) => {
          disc(x, y, .26, '#252049');
          disc(x, y, .2, flash === 'lane' + i || flash === 'skill' ? palette.ivory : palette.teal);
        });
        const lit = rampLit(row);
        const rampHit = flash === 'ramp' || flash === 'jackpot';
        const glow = rampHit ? palette.ivory : rampColor(row);
        line(track, .4, lit || rampHit ? glow + '55' : '#252049');
        line(track, .09, rampHit || lit ? glow : palette.steel);
        if (rampHit || lit) disc(...geo.ramp, .35, glow + '55');
        disc(...geo.ramp, .21, rampHit || lit ? glow : '#38325c');
        const [sx, sy] = geo.spinner;
        disc(sx, sy, .18, flash === 'spinner' ? '#fff0ca88' : '#c1d2e522');
        rail([sx - .47, sy, sx + .47, sy], flash === 'spinner' ? palette.ivory : palette.steel,
          .08 + .19 * Math.abs(Math.cos(row[SPIN] * 2 * Math.PI)));
        geo.flips.forEach(([x, y], i) => {
          const angle = ball[3 + i];
          // tapered rubber: round pivot end (r .26) to round tip (r .15)
          const ex = x + geo.length * Math.cos(angle), ey = y + geo.length * Math.sin(angle);
          const nx = -Math.sin(angle), ny = Math.cos(angle);
          for (const [color, grow] of [['#211b40', .05], [flipperColors[i], 0]]) {
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
        const plungerY = launchY + .39 + .25 * row[CHARGE] / 240;
        rail([launchX - .22, plungerY, launchX + .22, plungerY], palette.gold, .19);
        if (row[BALLS]) {
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
          drawBall(x, ballY, bumperHit ? 1.28 : 1, last ? x - last[0] : 0, last ? y - last[1] : 0, speed);
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
    for (const x of [-.26, 10.26]) rail([x, -.37, x, 17.4], .24, .23, .1, chrome);
    for (const y of [-.37, 17.4]) rail([-.23, y, 10.23, y], .22, .23, .1, brass);
    geo.rails.forEach((r, i) => {
      const trim = i >= 9 ? material(guideColors[i - 9], .35, .34) : chrome;
      rail(r, .18, .35, .15, trim);
    });
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
    geo.slings.forEach((r, i) => {
      rail(r, .5, .2, .17, rubberDark);
      rail(r, .28, .15, .33, lamp('sling' + i, palette.red));
    });
    geo.targets.forEach((r, i) =>
      rail(r, .26, .58, .3, lamp('target' + i, palette.red, row => row[BANK] & (1 << i) ? '#38325c' : palette.red)));
    geo.bumps.forEach(([x, y, radius], i) => {
      disc(x, y, radius - .05, .31, .18, chrome);
      disc(x, y, radius, .14, .33, rubberRed);
      disc(x, y, radius - .09, .13, .46, lamp('bumper' + i, bumperColors[i]));
      disc(x, y, radius - .25, .09, .55, dark);
      disc(x, y, .18, .03, .61, brass);
    });
    geo.lanes.forEach(([x, y], i) => {
      disc(x, y, .29, .075, .05, brass);
      disc(x, y, .21, .04, .1, lamp('lane' + i, palette.teal));
    });
    const track = rampPoints(geo);
    const rampRail = lamp('ramp', palette.steel, row => rampLit(row) ? rampColor(row) : palette.steel);
    rampRail.metalness = chrome.metalness;
    rampRail.roughness = chrome.roughness;
    for (const offset of [-.24, .24]) {
      const points = track.map(([x, y, z]) => new T.Vector3(x + offset, z + .07, y));
      const tube = new T.TubeGeometry(new T.CatmullRomCurve3(points), 32, .045, 6, false);
      mesh(tube, rampRail, 0, 0, 0);
    }
    disc(...geo.ramp, .26, .06, .04, lamp('ramp', '#38325c', row => rampLit(row) ? rampColor(row) : '#38325c'));
    const [sx, sy] = geo.spinner;
    disc(sx, sy, .2, .04, .08, material('#c1d2e5', .2, .3));
    for (const dx of [-.57, .57]) disc(sx + dx, sy, .094, .57, .28, brass);
    const spinner = box(.91, .085, .3, lamp('spinner', palette.steel), sx, sy, .35);

    const paddles = geo.flips.map(([x, y], i) => {
      // a rubber-sleeved flipper: fat at the pivot (.26), tapering to the tip (.15, the collision radius)
      const paddle = rubber(flipperColors[i]);
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
    const plunger = box(.43, .49, .32, brass, geo.launch[0], geo.launch[1] + .4, .16);
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
        sphere.visible = row[BALLS] > 0;
        sphere.position.set(ball[0], geo.radius + ball[2], Math.min(17.25, ball[1]));
        const bumperHit = flash?.startsWith('bumper');
        sphere.scale.setScalar(bumperHit ? 1.28 : 1);
        paddles.forEach((paddle, i) => { paddle.rotation.y = -ball[3 + i]; });
        plunger.position.z = geo.launch[1] + .4 + .33 * row[CHARGE] / 240;
        spinner.rotation.x = row[SPIN] * 2 * Math.PI;
        const pulse = .58 + .32 * Math.sin(performance.now() / 190);
        for (const { m, tag, normal, active, color } of lights) {
          const hit = flash === tag || flash === 'jackpot' && tag === 'ramp' || flash === 'skill' && tag.startsWith('lane');
          const lit = active?.(row);
          const glow = hit ? color : rampLit(row) && tag === 'ramp' ? rampColor(row) : null;
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
        <ol class="pb-standings" aria-label="Scores" hidden></ol>
        <div class="pb-run" hidden><span class="pb-caption">Run highlights</span><p></p></div>
        <div class="pb-top" hidden><span class="pb-caption">Top scores</span><ol></ol></div>
      </section>`;
    const root = arena.querySelector('.pb-cabinet');
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
    setText(find('balls'), row[BALLS]);
    find('nudges').classList.toggle('warn', !row[TILT] && row[NUDGES] >= 2);
    const nextExtra = (g.extra || []).find((v) => v > row[SCORE]);
    setText(find('nudges'), row[TILT] ? 'Tilted' : `Nudges ${3 - row[NUDGES]}${nextExtra ? ` · Extra ball ${nextExtra.toLocaleString()}` : ''}`);
    setText(find('ramp'), row[OTHERS]?.length ? `MULTIBALL ×${row[OTHERS].length + 1}` : row[JACKPOT] ? 'Jackpot lit' : rampLit(row) ? 'Ramp ready' : `Targets ${(row[BANK] & 1) + (row[BANK] >> 1 & 1) + (row[BANK] >> 2 & 1)}/3${row[LOCKED] ? ` · ${row[LOCKED]} locked` : ''}`);
    find('ramp').classList.toggle('lit', !!rampLit(row));
    g.stage.classList.toggle('tilted', !!row[TILT]);
    g.stage.classList.toggle('saving', row[SAVE] > 0 && !row[STAGED]);
    find('save').classList.toggle('lit', row[SAVE] > 0);
    setText(find('save'), row[SAVE] > 0 ? `Ball save ${row[SAVE]}s` : 'Ball save');
    const lanes = '●'.repeat([0, 1, 2].filter(i => row[LANES] >> i & 1).length).padEnd(3, '○');
    find('mult').hidden = !(row[MULT] > 1 || row[LANES] || row[HOLD] || !row[STAGED] && row[BONUS]);
    setText(find('mult'), `${row[MULT]}× ${lanes}${!row[STAGED] && row[BONUS] ? ` · Bonus ${row[BONUS].toLocaleString()}` : ''}${row[HOLD] ? ' · Hold' : ''}`);
    const shot = ['Lane', 'Targets', 'Spinner', 'Ramp'][row[LIT]];
    setText(find('shot'), `${row[COMBO] > 1 ? `Combo ${row[COMBO]} · ` : ''}2× ${shot}${row[KICK] ? ' · Kickback' : ''}`);
    find('jackpot').hidden = !jackpotLit(row) && !(row[HURRY] && !row[TILT]);
    setText(find('jackpot'), row[HURRY] ? `Spinner hurry-up · ${row[HURRY]}s` :
      row[OTHERS]?.length ? 'Multiball · Jackpot lit' : row[JACKPOT] ? `Jackpot · ${row[JACKPOT]}s` : '');
    const [skillStart, skillEnd] = g.skill;
    const inBand = !!row[STAGED] && row[CHARGE] >= skillStart && row[CHARGE] <= skillEnd;
    const launchCue = inBand ? 'Release for skill shot' : row[CHARGE] > skillEnd ? 'Release to launch' :
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
    const points = /\+[\d,]+/.exec(text)?.[0] || '';
    return row[COMBO] >= 5 && points ? `COMBO ×${row[COMBO]}! ${points}` : points;
  };

  function popup(g, row) {
    const el = g.find('popup'), text = popupText(row);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (text && g.me === g.viewer && !reduce) {
      el.textContent = text;
      el.hidden = false;
      el.style.left = `${100 * (g.ball?.[0] ?? row[X]) / 10}%`;
      el.style.top = `${100 * ((g.ball?.[1] ?? row[Y]) + .85) / 18.7}%`;
      el.classList.toggle('big', ['ramp', 'jackpot', 'super', 'hurry', 'bonus', 'skill', 'multiball'].includes(row[EVENT]));
      el.classList.toggle('huge', row[EVENT] === 'extra');
      el.classList.remove('go');
      void el.offsetWidth;
      el.classList.add('go');
    }
    // table shake scales with the moment: a nudge is a shove, a jackpot or multiball a slam
    const shove = { nudge: 3, tilt: 4, jackpot: 5, super: 8, multiball: 7, extra: 6 }[row[EVENT]];
    if (shove && !reduce) {
      g.stage.style.setProperty('--shake', `${shove}px`);
      g.stage.classList.remove('shake');
      void g.stage.offsetWidth;
      g.stage.classList.add('shake');
    }
    g.stage.classList.toggle('white', row[EVENT] === 'extra' || row[EVENT] === 'super');
    // a jackpot, super, multiball or extra ball throws a ring of sparks from the ball; the table pulse takes the event's colour
    const sparks = { jackpot: 14, super: 28, multiball: 22, extra: 22, hurry: 14 }[row[EVENT]];
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
    if (['ramp', 'jackpot', 'super', 'kickback', 'bonus', 'extra', 'lock', 'multiball'].includes(row[EVENT]) && !reduce) {
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
    // the last nudge before tilt: a warning buzz for the player
    if (prior && viewer === g.me && !g.ctx.readOnly && row[NUDGES] === 3 && prior[NUDGES] < 3) g.ctx.sfx('alarm');
    if (prior && prior[EVENT_ID] !== row[EVENT_ID]) {
      g.flashAt = performance.now() + 780;
      popup(g, row);
      if (viewer === g.me && !g.ctx.readOnly) g.ctx.sfx(sound(row[EVENT]), soundArg(row[EVENT]));
    }
    // the plunger lets go: a spring thwack as the ball shoots up the lane
    if (prior && prior[STAGED] && !row[STAGED] && prior[BALLS] === row[BALLS] && viewer === g.me && !g.ctx.readOnly) g.ctx.sfx('plaunch');
    g.enabled = !!(g.active && g.me && row[BALLS]);
    if (!g.enabled || row[TILT] && !prior?.[TILT]) clearControls(g);
    g.row = row;
    if (prior !== row) g.receivedAt = performance.now();
    if (g.over && g.solo && g.me && !row[BALLS] && !g.topSaved) {
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
    if (g.over && g.solo && g.me && !row[BALLS] && (g.best === null || row[SCORE] > g.best)) {
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
    const others = (row[OTHERS] || []).map(([x, y, vx, vy, z]) => [x + vx * ahead, y + vy * ahead, z]);
    (g.three || g.flat)?.draw(row, g.ball, flash, g.trail, g.gate, others, !!idle);
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
        g.table = data.table || 'golden';
        g.stage.setAttribute('aria-label', `${g.table === 'neon' ? 'Neon Arcade' : 'Golden Hour'} pinball playfield`);
        g.skill = data.layout.skill;
        g.extra = data.extra || [];
        const saved = load(bestKey(g));
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
