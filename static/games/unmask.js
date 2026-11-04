UI.unmask = (() => {
  let S, ctx, boardKey = '', accuseMode = false, populated = false, seenNotes = null, sizer = null;
  // card size, set by pinching the board or the 🔍 buttons, remembered on this device
  // Until the player picks a size, phones fit every face on one screen with the Ask panel just under it.
  let zoom = 92, autoFit = true;
  try { const z = +localStorage.getItem('unmask.zoom'); if (z) { zoom = Math.min(200, Math.max(60, z)); autoFit = false; } } catch {}
  const $ = (s) => document.querySelector(s);

  const holds = (f, qid) => { const [a, v] = qid.split(':'); return v === 'any' ? f[a] !== 'none' : f[a] === v; };
  const evaluate = (f, q) => { const a = holds(f, q.a); if (!q.op) return a; const b = holds(f, q.b); return q.op === 'and' ? a && b : a || b; };
  const misfits = (c) => S.board.filter((f) => !S.me.flipped.includes(f.id) && evaluate(f, c.q) !== c.ans).map((f) => f.id);

  function mount(main, side) {
    boardKey = ''; accuseMode = false; populated = false; seenNotes = null;
    main.innerHTML = `<div class="zoom-bar"><span>🔍</span><button id="zoomOut" aria-label="Smaller faces">−</button>
      <button id="zoomIn" aria-label="Bigger faces">+</button><small>or pinch the board</small></div><div id="board" class="board"></div>`;
    setZoom(zoom, !autoFit);
    $('#zoomOut').onclick = () => setZoom(cardWidth() / 1.2);
    $('#zoomIn').onclick = () => setZoom(cardWidth() * 1.2);
    pinchable($('#board'));
    sizer?.disconnect(); sizer = new ResizeObserver(fitColumns); sizer.observe($('#board'));
    side.innerHTML = `
      <div id="identity" class="panel identity"></div>
      <div id="askPanel" class="panel">
        <h3>Ask a question</h3>
        <select id="qa"></select>
        <label id="comboRow" class="check" hidden><input type="checkbox" id="useCombo"> 🔗 Use Combo card</label>
        <div id="comboFields" class="row" hidden>
          <select id="qop"><option value="and">AND</option><option value="or">OR</option></select>
          <select id="qb"></select>
        </div>
        <p id="qPreview" class="preview"></p>
        <div class="row">
          <button id="askBtn" class="primary">Ask</button>
          <button id="accuseBtn" class="danger">🎯 Accuse…</button>
        </div>
        <div id="cards" class="cards"></div>
      </div>
      <div class="panel"><h3>🗒️ Your clues</h3><div id="umNotes" class="um-notes"></div></div>`;
    for (const id of ['#qa', '#qb', '#qop']) $(id).onchange = updatePreview;
    $('#useCombo').onchange = () => { $('#comboFields').hidden = !$('#useCombo').checked; updatePreview(); };
    $('#askBtn').onclick = () => { ctx.quiet(ctx.act('ask', { q: currentQuestion() })); $('#useCombo').checked = false; };
    $('#accuseBtn').onclick = () => { accuseMode = !accuseMode; ctx.rerender(); if (accuseMode) ctx.toast('Tap the face you think it is.'); };
  }

  function setZoom(px, chosen = true) {
    zoom = Math.round(Math.min(200, Math.max(chosen ? 40 : 60, px)));
    if (chosen) autoFit = false;
    $('#board')?.style.setProperty('--card', `${zoom}px`);
    fitColumns();
    if (chosen) try { localStorage.setItem('unmask.zoom', String(zoom)); } catch {}
  }
  const cardWidth = () => $('#board .card')?.getBoundingClientRect().width || zoom;
  const phone = () => window.matchMedia?.('(max-width: 860px)').matches;
  // the fewest columns that fit all the faces in the room above the Ask panel (a card is about its width + the name tall)
  function autoColumns(b, n, gap) {
    const room = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--stage-h')) || innerHeight - 180;
    const avail = Math.max(260, room - 40 - 170);  // the zoom bar above, the question picker below
    for (let c = 3; c <= 8; c++) {
      const w = (b.clientWidth - gap * (c - 1)) / c, rows = Math.ceil(n / c);
      if (rows * (w + 24) + gap * (rows - 1) <= avail) return c;
    }
    return 8;
  }
  // as many columns as fit, but (#13) prefer a count that fills the last row: 24 faces as 6×4, not 7+7+7+3
  function fitColumns() {
    const b = $('#board'); if (!b) return;
    const n = b.children.length, gap = 10;
    const fit = autoFit && phone() && n;
    const max = fit ? autoColumns(b, n, gap) : Math.max(1, Math.floor((b.clientWidth + gap) / (zoom + gap)));
    let cols = max;
    // fitted: one more column if that fills the last row (fewer would no longer fit)
    if (fit && n % max && !(n % (max + 1)) && max < 8) cols = max + 1;
    else if (n > max && !fit) {
      let best = -1;
      for (let c = max; c >= Math.max(1, Math.ceil(max * 0.7)); c--) {
        const score = n % c === 0 ? 1 : (n % c) / c;
        if (score > best) { best = score; cols = c; }
      }
    }
    b.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  }

  function pinchable(board) {
    const pts = new Map();
    let from = null;
    const spread = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    board.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) from = { d: spread(), zoom };
    });
    board.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && from?.d > 10) setZoom(from.zoom * (spread() / from.d));
    });
    const lift = (e) => { pts.delete(e.pointerId); if (pts.size < 2) from = null; };
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) board.addEventListener(t, lift);
  }

  function render(s, c) {
    S = s; ctx = c;
    if (!ctx.myTurn) accuseMode = false;
    renderBoard();
    renderIdentity();
    renderAsk();
    renderNotes();
  }

  // every answer you've had, and how many faces each one ruled out
  function renderNotes() {
    const box = $('#umNotes'), n = S.me?.notes; if (!box || !n) return;
    const fresh = seenNotes != null && n.rows.length > seenNotes;
    seenNotes = n.rows.length;
    // a new answer (#14): say it plainly, with a one-tap flip of the faces it rules out
    if (fresh && S.phase === 'playing') {
      const [text, ans, , q] = n.rows[n.rows.length - 1];
      const ids = q ? misfits({ q, ans }) : [];
      ctx.toast(`“${text}” → ${ans ? 'YES ✅' : 'NO ❌'}`,
        ids.length ? { label: `Flip the ${ids.length} that don't fit`, run: () => flip(ids, true, true) } : null);
    }
    box.innerHTML = '';
    if (!n.rows.length) { box.append(ctx.el('p', 'hint left', 'Your answers collect here, with how many faces each one ruled out.')); return; }
    const best = Math.max(...n.rows.map((r) => r[2]));
    n.rows.forEach(([text, ans, out], k) => {
      const row = ctx.el('div', 'um-note' + (out && out === best ? ' best' : '') + (fresh && k === n.rows.length - 1 ? ' new' : ''));
      row.append(ctx.el('span', 'q', `${k + 1}. ${text}`), ctx.el('b', ans ? 'yes' : 'no', ans ? 'YES' : 'NO'),
        ctx.el('small', '', out ? `−${out}` : '±0'));
      box.append(row);
    });
    box.append(ctx.el('p', 'hint left', `${n.left} face${n.left === 1 ? '' : 's'} still fit${n.left === 1 ? 's' : ''} everything you know.`));
  }

  function renderBoard() {
    const board = $('#board');
    const key = S.code + S.board.map((f) => f.name).join();
    if (key !== boardKey) {
      boardKey = key; board.innerHTML = '';
      for (const f of S.board) {
        const b = ctx.el('button', 'card'); b.dataset.id = f.id;
        b.innerHTML = faceSVG(f);
        b.append(ctx.el('span', 'nm', f.name));
        b.onclick = () => onCardClick(f.id);
        board.append(b);
      }
      fitColumns();
    }
    const flipped = new Set(S.me.flipped);
    const badges = {};
    if (S.reveal) {
      if (S.reveal.culprit != null) badges[S.reveal.culprit] = ['Culprit'];
      for (const [pid, face] of Object.entries(S.reveal.secrets))
        if (pid !== S.me.id) (badges[face] ||= []).push(ctx.player(pid)?.name ?? '?');
    }
    for (const c of board.children) {
      const id = +c.dataset.id;
      c.classList.toggle('down', flipped.has(id));
      c.classList.toggle('mine', S.me.secret === id);
      if (badges[id]) c.dataset.badge = badges[id].join(' & '); else delete c.dataset.badge;
    }
    board.classList.toggle('accusing', accuseMode);
  }

  function renderIdentity() {
    const box = $('#identity'); box.innerHTML = '';
    const me = S.me;
    let face = null, text;
    if (me.secret != null) { face = S.board[me.secret]; text = `You are <b>${face.name}</b>. Don't let them unmask you!`; }
    else if (me.ghost && S.reveal?.culprit != null) { face = S.board[S.reveal.culprit]; text = `👻 Ghost view: the culprit is <b>${face.name}</b>. Shh!`; }
    else if (me.ghost) text = '👻 You are watching. Secrets are marked on the board.';
    else text = '🕵️ Find the culprit before everyone else.';
    if (face) { const m = ctx.el('div', 'mini'); m.innerHTML = faceSVG(face); box.append(m); }
    const t = ctx.el('div'); t.innerHTML = text; box.append(t); // names come from the server's fixed list
  }

  function renderAsk() {
    const panel = $('#askPanel');
    panel.hidden = S.phase !== 'playing' || S.me.ghost;
    if (panel.hidden) return;
    if (!populated) {
      for (const sel of [$('#qa'), $('#qb')]) {
        const groups = {};
        for (const q of S.catalog) {
          const g = (groups[q.group] ||= ctx.el('optgroup'));
          g.label = q.group;
          const o = ctx.el('option', '', q.text[0].toUpperCase() + q.text.slice(1)); o.value = q.id; g.append(o);
        }
        sel.append(...Object.values(groups));
      }
      $('#qb').selectedIndex = 6;
      populated = true;
    }
    const hasCombo = S.me.cards.some((c) => c.id === 'combo');
    $('#comboRow').hidden = !hasCombo;
    if (!hasCombo) $('#useCombo').checked = false;
    $('#comboFields').hidden = !$('#useCombo').checked;
    updatePreview();
    $('#askBtn').disabled = !ctx.myTurn;
    const acc = $('#accuseBtn');
    acc.disabled = !ctx.myTurn;
    acc.classList.toggle('on', accuseMode);
    acc.textContent = accuseMode ? 'Cancel accusation' : '🎯 Accuse…';

    const cards = $('#cards'); cards.innerHTML = '';
    for (const c of S.me.cards) {
      const d = ctx.el('div', 'pcard');
      const t = ctx.el('div', 'txt'); t.append(ctx.el('b', '', `${c.icon} ${c.name}`), c.desc);
      d.append(t);
      if (c.id !== 'combo') {
        const b = ctx.el('button', '', 'Use'); b.disabled = !ctx.myTurn;
        b.onclick = () => ctx.quiet(ctx.act('card', { card: c.id }));
        d.append(b);
      }
      cards.append(d);
    }
  }

  function currentQuestion() {
    const q = { a: $('#qa').value };
    if ($('#useCombo').checked) { q.op = $('#qop').value; q.b = $('#qb').value; }
    return q;
  }

  function updatePreview() {
    if (!S?.catalog) return;
    const txt = (id) => S.catalog.find((c) => c.id === id)?.text ?? '';
    const q = currentQuestion();
    let t = txt(q.a); if (q.op) t += ` ${q.op.toUpperCase()} ${txt(q.b)}`;
    $('#qPreview').textContent = t ? `“${t[0].toUpperCase() + t.slice(1)}?”` : '';
  }

  function flip(ids, down, undoable = false) {
    const changed = ids.filter((id) => S.me.flipped.includes(id) !== down);
    S.me.flipped = down ? [...new Set([...S.me.flipped, ...ids])] : S.me.flipped.filter((x) => !ids.includes(x));
    ctx.rerender();
    ctx.quiet(ctx.act('flip', { ids, down }));
    // flipping a batch at once is easy to regret: offer to put exactly those faces back
    if (undoable && changed.length > 1) ctx.toast(`Flipped ${changed.length} faces.`, { label: '↶ Undo', run: () => flip(changed, !down) });
  }

  function onCardClick(id) {
    if (!S || S.phase !== 'playing') return;
    if (accuseMode) {
      const f = S.board[id];
      const warn = S.settings.mode === 'duel' ? 'A wrong guess loses the game.' : 'A wrong guess knocks you out.';
      accuseMode = false; ctx.rerender();
      ctx.ask(`Accuse ${f.name}? ${warn}`, { ok: '🎯 Accuse', danger: true })
        .then((yes) => yes && ctx.quiet(ctx.act('accuse', { face: id })));
      return;
    }
    if (S.me.ghost) return;
    flip([id], !S.me.flipped.includes(id));
  }

  function logButton(e) {
    if (!(e.check && e.helper === S.me.id && S.phase === 'playing')) return null;
    const ids = misfits(e.check);
    if (!ids.length) return null;
    const b = ctx.el('button', '', `Flip the ${ids.length} that don't fit`);
    b.onclick = () => flip(ids, true, true);
    return b;
  }

  return { mount, render, logButton };
})();
