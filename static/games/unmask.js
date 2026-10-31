UI.unmask = (() => {
  let S, ctx, boardKey = '', accuseMode = false, populated = false;
  const $ = (s) => document.querySelector(s);

  const holds = (f, qid) => { const [a, v] = qid.split(':'); return v === 'any' ? f[a] !== 'none' : f[a] === v; };
  const evaluate = (f, q) => { const a = holds(f, q.a); if (!q.op) return a; const b = holds(f, q.b); return q.op === 'and' ? a && b : a || b; };
  const misfits = (c) => S.board.filter((f) => !S.me.flipped.includes(f.id) && evaluate(f, c.q) !== c.ans).map((f) => f.id);

  function mount(main, side) {
    boardKey = ''; accuseMode = false; populated = false;
    main.innerHTML = '<div id="board" class="board"></div>';
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
      </div>`;
    for (const id of ['#qa', '#qb', '#qop']) $(id).onchange = updatePreview;
    $('#useCombo').onchange = () => { $('#comboFields').hidden = !$('#useCombo').checked; updatePreview(); };
    $('#askBtn').onclick = () => { ctx.quiet(ctx.act('ask', { q: currentQuestion() })); $('#useCombo').checked = false; };
    $('#accuseBtn').onclick = () => { accuseMode = !accuseMode; ctx.rerender(); if (accuseMode) ctx.toast('Tap the face you think it is.'); };
  }

  function render(s, c) {
    S = s; ctx = c;
    if (!ctx.myTurn) accuseMode = false;
    renderBoard();
    renderIdentity();
    renderAsk();
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

  function flip(ids, down) {
    S.me.flipped = down ? [...new Set([...S.me.flipped, ...ids])] : S.me.flipped.filter((x) => !ids.includes(x));
    ctx.rerender();
    ctx.quiet(ctx.act('flip', { ids, down }));
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
    b.onclick = () => flip(ids, true);
    return b;
  }

  return { mount, render, logButton };
})();
