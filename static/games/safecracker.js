// Safecracker: build a guess from the colour pad, lock it in, and read everyone's revealed guesses.
// Pegs carry their number as well as their colour, so colour is never the only cue.
UI.safecracker = (() => {
  let S, ctx, draft = [], probing = false, draftSafe = 0;
  const COLORS = ['#ef476f', '#ffb703', '#06d6a0', '#3a86ff', '#c77dff', '#f4f1de', '#ff7f11', '#8d6e63'];
  const $ = (id) => document.getElementById(id);

  function peg(c, cls = '') {
    const p = ctx.el('span', 'sc-peg ' + cls, c == null ? '' : String(c + 1));
    if (c != null) p.style.background = COLORS[c];
    return p;
  }

  function mount(main, side) {
    draft = []; probing = false; draftSafe = 0;
    main.innerHTML = `<div class="sc">
      <div class="sc-head"><span id="scSafe"></span><span id="scRound"></span></div>
      <div id="scOpened" class="sc-opened" hidden></div>
      <div id="scHistory" class="sc-history"></div>
      <div class="sc-entry">
        <div id="scSlots" class="sc-slots"></div>
        <div id="scPad" class="sc-pad"></div>
        <div class="row sc-actions">
          <button id="scBack" title="Remove the last colour">⌫</button>
          <button id="scProbe">🔍 Probe</button>
          <button id="scLock" class="primary">🔒 Lock in</button>
        </div>
        <div id="scStatus" class="sc-status"></div>
      </div></div>`;
    side.innerHTML = `<div class="panel"><h3>Clues</h3>
      <p class="hint left"><span class="sc-pin on"></span> right colour, right spot · <span class="sc-pin"></span> right colour, wrong spot.</p>
      <div id="scProbeInfo" class="hint left"></div></div>`;
    $('scBack').onclick = () => { draft.pop(); paint(); };
    $('scProbe').onclick = () => { probing = !probing; paint(); };
    // the action field is "pegs": "code" is the room code in every request
    $('scLock').onclick = () => ctx.quiet(ctx.act('guess', { pegs: draft.slice() }));
  }

  function canPlay() {
    const g = S.safecracker;
    return S.phase === 'playing' && g.stage === 'crack' && !S.me.spectator && !S.me.eliminated && !g.mine && !!ctx.act;
  }

  function tapColor(c) {
    const g = S.safecracker;
    if (probing) {
      probing = false;
      ctx.quiet(ctx.act('probe', { color: c }));
      return paint();
    }
    if (draft.length >= g.length || (!g.repeats && draft.includes(c))) return;
    draft.push(c);
    paint();
  }

  // the entry area only (no server round-trip)
  function paint() {
    const g = S.safecracker, live = canPlay();
    const slots = $('scSlots'); slots.innerHTML = '';
    const shown = g.mine || draft;
    for (let i = 0; i < g.length; i++) {
      const p = peg(shown[i], 'slot' + (shown[i] == null ? ' empty' : ''));
      if (live && shown[i] != null) p.onclick = () => { draft.splice(i, 1); paint(); };
      slots.append(p);
    }
    const pad = $('scPad'); pad.innerHTML = '';
    for (let c = 0; c < g.colors; c++) {
      const b = peg(c, 'pad' + (probing ? ' probing' : ''));
      const used = !g.repeats && draft.includes(c) && !probing;
      b.setAttribute('role', 'button');
      b.setAttribute('aria-label', `colour ${c + 1}`);
      b.classList.toggle('off', !live || used);
      if (live && !used) b.onclick = () => tapColor(c);
      pad.append(b);
    }
    const probed = g.probed.includes(S.me.id);
    $('scBack').disabled = !live || !draft.length;
    $('scProbe').disabled = !live || probed;
    $('scProbe').classList.toggle('on', probing);
    $('scProbe').textContent = probed ? '🔍 Used' : probing ? '🔍 Pick a colour…' : '🔍 Probe';
    $('scLock').disabled = !live || draft.length !== g.length;
    const waiting = g.waiting.map((id) => ctx.player(id)?.name).filter(Boolean);
    $('scStatus').textContent = S.phase !== 'playing' ? ''
      : g.stage === 'open' ? 'Next safe coming up…'
      : g.mine ? `🔒 Locked in. Waiting for ${waiting.join(', ') || '…'}`
      : probing ? 'Tap a colour to learn how many of it the code holds (costs a point if you crack this safe).'
      : waiting.length > 1 ? `Still choosing: ${waiting.join(', ')}` : '';
  }

  function render(s, c) {
    S = s; ctx = c;
    const g = S.safecracker;
    if (draftSafe !== g.safe) { draft = []; probing = false; draftSafe = g.safe; }
    if (draft.length > g.length) draft = draft.slice(0, g.length);
    $('scSafe').textContent = g.safes > 1 ? `🔐 Safe ${g.safe} of ${g.safes}` : '🔐 The safe';
    $('scRound').textContent = `Guess ${Math.min(g.round, g.rounds)} of ${g.rounds}`;

    const code = g.code || g.opened;
    $('scOpened').hidden = !code;
    if (code) {
      $('scOpened').innerHTML = '';
      $('scOpened').append(ctx.el('span', '', g.code ? 'The code: ' : 'Opened: '), ...code.map((x) => peg(x)));
    }

    const hist = $('scHistory'); hist.innerHTML = '';
    if (!g.history.length) hist.append(ctx.el('p', 'hint', 'No guesses yet. Everyone locks in a first guess, then all are revealed together.'));
    g.history.forEach((round, i) => {
      const box = ctx.el('div', 'sc-round');
      box.append(ctx.el('span', 'sc-rnum', String(i + 1)));
      const rows = ctx.el('div', 'sc-rows');
      for (const h of round) {
        const p = ctx.player(h.by);
        const row = ctx.el('div', 'sc-row' + (h.by === S.me.id ? ' me' : ''));
        const who = ctx.el('span', 'sc-who', p?.name ?? '?');
        who.style.borderColor = p?.color ?? '#777';
        const pins = ctx.el('span', 'sc-pins');
        pins.title = `${h.exact} right spot, ${h.near} wrong spot`;
        for (let k = 0; k < h.exact; k++) pins.append(ctx.el('span', 'sc-pin on'));
        for (let k = 0; k < h.near; k++) pins.append(ctx.el('span', 'sc-pin'));
        if (!h.exact && !h.near) pins.append(ctx.el('span', 'sc-none', '—'));
        row.append(who, ctx.el('span', 'sc-code'), pins);
        row.children[1].append(...h.code.map((x) => peg(x, 'small')));
        rows.append(row);
      }
      box.append(rows);
      hist.append(box);
    });
    hist.scrollTop = hist.scrollHeight;

    $('scProbeInfo').textContent = g.myProbe ? `🔍 Your probe: the code holds ${g.myProbe[1]} of colour ${g.myProbe[0] + 1}.`
      : 'Your 🔍 probe for this safe is unused.';
    paint();
  }

  const turnText = (s) => {
    const g = s.safecracker;
    if (s.phase !== 'playing' || s.me.spectator) return null;
    return g.stage === 'open' ? '🔓 Safe opened!' : g.mine ? '🔒 Locked in — waiting…' : '🔐 Build your guess!';
  };
  const myMove = (s) => s.phase === 'playing' && s.safecracker.stage === 'crack' && !s.safecracker.mine && !s.me.spectator;

  return { mount, render, turnText, myMove };
})();
