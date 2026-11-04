UI.chess = (() => {
  // premove: picked during the rival's turn ([fromR, fromC, toR, toC]), sent the moment it's our turn if it's legal
  let pre = null, preSel = null;
  let S, ctx, boardEl, sel = null, promo = null, shownLast, view3d = null, slide = null, clockTimer = 0, clockAt = 0, shownTaken = null, shownW = 0;
  const want3d = () => { try { return localStorage.getItem('chess.view') !== '2d'; } catch { return true; } };
  const GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
  const NAME = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };
  const TEXT = '︎'; // force text (not emoji) rendering of chess glyphs
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    sel = null; promo = null; pre = null; preSel = null; shownLast = undefined; slide = null; shownTaken = null; shownW = 0;
    main.innerHTML = '<div id="chClock" class="ch-clocks" hidden></div><div class="chess-wrap"><div class="chessboard"></div><div class="chess3d" id="ch3d" hidden></div></div>';
    side.innerHTML = `<div class="panel">
      <div id="chStatus" class="seat-row"></div>
      <div id="chTaken" class="taken"></div>
      <ol id="chMoves" class="ch-moves"></ol>
      <div id="chPromo" class="row promo" hidden></div>
      <div id="chDraw" class="row"></div>
      <div class="row"><button id="chResign" class="danger">🏳️ Resign</button></div>
      <div class="row"><button id="chView" hidden></button></div>
      <p class="hint left" id="chViewHint" hidden>3D: tap a piece, then its square. Drag to turn the board (with a mouse, up and down tilts it), right-drag or shift-drag to pan, scroll or pinch to zoom, or use the buttons; double-tap resets.</p></div>`;
    boardEl = main.querySelector('.chessboard');
    for (let i = 0; i < 64; i++) {
      const sq = document.createElement('button');
      sq.className = 'csq';
      sq.onclick = () => onSquare(i);
      boardEl.append(sq);
    }
    gridKeys(boardEl, 8);
    $('chView').onclick = () => {
      try { localStorage.setItem('chess.view', view3d ? '2d' : '3d'); } catch {}
      setView(!view3d);
    };
    if (want3d()) load3d();
    clockTimer = setInterval(tickClock, 200);
    $('chResign').onclick = async () => (await ctx.ask('Resign this game?', { ok: '🏳️ Resign', danger: true })) && ctx.quiet(ctx.act('resign'));
  }

  // board index ↔ (row, col) with Black seeing the board from their side
  const flip = () => S.chess.me === 'b';
  const rc = (i) => { const r = Math.floor(i / 8), c = i % 8; return flip() ? [7 - r, 7 - c] : [r, c]; };

  function render(s, c) {
    S = s; ctx = c; clockAt = performance.now();
    const ch = S.chess, moves = ch.moves;
    if (!ctx.myTurn) { sel = null; promo = null; }
    if (S.phase !== 'playing' || !ch.me) pre = preSel = null;
    if (ctx.myTurn) preSel = null;
    if (ctx.myTurn && pre && ctx.act) {
      const want = pre, hits = moves.filter((m) => m[0] === want[0] && m[1] === want[1] && m[2] === want[2] && m[3] === want[3]);
      pre = null;
      if (hits.length) {  // a premoved pawn promotes to a queen
        const m = hits.find((x) => !x[4] || x[4] === 'Q') ?? hits[0];
        setTimeout(() => ctx.quiet(ctx.act('move', { move: m })), 0);
      } else ctx.toast('Premove cancelled: it isn\'t legal now.');
    }
    const targets = new Set(sel ? moves.filter((m) => m[0] === sel[0] && m[1] === sel[1]).map((m) => m[2] * 8 + m[3]) : []);
    const movable = new Set(moves.map((m) => m[0] * 8 + m[1]));
    const lastKey = ch.last?.join() ?? null, animate = shownLast !== undefined && lastKey && lastKey !== shownLast;
    shownLast = lastKey;
    // a capture: the taken piece lingers on its square and fades off while the capturer slides in
    const taken = ch.captured.w.length + ch.captured.b.length;
    const victim = animate && shownTaken != null && taken > shownTaken
      ? (ch.captured.w.length > shownW ? ['w', ch.captured.w.at(-1)] : ['b', ch.captured.b.at(-1)]) : null;
    shownTaken = taken; shownW = ch.captured.w.length;
    [...boardEl.children].forEach((sq, i) => {
      const [r, col] = rc(i);
      const p = ch.board[r][col];
      sq.className = 'csq ' + ((r + col) % 2 ? 'dark' : 'light');
      if (ch.last && ((ch.last[0] === r && ch.last[1] === col) || (ch.last[2] === r && ch.last[3] === col))) sq.classList.add('last');
      if (ch.check && ch.check[0] === r && ch.check[1] === col) sq.classList.add('check');
      if (sel && sel[0] === r && sel[1] === col) sq.classList.add('sel');
      if (preSel && preSel[0] === r && preSel[1] === col) sq.classList.add('sel');
      if (pre && ((pre[0] === r && pre[1] === col) || (pre[2] === r && pre[3] === col))) sq.classList.add('premove');
      if (targets.has(r * 8 + col)) sq.classList.add(p ? 'capture' : 'target');
      if (!sel && movable.has(r * 8 + col)) sq.classList.add('movable');
      sq.innerHTML = '';
      if (p) {
        const piece = ctx.el('span', `piece ${p[0]} p${p[1]}`, GLYPH[p[1]] + TEXT);
        if (animate && ch.last[2] === r && ch.last[3] === col) {
          slideFrom(piece, ch.last[0] - r, ch.last[1] - col, flip());
          slide = { from: disp(ch.last[0], ch.last[1]), to: i };
        }
        sq.append(piece);
        if (victim && ch.last[2] === r && ch.last[3] === col) sq.append(ctx.el('span', `piece taken ${victim[0]} p${victim[1]}`, GLYPH[victim[1]] + TEXT));
      }
      sq.setAttribute('aria-label', `${'abcdefgh'[col]}${8 - r}, ${p ? `${p[0] === 'w' ? 'white' : 'black'} ${NAME[p[1]]}` : 'empty'}`);
      if (i % 8 === 0) sq.append(ctx.el('span', 'coord rank', String(8 - r)));
      if (i >= 56) sq.append(ctx.el('span', 'coord file', 'abcdefgh'[col]));
    });

    sync3d();
    const mine = ch.me ? (ch.me === 'w' ? '♔ You play White' : '♚ You play Black') : '👁 Watching';
    $('chStatus').textContent = mine + (S.phase === 'playing' ? ` · ${ch.turnColor === 'w' ? 'White' : 'Black'} to move` : '');
    if (pre || preSel) {
      const sqName = (r, c) => 'abcdefgh'[c] + (8 - r);
      const x = ctx.el('button', 'ghost-btn', '✕');
      x.onclick = () => { pre = preSel = null; ctx.rerender(); };
      $('chStatus').append(ctx.el('span', 'ch-pre', pre ? ` · ⏩ Premove ${sqName(pre[0], pre[1])}→${sqName(pre[2], pre[3])}` : ' · ⏩ Premove: pick a square'), x);
    }
    // captured material, most valuable first, and who is ahead (+N in pawns)
    const VAL = { Q: 9, R: 5, B: 3, N: 3, P: 1, K: 0 };
    const worth = (color) => ch.captured[color].reduce((t, k) => t + VAL[k], 0);
    const lead = worth('b') - worth('w');  // white's lead: black pieces taken minus white pieces taken
    const tray = (label, color, plus) => {
      const row = ctx.el('div', 'taken-row', label + ' ');
      const ks = [...ch.captured[color]].sort((a, b) => VAL[b] - VAL[a]);
      if (!ks.length) row.append('—');
      for (const k of ks) row.append(ctx.el('span', `piece ${color} p${k}`, GLYPH[k] + TEXT));
      if (plus > 0) row.append(ctx.el('b', '', `+${plus}`));
      return row;
    };
    $('chTaken').innerHTML = '';
    $('chTaken').append(tray('White took:', 'b', lead), tray('Black took:', 'w', -lead));

    const list = $('chMoves'), sans = ch.sans || [];
    list.innerHTML = '';
    for (let i = 0; i < sans.length; i += 2) list.append(ctx.el('li', '', sans.slice(i, i + 2).join('  ')));
    list.hidden = !sans.length;
    list.scrollTop = list.scrollHeight;

    const pr = $('chPromo'); pr.innerHTML = ''; pr.hidden = !promo;
    if (promo) for (const k of 'QRBN') {
      const b = ctx.el('button', 'piece-btn');
      b.append(ctx.el('span', `piece ${ch.me || 'w'} p${k}`, GLYPH[k] + TEXT));
      b.onclick = () => { const m = [...promo, k]; promo = null; sel = null; ctx.quiet(ctx.act('move', { move: m })); };
      pr.append(b);
    }
    const dr = $('chDraw'); dr.innerHTML = '';
    const playing = S.phase === 'playing' && ch.me;
    if (playing && ch.drawOffer && ch.drawOffer !== S.me.id) {
      const yes = ctx.el('button', 'primary', '🤝 Accept draw'); yes.onclick = () => ctx.quiet(ctx.act('draw_accept'));
      const no = ctx.el('button', '', 'Decline'); no.onclick = () => ctx.quiet(ctx.act('draw_decline'));
      dr.append(yes, no);
    } else if (playing) {
      const b = ctx.el('button', '', ch.drawOffer ? 'Draw offered…' : '🤝 Offer draw');
      b.disabled = !!ch.drawOffer; b.onclick = () => ctx.quiet(ctx.act('draw_offer'));
      dr.append(b);
    }
    $('chResign').disabled = !playing;
  }

  // ---------- optional 3D view (static/games/chess3d.js); the 2D board stays the source of truth
  const disp = (r, c) => (flip() ? (7 - r) * 8 + (7 - c) : r * 8 + c);
  let gl = null;  // the 3D scene once created, false if WebGL is unavailable
  function load3d() {
    const ready = GL3.load();
    ready.then(() => {
      if (!boardEl?.isConnected || gl) return;
      gl = Chess3D.create($('ch3d'), (i) => onSquare(i), () => {
        // the GPU context was lost (phone app switch): make a new 3D board
        if (!gl) return;
        gl.dispose(); gl = null;
        if (view3d) load3d();
      }) || false;
      setView(!!gl);
    }).catch(() => { gl = false; setView(false); });
  }
  function setView(on) {
    if (on && gl === null) return load3d();
    view3d = on && !!gl;
    $('ch3d').hidden = !view3d;
    boardEl.hidden = view3d;
    const btn = $('chView');
    btn.hidden = gl === false;
    btn.textContent = view3d ? '▦ Flat board' : '🧊 3D board';
    $('chViewHint').hidden = !view3d;
    if (S) sync3d();
  }
  function sync3d() {
    const s = slide; slide = null;
    if (!view3d || !gl) return;
    const list = [];
    [...boardEl.children].forEach((sq, i) => {
      const [r, c] = rc(i), p = S.chess.board[r][c];
      if (p) list.push({ i, color: p[0], kind: p[1] });
    });
    gl.sync(list, [...boardEl.children], flip() ? 'b' : 'w', s);
  }

  function unmount() { if (gl) gl.dispose(); gl = null; view3d = null; clearInterval(clockTimer); }

  // chess clock: the server sends both clocks; the mover's counts down locally between updates
  const fmt = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60), sec = t - m * 60; return t < 20 ? `${m}:${sec.toFixed(1).padStart(4, '0')}` : `${m}:${String(Math.floor(sec)).padStart(2, '0')}`; };
  function tickClock() {
    const box = $('chClock'), ch = S?.chess;
    if (!box) return;
    box.hidden = !ch?.clock;
    if (!ch?.clock) return;
    const since = (performance.now() - clockAt) / 1000, running = S.phase === 'playing' ? S.turn : null;
    box.innerHTML = '';
    // the opponent's clock first, then mine (Black, then White when watching)
    const order = ch.me === 'b' ? [...ch.seats] : [...ch.seats].reverse();
    for (const pid of order) {
      const p = ctx.player(pid);
      const t = ch.clock[pid] - (pid === running ? since : 0);
      const row = ctx.el('div', 'ch-clock' + (pid === running ? ' on' : '') + (pid === running && t < 20 ? ' low' : ''));
      row.append(ctx.el('span', '', `${ch.seats[0] === pid ? '♔' : '♚'} ${p?.name ?? '?'}${ch.inc ? ` · +${ch.inc}s` : ''}`), ctx.el('b', '', fmt(t)));
      box.append(row);
    }
  }

  function onSquare(i) {
    if (!ctx.myTurn) return premove(i);
    if (promo) return;
    const [r, c] = rc(i);
    const moves = S.chess.moves;
    if (sel) {
      const hits = moves.filter((m) => m[0] === sel[0] && m[1] === sel[1] && m[2] === r && m[3] === c);
      if (hits.length > 1) { promo = [sel[0], sel[1], r, c]; return ctx.rerender(); }
      if (hits.length === 1) { sel = null; ctx.quiet(ctx.act('move', { move: hits[0] })); return ctx.rerender(); }
    }
    sel = moves.some((m) => m[0] === r && m[1] === c) ? [r, c] : null;
    ctx.rerender();
  }

  // during the rival's turn: tap a piece, then a square; tap the piece again (or ✕ in the status) to cancel
  function premove(i) {
    const ch = S.chess;
    if (S.phase !== 'playing' || !ch.me || !ctx.act) return;
    const [r, c] = rc(i), mine = ch.board[r][c]?.[0] === ch.me;
    if (preSel && !(preSel[0] === r && preSel[1] === c) && !mine) { pre = [...preSel, r, c]; preSel = null; }
    else if (preSel && preSel[0] === r && preSel[1] === c) preSel = null;
    else if (mine) { preSel = [r, c]; pre = null; }
    else pre = preSel = null;
    ctx.rerender();
  }

  const ownTimer = (s) => !!s.chess?.clock;  // the board shows both clocks; skip the top-bar timer

  return { mount, render, unmount, ownTimer };
})();
