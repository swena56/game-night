// Safecracker: build a guess from the colour pad, lock it in, and read everyone's revealed guesses.
// Pegs carry their number as well as their colour, so colour is never the only cue.
UI.safecracker = (() => {
  let S, ctx, draft = [], cursor = 0, probing = false, draftFor = '', notes = [], notesFor = null, seenRounds = null, seenOpen = null, seenSafe = null;
  const MARKS = ['', 'out', 'in'];  // a note cycles: unknown → ✗ not in the code → ✓ in the code
  const STANDARD = ['#ef476f', '#ffb703', '#06d6a0', '#3a86ff', '#c77dff', '#f4f1de', '#ff7f11', '#8d6e63'];
  // Okabe–Ito: eight colours that stay distinct with the common kinds of colour blindness
  const SAFE = ['#d55e00', '#e69f00', '#009e73', '#0072b2', '#cc79a7', '#f0e442', '#56b4e9', '#eeeeee'];
  let safe = false;
  try { safe = localStorage.getItem('safecracker.palette') === 'safe'; } catch {}
  let COLORS = safe ? SAFE : STANDARD;
  const $ = (id) => document.getElementById(id);

  function peg(c, cls = '') {
    const p = ctx.el('span', 'sc-peg ' + cls, c == null ? '' : String(c + 1));
    if (c != null) {
      p.style.background = COLORS[c];
      const [r, g, b] = [1, 3, 5].map((k) => parseInt(COLORS[c].slice(k, k + 2), 16));
      if (0.299 * r + 0.587 * g + 0.114 * b < 120) p.style.color = '#fff';  // keep the number readable on dark pegs
    }
    return p;
  }

  function mount(main, side) {
    draft = []; cursor = 0; probing = false; draftFor = ''; notes = []; notesFor = null; seenRounds = null; seenOpen = null; seenSafe = null;
    main.innerHTML = `<div class="sc">
      <div class="sc-head"><span id="scSafe"></span><span id="scRound"></span></div>
      <div id="scOpened" class="sc-opened" hidden></div>
      <div id="scStand" hidden></div>
      <div id="scHistory" class="sc-history"></div>
      <div class="sc-entry">
        <div id="scSlots" class="sc-slots"></div>
        <div id="scPad" class="sc-pad"></div>
        <div class="row sc-actions">
          <button id="scBack" title="Remove the selected colour (or the last one)">⌫</button>
          <button id="scAgain" title="Start from your last guess">↺ Last</button>
          <button id="scProbe">🔍 Probe</button>
          <button id="scLock" class="primary">🔒 Lock in</button>
        </div>
        <div id="scStatus" class="sc-status"></div>
      </div></div>`;
    side.innerHTML = `<div class="panel"><h3>Clues</h3>
      <p class="hint left"><span class="sc-pin on"></span> right colour, right spot · <span class="sc-pin"></span> right colour, wrong spot.</p>
      <div id="scProbeInfo" class="hint left"></div>
      <label class="check"><input type="checkbox" id="scSafePal"> Colour-blind-friendly colours</label>
      <h3>📝 Notes</h3><div id="scNotes" class="sc-notes"></div>
      <p class="hint left">Tap a colour to mark it ✗ out or ✓ in. Only you see your notes.</p></div>`;
    $('scSafePal').checked = safe;
    $('scSafePal').onchange = () => {
      safe = $('scSafePal').checked; COLORS = safe ? SAFE : STANDARD;
      try { localStorage.setItem('safecracker.palette', safe ? 'safe' : 'standard'); } catch {}
      ctx.rerender();
    };
    $('scBack').onclick = () => {
      // clear the selected peg if it has one, else the last filled one; the others stay put (#42)
      const i = cursor != null && draft[cursor] != null ? cursor : draft.findLastIndex((x) => x != null);
      if (i >= 0) { draft[i] = null; cursor = i; }
      paint();
    };
    $('scAgain').onclick = () => { const last = lastGuess(); if (last) { draft = last; cursor = null; } paint(); };
    $('scProbe').onclick = () => { probing = !probing; paint(); };
    // the action field is "pegs": "code" is the room code in every request
    $('scLock').onclick = () => ctx.quiet(ctx.act(S.safecracker.stage === 'set' ? 'set' : 'guess', { pegs: draft.slice() }));
  }

  // the guess is a fixed row of slots (null = empty), so taking a peg out never shifts the others (#42)
  function fit(n) {
    draft = Array.from({ length: n }, (_, i) => draft[i] ?? null);
    if (cursor != null && cursor >= n) cursor = null;
    if (cursor == null) next(0);
  }
  // select the first empty slot from i on (wrapping), or none when the row is full
  function next(i) {
    const n = draft.length;
    for (let k = 0; k < n; k++) { const j = (i + k) % n; if (draft[j] == null) { cursor = j; return; } }
    cursor = null;
  }

  // my previous guess on this safe, to start from when only a peg or two should change
  function lastGuess() {
    for (const round of [...S.safecracker.history].reverse()) {
      const h = round.find((x) => x.by === S.me.id);
      if (h) return h.code.slice();
    }
    return null;
  }

  function canPlay() {
    const g = S.safecracker;
    return S.phase === 'playing' && (g.stage === 'crack' || g.stage === 'set') && !S.me.spectator && !S.me.eliminated && !g.mine && !!ctx.act;
  }

  function tapColor(c) {
    const g = S.safecracker;
    if (probing) {
      probing = false;
      ctx.quiet(ctx.act('probe', { color: c }));
      return paint();
    }
    if (cursor == null) return;
    // without repeats, a colour already in the row swaps places with the selected slot (#41)
    const j = g.repeats ? -1 : draft.indexOf(c);
    if (j >= 0 && j !== cursor) draft[j] = draft[cursor];
    draft[cursor] = c;
    next(cursor + 1);
    paint();
  }

  // the entry area only (no server round-trip)
  function paint() {
    const g = S.safecracker, live = canPlay();
    const slots = $('scSlots'); slots.innerHTML = '';
    const shown = g.mine || draft;
    for (let i = 0; i < g.length; i++) {
      const p = peg(shown[i], 'slot' + (shown[i] == null ? ' empty' : '') + (live && i === cursor ? ' sel' : ''));
      if (live) {
        p.setAttribute('role', 'button');
        p.setAttribute('aria-label', `spot ${i + 1}: ${shown[i] == null ? 'empty' : 'colour ' + (shown[i] + 1)}`);
        // tap a slot to choose where the next colour goes; tap the selected one again to empty it
        p.onclick = () => {
          if (i === cursor && draft[i] != null) draft[i] = null;
          else cursor = i;
          paint();
        };
      }
      slots.append(p);
    }
    const pad = $('scPad'); pad.innerHTML = '';
    for (let c = 0; c < g.colors; c++) {
      const b = peg(c, 'pad' + (probing ? ' probing' : ''));
      const used = !g.repeats && draft.includes(c) && !probing;
      const open = live && (probing || cursor != null);
      b.setAttribute('role', 'button');
      b.setAttribute('aria-label', `colour ${c + 1}` + (used ? ' (in your guess: tap to move it here)' : ''));
      b.classList.toggle('off', !open);
      b.classList.toggle('used', open && used);
      if (notes[c]) b.classList.add('note-' + MARKS[notes[c]]);
      if (open) b.onclick = () => tapColor(c);
      pad.append(b);
    }
    const probed = g.probed.includes(S.me.id);
    $('scBack').disabled = !live || draft.every((x) => x == null);
    $('scAgain').disabled = !live || !lastGuess();
    $('scProbe').disabled = !live || probed || g.stage === 'set';
    $('scProbe').classList.toggle('on', probing);
    $('scProbe').textContent = probed ? '🔍 Used' : probing ? '🔍 Pick a colour…' : '🔍 Probe';
    $('scLock').disabled = !live || draft.some((x) => x == null);
    $('scLock').textContent = g.stage === 'set' ? '🔒 Set my code' : '🔒 Lock in';
    const waiting = g.waiting.map((id) => ctx.player(id)?.name).filter(Boolean);
    $('scStatus').textContent = S.phase !== 'playing' ? ''
      : g.stage === 'open' ? 'Next safe coming up…'
      : g.stage === 'set' ? (g.mine ? `⚔️ Your code is set. Waiting for ${waiting.join(', ') || '…'}` : '⚔️ Build the secret code your rival has to crack.')
      : g.mine ? `🔒 Locked in. Waiting for ${waiting.join(', ') || '…'}`
      : probing ? 'Tap a colour to learn how many of it the code holds (costs a point if you crack this safe).'
      : waiting.length > 1 ? `Still choosing: ${waiting.join(', ')}`
      : 'Tap a spot to change just that peg.';
  }

  function render(s, c) {
    S = s; ctx = c;
    const g = S.safecracker;
    // every round starts from an empty guess (#45); ↺ Last brings the previous one back
    const key = `${g.safe}:${g.round}`;
    if (draftFor !== key) { draft = []; cursor = 0; probing = false; draftFor = key; }
    fit(g.length);
    $('scSafe').textContent = (g.duel ? '⚔️ ' : '🔐 ') + (g.safes > 1 ? `Safe ${g.safe} of ${g.safes}` : g.duel ? 'Duel' : 'The safe');
    $('scRound').textContent = g.stage === 'set' ? 'Setting codes' : `Guess ${Math.min(g.round, g.rounds)} of ${g.rounds}`;

    standingsCard($('scStand'), g.standings, { title: `After safe ${g.safe} of ${g.safes}` });
    // a duel's codes come as [[owner, code], ...]; a race has one shared code
    const code = g.code || g.opened;
    const box = $('scOpened');
    box.hidden = !code && !(g.duel && g.mySet && g.stage === 'crack');
    box.innerHTML = '';
    if (code && g.duel) {
      for (const [pid, c] of code) {
        const line = ctx.el('div', '', pid === S.me.id ? 'Your code: ' : `${ctx.player(pid)?.name ?? '?'}'s code: `);
        line.append(...c.map((x) => peg(x)));
        box.append(line);
      }
    } else if (code) box.append(ctx.el('span', '', g.code ? 'The code: ' : 'Opened: '), ...code.map((x) => peg(x)));
    else if (!box.hidden) box.append(ctx.el('span', '', '🛡️ Your code: '), ...g.mySet.map((x) => peg(x, 'small')));

    const hist = $('scHistory'); hist.innerHTML = '';
    if (!g.history.length) hist.append(ctx.el('p', 'hint', g.duel ? 'Both of you lock in a guess at the other\'s code, then both are revealed together.'
      : 'No guesses yet. Everyone locks in a first guess, then all are revealed together.'));
    // a freshly revealed round: its clue pins drop in one at a time, ticking like tumblers
    const freshRound = seenRounds !== null && g.history.length > seenRounds && seenSafe === g.safe ? g.history.length - 1 : -1;
    let pinK = 0;
    g.history.forEach((round, i) => {
      const box = ctx.el('div', 'sc-round');
      box.append(ctx.el('span', 'sc-rnum', String(i + 1)));
      const rows = ctx.el('div', 'sc-rows');
      for (const h of round) {
        const p = ctx.player(h.by);
        const row = ctx.el('div', 'sc-row' + (h.by === S.me.id ? ' me' : g.duel ? ' theirs' : ''));
        const who = ctx.el('span', 'sc-who', g.duel && h.by !== S.me.id ? `${p?.name ?? '?'} → 🛡️` : p?.name ?? '?');
        if (g.duel && h.by !== S.me.id) who.title = 'Their guess at your code';
        who.style.borderColor = p?.color ?? '#777';
        const pins = ctx.el('span', 'sc-pins');
        pins.title = `${h.exact} right spot, ${h.near} wrong spot`;
        for (let k = 0; k < h.exact; k++) pins.append(ctx.el('span', 'sc-pin on'));
        for (let k = 0; k < h.near; k++) pins.append(ctx.el('span', 'sc-pin'));
        if (!h.exact && !h.near) pins.append(ctx.el('span', 'sc-none', '—'));
        if (i === freshRound && motionOK()) for (const pin of pins.children) { pin.classList.add('drop'); pin.style.animationDelay = pinK++ * 0.12 + 's'; }
        row.append(who, ctx.el('span', 'sc-code'), pins);
        row.children[1].append(...h.code.map((x) => peg(x, 'small')));
        rows.append(row);
      }
      box.append(rows);
      hist.append(box);
    });
    hist.scrollTop = hist.scrollHeight;
    if (freshRound >= 0) for (let k = 0; k < Math.min(pinK, 12); k++) setTimeout(() => ctx.sfx('tick'), k * 120);
    // cracked: the dial spins and the door swings open
    const opened = !!(g.code || g.opened);
    if (opened && seenOpen === false && seenSafe === g.safe) {
      const cracked = g.history.at(-1)?.some((h) => h.exact === g.length && h.by === S.me.id);
      const door = ctx.el('div', 'sc-door'); door.append(ctx.el('span', 'sc-dial'));
      $('scOpened').prepend(door);
      ctx.sfx(cracked ? 'fanfare' : 'crack');
      if (cracked) Kit.callout('🔓 Cracked!', 'gold');
    }
    seenOpen = opened; seenRounds = g.history.length; seenSafe = g.safe;

    if (notesFor !== g.safe) { notes = []; notesFor = g.safe; }
    paintNotes();

    $('scProbeInfo').textContent = g.myProbe ? `🔍 Your probe: the code holds ${g.myProbe[1]} of colour ${g.myProbe[0] + 1}.`
      : 'Your 🔍 probe for this safe is unused.';
    paint();
  }

  function paintNotes() {
    const box = $('scNotes'); box.innerHTML = '';
    for (let c = 0; c < S.safecracker.colors; c++) {
      const p = peg(c, 'note' + (notes[c] ? ' note-' + MARKS[notes[c]] : ''));
      p.setAttribute('role', 'button');
      p.setAttribute('aria-label', `colour ${c + 1}: ${['no note', 'not in the code', 'in the code'][notes[c] || 0]}`);
      p.onclick = () => { notes[c] = ((notes[c] || 0) + 1) % 3; paintNotes(); paint(); };
      box.append(p);
    }
  }

  const turnText = (s) => {
    const g = s.safecracker;
    if (s.phase !== 'playing' || s.me.spectator) return null;
    return g.stage === 'open' ? '🔓 Safe opened!' : g.stage === 'set' ? (g.mine ? '⚔️ Code set — waiting…' : '⚔️ Set your secret code!') : g.mine ? '🔒 Locked in — waiting…' : '🔐 Build your guess!';
  };
  const myMove = (s) => s.phase === 'playing' && ['crack', 'set'].includes(s.safecracker.stage) && !s.safecracker.mine && !s.me.spectator;

  return { mount, render, turnText, myMove };
})();
