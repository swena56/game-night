// The console buffers keystrokes locally. The room validates completed words in order.
UI.keyclash = (() => {
  let S, ctx, raf, round, idx, stream, typed, errs, offer, pending, acceptedAt, sending, live;
  let seen, fx, launches, leftAt, left, milestoneUntil, cleanup, reduced, prefs;
  let previewKey, letterKey, offerKey, nextClock, completed;
  let skippedUntil, selectedPower, streamDraft, recovery;
  let roster = [], hues = new Map();
  const $ = (id) => document.getElementById(id);
  const HUES = [205, 28, 355, 163, 45, 284, 340, 132];
  const ARENAS = {
    dusk: ['#120f2b', '#2a2052', '#4a2d5e', '#2b2148', '#1f1838', '#54406e', '#1d1629'],
    aurora: ['#091a29', '#125051', '#1b6b6e', '#183842', '#11272f', '#346066', '#13262d'],
    ember: ['#25101b', '#5d293f', '#884d47', '#4b3042', '#331e2f', '#7a504d', '#281923'],
  };
  const K = () => S?.keyclash;
  const local = () => K()?.fighters.find((f) => f.id === S.me.id);
  const fighters = () => roster;
  const hue = (id) => hues.get(id) ?? HUES[0];
  const POWER_NAMES = { shield: 'Shield', strike: 'Strike', heal: 'Heal' };
  const POWER_KEYS = ['shield', 'strike', 'heal'];
  const ICON = { shield: '🛡️', strike: '💥', heal: '💚' };
  const MILESTONES = { 3: 'Heating Up', 5: 'On Fire', 10: 'Rampage', 15: 'Unstoppable', 20: 'Legendary' };
  const DEFAULTS = { size: 'auto', arena: 'dusk', motion: false, shake: false, keys: false, sound: true, particles: 'normal', contrast: false, colorblind: false, skip: false, focus: false };
  const motionOff = () => reduced.matches || prefs.motion || prefs.focus;
  const blocked = () => ['modal', 'chatPanel', 'prefsPanel', 'gameMenu', 'keyclashPrefs'].some((id) => $(id)?.hidden === false);
  const preparing = () => !!K()?.preparing && !ctx?.readOnly && !S.paused && S.phase === 'playing';
  const interactive = (el) => el?.closest?.('input, textarea, select, button, a[href], [contenteditable], [role="button"], [role="textbox"]');

  function mount(main) {
    S = ctx = null; round = null; live = false; seen = 0; nextClock = 0; bgCache = null;
    reportKey = ''; reportRound = null; dismissedMatch = null;
    previewKey = letterKey = offerKey = null;
    cleanup = new AbortController();
    const { signal } = cleanup;
    reduced = matchMedia('(prefers-reduced-motion: reduce)');
    try { prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('keyclash-preferences')) }; }
    catch { prefs = { ...DEFAULTS }; }
    main.innerHTML = `<div class="kc">
      <div class="kc-top"><div id="kcFighters" class="kc-fighters"></div>
        <div class="kc-clock"><span id="kcRound"></span><b id="kcLeft"></b><div class="kc-time"><i id="kcTime"></i></div>
        <span id="kcScore"></span></div></div>
      <div class="kc-arena"><canvas id="kcCanvas" aria-hidden="true"></canvas><p id="kcGoal" class="kc-goal" hidden></p><div id="kcBanner" class="kc-banner" hidden></div>
        <div id="kcMilestone" class="kc-milestone" role="status" hidden></div><div id="kcReport" class="kc-report" hidden></div></div>
      <div class="kc-type" id="kcType">
        <div class="kc-console-top"><div id="kcCombo" class="kc-combo"></div><div id="kcSpecial" class="kc-special">
          <span>Special <b id="kcPercent"></b></span><div class="kc-charge"><i id="kcEnergy"></i></div></div>
          <div id="kcAttack" class="kc-attack"><span>Attack</span><div class="kc-charge"><i id="kcAttackFill"></i></div></div></div>
        <div id="kcStream" class="kc-stream"><div id="kcTrack" class="kc-track"><span id="kcCompleted" class="kc-completed" aria-hidden="true"></span><span id="kcCurrent" class="kc-cur"></span><div id="kcPreview" class="kc-preview"></div></div><span id="kcCaret" class="kc-caret" aria-hidden="true"></span></div>
        <input id="kcInput" class="kc-input" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"
          aria-label="Typing console. Type the active word, then press Space." aria-describedby="kcCurrent kcCorrection kcOffer">
        <div class="kc-feedback">
          <div id="kcCorrection" class="kc-correction"></div>
          <div class="kc-note" role="status"><span id="kcNote"></span><span id="kcSkipped" hidden>Skipped</span></div>
        </div>
        <button id="kcFocus" class="kc-focus" hidden>Click to resume typing</button>
        <div id="kcOffer" class="kc-offer" hidden></div>
      </div>
      <div class="kc-controls">
        <button id="kcReady" class="ghost-btn" hidden>Ready to type</button>
        <button id="kcCharts" class="ghost-btn" aria-controls="kcReport" aria-expanded="false" hidden>Match charts</button>
        <button id="kcOptions" class="ghost-btn" aria-expanded="false" aria-controls="keyclashPrefs">Typing settings</button>
        <button id="kcActivity" class="ghost-btn" aria-expanded="false" aria-controls="log">Activity</button>
        <button id="kcChat" class="ghost-btn" data-keep-drawer aria-expanded="false" aria-controls="chatPanel">Chat</button>
      </div>
      <div id="keyclashPrefs" class="kc-prefs" role="region" aria-label="Typing settings" hidden></div>
    </div>`;
    const input = $('kcInput');
    input.readOnly = !matchMedia('(pointer: coarse)').matches;
    if (input.readOnly) input.inputMode = 'none';
    input.addEventListener('keydown', onKey);
    input.addEventListener('beforeinput', onBeforeInput);
    input.addEventListener('input', () => { input.value = ''; });
    for (const event of ['paste', 'drop']) input.addEventListener(event, (e) => e.preventDefault());
    input.addEventListener('focus', syncFocus);
    input.addEventListener('blur', () => queueMicrotask(syncFocus));
    $('kcFocus').onclick = focusTyping;
    $('kcStream').onclick = focusTyping;
    $('kcChat').onclick = () => { $('chatBtn')?.click(); syncFocus(); };
    $('kcActivity').onclick = () => setActivity($('kcActivity').getAttribute('aria-expanded') !== 'true');
    $('kcReady').onclick = () => {
      if (focusTyping() && K().stage === 'ready' && !K().ready) ctx.quiet(ctx.act('clash_ready', { rid: round }));
    };
    $('kcCharts').onclick = () => {
      dismissedMatch = $('kcReport').hidden ? null : round;
      paintReport();
      if (!$('kcReport').hidden) $('kcReport').querySelector('.kc-rep-close')?.focus();
    };
    $('kcOptions').onclick = () => toggleOptions($('keyclashPrefs').hidden);
    buildOptions();
    applyOptions();

    addEventListener('keydown', shortcuts, { capture: true, signal });
    addEventListener('blur', syncFocus, { signal });
    addEventListener('focus', syncFocus, { signal });
    reduced.addEventListener('change', applyOptions, { signal });
    const observer = new MutationObserver((changes) => {
      if (changes.some(({ target }) => target.id === 'modal' && target.hidden)) {
        const active = document.activeElement;
        if (active === $('helpBtn') || !interactive(active) || active?.closest('#modal')) focusTyping();
      }
      syncFocus();
    });
    for (const id of ['modal', 'chatPanel', 'prefsPanel', 'gameMenu']) {
      if ($(id)) observer.observe($(id), { attributes: true, attributeFilter: ['hidden'] });
    }
    signal.addEventListener('abort', () => observer.disconnect());
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      draw();
      if (now >= nextClock) { tickClock(); nextClock = now + 80; }
    };
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cleanup.abort(); cancelAnimationFrame(raf);
    $('kcType')?.closest('.layout')?.classList.remove('kc-activity-open');
    S = ctx = null; live = false;
  }

  function setActivity(open) {
    $('kcActivity').setAttribute('aria-expanded', String(open));
    $('kcType').closest('.layout')?.classList.toggle('kc-activity-open', open);
    if (open && $('logToggle')?.getAttribute('aria-expanded') === 'false') $('logToggle').click();
  }

  function toggleOptions(open) {
    $('keyclashPrefs').hidden = !open;
    $('kcOptions').setAttribute('aria-expanded', String(open));
    if (open) $('keyclashPrefs').querySelector('select').focus();
    else if (!focusTyping()) $('kcOptions').focus();
    syncFocus();
  }

  function buildOptions() {
    const box = $('keyclashPrefs');
    const select = (key, title, options) => {
      const input = document.createElement('select');
      for (const [value, label] of options) input.add(new Option(label, value));
      input.value = prefs[key];
      add(key, title, input, () => input.value);
    };
    const add = (key, title, input, value) => {
      const label = document.createElement('label');
      label.append(title, input); box.append(label);
      input.onchange = () => {
        prefs[key] = value();
        try { localStorage.setItem('keyclash-preferences', JSON.stringify(prefs)); } catch {}
        applyOptions();
      };
    };
    select('size', 'Typing size', [['small', 'Small'], ['auto', 'Default'], ['large', 'Large']]);
    select('arena', 'Arena lighting', [['dusk', 'Moonlit dusk'], ['aurora', 'Aurora'], ['ember', 'Ember sunset']]);
    select('particles', 'Particles', [['off', 'Off'], ['low', 'Low'], ['normal', 'Full']]);
    for (const [key, title] of Object.entries({ skip: 'Allow skipping mistyped words', focus: 'Focus layout', motion: 'Reduce motion', shake: 'Screen shake', keys: 'Keystroke sounds', sound: 'Combat sounds', contrast: 'High contrast', colorblind: 'Colorblind feedback' })) {
      const input = document.createElement('input');
      input.type = 'checkbox'; input.checked = prefs[key];
      add(key, title, input, () => input.checked);
    }
    const done = document.createElement('button');
    done.className = 'ghost-btn'; done.textContent = 'Done'; done.onclick = () => toggleOptions(false); box.append(done);
  }

  function applyOptions() {
    const board = $('kcType').closest('.kc');
    board.dataset.size = prefs.size;
    board.classList.toggle('kc-focus-layout', prefs.focus);
    board.classList.toggle('kc-reduced', motionOff());
    board.classList.toggle('kc-contrast', prefs.contrast);
    board.classList.toggle('kc-colorblind', prefs.colorblind);
    if (motionOff() || !prefs.shake) shakeUntil = 0;
    if (motionOff() || prefs.particles === 'off') parts = [];
    if (motionOff()) {
      $('kcTrack').getAnimations().forEach((animation) => animation.cancel());
    }
    previewKey = letterKey = null;
    if (round) paintTyping();
  }

  function syncFocus() {
    const input = $('kcInput');
    if (!input) return;
    const focused = document.activeElement === input && document.hasFocus() && !blocked();
    $('kcType').classList.toggle('kc-focused', (live || preparing()) && focused);
    $('kcFocus').hidden = !live || focused || blocked();
    $('kcChat').setAttribute('aria-expanded', String($('chatPanel')?.hidden === false));
  }

  function focusTyping() {
    if ((!live && !preparing()) || blocked()) return false;
    $('kcInput').focus({ preventScroll: true });
    syncFocus();
    return true;
  }

  function shortcuts(e) {
    if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || ctx?.readOnly) return;
    if (live && !blocked() && (e.target === $('kcInput') || e.target?.closest?.('#kcOffer'))) {
      const kind = e.altKey ? POWER_KEYS[Number(e.code.slice(-1)) - 1] : null;
      if (kind && offer?.[kind] && /^Digit[1-3]$/.test(e.code)) {
        e.preventDefault(); e.stopPropagation(); selectPower(kind); return;
      }
      if (e.key === 'Escape' && selectedPower) {
        e.preventDefault(); e.stopPropagation(); selectPower(selectedPower); return;
      }
    }
    if (e.altKey) return;
    if (e.key === 'Escape' && $('keyclashPrefs')?.hidden === false && !$('modal')?.matches(':not([hidden])')) {
      e.preventDefault(); e.stopPropagation(); toggleOptions(false); return;
    }
    if (blocked() || S?.phase !== 'playing' || !S.canPause) return;
    const inside = e.target === $('kcInput') || !interactive(e.target) || e.target?.closest?.('#pausedCover');
    if (inside && (e.key === 'Escape' || (S.paused && e.key.toLowerCase() === 'p'))) {
      e.preventDefault(); e.stopPropagation(); ctx.quiet(ctx.act(S.paused ? 'resume' : 'pause'));
    }
  }

  // Keyboard and mobile input feed the same append-only buffer.
  function onKey(e) {
    if (!live || blocked() || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!['Backspace', ' ', 'Enter'].includes(e.key) && !/^[a-z]$/i.test(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Backspace') backspace();
    else if (e.key === ' ' || e.key === 'Enter') { if (!e.repeat) submit(e.key === ' '); }
    else addLetter(e.key.toLowerCase());
  }

  function onBeforeInput(e) {
    e.preventDefault();
    if (!live || blocked() || e.isComposing) return;
    if (e.inputType === 'deleteContentBackward') backspace();
    if (e.inputType !== 'insertText') return;
    if (e.data === ' ') submit(true);
    else if (/^[a-z]$/i.test(e.data ?? '')) addLetter(e.data.toLowerCase());
  }

  const target = () => stream.get(idx) || '';
  function activeChoice() {
    return selectedPower && offer?.[selectedPower] ? [selectedPower, offer[selectedPower]] : ['', target()];
  }

  function clearPower() {
    selectedPower = null;
    ({ typed, errs } = streamDraft ?? { typed: '', errs: 0 });
    streamDraft = null;
  }

  function selectPower(kind) {
    if (!live || !offer?.[kind]) return;
    if (selectedPower === kind) clearPower();
    else {
      streamDraft ??= { typed, errs };
      selectedPower = kind;
      typed = ''; errs = 0;
    }
    $('kcNote').textContent = '';
    paintTyping(); paintLocal(); focusTyping();
  }

  function addLetter(letter) {
    if (!target()) return;
    const [, expected] = activeChoice();
    if (typed.length > expected.length) return;
    typed += letter;
    const [, word] = activeChoice();
    const wrong = word[typed.length - 1] !== letter;
    if (wrong) errs = Math.min(99, errs + 1);
    if (prefs.keys) ctx.sfx?.(wrong ? 'wrong' : 'tick');
    $('kcNote').textContent = '';
    paintTyping(); paintLocal();
  }

  function backspace() {
    typed = typed.slice(0, -1);
    $('kcNote').textContent = '';
    paintTyping(); paintLocal();
  }

  const firstMistake = (word) => [...typed].findIndex((ch, i) => word[i] !== ch);
  const canSkip = (power, word, mistake) => prefs.skip && !power && mistake >= 0 && typed.length >= word.length;

  function projection() {
    const me = local();
    if (!me) return { chars: 0, errors: 0, combo: 0, charge: 0 };
    let { chars, combo, charge } = me, errors = me.errors ?? 0;
    for (const entry of pending) {
      if (entry.number <= me.words) continue;
      errors += entry.body.errs;
      if (entry.skip) {
        combo = 0;
        continue;
      }
      const n = entry.body.word.length;
      chars += n;
      combo = entry.body.errs ? 0 : combo + 1;
      charge = entry.power ? 0 : Math.min(K().charge, charge + n * (entry.body.errs ? 1 : 3));
    }
    return { chars, errors: errors + errs, combo: errs ? 0 : combo, charge };
  }

  function recoverStream() {
    if (!recovery) return;
    recovery.entries = recovery.entries.filter((entry) => entry.body.i >= idx);
    while (recovery.entries[0]?.body.i === idx) {
      const { body, skip } = recovery.entries.shift();
      if (!skip && body.word !== target()) break;
      const number = (pending.at(-1)?.number ?? local().words) + 1;
      pending.push({ number, power: null, skip, body: { ...body, number } });
      idx++;
    }
    if (idx === recovery.draft.idx && target() === recovery.draft.word) {
      ({ typed, errs } = recovery.draft);
      recovery = null;
    } else if (idx >= recovery.draft.idx) {
      recovery = null;
    }
  }

  function submit(bySpace) {
    if (!typed) return;
    const [power, word] = activeChoice();
    let skip = false;
    if (typed !== word) {
      const mistake = firstMistake(word);
      skip = bySpace && canSkip(power, word, mistake);
      if (!skip) {
        if (mistake < 0) $('kcNote').textContent = 'Finish the word before pressing Space.';
        return;
      }
    }
    const me = local(), last = pending.at(-1);
    const body = { rid: round, i: idx, word: typed, errs };
    if (skip) body.errs = Math.max(errs, [...typed].filter((ch, i) => target()[i] !== ch).length);
    if (power) body.power = power;
    const number = Math.max(me.words, last?.number ?? 0) + 1;
    body.number = number;
    pending.push({ number, power, skip, body });
    completed = skip ? '' : typed;
    const perfect = !errs;
    if (power) { offer = null; clearPower(); }
    else { idx++; typed = ''; errs = 0; recoverStream(); }
    const now = performance.now();
    $('kcNote').textContent = '';
    if (skip) {
      skippedUntil = now + 900;
      $('kcSkipped').hidden = false;
      $('kcMilestone').hidden = true;
    } else {
      const { combo } = projection();
      launches.push({ at: now, power, combo });
      if (perfect && !prefs.focus && MILESTONES[combo]) {
        $('kcMilestone').textContent = `${MILESTONES[combo]} · ${combo} perfect words`;
        $('kcMilestone').hidden = false; milestoneUntil = now + 1200;
        if (prefs.sound) ctx.sfx?.(combo >= 10 ? 'fanfare' : 'good');
      }
    }
    paintTyping(true); paintLocal(); sendNext(pending);
  }

  async function sendNext(queue) {
    const entry = queue.find((item) => !item.sent);
    if (queue !== pending || !live || sending || !entry) return;
    sending = true;
    let retry = false;
    // Respect the existing server speed limit even when several words were typed during a slow request.
    const ms = Math.max(0, acceptedAt + entry.body.word.length * (K().minCharMs ?? 30) + 4 - performance.now());
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
    if (queue !== pending || !S) return;
    try {
      if (!live) return;
      await ctx.act(entry.skip ? 'skip' : 'word', entry.body);
      if (queue !== pending || !S) return;
      entry.sent = true;
      acceptedAt = performance.now();
    } catch (error) {
      if (queue !== pending || !S) return;
      if (error.message === 'The game is paused.') return;
      if (error.message === 'Too fast.' && !entry.retried && queue.includes(entry)) {
        entry.retried = retry = true;
        acceptedAt = performance.now();
        return;
      }
      const me = local();
      if (!me || !live) return;
      if (me.words >= entry.number) {
        entry.sent = true;
        acceptedAt = performance.now();
        return;
      }
      const acknowledged = queue.filter((item) => item.sent && item.number > me.words);
      const lastStream = acknowledged.filter((item) => !item.power).at(-1);
      const draft = streamDraft ?? { typed, errs };
      recovery = {
        entries: [...queue.filter((item) => item !== entry && !item.sent && !item.power && item.number > me.words),
          ...(recovery?.entries ?? [])],
        draft: recovery?.draft ?? { ...draft, idx, word: target() },
      };
      pending = acknowledged; sending = false;
      idx = Math.max(me.idx, lastStream ? lastStream.body.i + 1 : 0);
      completed = typed = ''; errs = 0; selectedPower = streamDraft = null;
      offer = acknowledged.some((item) => item.power) ? null : K().offer;
      launches = [];
      if (!acknowledged.length) acceptedAt = performance.now() - (K().wordAge ?? 0) * 1000;
      $('kcSkipped').hidden = true;
      recoverStream();
      const message = entry.power ? `Power word “${entry.body.word}” was not accepted.`
        : `Retype “${target()}” to continue.`;
      $('kcNote').textContent = message + (recovery ? ' Later words are saved.' : '');
      sendNext(pending);
      paintTyping(); paintLocal();
    } finally {
      if (queue === pending && S) {
        sending = false;
        if (entry.sent || retry) sendNext(queue);
      }
    }
  }

  function render(s, c) {
    const wasLive = live;
    S = s; ctx = c;
    const k = K();
    if (!k) return;
    roster = [...k.fighters].sort((a, b) => Number(b.id === s.me.id) - Number(a.id === s.me.id));
    hues = new Map(roster.map((fighter, index) => {
      const paletteIndex = s.palette?.indexOf(c.player(fighter.id)?.color) ?? -1;
      return [fighter.id, HUES[paletteIndex] ?? HUES[index]];
    }));
    const changed = k.rid !== round;
    const me = local();
    if (changed) {
      selectedPower = streamDraft = recovery = null;
      round = k.rid; idx = k.base; typed = ''; completed = ''; errs = 0; stream = new Map(); offer = null;
      pending = []; sending = false; fx = []; launches = []; parts = []; knocked.clear(); celebrated.clear();
      shakeUntil = milestoneUntil = -Infinity;
      skippedUntil = Infinity;
      $('kcSkipped').hidden = true;
      acceptedAt = performance.now() - (k.wordAge ?? 0) * 1000;
      $('kcNote').textContent = ''; $('kcMilestone').hidden = true;
      setActivity(false);
    }
    k.words.forEach((word, i) => stream.set(k.base + i, word));
    for (const i of stream.keys()) { if (i < k.base - 1) stream.delete(i); }
    while (pending.length && pending[0].number <= (me?.words ?? 0)) pending.shift();
    if (me && me.idx > idx) {
      idx = me.idx; typed = ''; errs = 0;
      if (live && recovery) recoverStream();
    }
    if (!me) idx = k.base;
    const nextOffer = pending.some((entry) => entry.power) ? null : k.offer;
    if (selectedPower && offer?.[selectedPower] !== nextOffer?.[selectedPower]) clearPower();
    offer = nextOffer;
    left = k.left; leftAt = performance.now();
    for (const e of k.events) if (e.n > seen) { seen = e.n; play(e); }
    live = !c.readOnly && s.phase === 'playing' && k.playing && !s.paused;
    const inp = $('kcInput');
    inp.disabled = !live && !preparing();
    const ready = $('kcReady');
    ready.hidden = !preparing();
    ready.textContent = k.stage === 'ready' && !k.ready ? 'Ready to type' : 'Focus typing';
    if (!k.playing || s.phase !== 'playing') {
      if (pending.length) { pending = []; sending = false; }
      typed = ''; errs = 0; recovery = null;
    }
    if (live && !wasLive && !sending) acceptedAt = performance.now() - (k.wordAge ?? 0) * 1000;
    if (live && (!wasLive || changed)) {
      const focusOnStart = () => {
        const active = document.activeElement;
        if (!interactive(active) || active === inp || active?.closest('[hidden], #pausedCover') || active === $('pauseBtn')) focusTyping();
      };
      focusOnStart();
      requestAnimationFrame(() => { if (inp.isConnected && !inp.disabled) focusOnStart(); });
    }
    syncFocus();
    const maxRounds = k.maxRounds ?? k.rounds + 2;
    const extra = k.round === maxRounds ? ' · last round' : k.round > k.rounds ? ` · extra (max ${maxRounds})` : '';
    $('kcRound').textContent = `Round ${k.round}${extra} · first to ${k.need}`;
    $('kcRound').title = `Round wins needed: ${k.need}. At most ${maxRounds} rounds, including draws.`;
    $('kcScore').textContent = fighters().length === 2 ? fighters().map((f) => f.wins).join(' : ') : '';
    const goal = $('kcGoal');
    goal.hidden = s.phase !== 'playing' || k.stage === 'reveal';
    const aim = me?.target && ['lms', 'siege'].includes(k.mode)
      ? ` Target: ${nameOf(me.target)}${me.retaliating ? ' (last to hit you)' : ''}.` : '';
    const rope = prefs.focus && k.mode === 'tug' && Math.abs(k.rope) >= 0.5
      ? ` ${k.teams[Number(k.rope > 0)]} leads by ${Math.abs(k.rope)}.` : '';
    const objective = keyClashRules(k.mode, k.unlimited || k.goal ? 0 : k.secs).goal + aim + rope;
    if (goal.textContent !== objective) goal.textContent = objective;
    paintFighters(); paintTyping(); paintLocal(); paintBanner(); paintReport();
    sendNext(pending);
  }

  // ---------- (#381) typing analytics: between rounds the round just played, after the match every round

  let reportRound = null, reportKey = '', dismissedMatch = null;
  const SVG = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(SVG, tag); for (const [a, v] of Object.entries(attrs)) e.setAttribute(a, v); return e; };
  const color = (id) => `hsl(${hue(id)} 80% 62%)`;
  const nameOf = (id) => ctx.player(id)?.name ?? K()?.history?.find((h) => h.names?.[id])?.names[id] ?? '?';

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
    const toggle = $('kcCharts'), available = hist.length > 0 && (over || k.stage === 'reveal');
    toggle.hidden = !over || !available;
    box.hidden = !available || (over && dismissedMatch === k.rid);
    toggle.setAttribute('aria-expanded', String(!box.hidden));
    if (box.hidden) return;
    const key = `${k.rid}:${hist.length}:${over}`;
    if (key === reportKey) return;   // drawn already: keep the hover state
    reportKey = key;
    if (!over || reportRound == null || reportRound >= hist.length) reportRound = hist.length - 1;
    box.hidden = false;
    const h = hist[reportRound], ids = Object.keys(h.stats);
    const tableIds = over ? [...new Set(hist.flatMap((entry) => Object.keys(entry.stats)))] : ids;
    const head = ctx.el('div', 'kc-rep-head');
    const won = h.winners.length === 1 ? ` · 🏆 ${nameOf(h.winners[0])}` : h.winners.length ? ` · 🏆 ${h.winners.map(nameOf).join(', ')}` : ' · 🤝 a draw';
    head.append(ctx.el('b', '', (over ? `📈 How everyone typed · round ${h.round}` : `📈 Round ${h.round}`) + won));
    if (over && hist.length > 1) {
      const tabs = ctx.el('div', 'kc-rep-tabs');
      hist.forEach((x, i) => { const b = ctx.el('button', 'ghost-btn' + (i === reportRound ? ' on' : ''), `Round ${x.round}`); b.onclick = () => { reportRound = i; reportKey = ''; paintReport(); }; tabs.append(b); });
      head.append(tabs);
    }
    if (over) {
      const x = ctx.el('button', 'ghost-btn kc-rep-close', '✕');
      x.setAttribute('aria-label', 'Hide the charts');
      x.onclick = () => { dismissedMatch = k.rid; paintReport(); toggle.focus(); };
      head.append(x);
    }
    if (over && k.missedWords?.length && !ctx.readOnly) {
      const drill = ctx.el('button', 'ghost-btn', 'Practice missed words');
      drill.onclick = () => openPractice(k.missedWords);
      head.append(drill);
    }
    box.replaceChildren(head, chart(h, ids), legend(ids), ctx.el('p', 'kc-wpm-note', 'WPM counts five correct letters as one word and uses the full round time.'), table(hist, tableIds, over ? null : reportRound));
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
    const scrub = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: Math.ceil(tMax), value: 0 });
    const label = ctx.el('label', 'kc-scrub', 'Chart time');
    label.append(scrub);
    const chartLabel = (id, t) => {
      const points = lines[id];
      let lo = 0, hi = points.length;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (points[mid].t <= t) lo = mid + 1;
        else hi = mid;
      }
      return lo > 0 ? `${Math.round(points[lo - 1].wpm)} wpm` : '–';
    };
    function inspect(t) {
      const values = ids.map((id) => [id, chartLabel(id, t)]);
      scrub.value = String(Math.round(t));
      scrub.setAttribute('aria-valuetext', `${Math.round(t)} seconds. ${values.map(([id, value]) => `${nameOf(id)} ${value}`).join(', ')}`);
      cross.setAttribute('x1', x(t)); cross.setAttribute('x2', x(t)); cross.setAttribute('visibility', 'visible');
      tip.replaceChildren(ctx.el('b', '', `${Math.round(t)} s`), ...values.map(([id, value]) => {
        const row = ctx.el('div', 'kc-tip-row'), sw = ctx.el('i'); sw.style.background = color(id);
        row.append(sw, ctx.el('span', '', nameOf(id)), ctx.el('b', '', value));
        return row;
      }));
      tip.hidden = false;
      const width = svg.clientWidth;
      tip.style.left = `${Math.max(0, Math.min(width - tip.offsetWidth, x(t) * width / W + 12))}px`;
    }
    const inspectPointer = (ev) => {
      const r = svg.getBoundingClientRect(), t = ((ev.clientX - r.left) * (W / r.width) - L) / (W - L - R) * tMax;
      inspect(Math.max(0, Math.min(tMax, t)));
    };
    hit.addEventListener('pointermove', inspectPointer);
    hit.addEventListener('pointerdown', inspectPointer);
    scrub.addEventListener('input', () => inspect(Math.min(tMax, scrub.valueAsNumber)));
    scrub.addEventListener('focus', () => inspect(Math.min(tMax, scrub.valueAsNumber)));
    wrap.append(svg, tip, label);
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
        const cell = ctx.el('td', h.winners.includes(id) ? 'won' : '', s ? `${s.wpm} wpm · ${s.acc}% · ${s.words} words` + (h.winners.includes(id) ? ' 🏆' : '') : '–');
        if (s?.active != null) {
          cell.append(ctx.el('small', 'kc-round-detail',
            `${s.corrected} corrected · ${s.skips} skipped · ${s.active.toFixed(1)}s active`));
        }
        return cell;
      }));
      t.append(row);
    }
    if (only == null && hist.length > 1) {   // the match as a whole
      const row = ctx.el('tr', 'kc-rep-total');
      row.append(ctx.el('th', '', 'Match'), ...ids.map((id) => {
        const rs = hist.map((h) => h.stats[id]).filter(Boolean);
        const best = Math.max(0, ...rs.map((s) => s.best || 0));
        if (rs.some((s) => s.chars == null || s.errors == null || s.secs == null)) {
          const wpm = Math.round(rs.reduce((sum, s) => sum + s.wpm, 0) / rs.length);
          const acc = Math.round(rs.reduce((sum, s) => sum + s.acc, 0) / rs.length);
          return ctx.el('td', '', `Round avg ${wpm} wpm · ${acc}% · best 🔥${best}`);
        }
        const chars = rs.reduce((sum, s) => sum + s.chars, 0);
        const errors = rs.reduce((sum, s) => sum + s.errors, 0);
        const secs = rs.reduce((sum, s) => sum + s.secs, 0);
        const wpm = secs ? Math.round(chars * 12 / secs) : 0;
        const acc = chars + errors ? Math.round(100 * chars / (chars + errors)) : 100;
        return ctx.el('td', '', `${wpm} wpm · ${acc}% · best 🔥${best}`);
      }));
      t.append(row);
    }
    const wrap = ctx.el('div', 'kc-rep-tablewrap'); wrap.append(t);
    return wrap;
  }

  const hud = new Map();

  function paintFighters() {
    const k = K(), box = $('kcFighters'), list = fighters();
    const key = JSON.stringify(list.map((f) => [f.id, nameOf(f.id), hue(f.id)]));
    if (box.dataset.key !== key) {
      box.dataset.key = key; hud.clear(); box.replaceChildren();
      for (const f of list) {
        const card = ctx.el('section', 'kc-f');
        card.classList.toggle('me', f.id === S.me.id);
        card.style.setProperty('--h', hue(f.id));
        const head = ctx.el('div', 'kc-f-head'), portrait = document.createElement('canvas');
        portrait.className = 'kc-portrait'; portrait.width = portrait.height = 72;
        portrait.setAttribute('aria-hidden', 'true');
        const g = portrait.getContext('2d');
        if (g) drawFighter(g, 35, 37, 45, hue(f.id), f.id === S.me.id ? 1 : -1, false, false, 0, false, 0);
        const wins = ctx.el('span', 'kc-wins'), readout = ctx.el('strong', 'kc-vital');
        head.append(portrait, ctx.el('b', 'kc-name', nameOf(f.id)), wins);
        const bar = ctx.el('div', 'kc-hp'), fill = ctx.el('i'), trail = ctx.el('i', 'kc-health-trail');
        bar.append(trail, fill);
        const shield = ctx.el('span', 'kc-shield'), boss = ctx.el('span', 'kc-boss');
        const vitals = ctx.el('div', 'kc-vitals'); vitals.append(readout, shield, boss);
        const stats = ctx.el('div', 'kc-f-stats'), wpm = ctx.el('b', 'kc-wpm'), acc = ctx.el('span'), combo = ctx.el('span');
        stats.append(wpm, acc, combo);
        card.append(head, vitals, bar, stats); box.append(card);
        hud.set(f.id, { card, wins, readout, bar, fill, trail, shield, boss, wpm, acc, combo, hp: null });
      }
    }
    for (const f of list) {
      const row = hud.get(f.id);
      row.card.classList.toggle('ko', f.ko);
      row.card.classList.toggle('kc-low', k.powered && f.hp <= k.hp * 0.25);
      row.wins.textContent = `${f.wins} ${f.wins === 1 ? 'win' : 'wins'}`;
      let percent = 100;
      if (k.powered) {
        percent = 100 * f.hp / k.hp;
        row.readout.textContent = `${f.hp} / ${k.hp} HP` + (k.mode === 'survival' ? ` · ${f.kills} KOs` : '');
      } else if (k.mode === 'hyper') {
        percent = 100 * f.dist / k.track;
        row.readout.textContent = `${Math.round(percent)}% of track`;
      } else if (k.mode === 'tug') {
        row.readout.textContent = k.teams[f.team];
      } else {
        percent = 100 * f.chars / (k.goal || Math.max(1, ...list.map((x) => x.chars)));
        row.readout.textContent = k.goal ? `${f.chars} / ${k.goal} letters` : `${f.chars} letters`;
      }
      row.bar.hidden = k.mode === 'tug';
      row.fill.style.width = row.trail.style.width = `${Math.max(0, Math.min(100, percent))}%`;
      row.trail.classList.toggle('kc-damage', k.powered && row.hp !== null && f.hp < row.hp);
      row.hp = f.hp;
      row.shield.textContent = f.shield ? `🛡 ${f.shield}` : '';
      row.boss.textContent = k.mode === 'boss' ? `Boss ${f.boss} / ${k.bossMax}` : '';
      row.wpm.dataset.chars = f.chars; row.wpm.textContent = `${f.wpm} WPM`;
      row.acc.textContent = `${f.acc}% acc`;
      row.combo.textContent = f.id === S.me.id ? '' : `${f.combo} combo`;
    }
  }

  function paintLocal() {
    const p = projection(), me = local(), k = K();
    const [, word] = activeChoice();
    const correct = [...typed].filter((ch, i) => ch === word[i]).length;
    const chars = p.chars + correct;
    const accuracy = chars + p.errors ? Math.round(100 * chars / (chars + p.errors)) : 100;
    if (me && hud.has(me.id)) {
      const row = hud.get(me.id);
      row.acc.textContent = `${accuracy}% acc`;
      row.wpm.dataset.chars = p.chars;
    }
    $('kcCombo').textContent = `${p.combo} combo`;
    $('kcCombo').classList.toggle('kc-hot', p.combo >= 3);
    $('kcSpecial').hidden = !k.powered;
    $('kcAttack').hidden = !k.powered;
    const charge = Math.round(100 * p.charge / k.charge);
    $('kcPercent').textContent = `${charge}%`;
    $('kcEnergy').style.width = `${charge}%`;
    $('kcSpecial').classList.toggle('kc-ready', charge === 100);
    $('kcAttackFill').style.width = `${word.length ? 100 * correct / word.length : 0}%`;
  }

  function paintLetters(box, word, value) {
    const cells = [...word].map((ch, i) => {
      const state = i >= value.length ? 'untyped' : value[i] === ch ? 'ok' : 'bad';
      return el('span', `kc-letter ${state}`, value[i] ?? ch);
    });
    if (value.length > word.length) {
      for (const ch of value.slice(word.length)) cells.push(el('span', 'kc-overflow', ch));
    }
    box.replaceChildren(...cells);
  }

  function paintTyping(advanced = false) {
    const [power, word] = activeChoice();
    const cur = $('kcCurrent'), next = $('kcPreview'), track = $('kcTrack');
    const words = Array.from({ length: prefs.focus ? 2 : 6 }, (_, i) => stream.get(idx + i + Number(!power))).filter(Boolean);
    const upcoming = JSON.stringify(words);
    if (upcoming !== previewKey) {
      previewKey = upcoming;
      next.replaceChildren(...words.map((w) => ctx.el('span', 'kc-next', w)));
    }
    const caretVisible = live || preparing();
    const letters = JSON.stringify([idx, word, typed, power, completed, caretVisible]);
    if (letters !== letterKey || advanced) {
      letterKey = letters;
      track.getAnimations().forEach((animation) => animation.cancel());
      paintLetters(cur, word, typed);
      $('kcCompleted').textContent = completed;
      $('kcCaret').hidden = !caretVisible || !word;
      track.style.transform = prefs.focus ? '' : `translateX(-${typed.length}ch)`;
      $('kcCaret').style.setProperty('--kc-caret-offset', prefs.focus ? `${Math.min(typed.length, word.length)}ch` : '0ch');
      if (advanced && !motionOff()) {
        track.animate([{ transform: 'translateX(1.2ch)' }, { transform: 'translateX(0)' }], { duration: 85, easing: 'ease-out' });
      }
    }
    const mistake = firstMistake(word);
    let hint = '';
    if (live && mistake >= 0) {
      const steps = typed.length - mistake;
      const correction = mistake === word.length ? 'Backspace to remove the extra letter'
        : `Expected ${word[mistake]} · ${steps} Backspace${steps === 1 ? '' : 's'}`;
      hint = (power ? `${power[0].toUpperCase()}${power.slice(1)} power · ` : '') + correction;
      if (canSkip(power, word, mistake)) hint += ' · Space to skip';
    }
    const correction = $('kcCorrection');
    if (correction.textContent !== hint) correction.textContent = hint;
    paintOffer(power);
  }

  function paintOffer(active) {
    const box = $('kcOffer');
    box.hidden = !offer || !live;
    const me = local(), k = K();
    const key = JSON.stringify([offer, active, me?.hp, me?.shield]);
    if (box.hidden || offerKey === key) return;
    offerKey = key;
    box.replaceChildren(...Object.entries(offer).map(([kind, word]) => {
      const label = POWER_NAMES[kind];
      const chip = ctx.el('button', 'kc-pw kc-pw-' + kind + (active === kind ? ' on' : ''));
      const key = POWER_KEYS.indexOf(kind) + 1;
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(active === kind));
      chip.setAttribute('aria-keyshortcuts', `Alt+${key}`);
      chip.title = active === kind ? 'Cancel power (Escape)' : `Select ${label} (Alt+${key})`;
      chip.onmousedown = (event) => event.preventDefault();
      chip.onclick = () => selectPower(kind);
      const letters = ctx.el('b', 'kc-power-letters');
      let effect = k.effects?.[kind] ?? '';
      if (kind === 'heal' && k.healAmount != null) effect = `+${Math.min(k.healAmount, k.hp - me.hp)} health`;
      if (kind === 'shield' && k.shieldAmount != null) effect = `${me.shield} → ${k.shieldAmount} shield`;
      if (kind === 'strike' && k.strikeBase != null) effect += ` · ${k.strikeBase + word.length} power`;
      paintLetters(letters, word, '');
      chip.append(`${ICON[kind]} ${label} `, letters, ctx.el('small', 'kc-pw-what', active === kind ? `${effect} · tap to cancel` : effect));
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

  function tickClock() {
    const k = S && K();
    if (!k) return;
    if (performance.now() >= skippedUntil) {
      $('kcSkipped').hidden = true;
      skippedUntil = Infinity;
    }
    // (#384) words a minute move with the clock, not only when a word lands: letters so far over the time so far
    if (k.stage === 'play' && k.elapsed != null) {
      const t = k.elapsed + (S.paused ? 0 : (performance.now() - leftAt) / 1000);
      if (t > 1) for (const { wpm } of hud.values()) {
        const text = `${Math.round(+wpm.dataset.chars * 12 / t)} WPM`;
        if (wpm.textContent !== text) wpm.textContent = text;
      }
    }
    const l = Math.max(0, left - (S.paused ? 0 : (performance.now() - leftAt) / 1000));   // (#383) a paused clock stands still
    const t = $('kcTime'), lb = $('kcLeft');
    if (S.phase !== 'playing') {
      t.style.width = '0%';
      lb.textContent = '';
      return;
    }
    if (k.stage === 'ready' || k.stage === 'countdown') {
      t.classList.remove('low', 'none');
      t.style.width = `${(100 * l) / k.secs}%`;
      lb.textContent = k.stage === 'ready' ? `${k.readyCount}/${k.typistCount} ready · ${Math.ceil(l)}s` : `Starts in ${Math.ceil(l)}`;
      return;
    }
    if (k.unlimited) {
      if (t) { t.style.width = '100%'; t.classList.remove('low'); t.classList.add('none'); }
      if (lb) lb.textContent = l <= 60 ? `Cutoff in ${Math.ceil(l)}s` : k.overtime ? 'Overtime' : 'Play to win';
      return;
    }
    t?.classList.remove('none');
    if (t) { t.style.width = `${(100 * l) / k.secs}%`; t.classList.toggle('low', k.stage === 'play' && l < 10); }
    if (lb) lb.textContent = k.stage === 'play' || S.phase === 'playing' ? `${Math.ceil(l)}s` : '';
  }

  // ---------- the arena

  // (#382) the backdrop: dusk sky, a low moon, two ranges of hills, spotlights and a stage floor with perspective
  let bgCache = null;
  function backdrop(w, h, dpr) {
    const key = `${w}x${h}x${dpr}:${prefs.arena}`;
    if (bgCache?.key === key) return bgCache.cv;
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const g = cv.getContext('2d');
    if (!g) return cv;
    g.scale(dpr, dpr);
    const [skyTop, skyMid, skyBottom, far, near, floorTop, floorBottom] = ARENAS[prefs.arena] ?? ARENAS.dusk;
    const floorY = h * 0.79;
    const sky = g.createLinearGradient(0, 0, 0, floorY);
    sky.addColorStop(0, skyTop); sky.addColorStop(0.55, skyMid); sky.addColorStop(1, skyBottom);
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
    hills(floorY - h * 0.12, h * 0.22, far, 1.3);
    hills(floorY - h * 0.02, h * 0.14, near, 4.1);
    for (const sx of [0.18, 0.82]) {   // two spotlights on the stage
      const beam = g.createLinearGradient(0, 0, 0, floorY);
      beam.addColorStop(0, 'rgba(255,240,200,0)'); beam.addColorStop(1, 'rgba(255,240,200,0.10)');
      g.fillStyle = beam; g.beginPath(); g.moveTo(w * sx - 6, 0); g.lineTo(w * sx + 6, 0); g.lineTo(w * (sx + (sx < 0.5 ? 0.22 : -0.22)) + w * 0.12, floorY); g.lineTo(w * (sx + (sx < 0.5 ? 0.22 : -0.22)) - w * 0.12, floorY); g.closePath(); g.fill();
    }
    const fl = g.createLinearGradient(0, floorY, 0, h);
    fl.addColorStop(0, floorTop); fl.addColorStop(1, floorBottom);
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
    if (motionOff() || prefs.particles === 'off') return;
    const count = prefs.particles === 'low' ? Math.ceil(n / 3) : n;
    for (let i = 0; i < count && parts.length < 260; i++) {
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
        const delay = e.kind === 'hit' || e.kind === 'strike' ? 180 : 0;
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
    if (prefs.focus) return;
    const now = performance.now();
    fx.push({ ...e, at: now });
    if (e.to === S.me.id && (e.kind === 'strike' || e.kind === 'boss') && prefs.shake && !motionOff()) shakeUntil = now + 180;
    if (!prefs.sound || ctx.readOnly) return;
    if (e.to === S.me.id && HURTS.has(e.kind)) {
      ctx.sfx?.(e.kind === 'strike' || e.kind === 'boss' ? 'boom' : 'thud');
    } else if (e.by === S.me.id) {
      ctx.sfx?.({ strike: 'boom', heal: 'good', shield: 'lock', kill: 'crack', cut: 'chip', pull: 'tick' }[e.kind] || 'pop');
    }
  }

  function spots(w, h, list) {
    // two fighters face each other; more stand round in an arc
    const n = list.length, out = new Map();
    list.forEach((f, i) => {
      const x = n === 2 ? (i ? w * 0.69 : w * 0.31) : w * (0.12 + (0.76 * i) / Math.max(1, n - 1));
      const y = h * (n === 2 ? 0.58 : 0.55 + 0.12 * Math.sin((Math.PI * i) / Math.max(1, n - 1)));
      out.set(f.id, { x, y, face: n === 2 ? (i ? -1 : 1) : x < w / 2 ? 1 : -1 });
    });
    return out;
  }

  function draw() {
    const cv = $('kcCanvas');
    if (!cv || !S || !K() || prefs.focus || !$('kcReport').hidden) return;
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
      const a = 0.25 + 0.25 * Math.sin((motionOff() ? 0 : now) / 700 + i * 1.7);
      g.fillStyle = `rgba(255,255,255,${a})`; g.fillRect((i * 173.3 + 40) % w, (i * 61.7 + 12) % (h * 0.42), 2, 2);
    }
    if (now < shakeUntil) { const m = 3 * (shakeUntil - now) / 180; g.translate((Math.random() - 0.5) * m * 2, (Math.random() - 0.5) * m * 2); }
    fx = fx.filter((e) => now - e.at < 875);
    launches = launches.filter((e) => now - e.at < 240);
    if (now >= milestoneUntil && !$('kcMilestone').hidden) $('kcMilestone').hidden = true;
    const scene = { race: drawRace, hyper: drawHyper, tug: drawTug, siege: drawSiege, survival: drawSurvival, boss: drawBoss }[k.mode] || drawBrawl;
    const at = scene(g, w, h, k, now);
    sparks(g, at, k, now);
    popups(g, at, now);
    const player = at?.get(S.me.id);
    if (player) drawLaunches(g, player, now);
    if (!motionOff() && k.stage === 'reveal' && at && k.result) celebrate(at, k);

  }

  function drawLaunches(g, p, now) {
    if (motionOff()) return;
    for (const launch of launches) {
      const t = (now - launch.at) / 240, size = p.s || 20;
      const dir = p.face || 1;
      const x = p.x + dir * size * (0.74 + t * 0.55), y = p.y - size * 0.08;
      g.globalAlpha = (1 - t) * 0.85;
      g.strokeStyle = launch.power || launch.combo >= 3 ? '#ffda77' : '#8bd6ff'; g.lineWidth = 2;
      g.beginPath(); g.ellipse(x, y, size * (0.15 + t * 0.27), size * (0.11 + t * 0.35), 0, 0, Math.PI * 2); g.stroke();
    }
    g.globalAlpha = 1;
  }

  const celebrated = new Set();
  function celebrate(at, k) {
    for (const id of k.result.winners || [k.result.winner]) {
      const p = at.get(id);
      if (!p || celebrated.has(id)) continue;
      celebrated.add(id);
      burst(p.x, p.y - p.s, 32, '#ffda77', 250);
    }
  }

  // damage, heals and shields float up over whoever they happened to
  function popups(g, at, now) {
    if (!at) return;
    const stack = new Map();   // popups over the same fighter close together stack up instead of overlapping
    for (const e of fx) {
      const t = (now - e.at) / 1000, delay = !motionOff() && (e.kind === 'hit' || e.kind === 'strike') ? 0.18 : 0;
      if (t < delay) continue;
      const v = (t - delay) / 0.65;
      let who = HURTS.has(e.kind) || e.kind === 'block' || e.kind === 'soak' ? e.to : e.by;
      if (!who && K().mode === 'boss' && (e.kind === 'hit' || e.kind === 'strike') && e.by === S.me.id) who = 'boss';
      if (e.kind === 'zap' || e.kind === 'kill') who = `foe:${e.by}`;
      const p = who && at.get(who);
      if (!p || !['hit', 'strike', 'army', 'bite', 'boss', 'block', 'soak', 'heal', 'shield', 'zap', 'kill'].includes(e.kind)) continue;
      g.globalAlpha = motionOff() ? 1 : Math.max(0, 1 - v);
      g.font = `800 ${e.kind === 'strike' || e.kind === 'boss' ? 20 : 15}px system-ui, sans-serif`; g.textAlign = 'center';
      g.fillStyle = { block: '#9ad7ff', soak: '#9ad7ff', shield: '#9ad7ff', heal: '#7dffa8', strike: '#ffcf5a' }[e.kind] || '#ff8a8a';
      const soak = e.kind === 'block' || e.kind === 'soak';   // (#380) what the shield took
      const row = stack.get(who) || 0; stack.set(who, row + 1);
      g.fillText(soak ? `🛡️ −${e.dmg} blocked` : e.kind === 'shield' ? `🛡️ +${e.dmg} shield` : e.kind === 'heal' ? `+${e.dmg}` : `-${e.dmg}`,
        p.x, Math.max(15, p.y - p.s * 0.86 - (motionOff() ? 0 : v * 14) - row * 16));
      g.globalAlpha = 1;
    }
  }

  function fighterAt(g, f, p, s, now, face = p.face) {
    const still = motionOff();
    const hurt = fx.findLast((e) => e.to === f.id && HURTS.has(e.kind) && now - e.at < 260);
    const attack = fx.findLast((e) => e.by === f.id && (e.kind === 'hit' || e.kind === 'strike') && now - e.at < 200);
    const launch = f.id === S.me.id ? launches.at(-1) : null;
    const progress = attack || launch ? (now - Math.max(attack?.at ?? -Infinity, launch?.at ?? -Infinity)) / 240 : 1;
    const lunge = still || progress >= 1 ? 0 : face * s * (progress < 0.18 ? -0.07 * progress / 0.18 : 0.18 * Math.sin(Math.PI * (progress - 0.18) / 0.82));
    const bob = still || f.ko ? 0 : Math.sin(now / 360 + p.x) * 2;
    const recoil = still || !hurt ? 0 : -face * s * 0.12 * (1 - (now - hurt.at) / 260);
    const combo = f.id === S.me.id ? projection().combo : f.combo;
    const collapse = f.ko && hurt && !still ? Math.min(1, (now - hurt.at) / 190) : 1;
    drawFighter(g, p.x + lunge + recoil, p.y + bob, s, hue(f.id), face, f.ko, !!hurt && !still, f.shield, f.id === S.me.id, still ? 0 : now, combo, !still && progress < 0.7, collapse);
  }

  // a glowing bolt from a to b, u of the way there
  function bolt(g, a, b, u, color, big, arc) {
    const at = (v) => [a.x + (b.x - a.x) * v, a.y + (b.y - a.y) * v - Math.sin(Math.PI * v) * arc];
    if (motionOff()) return;
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
    const list = fighters(), at = spots(w, h, list), size = Math.min(106, h * 0.39, w / (list.length * 2.65));
    for (const f of k.fighters) { const p = at.get(f.id); p.s = size; fighterAt(g, f, p, size, now); }
    for (const e of fx) {
      const a = at.get(e.by), b = e.to && at.get(e.to), u = (now - e.at) / 180;
      if (a && b && u < 1 && (e.kind === 'hit' || e.kind === 'strike' || e.kind === 'block'))
        bolt(g, { x: a.x, y: a.y - size * 0.5 }, b, u, `hsl(${hue(e.by)} 90% 65%)`, e.kind === 'strike', size * 0.6);
    }
    return at;
  }

  // 🏰 Castle Siege: a castle each, soldiers marching between them
  function drawSiege(g, w, h, k, now) {
    const at = spots(w, h, fighters()), size = Math.min(63, h * 0.20, w / (k.fighters.length * 3));
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
      const u = Math.min(1, a.prog + (S.paused || motionOff() ? 0 : (now - leftAt) / 1000 / 5)), y0 = h * 0.82, n = Math.min(6, Math.ceil(a.power / 3));
      for (let i = 0; i < n; i++) {   // a little squad, in step
        const x = from.x + (to.x - from.x) * u - Math.sign(to.x - from.x) * i * 7, y = y0 + (i % 2) * 6 + (motionOff() ? 0 : Math.abs(Math.sin(now / 90 + i)) * -3);
        g.fillStyle = `hsl(${hue(a.by)} 80% ${a.big ? 70 : 58}%)`; g.beginPath(); g.arc(x, y - 6, a.big ? 5 : 3.5, 0, Math.PI * 2); g.fill();
        g.fillRect(x - 2, y - 3, 4, 7);
      }
    }
    for (const e of fx) if (!motionOff() && e.kind === 'cut' && now - e.at < 400) {
      const p = at.get(e.by);
      if (p) { g.strokeStyle = '#ffffffaa'; g.lineWidth = 2; g.beginPath(); g.arc(p.x, h * 0.8, 10 + (now - e.at) / 20, 0, Math.PI * 2); g.stroke(); }
    }
    return at;
  }

  // 🧟 Survival: a lane each; the same enemies shuffle in from the left toward each typist on the right
  function drawSurvival(g, w, h, k, now) {
    const n = k.fighters.length, lane = h / (n + 0.5), at = new Map(), s = Math.min(50, lane * 0.65);
    g.fillStyle = '#ffffffcc'; g.font = '700 12px system-ui, sans-serif'; g.textAlign = 'left'; g.fillText(`Wave ${k.wave || 1}`, 10, 16);
    k.fighters.forEach((f, i) => {
      const y = lane * (i + 0.75), p = { x: w - 40, y, face: -1, s };
      g.strokeStyle = '#ffffff18'; g.beginPath(); g.moveTo(10, y + s * 0.55); g.lineTo(w - 10, y + s * 0.55); g.stroke();
      fighterAt(g, f, p, s, now, -1);
      at.set(f.id, p);
      for (const [prog, hp, max] of f.foes || []) {
        const x = 20 + (w - 100) * prog, wob = motionOff() ? 0 : Math.sin(now / 160 + prog * 40) * 2;
        g.fillStyle = '#6fbf5a'; g.beginPath(); g.ellipse(x, y + wob, s * 0.32, s * 0.4, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#e8ff8a'; g.beginPath(); g.arc(x + 4, y - s * 0.1 + wob, 2.5, 0, Math.PI * 2); g.arc(x + 10, y - s * 0.1 + wob, 2.5, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#00000088'; g.fillRect(x - 10, y - s * 0.6, 20, 3); g.fillStyle = '#ff6b6b'; g.fillRect(x - 10, y - s * 0.6, 20 * (hp / max), 3);
      }
      const front = (f.foes || [])[0], tx = front ? 20 + (w - 100) * front[0] : 40;
      const aim = { x: tx, y, s };
      at.set(`foe:${f.id}`, aim);
      for (const e of fx) if (e.by === f.id && (e.kind === 'zap' || e.kind === 'kill') && now - e.at < 250) {
        bolt(g, p, aim, (now - e.at) / 250, `hsl(${hue(f.id)} 90% 65%)`, false, 8);
      }
    });
    return at;
  }

  // 👹 Boss Rush: one boss up top (everyone fights their own copy: it shows yours), the typists in a row below
  function drawBoss(g, w, h, k, now) {
    const at = spots(w, h, fighters()), s = Math.min(60, h * 0.20, w / (k.fighters.length * 2.8));
    fighters().forEach((f, i) => { const p = at.get(f.id); p.y = h * 0.76; p.x = w * ((i + 1) / (k.fighters.length + 1)); p.s = s; p.face = 1; fighterAt(g, f, p, s, now, 1); });
    const me = k.fighters.find((f) => f.id === S.me.id) || k.fighters[0];
    const bx = w / 2, by = h * 0.3, bs = Math.min(70, h * 0.24), slam = fx.find((e) => e.kind === 'boss' && now - e.at < 400);
    const hit = fx.find((e) => e.by === me?.id && (e.kind === 'hit' || e.kind === 'strike') && now - e.at < 200);
    at.set('boss', { x: bx, y: by, s: bs });
    g.save(); g.translate(bx + (hit && !motionOff() ? Math.sin(now / 15) * 4 : 0), by + (motionOff() ? 0 : slam ? -10 : Math.sin(now / 500) * 4));
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
      const a = at.get(e.by), u = (now - e.at) / 180;
      if (a && u < 1 && (e.kind === 'hit' || e.kind === 'strike')) bolt(g, a, { x: bx, y: by }, u, `hsl(${hue(e.by)} 90% 65%)`, e.kind === 'strike', 20);
    }
    if (slam && !motionOff()) { g.strokeStyle = `rgba(255,80,80,${1 - (now - slam.at) / 400})`; g.lineWidth = 4; g.beginPath(); g.arc(bx, by, bs + (now - slam.at) / 2, 0, Math.PI * 2); g.stroke(); }
    return at;
  }

  // 🚀 Hyperdrive: ships streak along their lanes to the finish line on the right
  function drawHyper(g, w, h, k, now) {
    const n = k.fighters.length, lane = h / (n + 1), at = new Map(), fin = w - 30;
    g.strokeStyle = '#ffffff16';
    for (let i = 0; i < 30; i++) { const y = (i * 53.7) % h, x = (w - (((motionOff() ? 0 : now) / 3 + i * 131) % (w + 60))); g.beginPath(); g.moveTo(x, y); g.lineTo(x + 30, y); g.stroke(); }
    g.fillStyle = '#ffffff55'; for (let y = 0; y < h; y += 12) g.fillRect(fin, y, 4, 6);
    k.fighters.forEach((f, i) => {
      const y = lane * (i + 1), x = 20 + (fin - 50) * (f.dist / k.track), c = `hsl(${hue(f.id)} 85% 62%)`, boost = Math.min(10, f.combo);
      g.fillStyle = `hsl(${hue(f.id)} 90% 60% / .5)`; g.beginPath(); g.moveTo(x - 14, y - 5); g.lineTo(x - 22 - boost * 3 - (motionOff() ? 0 : Math.random() * 6), y); g.lineTo(x - 14, y + 5); g.fill();   // the flame
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
        const x = knot + dir * (s * 1.6 + i * s * 1.2) + shift, lean = !motionOff() && fx.find((e) => e.by === f.id && now - e.at < 200) ? (team ? 6 : -6) : 0;
        const p = { x: x + lean, y: y - s * 0.1, face: team ? -1 : 1, s };
        fighterAt(g, f, p, s, now);
        at.set(f.id, p);
      });
    }
    g.font = '800 14px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillStyle = '#ff8a8a'; g.fillText(k.teams[0], w * 0.15, 20); g.fillStyle = '#8ac4ff'; g.fillText(k.teams[1], w * 0.85, 20);
    return at;
  }

  function drawFighter(g, x, y, s, h, face, ko, hurt, shield, me, now, combo = 0, attacking = false, collapse = 1) {
    // A combo milestone lights an aura that grows with the streak.
    if (combo >= 3 && !ko) {
      const r = s * (0.9 + 0.04 * Math.min(20, combo)) * (1 + 0.025 * Math.sin(now / 160));
      const aura = g.createRadialGradient(x, y, s * 0.3, x, y, r);
      aura.addColorStop(0, `hsla(${combo >= 10 ? 35 : h}, 100%, 60%, 0.35)`); aura.addColorStop(1, `hsla(${combo >= 10 ? 35 : h}, 100%, 60%, 0)`);
      g.fillStyle = aura; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.save();
    g.translate(x, y);
    if (ko) g.rotate(face * 1.25 * collapse);
    // shadow on the floor
    const sh = g.createRadialGradient(0, s * 0.56, 1, 0, s * 0.56, s * 0.65);
    sh.addColorStop(0, '#000000bb'); sh.addColorStop(1, '#00000000');
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
      drawFighter(g, x, y + (motionOff() ? 0 : Math.sin(now / 120 + i) * (f.wpm ? 2 : 0)), Math.min(44, lane * 0.66), hue(f.id), 1, false, false, false, f.id === S.me.id, motionOff() ? 0 : now);
    });
    return null;
  }

  const PRACTICE_WORDS = {
    'Familiar short words': 'home lake tree rain book road bird game fish bike snow wind bread water stone light',
    'Everyday words': 'apple winter pocket table garden jacket window rabbit morning pencil market planet button coffee',
    'Long words': 'adventure butterfly electricity grandfather instrument neighborhood opportunity punctuation watermelon',
  };
  const LESSONS = [
    { id: 'home-row', title: 'Home row', keys: 'asdf jkl;', words: ['ask', 'sad', 'all', 'fall', 'lass', 'salad', 'flask', 'adds', 'glass', 'shall'] },
    { id: 'top-row', title: 'Top row', keys: 'qwerty uiop', words: ['type', 'write', 'quiet', 'power', 'query', 'tower', 'poetry', 'pretty', 'upper', 'quote'] },
    { id: 'bottom-row', title: 'Bottom row', keys: 'zxcvbnm', words: ['zoom', 'cabin', 'combine', 'maximum', 'ban', 'can', 'man', 'van', 'mix', 'box'] },
    { id: 'reach', title: 'Reach keys', keys: 'qwertyuiop zxcvbnm', words: ['quick', 'jazz', 'quiz', 'zero', 'sphinx', 'fuzzy', 'jumpy', 'zippy', 'fizz', 'buzz'] },
    { id: 'accuracy', title: 'Accuracy', keys: 'all letters', words: ['accurate', 'practice', 'keyboard', 'remember', 'carefully', 'mistakes', 'rhythm', 'success', 'focus', 'steady'] },
  ];

  function openPractice(missed = []) {
    const el = (tag, cls = '', text = '') => {
      const node = document.createElement(tag);
      if (cls) node.className = cls;
      if (text) node.textContent = text;
      return node;
    };
    const saved = Profile.gameData('keyclash').lessons || {};
    const progress = { completed: {}, keys: {}, ...saved, completed: { ...(saved.completed || {}) }, keys: { ...(saved.keys || {}) } };
    const box = el('div', 'kc kc-practice');
    const lessonPicker = el('div', 'kc-lesson-list');
    const lessonTitle = el('h3');
    const lessonHelp = el('p', '', 'Complete every word with 90% accuracy to finish this lesson.');
    const preset = document.createElement('select');
    const lists = Object.fromEntries(Object.entries(PRACTICE_WORDS).map(([name, words]) => [name, words.split(' ')]));
    if (missed.length) lists['Missed in this match'] = [...missed];
    for (const name of Object.keys(lists)) preset.add(new Option(name, name));
    if (missed.length) preset.value = 'Missed in this match';
    const label = el('label', '', 'Word list ');
    label.append(preset);
    const wordDisplay = el('div', 'kc-practice-word');
    const correction = el('div', 'kc-correction');
    const stats = el('div', 'kc-practice-stats');
    const input = document.createElement('input');
    Object.assign(input, { type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: false, enterKeyHint: 'done' });
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('aria-label', 'Practice word');
    input.addEventListener('paste', (event) => event.preventDefault());
    input.addEventListener('drop', (event) => event.preventDefault());
    const row = el('div', 'kc-practice-actions');
    const check = el('button', 'ghost-btn', 'Check word');
    const skip = el('button', 'ghost-btn', 'Skip word');
    const restart = el('button', 'ghost-btn', 'Restart drill');
    const powers = el('div', 'kc-practice-actions');
    const powerWords = { shield: 'guard', strike: 'comet', heal: 'mend' };
    const powerButtons = POWER_KEYS.map((kind) => {
      const button = el('button', 'ghost-btn', POWER_NAMES[kind]);
      button.onclick = () => choosePower(kind);
      powers.append(button);
      return button;
    });
    let words, index, chars, errors, skips, streak, power, draft, last, started, feedback, currentLesson;
    let drillErrors;
    const expected = () => power ? powerWords[power] : words[index];
    const typing = () => input.value.toLowerCase();
    const focusInput = () => input.focus({ preventScroll: true });

    function render() {
      const word = expected();
      const value = typing();
      input.disabled = check.disabled = !word;
      skip.disabled = !word || !!power;
      if (word) paintLetters(wordDisplay, word, value);
      else wordDisplay.textContent = 'Drill complete';
      const mistake = [...value].findIndex((ch, i) => ch !== word?.[i]);
      correction.textContent = mistake < 0 ? feedback :
        mistake < word.length ? `Expected ${word[mistake]}. Use Backspace to correct.` : 'Remove the extra letters.';
      const seconds = started ? (performance.now() - started) / 1000 : 0;
      const speed = seconds ? Math.round(chars * 12 / Math.max(1, seconds)) : 0;
      const accuracy = chars + errors ? Math.round(100 * chars / (chars + errors)) : 100;
      stats.textContent = `${index}/${words.length} words · ${speed} WPM · ${accuracy}% accuracy · ${skips} skipped`;
      powerButtons.forEach((button, i) => {
        const active = power === POWER_KEYS[i];
        button.disabled = !word || streak < 3;
        button.setAttribute('aria-pressed', String(active));
        button.textContent = active ? `Cancel ${POWER_NAMES[power]}` : POWER_NAMES[POWER_KEYS[i]];
      });
    }

    function reset(focus = true) {
      words = currentLesson ? [...currentLesson.words] : lists[preset.value];
      index = chars = errors = skips = streak = started = drillErrors = 0;
      power = null;
      input.value = last = draft = feedback = '';
      render();
      if (focus) focusInput();
    }

    function choosePower(kind) {
      feedback = '';
      if (kind === power) {
        power = null;
        input.value = last = draft;
      } else {
        if (!power) draft = input.value;
        power = kind;
        input.value = last = '';
      }
      render();
      focusInput();
    }

    function finishWord(skipped = false) {
      if (!expected()) return;
      if (!skipped && typing() !== expected()) { focusInput(); return; }
      const completedWord = expected();
      if (skipped) { skips++; streak = 0; }
      else {
        chars += completedWord.length;
        streak = drillErrors ? 0 : streak + 1;
      }
      drillErrors = 0;
      if (power) {
        feedback = `${POWER_NAMES[power]} practiced`;
        streak = 0;
        power = null;
        input.value = last = draft;
      } else {
        feedback = skipped ? 'Word skipped' : '';
        index++;
        input.value = last = '';
        if (currentLesson && index === words.length) {
          const accuracy = chars + errors ? chars / (chars + errors) : 1;
          if (!skips && accuracy >= 0.9) {
            const prior = progress.completed[currentLesson.id];
            progress.completed[currentLesson.id] = {
              at: prior?.at || new Date().toISOString(),
              bestAccuracy: Math.max(prior?.bestAccuracy || 0, Math.round(accuracy * 100)),
              attempts: (prior?.attempts || 0) + 1,
            };
            lessonHelp.textContent = `${currentLesson.title} complete · ${Math.round(accuracy * 100)}% accuracy · best ${progress.completed[currentLesson.id].bestAccuracy}%`;
          } else lessonHelp.textContent = `Reach 90% accuracy with no skipped words to complete this lesson · ${Math.round(accuracy * 100)}%`;
          Profile.saveLessonProgress(progress);
      paintLessons();
        }
      }
      render();
      if (input.disabled) restart.focus(); else focusInput();
    }

    input.addEventListener('input', () => {
      input.value = typing().replace(/[^a-z ]/g, '');
      if (input.value.endsWith(' ')) {
        input.value = input.value.trim();
        finishWord();
      }
      const value = typing();
      if (!started && value) started = performance.now();
      const word = expected() ?? '';
      for (let i = 0; i < value.length; i++) {
        if (value[i] !== last[i] && value[i] !== word[i]) {
          errors++;
          drillErrors++;
          if (currentLesson && /^[a-z]$/.test(value[i]) && value[i] !== last[i]) {
            const key = value[i];
            progress.keys[key] = (progress.keys[key] || 0) + 1;
            Profile.saveLessonProgress(progress);
          }
        }
      }
      last = value;
      render();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        finishWord();
      } else if (event.key === 'Escape' && power) {
        event.stopPropagation();
        choosePower(power);
      }
    });
    preset.onchange = () => reset();
    function paintLessons() {
      lessonPicker.replaceChildren(...LESSONS.map((lesson) => {
        const complete = progress.completed[lesson.id];
        const button = el('button', 'ghost-btn', `${complete ? '✓ ' : ''}${lesson.title}${complete ? ` · ${complete.bestAccuracy ?? complete.accuracy}%` : ''}`);
        button.setAttribute('aria-pressed', String(currentLesson?.id === lesson.id));
        button.onclick = () => {
          currentLesson = lesson;
          lessonTitle.textContent = lesson.title;
          lessonHelp.textContent = `${lesson.keys} · ${complete ? `Completed at ${complete.accuracy}%` : 'Not completed yet'}`;
          reset();
          paintLessons();
        };
        return button;
      }));
      const problemKeys = Object.entries(progress.keys).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]);
      keySummary.textContent = problemKeys.length
        ? `Keys to practice: ${problemKeys.slice(0, 8).map(([key, count]) => `${key.toUpperCase()} (${count})`).join(' · ')}`
        : 'Problem keys will appear here as you practice.';
      lessonPicker.setAttribute('aria-label', `${Object.keys(progress.completed).length} of ${LESSONS.length} lessons completed`);
    }
    const keySummary = el('p', 'kc-key-summary');
    check.onclick = () => finishWord();
    skip.onclick = () => finishWord(true);
    restart.onclick = () => reset();
    row.append(check, skip, restart);
    box.append(lessonPicker, lessonTitle, lessonHelp, keySummary, label, wordDisplay, input, correction, stats, row, powers);
    paintLessons();
    reset(false);
    const dialog = ask('Type each word and press Space or Enter. Three perfect words unlock power practice.', {
      title: 'Key Clash practice', ok: 'Close practice', cancel: '', body: box,
    });
    focusInput();
    return dialog;
  }

  function turnText(s) {
    const k = s.keyclash;
    if (!k || s.phase !== 'playing') return null;
    if (k.stage === 'reveal') return 'Round over';
    if (k.stage === 'ready' || k.stage === 'countdown') return '';
    return s.paused ? 'Paused' : k.playing ? '' : 'Watching';
  }

  function myMove(s) { return !!s.keyclash?.playing; }

  // the round's clock is on the screen itself; the room's deadline is only the next bot's word
  const ownTimer = () => true;

  return { mount, render, unmount, turnText, myMove, ownTimer, ownSounds: true, compactLog: true, openPractice };
})();
