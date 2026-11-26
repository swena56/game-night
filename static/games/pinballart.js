// The printed playfield of a pinball table (sky, sun, canyon, medallion, labels, inserts, decals), shared by the game and the table editor
// so a table looks the same in both. PinballArt.make(geo) returns a 600x1020 canvas (60 px per table unit).
(() => {
  const palette = { gold: '#ffd383', ivory: '#fff0ca', teal: '#59edd2', red: '#ff6854', steel: '#c1d2e5' };
  // the outline of a decal glyph around (0, 0) at unit size u (a path on c, not yet filled)
  function glyphPath(c, glyph, u) {
    c.beginPath();
    if (glyph === 'star') for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? u * .45 : u; c[i ? 'lineTo' : 'moveTo'](rr * Math.cos(a), rr * Math.sin(a)); }
    else if (glyph === 'heart') { c.moveTo(0, u * .85); c.bezierCurveTo(-u * 1.3, u * .1, -u * .55, -u * .9, 0, -u * .3); c.bezierCurveTo(u * .55, -u * .9, u * 1.3, u * .1, 0, u * .85); }
    else if (glyph === 'bolt') { c.moveTo(u * .2, -u); c.lineTo(-u * .55, u * .1); c.lineTo(-u * .05, u * .1); c.lineTo(-u * .2, u); c.lineTo(u * .55, -u * .2); c.lineTo(u * .05, -u * .2); }
    else if (glyph === 'diamond') { c.moveTo(0, -u); c.lineTo(u * .65, 0); c.lineTo(0, u); c.lineTo(-u * .65, 0); }
    else if (glyph === 'moon') { c.arc(0, 0, u, -Math.PI * .1, Math.PI * 1.1, false); c.arc(u * .38, -u * .1, u * .8, Math.PI * .85, -Math.PI * .2, true); }
    else if (glyph === 'dot') c.arc(0, 0, u, 0, Math.PI * 2);
    else { c.arc(0, 0, u, 0, Math.PI * 2); c.moveTo(u * .62, 0); c.arc(0, 0, u * .62, 0, Math.PI * 2); }
    c.closePath();
  }

  const mixHex = (a, b, t) => {
    const p = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
    return '#' + [0, 1, 2].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t).toString(16).padStart(2, '0')).join('');
  };
  const HOLD = 1.4;        // seconds a motion or hit trigger keeps the light going after the last touch

  // Decal lights: a decal with an effect (geo.paint.decals[n][5]) shows its colour, and steps, fades or twinkles through up to four colours.
  // fx.tr lists what lights it (any one of them does): always, a timer, a ball passing close (motion), a hit on one of the table's parts
  // (the game's event names: bumper0, sling1, target2, ...; a tag ending in * means any of them: bumper*) or a game event (multiball, jackpot...).
  // fx.dl delays the start after a trigger, fx.ho is how long a moment keeps it going. Flashing is capped at three colour changes a second.
  // update(now ms, { balls: [[x, y]], flash, states: Set of game states, calm }) returns what to paint now: [{ glyph, x, y, r, color, alpha }].
  function lights(geo) {
    const decals = (geo.paint?.decals || []).filter((d) => d[5]);
    const triggers = (fx) => fx.tr || [fx];          // an effect made by the editor may carry its single trigger beside the colours
    const seen = decals.map((d) => triggers(d[5]).map(() => ({ last: -1e9, start: -1e9 }))), begin = performance.now();
    const tagHit = (tag, flash) => !!tag && !!flash && (tag.endsWith('*') ? flash.startsWith(tag.slice(0, -1)) : flash === tag);
    return {
      count: decals.length,
      update(now, env = {}) {
        const { balls = [], flash = '', states, calm = false } = env, t = (now - begin) / 1000;
        return decals.map(([glyph, x, y, r, color, fx], i) => {
          const dl = fx.dl || 0, ho = fx.ho ?? HOLD;
          let on = false;
          triggers(fx).forEach((g, k) => {
            if (g.on === 'always') { on = on || t >= dl; return; }
            if (g.on === 'timer') { on = on || t >= dl && (t - dl) % g.ev < g.du; return; }
            const hot = g.on === 'motion' ? balls.some((b) => Math.hypot(b[0] - x, b[1] - y) <= g.nr + r)
              : g.on === 'hit' ? tagHit(g.tag, flash) : !!(states?.has(g.gv) || flash === g.gv);
            const s = seen[i][k];
            if (hot) { if (now - s.last > 500) s.start = now; s.last = now; }
            on = on || ((now - s.last) / 1000 < ho && (now - s.start) / 1000 >= dl);
          });
          if (!on) return { glyph, x, y, r, color, alpha: .22 };       // waiting for its trigger: dim
          const cs = [color, fx.c2, fx.c3, fx.c4].filter(Boolean), n = cs.length;
          if (calm || fx.m === 'steady') return { glyph, x, y, r, color: cs[n - 1], alpha: .85 };      // reduced motion: lit, not flashing
          const period = fx.m === 'flash' ? Math.max(fx.r, .33 * n) : fx.m === 'twinkle' ? Math.max(fx.r, .5) : fx.r, phase = (t / period) % 1;
          if (fx.m === 'flash') return { glyph, x, y, r, color: cs[Math.floor(phase * n)], alpha: .85 };        // steps through every colour in turn
          if (fx.m === 'cycle') { const at = phase * n, k = Math.floor(at); return { glyph, x, y, r, color: mixHex(cs[k], cs[(k + 1) % n], at - k), alpha: .8 }; }     // fades through them and back round
          if (fx.m === 'pulse') return { glyph, x, y, r, color: mixHex(color, fx.c2, .35), alpha: .35 + .6 * (.5 - .5 * Math.cos(phase * 2 * Math.PI)) };
          const q = x * 12.9 + y * 7.7, a = Math.sin(t * 7.3 / period + q) * Math.sin(t * 3.1 / period + q * 1.7);     // twinkle
          return { glyph, x, y, r, color: cs[Math.floor(t / period + q) % n], alpha: .25 + .7 * a * a };
        });
      },
    };
  }

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
    const title = geo.paint?.name || (geo.theme === 'custom' ? 'My Table' : 'Golden Hour');       // the table's own name, on the official ones too
    c.font = 'bold 55px Georgia';
    const titleWidth = c.measureText(title).width;
    if (titleWidth > 330) c.font = `bold ${Math.max(22, Math.floor(55 * 330 / titleWidth))}px Georgia`;   // long names shrink to fit the medallion
    const plain = geo.theme === 'custom';                 // editor-built tables show just their name, centred in the medallion
    c.fillText(title, 0, plain ? 18 : -3);
    if (!plain) {
      c.fillStyle = palette.gold;
      c.font = 'bold 24px sans-serif';
      c.fillText('P I N B A L L', 0, 48);
    }
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
    for (const x of geo.lanes.length ? [3.25, 5.25] : []) {
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
    const [targetX, targetY] = geo.targets[0] || [0, 0];
    const targetEnd = geo.targets.at(-1)?.[3] ?? 0;
    if (geo.targets.length) c.strokeRect(targetX - .43, targetY - .25, .86, targetEnd - targetY + .5);
    for (const [x, y, radius] of geo.bumps) {
      c.beginPath();
      c.arc(x, y, radius + .18, 0, Math.PI * 2);
      c.strokeStyle = '#ffffff30';
      c.lineWidth = .035;
      c.stroke();
    }
    if (geo.ramp) {
      const [rx, ry] = geo.ramp;
      c.strokeStyle = '#59edd270';
      c.lineWidth = .04;
      c.beginPath();
      c.moveTo(rx - .5, ry + .6);
      c.lineTo(rx + .5, ry + .6);
      c.stroke();
    }
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
    if (geo.ramp) c.fillText('3× RAMP', geo.ramp[0] * 100, (geo.ramp[1] + .94) * 100);
    c.fillText('D R A I N', 500, 1681);
    // the apron card, as printed under the flippers of a real machine
    c.save();
    c.font = 'bold 14px sans-serif';
    c.fillStyle = palette.gold + 'bb';
    c.fillText('FLIP  A · D  or  ← →     PLUNGE  SPACE     NUDGE  Q · W · E', 500, 1656);
    c.restore();
    for (const [glyph, gx, gy, gr, gc, fx] of geo.paint?.decals || []) {     // custom-table decals painted under the glass (lights are drawn live: see lights())
      if (fx) continue;
      c.save(); c.translate(gx * 100, gy * 100); const u = gr * 100;
      c.globalAlpha = .55; c.fillStyle = c.strokeStyle = gc; c.lineWidth = u * .16; c.lineJoin = 'round'; glyphPath(c, glyph, u);
      glyph === 'ring' ? c.stroke() : c.fill(); c.restore();
    }
    c.fillStyle = palette.teal;
    c.font = 'bold 21px sans-serif';
    const stock = geo.theme !== 'custom';   // the printed labels below sit where Golden Hour's parts are
    if (geo.lanes.length && stock) c.fillText('ROLLOVER LANES', 500, 231);
    if (geo.targets.length) c.fillText('TARGET BANK', targetX * 100, (targetEnd + .5) * 100);
    c.fillStyle = palette.gold;
    if (geo.spinner) c.fillText('SPINNER', geo.spinner[0] * 100, (geo.spinner[1] + .42) * 100);
    if (geo.bumps.length && stock) c.fillText('BUMPERS', 487, 451);
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

  window.PinballArt = { make: makeArt, lights, glyphPath };
})();
