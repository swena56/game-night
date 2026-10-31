// Scribble Relay: write / draw / caption on your own phone, then reveal the chains and vote.
UI.relay = (() => {
  let S, ctx, pad, padKey = '', strokes = [], cur = null, color = 0, ints = 0, shownKey = '';
  const NS = 'http://www.w3.org/2000/svg';
  const INK = ['#1d1a26', '#e63946', '#1d7bd8', '#2a9d4b', '#f4a300', '#8e44ad'];
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
      p.setAttribute('stroke', INK[c] ?? INK[0]);
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
      p.setAttribute('stroke', INK[c]);
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
      const pt = point(e);
      if (!pt) return;
      e.preventDefault();
      pad.setPointerCapture?.(e.pointerId);
      cur = [color, pt];
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
    padKey = ''; strokes = []; cur = null; ints = 0; color = 0; shownKey = '';
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

  function markInk() { for (const b of document.querySelectorAll('.rl-swatch')) b.classList.toggle('on', +b.dataset.i === color); }

  function render(s, c) {
    S = s; ctx = c;
    const g = S.relay;
    const key = `${g.stage}:${g.step}`;
    if (key !== padKey) { padKey = key; strokes = []; ints = 0; cur = null; $('rlText').value = ''; redraw(); }
    const label = { write: '✍️ Write a phrase', draw: '🖍️ Draw it!', caption: '🏷️ What is this?' };
    const waiting = g.waiting.map((id) => ctx.player(id)?.name).filter(Boolean);

    if (g.stage === 'play') {
      $('rlStep').textContent = `Step ${g.step + 1} of ${g.steps}`;
      $('rlTask').textContent = label[g.kind];
      const pr = $('rlPrompt'); pr.innerHTML = '';
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
    g.chain.forEach((e, i) => {
      const p = ctx.player(e.by);
      const card = ctx.el('div', 'rl-entry');
      if (fresh) card.style.animationDelay = `${i * 1.2}s`; else card.style.animation = 'none';
      const who = ctx.el('div', 'rl-who');
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = p?.color ?? '#888';
      who.append(dot, `${p?.name ?? '?'} ${e.kind === 'draw' ? 'drew' : i ? 'guessed' : 'wrote'}${e.auto ? ' 🤖' : ''}`);
      card.append(who, e.kind === 'draw' ? art(e.v, 'rl-art') : ctx.el('div', 'rl-quote', `“${e.v}”`));
      const n = g.tally?.[i];
      const b = ctx.el('button', 'rl-heart', n ? `❤️ ${n}` : '❤️');
      b.classList.toggle('on', g.myVote === i);
      b.disabled = e.by === S.me.id || !playing();
      b.onclick = () => ctx.quiet(ctx.act('vote', { i }));
      card.append(b);
      box.append(card);
    });
    $('rlStatus').textContent = S.phase === 'playing' ? (waiting.length ? `Vote for your favourite. Waiting for: ${waiting.join(', ')}` : '') : '';
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

  return { mount, render, turnText, myMove };
})();
