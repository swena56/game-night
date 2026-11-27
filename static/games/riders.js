// Light Riders: the server simulates the grid; this module keeps a local copy of every trail (full
// views replace it, fast updates append recent cells), draws it in 3D (three.js) or 2D, and sends
// turns. Bikes glide between server ticks so motion looks smooth at any tick rate.
// The arena fills the room; scores and the boost button float on top of it. Swipe anywhere (or, in
// tap mode, tap the left/right half to turn relative to your bike); your bike turns on screen at
// once, before the server confirms. Crashes cost a life: the wreck clears and you respawn.
// 🐍 Snake mode draws the same trails as snake bodies that eat orbs. A body can cross itself, so fast
// updates are lined up by each snake's count of cells moved (`sq`) instead of by looking cells up.
UI.riders = (() => {
  let S, ctx, trails = [], live = [], lastTick = 0, tickAt = 0, round = 0, ring = 0, lastTwo = 0;  // ring: 🧱 closed bands
  let gl = null, flat = null, raf = 0, ro = null, keyHandler = null, swipe = null, root = null;
  let pred = null, tapTurn = false, lastCount = '';
  let items = new Map(), slow = [], grabsSeen = new Set();  // 🎁 power-ups on the grid (cell → kind), 🐌 slowed riders
  const ITEM = { bolt: ['⚡', '#ffd166'], slow: ['🐌', '#8ce99a'], life: ['❤️', '#ff6b8b'], cut: ['✂️', '#a5d8ff'] };
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  let orbs = new Map(), seq = [], size = [];  // 🐍 orbs on the grid (cell → worth), cells each snake has moved, body lengths
  const ORB = ['#ffd166', '#8ce99a', '#ff8fab', '#a5d8ff', '#e599f7'];
  const BEADS = 304;  // 🐍 body slices per snake in 3D: two a cell for the longest body (150), plus the gliding ends
  // how thick a body is, `fromTail` and `fromHead` cells in from its ends: a pointed tail and a slight neck
  const girth = (fromTail, fromHead) => Math.min(0.4 + 0.6 * Math.min(1, fromTail / 6), fromHead < 2 ? 0.84 + 0.08 * fromHead : 1);
  const isSnake = () => S?.riders?.mode === 'snake';
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    S = null; trails = []; live = []; round = 0; gl = null; flat = null; pred = null; lastCount = '';
    items = new Map(); slow = []; grabsSeen = new Set(); orbs = new Map(); seq = []; size = []; sideKey = '';
    tapTurn = !!load('riders.tapTurn');
    main.innerHTML = `<div class="lr" id="lrRoot"><div class="lr-stage" id="lrStage">
        <div class="lr-hud" id="lrHud"></div>
        <div class="lr-banner" id="lrBanner" hidden></div>
        <div class="lr-pad" id="lrPad">
          <span></span><button data-d="0" aria-label="Up">▲</button><span></span>
          <button data-d="3" aria-label="Left">◀</button><span></span><button data-d="1" aria-label="Right">▶</button>
          <span></span><button data-d="2" aria-label="Down">▼</button><span></span></div>
        <button id="lrBoost" class="lr-boost" aria-label="Boost">⚡</button>
        <button id="lrBrake" class="lr-brake" aria-label="Brake">🛑</button>
      </div></div>`;
    side.innerHTML = `<div class="panel"><div id="lrRiders"></div>
      <label class="check"><input type="checkbox" id="lrTap"> Tap left / right side to turn</label>
      <p class="hint left" id="lrHow"></p></div>`;
    $('lrTap').checked = tapTurn;
    $('lrTap').addEventListener('change', (e) => { tapTurn = e.target.checked; store('riders.tapTurn', tapTurn || null); how(); });
    how();
    for (const b of $('lrPad').querySelectorAll('button[data-d]')) b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); steer(+b.dataset.d); });
    $('lrBoost').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); boost(); });
    $('lrBrake').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); brake(); });
    root = $('lrRoot');
    const stage = $('lrStage');
    // The whole game area ignores browser panning, so a swipe can't scroll the page; the pointer is
    // captured so the swipe keeps steering wherever the finger goes.
    root.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, input, label')) return;
      if (tapTurn) {  // turn on touch-down: no waiting to tell a tap from a swipe
        const r = root.getBoundingClientRect();
        turn(e.clientX < r.left + r.width / 2 ? 3 : 1);
        return;
      }
      swipe = { x: e.clientX, y: e.clientY };
      try { root.setPointerCapture(e.pointerId); } catch {}
    });
    root.addEventListener('pointermove', (e) => {
      if (!swipe) return;
      const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
      // about 6% of the arena's width: small enough for a phone, not twitchy on a tablet
      if (Math.hypot(dx, dy) < Math.max(18, Math.min(48, root.clientWidth * 0.06))) return;
      steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
      swipe = { x: e.clientX, y: e.clientY };  // keep swiping in the same gesture
    });
    for (const t of ['pointerup', 'pointercancel']) root.addEventListener(t, () => { swipe = null; });
    keyHandler = (e) => {
      if (e.target?.closest?.('input, textarea, select') && e.target.type !== 'checkbox') return;
      const k = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 }[e.code];
      const rel = { KeyQ: 3, Comma: 3, KeyE: 1, Period: 1 }[e.code];
      if (k != null) { e.preventDefault(); steer(k); }
      else if (rel != null) { e.preventDefault(); turn(rel); }
      else if (['Space', 'ShiftLeft', 'ShiftRight', 'Enter'].includes(e.code)) { e.preventDefault(); boost(); }
      else if (e.code === 'KeyX') { e.preventDefault(); if (!e.repeat) brake(); }
    };
    addEventListener('keydown', keyHandler);
    ro = window.ResizeObserver ? new ResizeObserver(() => { gl?.resize(); flat?.resize(); }) : null;
    ro?.observe(stage);
    const ready = GL3.load();
    ready.then(() => { if (stage.isConnected && !gl) gl = make3d(stage); }).catch(() => {})
      .finally(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); if (S) (gl || flat)?.reset(); });
    raf = requestAnimationFrame(loop);
  }

  function how() {
    const el = $('lrHow'); if (!el) return;
    el.textContent = (tapTurn
      ? `Tap the left or right half of the screen to turn left or right from where your ${isSnake() ? 'snake' : 'bike'} is heading. Keys: arrows / WASD, Q/E turn, Space boosts, X brakes.`
      : 'Swipe anywhere to steer, or use the keyboard (arrows / WASD, Q/E turn, Space boosts, X brakes).')
      + (isSnake() ? ' Skim past another snake to grind a boost back.' : tapTurn ? '' : ' Ride beside a trail to grind a boost back.');
  }

  function unmount() {
    cancelAnimationFrame(raf); ro?.disconnect(); removeEventListener('keydown', keyHandler);
    gl?.dispose(); gl = null; flat = null; root = null;
    snd.stop();
  }

  const mine = () => S?.riders?.me;
  const riding = () => S?.phase === 'playing' && S.riders.stage === 'ride';
  const canSteer = () => mine() != null && S.phase === 'playing' && S.riders.stage !== 'over' && live[mine()]?.alive;
  // the way my bike is heading on screen: the last turn I sent, until the server confirms or drops it
  const myDir = () => pred?.dir ?? live[mine()]?.dir ?? 0;
  function steer(d) {
    if (!canSteer()) return;
    const cur = myDir();
    if (d === cur || d === (cur + 2) % 4) return;  // the server ignores these too (no U-turns)
    pred = { dir: d, k: lastTick };
    buzz(10); snd.play('turn');
    ctx.input({ dir: d }, true);
  }
  const turn = (side) => steer((myDir() + side) % 4);  // 1 = right, 3 = left, relative to the bike
  function boost() {
    const L = live[mine()];
    if (!canSteer() || S.riders.stage !== 'ride' || !L.boosts || L.boosting) return;
    snd.play('boost');
    ctx.input({ boost: true }, true);
  }
  function brake() {
    const L = live[mine()];
    if (!canSteer() || S.riders.stage !== 'ride' || !L.brakes || L.braking) return;
    snd.play('turn');
    ctx.input({ brake: true }, true);
  }
  const colorOf = (i) => ctx.player(S.riders.seats[i])?.color ?? '#888';

  // ---------- state: full views replace the trails, fast updates append the newest cells
  // what changed for rider i between two states: crash, respawn, a boost earned by grinding
  function events(i, was, now) {
    if (!was) return;
    const me = i === mine();
    if (was.alive && !now.alive) {
      (gl || flat)?.crash?.(i);
      snd.play(me ? 'crashMe' : 'crash');
      if (me) { buzz([80, 50, 160]); pred = null; }
    } else if (!was.alive && now.alive && S.riders.stage === 'ride') {
      (gl || flat)?.pulse?.(i);
      if (me) { snd.play('respawn'); buzz(20); pred = null; }
    }
    if (now.alive && now.grind > was.grind) (gl || flat)?.grind?.(i);
    if (me && now.alive && was.alive && now.boosts > was.boosts && !now.boosting) { snd.play('earn'); (gl || flat)?.grind?.(i); }
  }

  // 🎁 someone rode over a power-up: say so (loudest when it's yours, or when it slows you)
  function grabs(list, quietly) {
    for (const [k, i, kind] of list || []) {
      const key = `${round}:${k}:${i}:${kind}`;
      if (grabsSeen.has(key)) continue;
      grabsSeen.add(key);
      if (quietly) continue;
      const me = mine(), name = i === me ? 'You' : ctx.player(S.riders.seats[i])?.name ?? '?';
      (gl || flat)?.grab?.(i, kind);
      if (i === me) {
        Kit.callout({ bolt: '⚡ Boosts refilled!', slow: '🐌 Slow-mo! Everyone else crawls', life: '❤️ Extra life!', cut: '✂️ Trail cut in half!' }[kind], 'gold', { ms: 1300 });
        snd.play('earn'); buzz(25);
      } else if (kind === 'slow' && me != null && live[me]?.alive) {
        Kit.callout(`🐌 ${name} slowed you down!`, 'bad', { ms: 1300 });
        snd.play('slow');
      } else snd.play('ping');
    }
  }

  function render(s, c) {
    S = s; ctx = c;
    const r = s.riders;
    const fresh = r.round !== round;
    ring = r.ring || 0;  // a full view carries the closed band (a new round opens it again)
    round = r.round;
    trails = r.trails.map((t) => [...t]);
    const old = live;
    live = r.alive.map((a, i) => ({ alive: a, dir: r.dirs[i], boosts: r.boosts[i], boosting: false,
      brakes: r.brakes?.[i] ?? 0, braking: !!r.braking?.[i],
      lives: r.lives?.[i] ?? 1, grind: r.grind?.[i] ?? 0, respawnAt: r.respawning?.[i] != null ? performance.now() + r.respawning[i] * 1000 : null }));
    if (!fresh) live.forEach((L, i) => { events(i, old[i], L); if (old[i]?.boosting) L.boosting = true; });
    else { pred = null; grabsSeen = new Set(); }
    nudges = [];
    const ate = !fresh && r.mode === 'snake' && r.me != null && r.size[r.me] > (size[r.me] ?? Infinity);
    orbs = new Map(r.orbs || []); seq = [...(r.sq || [])]; size = [...(r.size || [])];
    if (ate) snd.play('ping');
    S.endsAt = r.timeLeft != null ? performance.now() + r.timeLeft * 1000 : null;
    how();
    items = new Map(r.items || []); slow = r.slow || [];
    grabs(r.grabs, fresh || !old.length);
    lastTick = r.tick; tickAt = performance.now();
    if (fresh) (gl || flat)?.reset(); else (gl || flat)?.sync();
    S.countdownAt = performance.now() + r.countdown * 1000;
    if (fresh) S.roundAt = performance.now();
    renderSide();
  }

  function fast(data) {
    if (!S || data.k < lastTick) return;  // a new round starts with a full view
    const t0 = performance.now(), drawn = noteHeads(t0);
    data.p.forEach(([len, alive, dir, boosts, boosting, lives, grind, braking, brakes, ...tail], i) => {
      const t = trails[i]; if (!t) return;
      if (data.sq) follow(t, i, len, data.sq[i], tail);
      else {
        // the newest cells line up with what we hold (cells never repeat within a trail), so this also
        // follows a ✂️ cut, which drops cells from the start
        const at = tail.length ? t.lastIndexOf(tail[0]) : -1;
        if (at >= 0 && t.length - at <= tail.length + 1) { t.length = at; t.push(...tail); if (t.length > len) t.splice(0, t.length - len); }
        else {
          if (len < t.length) t.length = 0;  // the trail was wiped (a crash with lives left, or a respawn)
          for (let idx = Math.max(t.length, len - tail.length); idx < len; idx++) t.push(tail[idx - (len - tail.length)]);
        }
      }
      const was = live[i];
      live[i] = { alive: !!alive, dir, boosts, boosting: !!boosting, brakes, braking: !!braking, lives, grind, respawnAt: was?.respawnAt ?? null };
      if (alive) live[i].respawnAt = null;
      events(i, was, live[i]);
    });
    if (data.k !== lastTick) { lastTick = data.k; tickAt = performance.now(); }
    nudgeHeads(drawn, t0);
    if (data.sq) {
      const me = mine();
      if (me != null && data.sz[me] > (size[me] ?? Infinity)) snd.play('ping');
      size = data.sz; orbs = new Map(data.or);
      S.endsAt = performance.now() + data.tl * 1000; S.riders.won = data.wn;
    }
    if (data.it) items = new Map(data.it);
    if (data.sl) slow = data.sl;
    grabs(data.gr);
    // three or more started and two are left riding: the showdown
    const riding = live.filter((L) => L?.alive || L?.respawnAt).length;
    if (trails.length > 2 && riding === 2 && lastTwo !== round && data.st === 'ride') { lastTwo = round; Kit.callout(isSnake() ? '⚔️ Last two snakes!' : '⚔️ Last two riders!', 'gold', { ms: 1400 }); ctx.sfx('rise', 8); }
    if ((data.w || 0) > ring) { if (!ring) { Kit.callout('🧱 The walls are closing in!', 'bad', { ms: 1500 }); ctx.sfx('alarm'); } ring = data.w; }
    const L = live[mine()];
    if (pred && L && (L.dir === pred.dir || lastTick > pred.k + 3)) pred = null;
    S.riders.stage = data.st;
    (gl || flat)?.sync();
    renderSide();
  }

  // 🐍 append the cells snake i has moved since the last update, then draw its tail in to the new length.
  // (A gap longer than the update carries is put right by the next full view.)
  function follow(t, i, len, count, tail) {
    const moved = count - (seq[i] ?? 0);
    if (moved < 0) return;
    seq[i] = count;
    if (!len) { t.length = 0; return; }
    if (moved > tail.length) t.length = 0;
    if (moved) t.push(...tail.slice(-moved));
    if (t.length > len) t.splice(0, t.length - len);
  }
  const timeText = (now) => {
    const s = Math.max(0, Math.ceil(((S.endsAt ?? now) - now) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  let sideKey = '';
  function renderSide() {
    const r = S.riders, box = $('lrRiders'); if (!box) return;
    const me = r.me != null ? live[r.me] : null;
    const b = $('lrBoost');
    b.textContent = me ? `⚡${me.boosts}` : '⚡';
    b.style.setProperty('--g', me ? Math.min(1, me.grind / (r.grindFull || 25)) : 0);
    b.disabled = !me || !me.alive || !me.boosts || r.stage !== 'ride';
    b.hidden = r.me == null;
    const br = $('lrBrake');
    br.textContent = me ? `🛑${me.brakes}` : '🛑';
    br.disabled = !me || !me.alive || !me.brakes || me.braking || r.stage !== 'ride';
    br.hidden = r.me == null;
    $('lrPad').hidden = r.me == null;
    // fast updates arrive every tick: only rebuild the panels when something on them changed (#32)
    const snake = isSnake(), clock = snake ? timeText(performance.now()) : '';
    const key = JSON.stringify([r.round, r.stage, r.wins, r.seats, r.me, slow, size, clock, live.map((L) => [L?.alive, L?.lives, L?.respawnAt != null])]);
    if (key === sideKey && box.childElementCount) return;
    sideKey = key;
    const lifeText = (i) => (r.maxLives > 1 ? ' ' + '♥'.repeat(Math.max(0, live[i]?.lives ?? 0)) : '');
    box.innerHTML = '';
    box.append(ctx.el('div', 'hint left', `Round ${r.round} · first to ${r.target}${r.maxLives > 1 ? ` · ${r.maxLives} lives` : ''}`));
    if (snake) box.append(ctx.el('div', 'hint left', '🐍 Eat orbs to grow. Crossing yourself is safe; running into another snake is not. The edge just turns you. Longest snake takes the round when time runs out.'));
    if (r.pickups) box.append(ctx.el('div', 'hint left', '🎁 Ride over power-ups: ⚡ boosts back · 🐌 rivals crawl · ❤️ a life · ✂️ half your trail gone'));
    const hud = $('lrHud'); hud.innerHTML = '';
    if (snake) hud.append(ctx.el('span', 'lr-chip', `⏱ ${clock}`));
    r.seats.forEach((pid, i) => {
      const p = ctx.player(pid), L = live[i];
      const out = !L?.alive && L?.respawnAt == null;
      const row = ctx.el('div', 'seat-row lr-row' + (L?.alive ? '' : ' out'));
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = colorOf(i); dot.style.boxShadow = `0 0 8px ${colorOf(i)}`;
      const long = snake && L?.alive ? ` · ${size[i]} long` : '';
      row.append(dot, ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === r.me ? ' (you)' : ''}${L?.alive ? '' : out ? ' 💥' : ' ⟳'}${lifeText(i)}${long}`),
        ctx.el('b', '', '★'.repeat(r.wins[i]) || '·'));
      box.append(row);
      const chip = ctx.el('span', 'lr-chip' + (i === r.me ? ' me' : '') + (out ? ' out' : ''));
      const c = ctx.el('i'); c.style.background = colorOf(i); c.style.boxShadow = `0 0 6px ${colorOf(i)}`;
      chip.append(c, ctx.el('span', '', `${i === r.me ? 'You' : (p?.name ?? '—').slice(0, 8)}${snake && L?.alive ? ` 🐍${size[i]}` : ''} ${'★'.repeat(r.wins[i])}${lifeText(i)}${L?.alive ? (slow[i] ? ' 🐌' : '') : out ? ' 💥' : ' ⟳'}`));
      hud.append(chip);
    });
  }

  // where a rider's bike is drawn: past its last cell by the fraction of a tick that has elapsed
  function rawHead(i, now) {
    const t = trails[i]; if (!t?.length) return null;
    const n = S.riders.n, c = t[t.length - 1], x = c % n, y = Math.floor(c / n);
    const L = live[i];
    if (!L?.alive || S.riders.stage !== 'ride') return [x, y];
    const per = 1000 / S.riders.speed, step = (now - tickAt) / per;
    // 🐌 a slowed rider moves on even ticks only: spread its glide over two ticks
    const f = slow[i] || L.braking ? ((lastTick % 2) + step) / 2 : step * (L.boosting ? 2 : 1);
    // A late update (#87, "lag spikes"): keep gliding instead of freezing at the cell's edge, easing to a stop
    // a little way into the next cell, so a short hiccup reads as a stumble rather than a stop-and-jump.
    const g = f < 0.8 ? f : 0.8 + 0.6 * (1 - Math.exp(-(f - 0.8) / 0.6));
    const [dx, dy] = DIRS[headDir(i)];
    if (!isSnake()) return [x + dx * g, y + dy * g];
    const clamp = (v) => Math.min(n - 1, Math.max(0, v));
    return [clamp(x + dx * g), clamp(y + dy * g)];
  }
  // 🐍 where a body ends: a full-grown snake's last cell slides toward the next one as the head moves on
  function tailPos(i, now) {
    const t = trails[i], n = S.riders.n, at = (c) => [c % n, Math.floor(c / n)];
    const a = at(t[0]), head = headPos(i, now);
    if (t.length < 2 || t.length < size[i] || !head) return a;
    const [hx, hy] = at(t[t.length - 1]), b = at(t[1]);
    const g = Math.min(1, Math.hypot(head[0] - hx, head[1] - hy));
    return [a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g];
  }
  // When an update lands, the head's true spot can differ from where it was drawn a moment ago (a late or
  // bunched-up packet). Rather than snap, carry the difference and let it fade out over ~70 ms.
  let nudges = [];
  function noteHeads(now) { return trails.map((_, i) => headPos(i, now)); }
  function nudgeHeads(before, now) {
    nudges = trails.map((_, i) => {
      const a = before[i], b = rawHead(i, now);
      if (!a || !b || !live[i]?.alive) return null;
      const ox = a[0] - b[0], oy = a[1] - b[1];
      return Math.abs(ox) + Math.abs(oy) < 2.5 ? { ox, oy, at: now } : null;  // a respawn or wipe: jump
    });
  }
  function headPos(i, now) {
    const p = rawHead(i, now), k = nudges[i];
    if (!p || !k) return p;
    const w = Math.exp(-(now - k.at) / 70);
    if (w < 0.02) { nudges[i] = null; return p; }
    return [p[0] + k.ox * w, p[1] + k.oy * w];
  }
  const headDir = (i) => (i === mine() ? myDir() : live[i]?.dir ?? 0);

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!S?.riders) return;
    (gl || flat)?.draw(now);
    const r = S.riders, banner = $('lrBanner'), me = r.me != null ? live[r.me] : null;
    const left = ((S.countdownAt ?? 0) - now) / 1000;
    let text = '', small = false;
    if (S.phase === 'playing' && r.stage === 'countdown') text = left > 0 ? String(Math.ceil(left)) : 'GO!';
    else if (S.phase === 'playing' && r.stage === 'over') {
      // 🐍 several snakes can be alive when the clock runs out, so the server names the winner
      const w = isSnake() ? r.won : live.findIndex((L) => L?.alive);
      text = w == null ? '' : w < 0 ? '🤝 Draw' : w === r.me ? '🏁 You take the round!' : `🏁 ${ctx.player(r.seats[w])?.name ?? '?'} takes it`;
      small = text.length > 14;
    }
    else if (S.phase === 'playing' && me && !me.alive) {
      small = true;
      text = me.respawnAt != null ? `💥 Respawning in ${Math.max(0, (me.respawnAt - now) / 1000).toFixed(1)}` : '💥 Out — watching';
    }
    banner.hidden = !text; banner.textContent = text; banner.classList.toggle('small', small);
    if (S.phase === 'playing' && r.stage === 'ride' && isSnake()) {  // the clock ticks between updates too
      const chip = $('lrHud')?.firstElementChild, t = `⏱ ${timeText(now)}`;
      if (chip && chip.textContent !== t) chip.textContent = t;
    }
    // countdown beeps and the GO, once each
    const count = S.phase !== 'playing' ? '' : r.stage === 'countdown' && left > 0 ? String(Math.ceil(left)) : r.stage === 'ride' ? 'GO' : '';
    if (count !== lastCount) {
      if (me && count && (count !== 'GO' || lastCount)) snd.play(count === 'GO' ? 'go' : 'beep');  // no GO when joining mid-ride
      lastCount = count;
    }
    snd.engine(S.phase === 'playing' && r.stage === 'ride' && !isSnake() && me?.alive ? (me.braking ? 0.5 : me.boosting ? 2 : 1) : null);
  }

  // ---------- sound: an engine hum while you ride and short synthesized hits (no files)
  const snd = (() => {
    let a = null, eng = null;
    const on = () => (typeof prefs === 'undefined' || prefs.sound) && !document.hidden;
    // through the app's output, so the volume setting applies (its own context only if that's missing)
    const shared = () => typeof out === 'function';
    function ac() { a ||= shared() ? out().context : new (window.AudioContext || window.webkitAudioContext)(); if (a.state === 'suspended') a.resume(); return a; }
    const dest = () => (shared() ? out() : a.destination);
    function tone(f0, f1, dur, type, vol, at = 0) {
      const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + at;
      o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(dest()); o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(dur, f0, f1, q, vol, at = 0) {
      const len = Math.max(1, Math.floor(a.sampleRate * dur)), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
      for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * Math.sin(Math.PI * k / len);
      const src = a.createBufferSource(), fl = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime + at;
      src.buffer = buf; fl.type = 'bandpass'; fl.Q.value = q; fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.value = vol; src.connect(fl).connect(g).connect(dest()); src.start(t);
    }
    const HITS = {
      turn: () => tone(900, 700, 0.05, 'square', 0.025),
      boost: () => { noise(0.6, 300, 2600, 1.2, 0.5); tone(110, 330, 0.5, 'sawtooth', 0.04); },
      crash: () => { noise(0.35, 900, 200, 0.8, 0.3); tone(110, 50, 0.3, 'sine', 0.1); },
      crashMe: () => { noise(0.7, 1400, 100, 0.7, 1); tone(90, 30, 0.6, 'sine', 0.35); },
      respawn: () => [0, 1, 2, 3].forEach((k) => tone(330 + k * 165, 360 + k * 180, 0.16, 'triangle', 0.06, k * 0.06)),
      earn: () => [880, 1320].forEach((f, k) => tone(f, f, 0.09, 'triangle', 0.08, k * 0.06)),
      beep: () => tone(660, 660, 0.14, 'square', 0.05),
      go: () => tone(1320, 1320, 0.35, 'square', 0.06),
      slow: () => tone(500, 140, 0.5, 'sawtooth', 0.05),
      ping: () => tone(1180, 1180, 0.07, 'triangle', 0.03),
    };
    function play(kind) { if (on()) try { ac(); HITS[kind](); } catch {} }
    // the hum: two detuned saws through a low-pass, higher while boosting; silent unless you're riding
    function engine(level) {
      if (!on() || level == null) { stop(); return; }
      try {
        if (!eng) {
          ac();
          const g = a.createGain(), fl = a.createBiquadFilter(); g.gain.value = 0; fl.type = 'lowpass'; fl.Q.value = 4;
          const os = [0, 9].map((cents) => { const o = a.createOscillator(); o.type = 'sawtooth'; o.detune.value = cents; o.connect(fl); o.start(); return o; });
          fl.connect(g).connect(dest()); eng = { g, fl, os, level: 0 };
        }
        if (eng.level === level) return;
        eng.level = level;
        const t = a.currentTime;
        for (const o of eng.os) o.frequency.setTargetAtTime(level > 1 ? 120 : 70, t, 0.1);
        eng.fl.frequency.setTargetAtTime(level > 1 ? 1600 : 650, t, 0.1);
        eng.g.gain.setTargetAtTime(level > 1 ? 0.035 : 0.02, t, 0.15);
      } catch {}
    }
    function stop() {
      if (!eng) return;
      const e = eng; eng = null;
      try { e.g.gain.setTargetAtTime(0, a.currentTime, 0.05); setTimeout(() => e.os.forEach((o) => o.stop()), 300); } catch {}
    }
    return { play, engine, stop };
  })();

  // ---------- three.js arena
  // the phone threw the GPU context away (app switch, memory): start a fresh 3D view
  function lost(stage) {
    if (!stage.isConnected) return;
    gl?.dispose(); gl = make3d(stage);
    if (!gl) flat ||= make2d(stage); if (S) (gl || flat)?.reset();
  }

  function make3d(stage) {
    const T = window.THREE;
    let renderer;
    renderer = GL3.renderer({}, { onLost: () => lost(stage) });
    if (!renderer) return null;
    stage.prepend(renderer.domElement);
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(38, 1, 0.5, 500);
    // a night sky that rides with the camera, the arena floor fading into it
    const stg = GL3.stage(renderer, scene, { exposure: 1.15, sky: { bottom: 0x0b1030, horizon: 0x24357a, top: 0x050820, stars: 500, radius: 300 },
      fog: [0x0b1030, 110, 260], hemi: [0xdbe6ff, 0x3a3f6e, 0.95], key: { i: 0.75, pos: [-20, 60, 30], shadow: false } });
    let n = 0, mode = null, beadTint = new T.Color(), orbMesh = null, world = null, ribbons = [], bikes = [], tips = [], drawn = [], pend = [], you = null, arrow = null, sparks = null, walls = [];
    const segGeo = new T.BoxGeometry(1, 1, 1);
    // 🎁 power-ups: a floating badge per item (one texture per kind)
    const itemTex = {}, itemSprites = new Map();
    function badge(kind) {
      if (itemTex[kind]) return itemTex[kind];
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d'), [icon, col] = ITEM[kind];
      if (g) {
        g.fillStyle = col; g.beginPath(); g.arc(64, 64, 56, 0, 6.283); g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = 8; g.stroke();
        g.font = '70px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(icon, 64, 70);
      }
      return (itemTex[kind] = new T.CanvasTexture(c));
    }
    function drawItems(now) {
      for (const [c, sp] of itemSprites) {
        if (items.get(c) === sp.userData.kind) continue;
        world.remove(sp); sp.material.dispose(); itemSprites.delete(c);
      }
      for (const [c, kind] of items) {
        let sp = itemSprites.get(c);
        if (!sp) {
          sp = new T.Sprite(new T.SpriteMaterial({ map: badge(kind), depthWrite: false, transparent: true }));
          sp.userData.kind = kind; const [x, z] = at(c); sp.position.set(x, 1.3, z);
          world.add(sp); itemSprites.set(c, sp);
        }
        sp.position.y = 1.4 + 0.3 * Math.sin(now / 300 + c);
        sp.scale.setScalar(3.2 + 0.3 * Math.sin(now / 170 + c));
      }
    }

    function build() {
      if (world) scene.remove(world);
      for (const sp of itemSprites.values()) sp.material.dispose();
      itemSprites.clear();
      world = new T.Group(); scene.add(world);
      n = S.riders.n; mode = S.riders.mode;
      const half = n / 2;
      // floor with a glowing grid texture
      const c = document.createElement('canvas'); c.width = c.height = 512;
      const g = c.getContext('2d');
      let mat = new T.MeshStandardMaterial({ color: 0x1b2a66, roughness: 0.9 });
      if (g) {
        g.fillStyle = '#16214f'; g.fillRect(0, 0, 512, 512);
        g.strokeStyle = '#5b9dff66'; g.lineWidth = 3;
        for (let k = 0; k <= 8; k++) { const p = (k * 512) / 8; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 512); g.moveTo(0, p); g.lineTo(512, p); g.stroke(); }
        const tex = new T.CanvasTexture(c); tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.repeat.set(n / 8, n / 8);
        tex.anisotropy = Math.min(4, renderer.capabilities?.getMaxAnisotropy?.() ?? 1);  // the grid stays visible at the far edge
        // the floor's own picture glows, so the grid lines light up and not just the lamps' share of them
        mat = new T.MeshStandardMaterial({ map: tex, roughness: 0.85, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.32 });
      }
      const floor = new T.Mesh(new T.PlaneGeometry(n, n), mat); floor.rotation.x = -Math.PI / 2; world.add(floor);
      const wallMat = new T.MeshStandardMaterial({ color: 0x8ecae6, emissive: 0x8ecae6, emissiveIntensity: 0.9 });
      walls = [];
      for (const [w, d, x, z] of [[n + 1, 0.5, 0, -half - 0.25], [n + 1, 0.5, 0, half + 0.25], [0.5, n + 1, -half - 0.25, 0], [0.5, n + 1, half + 0.25, 0]]) {
        const m = new T.Mesh(new T.BoxGeometry(w, 1.2, d), wallMat); m.position.set(x, 0.6, z); world.add(m); walls.push(m);
      }
      ribbons = []; bikes = []; tips = []; drawn = []; pend = [];
      orbMesh = null;
      if (isSnake()) {
        orbMesh = new T.InstancedMesh(new T.SphereGeometry(1, 10, 8), new T.MeshBasicMaterial({ color: 0xffffff }), n * n);
        for (let k = 0; k < n * n; k++) orbMesh.setColorAt(k, beadTint.set(ORB[0]));
        orbMesh.count = 0; orbMesh.frustumCulled = false; world.add(orbMesh);
      }
      S.riders.seats.forEach((_, i) => {
        const color = new T.Color(colorOf(i));
        if (isSnake()) return buildSnake(color);
        // (no tone mapping here either: the trails keep their full colour against the lit floor)
        const rm = new T.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.3), emissive: color, emissiveIntensity: 0.85, transparent: true, opacity: 0.9, toneMapped: false });
        const inst = new T.InstancedMesh(segGeo, rm, n * n); inst.count = 0; world.add(inst); ribbons.push(inst);
        const tip = new T.Mesh(segGeo, rm); world.add(tip); tips.push(tip);
        const bike = new T.Group();
        const body = new T.Mesh(new T.BoxGeometry(0.7, 0.55, 1.5), new T.MeshStandardMaterial({ color: 0x111122, emissive: color, emissiveIntensity: 0.35, metalness: 0.6, roughness: 0.3 }));
        body.position.y = 0.45; bike.add(body);
        const stripe = new T.Mesh(new T.BoxGeometry(0.74, 0.12, 1.55), new T.MeshBasicMaterial({ color })); stripe.position.y = 0.45; bike.add(stripe);
        for (const z of [-0.55, 0.55]) {
          const wheel = new T.Mesh(new T.TorusGeometry(0.28, 0.08, 8, 18), new T.MeshBasicMaterial({ color }));
          wheel.rotation.y = Math.PI / 2; wheel.position.set(0, 0.3, z); bike.add(wheel);
        }
        bike.scale.setScalar(1.35);  // readable from the steep, phone-shaped view
        world.add(bike); bikes.push(bike); drawn.push(0);
      });
      // you: a pulsing ring under your bike, and a big arrow showing your heading during the countdown
      you = new T.Mesh(new T.RingGeometry(0.95, 1.25, 40), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: T.DoubleSide, depthWrite: false }));
      you.rotation.x = -Math.PI / 2; world.add(you);
      const sh = new T.Shape();
      [[-0.45, 0], [0.45, 0], [0.45, 1.4], [1.1, 1.4], [0, 2.7], [-1.1, 1.4], [-0.45, 1.4]].forEach(([x, y], k) => (k ? sh.lineTo(x, y) : sh.moveTo(x, y)));
      const am = new T.Mesh(new T.ShapeGeometry(sh), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: T.DoubleSide, depthWrite: false }));
      am.rotation.x = Math.PI / 2; am.position.set(0, 0.12, 1.3);
      arrow = new T.Group(); arrow.add(am); world.add(arrow);
      // grind sparks: one recycled pool of points
      const SP = 160, sp = new Float32Array(SP * 3).fill(-999), col = new Float32Array(SP * 3);
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(sp, 3)); geo.setAttribute('color', new T.BufferAttribute(col, 3));
      sparks = { pts: new T.Points(geo, new T.PointsMaterial({ size: 0.28, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false })), vel: Array.from({ length: SP }, () => [0, 0, 0, 0]), next: 0 };
      sparks.pts.frustumCulled = false; world.add(sparks.pts);
      resize();
    }
    // 🐍 a smooth banded body with diamonds down its back, and a wedge head with eyes and a flicking tongue (the
    // head stands in for the bike in every effect)
    function buildSnake(color) {
      // no tone mapping on the snake: it washes bright player colours out to pastel
      const tone = color.clone().multiplyScalar(0.62);
      const skin = new T.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 0.1, roughness: 0.42, metalness: 0.1, toneMapped: false });
      const body = new T.InstancedMesh(new T.SphereGeometry(0.6, stg.low ? 9 : 14, stg.low ? 7 : 10), skin, BEADS);
      const pale = color.clone().lerp(new T.Color(0xffffff), 0.45), dark = tone.clone().multiplyScalar(0.45);
      for (let k = 0; k < BEADS; k++) body.setColorAt(k, tone);
      const marks = new T.InstancedMesh(new T.OctahedronGeometry(1), new T.MeshStandardMaterial({ color: pale, emissive: pale, emissiveIntensity: 0.15, roughness: 0.45, toneMapped: false }), BEADS / 4);
      body.userData = { color: tone, dark, marks };
      for (const m of [body, marks]) { m.count = 0; m.frustumCulled = false; world.add(m); }
      ribbons.push(body);
      const none = new T.Group(); world.add(none); tips.push(none);
      const head = new T.Group();
      const ball = new T.SphereGeometry(1, 20, 14);
      const part = (mat, sx, sy, sz, x, y, z, parent = head) => {
        const m = new T.Mesh(ball, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); parent.add(m); return m;
      };
      const flesh = new T.MeshStandardMaterial({ color: tone, emissive: color, emissiveIntensity: 0.14, roughness: 0.38, metalness: 0.1, toneMapped: false });
      const white = new T.MeshBasicMaterial({ color: 0xfff7c2 }), black = new T.MeshBasicMaterial({ color: 0x05060f });
      part(flesh, 0.68, 0.44, 0.82, 0, 0.56, 0.1);   // skull, wide at the jaws
      part(flesh, 0.45, 0.32, 0.62, 0, 0.52, 0.62);  // snout
      part(body.userData.marks.material, 0.13, 0.07, 0.3, 0, 0.98, -0.1);  // a pale flash on the crown
      for (const x of [-1, 1]) {
        part(flesh, 0.27, 0.22, 0.3, x * 0.37, 0.84, 0.3);        // brow
        part(white, 0.2, 0.17, 0.21, x * 0.39, 0.94, 0.38);       // eye
        part(black, 0.065, 0.1, 0.15, x * 0.4, 1.08, 0.43);       // slit pupil
        part(white, 0.035, 0.03, 0.035, x * 0.37, 1.18, 0.49);    // glint
        part(black, 0.05, 0.04, 0.07, x * 0.16, 0.82, 1.0);       // nostril
      }
      const tongue = new T.Group(); tongue.position.set(0, 0.42, 1.15); head.add(tongue);
      const red = new T.MeshBasicMaterial({ color: 0xff3b5c });
      const stem = new T.Mesh(new T.BoxGeometry(0.11, 0.05, 0.5), red); stem.position.z = 0.2; tongue.add(stem);
      for (const x of [-1, 1]) {
        const fork = new T.Mesh(new T.BoxGeometry(0.08, 0.05, 0.34), red);
        fork.position.set(x * 0.1, 0, 0.57); fork.rotation.y = x * 0.55; tongue.add(fork);
      }
      head.userData.tongue = tongue;
      head.scale.setScalar(1.35);
      world.add(head); bikes.push(head); drawn.push(0);
    }
    // out and back about once every 1.6 s, each snake in its own time
    function flick(i, now) {
      const tongue = bikes[i]?.userData.tongue;
      if (!tongue) return;
      const t = (now + i * 530) % 1600;
      tongue.visible = t < 420;
      if (tongue.visible) tongue.scale.z = 0.35 + 0.65 * Math.abs(Math.sin((t / 420) * Math.PI * 2));
    }
    function drawBody(i, now) {
      const body = ribbons[i], t = trails[i], { color, dark, marks } = body.userData;
      let k = 0, d = 0;
      const head = headPos(i, now);
      if (!t.length || !head) { body.count = marks.count = 0; return; }
      const half = n / 2 - 0.5, end = tailPos(i, now);
      // tail end, then every cell, then the gliding head; a slice at each point and one halfway to it
      const pts = [[end[0] - half, end[1] - half]];
      for (let j = 1; j < t.length; j++) pts.push(at(t[j]));
      pts.push([head[0] - half, head[1] - half]);
      const last = pts.length - 1;
      // stripes are counted from the first cell the snake ever moved onto, so they stay put as it slides
      const first = (seq[i] ?? t.length) - t.length;
      const put = (x, z, num, r) => {
        if (k >= BEADS) return;
        sc.set(r, r * 0.82, r); v.set(x, 0.5 * r, z); q.identity();
        mtx.compose(v, q, sc); body.setMatrixAt(k, mtx);
        body.setColorAt(k, Math.floor(num / 4) % 2 ? dark : color); k++;
      };
      // from the head back, so a body too long for the buffer loses the far tip of its tail, not its neck
      for (let j = last; j >= 0; j--) {
        const [x, z] = pts[j], r = girth(j, last - j);
        put(x, z, first + j, r);
        if (!j) continue;
        const [px, pz] = pts[j - 1];
        put((x + px) / 2, (z + pz) / 2, first + j, (r + girth(j - 1, last - j + 1)) / 2);
        if ((first + j) % 4 === 2 && j > 2 && j < last - 1 && d < BEADS / 4 && (x !== px || z !== pz)) {
          q.setFromAxisAngle(up, Math.atan2(x - px, z - pz));
          v.set(x, 1.0 * r, z); sc.set(0.27 * r, 0.1, 0.58 * r);
          mtx.compose(v, q, sc); marks.setMatrixAt(d++, mtx);
        }
      }
      body.count = k; marks.count = d;
      body.instanceMatrix.needsUpdate = true; body.instanceColor.needsUpdate = true;
      marks.instanceMatrix.needsUpdate = true;
    }
    function drawOrbs(now) {
      if (!orbMesh) return;
      let k = 0;
      for (const [c, worth] of orbs) {
        const [x, z] = at(c);
        sc.setScalar((worth > 1 ? 0.48 : 0.36) * (1 + 0.15 * Math.sin(now / 220 + c))); v.set(x, 0.55, z); q.identity();
        mtx.compose(v, q, sc); orbMesh.setMatrixAt(k, mtx); orbMesh.setColorAt(k, beadTint.set(ORB[c % ORB.length])); k++;
      }
      orbMesh.count = k;
      orbMesh.instanceMatrix.needsUpdate = true; orbMesh.instanceColor.needsUpdate = true;
    }
    const at = (c) => [(c % n) - n / 2 + 0.5, Math.floor(c / n) - n / 2 + 0.5];
    const mtx = new T.Matrix4(), q = new T.Quaternion(), up = new T.Vector3(0, 1, 0), v = new T.Vector3(), sc = new T.Vector3();
    function segment(a, b, setMatrix) {  // a thin glowing wall from point a to point b (x, z)
      const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) + 0.3;
      q.setFromAxisAngle(up, Math.atan2(dx, dz));
      v.set((a[0] + b[0]) / 2, 0.45, (a[1] + b[1]) / 2); sc.set(0.3, 0.9, len);
      mtx.compose(v, q, sc);
      setMatrix(mtx);
    }
    function sync() {
      if (!world || S.riders.n !== n || S.riders.mode !== mode || ribbons.length !== trails.length) return build();
      if (isSnake()) return;  // bodies are redrawn every frame
      trails.forEach((t, i) => {
        const inst = ribbons[i];
        inst.material.opacity = live[i]?.alive || !riding() ? 0.9 : 0.3;  // the final board stays lit (#79)
        if (t.length < drawn[i]) { drawn[i] = 0; inst.count = 0; }
        if (t.length === drawn[i]) return;
        const from = Math.max(1, drawn[i]);
        for (let k = from; k < t.length; k++) segment(at(t[k - 1]), at(t[k]), (m) => inst.setMatrixAt(k - 1, m));
        inst.count = Math.max(0, t.length - 1);
        // upload only the new segments, not the whole n×n buffer (#32)
        const attr = inst.instanceMatrix;
        pend[i] = Math.min(pend[i] ?? Infinity, from - 1);  // two updates between frames: upload both
        if (attr.updateRange) { attr.updateRange.offset = pend[i] * 16; attr.updateRange.count = Math.max(0, t.length - 1 - pend[i]) * 16; }
        attr.needsUpdate = true;
        drawn[i] = t.length;
      });
    }
    function reset() { build(); drawn = drawn.map(() => 0); sync(); }
    // Fit the whole arena. A tall (portrait) box looks almost straight down so the square fills its
    // width; a wide box keeps a lower, more dramatic angle. Then back off until all four corners fit.
    const base = new T.Vector3(), target = new T.Vector3();
    function resize() {
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      renderer.setSize(w, h, false); camera.aspect = w / h;
      const half = (n || 40) / 2 + 1;
      const k = Math.min(1, Math.max(0, (camera.aspect - 0.7) / 0.8));   // 0 portrait … 1 wide
      const back = 0.12 + 0.34 * k;                                       // ~83° down on a phone, ~63° wide
      target.set(0, 0, half * 0.05 * k);
      let dist = half * 1.2;
      for (let j = 0; j < 90; j++) {
        camera.position.set(0, dist * 0.9, dist * back); camera.lookAt(target); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
        const fits = [[-half, -half], [half, -half], [-half, half], [half, half]].every(([x, z]) => {
          const p = new T.Vector3(x, 0, z).project(camera); return Math.abs(p.x) < 0.98 && Math.abs(p.y) < 0.96;
        });
        if (fits) break;
        dist *= 1.025;
      }
      base.copy(camera.position);
    }
    // 💥 a crash: sparks in the rider's colour, a shockwave ring, and a shake when it's you
    const booms = [];
    let lastDraw = 0;
    function ringFx(x, z, color, grow) {
      const m = new T.Mesh(new T.RingGeometry(0.6, 0.9, 40), new T.MeshBasicMaterial({ color, transparent: true, side: T.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.05, z); m.userData.grow = grow;
      world.add(m); return m;
    }
    function crash(i) {
      const bike = bikes[i]; if (!bike || !world) return;
      const color = new T.Color(colorOf(i)), N = 70, pos = new Float32Array(N * 3), vel = [];
      for (let k = 0; k < N; k++) {
        pos.set([bike.position.x, 0.5, bike.position.z], k * 3);
        const a = Math.random() * 6.283, up = 2 + Math.random() * 6, sp = 3 + Math.random() * 9;
        vel.push([Math.cos(a) * sp, up, Math.sin(a) * sp]);
      }
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      const pts = new T.Points(geo, new T.PointsMaterial({ color, size: 0.45, transparent: true }));
      world.add(pts);
      booms.push({ pts, ring: ringFx(bike.position.x, bike.position.z, color, 9), vel, t: 0 });
      if (i === S.riders.me) GL3.shake(camera, 1.1);
    }
    // ⟳ a respawn: a ring that closes in on the new spot
    function pulse(i) {
      const t = trails[i]; if (!world || !t?.length) return;
      const [x, z] = at(t[t.length - 1]);
      booms.push({ pts: null, ring: ringFx(x, z, new T.Color(colorOf(i)), -0.6), vel: [], t: 0 });
      booms.at(-1).ring.scale.setScalar(6);
    }
    function grind(i) {
      const bike = bikes[i]; if (!sparks || !bike?.visible) return;
      const a = sparks.pts.geometry.attributes, color = new T.Color(colorOf(i)).lerp(new T.Color(0xffffff), 0.5);
      for (let k = 0; k < 6; k++) {
        const j = sparks.next; sparks.next = (j + 1) % sparks.vel.length;
        a.position.array.set([bike.position.x + (Math.random() - 0.5) * 0.6, 0.3, bike.position.z + (Math.random() - 0.5) * 0.6], j * 3);
        a.color.array.set([color.r, color.g, color.b], j * 3);
        const ang = Math.random() * 6.283, sp = 1 + Math.random() * 3;
        sparks.vel[j] = [Math.cos(ang) * sp, 2 + Math.random() * 3, Math.sin(ang) * sp, 0.5];
      }
    }
    // 🎁 a grab: a burst and a ring in the item's colour
    function grab3d(i, kind) {
      const bike = bikes[i]; if (!sparks || !bike) return;
      const a = sparks.pts.geometry.attributes, color = new T.Color(ITEM[kind][1]);
      for (let k = 0; k < 24; k++) {
        const j = sparks.next; sparks.next = (j + 1) % sparks.vel.length;
        a.position.array.set([bike.position.x, 0.8, bike.position.z], j * 3);
        a.color.array.set([color.r, color.g, color.b], j * 3);
        const ang = Math.random() * 6.283, sp = 3 + Math.random() * 5;
        sparks.vel[j] = [Math.cos(ang) * sp, 4 + Math.random() * 5, Math.sin(ang) * sp, 0.8];
      }
      booms.push({ pts: null, ring: ringFx(bike.position.x, bike.position.z, color, 7), vel: [], t: 0 });
    }
    function tickSparks(dt) {
      if (!sparks) return;
      const p = sparks.pts.geometry.attributes.position;
      let any = false;
      sparks.vel.forEach((v, j) => {
        if (v[3] <= 0) return;
        any = true; v[3] -= dt; v[1] -= 14 * dt;
        p.array[j * 3] += v[0] * dt; p.array[j * 3 + 1] = Math.max(0.05, p.array[j * 3 + 1] + v[1] * dt); p.array[j * 3 + 2] += v[2] * dt;
        if (v[3] <= 0) p.array[j * 3 + 1] = -999;
      });
      if (any) p.needsUpdate = true;
    }
    function tickBooms(dt) {
      for (const b of booms) {
        b.t += dt;
        if (b.pts) {
          const a = b.pts.geometry.attributes.position;
          for (let k = 0; k < b.vel.length; k++) {
            const v = b.vel[k]; v[1] -= 18 * dt;
            a.array[k * 3] += v[0] * dt; a.array[k * 3 + 1] = Math.max(0.05, a.array[k * 3 + 1] + v[1] * dt); a.array[k * 3 + 2] += v[2] * dt;
            if (a.array[k * 3 + 1] <= 0.05) { v[0] *= 0.8; v[2] *= 0.8; v[1] = Math.abs(v[1]) * 0.3; }
          }
          a.needsUpdate = true;
          b.pts.material.opacity = Math.max(0, 1 - b.t / 1.4);
        }
        const g = b.ring.userData.grow;
        b.ring.scale.setScalar(g > 0 ? 1 + b.t * g : Math.max(0.3, 6 * (1 - b.t / 0.6)));
        b.ring.material.opacity = Math.max(0, 0.9 - b.t * 1.5);
      }
      while (booms.length && booms[0].t > 1.4) {
        const b = booms.shift();
        if (b.pts) { world?.remove(b.pts); b.pts.geometry.dispose(); b.pts.material.dispose(); }
        world?.remove(b.ring); b.ring.geometry.dispose(); b.ring.material.dispose();
      }
    }
    const close = new T.Vector3(), look = new T.Vector3();
    function draw(now) {
      if (!world) return;
      const dt = Math.min(0.1, (now - lastDraw) / 1000); lastDraw = now;
      // 🧱 the walls move in, ring by ring
      if (walls.length === 4 && walls.ring !== ring) {
        walls.ring = ring;
        const h = n / 2 - ring, span = (n - 2 * ring + 1) / (n + 1);
        walls[0].position.z = -h - 0.25; walls[1].position.z = h + 0.25; walls[2].position.x = -h - 0.25; walls[3].position.x = h + 0.25;
        walls.forEach((m) => { m.scale.set(m.geometry.parameters.width > 1 ? span : 1, 1, m.geometry.parameters.depth > 1 ? span : 1); m.material.color.setHex(ring ? 0xff6b6b : 0x8ecae6); m.material.emissive.setHex(ring ? 0xff6b6b : 0x8ecae6); });
      }
      tickBooms(dt); tickSparks(dt); drawItems(now); drawOrbs(now);
      const me = S.riders.me;
      trails.forEach((t, i) => {
        const pos = headPos(i, now), bike = bikes[i], tip = tips[i];
        if (isSnake()) { drawBody(i, now); flick(i, now); }
        if (!pos) { bike.visible = tip.visible = false; return; }
        const p = [pos[0] - n / 2 + 0.5, pos[1] - n / 2 + 0.5];
        bike.visible = !!live[i]?.alive;
        bike.position.set(p[0], 0, p[1]);
        const [dx, dy] = DIRS[headDir(i)];
        bike.rotation.y = Math.atan2(dx, dy);
        tip.visible = bike.visible && t.length > 0;
        if (tip.visible) segment(at(t[t.length - 1]), p, (m) => { tip.matrixAutoUpdate = false; tip.matrix.copy(m); });
      });
      const myBike = me != null ? bikes[me] : null, counting = S.riders.stage === 'countdown';
      you.visible = !!myBike?.visible;
      if (you.visible) {
        you.position.set(myBike.position.x, 0.06, myBike.position.z);
        you.scale.setScalar((counting ? 1.6 : 1) + 0.15 * Math.sin(now / 160));
      }
      arrow.visible = !!myBike?.visible && counting;
      if (arrow.visible) {
        arrow.position.copy(myBike.position); arrow.rotation.y = myBike.rotation.y;
        arrow.children[0].position.z = 1.3 + 0.35 * Math.abs(Math.sin(now / 220));
      }
      // the first moments of a round: start close over your bike, then pull back to the whole arena
      camera.position.copy(base); look.copy(target);
      const since = (now - (S.roundAt ?? -1e9)) / 1000;
      if (counting && myBike?.visible && since < 2.4) {
        const e = Math.min(1, Math.max(0, (since - 0.5) / 1.6)), s = e * e * (3 - 2 * e);
        close.set(myBike.position.x, 14, myBike.position.z + 6);
        camera.position.lerpVectors(close, base, s);
        look.lerpVectors(myBike.position, target, s);
      }
      camera.lookAt(look);
      GL3.tickShake(camera, dt);
      stg.follow(camera);
      renderer.render(scene, camera);
      pend = [];
    }
    function dispose() { stg.dispose(); renderer.dispose(); renderer.domElement.remove(); }
    if (S) build();
    return { sync, reset, resize, draw, dispose, crash, pulse, grind, grab: grab3d };
  }

  // ---------- flat fallback
  function make2d(stage) {
    const canvas = document.createElement('canvas'); stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { stage.append('Your browser cannot draw this game.'); return null; }
    let cell = 8;
    const glints = [];  // grind sparks: [x, y, born]
    function resize() {
      const n = S?.riders?.n || 40, dpr = Math.min(devicePixelRatio || 1, 2);
      const size = Math.min(stage.clientWidth || 320, stage.clientHeight || 320);
      canvas.style.width = canvas.style.height = `${size}px`;
      canvas.width = canvas.height = Math.round(size * dpr);
      cell = canvas.width / n;
    }
    function draw(now) {
      const n = S.riders.n;
      if (!canvas.width) resize();
      g.fillStyle = '#131c45'; g.fillRect(0, 0, canvas.width, canvas.height);
      if (ring) {  // 🧱 the closed band round the edge
        g.fillStyle = '#ff6b6b33';
        g.fillRect(0, 0, canvas.width, ring * cell); g.fillRect(0, canvas.height - ring * cell, canvas.width, ring * cell);
        g.fillRect(0, 0, ring * cell, canvas.height); g.fillRect(canvas.width - ring * cell, 0, ring * cell, canvas.height);
        g.strokeStyle = '#ff6b6b'; g.lineWidth = 2; g.strokeRect(ring * cell, ring * cell, canvas.width - 2 * ring * cell, canvas.height - 2 * ring * cell);
      }
      g.strokeStyle = '#5b9dff44'; g.lineWidth = 1;
      for (let k = 0; k <= n; k += 4) { g.beginPath(); g.moveTo(k * cell, 0); g.lineTo(k * cell, canvas.height); g.moveTo(0, k * cell); g.lineTo(canvas.width, k * cell); g.stroke(); }
      if (isSnake()) {  // 🐍 orbs lie under the snakes
        for (const [c, worth] of orbs) {
          g.fillStyle = ORB[c % ORB.length];
          g.beginPath(); g.arc((c % n + 0.5) * cell, (Math.floor(c / n) + 0.5) * cell, cell * (worth > 1 ? 0.45 : 0.32), 0, 6.283); g.fill();
        }
      }
      trails.forEach((t, i) => {
        if (!t.length) return;
        const color = colorOf(i), alive = live[i]?.alive;
        if (isSnake()) { drawSnake2d(i, t, color, now); return ring2d(i, now); }
        g.save(); g.strokeStyle = color; g.globalAlpha = alive || !riding() ? 1 : 0.35; g.lineWidth = cell * 0.45; g.lineJoin = g.lineCap = 'round';
        g.shadowColor = color; g.shadowBlur = cell * 1.5;
        g.beginPath();
        t.forEach((c, k) => { const x = (c % n + 0.5) * cell, y = (Math.floor(c / n) + 0.5) * cell; k ? g.lineTo(x, y) : g.moveTo(x, y); });
        const pos = headPos(i, now);
        if (pos && alive) g.lineTo((pos[0] + 0.5) * cell, (pos[1] + 0.5) * cell);
        g.stroke();
        if (pos && alive) { g.fillStyle = '#fff'; g.fillRect((pos[0] + 0.15) * cell, (pos[1] + 0.15) * cell, cell * 0.7, cell * 0.7); }
        g.restore();
        ring2d(i, now);
      });
      drawRest(now);
    }
    function drawSnake2d(i, t, color, now) {
      const n = S.riders.n, mid = (v) => (v + 0.5) * cell;
      const head = headPos(i, now), end = tailPos(i, now);
      const pts = [[mid(end[0]), mid(end[1])]];
      for (let k = 1; k < t.length; k++) pts.push([mid(t[k] % n), mid(Math.floor(t[k] / n))]);
      pts.push([mid(head[0]), mid(head[1])]);
      const last = pts.length - 1, first = (seq[i] ?? t.length) - t.length;
      g.save(); g.lineJoin = g.lineCap = 'round';
      // one stroke per cell so the body can taper: a dark rim all along first, then the banded skin inside it
      const pass = (width, style) => {
        for (let j = 1; j <= last; j++) {
          g.strokeStyle = style(first + j); g.lineWidth = cell * width * girth(j - 0.5, last - j + 0.5);
          g.beginPath(); g.moveTo(...pts[j - 1]); g.lineTo(...pts[j]); g.stroke();
        }
      };
      pass(1.3, () => '#000a');
      pass(1.02, () => color);
      g.lineCap = 'butt';  // see-through strokes: round ends would overlap into blobs
      pass(1.02, (num) => (Math.floor(num / 4) % 2 ? '#0004' : '#0000'));
      pass(0.3, () => '#fff3');  // light along the back
      g.lineCap = 'round';
      g.fillStyle = '#ffffffa6';
      for (let j = 3; j < last - 1; j++) {  // diamonds down the spine
        if ((first + j) % 4 !== 2) continue;
        const [x, y] = pts[j], [px, py] = pts[j - 1], len = Math.hypot(x - px, y - py);
        if (!len) continue;
        const ux = (x - px) / len, uy = (y - py) / len, r = cell * girth(j, last - j);
        g.beginPath(); g.moveTo(x + ux * r * 0.5, y + uy * r * 0.5); g.lineTo(x - uy * r * 0.24, y + ux * r * 0.24);
        g.lineTo(x - ux * r * 0.5, y - uy * r * 0.5); g.lineTo(x + uy * r * 0.24, y - ux * r * 0.24); g.fill();
      }
      // the head, drawn facing right and turned to the heading
      const [dx, dy] = DIRS[headDir(i)];
      g.translate(...pts[last]); g.rotate(Math.atan2(dy, dx)); g.scale(cell, cell);
      const flick = (now + i * 530) % 1600;
      if (flick < 420 && live[i]?.alive) {
        const out = 1.2 + 0.7 * Math.abs(Math.sin((flick / 420) * Math.PI * 2));
        g.strokeStyle = '#ff3b5c'; g.lineWidth = 0.16;
        g.beginPath(); g.moveTo(0.9, 0); g.lineTo(out, 0); g.lineTo(out + 0.4, -0.3); g.moveTo(out, 0); g.lineTo(out + 0.4, 0.3); g.stroke();
      }
      g.beginPath(); g.moveTo(-0.5, -0.6);
      g.bezierCurveTo(0.35, -1.1, 0.8, -0.5, 1.2, -0.28); g.quadraticCurveTo(1.38, 0, 1.2, 0.28);
      g.bezierCurveTo(0.8, 0.5, 0.35, 1.1, -0.5, 0.6); g.closePath();
      g.fillStyle = color; g.strokeStyle = '#000a'; g.lineWidth = 0.14; g.fill(); g.stroke();
      for (const side of [-1, 1]) {
        g.fillStyle = '#fff7c2'; g.beginPath(); g.arc(0.3, side * 0.44, 0.27, 0, 6.283); g.fill();
        g.fillStyle = '#05060f'; g.beginPath(); g.ellipse(0.38, side * 0.44, 0.18, 0.08, 0, 0, 6.283); g.fill();
        g.beginPath(); g.arc(1.05, side * 0.15, 0.07, 0, 6.283); g.fill();
      }
      g.restore();
    }
    function ring2d(i, now) {
      const pos = headPos(i, now), alive = live[i]?.alive;
      if (pos && alive && i === S.riders.me) {  // you: a pulsing ring, and an arrow during the countdown
        const cx = (pos[0] + 0.5) * cell, cy = (pos[1] + 0.5) * cell, counting = S.riders.stage === 'countdown';
        g.save(); g.strokeStyle = '#fff'; g.globalAlpha = 0.85; g.lineWidth = Math.max(2, cell * 0.2);
        g.beginPath(); g.arc(cx, cy, cell * ((counting ? 2.2 : 1.4) + 0.2 * Math.sin(now / 160)), 0, 6.283); g.stroke();
        if (counting) {
          const [dx, dy] = DIRS[headDir(i)], L = cell * (3 + 0.6 * Math.abs(Math.sin(now / 220)));
          g.lineWidth = cell * 0.5; g.lineCap = 'round';
          g.beginPath(); g.moveTo(cx + dx * cell * 1.5, cy + dy * cell * 1.5); g.lineTo(cx + dx * L, cy + dy * L);
          g.moveTo(cx + dx * L - dy * cell - dx * cell, cy + dy * L + dx * cell - dy * cell); g.lineTo(cx + dx * L, cy + dy * L);
          g.lineTo(cx + dx * L + dy * cell - dx * cell, cy + dy * L - dx * cell - dy * cell); g.stroke();
        }
        g.restore();
      }
    }
    function drawRest(now) {
      const n = S.riders.n;
      if (items.size) {  // 🎁 power-ups
        g.save(); g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `${Math.round(cell * 1.5)}px sans-serif`;
        for (const [c, kind] of items) {
          const x = (c % n + 0.5) * cell, y = (Math.floor(c / n) + 0.5) * cell, r = cell * (1.1 + 0.12 * Math.sin(now / 170 + c));
          g.fillStyle = ITEM[kind][1]; g.strokeStyle = '#fff'; g.lineWidth = Math.max(1.5, cell * 0.15);
          g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill(); g.stroke();
          g.fillText(ITEM[kind][0], x, y + cell * 0.08);
        }
        g.restore();
      }
      for (let k = glints.length - 1; k >= 0; k--) {
        const [x, y, born] = glints[k], age = Math.max(0, now - born) / 400;  // a frame's clock can trail performance.now()
        if (age > 1) { glints.splice(k, 1); continue; }
        g.fillStyle = `rgba(255,255,255,${1 - age})`; g.beginPath(); g.arc(x, y, cell * 0.25 * (1 + age), 0, 6.283); g.fill();
      }
      g.strokeStyle = '#8ecae6'; g.lineWidth = 3; g.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
    }
    function grind(i) {
      const pos = headPos(i, performance.now()); if (!pos) return;
      for (let k = 0; k < 3; k++) glints.push([(pos[0] + 0.5 + (Math.random() - 0.5)) * cell, (pos[1] + 0.5 + (Math.random() - 0.5)) * cell, performance.now()]);
    }
    resize();
    const grab = (i) => { for (let k = 0; k < 4; k++) grind(i); };
    return { sync() {}, reset: resize, resize, draw, grind, grab };
  }

  const turnText = (s) => (s.phase === 'playing' ? `${s.riders.mode === 'snake' ? '🐍' : '🏍️'} Round ${s.riders.round} — first to ${s.riders.target}` : null);
  const myMove = (s) => s.phase === 'playing' && s.riders.stage === 'ride' && s.riders.me != null && s.riders.alive[s.riders.me];

  return { mount, render, unmount, fast, turnText, myMove, focus: true };
})();
