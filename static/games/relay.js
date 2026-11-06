// Scribble Relay: write / draw / caption on your own phone, then reveal the chains and vote.
UI.relay = (() => {
  let handedKey = '', tallied = false, tickTimer = 0, lastTick = 0;
  let S, ctx, pad, padKey = '', strokes = [], cur = null, color = 0, size = 0, ints = 0, shownKey = '';
  const NS = 'http://www.w3.org/2000/svg';
  const INK = ['#1d1a26', '#e63946', '#1d7bd8', '#2a9d4b', '#f4a300', '#8e44ad'];
  const WIDTH = [2.2, 1.1, 4.6];  // brush sizes: a stroke's ink number is colour + 10 × size
  const inkOf = (c) => INK[c % 10] ?? INK[0], widthOf = (c) => WIDTH[Math.floor(c / 10)] ?? WIDTH[0];
  const MAX_INTS = 2300;
  const IDEAS = ['a cat riding a bicycle', 'a snowman at the beach', 'a dragon eating spaghetti', 'a robot walking a dog',
    'a haunted lighthouse', 'a giraffe in a tiny car', 'the moon wearing sunglasses', 'a pirate ship in a bathtub',
    'a dinosaur at a birthday party', 'a very nervous banana', 'a wizard doing homework', 'a shark in a spacesuit',
    'a castle made of cake', 'a penguin on holiday', 'a tree with a door', 'a sleepy volcano'];
  const $ = (id) => document.getElementById(id);
  const playing = () => S.phase === 'playing' && !S.me.spectator && !S.me.eliminated;

  function art(v, cls) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '-2 -2 104 104');
    svg.setAttribute('class', cls);
    for (const [c, d] of v) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('stroke', inkOf(c));
      p.style.strokeWidth = widthOf(c);
      p.setAttribute('class', 'rl-ink');
      svg.append(p);
    }
    return svg;
  }

  const path = (pts) => 'M' + pts.slice(0, 2).join(' ') + (pts.length > 2 ? pts.slice(2).map((v, i) => (i % 2 ? ' ' : 'L') + v).join('') : `L${pts[0]} ${pts[1] + 0.1}`);

  function redraw() {
    pad.innerHTML = '';
    for (const [c, pts] of strokes) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', path(pts));
      p.setAttribute('stroke', inkOf(c));
      p.style.strokeWidth = widthOf(c);
      p.setAttribute('class', 'rl-ink');
      pad.append(p);
    }
    $('rlInk').textContent = ints > MAX_INTS * 0.8 ? `🖋️ Ink ${Math.max(0, Math.round(100 - (100 * ints) / MAX_INTS))}% left` : '';
  }

  function point(e) {
    const r = pad.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const k = (v) => Math.max(0, Math.min(100, Math.round(v)));
    return [k(((e.clientX - r.left) / r.width) * 100), k(((e.clientY - r.top) / r.height) * 100)];
  }

  function mountPad() {
    pad.addEventListener('pointerdown', (e) => {
      if (!canDraw() || ints >= MAX_INTS) return;
      // twists the pad can hold you to: one line, or four strokes
      const tw = S.relay.twist?.[0], limit = tw === 'line' ? 1 : tw === 'four' ? 4 : Infinity;
      if (strokes.length >= limit) { ctx.toast(tw === 'line' ? '〰️ One line only! Send it as it is.' : '✌️ That was your fourth stroke.'); return; }
      const pt = point(e);
      if (!pt) return;
      e.preventDefault();
      pad.setPointerCapture?.(e.pointerId);
      cur = [color + 10 * size, pt];
      strokes.push(cur);
      ints += 2;
      redraw();
    });
    pad.addEventListener('pointermove', (e) => {
      if (!cur) return;
      const pt = point(e);
      const pts = cur[1];
      if (!pt || ints >= MAX_INTS) return;
      const [lx, ly] = pts.slice(-2);
      if (Math.hypot(pt[0] - lx, pt[1] - ly) < 1.5) return;
      pts.push(...pt);
      ints += 2;
      redraw();
    });
    const end = () => { cur = null; };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    pad.addEventListener('pointerleave', end);
  }

  const canDraw = () => S?.relay?.stage === 'play' && S.relay.kind === 'draw' && !S.relay.sent && playing();

  function mount(main, side) {
    padKey = ''; strokes = []; cur = null; ints = 0; color = 0; size = 0; shownKey = '';
    main.innerHTML = `<div class="rl">
      <div class="rl-head"><span id="rlStep"></span><span id="rlTask" class="rl-task"></span></div>
      <div id="rlPrompt" class="rl-prompt"></div>
      <form id="rlTextForm" class="rl-form" autocomplete="off" hidden>
        <div class="row"><input id="rlText" maxlength="60" enterkeyhint="send"><button class="primary">Send</button></div>
        <button type="button" id="rlIdea" class="ghost-btn">🎲 Give me an idea</button>
      </form>
      <div id="rlDraw" hidden>
        <svg id="rlPad" class="rl-pad" viewBox="0 0 100 100"></svg>
        <div class="rl-tools"><span id="rlInks" class="rl-inks"></span>
          <button id="rlUndo" type="button">↶ Undo</button><button id="rlClear" type="button">🗑️</button>
          <button id="rlSend" type="button" class="primary">Send drawing</button></div>
        <p id="rlInk" class="hint"></p>
      </div>
      <p id="rlStatus" class="hint"></p>
      <div id="rlChain" class="rl-chain"></div>
    </div>`;
    side.innerHTML = `<div class="panel"><h3>How it works</h3><ul class="rules">
      <li>✍️ Write a phrase. It starts your chain.</li>
      <li>🖍️ Draw the phrase you're handed, then 🏷️ caption the drawing you're handed, and so on.</li>
      <li>👀 You only see the entry just before yours.</li>
      <li>❤️ At the end, vote for your favourite entry in each chain: +1 per vote.</li>
      <li>🎯 Chains that come back to where they started earn everyone in them +1.</li></ul></div>`;
    pad = $('rlPad');
    mountPad();
    INK.forEach((hex, i) => {
      const b = document.createElement('button');
      b.className = 'rl-swatch'; b.type = 'button'; b.style.background = hex; b.dataset.i = i;
      b.onclick = () => { color = i; markInk(); };
      $('rlInks').append(b);
    });
    [[1, 'thin'], [0, 'normal'], [2, 'thick']].forEach(([k, label]) => {
      const b = document.createElement('button');
      b.className = 'rl-size'; b.type = 'button'; b.dataset.size = k;
      b.setAttribute('aria-label', `${label} brush`);
      b.append(Object.assign(document.createElement('span'), { style: `width:${WIDTH[k] * 3}px;height:${WIDTH[k] * 3}px` }));
      b.onclick = () => { size = k; markInk(); };
      $('rlInks').append(b);
    });
    markInk();
    $('rlUndo').onclick = () => { const s = strokes.pop(); if (s) ints -= s[1].length; redraw(); };
    $('rlClear').onclick = () => { strokes = []; ints = 0; redraw(); };
    $('rlSend').onclick = () => {
      if (!strokes.length) return ctx.toast('Draw something first!');
      ctx.quiet(ctx.act('submit', { strokes }));
    };
    $('rlIdea').onclick = () => { $('rlText').value = IDEAS[Math.floor(Math.random() * IDEAS.length)]; };
    $('rlTextForm').onsubmit = (e) => {
      e.preventDefault();
      const text = $('rlText').value.trim();
      if (text) ctx.quiet(ctx.act('submit', { text }));
    };
  }

  function markInk() {
    for (const b of document.querySelectorAll('.rl-swatch')) b.classList.toggle('on', +b.dataset.i === color);
    for (const b of document.querySelectorAll('.rl-size')) b.classList.toggle('on', +b.dataset.size === size);
  }

  // the last five seconds of a step tick, if you haven't sent yet
  function tick() {
    const g = S?.relay;
    if (!g || g.stage !== 'play' || g.sent || !playing() || S.timeLeft == null) return;
    const left = Math.ceil(S.timeLeft - (performance.now() - stateAt) / 1000);
    if (left <= 5 && left > 0 && left !== lastTick) { lastTick = left; ctx.sfx('tickfast'); }
  }

  function render(s, c) {
    S = s; ctx = c;
    const g = S.relay;
    if (!tickTimer) tickTimer = setInterval(tick, 250);
    const key = `${g.stage}:${g.step}`;
    if (key !== padKey) { padKey = key; strokes = []; ints = 0; cur = null; $('rlText').value = ''; redraw(); }
    const label = { write: '✍️ Write a phrase', draw: '🖍️ Draw it!', caption: '🏷️ What is this?' };
    const waiting = g.waiting.map((id) => ctx.player(id)?.name).filter(Boolean);

    if (g.stage === 'play') {
      // #12: where you are in the chain, who handed you this, and what to do with it
      const st = $('rlStep'); st.innerHTML = '';
      const icon = { write: '✍️', draw: '🖍️', caption: '🏷️' };
      (g.kinds || []).forEach((k, i) => {
        const b = ctx.el('span', 'rl-dot' + (i < g.step ? ' done' : i === g.step ? ' on' : ''), icon[k]);
        b.title = `Step ${i + 1}: ${{ write: 'write', draw: 'draw', caption: 'caption' }[k]}`;
        st.append(b);
      });
      st.setAttribute('aria-label', `Step ${g.step + 1} of ${g.steps}`);
      $('rlTask').textContent = label[g.kind];
      const pr = $('rlPrompt'); pr.innerHTML = '';
      const from = g.prompt && ctx.player(g.prompt.by), fromName = from ? from.name : 'The last player';
      const last = g.step === g.steps - 1 ? ' This is the last step of the chain.' : '';
      const how = {
        write: 'Write something for the next player to draw: the sillier the better.',
        draw: `${fromName} wrote this. Draw it (no letters!) and the next player guesses what it is.${last}`,
        caption: `${fromName} drew this. What is it? Your caption goes on to be drawn.${last}`,
      }[g.kind];
      if (playing() && !g.sent) pr.append(ctx.el('p', 'rl-how', how));
      if (g.twist && g.kind === 'draw' && playing() && !g.sent) pr.append(ctx.el('div', 'rl-twist', `🎲 Twist: ${g.twist[1]}`));
      // a new step lands on your phone with a whoosh
      if (key !== handedKey) { if (handedKey && playing()) ctx.sfx('whoosh'); handedKey = key; }
      if (g.prompt?.kind === 'text') pr.append(ctx.el('div', 'rl-quote', `“${g.prompt.v}”`));
      if (g.prompt?.kind === 'draw') pr.append(art(g.prompt.v, 'rl-art'));
      const live = playing() && !g.sent;
      $('rlTextForm').hidden = !(live && g.kind !== 'draw');
      $('rlIdea').hidden = g.kind !== 'write';
      $('rlText').placeholder = g.kind === 'write' ? 'Something fun to draw' : 'What do you think it is?';
      $('rlDraw').hidden = !(live && g.kind === 'draw');
      $('rlStatus').textContent = g.sent ? `✅ Sent! Waiting for: ${waiting.join(', ') || '…'}`
        : !playing() ? `Players are working… waiting for ${waiting.join(', ')}` : '';
      $('rlChain').innerHTML = '';
      shownKey = '';
      return;
    }

    // the show: one chain at a time
    $('rlTextForm').hidden = $('rlDraw').hidden = true;
    $('rlPrompt').innerHTML = '';
    const starter = ctx.player(g.starter);
    $('rlStep').textContent = `Chain ${g.show + 1} of ${g.chains}`;
    $('rlTask').textContent = `${starter?.name ?? '?'}'s chain`;
    const fresh = shownKey !== String(g.show);
    shownKey = String(g.show);
    const box = $('rlChain'); box.innerHTML = '';
    // a fresh chain plays out card by card; each drawing re-draws itself stroke by stroke as it appears,
    // so the next card waits a little longer after a picture
    let at = 0;
    g.chain.forEach((e, i) => {
      const p = ctx.player(e.by);
      const card = ctx.el('div', 'rl-entry');
      const start = at;
      at += e.kind === 'draw' ? 2.4 : 1.2;
      if (fresh) card.style.animationDelay = `${start}s`; else card.style.animation = 'none';
      const who = ctx.el('div', 'rl-who');
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = p?.color ?? '#888';
      who.append(dot, `${p?.name ?? '?'} ${e.kind === 'draw' ? 'drew' : i ? 'guessed' : 'wrote'}${e.auto ? ' 🤖' : ''}`);
      const shown = e.kind === 'draw' ? art(e.v, 'rl-art') : ctx.el('div', 'rl-quote', `“${e.v}”`);
      if (e.kind === 'draw' && fresh && motionOK()) {
        const paths = [...shown.querySelectorAll('path')], per = 1.6 / Math.max(1, paths.length);
        paths.forEach((pth, k) => {
          pth.setAttribute('pathLength', '1');
          pth.classList.add('rl-redraw');
          pth.style.animationDelay = `${start + 0.35 + k * per}s`;
          pth.style.animationDuration = `${Math.max(0.12, per * 1.4)}s`;
        });
      }
      card.append(who, shown);
      if (fresh) setTimeout(() => ctx.sfx(e.kind === 'draw' ? 'sweep' : 'flip'), start * 1000);
      const n = g.tally?.[i];
      const b = ctx.el('button', 'rl-heart', n ? `❤️ ${n}` : '❤️');
      if (n && !tallied) setTimeout(() => Kit.stamp(card, `❤️ ${n}`, 'good', 900), 200 + i * 120);
      b.classList.toggle('on', g.myVote === i);
      b.disabled = e.by === S.me.id || !playing();
      b.onclick = () => ctx.quiet(ctx.act('vote', { i }));
      card.append(b);
      box.append(card);
    });
    tallied = !!g.tally;
    const texts = g.chain.filter((e) => e.kind === 'text');
    if (texts.length > 1) {  // how far the phrase drifted, once the whole chain is on show
      const sum = ctx.el('p', 'rl-sum', `🌀 Started as “${texts[0].v}”, ended as “${texts.at(-1).v}”.`);
      if (fresh) sum.style.animationDelay = `${at}s`; else sum.style.animation = 'none';
      box.append(sum);
    }
    const save = ctx.el('button', 'ghost-btn rl-save', '💾 Save this chain as a picture');
    save.onclick = () => saveChain(g).catch(() => ctx.toast("Couldn't make the picture on this device."));
    box.append(save);
    const mine = playing() && g.myVote == null && g.waiting.includes(S.me.id);
    $('rlStatus').textContent = S.phase === 'playing'
      ? (mine ? '❤️ Tap the heart on your favourite entry (not your own): its author gets +1.' : '')
        + (waiting.length ? ` Waiting for: ${waiting.join(', ')}` : '') : '';
  }

  // the whole chain as one tall PNG: who did what, the phrases, and the drawings on white cards
  async function saveChain(g) {
    const W = 600, pad = 24, art = 360;
    const c = document.createElement('canvas'), x = c.getContext('2d');
    const wrap = (text, width) => {
      const words = text.split(' '), lines = [''];
      for (const w of words) {
        const t = lines.at(-1) ? `${lines.at(-1)} ${w}` : w;
        if (x.measureText(t).width > width && lines.at(-1)) lines.push(w); else lines[lines.length - 1] = t;
      }
      return lines;
    };
    const images = await Promise.all(g.chain.map((e) => {
      if (e.kind !== 'draw') return null;
      const paths = e.v.map(([ci, d]) => `<path d="${d}" stroke="${inkOf(ci)}" stroke-width="${widthOf(ci)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        `<svg xmlns="${NS}" viewBox="-2 -2 104 104" width="${art}" height="${art}"><rect x="-2" y="-2" width="104" height="104" fill="#fff"/>${paths}</svg>`);
      return img.decode().then(() => img);
    }));
    x.font = '600 22px system-ui, sans-serif';
    const blocks = g.chain.map((e, i) => (e.kind === 'draw' ? art : wrap(`“${e.v}”`, W - 2 * pad).length * 30) + 44);
    c.width = W; c.height = pad * 2 + 50 + blocks.reduce((a, b) => a + b, 0);
    x.fillStyle = '#16131f'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#ffb703'; x.font = '800 26px system-ui, sans-serif';
    x.fillText(`🖍️ ${ctx.player(g.starter)?.name ?? '?'}'s Scribble Relay chain`, pad, pad + 26);
    let y = pad + 60;
    g.chain.forEach((e, i) => {
      const p = ctx.player(e.by);
      x.fillStyle = p?.color ?? '#aaa'; x.font = '700 18px system-ui, sans-serif';
      x.fillText(`${p?.name ?? '?'} ${e.kind === 'draw' ? 'drew' : i ? 'guessed' : 'wrote'}`, pad, y + 18);
      y += 32;
      if (images[i]) { x.drawImage(images[i], (W - art) / 2, y); y += art + 12; }
      else {
        x.fillStyle = '#f3eefc'; x.font = '600 22px system-ui, sans-serif';
        for (const line of wrap(`“${e.v}”`, W - 2 * pad)) { x.fillText(line, pad, y + 22); y += 30; }
        y += 12;
      }
    });
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `scribble-relay-chain-${g.show + 1}.png` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function turnText(s) {
    const g = s.relay;
    if (s.phase !== 'playing') return null;
    if (g.stage === 'show') return g.myVote == null ? '❤️ Vote for your favourite!' : '❤️ Waiting for votes…';
    if (g.sent) return '✅ Sent! Waiting…';
    return { write: '✍️ Write a phrase!', draw: '🖍️ Draw it!', caption: '🏷️ Caption the drawing!' }[g.kind];
  }
  const myMove = (s) => s.phase === 'playing' && !s.me.spectator && !s.me.eliminated
    && (s.relay.stage === 'play' ? !s.relay.sent : s.relay.myVote == null && s.relay.chain.some((e) => e.by !== s.me.id));

  const unmount = () => { clearInterval(tickTimer); tickTimer = 0; handedKey = ''; };

  return { mount, render, unmount, turnText, myMove };
})();
