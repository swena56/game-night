UI.wordsmith = (() => {
  let S, ctx, board;
  let pending = [];      // [{r, c, i, as}] tiles placed this turn (i = rack index; as = the letter a blank stands for)
  let selected = null;   // rack index picked up
  let order = [];        // display order of rack indices (for Shuffle)
  let rackKey = '', seenLast = null, prevScores = null, seenBounty = null;
  let swapMode = false;
  const swapSel = new Set();
  let previewKey = '', previewTimer = 0;
  let drag = null, skipClick = false;  // a tile being dragged from the rack (or moved on the board)
  const PREMIUM_LABEL = { '2L': 'DL', '3L': 'TL', '2W': 'DW', '3W': 'TW', '★': '★' };
  const $ = (id) => document.getElementById(id);
  const BLANK = '?';
  const unnamed = () => pending.find((t) => S.ws.rack[t.i] === BLANK && !t.as);  // a placed blank still waiting for its letter
  // a tile's face: the letter, then its points (a blank's letter is shown, with no points)
  const face = (el, ch, blank) => { el.classList.toggle('blank', blank); el.append(ch, Object.assign(document.createElement('sub'), { textContent: blank ? '' : S.ws.values[ch] })); };

  function mount(main, side) {
    pending = []; selected = null; order = []; rackKey = ''; swapMode = false; swapSel.clear(); previewKey = ''; seenLast = null; prevScores = null; seenBounty = null;
    main.innerHTML = '<div class="ws-board"></div>';
    side.innerHTML = `<div class="panel">
      <div class="ws-info"><span id="wsBag"></span><span id="wsBounty"></span></div>
      <div id="wsRack" class="rack"></div>
      <div id="wsBlank" class="ws-blank" hidden><p class="hint">Which letter is the blank?</p><div id="wsLetters" class="ws-letters"></div></div>
      <div id="wsPreview" class="ws-preview"></div>
      <div class="row"><button id="wsPlay" class="primary">Play</button><button id="wsRecall">Recall</button><button id="wsShuffle">🔀</button></div>
      <div class="row"><button id="wsSwap">Swap tiles…</button><button id="wsPass">Pass</button><button id="wsHint" hidden>💡 Hint</button></div>
      <p class="hint left">Drag a tile onto a square, or tap a tile and then a square. Drag a placed tile to move it,
      or off the board (or tap it) to take it back.
      DL/TL = double/triple letter, DW/TW = double/triple word.</p></div>
      <div class="panel"><h3>Turns</h3><div id="wsPlays" class="ws-plays"></div></div>`;
    board = main.querySelector('.ws-board');
    for (let r = 0; r < 11; r++)
      for (let c = 0; c < 11; c++) {
        const cell = document.createElement('button');
        cell.className = 'ws-cell';
        cell.onclick = () => { if (skipClick) { skipClick = false; return; } onCell(r, c); };
        cell.addEventListener('pointerdown', (e) => {
          const at = pending.findIndex((t) => t.r === r && t.c === c);
          if (at >= 0) startDrag(e, pending[at].i, cell, at);
        });
        board.append(cell);
      }
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const b = document.createElement('button');
      b.textContent = ch;
      b.onclick = () => { const t = unnamed(); if (t) { t.as = ch; ctx.rerender(); } };
      $('wsLetters').append(b);
    }
    $('wsPlay').onclick = play;
    $('wsHint').onclick = hint;
    $('wsRecall').onclick = () => { pending = []; selected = null; ctx.rerender(); };
    // shuffle: the tiles slide to their new places instead of jumping
    $('wsShuffle').onclick = () => {
      const before = Kit.snap($('wsRack'));
      for (let k = order.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; }
      ctx.rerender();
      Kit.glide($('wsRack'), before, 320);
      ctx.sfx('tick');
    };
    $('wsPass').onclick = async () => { if (await ctx.ask('Pass your turn?', { ok: 'Pass' })) ctx.quiet(ctx.act('pass')); };
    $('wsSwap').onclick = () => {
      if (!swapMode) { swapMode = true; swapSel.clear(); pending = []; selected = null; ctx.toast('Tap the tiles to swap, then confirm.'); }
      else if (swapSel.size) { ctx.quiet(ctx.act('swap', { idx: [...swapSel] })); swapMode = false; }
      else swapMode = false;
      ctx.rerender();
    };
  }

  // the turn history: newest first, the best play of the game starred
  function renderPlays() {
    const box = $('wsPlays'); if (!box) return;
    const plays = S.ws.plays || [];
    box.innerHTML = '';
    if (!plays.length) { box.append(ctx.el('p', 'hint left', 'Words played show up here.')); return; }
    const best = Math.max(...plays.map((x) => x[2]));
    for (const [pid, words, pts] of [...plays].reverse()) {
      const p = ctx.player(pid);
      const row = ctx.el('div', 'ws-play' + (pts && pts === best ? ' best' : ''));
      const who = ctx.el('span', 'who', p?.name ?? '?'); who.style.color = p?.color ?? '';
      row.append(who, ctx.el('span', 'words', words), ctx.el('b', '', pts ? `+${pts}` : ''));
      box.append(row);
    }
  }

  function render(s, c) {
    S = s; ctx = c;
    renderPlays();
    const w = S.ws, rack = w.rack || [];
    const key = rack.join('');
    if (key !== rackKey) {  // rack changed (new turn/tiles): reset local arrangement
      rackKey = key; selected = null; swapMode = false; swapSel.clear();
      order = rack.map((_, i) => i);
      pending = restore(S.code + key);
    }
    pending = pending.filter((t) => w.grid[t.r][t.c] == null && t.i < rack.length);
    save(S.code + key);
    const lastSet = new Set(w.last.map(([r, c]) => r * 11 + c));
    // a new play: its tiles snap down one after another and the points burst out of the word
    const lastKey = JSON.stringify(w.last), played = seenLast !== null && lastKey !== seenLast && w.last.length;
    const gainer = played && prevScores ? Object.keys(w.scores).find((id) => w.scores[id] > (prevScores[id] ?? 0)) : null;
    const gain = gainer ? w.scores[gainer] - (prevScores[gainer] ?? 0) : 0;
    seenLast = lastKey; prevScores = { ...w.scores };
    const lastOrder = new Map(w.last.map(([r, c], k) => [r * 11 + c, k]));

    [...board.children].forEach((cell, i) => {
      const r = Math.floor(i / 11), c = i % 11;
      const letter = w.grid[r][c];
      const pend = pending.find((t) => t.r === r && t.c === c);
      const prem = w.premiums[r][c];
      cell.className = 'ws-cell' + (prem ? ' p' + prem.replace('★', 'star') : '');
      cell.textContent = '';
      if (letter || pend) {
        const ch = letter ? letter.toUpperCase() : rack[pend.i] === BLANK ? pend.as || BLANK : rack[pend.i];
        cell.classList.add('tile');
        cell.classList.toggle('pending', !!pend);
        cell.classList.toggle('last', lastSet.has(i));
        if (played && lastSet.has(i) && motionOK()) { cell.classList.add('snap'); cell.style.animationDelay = lastOrder.get(i) * 0.07 + 's'; }
        else cell.classList.remove('snap');
        const who = !pend && w.by?.[r][c];
        cell.style.setProperty('--by', who ? ctx.player(who)?.color ?? '#0003' : '#0003');
        if (pend) cell.style.setProperty('--by', ctx.player(S.me.id)?.color ?? '#fff');
        face(cell, ch, letter ? letter !== ch : rack[pend.i] === BLANK);
      } else if (prem) cell.textContent = PREMIUM_LABEL[prem];
    });

    if (played) {
      w.last.forEach((_, k) => setTimeout(() => ctx.sfx('place'), k * 70));
      const [mr, mc] = w.last[Math.floor(w.last.length / 2)];
      if (gain) setTimeout(() => Kit.flyText(board.children[mr * 11 + mc], `+${gain}`, gain >= 40 ? 'gold' : 'good'), w.last.length * 70 + 100);
      if (w.last.length === 7) Kit.callout('🧹 Clean sweep!', 'gold', { sound: 'fanfare' });
      else if (gain >= 50) Kit.callout(`${gain}!`, 'gold', { ms: 1100 });
    }
    if (w.bounty && seenBounty && w.bounty !== seenBounty) { const b = $('wsBounty'); b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); }
    seenBounty = w.bounty;
    const rackBox = $('wsRack'); rackBox.innerHTML = '';
    const used = new Set(pending.map((t) => t.i));
    for (const i of order) {
      if (used.has(i) || i >= rack.length) continue;
      const t = ctx.el('button', 'rack-tile' + (selected === i ? ' sel' : '') + (swapSel.has(i) ? ' swap' : ''));
      t.dataset.k = i;
      face(t, rack[i], rack[i] === BLANK);
      t.onclick = () => { if (skipClick) { skipClick = false; return; } onRack(i); };
      t.addEventListener('pointerdown', (e) => { if (!swapMode) startDrag(e, i, t, -1); });
      rackBox.append(t);
    }
    if (!rack.length) rackBox.append(ctx.el('span', 'hint', S.me.spectator ? 'Spectating' : 'No tiles'));

    $('wsBag').textContent = `👜 ${w.bag} in bag`;
    $('wsBounty').textContent = w.bounty ? `🎯 Bounty: ${w.bounty} (+${w.bonuses.bounty})` : '';
    const playing = S.phase === 'playing' && rack.length;
    $('wsBlank').hidden = !unnamed();
    $('wsPlay').disabled = !ctx.myTurn || !pending.length || swapMode || !!unnamed();
    $('wsPass').disabled = !ctx.myTurn;
    $('wsSwap').disabled = !ctx.myTurn || !playing;
    $('wsSwap').textContent = !swapMode ? 'Swap tiles…' : swapSel.size ? `Swap ${swapSel.size}` : 'Cancel swap';
    const humans = S.players.filter((p) => !p.bot && !p.spectator).length;
    $('wsHint').hidden = humans !== 1 || !ctx.peek || !rack.length;
    $('wsHint').disabled = !ctx.myTurn || swapMode;
    preview();
  }

  // ask the server what the placed tiles would score (it has the dictionary), a moment after they settle
  function preview() {
    const box = $('wsPreview');
    const key = JSON.stringify([pending, S.ws.grid.flat().join(), rackKey]);
    if (key === previewKey) return;
    previewKey = key;
    clearTimeout(previewTimer);
    box.textContent = ''; box.className = 'ws-preview';
    if (!pending.length || !ctx.peek || unnamed()) return;
    previewTimer = setTimeout(() => {
      ctx.peek({ what: 'score', tiles: pending }).then((res) => {
        if (previewKey !== key || !box.isConnected) return;
        box.className = 'ws-preview ' + (res.error ? 'bad' : 'good');
        box.textContent = res.error ? `✗ ${res.error}` : `✓ ${res.words.join(', ')}: ${res.score} pts${res.notes.length ? ` (${res.notes.join(', ')})` : ''}`;
      }).catch(() => {});
    }, 250);
  }

  // solo only: place the best word the bots' search finds, using the matching rack tiles
  function hint() {
    ctx.peek({ what: 'hint' }).then((res) => {
      if (res.none) return ctx.toast('No word fits. Try swapping tiles.');
      const rack = S.ws.rack, free = rack.map((_, i) => i);
      pending = res.tiles.map(([r, c, ch]) => {  // a lowercase letter is played with a blank
        const blank = ch !== ch.toUpperCase();
        const at = free.findIndex((i) => rack[i] === (blank ? BLANK : ch));
        return blank ? { r, c, i: free.splice(at, 1)[0], as: ch.toUpperCase() } : { r, c, i: free.splice(at, 1)[0] };
      });
      selected = null;
      ctx.toast(`💡 ${res.words.join(', ')} for ${res.score}`);
      ctx.rerender();
    }).catch((e) => ctx.toast(e.message));
  }

  // Half-built words survive an accidental refresh (stored per tab, per rack).
  function restore(k) {
    try { return JSON.parse(sessionStorage.getItem('ws.pending.' + k)) || []; } catch { return []; }
  }
  function save(k) {
    try { sessionStorage.setItem('ws.pending.' + k, JSON.stringify(pending)); } catch {}
  }

  // ---------- drag and drop: a rack tile onto a square, a placed tile to another square or off the board
  function cellAt(x, y) {
    const r = board.getBoundingClientRect();
    if (!r.width || x < r.left || y < r.top || x >= r.right || y >= r.bottom) return null;
    return [Math.floor(((y - r.top) / r.height) * 11), Math.floor(((x - r.left) / r.width) * 11)];
  }
  function startDrag(e, i, el, at) {
    if (e.button > 0 || S.phase !== 'playing' || S.me.spectator) return;
    drag = { i, el, at, x: e.clientX, y: e.clientY, ghost: null };
    const move = (ev) => {
      if (!drag) return;
      if (!drag.ghost) {
        if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 8) return;
        drag.ghost = ctx.el('span', 'rack-tile ws-ghost', S.ws.rack[i]);
        document.body.append(drag.ghost);
        el.classList.add('lifted');
      }
      drag.ghost.style.left = `${ev.clientX - 20}px`; drag.ghost.style.top = `${ev.clientY - 44}px`;  // above the finger
      const over = cellAt(ev.clientX, ev.clientY - 24);
      for (const [k, c] of [...board.children].entries()) c.classList.toggle('drop', !!over && k === over[0] * 11 + over[1]);
    };
    const up = (ev) => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      const d = drag; drag = null;
      if (!d?.ghost) return;
      d.ghost.remove(); d.el.classList.remove('lifted');
      for (const c of board.children) c.classList.remove('drop');
      skipClick = true; setTimeout(() => { skipClick = false; }, 0);
      const over = ev.type === 'pointerup' ? cellAt(ev.clientX, ev.clientY - 24) : null;
      const as = d.at >= 0 ? pending.splice(d.at, 1)[0].as : undefined;  // a placed tile lifts off its square (a blank keeps its letter)
      if (over && S.ws.grid[over[0]][over[1]] == null && !pending.some((t) => t.r === over[0] && t.c === over[1])) {
        pending.push(as ? { r: over[0], c: over[1], i: d.i, as } : { r: over[0], c: over[1], i: d.i });
      }
      selected = null;
      ctx.rerender();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }

  function onRack(i) {
    if (swapMode) { swapSel.has(i) ? swapSel.delete(i) : swapSel.add(i); }
    else selected = selected === i ? null : i;
    ctx.rerender();
  }

  function onCell(r, c) {
    if (S.phase !== 'playing' || swapMode) return;
    const at = pending.findIndex((t) => t.r === r && t.c === c);
    if (at >= 0) { pending.splice(at, 1); return ctx.rerender(); }
    if (S.ws.grid[r][c] != null) return;
    if (selected == null) return ctx.toast('Tap a tile on your rack first.');
    pending.push({ r, c, i: selected });
    selected = null;
    ctx.rerender();
  }

  function play() {
    ctx.act('play', { tiles: pending }).catch(() => {});
  }

  function unmount() { drag?.ghost?.remove(); drag = null; }

  return { ownSounds: true, mount, render, unmount };
})();
