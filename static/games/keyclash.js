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
    seen = 0; fx = []; offer = null; sentOffer = null; flash = 0; parts = []; knocked.clear(); bgCache = null;
    main.innerHTML = `<div class="kc">
      <div class="kc-top"><div id="kcFighters" class="kc-fighters"></div>
        <div class="kc-clock"><span id="kcRound"></span><div class="kc-time"><i id="kcTime"></i></div><b id="kcLeft"></b></div></div>
      <div class="kc-arena"><canvas id="kcCanvas" aria-hidden="true"></canvas><div id="kcBanner" class="kc-banner" hidden></div>
        <div id="kcReport" class="kc-report" hidden></div></div>
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
      // (#383) Esc pauses and resumes (P is a letter here); while paused, keys type nothing
      if (e.key === 'Escape' && S?.phase === 'playing' && S.canPause && $('modal')?.hidden !== false) {
        e.preventDefault(); ctx.quiet(ctx.act(S.paused ? 'resume' : 'pause')); return;
      }
      // while paused P can't be a letter, so it resumes as in other games (#383, sent back: "not able to resume with escape or p")
      if (S?.paused && (e.key === 'p' || e.key === 'P') && !e.repeat && S.canPause && $('modal')?.hidden !== false) {
        e.preventDefault(); e.stopPropagation(); ctx.quiet(ctx.act('resume')); return;
      }
      if (S?.paused) { if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Enter') e.preventDefault(); return; }
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
    if (k.rid !== round) {   // a new round, or a new game (a rematch starts at round 1 again): a new stream from the start
      round = k.rid; idx = 0; errs = 0; lastLen = 0; stream = new Map(); offer = null; sentOffer = null;
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
    inp.disabled = !k.playing || !!S.paused;
    if (!k.playing && inp.value) { inp.value = ''; errs = 0; lastLen = 0; }   // a round over (or knocked out): start clean
    inp.placeholder = S.paused ? '⏸ paused · Esc or P to carry on' : k.playing ? (S.canPause ? 'type here… (Esc pauses)' : 'type here…') : me?.ko ? '💫 knocked out' : k.stage === 'reveal' ? 'next round soon…' : 'watching';
    if (!keys && k.playing && !ctx.replay && document.activeElement !== inp && !document.querySelector('#modal:not([hidden])')) inp.focus({ preventScroll: true });
    if (keys && document.activeElement === inp) inp.blur();
    inp.classList.toggle('live', keys && k.playing);
    $('kcRound').textContent = `Round ${k.round}`;
    paintFighters(); paintStream(); paintOffer(); paintBanner(); paintStats(); paintReport();
  }

  // ---------- (#381) typing analytics: between rounds the round just played, after the match every round

  let reportRound = null, reportKey = '';
  const SVG = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(SVG, tag); for (const [a, v] of Object.entries(attrs)) e.setAttribute(a, v); return e; };
  const color = (id) => `hsl(${hue(id)} 80% 62%)`;
  const nameOf = (id) => ctx.player(id)?.name ?? '?';

  // speed through the round: words a minute over the last five words, at each word
  function speedLine(trace) {
    return trace.map(([t, chars, errs], i) => {
      const j = Math.max(-1, i - 5), t0 = j < 0 ? 0 : trace[j][0], c0 = j < 0 ? 0 : trace[j][1];
      return { t, wpm: t > t0 ? ((chars - c0) / 5) / ((t - t0) / 60) : 0, errs };
    });
  }

  function paintReport() {
    const k = K(), box = $('kcReport');
    const over = S.phase !== 'playing', hist = k.history || [];
    if (!hist.length || (!over && k.stage !== 'reveal')) { box.hidden = true; reportKey = ''; return; }
    const key = `${k.rid}:${hist.length}:${over}`;
    if (key === reportKey && !box.hidden) return;   // drawn already: keep the hover state
    reportKey = key;
    if (!over || reportRound == null || reportRound >= hist.length) reportRound = hist.length - 1;
    box.hidden = false;
    const h = hist[reportRound], ids = Object.keys(h.trace).filter((id) => k.fighters.some((f) => f.id === id) || h.stats[id]);
    const head = ctx.el('div', 'kc-rep-head');
    const won = h.winners.length === 1 ? ` · 🏆 ${nameOf(h.winners[0])}` : h.winners.length ? ` · 🏆 ${h.winners.map(nameOf).join(', ')}` : ' · 🤝 a draw';
    head.append(ctx.el('b', '', (over ? `📈 How everyone typed · round ${h.round}` : `📈 Round ${h.round}`) + won));
    if (over && hist.length > 1) {
      const tabs = ctx.el('div', 'kc-rep-tabs');
      hist.forEach((x, i) => { const b = ctx.el('button', 'ghost-btn' + (i === reportRound ? ' on' : ''), `Round ${x.round}`); b.onclick = () => { reportRound = i; reportKey = ''; paintReport(); }; tabs.append(b); });
      head.append(tabs);
    }
    if (over) { const x = ctx.el('button', 'ghost-btn kc-rep-close', '✕'); x.title = 'Hide the charts'; x.onclick = () => { box.hidden = true; }; head.append(x); }
    box.replaceChildren(head, chart(h, ids), legend(ids), table(hist, ids, over ? null : reportRound));
  }

  function chart(h, ids) {
    const W = 560, H = 190, L = 34, R = 70, T = 10, B = 24;
    const lines = Object.fromEntries(ids.map((id) => [id, speedLine(h.trace[id] || [])]));
    const tMax = Math.max(5, h.secs, ...ids.flatMap((id) => lines[id].map((p) => p.t)));
    const top = Math.max(30, ...ids.flatMap((id) => lines[id].map((p) => p.wpm))) * 1.1;
    const step = top > 150 ? 50 : top > 60 ? 20 : 10;
    const x = (t) => L + ((W - L - R) * t) / tMax, y = (v) => T + (H - T - B) * (1 - v / top);
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'kc-chart', role: 'img', 'aria-label': 'Words a minute through the round, one line per player' });
    for (let v = 0; v <= top; v += step) {   // a recessive grid, labelled on the left
      svg.append(svgEl('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'kc-grid' }));
      const lab = svgEl('text', { x: L - 6, y: y(v) + 4, class: 'kc-axis', 'text-anchor': 'end' }); lab.textContent = v; svg.append(lab);
    }
    const tStep = tMax > 300 ? 60 : tMax > 90 ? 30 : 15;
    for (let t = 0; t <= tMax; t += tStep) { const lab = svgEl('text', { x: x(t), y: H - 6, class: 'kc-axis', 'text-anchor': 'middle' }); lab.textContent = `${t}s`; svg.append(lab); }
    const ylab = svgEl('text', { x: L, y: T - 1, class: 'kc-axis' }); ylab.textContent = 'wpm'; svg.append(ylab);
    const ends = [];
    for (const id of ids) {
      const pts = lines[id];
      if (!pts.length) continue;
      svg.append(svgEl('polyline', { points: pts.map((p) => `${x(p.t).toFixed(1)},${y(p.wpm).toFixed(1)}`).join(' '), class: 'kc-line', stroke: color(id) }));
      for (const p of pts) if (p.errs) svg.append(svgEl('circle', { cx: x(p.t), cy: y(p.wpm), r: 4, class: 'kc-typo' }));   // a typo on this word
      const last = pts[pts.length - 1];
      ends.push({ id, y: y(last.wpm), x: x(last.t) });
    }
    ends.sort((a, b) => a.y - b.y);   // direct labels at the line ends, nudged apart
    for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 12);
    for (const e of ends) { const t = svgEl('text', { x: Math.min(W - R + 4, e.x + 4), y: e.y + 4, class: 'kc-endlab' }); t.textContent = nameOf(e.id); svg.append(t); }
    // hover: a crosshair and everyone's speed at that moment
    const cross = svgEl('line', { y1: T, y2: H - B, class: 'kc-cross', visibility: 'hidden' }), tip = ctx.el('div', 'kc-tip');
    tip.hidden = true;
    const hit = svgEl('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' });
    svg.append(cross, hit);
    const wrap = ctx.el('div', 'kc-chart-wrap');
    hit.addEventListener('pointermove', (ev) => {
      const r = svg.getBoundingClientRect(), t = ((ev.clientX - r.left) * (W / r.width) - L) / (W - L - R) * tMax;
      cross.setAttribute('x1', x(t)); cross.setAttribute('x2', x(t)); cross.setAttribute('visibility', 'visible');
      tip.replaceChildren(ctx.el('b', '', `${Math.round(t)} s`), ...ids.map((id) => {
        const p = [...lines[id]].reverse().find((q) => q.t <= t);
        const row = ctx.el('div', 'kc-tip-row'), sw = ctx.el('i'); sw.style.background = color(id);
        row.append(sw, ctx.el('span', '', nameOf(id)), ctx.el('b', '', p ? `${Math.round(p.wpm)} wpm` : '–'));
        return row;
      }));
      tip.hidden = false;
      tip.style.left = `${Math.min(r.width - 150, ev.clientX - r.left + 12)}px`;
    });
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; });
    wrap.append(svg, tip);
    return wrap;
  }

  function legend(ids) {
    const box = ctx.el('div', 'kc-legend');
    for (const id of ids) { const it = ctx.el('span', ''), sw = ctx.el('i'); sw.style.background = color(id); it.append(sw, nameOf(id)); box.append(it); }
    const typo = ctx.el('span', 'kc-legend-typo'), ring = ctx.el('i'); typo.append(ring, 'a word with a typo');
    box.append(typo);
    return box;
  }

  // the numbers behind it: each round (or just this one), each player
  function table(hist, ids, only) {
    const t = ctx.el('table', 'kc-rep-table'), head = ctx.el('tr');
    head.append(ctx.el('th', '', ''), ...ids.map((id) => ctx.el('th', '', nameOf(id))));
    t.append(head);
    for (const [i, h] of hist.entries()) {
      if (only != null && i !== only) continue;
      const row = ctx.el('tr');
      row.append(ctx.el('th', '', `Round ${h.round}`), ...ids.map((id) => {
        const s = h.stats[id];
        return ctx.el('td', h.winners.includes(id) ? 'won' : '', s ? `${s.wpm} wpm · ${s.acc}% · ${s.words} words` + (h.winners.includes(id) ? ' 🏆' : '') : '–');
      }));
      t.append(row);
    }
    if (only == null && hist.length > 1) {   // the match as a whole
      const row = ctx.el('tr', 'kc-rep-total');
      row.append(ctx.el('th', '', 'Match'), ...ids.map((id) => {
        const rs = hist.map((h) => h.stats[id]).filter(Boolean);
        const wpm = Math.round(rs.reduce((a, s) => a + s.wpm, 0) / Math.max(1, rs.length)), best = Math.max(0, ...rs.map((s) => s.best || 0));
        const acc = Math.round(rs.reduce((a, s) => a + s.acc, 0) / Math.max(1, rs.length));
        return ctx.el('td', '', `avg ${wpm} wpm · ${acc}% · best 🔥${best}`);
      }));
      t.append(row);
    }
    const wrap = ctx.el('div', 'kc-rep-tablewrap'); wrap.append(t);
    return wrap;
  }

  function paintFighters() {
    const k = K(), box = $('kcFighters');
    box.replaceChildren(...k.fighters.map((f) => {
      const p = ctx.player(f.id), card = ctx.el('div', 'kc-f' + (f.id === S.me.id ? ' me' : '') + (f.ko ? ' ko' : ''));
      card.style.setProperty('--h', hue(f.id));
      const head = ctx.el('div', 'kc-f-head');
      head.append(ctx.el('b', 'kc-name', p?.name ?? '?'), ctx.el('span', 'kc-wins', '🏆'.repeat(f.wins) + '·'.repeat(Math.max(0, k.need - f.wins))));
      card.append(head);
      const bar = (cls, frac, label, color) => {
        const el = ctx.el('div', 'kc-hp ' + cls), fill = ctx.el('i');
        fill.style.width = `${Math.max(0, Math.min(100, 100 * frac))}%`;
        if (color) fill.style.background = color;
        el.append(fill, ctx.el('em', '', label));
        return el;
      };
      if (k.powered) {
        const hp = bar('', f.hp / k.hp, (k.mode === 'siege' ? '🏰 ' : '') + f.hp + (f.shield > 0 ? ` · 🛡️ ${f.shield}` : ''), `hsl(${Math.round((120 * f.hp) / k.hp)} 75% 50%)`);   // green → red; (#380) shield left
        if (f.shield > 0) hp.title = `Shield: blocks the next ${f.shield} damage`;
        const sh = ctx.el('s'); sh.style.width = `${Math.min(100, (100 * f.shield) / k.hp)}%`; hp.insertBefore(sh, hp.lastChild);
        card.append(hp);
        if (k.mode === 'boss') card.append(bar('kc-boss', f.boss / k.bossMax, `👹 ${f.boss}`));
        const ch = ctx.el('div', 'kc-charge' + (f.power ? ' full' : '')), cf = ctx.el('i');
        cf.style.width = `${(100 * f.charge) / k.charge}%`;
        ch.append(cf);
        card.append(ch);
      } else if (k.mode === 'hyper') {
        card.append(bar('kc-race', f.dist / k.track, `🚀 ${Math.round((100 * f.dist) / k.track)}%`));
      } else if (k.mode === 'tug') {
        card.classList.add('kc-team' + f.team);
        card.append(ctx.el('div', 'kc-f-team', k.teams[f.team]));
      } else {
        const lead = k.goal || Math.max(1, ...k.fighters.map((x) => x.chars));   // with no time limit, a race to the goal (#379)
        card.append(bar('kc-race', f.chars / lead, k.goal ? `${f.chars} / ${k.goal}` : `${f.chars} letters`));
      }
      if (k.mode === 'survival') card.querySelector('.kc-hp em').textContent += ` · 🧟 ${f.kills}`;
      const tgt = f.target && f.target !== S.me.id && f.id === S.me.id ? ` · 🎯 ${ctx.player(f.target)?.name ?? ''}` : '';
      const line = ctx.el('div', 'kc-f-stats'), wpm = ctx.el('b', 'kc-wpm', `${f.wpm} wpm`);
      wpm.dataset.chars = f.chars;   // (#384) tickClock keeps this live between words
      line.append(wpm, ` · ${f.acc}%` + (f.combo > 1 ? ` · 🔥${f.combo}` : '') + tgt);
      card.append(line);
      return card;
    }));
  }

  function paintStream() {
    const box = $('kcStream');
    if (!box || !S) return;
    const typed = $('kcInput').value, w = target(), parts = [];
    $('kcInput').style.setProperty('--kc-caret', `${typed.length}ch`);   // the drawn caret (#375)
    // (#378) typing a power word isn't a mistake: while the letters fit one, the word waits, unmarked, and the
    // power word's chip fills in instead
    const power = typed && !w.startsWith(typed) && offerWords().find((x) => x.startsWith(typed));
    if (power) {
      const cur = ctx.el('span', 'kc-cur kc-wait', w || '…');
      box.replaceChildren(cur, ...[1, 2, 3, 4, 5, 6].map((i) => stream.get(idx + i)).filter(Boolean).map((n) => ctx.el('span', 'kc-next', n)));
      box.classList.remove('kc-err');
      $('kcNote').textContent = '⚡ Power word: finish it and press space';
      paintOffer();
      return;
    }
    const cur = ctx.el('span', 'kc-cur');
    // (#377) the word's own letters always stay on screen: a wrong one turns red and the letter you typed shows
    // small above it; letters typed past the end are struck out; the next letter to type is underlined
    let bad = false;
    for (let i = 0; i < Math.max(w.length, typed.length); i++) {
      const ch = w[i], t = typed[i];
      if (ch == null) { cur.append(ctx.el('span', 'extra', t)); bad = true; continue; }
      if (t == null) { cur.append(ctx.el('span', i === typed.length && !bad ? 'next' : '', ch)); continue; }
      const ok = !bad && t === ch;
      const span = ctx.el('span', ok ? 'ok' : 'bad', ch);
      if (!ok) { bad = true; if (t !== ch) span.dataset.typed = t; }
      cur.append(span);
    }
    if (!w) cur.textContent = '…';
    parts.push(cur);
    for (let i = 1; i <= 6; i++) { const n = stream.get(idx + i); if (n) parts.push(ctx.el('span', 'kc-next', n)); }
    box.replaceChildren(...parts);
    box.classList.toggle('kc-err', bad);
    if (!bad) $('kcNote').textContent = '';
    if (offer) paintOffer();
  }

  function paintOffer() {
    const box = $('kcOffer');
    box.hidden = !offer || !K()?.playing;
    if (box.hidden) return;
    const typed = $('kcInput').value;
    box.replaceChildren(ctx.el('span', 'kc-offer-tip', '⚡ Type one:'), ...Object.entries(offer).map(([kind, w]) => {
      const on = typed && w.startsWith(typed), chip = ctx.el('span', `kc-pw kc-pw-${kind}` + (on ? ' on' : ''), `${ICON[kind]} `);
      if (on) chip.append(ctx.el('b', '', w.slice(0, typed.length)), w.slice(typed.length));   // the letters typed so far
      else chip.append(w);
      const what = K()?.effects?.[kind];   // (#380) what it does
      if (what) { chip.append(ctx.el('small', 'kc-pw-what', what)); chip.title = what; }
      return chip;
    }));
  }

  function paintBanner() {
    const k = K(), b = $('kcBanner');
    if (k.stage !== 'reveal' || !k.result) { b.hidden = true; return; }
    const w = k.result.winner && ctx.player(k.result.winner);
    b.hidden = false;
    if (k.mode === 'tug' && k.result.team != null) { b.textContent = `🏆 ${k.teams[k.result.team]} takes the round`; return; }
    b.textContent = w ? (w.id === S.me.id ? '🏆 You take the round!' : `🏆 ${w.name} takes the round`) : '🤝 A drawn round';
  }

  function paintStats() {
    const k = K(), box = $('kcStats');
    const st = k.result?.stats;
    const rows = k.fighters.map((f) => {
      const s = st?.[f.id] || { wpm: f.wpm, acc: f.acc, words: f.words };
      const r = ctx.el('div', 'kc-stat-row');
      const span = ctx.el('span', ''), wpm = ctx.el('span', st ? '' : 'kc-wpm', `${s.wpm} wpm`);
      if (!st) wpm.dataset.chars = f.chars;   // (#384) live during the round
      span.append(wpm, ` · ${s.acc}% · ${s.words} words` + (s.best ? ` · best 🔥${s.best}` : '') + (k.mode === 'survival' && s.kills != null ? ` · 🧟 ${s.kills}` : ''));
      r.append(ctx.el('b', '', ctx.player(f.id)?.name ?? '?'), span);
      return r;
    });
    box.replaceChildren(...rows);
  }

  function tickClock() {
    const k = S && K();
    if (!k) return;
    // (#384) words a minute move with the clock, not only when a word lands: letters so far over the time so far
    if (k.stage === 'play' && k.elapsed != null) {
      const t = k.elapsed + (S.paused ? 0 : (performance.now() - leftAt) / 1000);
      if (t > 1) for (const el of document.querySelectorAll('#kcFighters .kc-wpm, #kcStats .kc-wpm')) el.textContent = `${Math.round(+el.dataset.chars / 5 / (t / 60))} wpm`;
    }
    const l = Math.max(0, left - (S.paused ? 0 : (performance.now() - leftAt) / 1000));   // (#383) a paused clock stands still
    const t = $('kcTime'), lb = $('kcLeft');
    if (k.unlimited) {   // (#379) no time limit: the round goes on until someone wins
      if (t) { t.style.width = '100%'; t.classList.remove('low'); t.classList.add('none'); }
      if (lb) lb.textContent = k.overtime ? '∞ ⏱️ overtime' : '∞';
      return;
    }
    t?.classList.remove('none');
    if (t) { t.style.width = `${(100 * l) / k.secs}%`; t.classList.toggle('low', k.stage === 'play' && l < 10); }
    if (lb) lb.textContent = k.stage === 'play' ? `${Math.ceil(l)}s` : '';
  }

  // ---------- the arena

  // (#382) the backdrop: dusk sky, a low moon, two ranges of hills, spotlights and a stage floor with perspective
  let bgCache = null;
  function backdrop(w, h, dpr) {
    const key = `${w}x${h}x${dpr}`;
    if (bgCache?.key === key) return bgCache.cv;
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const g = cv.getContext('2d');
    if (!g) return cv;
    g.scale(dpr, dpr);
    const floorY = h * 0.78;
    const sky = g.createLinearGradient(0, 0, 0, floorY);
    sky.addColorStop(0, '#120f2b'); sky.addColorStop(0.55, '#2a2052'); sky.addColorStop(1, '#4a2d5e');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${0.08 + (i % 5) * 0.04})`; g.fillRect((i * 97.3) % w, (i * 41.7) % (h * 0.5), i % 7 ? 1 : 2, i % 7 ? 1 : 2); }
    const mx = w * 0.8, my = h * 0.22, mr = Math.min(w, h) * 0.07;   // the moon, with a halo
    const halo = g.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 4);
    halo.addColorStop(0, 'rgba(255,236,200,0.25)'); halo.addColorStop(1, 'rgba(255,236,200,0)');
    g.fillStyle = halo; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff1d6'; g.beginPath(); g.arc(mx, my, mr, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.08)'; g.beginPath(); g.arc(mx - mr * 0.3, my - mr * 0.2, mr * 0.25, 0, Math.PI * 2); g.arc(mx + mr * 0.25, my + mr * 0.3, mr * 0.18, 0, Math.PI * 2); g.fill();
    const hills = (base, amp, color, seed) => {
      g.fillStyle = color; g.beginPath(); g.moveTo(0, floorY);
      for (let x = 0; x <= w + 20; x += 20) g.lineTo(x, base - amp * (0.5 + 0.5 * Math.sin(x / (w * 0.13) + seed) * Math.cos(x / (w * 0.31) + seed * 2)));
      g.lineTo(w, floorY); g.closePath(); g.fill();
    };
    hills(floorY - h * 0.12, h * 0.22, '#2b2148', 1.3);
    hills(floorY - h * 0.02, h * 0.14, '#1f1838', 4.1);
    for (const sx of [0.18, 0.82]) {   // two spotlights on the stage
      const beam = g.createLinearGradient(0, 0, 0, floorY);
      beam.addColorStop(0, 'rgba(255,240,200,0)'); beam.addColorStop(1, 'rgba(255,240,200,0.10)');
      g.fillStyle = beam; g.beginPath(); g.moveTo(w * sx - 6, 0); g.lineTo(w * sx + 6, 0); g.lineTo(w * (sx + (sx < 0.5 ? 0.22 : -0.22)) + w * 0.12, floorY); g.lineTo(w * (sx + (sx < 0.5 ? 0.22 : -0.22)) - w * 0.12, floorY); g.closePath(); g.fill();
    }
    const fl = g.createLinearGradient(0, floorY, 0, h);
    fl.addColorStop(0, '#54406e'); fl.addColorStop(1, '#1d1629');
    g.fillStyle = fl; g.fillRect(0, floorY, w, h - floorY);
    g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1;
    for (let i = -8; i <= 8; i++) { g.beginPath(); g.moveTo(w / 2 + i * w * 0.04, floorY); g.lineTo(w / 2 + i * w * 0.16, h); g.stroke(); }
    for (let j = 1; j < 5; j++) { const y = floorY + (h - floorY) * (j / 5) ** 1.6; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    const rim = g.createLinearGradient(0, floorY - 2, 0, floorY + 3);
    rim.addColorStop(0, 'rgba(255,220,170,0)'); rim.addColorStop(0.5, 'rgba(255,220,170,0.35)'); rim.addColorStop(1, 'rgba(255,220,170,0)');
    g.fillStyle = rim; g.fillRect(0, floorY - 2, w, 5);
    bgCache = { key, cv };
    return cv;
  }

  // (#382) sparks where a hit lands, a burst at a knock-out, pluses rising off a heal, a ring off a new shield
  let parts = [], partAt = 0, shakeUntil = 0;
  const knocked = new Set();
  function burst(x, y, n, color, speed, kind = 'spark') {
    for (let i = 0; i < n && parts.length < 260; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.8);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (kind === 'plus' ? 40 : 0), life: 0,
        max: kind === 'plus' ? 0.8 : 0.25 + Math.random() * 0.3, color, kind, size: 1 + Math.random() * 1.5 });
    }
  }
  function sparks(g, at, k, now) {
    const dt = Math.min(0.05, (now - (partAt || now)) / 1000); partAt = now;
    if (at) {
      for (const e of fx) {
        if (e.sparked) continue;
        const delay = e.kind === 'hit' || e.kind === 'strike' ? 300 : 0;
        if (now - e.at < delay) continue;
        e.sparked = true;
        const who = HURTS.has(e.kind) || e.kind === 'block' || e.kind === 'soak' ? e.to : e.by, p = who && at.get(who);
        if (!p) continue;
        const y = p.y - (p.s || 20) * 0.2;
        if (e.kind === 'strike') burst(p.x, y, 26, '#ffd34d', 420);
        else if (HURTS.has(e.kind)) burst(p.x, y, 10, e.by ? `hsl(${hue(e.by)} 95% 70%)` : '#ff8a8a', 320);
        else if (e.kind === 'block' || e.kind === 'soak' || e.kind === 'shield') burst(p.x, y, e.kind === 'shield' ? 18 : 8, '#9ad7ff', 260);
        else if (e.kind === 'heal') burst(p.x, y, 10, '#7dffa8', 50, 'plus');
      }
      for (const f of k.fighters) {
        const p = at.get(f.id);
        if (f.ko && !knocked.has(f.id) && p) { burst(p.x, p.y, 40, `hsl(${hue(f.id)} 90% 70%)`, 480); burst(p.x, p.y, 16, '#fff', 340); }
        if (f.ko) knocked.add(f.id); else knocked.delete(f.id);
      }
    }
    parts = parts.filter((q) => (q.life += dt) < q.max);
    g.globalCompositeOperation = 'lighter';   // sparks glow where they cross
    for (const q of parts) {
      q.x += q.vx * dt; q.y += q.vy * dt; q.vy += (q.kind === 'plus' ? -30 : 300) * dt; q.vx *= 0.97;
      const a = 1 - q.life / q.max;
      g.globalAlpha = a; g.fillStyle = q.color; g.strokeStyle = q.color;
      if (q.kind === 'plus') { g.font = '700 12px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('+', q.x, q.y); }
      else {   // a streak along its flight
        g.lineWidth = q.size + 1; g.lineCap = 'round';
        g.beginPath(); g.moveTo(q.x, q.y); g.lineTo(q.x - q.vx * 0.035, q.y - q.vy * 0.035); g.stroke();
      }
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }

  const HURTS = new Set(['hit', 'strike', 'army', 'bite', 'boss']);
  function play(e) {
    const now = performance.now();
    fx.push({ ...e, at: now });
    if (e.to === S.me.id && HURTS.has(e.kind)) {
      ctx.sfx?.(e.kind === 'strike' || e.kind === 'boss' ? 'boom' : 'thud'); ctx.buzz?.(e.kind === 'strike' ? 60 : 15); flash = now;
      if ((e.kind === 'strike' || e.kind === 'boss') && !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) shakeUntil = now + 260;   // (#382)
    }
    else if (e.by === S.me.id) ctx.sfx?.({ strike: 'boom', heal: 'good', shield: 'lock', kill: 'crack', cut: 'chip', pull: 'tick' }[e.kind] || 'pop');
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
    // (#382) a painted backdrop, drawn once per size; stars twinkle over it
    g.drawImage(backdrop(w, h, dpr), 0, 0, w, h);
    for (let i = 0; i < 10; i++) {
      const a = 0.25 + 0.25 * Math.sin(now / 700 + i * 1.7);
      g.fillStyle = `rgba(255,255,255,${a})`; g.fillRect((i * 173.3 + 40) % w, (i * 61.7 + 12) % (h * 0.42), 2, 2);
    }
    if (now < shakeUntil) { const m = 5 * (shakeUntil - now) / 260; g.translate((Math.random() - 0.5) * m * 2, (Math.random() - 0.5) * m * 2); }
    fx = fx.filter((e) => now - e.at < 1100);
    const scene = { race: drawRace, hyper: drawHyper, tug: drawTug, siege: drawSiege, survival: drawSurvival, boss: drawBoss }[k.mode] || drawBrawl;
    const at = scene(g, w, h, k, now);
    sparks(g, at, k, now);
    popups(g, at, now);
    if (now - flash < 180) { g.fillStyle = `rgba(255,60,60,${0.25 * (1 - (now - flash) / 180)})`; g.fillRect(0, 0, w, h); }
  }

  // damage, heals and shields float up over whoever they happened to
  function popups(g, at, now) {
    if (!at) return;
    const stack = new Map();   // popups over the same fighter close together stack up instead of overlapping
    for (const e of fx) {
      const t = (now - e.at) / 1000, delay = e.kind === 'hit' || e.kind === 'strike' ? 0.3 : 0;
      if (t < delay) continue;
      const v = (t - delay) / 0.8, who = HURTS.has(e.kind) || e.kind === 'block' || e.kind === 'soak' ? e.to : e.by, p = who && at.get(who);
      if (!p || !['hit', 'strike', 'army', 'bite', 'boss', 'block', 'soak', 'heal', 'shield'].includes(e.kind)) continue;
      g.globalAlpha = Math.max(0, 1 - v);
      g.font = `800 ${e.kind === 'strike' || e.kind === 'boss' ? 20 : 15}px system-ui, sans-serif`; g.textAlign = 'center';
      g.fillStyle = { block: '#9ad7ff', soak: '#9ad7ff', shield: '#9ad7ff', heal: '#7dffa8', strike: '#ffcf5a' }[e.kind] || '#ff8a8a';
      const soak = e.kind === 'block' || e.kind === 'soak';   // (#380) what the shield took
      const row = stack.get(who) || 0; stack.set(who, row + 1);
      g.fillText(soak ? `🛡️ −${e.dmg} blocked` : e.kind === 'shield' ? `🛡️ +${e.dmg} shield` : e.kind === 'heal' ? `+${e.dmg}` : `-${e.dmg}`,
        p.x, p.y - p.s * 1.3 - v * 24 - row * 18);
      g.globalAlpha = 1;
    }
  }

  function fighterAt(g, f, p, s, now, face = p.face) {
    const hurt = fx.find((e) => e.to === f.id && HURTS.has(e.kind) && now - e.at < 300);
    const lunge = fx.find((e) => e.by === f.id && (e.kind === 'hit' || e.kind === 'strike') && now - e.at < 220) ? 10 * face : 0;
    const bob = f.ko ? 0 : Math.sin(now / 300 + p.x) * 3, shake = hurt ? Math.sin(now / 18) * 4 : 0;
    drawFighter(g, p.x + lunge + shake, p.y + bob, s, hue(f.id), face, f.ko, !!hurt, f.shield, f.id === S.me.id, now, f.combo || 0, !!lunge);
  }

  // a glowing bolt from a to b, u of the way there
  function bolt(g, a, b, u, color, big, arc) {
    const at = (v) => [a.x + (b.x - a.x) * v, a.y + (b.y - a.y) * v - Math.sin(Math.PI * v) * arc];
    for (let i = 5; i >= 1; i--) {   // (#382) a fading trail behind it
      const v = u - i * 0.035;
      if (v < 0) continue;
      const [tx, ty] = at(v);
      g.globalAlpha = 0.5 * (1 - i / 6); g.fillStyle = color;
      g.beginPath(); g.arc(tx, ty, (big ? 8 : 4) * (1 - i / 7), 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    const [x, y] = at(u);
    g.fillStyle = color; g.shadowColor = color; g.shadowBlur = big ? 22 : 12;
    g.beginPath(); g.arc(x, y, big ? 9 : 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, big ? 4 : 2, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
  }

  // ⚔️ Duel and 🏟️ Last Typist Standing: fighters face off, every word flies across as a bolt
  function drawBrawl(g, w, h, k, now) {
    const at = spots(w, h, k.fighters), size = Math.min(56, h * 0.22, w / (k.fighters.length * 2.6));
    for (const f of k.fighters) { const p = at.get(f.id); p.s = size; fighterAt(g, f, p, size, now); }
    for (const e of fx) {
      const a = at.get(e.by), b = e.to && at.get(e.to), u = (now - e.at) / 300;
      if (a && b && u < 1 && (e.kind === 'hit' || e.kind === 'strike' || e.kind === 'block'))
        bolt(g, { x: a.x, y: a.y - size * 0.5 }, b, u, `hsl(${hue(e.by)} 90% 65%)`, e.kind === 'strike', size * 0.6);
    }
    return at;
  }

  // 🏰 Castle Siege: a castle each, soldiers marching between them
  function drawSiege(g, w, h, k, now) {
    const at = spots(w, h, k.fighters), size = Math.min(44, h * 0.16, w / (k.fighters.length * 3));
    for (const f of k.fighters) {
      const p = at.get(f.id); p.s = size;
      const cw = size * 1.6, ch = size * 1.2 * (0.35 + 0.65 * (f.hp / k.hp)), base = p.y + size * 0.55;
      g.fillStyle = `hsl(${hue(f.id)} 25% ${f.ko ? 20 : 38}%)`;
      g.fillRect(p.x - cw / 2, base - ch, cw, ch);
      for (let i = 0; i < 4; i++) g.fillRect(p.x - cw / 2 + (i * cw) / 3.5, base - ch - size * 0.2, cw / 7, size * 0.2);   // the battlements
      g.fillStyle = '#00000066'; g.fillRect(p.x - size * 0.18, base - size * 0.45, size * 0.36, size * 0.45);              // the gate
      if (f.shield > 0) {   // the castle's shield, and how much it still blocks (#380)
        g.strokeStyle = '#9ad7ffaa'; g.lineWidth = 3; g.beginPath(); g.arc(p.x, base - ch / 2, cw * 0.75, Math.PI, 0); g.stroke();
        g.fillStyle = '#9ad7ff'; g.font = '700 11px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(`🛡️ ${f.shield}`, p.x + cw * 0.75, base - ch);
      }
      p.y = base - ch - size * 0.55;
      fighterAt(g, f, p, size * 0.7, now);
    }
    for (const a of k.armies || []) {
      const from = at.get(a.by), to = at.get(a.to);
      if (!from || !to) continue;
      const u = Math.min(1, a.prog + (performance.now() - leftAt) / 1000 / 5), y0 = h * 0.82, n = Math.min(6, Math.ceil(a.power / 3));
      for (let i = 0; i < n; i++) {   // a little squad, in step
        const x = from.x + (to.x - from.x) * u - Math.sign(to.x - from.x) * i * 7, y = y0 + (i % 2) * 6 + Math.abs(Math.sin(now / 90 + i)) * -3;
        g.fillStyle = `hsl(${hue(a.by)} 80% ${a.big ? 70 : 58}%)`; g.beginPath(); g.arc(x, y - 6, a.big ? 5 : 3.5, 0, Math.PI * 2); g.fill();
        g.fillRect(x - 2, y - 3, 4, 7);
      }
    }
    for (const e of fx) if (e.kind === 'cut' && now - e.at < 400) {
      const p = at.get(e.by);
      if (p) { g.strokeStyle = '#ffffffaa'; g.lineWidth = 2; g.beginPath(); g.arc(p.x, h * 0.8, 10 + (now - e.at) / 20, 0, Math.PI * 2); g.stroke(); }
    }
    return at;
  }

  // 🧟 Survival: a lane each; the same enemies shuffle in from the left toward each typist on the right
  function drawSurvival(g, w, h, k, now) {
    const n = k.fighters.length, lane = h / (n + 0.5), at = new Map(), s = Math.min(34, lane * 0.55);
    g.fillStyle = '#ffffffcc'; g.font = '700 12px system-ui, sans-serif'; g.textAlign = 'left'; g.fillText(`Wave ${k.wave || 1}`, 10, 16);
    k.fighters.forEach((f, i) => {
      const y = lane * (i + 0.75), p = { x: w - 40, y, face: -1, s };
      g.strokeStyle = '#ffffff18'; g.beginPath(); g.moveTo(10, y + s * 0.55); g.lineTo(w - 10, y + s * 0.55); g.stroke();
      fighterAt(g, f, p, s, now, -1);
      at.set(f.id, p);
      for (const [prog, hp, max] of f.foes || []) {
        const x = 20 + (w - 100) * prog, wob = Math.sin(now / 160 + prog * 40) * 2;
        g.fillStyle = '#6fbf5a'; g.beginPath(); g.ellipse(x, y + wob, s * 0.32, s * 0.4, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#e8ff8a'; g.beginPath(); g.arc(x + 4, y - s * 0.1 + wob, 2.5, 0, Math.PI * 2); g.arc(x + 10, y - s * 0.1 + wob, 2.5, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#00000088'; g.fillRect(x - 10, y - s * 0.6, 20, 3); g.fillStyle = '#ff6b6b'; g.fillRect(x - 10, y - s * 0.6, 20 * (hp / max), 3);
      }
      for (const e of fx) if (e.by === f.id && (e.kind === 'zap' || e.kind === 'kill') && now - e.at < 250) {
        const front = (f.foes || [])[0], tx = front ? 20 + (w - 100) * front[0] : 40;
        bolt(g, p, { x: tx, y }, (now - e.at) / 250, `hsl(${hue(f.id)} 90% 65%)`, false, 8);
      }
    });
    return at;
  }

  // 👹 Boss Rush: one boss up top (everyone fights their own copy: it shows yours), the typists in a row below
  function drawBoss(g, w, h, k, now) {
    const at = spots(w, h, k.fighters), s = Math.min(40, h * 0.15, w / (k.fighters.length * 2.8));
    k.fighters.forEach((f, i) => { const p = at.get(f.id); p.y = h * 0.76; p.x = w * ((i + 1) / (k.fighters.length + 1)); p.s = s; p.face = 1; fighterAt(g, f, p, s, now, 1); });
    const me = k.fighters.find((f) => f.id === S.me.id) || k.fighters[0];
    const bx = w / 2, by = h * 0.3, bs = Math.min(70, h * 0.24), slam = fx.find((e) => e.kind === 'boss' && now - e.at < 400);
    const hit = fx.find((e) => e.by === me?.id && (e.kind === 'hit' || e.kind === 'strike') && now - e.at < 200);
    g.save(); g.translate(bx + (hit ? Math.sin(now / 15) * 4 : 0), by + (slam ? -10 : Math.sin(now / 500) * 4));
    const body = g.createRadialGradient(-bs * 0.2, -bs * 0.3, bs * 0.1, 0, 0, bs);
    body.addColorStop(0, me?.boss > 0 ? '#c264ff' : '#555'); body.addColorStop(1, me?.boss > 0 ? '#4a1470' : '#222');
    g.fillStyle = body; g.beginPath(); g.ellipse(0, 0, bs, bs * 0.8, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f5f0ff'; g.beginPath(); g.moveTo(-bs * 0.7, -bs * 0.5); g.lineTo(-bs * 0.45, -bs * 1.05); g.lineTo(-bs * 0.3, -bs * 0.6); g.fill();
    g.beginPath(); g.moveTo(bs * 0.7, -bs * 0.5); g.lineTo(bs * 0.45, -bs * 1.05); g.lineTo(bs * 0.3, -bs * 0.6); g.fill();
    g.fillStyle = slam ? '#ff4040' : '#ffd34d'; g.beginPath(); g.arc(-bs * 0.3, -bs * 0.1, bs * 0.12, 0, Math.PI * 2); g.arc(bs * 0.3, -bs * 0.1, bs * 0.12, 0, Math.PI * 2); g.fill();
    g.restore();
    if (me) { g.fillStyle = '#00000088'; g.fillRect(bx - bs, by - bs * 1.25, bs * 2, 6); g.fillStyle = '#c264ff'; g.fillRect(bx - bs, by - bs * 1.25, bs * 2 * (me.boss / k.bossMax), 6); }
    if (k.bossIn != null && k.stage === 'play') {
      const l = Math.max(0, k.bossIn - (performance.now() - leftAt) / 1000);
      g.fillStyle = l < 1.2 ? '#ff6b6b' : '#ffffffaa'; g.font = '700 12px system-ui, sans-serif'; g.textAlign = 'center';
      g.fillText(l < 1.2 ? '⚠️ incoming!' : `next slam ${Math.ceil(l)}s`, bx, by + bs + 16);
    }
    for (const e of fx) {
      const a = at.get(e.by), u = (now - e.at) / 300;
      if (a && u < 1 && (e.kind === 'hit' || e.kind === 'strike')) bolt(g, a, { x: bx, y: by }, u, `hsl(${hue(e.by)} 90% 65%)`, e.kind === 'strike', 20);
    }
    if (slam) { g.strokeStyle = `rgba(255,80,80,${1 - (now - slam.at) / 400})`; g.lineWidth = 4; g.beginPath(); g.arc(bx, by, bs + (now - slam.at) / 2, 0, Math.PI * 2); g.stroke(); }
    return at;
  }

  // 🚀 Hyperdrive: ships streak along their lanes to the finish line on the right
  function drawHyper(g, w, h, k, now) {
    const n = k.fighters.length, lane = h / (n + 1), at = new Map(), fin = w - 30;
    g.strokeStyle = '#ffffff16';
    for (let i = 0; i < 30; i++) { const y = (i * 53.7) % h, x = (w - ((now / 3 + i * 131) % (w + 60))); g.beginPath(); g.moveTo(x, y); g.lineTo(x + 30, y); g.stroke(); }
    g.fillStyle = '#ffffff55'; for (let y = 0; y < h; y += 12) g.fillRect(fin, y, 4, 6);
    k.fighters.forEach((f, i) => {
      const y = lane * (i + 1), x = 20 + (fin - 50) * (f.dist / k.track), c = `hsl(${hue(f.id)} 85% 62%)`, boost = Math.min(10, f.combo);
      g.fillStyle = `hsl(${hue(f.id)} 90% 60% / .5)`; g.beginPath(); g.moveTo(x - 14, y - 5); g.lineTo(x - 22 - boost * 3 - Math.random() * 6, y); g.lineTo(x - 14, y + 5); g.fill();   // the flame
      g.fillStyle = c; g.beginPath(); g.moveTo(x + 16, y); g.lineTo(x - 14, y - 9); g.lineTo(x - 10, y); g.lineTo(x - 14, y + 9); g.fill();
      if (f.id === S.me.id) { g.fillStyle = '#ffffffcc'; g.font = '700 11px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('YOU', x, y - 14); }
      at.set(f.id, { x, y, s: 14 });
    });
    return at;
  }

  // 🪢 Tug-of-War: red pulls left, blue right; the knot moves with the rope
  function drawTug(g, w, h, k, now) {
    const most = Math.max(1, ...[0, 1].map((t) => k.fighters.filter((f) => f.team === t).length));
    const at = new Map(), cx = w / 2, y = h * 0.6, span = w * 0.25, knot = cx + span * Math.max(-1, Math.min(1, k.rope / k.ropeMax)), s = Math.min(34, h * 0.14, w / (most * 4.4));
    g.fillStyle = '#ffffff22'; g.fillRect(cx - 1, y - 40, 2, 80);
    const line = span * ((k.ropeLine ?? k.ropeMax) / k.ropeMax);   // in overtime the winning lines creep in (#379)
    g.fillStyle = '#ff6b6b55'; g.fillRect(cx - line - 2, y - 30, 4, 60); g.fillStyle = '#6bb8ff55'; g.fillRect(cx + line - 2, y - 30, 4, 60);
    g.strokeStyle = '#d9b77a'; g.lineWidth = 4; g.beginPath(); g.moveTo(16, y); g.lineTo(w - 16, y); g.stroke();
    g.fillStyle = '#ffe27a'; g.beginPath(); g.arc(knot, y, 7, 0, Math.PI * 2); g.fill();
    for (const team of [0, 1]) {
      const side = k.fighters.filter((f) => f.team === team);
      const dir = team ? 1 : -1, outer = knot + dir * (s * 1.6 + (side.length - 1) * s * 1.2);
      const shift = team ? Math.min(0, w - s * 0.8 - outer) : Math.max(0, s * 0.8 - outer);   // keep the whole team on screen
      side.forEach((f, i) => {
        const x = knot + dir * (s * 1.6 + i * s * 1.2) + shift, lean = fx.find((e) => e.by === f.id && now - e.at < 200) ? (team ? 6 : -6) : 0;
        const p = { x: x + lean, y: y - s * 0.1, face: team ? -1 : 1, s };
        fighterAt(g, f, p, s, now);
        at.set(f.id, p);
      });
    }
    g.font = '800 14px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillStyle = '#ff8a8a'; g.fillText(k.teams[0], w * 0.15, 20); g.fillStyle = '#8ac4ff'; g.fillText(k.teams[1], w * 0.85, 20);
    return at;
  }

  function drawFighter(g, x, y, s, h, face, ko, hurt, shield, me, now, combo = 0, attacking = false) {
    // (#382) a combo of 5 or more lights an aura that grows with it
    if (combo >= 5 && !ko) {
      const r = s * (0.9 + 0.04 * Math.min(10, combo)) * (1 + 0.05 * Math.sin(now / 120));
      const aura = g.createRadialGradient(x, y, s * 0.3, x, y, r);
      aura.addColorStop(0, `hsla(${combo >= 10 ? 35 : h}, 100%, 60%, 0.35)`); aura.addColorStop(1, `hsla(${combo >= 10 ? 35 : h}, 100%, 60%, 0)`);
      g.fillStyle = aura; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.save();
    g.translate(x, y);
    if (ko) g.rotate(face * 1.25);
    // shadow on the floor
    const sh = g.createRadialGradient(0, s * 0.56, 1, 0, s * 0.56, s * 0.65);
    sh.addColorStop(0, '#00000088'); sh.addColorStop(1, '#00000000');
    g.fillStyle = sh; g.beginPath(); g.ellipse(0, s * 0.56, s * 0.65, s * 0.16, 0, 0, Math.PI * 2); g.fill();
    const squash = ko ? 1 : 1 + 0.04 * Math.sin(now / 300 + x);   // breathing
    g.scale(1 / squash, squash);
    // a round little fighter: ears, body with rim light and an outline, belly, gloves
    const body = g.createRadialGradient(-s * 0.2, -s * 0.35, s * 0.1, 0, 0, s * 0.75);
    body.addColorStop(0, `hsl(${h} 90% ${hurt ? 88 : 72}%)`); body.addColorStop(0.7, `hsl(${h} 70% ${hurt ? 62 : 48}%)`); body.addColorStop(1, `hsl(${h} 65% ${hurt ? 50 : 32}%)`);
    g.fillStyle = body; g.strokeStyle = `hsl(${h} 60% 18%)`; g.lineWidth = Math.max(1.5, s * 0.04);
    g.beginPath(); g.arc(-s * 0.32, -s * 0.5, s * 0.14, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.arc(s * 0.32, -s * 0.5, s * 0.14, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.ellipse(0, 0, s * 0.55, s * 0.6, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = Math.max(1, s * 0.035);   // rim light from the moon
    g.beginPath(); g.ellipse(0, 0, s * 0.5, s * 0.55, 0, -Math.PI * 0.85, -Math.PI * 0.35); g.stroke();
    g.fillStyle = `hsl(${h} 60% 88% / .45)`; g.beginPath(); g.ellipse(0, s * 0.18, s * 0.3, s * 0.28, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1a1a22'; g.strokeStyle = '#1a1a22';
    if (ko) {
      g.lineWidth = 2.2;
      for (const ex of [-0.18, 0.18]) { g.beginPath(); g.moveTo(s * (ex - 0.07), -s * 0.2); g.lineTo(s * (ex + 0.07), -s * 0.06); g.moveTo(s * (ex + 0.07), -s * 0.2); g.lineTo(s * (ex - 0.07), -s * 0.06); g.stroke(); }
    } else {
      const blink = Math.sin(now / 900 + h) > 0.985 ? 0.2 : 1;
      for (const ex of [-0.18, 0.18]) {
        g.fillStyle = '#1a1a22'; g.beginPath(); g.ellipse(s * (ex + 0.05 * face), -s * 0.14, s * 0.065, s * 0.095 * blink, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(s * (ex + 0.07 * face), -s * 0.18, s * 0.022, 0, Math.PI * 2); g.fill();   // a glint
      }
      // eyebrows: a frown when it attacks or takes a hit
      const mad = attacking || hurt ? 0.07 : 0;
      g.lineWidth = Math.max(1.5, s * 0.04); g.lineCap = 'round';
      for (const ex of [-0.18, 0.18]) {
        const inner = ex * face < 0 ? 1 : -1;
        g.beginPath(); g.moveTo(s * (ex - 0.08), -s * (0.3 + (inner < 0 ? mad : 0))); g.lineTo(s * (ex + 0.08), -s * (0.3 + (inner > 0 ? mad : 0))); g.stroke();
      }
    }
    if (!ko) {   // the glove, out toward the rival
      const gx = face * s * (attacking ? 0.75 : 0.62);
      const glove = g.createRadialGradient(gx - s * 0.05, -s * 0.03, 1, gx, s * 0.05, s * 0.18);
      glove.addColorStop(0, '#ff8a8a'); glove.addColorStop(1, '#b3202e');
      g.fillStyle = glove; g.strokeStyle = '#5a0f17'; g.lineWidth = Math.max(1, s * 0.03);
      g.beginPath(); g.arc(gx, s * 0.05, s * 0.17, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    if (shield) {   // its glow thins as it wears down (#380)
      const left = Math.max(0.25, Math.min(1, shield / 15));
      g.strokeStyle = `rgba(154,215,255,${0.35 + 0.55 * left})`; g.lineWidth = 1.5 + 2.5 * left; g.shadowColor = '#9ad7ff'; g.shadowBlur = 12;
      g.beginPath(); g.arc(0, 0, s * 0.85, 0, Math.PI * 2); g.stroke(); g.shadowBlur = 0;
      g.fillStyle = `rgba(154,215,255,${0.06 + 0.06 * left})`; g.fill();
    }
    g.restore();
    if (shield && !ko) { g.fillStyle = '#9ad7ff'; g.font = '700 11px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(`🛡️ ${shield}`, x + s * 0.85, y - s * 0.7); }
    if (me) { g.fillStyle = '#ffffffcc'; g.font = '700 11px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('YOU', x, y - s * 0.85); }
  }


  function drawRace(g, w, h, k, now) {
    // ⌨️ Pure Typing: a lane each; the runner moves with the letters typed, the leader sets the scale
    const n = k.fighters.length, lead = k.goal || Math.max(40, ...k.fighters.map((f) => f.chars)) * 1.1, lane = h / (n + 1);
    k.fighters.forEach((f, i) => {
      const y = lane * (i + 1), x = 30 + (w - 70) * (f.chars / lead);
      g.strokeStyle = '#ffffff22'; g.setLineDash([6, 8]); g.beginPath(); g.moveTo(20, y + 16); g.lineTo(w - 20, y + 16); g.stroke(); g.setLineDash([]);
      drawFighter(g, x, y + Math.sin(now / 120 + i) * (f.wpm ? 2 : 0), Math.min(30, lane * 0.6), hue(f.id), 1, false, false, false, f.id === S.me.id, now);
    });
    return null;
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
