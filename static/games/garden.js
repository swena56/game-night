// Word Garden: the little crossword (the garden) on top, the ring of letters under it. Drag across the
// ring's letters and let go to plant a word, or tap them one by one and press 🌱 (or type and press Enter).
// Garden words fill in; other real words are bonus words. No clock by default, and a word that isn't
// in the dictionary only gets a gentle note.
UI.garden = (() => {
  let S, ctx, v, clk = null, busy = false;
  let sel = [], drag = null, order = null, seenKey = '', seenSeq = -1, seenFound = null, note = '', noteKind = '';
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    sel = []; drag = null; order = null; seenKey = ''; seenSeq = -1; seenFound = null; note = ''; noteKind = ''; busy = false;
    main.innerHTML = `<div class="gd" id="gdRoot">
      <div class="pt-head"><span id="gdRound"></span><span id="gdInfo" class="pt-info"></span><b id="gdClock" class="pt-clock"></b></div>
      <div class="dd-bar" id="gdBarBox"><span id="gdBar"></span></div>
      <div class="gd-plot"><div class="gd-grid" id="gdGrid" aria-label="The garden"></div></div>
      <div class="gd-word" id="gdWord" aria-live="polite"></div>
      <div class="gd-ring" id="gdRing">
        <svg class="gd-ink" id="gdInk" viewBox="0 0 100 100" aria-hidden="true"><polyline id="gdLine" points=""/></svg>
        <button type="button" class="gd-mid" id="gdShuffle" title="Shuffle the letters">🔀</button>
      </div>
      <div class="pt-tools">
        <button type="button" id="gdClear" title="Clear the letters">⌫<small>Clear</small></button>
        <button type="button" id="gdPlant" title="Plant the word (Enter)">🌱<small>Plant</small></button>
        <button type="button" id="gdHint" title="Spend a drop to show a letter (costs a point)">💧<small id="gdDrops">Hint</small></button>
        <button type="button" id="gdBank" title="Stop here and keep your points">🏳️<small>Rest</small></button>
      </div>
      <div class="pt-note" id="gdNote"></div>
      <div class="gd-bonus" id="gdBonus"></div></div>`;
    side.innerHTML = '<div class="panel"><h3>Gardeners</h3><div id="gdRacers"></div><p class="hint left" id="gdHelp"></p></div>';
    const ring = $('gdRing');
    ring.addEventListener('pointerdown', down);
    ring.addEventListener('pointermove', move);
    ring.addEventListener('pointerup', up);
    ring.addEventListener('pointercancel', () => { drag = null; });
    $('gdShuffle').onclick = (e) => { e.stopPropagation(); shuffle(); };
    $('gdClear').onclick = () => { sel = []; drawSel(); };
    $('gdPlant').onclick = () => plant();
    $('gdHint').onclick = async () => {
      if (!canHint()) return;
      const cost = v.hintCost ?? 1;
      if (await ctx.ask(`Use a 💧 to show one letter? It costs exactly ${cost} point${cost === 1 ? '' : 's'} (you have ${v.drops} 💧). A word it completes for you scores nothing; bonus words are never touched.`,
        { ok: `💧 Water · −${cost}` })) send('hint', {});
    };
    $('gdBank').onclick = async () => {
      if (!live()) return;
      if (await ctx.ask('Rest for this garden? You keep your words, and the garden ends once the others are done.', { ok: '🏳️ Rest' })) send('bank', {});
    };
    window.addEventListener('keydown', key);
    clk = Kit.clock($('gdBar'), $('gdClock'), { warn: 0, every: 500 });
  }

  function unmount() { clk?.stop(); window.removeEventListener('keydown', key); }

  const playing = () => S?.phase === 'playing' && v?.stage === 'play' && v.playing && !v.banked && !!ctx?.act;
  const live = () => playing() && !v.done;             // still growing this garden
  const canWord = () => playing();                      // finishers can still find bonus words
  const canHint = () => live() && v.drops > 0;

  function send(type, extra) {
    if (busy) return Promise.resolve(false);
    busy = true;
    return ctx.act(type, extra).then(() => true)
      .catch((err) => {
        say(err?.message || 'Not right now.', 'soft');
        ctx.sfx('tick');
        const w = $('gdWord'); w.classList.remove('nope'); void w.offsetWidth; w.classList.add('nope');
        return false;
      })
      .finally(() => { busy = false; });
  }

  function say(text, kind) { note = text; noteKind = kind; paintNote(); }

  // -- the ring

  function letters() {
    const ring = v.ring.split('');
    if (!order || order.length !== ring.length) order = ring.map((_, i) => i);
    return order.map((i) => ({ i, ch: ring[i] }));
  }

  function shuffle() {
    if (!v) return;
    letters();
    for (let k = order.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; }
    ctx.sfx('pop');
    buildRing();
  }

  function buildRing() {
    const ring = $('gdRing');
    for (const b of ring.querySelectorAll('.gd-l')) b.remove();
    const ls = letters(), n = ls.length;
    ls.forEach(({ i, ch }, k) => {
      const a = -Math.PI / 2 + (k / n) * Math.PI * 2;
      const b = ctx.el('button', 'gd-l', ch);
      b.type = 'button';
      b.dataset.i = i;
      b.style.left = `${50 + 36 * Math.cos(a)}%`;
      b.style.top = `${50 + 36 * Math.sin(a)}%`;
      ring.append(b);
    });
    drawSel();
  }

  const letterAt = (e) => {
    const el = document.elementFromPoint?.(e.clientX, e.clientY) || e.target;
    const b = el?.closest?.('.gd-l');
    return b && $('gdRing').contains(b) ? +b.dataset.i : null;
  };

  function down(e) {
    if (!canWord() || e.button > 0) return;
    const i = e.target.closest?.('.gd-l') ? +e.target.closest('.gd-l').dataset.i : null;
    if (i == null) return;
    e.preventDefault();
    if (sel.length && sel[sel.length - 1] === i) sel.pop();      // tap the last letter again to take it back
    else if (!sel.includes(i)) { sel.push(i); ctx.sfx('tick'); }
    drag = { id: e.pointerId, start: sel.length, moved: false };
    try { $('gdRing').setPointerCapture(e.pointerId); } catch {}
    drawSel();
  }

  function move(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const i = letterAt(e);
    if (i == null) return;
    if (sel.length > 1 && sel[sel.length - 2] === i) { sel.pop(); drag.moved = true; drawSel(); return; }   // slide back
    if (!sel.includes(i)) { sel.push(i); drag.moved = true; ctx.sfx('tick'); drawSel(); }
  }

  function up(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dragged = drag.moved;
    drag = null;
    if (dragged && sel.length >= 3) plant();
    else if (dragged) { sel = []; drawSel(); }
  }

  function key(e) {
    if (!v || !canWord() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]') || $('modal')?.hidden === false) return;
    const k = e.key;
    if (k === 'Enter') { if (sel.length) { e.preventDefault(); plant(); } return; }
    if (k === 'Backspace') { if (sel.length) { e.preventDefault(); sel.pop(); drawSel(); } return; }
    if (k === 'Escape') { sel = []; drawSel(); return; }
    if (k === ' ') { e.preventDefault(); shuffle(); return; }
    if (!/^[a-zA-Z]$/.test(k)) return;
    const ch = k.toUpperCase();
    const free = letters().find((x) => x.ch === ch && !sel.includes(x.i));
    if (!free) return;
    e.preventDefault();
    sel.push(free.i); ctx.sfx('tick'); drawSel();
  }

  function plant() {
    if (!canWord()) return;
    const w = sel.map((i) => v.ring[i]).join('');
    if (w.length < 3) { say('Words need at least 3 letters.', 'soft'); return; }
    sel = []; drawSel();
    $('gdWord').textContent = w;
    send('word', { word: w });
  }

  function drawSel() {
    const ring = $('gdRing');
    if (!ring || !v) return;
    const pts = [];
    for (const b of ring.querySelectorAll('.gd-l')) b.classList.toggle('on', sel.includes(+b.dataset.i));
    for (const i of sel) {
      const b = ring.querySelector(`.gd-l[data-i="${i}"]`);
      if (b) pts.push(`${parseFloat(b.style.left)},${parseFloat(b.style.top)}`);
    }
    $('gdLine').setAttribute('points', pts.join(' '));
    const w = sel.map((i) => v.ring[i]).join('');
    $('gdWord').textContent = w;
    $('gdPlant').disabled = !canWord() || w.length < 3;
    $('gdClear').disabled = !w;
  }

  // -- the garden

  function buildGrid() {
    const grid = $('gdGrid');
    grid.innerHTML = '';
    grid.style.setProperty('--gw', v.w);
    grid.style.setProperty('--gh', v.h);
    for (let r = 0; r < v.h; r++) {
      for (let c = 0; c < v.w; c++) {
        const has = v.grid[r][c] != null;
        grid.append(ctx.el('span', has ? 'gd-c' : 'gd-c gd-x'));
      }
    }
  }

  function paintGrid(freshWords) {
    const grid = $('gdGrid'), cells = grid.children;
    const fresh = new Set(), mine = new Set(), shown = new Set(v.shown.map(([r, c]) => `${r},${c}`));
    for (const [len, r, c, across, word, got] of v.slots) {
      for (let k = 0; k < len; k++) {
        const at = across ? [r, c + k] : [r + k, c];
        if (got) mine.add(`${at[0]},${at[1]}`);
        if (word && freshWords.includes(word)) fresh.add(`${at[0]},${at[1]}`);
      }
    }
    for (let r = 0; r < v.h; r++) {
      for (let c = 0; c < v.w; c++) {
        const ch = v.grid[r][c];
        if (ch == null) continue;
        const el = cells[r * v.w + c], id = `${r},${c}`;
        el.textContent = ch || '';
        el.classList.toggle('got', !!ch && mine.has(id));
        el.classList.toggle('drop', shown.has(id) && !mine.has(id));
        el.classList.toggle('missed', !!ch && !mine.has(id) && !shown.has(id));
        if (fresh.has(id)) { el.classList.remove('bloom'); void el.offsetWidth; el.classList.add('bloom'); }
      }
    }
  }

  // -- state

  function render(s, c) {
    S = s; ctx = c; v = S.garden;
    if (!v) return;
    const key = `${v.round}:${v.ring}:${v.h}x${v.w}`;
    const newGarden = key !== seenKey;
    if (newGarden) {
      seenKey = key; sel = []; order = null; seenFound = null; seenSeq = v.seq; note = ''; noteKind = '';
      buildGrid(); buildRing();
    }
    const found = v.slots.filter((x) => x[5]).map((x) => x[4]);
    const fresh = seenFound ? found.filter((w) => !seenFound.includes(w)) : [];
    seenFound = found;
    paintGrid(fresh);

    // what my last word did
    let nope = '';
    if (v.last && v.seq !== seenSeq && v.last.n === v.seq) {
      seenSeq = v.seq;
      const L = v.last;
      if (L.kind === 'garden') { say(`🌻 ${L.w} grows in the garden${L.pts ? ` · +${L.pts}` : ''}`, 'good'); ctx.sfx(L.w.length >= v.ring.length ? 'fanfare' : 'good'); }
      else if (L.kind === 'bonus') { say(`🌱 ${L.w}: a bonus word · +${L.pts}${L.drop ? ' · and a new 💧!' : ''}`, 'bonus'); ctx.sfx(L.drop ? 'chime' : 'pop'); }
      else if (L.kind === 'again') say(`${L.w} is already planted.`, 'soft');
      else if (L.kind === 'nope') { say(`${L.w} isn't in our dictionary. No harm done!`, 'soft'); nope = L.w; }
      else if (L.kind === 'hint') { say(`${L.done ? '💧 A letter shows… and a word filled in' : '💧 A letter shows'} · −${L.cost ?? 1}`, 'bonus'); ctx.sfx('pop'); }
      if (v.done && L.kind === 'garden' && fresh.length) Kit.callout('🌸 In full bloom!', 'gold', { ms: 1600 });
    }
    drawSel();
    if (nope) {   // the word that didn't grow wobbles where it was spelled
      const el = $('gdWord'); el.textContent = nope; el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope');
    }

    $('gdRound').textContent = `🌻 Garden ${v.round}/${v.rounds}`;
    // 💧 the hint ladder: what's left, what the next one costs, and what hints have cost so far
    $('gdInfo').textContent = `${v.found}/${v.total} words · 🌱 ${v.bonus.length} bonus` + (v.charged ? ` · 💧 −${v.charged}` : '');
    $('gdDrops').textContent = `${v.drops} · −${v.hintCost ?? 1}`;
    $('gdHint').disabled = !canHint();
    $('gdHint').hidden = !S.hintsOk;
    $('gdBank').disabled = !live();
    $('gdBarBox').hidden = !v.clock || v.stage !== 'play';
    $('gdRoot').classList.toggle('over', v.stage !== 'play');

    const bonus = $('gdBonus'); bonus.innerHTML = '';
    if (v.bonus.length) {
      bonus.append(ctx.el('span', 'gd-bl', `Bonus words · ${v.dropEvery - (v.bonus.length % v.dropEvery)} more for a 💧`));
      for (const w of [...v.bonus].reverse()) bonus.append(ctx.el('span', 'gd-bw', w));
    }
    if (newGarden && v.stage === 'play' && v.round === 1 && !v.bonus.length && v.found === 0) say('Drag across the letters, or tap them, to spell a word.', '');
    paintNote();
    racers();
    clk.set({ left: v.left, secs: v.secs, on: S.phase === 'playing' && v.stage === 'play' && v.clock });
  }

  function paintNote() {
    const el = $('gdNote');
    if (!el || !v) return;
    let text = note, kind = noteKind;
    if (v.stage === 'reveal') {
      const g = v.gained?.[S.me.id];
      text = `${v.playing && g != null ? `+${g} this garden · ` : ''}the ring word was ${v.base}. ${v.bonusAll} words hid in these letters.`;
      kind = '';
    } else if (v.banked) { text = '🏳️ Resting. The garden ends once everyone is done.'; kind = ''; }
    else if (!v.playing) { text = 'Watching the gardeners.'; kind = ''; }
    else if (v.done && !text.startsWith('🌱')) { text = '🌸 Your garden is in bloom! Find bonus words while the others finish.'; kind = 'good'; }
    el.textContent = text;
    el.className = `pt-note gd-note ${kind}`;
  }

  function racers() {
    const box = $('gdRacers'); box.innerHTML = '';
    for (const r of [...v.rivals].sort((a, b) => b.score - a.score || b.prog[0] - a.prog[0])) {
      const p = ctx.player(r.id);
      if (!p) continue;
      const row = ctx.el('div', 'seat-row pt-racer');
      const dot = ctx.el('span', 'dot'); dot.style.background = p.color;
      const flag = r.done != null ? ' · 🌸' : r.banked ? ' · 🏳️' : '';
      const extra = v.bonusBy?.[r.id] ? ` · 🌱${v.bonusBy[r.id]}` : '';
      row.append(dot, ctx.el('span', 'grow', `${r.id === S.me.id ? 'You' : p.name}: ${r.score} pts${flag}${extra}`));
      const bar = ctx.el('span', 'pt-prog');
      const fill = ctx.el('i'); fill.style.width = `${(r.prog[0] / Math.max(1, r.prog[1])) * 100}%`; fill.style.background = p.color;
      bar.append(fill, ctx.el('b', '', `${r.prog[0]}/${r.prog[1]}`));
      row.append(bar);
      box.append(row);
    }
    $('gdHelp').textContent = `Garden words: a point a letter. Bonus words: 1 (2 for 6+ letters), and every ${v.dropEvery} earn a 💧. A 💧 shows one letter for −${v.hintCost ?? 1}. Growing the whole garden: +10. ${v.clock ? '' : 'No clock: take your time.'}`;
  }


  const turnText = (s) => {
    const x = s.garden;
    if (s.phase !== 'playing' || !x) return null;
    return x.stage === 'reveal' ? '🌻 Garden grown' : !x.playing ? '🌻 Watching' : x.done ? '🌸 In bloom: bonus words' : x.banked ? '🏳️ Resting' : '🌻 Grow your garden';
  };
  const myMove = (s) => s.phase === 'playing' && s.garden?.stage === 'play' && s.garden.playing && !s.garden.done && !s.garden.banked;

  return { mount, render, unmount, turnText, myMove, ownTimer: () => true };
})();
