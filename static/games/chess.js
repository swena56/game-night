UI.chess = (() => {
  let S, ctx, boardEl, sel = null, promo = null, shownLast, view3d = null, slide = null;
  const want3d = () => { try { return localStorage.getItem('chess.view') !== '2d'; } catch { return true; } };
  const GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
  const TEXT = '︎'; // force text (not emoji) rendering of chess glyphs
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    sel = null; promo = null; shownLast = undefined; slide = null;
    main.innerHTML = '<div class="chess-wrap"><div class="chessboard"></div><div class="chess3d" id="ch3d" hidden></div></div>';
    side.innerHTML = `<div class="panel">
      <div id="chStatus" class="seat-row"></div>
      <div id="chTaken" class="taken"></div>
      <div id="chPromo" class="row promo" hidden></div>
      <div id="chDraw" class="row"></div>
      <div class="row"><button id="chResign" class="danger">🏳️ Resign</button></div>
      <div class="row"><button id="chView" hidden></button></div>
      <p class="hint left" id="chViewHint" hidden>3D: tap a piece, then its square. Drag sideways to turn the board; double-tap to reset.</p></div>`;
    boardEl = main.querySelector('.chessboard');
    for (let i = 0; i < 64; i++) {
      const sq = document.createElement('button');
      sq.className = 'csq';
      sq.onclick = () => onSquare(i);
      boardEl.append(sq);
    }
    $('chView').onclick = () => {
      try { localStorage.setItem('chess.view', view3d ? '2d' : '3d'); } catch {}
      setView(!view3d);
    };
    if (want3d()) load3d();
    $('chResign').onclick = async () => (await ctx.ask('Resign this game?', { ok: '🏳️ Resign', danger: true })) && ctx.quiet(ctx.act('resign'));
  }

  // board index ↔ (row, col) with Black seeing the board from their side
  const flip = () => S.chess.me === 'b';
  const rc = (i) => { const r = Math.floor(i / 8), c = i % 8; return flip() ? [7 - r, 7 - c] : [r, c]; };

  function render(s, c) {
    S = s; ctx = c;
    const ch = S.chess, moves = ch.moves;
    if (!ctx.myTurn) { sel = null; promo = null; }
    const targets = new Set(sel ? moves.filter((m) => m[0] === sel[0] && m[1] === sel[1]).map((m) => m[2] * 8 + m[3]) : []);
    const movable = new Set(moves.map((m) => m[0] * 8 + m[1]));
    const lastKey = ch.last?.join() ?? null, animate = shownLast !== undefined && lastKey && lastKey !== shownLast;
    shownLast = lastKey;
    [...boardEl.children].forEach((sq, i) => {
      const [r, col] = rc(i);
      const p = ch.board[r][col];
      sq.className = 'csq ' + ((r + col) % 2 ? 'dark' : 'light');
      if (ch.last && ((ch.last[0] === r && ch.last[1] === col) || (ch.last[2] === r && ch.last[3] === col))) sq.classList.add('last');
      if (ch.check && ch.check[0] === r && ch.check[1] === col) sq.classList.add('check');
      if (sel && sel[0] === r && sel[1] === col) sq.classList.add('sel');
      if (targets.has(r * 8 + col)) sq.classList.add(p ? 'capture' : 'target');
      if (!sel && movable.has(r * 8 + col)) sq.classList.add('movable');
      sq.innerHTML = '';
      if (p) {
        const piece = ctx.el('span', 'piece ' + p[0], GLYPH[p[1]] + TEXT);
        if (animate && ch.last[2] === r && ch.last[3] === col) {
          slideFrom(piece, ch.last[0] - r, ch.last[1] - col, flip());
          slide = { from: disp(ch.last[0], ch.last[1]), to: i };
        }
        sq.append(piece);
      }
      if (i % 8 === 0) sq.append(ctx.el('span', 'coord rank', String(8 - r)));
      if (i >= 56) sq.append(ctx.el('span', 'coord file', 'abcdefgh'[col]));
    });

    sync3d();
    const mine = ch.me ? (ch.me === 'w' ? '♔ You play White' : '♚ You play Black') : '👁 Watching';
    $('chStatus').textContent = mine + (S.phase === 'playing' ? ` · ${ch.turnColor === 'w' ? 'White' : 'Black'} to move` : '');
    const lost = (color) => ch.captured[color].map((k) => GLYPH[k] + TEXT).join('');
    $('chTaken').innerHTML = '';
    $('chTaken').append(ctx.el('div', '', `White took: ${lost('b') || '—'}`), ctx.el('div', '', `Black took: ${lost('w') || '—'}`));

    const pr = $('chPromo'); pr.innerHTML = ''; pr.hidden = !promo;
    if (promo) for (const k of 'QRBN') {
      const b = ctx.el('button', 'piece-btn', GLYPH[k] + TEXT);
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
    const ready = window.THREE ? Promise.resolve() : new Promise((res, rej) => {
      const sc = document.createElement('script'); sc.src = '/vendor/three.min.js'; sc.onload = res; sc.onerror = rej; document.head.append(sc);
    });
    ready.then(() => {
      if (!boardEl?.isConnected || gl) return;
      gl = Chess3D.create($('ch3d'), (i) => onSquare(i)) || false;
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

  function unmount() { if (gl) gl.dispose(); gl = null; view3d = null; }

  function onSquare(i) {
    if (!ctx.myTurn || promo) return;
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

  return { mount, render, unmount };
})();
