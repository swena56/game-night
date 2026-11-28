// Key Clash (#374): a typing battle. Stats and health bars on top, an animated arena in the middle (a 2D
// canvas: fighters bob, every word flies across as a bolt), and a still typing area at the bottom. Typing
// is checked here letter by letter; each finished word goes to the server, which keeps every score.
UI.keyclash = (() => {
  let S, ctx, raf = 0, idx = 0, round = 0, errs = 0, lastLen = 0, stream = new Map(), chain = Promise.resolve();
  let seen = 0, fx = [], leftAt = 0, left = 0, offer = null, sentOffer = null, flash = 0, keyHook = null, keys = false;
  const $ = (id) => document.getElementById(id);
  const HUES = [205, 350, 135, 45, 280, 20];
  const hue = (id) => HUES[Math.max(0, (S?.players || []).findIndex((p) => p.id === id)) % HUES.length];
  const K = () => S.keyclash;
  const ICON = { shield: '🛡️', strike: '💥', heal: '💚' };

  function mount(main, side) {
    idx = 0; round = 0; errs = 0; lastLen = 0; stream = new Map(); chain = Promise.resolve();
    seen = 0; fx = []; offer = null; sentOffer = null; flash = 0;
    main.innerHTML = `<div class="kc">
      <div class="kc-top"><div id="kcFighters" class="kc-fighters"></div>
        <div class="kc-clock"><span id="kcRound"></span><div class="kc-time"><i id="kcTime"></i></div><b id="kcLeft"></b></div></div>
      <div class="kc-arena"><canvas id="kcCanvas" aria-hidden="true"></canvas><div id="kcBanner" class="kc-banner" hidden></div></div>
      <div class="kc-type">
        <div id="kcOffer" class="kc-offer" hidden></div>
        <div id="kcStream" class="kc-stream" aria-live="off"></div>
        <input id="kcInput" class="kc-input" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"
          enterkeyhint="next" aria-label="Type the highlighted word, then space">
        <div id="kcNote" class="kc-note hint"></div>
      </div></div>`;
    side.innerHTML = '<div class="panel"><h3>Round stats</h3><div id="kcStats" class="kc-stats"></div></div>';
    const inp = $('kcInput');
    inp.oninput = onType;
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(inp.value.trim()); } };
    // (#375) With a real keyboard the page reads the keys itself and the box only shows them: a focused text box
    // gets the browser's and the system's word suggestions (Windows "text suggestions", autofill), which cover
    // the words to type, and autocomplete="off" doesn't stop them all. A touch screen needs the box focused for
    // its keyboard to open, so there it stays a real text box.
    keys = !window.matchMedia?.('(pointer: coarse)').matches;
    inp.readOnly = keys; inp.tabIndex = keys ? -1 : 0;
    if (keys) inp.setAttribute('inputmode', 'none');
    inp.classList.toggle('kc-keys', keys);
    keyHook = (e) => {
      if (e.ctrlKey && e.key !== 'Backspace' || e.metaKey || e.altKey) return;
      if (!$('modal')?.hidden || (e.target !== inp && e.target?.matches?.('input, textarea, select, [contenteditable]'))) return;
      if (!K()?.playing) return;
      if (!keys) {   // touch screen with a keyboard attached: a key anywhere types into the box
        if (e.key.length === 1 && document.activeElement !== inp) inp.focus({ preventScroll: true });
        return;
      }
      let v = inp.value;
      if (e.key === 'Enter') { e.preventDefault(); submit(v.trim()); return; }
      if (e.key === 'Backspace') v = e.ctrlKey ? '' : v.slice(0, -1);
      else if (e.key === ' ') v += ' ';
      else if (/^[a-z]$/i.test(e.key)) v += e.key.toLowerCase();
      else return;
      e.preventDefault(); e.stopPropagation();
      inp.value = v;
      onType();
    };
    addEventListener('keydown', keyHook, true);
    const loop = () => { raf = requestAnimationFrame(loop); draw(); tickClock(); };
    raf = requestAnimationFrame(loop);
  }

  function unmount() { cancelAnimationFrame(raf); raf = 0; if (keyHook) removeEventListener('keydown', keyHook, true); keyHook = null; }

  // ---------- typing

  const target = () => stream.get(idx) || '';
  const offerWords = () => (offer ? Object.values(offer) : []);

  function onType() {
    const inp = $('kcInput');
    let v = inp.value.toLowerCase().replace(/[^a-z ]/g, '');
    if (v.includes(' ')) {   // space finishes the word
      const w = v.split(' ')[0];
      v = '';
      inp.value = '';
      lastLen = 0;
      if (w) { if (!submit(w)) { inp.value = w; lastLen = w.length; } }
      paintStream();
      return;
    }
    if (v !== inp.value) inp.value = v;
    // a letter added that doesn't fit the word (or any power word) is a typo: it counts, and must be fixed
    const ok = (w) => w.startsWith(v);
    if (v.length > lastLen && !ok(target()) && !offerWords().some(ok)) { errs++; ctx.sfx?.('tick'); }
    lastLen = v.length;
    paintStream();
  }

  function submit(w) {
    const k = K();
    if (!k?.playing || !w) return false;
    const kind = offer && Object.keys(offer).find((key) => offer[key] === w);
    let body;
    if (kind) { body = { word: w, errs }; sentOffer = offer; offer = null; }
    else if (w === target()) { body = { i: idx, word: w, errs }; idx++; }
    else { nudge(); return false; }
    errs = 0; lastLen = 0;
    const inp = $('kcInput'); inp.value = '';
    // words go one after another, in order: the server counts word i only after word i-1
    chain = chain.then(() => ctx.act('word', body)).catch(() => { resync(); });
    paintStream(); paintOffer();
    return true;
  }

  function nudge() {
    const box = $('kcStream');
    if (!box) return;
    box.classList.remove('kc-shake'); void box.offsetWidth; box.classList.add('kc-shake');
    ctx.sfx?.('wrong');
    $('kcNote').textContent = 'Fix the red letters first.';
  }

  function resync() {
    const me = K()?.fighters.find((f) => f.id === S.me.id);
    if (me) idx = me.idx;
    offer = K()?.offer || null;
    paintStream(); paintOffer();
  }

  // ---------- render

  function render(s, c) {
    S = s; ctx = c;
    const k = K();
    if (!k) return;
    if (k.round !== round) {   // a new round: a new stream from the start
      round = k.round; idx = 0; errs = 0; lastLen = 0; stream = new Map(); offer = null; sentOffer = null;
      chain = Promise.resolve(); fx = []; $('kcInput').value = '';
    }
    k.words.forEach((w, i) => stream.set(k.base + i, w));
    const me = k.fighters.find((f) => f.id === S.me.id);
    if (me && me.idx > idx) idx = me.idx;                    // the server is ahead of us (a reload)
    if (!k.playing && me) idx = Math.max(idx, me.idx);
    if (!me) idx = k.base;                                    // watching: follow the leader
    // the power offer: the server's, unless we've just used it and the server hasn't caught up
    if (k.offer && sentOffer && JSON.stringify(k.offer) === JSON.stringify(sentOffer)) offer = null;
    else { offer = k.offer || null; sentOffer = null; }
    left = k.left; leftAt = performance.now();
    for (const e of k.events) if (e.n > seen) { seen = e.n; play(e); }
    const inp = $('kcInput');
    inp.disabled = !k.playing;
    inp.placeholder = k.playing ? 'type here…' : me?.ko ? '💫 knocked out' : k.stage === 'reveal' ? 'next round soon…' : 'watching';
    if (!keys && k.playing && !ctx.replay && document.activeElement !== inp && !document.querySelector('#modal:not([hidden])')) inp.focus({ preventScroll: true });
    if (keys && document.activeElement === inp) inp.blur();
    inp.classList.toggle('live', keys && k.playing);
    $('kcRound').textContent = `Round ${k.round}`;
    paintFighters(); paintStream(); paintOffer(); paintBanner(); paintStats();
  }

  function paintFighters() {
    const k = K(), box = $('kcFighters');
    box.replaceChildren(...k.fighters.map((f) => {
      const p = ctx.player(f.id), card = ctx.el('div', 'kc-f' + (f.id === S.me.id ? ' me' : '') + (f.ko ? ' ko' : ''));
      card.style.setProperty('--h', hue(f.id));
      const head = ctx.el('div', 'kc-f-head');
      head.append(ctx.el('b', 'kc-name', p?.name ?? '?'), ctx.el('span', 'kc-wins', '🏆'.repeat(f.wins) + '·'.repeat(Math.max(0, k.need - f.wins))));
      card.append(head);
      if (k.mode !== 'race') {
        const hp = ctx.el('div', 'kc-hp'), fill = ctx.el('i'), sh = ctx.el('s');
        fill.style.width = `${(100 * f.hp) / k.hp}%`; fill.style.background = `hsl(${Math.round((120 * f.hp) / k.hp)} 75% 50%)`;   // green → red
        sh.style.width = `${Math.min(100, (100 * f.shield) / k.hp)}%`;
        hp.append(fill, sh, ctx.el('em', '', `${f.hp}`));
        const ch = ctx.el('div', 'kc-charge' + (f.power ? ' full' : '')), cf = ctx.el('i');
        cf.style.width = `${(100 * f.charge) / k.charge}%`;
        ch.append(cf);
        card.append(hp, ch);
      } else {
        const lead = Math.max(1, ...k.fighters.map((x) => x.chars));
        const bar = ctx.el('div', 'kc-hp kc-race'), fill = ctx.el('i');
        fill.style.width = `${(100 * f.chars) / lead}%`;
        bar.append(fill, ctx.el('em', '', `${f.chars} letters`));
        card.append(bar);
      }
      const tgt = f.target && f.target !== S.me.id && f.id === S.me.id ? ` · 🎯 ${ctx.player(f.target)?.name ?? ''}` : '';
      card.append(ctx.el('div', 'kc-f-stats', `${f.wpm} wpm · ${f.acc}%` + (f.combo > 1 ? ` · 🔥${f.combo}` : '') + tgt));
      return card;
    }));
  }

  function paintStream() {
    const box = $('kcStream');
    if (!box || !S) return;
    const typed = $('kcInput').value, w = target(), parts = [];
    $('kcInput').style.setProperty('--kc-caret', `${typed.length}ch`);   // the drawn caret (#375)
    const cur = ctx.el('span', 'kc-cur');
    let bad = false;
    for (let i = 0; i < Math.max(w.length, typed.length); i++) {
      const ch = w[i] ?? '', t = typed[i];
      const cls = t == null ? '' : !bad && t === ch ? 'ok' : (bad = true, 'bad');
      cur.append(ctx.el('span', cls, t != null && cls === 'bad' ? t : ch || t));
    }
    if (!w) cur.textContent = '…';
    parts.push(cur);
    for (let i = 1; i <= 6; i++) { const n = stream.get(idx + i); if (n) parts.push(ctx.el('span', 'kc-next', n)); }
    box.replaceChildren(...parts);
    box.classList.toggle('kc-err', bad);
    if (!bad) $('kcNote').textContent = '';
  }

  function paintOffer() {
    const box = $('kcOffer');
    box.hidden = !offer || !K()?.playing;
    if (box.hidden) return;
    const typed = $('kcInput').value;
    box.replaceChildren(ctx.el('span', 'kc-offer-tip', '⚡ Type one:'), ...Object.entries(offer).map(([kind, w]) => {
      const chip = ctx.el('span', `kc-pw kc-pw-${kind}` + (typed && w.startsWith(typed) ? ' on' : ''), `${ICON[kind]} ${w}`);
      return chip;
    }));
  }

  function paintBanner() {
    const k = K(), b = $('kcBanner');
    if (k.stage !== 'reveal' || !k.result) { b.hidden = true; return; }
    const w = k.result.winner && ctx.player(k.result.winner);
    b.hidden = false;
    b.textContent = w ? (w.id === S.me.id ? '🏆 You take the round!' : `🏆 ${w.name} takes the round`) : '🤝 A drawn round';
  }

  function paintStats() {
    const k = K(), box = $('kcStats');
    const st = k.result?.stats;
    const rows = k.fighters.map((f) => {
      const s = st?.[f.id] || { wpm: f.wpm, acc: f.acc, words: f.words };
      const r = ctx.el('div', 'kc-stat-row');
      r.append(ctx.el('b', '', ctx.player(f.id)?.name ?? '?'), ctx.el('span', '', `${s.wpm} wpm · ${s.acc}% · ${s.words} words` + (s.best ? ` · best 🔥${s.best}` : '')));
      return r;
    });
    box.replaceChildren(...rows);
  }

  function tickClock() {
    const k = S && K();
    if (!k) return;
    const l = Math.max(0, left - (performance.now() - leftAt) / 1000);
    const t = $('kcTime'), lb = $('kcLeft');
    if (t) { t.style.width = `${(100 * l) / k.secs}%`; t.classList.toggle('low', k.stage === 'play' && l < 10); }
    if (lb) lb.textContent = k.stage === 'play' ? `${Math.ceil(l)}s` : '';
  }

  // ---------- the arena

  function play(e) {
    const now = performance.now();
    fx.push({ ...e, at: now });
    if (e.to === S.me.id && e.kind !== 'block') { ctx.sfx?.(e.kind === 'strike' ? 'boom' : 'thud'); ctx.buzz?.(e.kind === 'strike' ? 60 : 15); flash = now; }
    else if (e.by === S.me.id) ctx.sfx?.(e.kind === 'strike' ? 'boom' : e.kind === 'heal' ? 'good' : e.kind === 'shield' ? 'lock' : 'pop');
  }

  function spots(w, h, list) {
    // two fighters face each other; more stand round in an arc
    const n = list.length, out = new Map();
    list.forEach((f, i) => {
      const x = n === 2 ? (i ? w * 0.75 : w * 0.25) : w * (0.12 + (0.76 * i) / Math.max(1, n - 1));
      const y = h * (n === 2 ? 0.62 : 0.55 + 0.12 * Math.sin((Math.PI * i) / Math.max(1, n - 1)));
      out.set(f.id, { x, y, face: n === 2 ? (i ? -1 : 1) : x < w / 2 ? 1 : -1 });
    });
    return out;
  }

  function draw() {
    const cv = $('kcCanvas');
    if (!cv || !S || !K()) return;
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (!r.width || !r.height) return;
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    const g = cv.getContext('2d');
    if (!g) return;
    const w = r.width, h = r.height, now = performance.now(), k = K();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the floor: a dusk sky over a lit stage
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#1b1e3a'); sky.addColorStop(0.7, '#2c2550'); sky.addColorStop(1, '#3b2a4a');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff10';
    for (let i = 0; i < 24; i++) g.fillRect((i * 97.3) % w, (i * 41.7) % (h * 0.5), 2, 2);
    const floorY = h * 0.78;
    const fl = g.createLinearGradient(0, floorY, 0, h);
    fl.addColorStop(0, '#4b3a66'); fl.addColorStop(1, '#251c33');
    g.fillStyle = fl; g.fillRect(0, floorY, w, h - floorY);
    if (k.mode === 'race') return drawRace(g, w, h, k, now);
    const at = spots(w, h, k.fighters), size = Math.min(56, h * 0.22, w / (k.fighters.length * 2.6));
    // the bolts: a word flies from its typist to its target
    fx = fx.filter((e) => now - e.at < 1100);
    for (const f of k.fighters) {
      const p = at.get(f.id), hurt = fx.find((e) => e.to === f.id && e.kind !== 'block' && now - e.at > 280 && now - e.at < 560);
      const ko = f.ko, bob = ko ? 0 : Math.sin(now / 300 + p.x) * 3;
      const lunge = fx.find((e) => e.by === f.id && (e.kind === 'hit' || e.kind === 'strike') && now - e.at < 220) ? 10 * p.face : 0;
      const shake = hurt ? Math.sin(now / 18) * 4 : 0;
      drawFighter(g, p.x + lunge + shake, p.y + bob, size, hue(f.id), p.face, ko, !!hurt, f.shield > 0, f.id === S.me.id, now);
    }
    for (const e of fx) {
      const a = at.get(e.by), b = e.to && at.get(e.to), t = (now - e.at) / 1000;
      if (!a) continue;
      if ((e.kind === 'hit' || e.kind === 'strike' || e.kind === 'block') && b) {
        const u = Math.min(1, t / 0.3), x = a.x + (b.x - a.x) * u, y = a.y - size * 0.5 + (b.y - a.y) * u - Math.sin(Math.PI * u) * size * 0.6;
        if (u < 1) {
          const big = e.kind === 'strike';
          g.fillStyle = `hsl(${hue(e.by)} 90% 65%)`; g.shadowColor = g.fillStyle; g.shadowBlur = big ? 20 : 10;
          g.beginPath(); g.arc(x, y, big ? 9 : 5, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
        } else {
          const v = (t - 0.3) / 0.8;
          g.globalAlpha = Math.max(0, 1 - v);
          g.fillStyle = e.kind === 'block' ? '#9ad7ff' : e.kind === 'strike' ? '#ffcf5a' : '#ff8a8a';
          g.font = `800 ${e.kind === 'strike' ? 22 : 15}px system-ui, sans-serif`; g.textAlign = 'center';
          g.fillText(e.kind === 'block' ? '🛡️' : `-${e.dmg}`, b.x, b.y - size * 1.3 - v * 24);
          g.globalAlpha = 1;
        }
      } else if (e.kind === 'heal' || e.kind === 'shield') {
        g.globalAlpha = Math.max(0, 1 - t);
        g.font = '700 16px system-ui, sans-serif'; g.textAlign = 'center'; g.fillStyle = e.kind === 'heal' ? '#7dffa8' : '#9ad7ff';
        g.fillText(e.kind === 'heal' ? `+${e.dmg}` : '🛡️', a.x, a.y - size * 1.3 - t * 26);
        g.globalAlpha = 1;
      }
    }
    if (now - flash < 180) { g.fillStyle = `rgba(255,60,60,${0.25 * (1 - (now - flash) / 180)})`; g.fillRect(0, 0, w, h); }
  }

  function drawFighter(g, x, y, s, h, face, ko, hurt, shield, me, now) {
    g.save();
    g.translate(x, y);
    if (ko) g.rotate(face * 1.25);
    // shadow on the floor
    g.fillStyle = '#00000055'; g.beginPath(); g.ellipse(0, s * 0.55, s * 0.6, s * 0.14, 0, 0, Math.PI * 2); g.fill();
    // a round little fighter: body, belly, ears, eyes, a fist held up
    const body = g.createRadialGradient(-s * 0.2, -s * 0.35, s * 0.1, 0, 0, s * 0.75);
    body.addColorStop(0, `hsl(${h} 85% ${hurt ? 85 : 68}%)`); body.addColorStop(1, `hsl(${h} 70% ${hurt ? 60 : 40}%)`);
    g.fillStyle = body;
    g.beginPath(); g.ellipse(0, 0, s * 0.55, s * 0.6, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(-s * 0.32, -s * 0.5, s * 0.14, 0, Math.PI * 2); g.arc(s * 0.32, -s * 0.5, s * 0.14, 0, Math.PI * 2); g.fill();
    g.fillStyle = `hsl(${h} 60% 85% / .5)`; g.beginPath(); g.ellipse(0, s * 0.18, s * 0.3, s * 0.28, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1a1a22';
    if (ko) {
      g.strokeStyle = '#1a1a22'; g.lineWidth = 2.2;
      for (const ex of [-0.18, 0.18]) { g.beginPath(); g.moveTo(s * (ex - 0.07), -s * 0.2); g.lineTo(s * (ex + 0.07), -s * 0.06); g.moveTo(s * (ex + 0.07), -s * 0.2); g.lineTo(s * (ex - 0.07), -s * 0.06); g.stroke(); }
    } else {
      const blink = Math.sin(now / 900 + h) > 0.985 ? 0.2 : 1;
      for (const ex of [-0.18, 0.18]) { g.beginPath(); g.ellipse(s * (ex + 0.05 * face), -s * 0.14, s * 0.06, s * 0.09 * blink, 0, 0, Math.PI * 2); g.fill(); }
    }
    if (!ko) {   // the fist, out toward the rival
      g.fillStyle = `hsl(${h} 75% 55%)`; g.beginPath(); g.arc(face * s * 0.62, s * 0.05, s * 0.16, 0, Math.PI * 2); g.fill();
    }
    if (shield) {
      g.strokeStyle = '#9ad7ffcc'; g.lineWidth = 3; g.shadowColor = '#9ad7ff'; g.shadowBlur = 12;
      g.beginPath(); g.arc(0, 0, s * 0.85, 0, Math.PI * 2); g.stroke(); g.shadowBlur = 0;
    }
    g.restore();
    if (me) { g.fillStyle = '#ffffffcc'; g.font = '700 11px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('YOU', x, y - s * 0.85); }
  }

  function drawRace(g, w, h, k, now) {
    // ⌨️ Pure Typing: a lane each; the runner moves with the letters typed, the leader sets the scale
    const n = k.fighters.length, lead = Math.max(40, ...k.fighters.map((f) => f.chars)) * 1.1, lane = h / (n + 1);
    k.fighters.forEach((f, i) => {
      const y = lane * (i + 1), x = 30 + (w - 70) * (f.chars / lead);
      g.strokeStyle = '#ffffff22'; g.setLineDash([6, 8]); g.beginPath(); g.moveTo(20, y + 16); g.lineTo(w - 20, y + 16); g.stroke(); g.setLineDash([]);
      drawFighter(g, x, y + Math.sin(now / 120 + i) * (f.wpm ? 2 : 0), Math.min(30, lane * 0.6), hue(f.id), 1, false, false, false, f.id === S.me.id, now);
    });
  }

  function turnText(s) {
    const k = s.keyclash;
    if (!k || s.phase !== 'playing') return null;
    if (k.stage === 'reveal') return 'Round over';
    return k.playing ? '⌨️ Type!' : null;
  }

  function myMove(s) { return !!s.keyclash?.playing; }

  // the round's clock is on the screen itself; the room's deadline is only the next bot's word
  const ownTimer = () => true;

  return { mount, render, unmount, turnText, myMove, ownTimer };
})();
