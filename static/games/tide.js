// Tide Castles: everyone builds on their own beach at once, then the same waves roll up every beach.
// While building you tap a tool (🧱 wall, 🗼 tower, 🕳️ moat, 🐚 shell, 🚩 flag, 🏰 move the keep) and then squares of
// your beach (tap something you built this tide to take it back). Rivals' beaches show what stood after the last tide.
// When the tide comes in, the server has already rolled the waves (games/tide.py run_tide); this module plays them
// back from each beach as it stood before (`before`): the swell building out at sea, water racing in square by
// square, walls wearing down in chunks, moats filling, shells washed off, keeps falling, then the tally of what stood.
// #184/#185: pieces pop in with a thud and a puff of sand, a ghost shows where the tool would go, ramparts / moat
// channels / flags call out as you make them, every tide has a 🎯 goal, and the beach is a sunny golden-hour one
// (sun, clouds, gulls, a sailboat, umbrellas, starfish, sparkles on the sea) in both 3D and the flat view.
UI.tide = (() => {
  let S, ctx, V = null, gl = null, flat = null, raf = 0, ro = null, tool = 'wall', gotAt = 0, all = false;
  let disp = [], dispKey = '', test = false, cursor = null, hover = null, prevMine = null, tallied = '', nextGull = 0;
  const $ = (id) => document.getElementById(id);
  const calm = () => document.body.classList.contains('calm');
  const TOOLS = [['wall', '🧱', 'Wall', '•'], ['tower', '🗼', 'Tower', '••+'], ['moat', '🕳️', 'Moat', '•'], ['shell', '🐚', 'Shell', '•'], ['flag', '🚩', 'Flag', '•'], ['keep', '🏰', 'Keep', '']];
  const IN = 0.45;      // seconds a wave takes to roll in from out at sea to the first row
  const STEP = 0.09;    // … then a square every this long

  function mount(main, side) {
    V = null; gl = null; flat = null; tool = 'wall'; all = false; disp = []; dispKey = ''; test = false; cursor = null; hover = null; prevMine = null; tallied = '';
    main.innerHTML = `<div class="tc"><div class="tc-stage" id="tcStage">
        <div class="tc-hud"><span id="tcTide"></span><span id="tcClock"></span></div>
        <div class="tc-goal" id="tcGoal"></div>
        <div class="tc-fore" id="tcFore"></div>
        <div class="tc-wave" id="tcWave" hidden></div>
        <div class="tc-pop" id="tcPop" hidden></div>
        <div class="tc-fx" id="tcFx"></div>
        <div class="tc-tally" id="tcTally" hidden></div>
        <button class="tc-all" id="tcAll" title="See every beach">👀 All</button>
      </div>
      <div class="tc-tools" id="tcTools">${TOOLS.map(([k, ic, nm, cost]) => `<button data-t="${k}" title="${nm}"><b>${ic}</b><small>${nm}${cost ? ` ${cost}` : ''}</small></button>`).join('')}
        <span class="tc-sand" id="tcSand"></span><button class="tc-test" id="tcTest" title="Show where the biggest wave would reach">🔍 Test</button><button class="primary tc-ready" id="tcReady">✅ Ready</button></div>
      <p id="tcHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>🏖️ Beaches</h3><div id="tcRace"></div><p class="hint left">Tap a tool, then squares of your beach. 🗼 on a wall or tower piles it higher (up to 4); 🚩 goes on a tower 2+ high. Three walls/towers side by side make a 🧱 rampart (braced: harder to wear), three moats a channel (soaks 2 waves). Tap something you built this tide to take it back. 🔍 Test shows where the biggest wave would reach. Each wave your keep stands scores 6, its strength left scores too, shells and flags 3, every piece still standing 1 (2 in a rampart), and the 🎯 goal 8.</p></div><div class="panel tc-recap" id="tcRecap" hidden><h3 id="tcRecapTitle">🌊 Last tide report</h3><div id="tcRecapRows"></div></div>';
    $('tcTools').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'tcReady') return ctx.act('done').then(() => SN.ready()).catch((er) => ctx.toast?.(er?.message || 'Not now.'));
      if (b.id === 'tcTest') { test = !test; renderSide(); return; }
      tool = b.dataset.t; SN.tool(); renderSide();
    });
    $('tcAll').addEventListener('click', () => { all = !all; $('tcAll').classList.toggle('on', all); });
    const stage = $('tcStage');
    stage.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const hit = (gl || flat)?.pick(e.clientX, e.clientY);
      if (hit) tap(hit[0], hit[1]);
    });
    // the ghost: where the tool would go (a mouse hovering, or a finger down before it lifts)
    const aim = (e) => { if (!building() || e.target.closest?.('button')) { hover = null; return; } const h = (gl || flat)?.pick(e.clientX, e.clientY); hover = h ? { r: h[0], c: h[1], at: performance.now() } : null; };
    stage.addEventListener('pointermove', aim);
    stage.addEventListener('pointerdown', aim);
    stage.addEventListener('pointerleave', () => { hover = null; });
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    GL3.load().then(() => { if (stage.isConnected && !gl && V) GL3.revive(stage, revive(stage)); })
      .catch(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); });
    raf = requestAnimationFrame(loop);
  }
  const revive = (stage) => ({ build: () => (gl = make3d(stage)), flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } });

  function unmount() { cancelAnimationFrame(raf); ro?.disconnect(); gl?.dispose(); gl = null; flat = null; window.Snd?.bed('tide.surf').set(0); }

  const G = () => V.geo;
  const me = () => V?.me;
  const colorOf = (i) => ctx.player(V.seats[i])?.color ?? '#888';
  const nameOf = (i) => ctx.player(V.seats[i])?.name ?? '?';
  const building = () => S?.phase === 'playing' && V?.stage === 'build' && V.me != null;
  const HT = (k) => k === 'wall' || k === 'tower';
  const flagSet = (p) => new Set((p?.flags || []).map(([r, c]) => `${r},${c}`));

  // can `item` go on (r, c) of my beach right now? (games/tide.py place_cost, plus the sand left)
  function canPlace(r, c, item, anySand = false) {
    const p = V.plots[V.me]; if (!p) return false;
    const cell = p.g[r][c], keepHere = r === G().keepRow && c === p.keep, left = anySand ? 99 : V.left[V.me];
    if (item === 'keep') return r === G().keepRow && (!cell || keepHere) && (!V.moved[V.me] || keepHere);
    if (keepHere) return false;
    if (item === 'flag') return !!cell && cell[0] === 'tower' && cell[1] >= 2 && !flagSet(p).has(`${r},${c}`) && left >= 1;
    if (!cell) return left >= (G().cost[item] ?? 9);
    return item === 'tower' && HT(cell[0]) && cell[1] < (G().maxH || 4) && left >= 1;
  }

  function tap(r, c) {
    if (!building()) return;
    const mine = V.plots[V.me]; if (!mine) return;
    const cell = mine.g[r][c], placed = V.placed.some(([pr, pc]) => pr === r && pc === c);
    const add = canPlace(r, c, tool, true);   // (out of sand, a pile still tries, and says so)
    let p;
    cursor = { r, c, at: performance.now() }; hover = null;
    if (tool === 'keep') p = ctx.act('keep', { r, c });
    else if (cell && placed && !add) p = ctx.act('clear', { r, c }).then(() => { SN.scoop(); (gl || flat)?.puff?.(r, c, 6); });
    else p = ctx.act('build', { r, c, item: tool });
    p.then(() => { ctx.buzz?.(tool === 'tower' ? 14 : 8); }).catch((e) => { SN.nope(); ctx.toast?.(e?.message || 'Not there.'); });
  }

  // ---------- state
  function render(s, c) {
    S = s; ctx = c; V = s.tide; gotAt = performance.now();
    if (!gl && !flat && window.THREE && $('tcStage')) GL3.revive($('tcStage'), revive($('tcStage')));
    if (V.stage === 'build') noticeBuild();
    else prevMine = null;
    renderSide();
    renderWaveRecap();
  }

  // runs of RUN+ side by side in a row (games/tide.py runs)
  function runsOf(g, kinds) {
    const out = [], n = G().run || 3;
    for (let r = 0; r < g.length; r++) {
      let cur = [];
      for (let c = 0; c <= g[r].length; c++) {
        const cell = c < g[r].length ? g[r][c] : null;
        if (cell && kinds.includes(cell[0]) && (!HT(cell[0]) || cell[1] > 0)) { cur.push([r, c]); continue; }
        if (cur.length >= n) out.push(cur);
        cur = [];
      }
    }
    return out;
  }
  const bracedSet = (g) => new Set(runsOf(g, ['wall', 'tower']).flat().map(([r, c]) => `${r},${c}`));

  // what I just built: the thud, the puff, and callouts for ramparts, channels, flags and tall towers
  function noticeBuild() {
    const p = V.plots[V.me]; if (!p) return;
    const was = prevMine; prevMine = { g: p.g.map((row) => row.map((x) => (x ? [...x] : null))), flags: flagSet(p), keep: p.keep, tide: V.tide };
    if (!was || was.tide !== V.tide) return;
    let grew = null;
    for (let r = 0; r < p.g.length; r++) for (let c = 0; c < p.g[r].length; c++) {
      const a = was.g[r][c], b = p.g[r][c];
      if (b && (!a || a[0] !== b[0] || a[1] < b[1])) grew = { r, c, cell: b };
      if (prevMine.flags.has(`${r},${c}`) && !was.flags.has(`${r},${c}`)) grew = { r, c, cell: b, flag: true };
    }
    if (p.keep !== was.keep) { SN.thud(3); (gl || flat)?.puff?.(G().keepRow, p.keep, 14); }
    if (!grew) return;
    (gl || flat)?.puff?.(grew.r, grew.c, grew.flag ? 4 : 10 + 3 * (grew.cell?.[1] || 0));
    if (grew.flag) { SN.flag(); return say('🚩 Flag up! +3 every tide it flies'); }
    SN.thud(grew.cell[1] || 0);
    const ra = runsOf(was.g, ['wall', 'tower']), rb = runsOf(p.g, ['wall', 'tower']);
    const ma = runsOf(was.g, ['moat']), mb = runsOf(p.g, ['moat']);
    const longest = (rs) => Math.max(0, ...rs.map((x) => x.length));
    if (rb.length > ra.length || longest(rb) > longest(ra)) { SN.combo(longest(rb)); return say(`🧱 Rampart ×${longest(rb)}! Braced against the waves`); }
    if (mb.length > ma.length || longest(mb) > longest(ma)) { SN.combo(3); return say('🕳️ Moat channel! Soaks two waves'); }
    if (grew.cell[0] === 'tower' && grew.cell[1] === (G().maxH || 4)) { SN.combo(4); return say(`🗼 A tower ${grew.cell[1]} high!`); }
  }
  function say(text) { pop(text, 1300, 'tc-pop-build'); }

  // the tide's clock: seconds since the first wave started rolling (negative while the swell builds out at sea)
  const lead = () => G().lead || 0;
  const tideT = (now) => (V.stage === 'tide' ? V.since + (now - gotAt) / 1000 - lead() : V.stage === 'between' ? 1e9 : -99);
  // each beach as shown: during a tide, the beach before it with the waves so far applied
  function shownPlots(now) {
    const t = tideT(now), wt = G().waveT;
    if ((V.stage !== 'tide' && V.stage !== 'between') || !V.before) { const k = `v${V.tide}${V.stage}${JSON.stringify(V.plots)}`; if (k !== dispKey) { dispKey = k; disp = V.plots.map((p) => p && clone(p)); } return disp; }
    const upto = Math.max(0, Math.min(G().waves, Math.floor((t - wt * 0.55) / wt) + 1));   // waves whose wear has happened
    const k = `t${V.tide}:${upto}`;
    if (k !== dispKey) {
      dispKey = k;
      disp = V.before.map((p, i) => {
        if (!p) return null;
        const q = clone(p), res = V.result?.[i];
        for (let w = 0; w < upto && res; w++) {
          const wave = res.waves[w];
          for (const [r, c, , worn] of wave.hit) if (worn) { const cell = q.g[r][c]; if (cell) { cell[1] -= worn; q.flags.delete(`${r},${c}`); if (cell[1] <= 0) q.g[r][c] = null; else cell[0] = cell[1] >= 2 ? 'tower' : 'wall'; } }
          for (const [r, c] of wave.wet) { q.wet.add(`${r},${c}`); if (q.g[r][c]?.[0] === 'shell') q.g[r][c] = null; }
          for (const [r, c] of wave.soak) q.filled.add(`${r},${c}`);
          if (wave.hp != null) q.hp = wave.hp;
          if (wave.hp != null ? wave.hp <= 0 : wave.keep) q.fallen = true;
        }
        return q;
      });
    }
    return disp;
  }
  const clone = (p) => ({ g: p.g.map((row) => row.map((c) => (c ? [c[0], c[1]] : null))), keep: p.keep, flags: flagSet(p), filled: new Set(), fallen: false, hp: V?.geo?.keepHp ?? 10, wet: new Set() });

  // #157 🔍 Test: the biggest wave of the forecast rolled up my beach as it stands now (games/tide.py run_tide, one
  // wave): the squares it reaches with their force, what it would wear and what the keep would lose
  function testWave(p) {
    const g0 = G(), C = g0.cols, R = g0.rows, F = Math.max(...V.waves), best = new Map(), wet = [], hits = [], br = bracedSet(p.g);
    let front = [], keepF = 0;
    for (let c = 0; c < C; c++) front.push([0, c, F]);
    while (front.length) {
      front.sort((a, b) => b[2] - a[2]);
      const [r, c, f] = front.shift(), k = `${r},${c}`;
      if ((best.get(k) ?? 0) >= f) continue;
      best.set(k, f);
      if (r === g0.keepRow && c === p.keep) { keepF = Math.max(keepF, f); continue; }
      const cell = p.g[r][c];
      if (cell && HT(cell[0]) && cell[1] > 0) { hits.push([r, c, f, wearOf(f, cell[1], br.has(k))]); continue; }
      if (cell && cell[0] === 'moat') continue;
      wet.push([r, c, f]);
      if (f - 1 >= 1) for (const [dr, dc] of [[1, 0], [0, 1], [0, -1], [-1, 0]]) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < R && cc >= 0 && cc < C && (best.get(`${rr},${cc}`) ?? 0) < f - 1) front.push([rr, cc, f - 1]); }
    }
    return { F, wet, hits, keepF, dmg: Math.floor((keepF + 1) / 3) };
  }
  // (games/tide.py wear: a level when it hits WEAR harder, +BRACE in a rampart)
  const wearOf = (f, h, braced) => (h > 0 && f - h - (G().wear ?? 4) - (braced ? G().brace ?? 1 : 0) >= 0 ? 1 : 0);

  // the goal's progress on my beach as it stands (for the ones you can count before the tide)
  function goalNow() {
    const gl0 = V.goal, p = V.plots[V.me]; if (!gl0 || !p) return '';
    const g = p.g, cells = g.flat().filter(Boolean);
    const n = { towers: cells.filter((x) => x[0] === 'tower' && x[1] >= 2).length, rampart: Math.max(0, ...runsOf(g, ['wall', 'tower']).map((x) => x.length)),
      shells: cells.filter((x) => x[0] === 'shell').length, flags: (p.flags || []).length }[gl0[0]];
    const need = { towers: 3, rampart: 4, shells: 2, flags: 2 }[gl0[0]];
    return n == null ? '' : ` ${Math.min(n, need)}/${need}`;
  }

  function renderSide() {
    const box = $('tcRace'); if (!box || !V) return;
    box.innerHTML = '';
    const order = V.seats.map((_, i) => i).sort((a, b) => V.points[b] - V.points[a]);
    for (const i of order) {
      const p = ctx.player(V.seats[i]), row = ctx.el('div', 'seat-row lr-row' + (p && !p.eliminated ? '' : ' out'));
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = colorOf(i);
      const res = V.result?.[i], st = V.stage === 'build' ? (V.ready[i] ? '✅' : '🛠️') : res ? `🏰 ${res.survived}/${G().waves}${res.hp != null ? ` ❤${res.hp}` : ''}${res.parts?.goal ? ' 🎯' : ''}` : '';
      row.append(dot, ctx.el('span', 'grow', `${nameOf(i)}${i === V.me ? ' (you)' : ''}`), ctx.el('span', 'tc-st', st), ctx.el('b', '', `${V.points[i]}`));
      box.append(row);
    }
    const b = building();
    $('tcTools').hidden = V.me == null;
    $('tcTools').classList.toggle('tc-off', !b);
    for (const el of $('tcTools').querySelectorAll('[data-t]')) {
      el.classList.toggle('on', el.dataset.t === tool);
      const k = el.dataset.t;
      el.disabled = !b || (k !== 'keep' && V.left[V.me] < (G().cost[k] ?? 9) && !(k === 'tower' && V.left[V.me] >= 1));
    }
    $('tcSand').textContent = V.me != null ? `🪣 ${V.left[V.me]}/${V.sand}` : '';
    $('tcSand').classList.toggle('tc-low', V.me != null && V.left[V.me] <= 2);
    $('tcReady').disabled = !b || V.ready[V.me];
    $('tcTest').disabled = !b; $('tcTest').classList.toggle('on', b && test);
    $('tcReady').textContent = V.me != null && V.ready[V.me] ? '✅ Ready!' : '✅ Ready';
    $('tcTide').textContent = `🌊 Tide ${V.tide} / ${V.tides}`;
    const mineRes = V.result?.[V.me];
    $('tcGoal').textContent = V.goal ? `🎯 ${V.goal[1]}${V.stage === 'build' ? goalNow() : mineRes?.parts ? (mineRes.parts.goal ? ' ✓' : ' ✗') : ''}` : '';
    $('tcGoal').classList.toggle('tc-met', !!mineRes?.parts?.goal && V.stage !== 'build');
    const fore = $('tcFore'); fore.innerHTML = '';
    // the forecast as waves sized by their force
    const lo = Math.min(...V.waves), hi = Math.max(...V.waves);
    V.waves.forEach((w, k) => { const s = ctx.el('span', 'tc-w' + (k === V.waves.length - 1 ? ' big' : '')); s.textContent = `${w}`; s.style.setProperty('--wz', (0.8 + 0.5 * (w - lo) / Math.max(1, hi - lo)).toFixed(2)); s.dataset.k = k; fore.append(s); });
    $('tcHint').textContent = !b ? (V.stage === 'tide' ? 'Here come the waves…' : V.stage === 'between' ? 'The tide goes out…' : '')
      : tool === 'keep' ? (V.moved[V.me] ? 'You moved your keep this tide (you can move it back).' : 'Tap a back-row square to move your keep (once a tide).')
      : tool === 'flag' ? 'Tap a tower 2+ high to fly a flag: +3 every tide its tower isn\'t worn.'
      : test && V.plots[V.me] ? (() => { const tw = testWave(V.plots[V.me]), worn = tw.hits.filter((h) => h[3]).length; return `🔍 The ${tw.F} wave: ${tw.keepF ? (tw.dmg ? `your keep loses ${tw.dmg} of ${G().keepHp}` : 'a trickle reaches your keep (no harm)') : 'your keep stays dry'}${worn ? `, ${worn} piece${worn > 1 ? 's' : ''} worn` : ''}.`; })()
      : `The waves swell to the big one. A wave wears a piece a level when it hits ${G().wear ?? 4} harder than it's tall (${(G().wear ?? 4) + (G().brace ?? 1)} in a 🧱 rampart of 3+).`;
    if (V.stage === 'build') { $('tcTally').hidden = true; tallied = ''; }
  }

  function renderWaveRecap() {
    const box = $('tcRecap'), rows = $('tcRecapRows');
    if (!box || !rows || V.me == null) return;
    const tide = V.waveHistory?.[V.waveHistory.length - 1], result = tide?.result?.[V.me];
    box.hidden = !result;
    rows.replaceChildren();
    if (!result) return;
    $('tcRecapTitle').textContent = `🌊 Tide ${tide.tide} · ${result.pts} points`;
    const labels = { wall: 'Wall', tower: 'Tower', moat: 'Moat', shell: 'Shell' };
    result.waves.forEach((wave, i) => {
      const detail = ctx.el('details', 'tc-recap-wave');
      const summary = ctx.el('summary', '', `Wave ${i + 1} · force ${tide.forces[i]} · ${wave.wet.length} water cells reached`);
      detail.append(summary);
      const hits = wave.hit.map(([r, c, f, lost, kind, h, braced]) =>
        `${labels[kind] || kind} at row ${r + 1}, column ${c + 1} took force ${f}: ${lost ? `wore down ${lost} level${lost > 1 ? 's' : ''}${braced ? ' despite its rampart brace' : ''}` : `held at height ${h}${braced ? ' with its rampart brace' : ''}`}.`);
      const soaked = wave.soak.length ? `${wave.soak.length} moat${wave.soak.length === 1 ? '' : 's'} soaked at ${wave.soak.map(([r, c]) => `${r + 1},${c + 1}`).join(' · ')}.` : '';
      const washed = wave.washed?.length ? `${wave.washed.length} shell${wave.washed.length === 1 ? '' : 's'} washed away.` : '';
      const keep = !wave.keep ? 'The keep stayed dry.' : wave.dmg
        ? `The keep took ${wave.dmg} damage and ended at ${wave.hp}/${G().keepHp} strength.`
        : `Only a harmless trickle reached the keep; it stayed at ${wave.hp}/${G().keepHp} strength.`;
      detail.append(ctx.el('p', '', [keep, soaked, washed, ...hits].filter(Boolean).join(' ')));
      rows.append(detail);
    });
    const parts = result.parts || {};
    const scoring = Object.entries(parts).filter(([, pts]) => pts).map(([k, pts]) => `${k} +${pts}`).join(' · ');
    rows.append(ctx.el('p', 'tc-recap-score', `Score: ${scoring || 'no bonus points'} = ${result.pts}.`));
  }

  function pop(text, ms = 1600, cls = '') {
    const el = $('tcPop'); if (!el) return;
    el.textContent = text; el.hidden = false; el.className = `tc-pop tc-pop-in ${cls}`; void el.offsetWidth;
    clearTimeout(pop.t); pop.t = setTimeout(() => { el.hidden = true; }, ms);
  }
  // a score floating up from a square of a beach
  function floater(i, r, c, text, cls = '', y = 0.6) {
    const box = $('tcFx'), at = (gl || flat)?.toScreen?.(i, r, c, y); if (!box || !at) return;
    const el = document.createElement('div');
    el.className = `tc-fl ${cls}`; el.textContent = text; el.style.left = `${at[0]}px`; el.style.top = `${at[1]}px`;
    box.append(el); setTimeout(() => el.remove(), 1500);
    while (box.childElementCount > 24) box.firstChild.remove();
  }

  // the end of a tide: every piece still standing on my beach counts up, then the tally card
  function tally() {
    const i = V.me, res = V.result?.[i], p = V.plots[i]; if (i == null || !res || !p) return;
    const key = `${V.tide}`; if (tallied === key) return; tallied = key;
    const parts = res.parts || { waves: res.survived * G().wavePts, keep: res.hp, shells: res.shells * G().shellPts };
    const br = bracedSet(p.g), fl = flagSet(p), spots = [];
    for (let r = 0; r < p.g.length; r++) for (let c = 0; c < p.g[r].length; c++) {
      const cell = p.g[r][c]; if (!cell) continue;
      if (HT(cell[0]) && parts.standing != null) spots.push([r, c, `+${br.has(`${r},${c}`) ? 2 : 1}`, br.has(`${r},${c}`) ? 'tc-fl-rampart' : '']);
      if (fl.has(`${r},${c}`)) spots.push([r, c, `🚩+${G().flagPts ?? 3}`, 'tc-fl-flag']);
      if (cell[0] === 'shell') spots.push([r, c, `🐚+${G().shellPts}`, 'tc-fl-shell']);
    }
    spots.push([G().keepRow, p.keep, `🏰+${parts.waves + parts.keep}`, 'tc-fl-keep']);
    const gap = Math.min(160, 2400 / Math.max(1, spots.length));
    spots.forEach(([r, c, text, cls], k) => setTimeout(() => { if (V.stage === 'build') return; floater(i, r, c, text, cls, 0.9); SN.tick(k); (gl || flat)?.sparkle?.(i, r, c); }, 300 + k * gap));
    const rows = [
      ['🌊', `Waves stood ${res.survived}/${G().waves}`, parts.waves], ['❤️', 'Keep strength', parts.keep],
      ['🧱', 'Pieces standing', parts.standing], ['🛡️', 'In a rampart', parts.rampart], ['🚩', 'Flags flying', parts.flags], ['🐚', 'Shells left', parts.shells],
      ['🎯', V.goal ? V.goal[1] : 'Goal', parts.goal],
    ].filter(([, , v], k) => v || k < 2);
    setTimeout(() => {
      const box = $('tcTally'); if (!box || V.stage === 'build') return;
      box.innerHTML = `<b class="tc-tl-h">Tide ${V.tide} for you</b>${rows.map(([ic, nm, v]) => `<div><span>${ic} ${nm}</span><b>+${v}</b></div>`).join('')}<div class="tc-tl-sum"><span>Total</span><b>${res.pts}</b></div>`;
      box.hidden = false; box.classList.remove('tc-tally-in'); void box.offsetWidth; box.classList.add('tc-tally-in');
      if (parts.goal) { SN.fanfare(); pop(`🎯 Goal! +${parts.goal}`, 1500, 'tc-pop-goal'); } else SN.combo(2);
    }, 400 + spots.length * gap);
  }

  // ---------- sound: the sea, the sand and the gulls
  const snd = (fn) => window.Snd?.play((t, K) => fn(t, K, K.at({ room: 'outdoor', send: 0.4 })));
  const SN = {
    tool: () => snd((t, K, d) => { K.sweep(d, t, { f0: 900, f1: 1200, dur: 0.05, vol: 0.03, type: 'triangle' }); }),
    thud: (h) => snd((t, K, d) => { K.mode(d, t, 120 - 12 * h, 0.22, 0.09, { f1: 70 }); K.burst(d, t, { type: 'lowpass', f: 900, f1: 300, q: 0.7, vol: 0.2, tau: 0.05, buf: 'brown' }); K.burst(d, t + 0.03, { type: 'highpass', f: 3000, q: 0.5, vol: 0.04, tau: 0.08, dur: 0.15 }); }),
    scoop: () => snd((t, K, d) => { K.burst(d, t, { type: 'bandpass', f: 1500, f1: 600, q: 0.8, vol: 0.1, tau: 0.08, dur: 0.15 }); }),
    nope: () => snd((t, K, d) => { K.sweep(d, t, { f0: 300, f1: 220, dur: 0.12, vol: 0.05, type: 'square' }); }),
    flag: () => snd((t, K, d) => { K.sweep(d, t, { f0: 600, f1: 1400, dur: 0.18, vol: 0.06, type: 'triangle' }); K.burst(d, t + 0.05, { type: 'highpass', f: 2500, q: 0.5, vol: 0.05, tau: 0.1, dur: 0.2 }); }),
    combo: (n) => snd((t, K) => { const d = K.at({ room: 'outdoor', send: 0.6 }); [523, 659, 784, 1047].slice(0, Math.min(4, Math.max(2, n - 1))).forEach((f, k) => K.mode(d, t + k * 0.07, f, 0.08, 0.35, { type: 'triangle' })); }),
    tick: (k) => snd((t, K, d) => { K.mode(d, t, 660 * Math.pow(2, Math.min(k, 14) / 14), 0.05, 0.12, { type: 'triangle' }); }),
    fanfare: () => snd((t, K) => { const d = K.at({ room: 'outdoor', send: 0.7 }); [523, 659, 784, 1047, 784, 1047].forEach((f, k) => K.mode(d, t + k * 0.09, f, 0.09, k === 5 ? 0.6 : 0.2, { type: 'triangle' })); }),
    ready: () => snd((t, K, d) => { K.mode(d, t, 784, 0.07, 0.2, { type: 'triangle' }); K.mode(d, t + 0.08, 1175, 0.07, 0.3, { type: 'triangle' }); }),
    held: () => snd((t, K, d) => { K.mode(d, t, 180, 0.12, 0.12, { f1: 140 }); }),
    swell: () => snd((t, K, d) => { K.burst(d, t, { type: 'lowpass', f: 200, f1: 900, q: 0.5, vol: 0.28, tau: 0.6, dur: 1.4, attack: 1.0, buf: 'brown' }); }),
    wave: (big) => snd((t, K, d) => { K.burst(d, t, { type: 'lowpass', f: 300, f1: 1400, q: 0.5, vol: big ? 0.5 : 0.32, tau: 0.35, dur: 1.5, attack: 0.5, buf: 'brown' }); K.burst(d, t + 0.6, { type: 'highpass', f: 2500, q: 0.5, vol: 0.06, tau: 0.3, dur: 1.0 }); }),
    crumble: () => snd((t, K, d) => { for (let n = 0; n < 6; n++) K.burst(d, t + n * K.R(0.03, 0.06), { type: 'lowpass', f: K.R(400, 900), q: 0.8, vol: 0.12, tau: 0.03, buf: 'brown' }); }),
    keep: () => snd((t, K, d) => { K.mode(d, t, 70, 0.25, 0.12, { f1: 45 }); K.burst(d, t, { type: 'lowpass', f: 500, f1: 150, q: 0.7, vol: 0.45, tau: 0.2, dur: 0.8, buf: 'brown' }); }),
    gull: () => snd((t, K) => { const d = K.at({ room: 'outdoor', send: 0.5, pan: K.R(-0.8, 0.8), vol: 0.6 }); for (let k = 0; k < 2 + (Math.random() < 0.5); k++) K.sweep(d, t + k * 0.22, { f0: 1500, f1: 900, dur: 0.16, vol: 0.025, type: 'sawtooth', attack: 0.02 }); }),
  };
  const surfBed = (K, dst) => {
    const A = K.ctx, src = K.loopSrc('brown'), lp = A.createBiquadFilter(), g = A.createGain(), lfo = A.createOscillator(), lg = A.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 500; g.gain.value = 0; lfo.frequency.value = 0.12; lg.gain.value = 0.02; lfo.connect(lg).connect(g.gain); lfo.start();
    src.connect(lp).connect(g).connect(dst);
    return { set(l) { g.gain.setTargetAtTime(0.03 * l, A.currentTime, 0.8); }, stop() { try { src.stop(); lfo.stop(); } catch {} } };
  };

  let lastWave = -2, lastClock = 0;
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!V) return;
    const plots = shownPlots(now);
    (gl || flat)?.draw(now, plots);
    window.Snd?.bed('tide.surf', surfBed).set(S.phase === 'playing' ? 1 : 0);
    if (S.phase === 'playing' && now > nextGull) { if (nextGull) SN.gull(); nextGull = now + 9000 + Math.random() * 14000; }
    // a wave's moments: the swell out at sea, its roar as it comes in, crumbles and keeps falling, and what held
    const t = tideT(now), wt = G().waveT, nW = G().waves;
    const w = V.stage === 'tide' ? (t < 0 ? -1 : Math.floor(t / wt)) : V.stage === 'between' ? nW : -2;
    if (w !== lastWave) {
      const wb = $('tcWave');
      if (w === -1 && lastWave === -2) { SN.swell(); pop('🌊 Here comes the tide!', 1400, 'tc-pop-tide'); }
      if (w >= 0 && w < nW) {
        SN.wave(w === nW - 1);
        wb.hidden = false; wb.textContent = `${w === nW - 1 ? '🌊🌊 The big one' : `🌊 Wave ${w + 1} of ${nW}`} · 💪 ${V.waves[w]}`;
        wb.classList.toggle('big', w === nW - 1); wb.classList.remove('tc-wave-in'); void wb.offsetWidth; wb.classList.add('tc-wave-in');
        const mine = V.result?.[V.me]?.waves?.[w];
        if (w === nW - 1) gl?.shake(0.12);
        setTimeout(() => {
          if (!mine || V.stage !== 'tide') return;
          const worn = mine.hit.filter((h) => h[3]);
          if (worn.length) { SN.crumble(); gl?.shake(Math.min(0.2, 0.05 + 0.03 * worn.length)); ctx.buzz?.(20); }
          // pieces that took a hard hit and held
          const held = mine.hit.filter((h) => !h[3] && h[2] >= 3).slice(0, 3);
          held.forEach(([r, c], k) => setTimeout(() => floater(V.me, r, c, '💪', 'tc-fl-held', 0.9), k * 90));
          if (held.length) SN.held();
          const prev = w ? V.result[V.me].waves[w - 1].hp : G().keepHp;
          if (prev > 0 && mine.hp <= 0) { SN.keep(); ctx.buzz?.([80, 40, 120]); pop('💥 Your keep is washed away!', 2000, 'tc-pop-bad'); gl?.shake(0.25); }
          else if (mine.hp > 0 && mine.dmg > 0) { ctx.buzz?.(40); pop(`🏰 −${mine.dmg} strength · still standing +${G().wavePts}`, 1400); }
          else if (mine.hp > 0) floater(V.me, G().keepRow, V.plots[V.me]?.keep ?? 3, `🏰 +${G().wavePts}`, 'tc-fl-keep', 1.6);
        }, wt * 550);
      } else wb && (wb.hidden = true);
      lastWave = w;
      for (const el of document.querySelectorAll('#tcFore .tc-w')) el.classList.toggle('now', +el.dataset.k === w);
    }
    if (V.stage === 'between') tally();
    const left = Math.max(0, V.timeLeft - (now - gotAt) / 1000);
    $('tcClock').textContent = V.stage === 'build' && S.phase === 'playing' ? `⏱ ${Math.ceil(left)}s` : '';
    $('tcClock').classList.toggle('tc-hurry', V.stage === 'build' && left <= 10);
    const c = Math.ceil(left);
    if (V.stage === 'build' && c !== lastClock && c <= 5 && c > 0) ctx.sfx?.('tick');
    lastClock = c;
    $('tcAll').hidden = V.seats.length < 2;
  }

  // the build ghost and the squares the tool can go on (flag / keep): [{r, c, ok}] for my beach
  function ghostOf(now) {
    if (!building()) return null;
    const h = hover && now - hover.at < 6000 ? hover : null;
    return h ? { r: h.r, c: h.c, ok: canPlace(h.r, h.c, tool), tool } : null;
  }
  function targets() {
    if (!building() || (tool !== 'flag' && tool !== 'keep')) return [];
    const out = [];
    for (let r = 0; r < G().rows; r++) for (let c = 0; c < G().cols; c++) if (canPlace(r, c, tool) && !(tool === 'keep' && c === V.plots[V.me]?.keep)) out.push([r, c]);
    return out;
  }

  // ---------- three.js beaches
  function canvasTex(T, w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); if (g) draw(g, w, h);
    return new T.CanvasTexture(c);
  }
  const ease = (u) => { const s = 1.70158; u -= 1; return 1 + u * u * ((s + 1) * u + s); };   // ease-out-back: a little overshoot

  function make3d(stage) {
    const T = window.THREE;
    const renderer = GL3.renderer({}, { onLost: () => GL3.revive(stage, { build: () => { gl?.dispose(); gl = null; return (gl = make3d(stage)); }, flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }) });
    if (!renderer) return null;
    stage.prepend(renderer.domElement);
    const g0 = G(), C = g0.cols, R = g0.rows, n = V.seats.length, GAP = 1.6, PW = C + GAP;
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(40, 1, 0.3, 400);
    // #185: a sunny late afternoon: warm low sun over the sea, a blue sky going gold at the horizon
    const stg = GL3.stage(renderer, scene, {
      exposure: 1.0, hemi: [0xfff1d8, 0xe9c48a, 0.7],
      key: { i: 1.3, color: 0xffd49a, pos: [-9, 13, -5], area: Math.max(8, n * PW * 0.6), near: 2, far: 60 },
      sky: { top: 0x3d8fe6, horizon: 0xffd9a8, bottom: 0xfbe3b8, band: 0.12 },
      fog: [0xfbe0b6, 60, 170],
    });
    const low = stg.low;
    const ox = (i) => (i - (n - 1) / 2) * PW - C / 2 + 0.5;
    const oz = -R / 2 + 0.5;
    const cellPos = (i, r, c) => [ox(i) + c, oz + r];
    const disposables = [];
    const keepT = (x) => (disposables.push(x), x);
    // sand: bright and warm, with sparkly grains
    const sandTex = keepT(canvasTex(T, 128, 128, (g, w, h) => {
      g.fillStyle = '#f0cf92'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 2400; k++) { const v = Math.random(); g.fillStyle = v < 0.3 ? '#e4bf7e' : v < 0.6 ? '#f8e0b0' : v < 0.97 ? '#d9b06c' : '#ffffff'; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
    }));
    sandTex.wrapS = sandTex.wrapT = T.RepeatWrapping; sandTex.repeat.set(20, 8);
    const sandMat = new T.MeshStandardMaterial({ map: sandTex, roughness: 0.92, color: 0xffe2b8 });
    const gridTex = keepT(canvasTex(T, C * 32, R * 32, (g, w, h) => {
      g.fillStyle = '#f6dcaa'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 900; k++) { g.fillStyle = Math.random() < 0.5 ? '#ecca8e' : '#fbe9c4'; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
      g.strokeStyle = 'rgba(190,140,70,0.32)'; g.lineWidth = 1.5; g.setLineDash([5, 4]);
      for (let c = 1; c < C; c++) { g.beginPath(); g.moveTo(c * 32, 0); g.lineTo(c * 32, h); g.stroke(); }
      for (let r = 1; r < R; r++) { g.beginPath(); g.moveTo(0, r * 32); g.lineTo(w, r * 32); g.stroke(); }
      g.fillStyle = 'rgba(255,170,70,0.16)'; g.fillRect(0, (R - 1) * 32, w, 32);   // the back row, where the keep stands
    }));
    const beach = new T.Mesh(new T.PlaneGeometry(n * PW + 80, 60), sandMat); beach.rotation.x = -Math.PI / 2; beach.position.set(0, 0, oz - 0.5 + 30); beach.receiveShadow = true; scene.add(beach);
    // wet sand at the waterline
    const wetBand = new T.Mesh(new T.PlaneGeometry(n * PW + 80, 1.4), new T.MeshStandardMaterial({ color: 0xd9b57a, roughness: 0.35, metalness: 0.05 }));
    wetBand.rotation.x = -Math.PI / 2; wetBand.position.set(0, 0.003, oz - 1.0); wetBand.receiveShadow = true; scene.add(wetBand);
    for (let i = 0; i < n; i++) {
      const ring = new T.Mesh(new T.PlaneGeometry(C + 0.3, R + 0.3), new T.MeshBasicMaterial({ color: colorOf(i), transparent: true, opacity: 0.45, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(ox(i) + C / 2 - 0.5, 0.004, oz + R / 2 - 0.5); scene.add(ring);
      const inner = new T.Mesh(new T.PlaneGeometry(C, R), new T.MeshStandardMaterial({ map: gridTex, roughness: 0.9, color: 0xffffff }));
      inner.rotation.x = -Math.PI / 2; inner.position.set(ox(i) + C / 2 - 0.5, 0.006, oz + R / 2 - 0.5); inner.receiveShadow = true; scene.add(inner);
      const label = new T.Sprite(new T.SpriteMaterial({ map: keepT(canvasTex(T, 256, 64, (g, w, h) => { g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; const s = `${i === me() ? '★ ' : ''}${nameOf(i)}`.slice(0, 16), tw = Math.min(w - 8, g.measureText(s).width + 28); g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.roundRect ? g.roundRect((w - tw) / 2, 8, tw, h - 16, 24) : g.rect((w - tw) / 2, 8, tw, h - 16); g.fill(); g.fillStyle = colorOf(i); g.fillText(s, w / 2, h / 2 + 1); })), transparent: true, depthWrite: false }));
      label.position.set(ox(i) + C / 2 - 0.5, 0.3, oz + R + 0.4); label.scale.set(3.2, 0.8, 1); scene.add(label);
    }
    // the sea: turquoise in the shallows going deep blue, rippling, with lacy foam at the waterline
    const SW = n * PW + 120, seaGeo = new T.PlaneGeometry(SW, 60, low ? 30 : 60, low ? 10 : 18);
    {
      const pa = seaGeo.attributes.position, cols = [], cs = new T.Color(0x22b8c2), cd = new T.Color(0x0b55a8), cc = new T.Color();
      for (let k = 0; k < pa.count; k++) { const u = Math.min(1, (pa.getY(k) + 30) / 22); cc.copy(cs).lerp(cd, u); cols.push(cc.r, cc.g, cc.b); }
      seaGeo.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    }
    const seaMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0, transparent: true, opacity: 0.96 });
    const sea = new T.Mesh(seaGeo, seaMat); sea.rotation.x = -Math.PI / 2; sea.position.set(0, -0.05, oz - 0.5 - 30); scene.add(sea);
    const sp = seaGeo.attributes.position, base = Float32Array.from(sp.array);
    const foamTex = keepT(canvasTex(T, 256, 32, (g, w, h) => {
      g.fillStyle = 'rgba(255,255,255,0.0)'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 140; k++) { const x = Math.random() * w, y = h * (0.25 + Math.random() * 0.5), r = 2 + Math.random() * 6; g.fillStyle = `rgba(255,255,255,${0.5 + Math.random() * 0.5})`; g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill(); }
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(0, h * 0.42, w, h * 0.16);
    }));
    foamTex.wrapS = T.RepeatWrapping; foamTex.repeat.set(SW / 4, 1);
    const foam = new T.Mesh(new T.PlaneGeometry(SW, 0.7), new T.MeshBasicMaterial({ map: foamTex, transparent: true, opacity: 0.9, depthWrite: false }));
    foam.rotation.x = -Math.PI / 2; foam.position.set(0, 0.02, oz - 0.6); scene.add(foam);
    // the sun, clouds, a sailboat, gulls and sparkles on the water
    const sunTex = keepT(canvasTex(T, 128, 128, (g, w) => { const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,253,236,1)'); gr.addColorStop(0.2, 'rgba(255,224,130,1)'); gr.addColorStop(0.25, 'rgba(255,170,70,0.75)'); gr.addColorStop(0.5, 'rgba(255,160,70,0.25)'); gr.addColorStop(1, 'rgba(255,150,60,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); }));
    const sun = new T.Sprite(new T.SpriteMaterial({ map: sunTex, transparent: true, depthWrite: false, fog: false, toneMapped: false })); sun.scale.set(46, 46, 1); scene.add(sun);
    const cloudTex = keepT(canvasTex(T, 256, 96, (g, w, h) => { for (let k = 0; k < 9; k++) { const x = w * (0.18 + 0.64 * Math.random()), y = h * (0.45 + 0.2 * Math.random()), r = h * (0.18 + 0.2 * Math.random()); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.7, 'rgba(255,246,232,0.8)'); gr.addColorStop(1, 'rgba(255,240,220,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill(); } }));
    const clouds = [];
    for (let k = 0; k < (low ? 3 : 6); k++) { const cl = new T.Sprite(new T.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.92 })); const s = 30 + Math.random() * 30; cl.scale.set(s, s * 0.38, 1); cl.userData = { x: (Math.random() - 0.5) * 300, y: 16 + Math.random() * 22, z: -200 - Math.random() * 60, v: 0.6 + Math.random() * 0.8 }; scene.add(cl); clouds.push(cl); }
    const boat = new T.Group();
    { const hull = new T.Mesh(new T.BoxGeometry(2.2, 0.4, 0.7), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 })); hull.position.y = 0.2; boat.add(hull);
      const sail = new T.Mesh(new T.ConeGeometry(1, 2.8, 3), new T.MeshStandardMaterial({ color: 0xff7a59, roughness: 0.6 })); sail.scale.set(0.9, 1, 0.12); sail.position.set(0.1, 1.8, 0); boat.add(sail); }
    boat.position.set(-30, 0, oz - 34); scene.add(boat);
    const gulls = [], gullMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, side: T.DoubleSide }), tipMat = new T.MeshStandardMaterial({ color: 0x4a4f5a, side: T.DoubleSide });
    const wingGeo = new T.BufferGeometry(); wingGeo.setAttribute('position', new T.Float32BufferAttribute([0, 0, -0.12, 0, 0, 0.12, 0.7, 0, 0.05], 3)); wingGeo.computeVertexNormals();
    for (let k = 0; k < (low ? 1 : 3); k++) {
      const gg = new T.Group(), body = new T.Mesh(new T.SphereGeometry(0.1, 8, 6), gullMat); body.scale.set(1, 0.8, 2.2); gg.add(body);
      const wl = new T.Mesh(wingGeo, gullMat), wr = new T.Mesh(wingGeo, gullMat); wr.scale.x = -1; gg.add(wl, wr);
      const tl = new T.Mesh(new T.BoxGeometry(0.12, 0.01, 0.1), tipMat); tl.position.x = 0.62; wl.add(tl); const tr = tl.clone(); wr.add(tr);
      gg.userData = { wl, wr, R: 6 + k * 3, h: 7.5 + k * 1.2, sp: 0.22 + k * 0.06, ph: k * 2.1, cx: (k - 1) * 6 };
      scene.add(gg); gulls.push(gg);
    }
    const NSPK = low ? 0 : 70, spkPos = new Float32Array(Math.max(1, NSPK) * 3);
    const spkTex = keepT(canvasTex(T, 32, 32, (g, w) => { const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,250,220,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); g.fillStyle = '#fff'; g.fillRect(w / 2 - 0.5, 2, 1, w - 4); g.fillRect(2, w / 2 - 0.5, w - 4, 1); }));
    const spkGeo = new T.BufferGeometry(); spkGeo.setAttribute('position', new T.BufferAttribute(spkPos, 3));
    const spkMat = new T.PointsMaterial({ size: 0.45, map: spkTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.9 });
    const sparkles = new T.Points(spkGeo, spkMat); sparkles.frustumCulled = false; if (NSPK) scene.add(sparkles);
    const reSpark = (j) => { spkPos[j * 3] = (Math.random() - 0.5) * (n * PW + 30); spkPos[j * 3 + 1] = 0.08; spkPos[j * 3 + 2] = oz - 1.5 - Math.random() * 22; };
    for (let j = 0; j < NSPK; j++) reSpark(j);
    // beach things: umbrellas and towels at the sides, a bucket and spade, a beach ball, starfish on the wet sand
    const props = new T.Group(); scene.add(props);
    const stripes = (a, b, nS = 8) => keepT(canvasTex(T, 128, 16, (g, w, h) => { for (let k = 0; k < nS; k++) { g.fillStyle = k % 2 ? b : a; g.fillRect((k * w) / nS, 0, w / nS + 1, h); } }));
    function umbrella(x, z, a, b) {
      const u = new T.Group(), pole = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 2.0, 6), new T.MeshStandardMaterial({ color: 0xf5f5f5 })); pole.position.y = 1.0; u.add(pole);
      const top = new T.Mesh(new T.ConeGeometry(1.2, 0.5, 16, 1, true), new T.MeshStandardMaterial({ map: stripes(a, b), side: T.DoubleSide, roughness: 0.7 })); top.position.y = 2.0; top.castShadow = !low; u.add(top);
      const towel = new T.Mesh(new T.PlaneGeometry(0.9, 1.7), new T.MeshStandardMaterial({ map: stripes(b, '#ffffff', 6), roughness: 0.9 })); towel.rotation.x = -Math.PI / 2; towel.rotation.z = 0.3; towel.position.set(0.6, 0.012, 0.3); u.add(towel);
      u.position.set(x, 0, z); u.rotation.z = 0.08; props.add(u);
    }
    const left = ox(0) - 2.2, right = ox(n - 1) + C + 1.2;
    umbrella(left, oz + R - 1.5, '#ff5a5a', '#fff3e0'); umbrella(right, oz + 1.0, '#2bb3c0', '#ffe066');
    { const bucket = new T.Mesh(new T.CylinderGeometry(0.26, 0.2, 0.42, 14, 1, true), new T.MeshStandardMaterial({ color: 0xff8a2a, side: T.DoubleSide, roughness: 0.5 })); bucket.position.set(right - 0.4, 0.21, oz + R - 1.0); bucket.castShadow = !low; props.add(bucket);
      const spade = new T.Group(), sh = new T.Mesh(new T.CylinderGeometry(0.025, 0.025, 0.8, 6), new T.MeshStandardMaterial({ color: 0x3a8ee6 })), bl = new T.Mesh(new T.BoxGeometry(0.22, 0.02, 0.28), new T.MeshStandardMaterial({ color: 0x3a8ee6 })); sh.rotation.z = Math.PI / 2; sh.position.x = 0.4; spade.add(sh, bl); spade.position.set(right - 0.1, 0.03, oz + R - 0.3); spade.rotation.y = 0.6; props.add(spade);
      const ball = new T.Mesh(new T.SphereGeometry(0.3, 16, 12), new T.MeshStandardMaterial({ map: stripes('#ff4d6d', '#ffffff', 6), roughness: 0.4 })); ball.position.set(left + 0.9, 0.3, oz + 0.6); ball.rotation.set(0.4, 0, 0.8); ball.castShadow = !low; props.add(ball); }
    const starShape = new T.Shape(); for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2, rr = k % 2 ? 0.08 : 0.22; k ? starShape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : starShape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    const starGeo = new T.ExtrudeGeometry(starShape, { depth: 0.04, bevelEnabled: false });
    for (let k = 0; k < Math.max(3, n * 2); k++) { const st = new T.Mesh(starGeo, new T.MeshStandardMaterial({ color: k % 3 === 1 ? 0xff9f43 : k % 3 ? 0xff6b6b : 0xffc93c, roughness: 0.7 })); st.rotation.x = -Math.PI / 2; st.rotation.z = Math.random() * 6; st.position.set((Math.random() - 0.5) * (n * PW + 6), 0.01, oz - 0.95 - Math.random() * 0.3); props.add(st); }

    // the pieces: one group per plot, rebuilt when that plot changes (each square its own group, so it can pop in)
    const wallMat = new T.MeshStandardMaterial({ map: sandTex, color: 0xf3d293, roughness: 0.88 });
    const towerMat = new T.MeshStandardMaterial({ map: sandTex, color: 0xeec887, roughness: 0.88 });
    const moatMat = new T.MeshStandardMaterial({ color: 0xb98a4c, roughness: 1 });
    const waterMat = new T.MeshStandardMaterial({ color: 0x3fd0e0, roughness: 0.1, transparent: true, opacity: 0.88 });
    const shellMat = new T.MeshStandardMaterial({ color: 0xffb3c1, roughness: 0.4 });
    const weedMat = new T.MeshStandardMaterial({ color: 0x4fae5b, roughness: 0.8, side: T.DoubleSide });
    const poleMat = new T.MeshStandardMaterial({ color: 0x8a6a3a });
    const wallGeo = new T.BoxGeometry(0.9, 0.45, 0.9), crenGeo = new T.BoxGeometry(0.2, 0.16, 0.2), linkGeo = new T.BoxGeometry(0.3, 0.3, 0.55);
    const towerGeo = new T.CylinderGeometry(0.36, 0.44, 0.95, 14), towerTop = new T.CylinderGeometry(0.4, 0.36, 0.14, 14);
    const shellGeo = new T.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), moatGeo = new T.BoxGeometry(0.86, 0.04, 0.86);
    const bandGeo = new T.CylinderGeometry(0.41, 0.41, 0.05, 14), bandMat = new T.MeshStandardMaterial({ color: 0xd2a35e, roughness: 0.95 });
    const poleGeo = new T.CylinderGeometry(0.018, 0.018, 0.55, 6), flagGeo = new T.PlaneGeometry(0.34, 0.2), weedGeo = new T.PlaneGeometry(0.1, 0.32);
    const shared = new Set([wallGeo, crenGeo, linkGeo, towerGeo, towerTop, shellGeo, moatGeo, bandGeo, poleGeo, flagGeo, weedGeo, wallMat, towerMat, moatMat, waterMat, shellMat, bandMat, weedMat, poleMat]);
    const flagMats = V.seats.map((_, i) => new T.MeshStandardMaterial({ color: colorOf(i), side: T.DoubleSide, roughness: 0.6 }));
    flagMats.forEach((m) => shared.add(m));
    const plots3 = [];
    for (let i = 0; i < n; i++) { const grp = new T.Group(); scene.add(grp); plots3.push({ grp, key: '', prev: null, born: new Map(), flags: [] }); }
    function keepModel(col) {
      const k = new T.Group();
      const body = new T.Mesh(new T.CylinderGeometry(0.42, 0.48, 0.8, 16), towerMat); body.position.y = 0.4; body.castShadow = !low; k.add(body);
      for (let t = 0; t < 4; t++) { const a = t * Math.PI / 2 + Math.PI / 4, tw = new T.Mesh(new T.CylinderGeometry(0.13, 0.15, 1.15, 10), towerMat); tw.position.set(Math.cos(a) * 0.38, 0.57, Math.sin(a) * 0.38); tw.castShadow = !low; k.add(tw);
        const cap = new T.Mesh(new T.ConeGeometry(0.17, 0.3, 10), new T.MeshStandardMaterial({ color: col, roughness: 0.6 })); cap.position.set(Math.cos(a) * 0.38, 1.29, Math.sin(a) * 0.38); k.add(cap); }
      const pole = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 0.7, 6), poleMat); pole.position.y = 1.15; k.add(pole);
      const flag = new T.Mesh(new T.PlaneGeometry(0.4, 0.24), new T.MeshStandardMaterial({ color: col, side: T.DoubleSide })); flag.position.set(0.2, 1.38, 0); k.add(flag);
      k.userData.flag = flag;
      return k;
    }
    function rebuild(i, p, now) {
      const o = plots3[i];
      const key = p ? JSON.stringify([p.g, p.keep, [...(p.filled || [])], [...(p.flags || [])], p.fallen, p.hp, V.stage === 'build' ? V.placed : 0]) : 'none';
      if (key === o.key) return;
      o.key = key;
      // what's new or taller since the last look pops in (only while building: in a tide pieces only wear)
      if (p && o.prev && V.stage === 'build') for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const a = o.prev.g[r][c], b = p.g[r][c], k = `${r},${c}`;
        if ((b && (!a || a[0] !== b[0] || a[1] < b[1])) || (p.flags?.has(k) && !o.prev.flags?.has(k))) o.born.set(k, now);
      }
      o.prev = p ? { g: p.g.map((row) => row.map((x) => (x ? [...x] : null))), flags: new Set(p.flags || []) } : null;
      for (const ch of [...o.grp.children]) {
        o.grp.remove(ch);
        ch.traverse((m) => { if (m.geometry && !shared.has(m.geometry)) m.geometry.dispose(); if (m.material && !shared.has(m.material)) { m.material.map?.dispose(); m.material.dispose(); } });
      }
      o.flags = []; o.cells = [];
      if (!p) {   // a beach still being built: a striped beach towel over it
        const tarp = new T.Mesh(new T.BoxGeometry(C - 0.2, 0.18, R - 0.2), new T.MeshStandardMaterial({ map: stripes(colorOf(i), '#fff6e6', 10), roughness: 0.85 }));
        tarp.position.set(ox(i) + C / 2 - 0.5, 0.09, oz + R / 2 - 0.5); o.grp.add(tarp);
        return;
      }
      const br = bracedSet(p.g), old = V.stage === 'build' && i === me() ? new Set((V.placed || []).map(([r, c]) => `${r},${c}`)) : null;
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const cell = p.g[r][c], [x, z] = cellPos(i, r, c), k = `${r},${c}`;
        if (!cell) continue;
        const [kind, h] = cell, cg = new T.Group(); cg.position.set(x, 0, z); cg.userData.k = k; o.grp.add(cg); o.cells.push(cg);
        if (kind === 'wall' || (kind === 'tower' && h === 1)) {
          const m = new T.Mesh(wallGeo, wallMat); m.position.y = 0.225; m.castShadow = !low; m.receiveShadow = true; cg.add(m);
          for (const [dx, dz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) { const cr = new T.Mesh(crenGeo, wallMat); cr.position.set(dx, 0.53, dz); cg.add(cr); }
        } else if (kind === 'tower') {
          const m = new T.Mesh(towerGeo, towerMat); m.scale.y = h / 2; m.position.y = 0.2375 * h; m.castShadow = !low; cg.add(m);
          const tp = new T.Mesh(towerTop, towerMat); tp.position.y = 0.475 * h + 0.05; cg.add(tp);
          for (let lv = 1; lv < h; lv++) { const band = new T.Mesh(bandGeo, bandMat); band.position.y = 0.475 * lv; cg.add(band); }
        } else if (kind === 'moat') {
          const m = new T.Mesh(moatGeo, p.filled?.has(k) ? waterMat : moatMat); m.position.y = 0.012; cg.add(m);
        } else if (kind === 'shell') {
          const m = new T.Mesh(shellGeo, shellMat); m.scale.set(1, 0.6, 1.1); m.position.y = 0.01; m.rotation.y = (r * 7 + c) % 6; cg.add(m);
        }
        // a rampart: the pieces joined by a sand walkway to the next one along
        if (br.has(k) && br.has(`${r},${c + 1}`)) { const ln = new T.Mesh(linkGeo, wallMat); ln.position.set(0.5, 0.3, 0); ln.rotation.y = Math.PI / 2; cg.add(ln); }
        if (p.flags?.has(k) && kind === 'tower') {
          const top = 0.475 * h + 0.12, pl = new T.Mesh(poleGeo, poleMat); pl.position.y = top + 0.27; cg.add(pl);
          const fl = new T.Mesh(flagGeo, flagMats[i]); fl.position.set(0.17, top + 0.44, 0); cg.add(fl); o.flags.push(fl);
        }
        // a piece that has stood through a tide wears a strand of seaweed and a little shell
        if (old && HT(kind) && !old.has(k)) {
          const wd = new T.Mesh(weedGeo, weedMat); wd.position.set(-0.3, 0.2, 0.46); wd.rotation.z = 0.3; cg.add(wd);
          const sh = new T.Mesh(shellGeo, shellMat); sh.scale.setScalar(0.35); sh.position.set(0.28, 0.32, 0.46); sh.rotation.x = Math.PI / 2; cg.add(sh);
        }
      }
      const [kx, kz] = cellPos(i, g0.keepRow, p.keep);
      if (p.fallen && !o.fallen) o.fallAt = performance.now();
      o.fallen = p.fallen;
      const kp = keepModel(colorOf(i)); kp.position.x += kx; kp.position.z += kz; kp.userData.k = `${g0.keepRow},${p.keep}`; o.grp.add(kp); o.keep = kp; o.cells.push(kp);
      const hpMax = g0.keepHp ?? 10, hp = p.hp ?? hpMax;
      if (hp < hpMax && !p.fallen) {
        const bar = new T.Sprite(new T.SpriteMaterial({ map: canvasTex(T, 128, 24, (g, w, h) => { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, w, h); g.fillStyle = hp > hpMax / 2 ? '#5fd35f' : hp > hpMax / 4 ? '#ffc23d' : '#ff5a4a'; g.fillRect(3, 3, (w - 6) * hp / hpMax, h - 6); }), transparent: true, depthWrite: false }));
        bar.position.set(kx, 1.9, kz); bar.scale.set(0.9, 0.17, 1); o.grp.add(bar);
      }
    }
    // water: one translucent tile per wet square, fading in as the wave reaches it and out as it drains
    const wetMat = new T.MeshBasicMaterial({ color: 0x7fe3f0, transparent: true, opacity: 0.62, depthWrite: false });
    const NW = n * C * R, wetMesh = new T.InstancedMesh(new T.BoxGeometry(1, 0.08, 1), wetMat, NW); wetMesh.frustumCulled = false; scene.add(wetMesh);
    const m4 = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3();
    // spray (white), sand (gold) and sparkles (gold stars): one point pool each
    function pool(N, size, color, grav, extra = {}) {
      const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), life = new Float32Array(N), geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      const pts = new T.Points(geo, new T.PointsMaterial({ size, color, transparent: true, depthWrite: false, ...extra })); pts.frustumCulled = false; scene.add(pts);
      for (let k = 0; k < N; k++) pos[k * 3 + 1] = -99;
      let next = 0;
      return {
        emit(x, y, z, vx, vy, vz, l) { const j = next; next = (next + 1) % N; pos[j * 3] = x; pos[j * 3 + 1] = y; pos[j * 3 + 2] = z; vel[j * 3] = vx; vel[j * 3 + 1] = vy; vel[j * 3 + 2] = vz; life[j] = l; },
        step(dt) { for (let j = 0; j < N; j++) { if (life[j] <= 0) continue; life[j] -= dt; if (life[j] <= 0 || pos[j * 3 + 1] < -0.05) { life[j] = 0; pos[j * 3 + 1] = -99; continue; } vel[j * 3 + 1] -= grav * dt; pos[j * 3] += vel[j * 3] * dt; pos[j * 3 + 1] += vel[j * 3 + 1] * dt; pos[j * 3 + 2] += vel[j * 3 + 2] * dt; } geo.attributes.position.needsUpdate = true; },
      };
    }
    const spray = pool(300, 0.13, 0xffffff, 9), sandP = pool(240, 0.1, 0xe9c27d, 8), stars = pool(80, 0.35, 0xffe27a, -0.6, { map: spkTex, blending: T.AdditiveBlending });
    const cut = (nn) => (calm() ? Math.ceil(nn / 3) : nn);
    function splash(x, z, nn) { for (let k = 0; k < cut(nn); k++) { const a = Math.random() * 6.283; spray.emit(x, 0.4, z, Math.cos(a) * 1.5, 2 + Math.random() * 2.4, Math.sin(a) * 1.5 - 1, 0.5 + Math.random() * 0.4); } }
    function crumble(x, z, nn, y = 0.2) { for (let k = 0; k < cut(nn); k++) { const a = Math.random() * 6.283; sandP.emit(x + (Math.random() - 0.5) * 0.6, y + Math.random() * 0.6, z + (Math.random() - 0.5) * 0.6, Math.cos(a) * 0.9, 0.5 + Math.random() * 1.5, Math.sin(a) * 0.9 + 0.5, 0.6 + Math.random() * 0.4); } }
    function puffAt(x, z, nn) { for (let k = 0; k < cut(nn); k++) { const a = Math.random() * 6.283, s = 0.8 + Math.random() * 1.2; sandP.emit(x + Math.cos(a) * 0.35, 0.05, z + Math.sin(a) * 0.35, Math.cos(a) * s, 0.8 + Math.random() * 1.2, Math.sin(a) * s, 0.35 + Math.random() * 0.25); } }
    // chunks of sand that break off what a wave wears down
    const NCH = low ? 40 : 90, chunkMesh = new T.InstancedMesh(new T.BoxGeometry(0.16, 0.12, 0.16), wallMat, NCH); chunkMesh.frustumCulled = false; chunkMesh.castShadow = false; scene.add(chunkMesh);
    const ch = Array.from({ length: NCH }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, s: 1 })); let chNext = 0;
    function chunks(x, z, y0, nn) { for (let k = 0; k < cut(nn); k++) { const o = ch[chNext]; chNext = (chNext + 1) % NCH; Object.assign(o, { life: 1.2 + Math.random() * 0.5, x: x + (Math.random() - 0.5) * 0.5, y: y0 + Math.random() * 0.3, z: z + (Math.random() - 0.5) * 0.5, vx: (Math.random() - 0.5) * 2, vy: 1 + Math.random() * 2, vz: 0.8 + Math.random() * 1.6, rx: Math.random() * 6, s: 0.6 + Math.random() * 0.8 }); } }
    const splashed = new Set(), crumbled = new Set();
    const crestMat = new T.MeshStandardMaterial({ color: 0xf2fdff, roughness: 0.25, transparent: true, opacity: 0.9, emissive: 0x7fdcf0, emissiveIntensity: 0.3 });
    const crests = []; for (let i = 0; i < n; i++) { const m = new T.Mesh(new T.CylinderGeometry(0.22, 0.32, C + 0.6, 16, 1), crestMat); m.rotation.z = Math.PI / 2; m.visible = false; scene.add(m); crests.push(m); }
    const dampMat = new T.MeshBasicMaterial({ color: 0xb08850, transparent: true, opacity: 0.16, depthWrite: false });
    const damp = new T.InstancedMesh(new T.PlaneGeometry(1, 1), dampMat, NW); damp.frustumCulled = false; scene.add(damp);
    const flatQ = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -Math.PI / 2);
    const curMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false });
    const cur = new T.Mesh(new T.RingGeometry(0.42, 0.5, 4, 1, Math.PI / 4), curMat); cur.rotation.x = -Math.PI / 2; cur.visible = false; scene.add(cur);
    const testMat = new T.MeshBasicMaterial({ color: 0x2a9bd8, transparent: true, opacity: 0.4, depthWrite: false });
    const testMesh = new T.InstancedMesh(new T.PlaneGeometry(0.92, 0.92), testMat, C * R); testMesh.frustumCulled = false; scene.add(testMesh);
    const testKeep = new T.Mesh(new T.RingGeometry(0.5, 0.62, 32), new T.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: 0.85, depthWrite: false })); testKeep.rotation.x = -Math.PI / 2; testKeep.visible = false; scene.add(testKeep);
    // where the tool can go (flag / keep): soft gold squares; and the ghost of the piece under the pointer
    const okMat = new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.35, depthWrite: false });
    const okMesh = new T.InstancedMesh(new T.PlaneGeometry(0.86, 0.86), okMat, C * R); okMesh.frustumCulled = false; scene.add(okMesh);
    const ghostMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false });
    const ghosts = { wall: new T.Mesh(wallGeo, ghostMat), tower: new T.Mesh(towerGeo, ghostMat), moat: new T.Mesh(moatGeo, ghostMat), shell: new T.Mesh(shellGeo, ghostMat), flag: new T.Mesh(flagGeo, ghostMat), keep: new T.Mesh(new T.CylinderGeometry(0.42, 0.48, 0.8, 16), ghostMat) };
    for (const m of Object.values(ghosts)) { m.visible = false; scene.add(m); }
    const raycaster = new T.Raycaster(), ground = new T.Plane(new T.Vector3(0, 1, 0), 0), v2 = new T.Vector2(), hitP = new T.Vector3(), pv = new T.Vector3();

    let aspect = 1, camX = 0, camD = 14, lastDraw = 0, lastSea = 0, tilt = 0;
    let sw = 0, sh = 0;
    function resize() { const w = stage.clientWidth || 320, h = stage.clientHeight || 300; sw = stage.clientWidth; sh = stage.clientHeight; renderer.setSize(w, h); camera.aspect = aspect = w / h; camera.updateProjectionMatrix(); }
    function draw(now, plots) {
      // (#184: the stage grows when the game goes full-focus; a missed ResizeObserver left the picture stretched
      // and taps landing on the wrong squares)
      if (stage.clientWidth !== sw || stage.clientHeight !== sh) resize();
      const dt = Math.min(0.1, (now - lastDraw) / 1000); lastDraw = now;
      const mi = me() ?? 0, wide = all || me() == null, tv = Math.tan((camera.fov * Math.PI) / 360);
      const halfW = wide ? (n * PW) / 2 + 0.5 : C / 2 + 1.1;
      const tx = wide ? 0 : ox(mi) + C / 2 - 0.5;
      const td = Math.max(halfW / (tv * aspect), (R * 0.9) / tv);
      camX += (tx - camX) * Math.min(1, dt * 4); camD += (td - camD) * Math.min(1, dt * 4);
      // building: steep over the beach; the tide: lower, looking out to sea (the horizon, the sun, the swell coming in)
      const tt = V.stage === 'tide' || V.stage === 'between' ? 1 : 0;
      tilt += (tt - tilt) * Math.min(1, dt * 2.2);
      camera.position.set(camX, camD * (0.8 - 0.42 * tilt), camD * (0.62 + 0.28 * tilt) + 1.5); camera.lookAt(camX, 0, 0.2 - 4 * tilt);
      GL3.tickShake(camera, dt); stg.follow(camera);
      // the tide view sees only a strip of sky over the sea's far edge: the sun sits low in it, right of the wave chips
      sun.position.set(camera.position.x + 36, 9 - 11 * tilt, -210);
      for (const cl of clouds) { const u = cl.userData; u.x += u.v * dt; if (u.x > 170) u.x = -170; cl.position.set(camera.position.x + u.x, u.y, u.z); }
      boat.position.x = -30 + ((now / 1000) * 0.5) % 60; boat.position.y = Math.sin(now / 700) * 0.06; boat.rotation.z = Math.sin(now / 900) * 0.05;
      for (const gg of gulls) { const u = gg.userData, a = now / 1000 * u.sp + u.ph; gg.position.set(camX + u.cx + Math.cos(a) * u.R, u.h + Math.sin(a * 2) * 0.4, oz - 18 + Math.sin(a) * u.R * 0.5); gg.rotation.y = -a; gg.rotation.z = 0.25; const fl = Math.sin(now / 110 + u.ph) * 0.5; u.wl.rotation.z = fl; u.wr.rotation.z = -fl; }
      const pieceNow = performance.now();
      for (let i = 0; i < n; i++) {
        rebuild(i, plots[i], pieceNow);
        const o = plots3[i];
        // new pieces pop in: squash up out of the sand with a little overshoot
        if (o.born.size) for (const cg of o.cells || []) {
          const b = o.born.get(cg.userData.k); if (b == null) continue;
          const u = Math.min(1, (pieceNow - b) / 320);
          cg.scale.set(0.6 + 0.4 * ease(u), ease(u), 0.6 + 0.4 * ease(u));
          if (u >= 1) { o.born.delete(cg.userData.k); cg.scale.set(1, 1, 1); }
        }
        for (const fl of o.flags) fl.rotation.y = Math.sin(now / 260 + fl.position.y * 3) * 0.35;
        if (o.keep) {
          o.keep.userData.flag.rotation.y = Math.sin(now / 300) * 0.3;
          const u = o.fallen ? Math.min(1, (now - (o.fallAt || 0)) / 700) : 0, e = u * u * (3 - 2 * u);
          o.keep.rotation.z = 1.2 * e; o.keep.scale.set(1, 1 - 0.5 * e, 1); o.keep.position.y = -0.1 * e;
          if (o.fallen && u < 1 && u > 0.3 && !o.dusted) { o.dusted = true; crumble(o.keep.position.x, o.keep.position.z, 26); chunks(o.keep.position.x, o.keep.position.z, 0.6, 12); }
          if (!o.fallen) o.dusted = false;
        }
      }
      // the sea swells (and heaves while the tide's swell builds and each wave comes in)
      const t = tideT(now), wt = g0.waveT, w = V.stage === 'tide' ? (t < 0 ? -1 : Math.floor(t / wt)) : -2;
      const el = w >= 0 && w < g0.waves ? t - w * wt : w === -1 ? t : 99;
      const surge = w >= 0 && w < g0.waves ? Math.sin(Math.min(1, (el / wt) * 1.6) * Math.PI) : w === -1 ? 0.5 + 0.5 * Math.sin((1 + t / lead()) * Math.PI / 2) : 0;
      if (!low || now - lastSea > 66) {
        lastSea = now;
        for (let k = 0; k < sp.count; k++) {
          const x = base[k * 3], y = base[k * 3 + 1];
          sp.setZ(k, Math.sin(x * 0.6 + now / 600) * 0.06 + Math.sin(y * 0.9 + now / 800) * 0.05 + Math.sin(x * 0.23 - y * 0.4 + now / 1100) * 0.05 + (y > 15 ? surge * 0.2 : 0));
        }
        sp.needsUpdate = true; seaGeo.computeVertexNormals();
      }
      foam.position.z = oz - 0.6 + Math.sin(now / 1300) * 0.15 + surge * 0.4; foamTex.offset.x = (now / 9000) % 1; foam.material.opacity = 0.75 + 0.25 * surge;
      if (NSPK) { for (let k = 0; k < 4; k++) reSpark((Math.random() * NSPK) | 0); spkGeo.attributes.position.needsUpdate = true; spkMat.opacity = 0.65 + 0.3 * Math.sin(now / 170); }
      // wet squares of the current wave
      let k = 0;
      if (w >= 0 && w < g0.waves && V.result) {
        const F = V.waves[w];
        for (let i = 0; i < n; i++) {
          const res = V.result[i]; if (!res) continue;
          const wave = res.waves[w];
          for (const [r, c, fo] of wave.wet) {
            const life = el - IN - (F - fo) * STEP;
            if (life < 0) continue;
            const a = Math.min(1, life / 0.2) * Math.max(0, 1 - Math.max(0, el - 1.6) / 0.6);
            if (a <= 0.01) continue;
            const [x, z] = cellPos(i, r, c);
            ps.set(x, 0.03, z); wetMesh.setMatrixAt(k++, m4.compose(ps, q, sc.set(a, 1, a)));
          }
          for (const [r, c, fo] of wave.hit) {
            const key = `${V.tide}:${w}:${i}:${r}:${c}`;
            if (el >= IN + (F - fo) * STEP && !splashed.has(key)) { splashed.add(key); const [x, z] = cellPos(i, r, c); splash(x, z - 0.4, 6 + Math.min(10, fo)); }
          }
        }
      }
      wetMesh.count = k; wetMesh.instanceMatrix.needsUpdate = true;
      // the crests: out at sea while the swell builds, then rolling in and up each beach; worn pieces break up
      for (let i = 0; i < n; i++) {
        const res = V.result?.[i], cm = crests[i], wv = w >= 0 && w < g0.waves ? res?.waves?.[w] : w === -1 && res ? res.waves[0] : null;
        if (!wv) { cm.visible = false; continue; }
        const reach = wv.wet.reduce((m, qq) => Math.max(m, qq[0]), 0);
        let row, fade = 1, big = 1;
        if (el < IN) { row = -0.5 - Math.min(14, 7 * (IN - el) / IN); big = 1.5 - Math.min(0.6, (IN - el) * 0.3); }
        else { const e2 = el - IN; row = Math.min(reach, e2 / STEP - 0.5); const stopAt = (reach + 0.5) * STEP; fade = Math.max(0, 1 - Math.max(0, e2 - stopAt) / 0.35); big = 1 + 0.6 * Math.max(0, 1 - e2 / 0.3); }
        cm.visible = fade > 0.02; cm.position.set(ox(i) + C / 2 - 0.5, (0.12 + 0.1 * (big - 1)) * fade + 0.06 * Math.sin(el * 6), oz + row - 0.2);
        cm.scale.set(fade * big, 1, (0.6 + 0.4 * fade) * big); crestMat.opacity = 0.92 * fade;
        if (w < 0) continue;
        for (const [r, c, fo, worn] of wv.hit) {
          const key = `${V.tide}:${w}:${i}:${r}:${c}`;
          if (worn && el / wt >= 0.55 && !crumbled.has(key)) { crumbled.add(key); const [x, z] = cellPos(i, r, c), hh = (plots[i]?.g[r][c]?.[1] ?? 0) + worn; crumble(x, z, 8 + 6 * worn, 0.2 + 0.3 * hh); chunks(x, z, 0.25 * hh + 0.2, 4 + 2 * hh); }
        }
      }
      // damp sand where the tide has been (until the next build)
      let nd = 0;
      if (V.stage === 'tide' || V.stage === 'between') for (let i = 0; i < n; i++) for (const key of plots[i]?.wet || []) { const [r, c] = key.split(',').map(Number), [x, z] = cellPos(i, r, c); ps.set(x, 0.008, z); damp.setMatrixAt(nd++, m4.compose(ps, flatQ, sc.set(1, 1, 1))); }
      damp.count = nd; damp.instanceMatrix.needsUpdate = true;
      spray.step(dt); sandP.step(dt); stars.step(dt);
      let nc = 0;
      for (const o of ch) {
        if (o.life <= 0) continue;
        o.life -= dt; o.vy -= 9 * dt; o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt; o.rx += dt * 5;
        if (o.y < 0.05) { o.y = 0.05; o.vy *= -0.25; o.vx *= 0.6; o.vz *= 0.6; }
        const s = o.s * Math.min(1, o.life / 0.4);
        if (s <= 0.02) { o.life = 0; continue; }
        ps.set(o.x, o.y, o.z); q.setFromAxisAngle(pv.set(1, 0.4, 0.2).normalize(), o.rx); chunkMesh.setMatrixAt(nc++, m4.compose(ps, q, sc.set(s, s, s)));
      }
      q.identity();
      chunkMesh.count = nc; chunkMesh.instanceMatrix.needsUpdate = true;
      // the cursor, the ghost, the targets and the test wave
      const mineI = me(), bld = building();
      cur.visible = bld && !!cursor && now - cursor.at < 1500;
      if (cur.visible) { const [x, z] = cellPos(mineI, cursor.r, cursor.c); cur.position.set(x, 0.02, z); curMat.opacity = 0.9 * (1 - (now - cursor.at) / 1500); }
      for (const m of Object.values(ghosts)) m.visible = false;
      const gh = ghostOf(now);
      if (gh && plots[mineI]) {
        const m = ghosts[gh.tool], [x, z] = cellPos(mineI, gh.r, gh.c), cell = plots[mineI].g[gh.r][gh.c], h = gh.tool === 'tower' ? (cell && HT(cell[0]) ? cell[1] + 1 : 2) : 1;
        m.visible = true; m.scale.set(1, gh.tool === 'tower' ? h / 2 : 1, 1); m.rotation.set(0, 0, 0);
        const y = { wall: 0.225, tower: 0.2375 * h, moat: 0.03, shell: 0.02, flag: 0.475 * (cell?.[1] || 2) + 0.55, keep: 0.4 }[gh.tool];
        m.position.set(gh.tool === 'flag' ? x + 0.17 : x, y, z);
        ghostMat.color.setHex(gh.ok ? 0xffffff : 0xff5a4a); ghostMat.opacity = 0.35 + 0.15 * Math.sin(now / 160);
      }
      let no = 0;
      for (const [r, c] of targets()) { const [x, z] = cellPos(mineI, r, c); ps.set(x, 0.012, z); okMesh.setMatrixAt(no++, m4.compose(ps, flatQ, sc.set(1, 1, 1))); }
      okMesh.count = no; okMesh.instanceMatrix.needsUpdate = true; okMat.opacity = 0.25 + 0.15 * Math.sin(now / 250);
      let nt = 0;
      testKeep.visible = false;
      if (bld && test && plots[mineI]) {
        const tw = testWave(plots[mineI]);
        for (const [r, c] of tw.wet) { const [x, z] = cellPos(mineI, r, c); ps.set(x, 0.015, z); testMesh.setMatrixAt(nt++, m4.compose(ps, flatQ, sc.set(1, 1, 1))); }
        testMat.opacity = 0.32 + 0.12 * Math.sin(now / 300);
        if (tw.dmg > 0) { const [x, z] = cellPos(mineI, g0.keepRow, plots[mineI].keep); testKeep.position.set(x, 0.02, z); testKeep.visible = true; }
      }
      testMesh.count = nt; testMesh.instanceMatrix.needsUpdate = true;
      renderer.render(scene, camera);
    }
    function pick(cx, cy) {
      if (me() == null) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      v2.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(v2, camera);
      if (!raycaster.ray.intersectPlane(ground, hitP)) return null;
      const c = Math.round(hitP.x - ox(me())), r = Math.round(hitP.z - oz);
      return r >= 0 && r < R && c >= 0 && c < C ? [r, c] : null;
    }
    function toScreen(i, r, c, y = 0.6) {
      const [x, z] = cellPos(i, r, c), v = pv.set(x, y, z).project(camera), rc = renderer.domElement.getBoundingClientRect(), sr = stage.getBoundingClientRect();
      if (v.z > 1) return null;
      return [(v.x + 1) / 2 * rc.width + rc.left - sr.left, (1 - v.y) / 2 * rc.height + rc.top - sr.top];
    }
    const puff = (r, c, nn) => { if (me() == null) return; const [x, z] = cellPos(me(), r, c); puffAt(x, z, nn); };
    const sparkle = (i, r, c) => { const [x, z] = cellPos(i, r, c); for (let k = 0; k < cut(6); k++) stars.emit(x + (Math.random() - 0.5) * 0.5, 0.6 + Math.random() * 0.6, z + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.6, (Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.4); };
    const shake = (a) => GL3.shake(camera, a);
    function dispose() { stg.dispose(); for (const t of disposables) t.dispose?.(); renderer.dispose(); renderer.domElement.remove(); }
    resize();
    return { draw, resize, dispose, pick, shake, toScreen, puff, sparkle };
  }

  // ---------- flat fallback: my beach (or all of them) from above, a sunny sky and the sea at the top
  function make2d(stage) {
    const canvas = document.createElement('canvas'); stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { stage.append('Your browser cannot draw this game.'); return null; }
    let lay = null;
    const born = new Map(), puffs = [];
    let prev = null;
    let sw = 0, sh = 0;
    function resize() { sw = stage.clientWidth; sh = stage.clientHeight; const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.round((stage.clientWidth || 320) * dpr); canvas.height = Math.round((stage.clientHeight || 300) * dpr); canvas.style.width = '100%'; canvas.style.height = '100%'; }
    const ICON = { wall: '🧱', tower: '🗼', moat: '🕳️', shell: '🐚' };
    function draw(now, plots) {
      if (!canvas.width || stage.clientWidth !== sw || stage.clientHeight !== sh) resize();
      const g0 = G(), W = canvas.width, H = canvas.height, wide = all || me() == null;
      const list = wide ? V.seats.map((_, i) => i) : [me()];
      const cols = list.length * (g0.cols + 1) - 1, k = Math.min(W / (cols + 0.4), (H - 40) / (g0.rows + 2.2));
      const x0 = (W - cols * k) / 2, y0 = 2.0 * k, seaY = y0 - 0.15 * k, skyH = seaY * 0.42;
      lay = { k, x0, y0, list };
      // sky, sun, sea, foam, sand
      const sky = g.createLinearGradient(0, 0, 0, skyH); sky.addColorStop(0, '#5aa8f0'); sky.addColorStop(1, '#ffd9a8'); g.fillStyle = sky; g.fillRect(0, 0, W, skyH);
      const sx = W * 0.78, sr = skyH * 0.55, sg = g.createRadialGradient(sx, skyH * 0.75, 0, sx, skyH * 0.75, sr * 2); sg.addColorStop(0, 'rgba(255,250,220,1)'); sg.addColorStop(0.3, 'rgba(255,225,140,0.9)'); sg.addColorStop(1, 'rgba(255,200,120,0)'); g.fillStyle = sg; g.fillRect(0, 0, W, skyH);
      g.fillStyle = 'rgba(255,255,255,0.9)'; for (let cI = 0; cI < 3; cI++) { const cx = ((now / 60 + cI * W * 0.4) % (W + 200)) - 100, cy = skyH * (0.3 + 0.15 * cI); for (const [dx, dy, rr] of [[0, 0, 1], [0.8, -0.3, 0.8], [1.5, 0.1, 0.7], [-0.7, 0.1, 0.7]]) { g.beginPath(); g.arc(cx + dx * skyH * 0.18, cy + dy * skyH * 0.18, rr * skyH * 0.16, 0, 6.3); g.fill(); } }
      const seaG = g.createLinearGradient(0, skyH, 0, seaY); seaG.addColorStop(0, '#1a78c8'); seaG.addColorStop(1, '#4fd8cf'); g.fillStyle = seaG; g.fillRect(0, skyH, W, seaY - skyH);
      g.fillStyle = 'rgba(255,255,255,0.8)'; for (let j = 0; j < 18; j++) { const x = (j * 97.3 + now / 20) % W, y = skyH + ((j * 53.1) % (seaY - skyH)); if (Math.sin(now / 200 + j) > 0.4) g.fillRect(x, y, 2 + k * 0.04, 2 + k * 0.04); }
      g.fillStyle = '#f9e5b8'; g.fillRect(0, seaY, W, H - seaY);
      const t = tideT(now), wt = g0.waveT, w = V.stage === 'tide' ? (t < 0 ? -1 : Math.floor(t / wt)) : -2, el = w >= 0 && w < g0.waves ? t - w * wt : 99;
      const fy = seaY + Math.sin(now / 1300) * k * 0.08;
      g.fillStyle = '#ffffff'; for (let x = -((now / 40) % (k * 0.5)); x < W; x += k * 0.5) { g.beginPath(); g.arc(x, fy, k * 0.18, 0, Math.PI); g.fill(); }
      list.forEach((i, li) => {
        const px = x0 + li * (g0.cols + 1) * k, p = plots[i];
        g.strokeStyle = colorOf(i); g.lineWidth = 3; g.strokeRect(px - 2, y0 - 2, g0.cols * k + 4, g0.rows * k + 4);
        if (!p) { for (let s = 0; s < 10; s++) { g.fillStyle = s % 2 ? '#fff6e6cc' : colorOf(i) + 'aa'; g.fillRect(px + (s * g0.cols * k) / 10, y0, (g0.cols * k) / 10 + 1, g0.rows * k); } return; }
        g.fillStyle = 'rgba(255,170,70,0.12)'; g.fillRect(px, y0 + g0.keepRow * k, g0.cols * k, k);
        g.font = `${Math.round(k * 0.6)}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        // new pieces pop in (mine, while building)
        if (i === me() && V.stage === 'build' && prev) for (let r = 0; r < g0.rows; r++) for (let c = 0; c < g0.cols; c++) { const a = prev[r][c], b = p.g[r][c]; if (b && (!a || a[0] !== b[0] || a[1] < b[1])) born.set(`${r},${c}`, now); }
        if (i === me()) prev = p.g.map((row) => row.map((x) => (x ? [...x] : null)));
        const br = bracedSet(p.g);
        for (let r = 0; r < g0.rows; r++) for (let c = 0; c < g0.cols; c++) {
          const cell = p.g[r][c], cx = px + (c + 0.5) * k, cy = y0 + (r + 0.5) * k, key = `${r},${c}`;
          if (p.wet?.has(key)) { g.fillStyle = 'rgba(150,105,45,0.16)'; g.fillRect(cx - k / 2, cy - k / 2, k, k); }
          if (br.has(key) && br.has(`${r},${c + 1}`)) { g.fillStyle = '#e9c27d'; g.fillRect(cx, cy - k * 0.12, k, k * 0.24); }
          const b0 = i === me() ? born.get(key) : null, u = b0 != null ? Math.min(1, (now - b0) / 320) : 1;
          if (b0 != null && u >= 1) born.delete(key);
          g.fillStyle = '#000';   // (emoji take the fill's alpha)
          if (cell) {
            g.save(); g.translate(cx, cy); g.scale(0.6 + 0.4 * ease(u), ease(u));
            if (cell[0] === 'moat' && p.filled?.has(key)) { g.fillStyle = '#3fd0e0'; g.fillRect(-k * 0.45, -k * 0.45, k * 0.9, k * 0.9); }
            else g.fillText(cell[0] === 'tower' && cell[1] === 1 ? '🧱' : ICON[cell[0]], 0, 0);
            if (p.flags?.has(key)) { g.font = `${Math.round(k * 0.36)}px serif`; g.fillText('🚩', k * 0.22, -k * 0.28); g.font = `${Math.round(k * 0.6)}px serif`; }
            g.restore();
            if (cell[0] === 'tower' && cell[1] > 1) { g.save(); g.font = `800 ${Math.round(k * 0.32)}px sans-serif`; g.fillStyle = '#fff'; g.strokeStyle = '#000a'; g.lineWidth = 3; g.strokeText(cell[1], cx + k * 0.3, cy + k * 0.3); g.fillText(cell[1], cx + k * 0.3, cy + k * 0.3); g.restore(); }
          }
          if (r === g0.keepRow && c === p.keep) {
            g.fillStyle = '#000'; g.fillText(p.fallen ? '💥' : '🏰', cx, cy);
            const hm = g0.keepHp ?? 10, hp = p.hp ?? hm;
            if (!p.fallen && hp < hm) { g.fillStyle = '#0008'; g.fillRect(cx - k * 0.4, cy - k * 0.55, k * 0.8, k * 0.1); g.fillStyle = hp > hm / 2 ? '#5fd35f' : '#ff5a4a'; g.fillRect(cx - k * 0.4, cy - k * 0.55, k * 0.8 * hp / hm, k * 0.1); }
          }
        }
        if (i === me() && building()) {
          if (test) { const tw = testWave(p); g.fillStyle = 'rgba(42,155,216,0.35)'; for (const [r, c] of tw.wet) g.fillRect(px + c * k, y0 + r * k, k, k); }
          g.fillStyle = `rgba(255,210,63,${0.25 + 0.12 * Math.sin(now / 250)})`; for (const [r, c] of targets()) g.fillRect(px + c * k + 2, y0 + r * k + 2, k - 4, k - 4);
          const gh = ghostOf(now);
          if (gh) { g.save(); g.globalAlpha = 0.5; g.fillStyle = gh.ok ? '#ffffff' : '#ff5a4a'; g.fillRect(px + gh.c * k + 2, y0 + gh.r * k + 2, k - 4, k - 4); g.fillStyle = '#000'; g.fillText({ ...ICON, flag: '🚩', keep: '🏰' }[gh.tool], px + (gh.c + 0.5) * k, y0 + (gh.r + 0.5) * k); g.restore(); }
          if (cursor && now - cursor.at < 1200) { g.strokeStyle = `rgba(255,255,255,${1 - (now - cursor.at) / 1200})`; g.lineWidth = 3; g.strokeRect(px + cursor.c * k + 2, y0 + cursor.r * k + 2, k - 4, k - 4); }
        }
        if (V.result?.[i] && w >= -1 && w < g0.waves) {
          const res = V.result[i], wv = w >= 0 ? res.waves[w] : res.waves[0], F = V.waves[Math.max(0, w)];
          if (w >= 0) for (const [r, c, fo] of wv.wet) {
            const life = el - IN - (F - fo) * STEP; if (life < 0 || el > 2) continue;
            g.fillStyle = 'rgba(110,220,240,0.6)'; g.fillRect(px + c * k, y0 + r * k, k, k);
          }
          // the crest: building at sea, then running up the beach
          const reach = wv.wet.reduce((m, qq) => Math.max(m, qq[0]), 0), e = w >= 0 ? el : t;
          const row = e < IN ? -0.4 - 1.2 * Math.min(1, (IN - e) / (IN + lead())) : Math.min(reach + 0.5, (e - IN) / STEP);
          if (e < IN + (reach + 1) * STEP + 0.3) { g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(px - 2, y0 + row * k - k * 0.1, g0.cols * k + 4, k * 0.2); }
        }
      });
      for (let j = puffs.length - 1; j >= 0; j--) { const pf = puffs[j], u = (now - pf.at) / 400; if (u >= 1) { puffs.splice(j, 1); continue; } g.fillStyle = `rgba(233,194,125,${0.8 * (1 - u)})`; for (let a = 0; a < 6; a++) { const an = a * 1.05 + pf.at; g.beginPath(); g.arc(pf.x + Math.cos(an) * u * k * 0.6, pf.y + Math.sin(an) * u * k * 0.6, k * 0.08 * (1 - u * 0.5), 0, 6.3); g.fill(); } }
    }
    function cellXY(i, r, c) { if (!lay) return null; const li = lay.list.indexOf(i); if (li < 0) return null; return [lay.x0 + li * (G().cols + 1) * lay.k + (c + 0.5) * lay.k, lay.y0 + (r + 0.5) * lay.k]; }
    function pick(cx, cy) {
      if (!lay || me() == null) return null;
      const rect = canvas.getBoundingClientRect(), sx = canvas.width / rect.width, x = (cx - rect.left) * sx, y = (cy - rect.top) * sx;
      const li = lay.list.indexOf(me()); if (li < 0) return null;
      const px = lay.x0 + li * (G().cols + 1) * lay.k, c = Math.floor((x - px) / lay.k), r = Math.floor((y - lay.y0) / lay.k);
      return r >= 0 && r < G().rows && c >= 0 && c < G().cols ? [r, c] : null;
    }
    function toScreen(i, r, c) { const p = cellXY(i, r, c); if (!p) return null; const rect = canvas.getBoundingClientRect(), s = rect.width / canvas.width; return [p[0] * s, p[1] * s - lay.k * s * 0.3]; }
    const puff = (r, c) => { const p = cellXY(me(), r, c); if (p && !calm()) puffs.push({ x: p[0], y: p[1], at: performance.now() }); };
    resize();
    return { draw, resize, dispose() { canvas.remove(); }, pick, toScreen, puff };
  }

  const turnText = (s) => (s.phase === 'playing' ? (s.tide.stage === 'build' ? `🏖️ Build! Tide ${s.tide.tide} of ${s.tide.tides}` : `🌊 Tide ${s.tide.tide} of ${s.tide.tides}`) : null);
  const myMove = (s) => s.phase === 'playing' && s.tide.stage === 'build' && s.tide.me != null && !s.tide.ready[s.tide.me];

  return { mount, render, unmount, turnText, myMove, focus: true };
})();
