// 🔵 Bingo tools: two helpers for bingo played in real life, on this device only (no room, no server; saved in
// localStorage, so they work offline and survive a refresh).
//   📋 My paper cards: type in (or 📷 scan) your paper cards, pick what wins, then tap each number the caller
//      calls. Your cards daub themselves, the squares one away from a win shimmer, and a winning card fills the
//      screen: "BINGO! Card 3: shout it!"
//   🎙️ Be the caller: the ball machine draws fair random balls (tap, or every few seconds), optionally says them
//      out loud, shows the 75-number board (full-screen for a TV), and checks a player's card when they claim.
// Built on BingoKit (bingokit.js). Opened from the home screen: UI.bingotools.open(section, api).
UI.bingotools = (() => {
  const K = BingoKit;
  const { COLS, L, el, motion } = K;
  const KEY = 'gn.bingoTools';
  const PATTERNS = [['line', 'Any line'], ['two', 'Two lines'], ['corners', 'Four corners'], ['blackout', 'Blackout'],
    ...Object.entries(K.SHAPES).filter(([k]) => k !== 'blackout').map(([k, [name]]) => [k, name]), ['custom', '✏️ My pattern']];
  const PREVIEW = { line: [10, 11, 12, 13, 14], two: [0, 1, 2, 3, 4, 20, 21, 22, 23, 24], corners: K.CORNERS, blackout: K.ALL };

  let st, host, api, mach = null, raf = 0, last = 0, autoT = 0, onKey = null;

  // ---------- saved state

  function fresh() {
    return { tab: 'cards', cards: [], calls: [], pattern: 'line', custom: [0, 4, 12, 20, 24], alerted: [], nextId: 1,
      books: [{ id: 0, name: 'Loose cards', color: '#8d99ae', on: true, open: true }], nextBook: 1, addTo: 0, view: 'auto',
      caller: { called: [], auto: 0, voice: false, pattern: 'line' } };
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && Array.isArray(s.cards)) {
        const v = { ...fresh(), ...s, caller: { ...fresh().caller, ...(s.caller || {}) } };
        if (!Array.isArray(v.books) || !v.books.some((b) => b.id === 0)) v.books = [...fresh().books, ...(Array.isArray(v.books) ? v.books : [])];
        for (const c of v.cards) { c.book = v.books.some((b) => b.id === c.book) ? c.book : 0; c.page ||= 0; c.serial ||= ''; }
        if (!v.books.some((b) => b.id === v.addTo)) v.addTo = 0;
        return v;
      }
    } catch {}
    return fresh();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} }
  const pat = (key, custom) => (key === 'custom' ? { custom } : key);
  // books: a pad of paper sheets (one colour, a page per sheet, a few cards per page); "Loose cards" (id 0) holds the rest
  const BOOK_COLORS = [['Blue', '#3a86ff'], ['Red', '#ef476f'], ['Green', '#06d6a0'], ['Yellow', '#ffd166'], ['Orange', '#fb8500'],
    ['Purple', '#8338ec'], ['Pink', '#ff70a6'], ['Grey', '#8d99ae']];
  const bookOf = (id) => st.books.find((b) => b.id === id) || st.books.find((b) => b.id === 0);
  const playing = (card) => card.on && bookOf(card.book).on;
  const cardLabel = (card) => card.name || (card.serial ? `#${card.serial}` : `Card ${st.cards.indexOf(card) + 1}`);
  const fullLabel = (card) => (card.book ? `${bookOf(card.book).name} · ${cardLabel(card)}` : cardLabel(card));
  let query = '', pending = null;  // the cards-list search; a scanned sheet still being checked
  const patName = (key) => PATTERNS.find(([k]) => k === key)?.[1] || key;

  // ---------- open / close

  function open(section, a) {
    host = section; api = a;
    st = load();
    host.textContent = '';
    const top = el('div', 'bgt-top');
    const back = el('button', 'ghost-btn', '← Back');
    back.onclick = () => api.back();
    top.append(back, el('h2', '', '🔵 Bingo tools'));
    const tabs = el('div', 'bgt-tabs');
    for (const [t, label] of [['cards', '📋 My paper cards'], ['caller', '🎙️ Be the caller']]) {
      const b = el('button', '', label);
      b.dataset.t = t;
      b.onclick = () => { st.tab = t; save(); paint(); };
      tabs.append(b);
    }
    const body = el('div', 'bgt-body');
    body.id = 'bgtBody';
    host.append(top, tabs, body);
    onKey = (e) => { if (e.key === 'Escape') closeOverlay(); };
    window.addEventListener('keydown', onKey);
    paint();
  }
  function close() {
    stopAuto();
    cancelAnimationFrame(raf); raf = 0;
    mach?.stop(); mach = null;
    if (onKey) window.removeEventListener('keydown', onKey);
    try { speechSynthesis?.cancel(); } catch {}
    host && (host.textContent = '');
  }

  function paint() {
    for (const b of host.querySelectorAll('.bgt-tabs button')) b.classList.toggle('on', b.dataset.t === st.tab);
    const body = host.querySelector('#bgtBody');
    body.textContent = '';
    mach?.stop(); mach = null;
    if (st.tab === 'caller') paintCaller(body); else { stopAuto(); paintCards(body); }
  }

  // ---------- shared pieces

  function patternPicker(cur, custom, onPick, onCustom) {
    const box = el('div', 'bgt-patterns');
    for (const [k, name] of PATTERNS) {
      const b = el('button', `bgt-pat${k === cur ? ' on' : ''}`);
      b.append(K.miniShape(k === 'custom' ? custom : PREVIEW[k] || K.SHAPES[k][1][0]), el('span', '', name));
      b.onclick = () => (k === 'custom' && cur === 'custom' ? onCustom() : onPick(k));
      box.append(b);
    }
    return box;
  }

  function customEditor(cells, done) {
    const on = new Set(cells);
    const panel = overlay('✏️ Draw your pattern');
    panel.append(el('p', 'muted', 'Tap squares to add them. A card wins when every square you pick is daubed.'));
    const g = el('div', 'bgt-draw');
    for (let i = 0; i < 25; i++) {
      const b = el('button', on.has(i) ? 'on' : '', i === 12 ? '★' : '');
      b.onclick = () => { on.has(i) ? on.delete(i) : on.add(i); b.classList.toggle('on', on.has(i)); };
      g.append(b);
    }
    const row = el('div', 'row bgt-row');
    const ok = el('button', 'primary', 'Use this pattern');
    ok.onclick = () => { if (!on.size) return api.toast('Pick at least one square.'); closeOverlay(); done([...on].sort((a, b) => a - b)); };
    const cancel = el('button', 'ghost-btn', 'Cancel');
    cancel.onclick = closeOverlay;
    row.append(ok, cancel);
    panel.append(g, row);
  }

  let overlayEl = null;
  function overlay(title, cls = '') {
    closeOverlay();
    overlayEl = el('div', `bgt-overlay ${cls}`);
    const panel = el('div', 'bgt-panel');
    if (title) panel.append(el('h3', '', title));
    overlayEl.append(panel);
    overlayEl.onclick = (e) => { if (e.target === overlayEl && !cls.includes('win') && !panel.classList.contains('scanning')) closeOverlay(); };  // a running scan has its own Cancel
    host.append(overlayEl);
    return panel;
  }
  function closeOverlay() { const bye = overlayEl?.onbye; overlayEl?.remove(); overlayEl = null; bye?.(); }

  /** A card picture: .bgo-card markup, daubed where called, with the win drawn on it. */
  function cardView(nums, called, { win = null, near = [], name = '', ink = '#ef476f', seed = 0 } = {}) {
    const c = el('div', `bgo-card bgt-card${win ? ' won' : ''}`);
    c.style.setProperty('--ink', ink);
    const head = el('div', 'bgo-head');
    [...L].forEach((ch, i) => { const h = el('b', '', ch); h.style.background = COLS[i]; head.append(h); });
    const grid = el('div', 'bgo-grid');
    const nr = new Set(near);
    nums.forEach((n, i) => {
      const d = i === 12 || called.has(n);
      const b = el('div', `bgo-cell${n ? '' : ' free'}${d && n ? ' d' : ''}${!d && nr.has(i) ? ' near' : ''}`);
      if (n) b.append(el('span', '', String(n))); else b.innerHTML = '<span>★<small>FREE</small></span>';
      if (d && n) b.insertAdjacentHTML('beforeend', K.splat(seed * 31 + i * 7 + 3, false));
      grid.append(b);
    });
    const svg = K.linesSvg();
    grid.append(svg);
    if (win) K.drawLines(svg, win.keys, { cells: win.keys.length ? [] : win.cells });
    if (name) c.append(el('div', 'bgt-card-name', name));
    c.append(head, grid);
    return c;
  }
  const daubsOf = (nums, called) => nums.map((n, i) => i === 12 || (n != null && called.has(n)));

  // ---------- the card editor (type, or fill from a scan)

  function editCard(card, done, { title = '⌨️ Type in a card', scan = true, okText = 'Save card', onCancel = null } = {}) {
    const nums = card ? card.nums.slice() : Array.from({ length: 25 }, (_, i) => (i === 12 ? 0 : null));
    const panel = overlay(title, 'tall');
    const name = el('input', 'bgt-name');
    name.placeholder = 'Name (e.g. Blue card 3)';
    name.maxLength = 24;
    name.value = card?.name || '';
    if (okText === 'Save card' || okText === 'Done') panel.append(name);
    panel.append(el('p', 'muted', 'Type each column top to bottom: B is 1–15, I 16–30, N 31–45, G 46–60, O 61–75.'));
    const head = el('div', 'bgo-head bgt-ed-head');
    [...L].forEach((ch, i) => { const h = el('b', '', ch); h.style.background = COLS[i]; head.append(h); });
    const grid = el('div', 'bgt-ed');
    const inputs = [];
    const order = [];  // column by column
    for (let c = 0; c < 5; c++) for (let r = 0; r < 5; r++) if (r * 5 + c !== 12) order.push(r * 5 + c);
    for (let i = 0; i < 25; i++) {
      if (i === 12) { grid.append(el('span', 'bgt-free', '★')); inputs.push(null); continue; }
      const inp = el('input');
      inp.inputMode = 'numeric'; inp.maxLength = 2; inp.autocomplete = 'off';
      inp.value = nums[i] ?? '';
      inp.oninput = () => {
        inp.value = inp.value.replace(/\D/g, '').slice(0, 2);
        nums[i] = inp.value ? +inp.value : null;
        check();
        const max = (i % 5) * 15 + 15, v = +inp.value;
        if (inp.value && (inp.value.length === 2 || v * 10 > max)) inputs[order[order.indexOf(i) + 1]]?.focus();  // can't take another digit
      };
      inputs.push(inp);
      grid.append(inp);
    }
    const msg = el('p', 'bgt-msg');
    function check() {
      const r = K.checkCard(nums);
      inputs.forEach((inp, i) => inp && inp.classList.toggle('bad', r.bad.has(i) || r.dup.has(i)));
      msg.textContent = r.bad.size ? `${r.bad.size} number${r.bad.size > 1 ? 's are' : ' is'} in the wrong column.` : r.dup.size ? 'A number appears twice.'
        : r.empty.length ? `${r.empty.length} square${r.empty.length > 1 ? 's' : ''} to fill.` : '✓ Looks right.';
      msg.className = `bgt-msg${r.bad.size || r.dup.size ? ' bad' : r.empty.length ? '' : ' ok'}`;
      return r;
    }
    check();
    const row = el('div', 'row bgt-row');
    const ok = el('button', 'primary', okText);
    ok.onclick = () => {
      const r = check();
      if (r.bad.size || r.dup.size || r.empty.length) return api.toast(msg.textContent);
      closeOverlay();
      done({ nums: nums.map((n) => n || 0), name: name.value.trim() });
    };
    row.append(ok);
    if (scan) {
      const sc = el('button', '', '📷 Scan');
      sc.onclick = () => scanInto((got) => {
        got.forEach((n, i) => { if (inputs[i]) { inputs[i].value = n ?? ''; nums[i] = n; } });
        check();
        const r = K.checkCard(nums);
        api.toast(r.empty.length || r.bad.size || r.dup.size ? '📷 Read it: check the red and empty squares.' : '📷 All 24 read. Check them against the card.');
      }, panel);
      row.append(sc);
    }
    const cancel = el('button', 'ghost-btn', 'Cancel');
    cancel.onclick = () => { closeOverlay(); onCancel?.(); };
    row.append(cancel);
    panel.append(head, grid, msg, row);
    setTimeout(() => inputs[order[0]]?.focus(), 50);
  }

  function scanInto(use, panel, multi = false, then = null) {
    const holder = el('div', 'bgt-scanhost');
    panel.append(holder);
    panel.classList.add('scanning');
    needUI('bingoscan').then(() => UI.bingoscan.scan(holder, { toast: api.toast, multi })).then((got) => {
      holder.remove();
      panel.classList.remove('scanning');
      if (got) use(got);
      then?.();
    }).catch(() => { holder.remove(); panel.classList.remove('scanning'); api.toast('The scanner did not load: type the card in.'); then?.(); });
  }

  // ---------- 📋 My paper cards

  function paintCards(body) {
    const called = new Set(st.calls);
    const pattern = pat(st.pattern, st.custom);
    // what wins
    const sec1 = el('section', 'bgt-sec');
    sec1.append(el('h3', '', `🏆 What wins: ${patName(st.pattern)}`));
    sec1.append(patternPicker(st.pattern, st.custom, (k) => { st.pattern = k; st.alerted = []; save(); paint(); },
      () => customEditor(st.custom, (cells) => { st.custom = cells; st.alerted = []; save(); paint(); })));
    // the calls
    const sec2 = el('section', 'bgt-sec');
    const lastN = st.calls[st.calls.length - 1];
    const head = el('div', 'bgt-callhead');
    head.append(lastN ? K.ballEl(lastN, 'big') : Object.assign(el('div', 'bgo-ball big empty'), { innerHTML: '<span>?</span>' }));
    const form = el('form', 'bgt-enter');
    const inp = el('input');
    inp.placeholder = 'Type a call: B12';
    inp.autocomplete = 'off'; inp.autocapitalize = 'characters';
    const add = el('button', 'primary', 'Add');
    form.append(inp, add);
    form.onsubmit = (e) => {
      e.preventDefault();
      const n = K.parseCall(inp.value);
      if (!n) return api.toast('Type a number from 1 to 75, like B12 or 52.');
      inp.value = '';
      toggleCall(n, true);
      setTimeout(() => host.querySelector('.bgt-enter input')?.focus(), 30);
    };
    const info = el('div', 'bgt-callinfo');
    info.append(el('b', '', `${st.calls.length} called`), form);
    head.append(info);
    sec2.append(el('h3', '', '🎱 What the caller called'), head);
    const pad = el('div', 'bgt-pad');
    for (let c = 0; c < 5; c++) {
      const row = el('div', 'bgt-padrow');
      const h = el('b', '', L[c]); h.style.background = COLS[c];
      row.append(h);
      for (let n = c * 15 + 1; n <= c * 15 + 15; n++) {
        const b = el('button', called.has(n) ? 'on' : '', String(n));
        if (n === lastN) b.classList.add('last');
        b.style.setProperty('--bc', COLS[c]);
        b.onclick = () => toggleCall(n);
        row.append(b);
      }
      pad.append(row);
    }
    const tools = el('div', 'row bgt-row');
    const undo = el('button', '', '↶ Undo last');
    undo.disabled = !st.calls.length;
    undo.onclick = () => { st.calls.pop(); save(); paint(); };
    const reset = el('button', '', '🔄 New game');
    reset.onclick = async () => { if (await api.ask('Clear the called numbers for a new game? Your cards stay.', { ok: 'New game' })) { st.calls = []; st.alerted = []; save(); paint(); } };
    tools.append(undo, reset);
    sec2.append(pad, tools);
    // my cards
    const sec3 = el('section', 'bgt-sec');
    const nPlay = st.cards.filter(playing).length;
    sec3.append(el('h3', '', `🎫 My cards (${st.cards.length > nPlay ? `${nPlay} playing of ${st.cards.length}` : st.cards.length})`));
    const hints = el('p', 'bgt-hints');
    const needs = [], hot = [];
    for (const card of st.cards) {
      if (!playing(card)) continue;
      const daub = daubsOf(card.nums, called);
      const win = K.wins(daub, pattern), near = win ? [] : K.oneToGo(daub, pattern);
      if (win || near.length) hot.push({ card, win, near });
      if (near.length) needs.push(`${fullLabel(card)} needs ${near.map((i) => K.name(card.nums[i])).join(' or ')}`);
    }
    hints.textContent = st.cards.length ? (needs.length ? `🔥 ${needs.slice(0, 3).join(' · ')}${needs.length > 3 ? ` · +${needs.length - 3} more` : ''}`
      : st.calls.length ? 'Keep tapping the calls…' : 'Tap the numbers as the caller calls them.') : 'Add your paper cards to start: type them, scan a whole sheet, or deal a random one.';
    sec3.append(hints);
    // 🔥 the cards that matter right now, whichever book they're in
    if (hot.length && st.cards.length > 4) {
      hot.sort((x, y) => !!y.win - !!x.win);
      const strip = el('div', 'bgt-hot');
      for (const h of hot.slice(0, 12)) strip.append(mini(h.card, called, pattern));
      sec3.append(el('b', 'bgt-sub', `🔥 One to go${hot.some((h) => h.win) ? ' & winners' : ''} (${hot.length})`), strip);
    }
    if (st.cards.length > 4) {
      const bar = el('div', 'bgt-findbar');
      const find = el('input');
      find.type = 'search'; find.placeholder = '🔍 Find a card: name, serial or book';
      find.value = query;
      find.oninput = () => { query = find.value; paintBooks(); };
      const small = isSmall();
      const vb = el('button', '', small ? '▦ Big cards' : '▪ Small cards');
      vb.title = 'Switch between full-size cards and a compact view for lots of cards';
      vb.onclick = () => { st.view = small ? 'big' : 'small'; save(); paint(); };
      bar.append(find, vb);
      sec3.append(bar);
    }
    const booksEl = el('div', 'bgt-books');
    booksEl.id = 'bgtBooks';
    sec3.append(booksEl);
    paintBooks(booksEl);
    // adding cards
    const addRow = el('div', 'row bgt-row bgt-addrow');
    if (pending) {
      const fin = el('button', 'primary', `↩︎ Finish checking ${pending.items.length} scanned card${pending.items.length > 1 ? 's' : ''}`);
      fin.onclick = () => reviewScan();
      addRow.append(fin);
    }
    const scn = el('button', 'primary', '📷 Scan cards');
    scn.title = 'One card, a whole sheet, or a whole book page after page (or pick a pile of photos)';
    scn.onclick = () => {
      const panel = overlay('📷 Scan cards', 'tall');
      scanInto((got) => { pending = { items: scanned(got), book: st.addTo || (got.length > 1 ? -1 : 0) }; reviewScan(); }, panel, true,
        () => { if (panel.isConnected) closeOverlay(); });
    };
    const typ = el('button', '', '⌨️ Type a card');
    typ.onclick = () => editCard(null, (v) => addCard(v));
    const rnd = el('button', '', '🎲 Random card');
    rnd.title = 'Deal a fresh random card (for a print-out, an app card or just to play along)';
    rnd.onclick = () => addCard({ nums: randomCard(), name: `Random card ${st.cards.filter((c) => /^Random card /.test(c.name || '')).length + 1}` });
    const nb = el('button', '', '📚 New book');
    nb.title = 'A book is a pad of sheets of one colour: keep its pages together and switch the whole book on or off';
    nb.onclick = () => editBook(null);
    addRow.append(scn, typ, rnd, nb);
    const to = el('label', 'bgt-addto');
    to.append('New cards go to ');
    const sel = bookSelect(st.addTo, (id) => { st.addTo = id; save(); });
    to.append(sel);
    sec3.append(addRow);
    if (st.books.length > 1) sec3.append(to);
    body.append(sec2, sec3, sec1);
  }

  const isSmall = () => (st.view === 'auto' ? st.cards.length > 6 : st.view === 'small');

  /** A <select> of the books (and "＋ New book…", which opens the book editor). */
  function bookSelect(cur, onPick, back = null) {
    const sel = el('select', 'bgt-booksel');
    for (const b of st.books) { const o = el('option', '', b.id ? `📒 ${b.name}` : `🗂️ ${b.name}`); o.value = b.id; o.selected = b.id === cur; sel.append(o); }
    const o = el('option', '', '＋ New book…'); o.value = 'new'; sel.append(o);
    sel.onchange = () => {
      if (sel.value !== 'new') return onPick(+sel.value);  // -1: the review's "a new book" choice
      sel.value = String(cur);
      editBook(null, (b) => onPick(b.id), back);
    };
    return sel;
  }

  /** The saved cards, book by book and page by page (or the search hits). */
  function paintBooks(box = host.querySelector('#bgtBooks')) {
    if (!box) return;
    box.textContent = '';
    const called = new Set(st.calls), pattern = pat(st.pattern, st.custom), small = isSmall();
    const render = (card) => (small ? mini(card, called, pattern) : bigCard(card, called, pattern));
    const q = query.trim().toLowerCase();
    if (q) {
      const hits = st.cards.filter((c) => `${cardLabel(c)} ${c.serial} ${bookOf(c.book).name}`.toLowerCase().includes(q.replace(/^#/, '')));
      const list = el('div', small ? 'bgt-page' : 'bgt-cards');
      hits.forEach((c) => list.append(render(c)));
      box.append(el('b', 'bgt-sub', hits.length ? `${hits.length} found` : 'No card matches that.'), list);
      return;
    }
    for (const book of st.books) {
      const cards = st.cards.filter((c) => c.book === book.id);
      if (!book.id && !cards.length) continue;
      const blk = el('div', `bgt-book${book.on ? '' : ' off'}`);
      blk.style.setProperty('--bk', book.color || '#8d99ae');
      const head = el('div', 'bgt-bookhead');
      const tog = el('button', 'bgt-bookname');
      const pages = new Set(cards.map((c) => c.page).filter(Boolean)).size;
      let warm = 0;
      if (book.on) for (const c of cards) if (c.on && K.oneToGo(daubsOf(c.nums, called), pattern).length) warm++;
      tog.append(el('span', 'bgt-chev', book.open ? '▾' : '▸'), el('b', '', book.name),
        el('small', '', `${cards.length} card${cards.length === 1 ? '' : 's'}${pages ? ` · ${pages} page${pages > 1 ? 's' : ''}` : ''}${warm ? ` · 🔥${warm}` : ''}`));
      tog.onclick = () => { book.open = !book.open; save(); paintBooks(); };
      const on = el('button', 'ghost-btn', book.on ? '⏸' : '▶');
      on.title = book.on ? 'Not playing this book this game' : 'Play this book';
      on.onclick = () => { book.on = !book.on; st.alerted = []; save(); paint(); };
      head.append(tog, on);
      if (book.id) { const ed = el('button', 'ghost-btn', '✎'); ed.title = 'Rename, colour, delete'; ed.onclick = () => editBook(book); head.append(ed); }
      blk.append(head);
      if (book.open) {
        if (!cards.length) blk.append(el('p', 'muted bgt-empty', 'No cards yet: 📷 scan a page into it.'));
        const byPage = new Map();
        for (const c of cards) { if (!byPage.has(c.page)) byPage.set(c.page, []); byPage.get(c.page).push(c); }
        const keys = [...byPage.keys()].sort((x, y) => (x || 1e9) - (y || 1e9));
        for (const pg of keys) {
          if (pg || pages) {
            const ph = el('div', 'bgt-pagehead');
            ph.append(el('span', '', pg ? `Page ${pg}` : 'More cards'));
            if (pg) {
              const del = el('button', 'ghost-btn', '🗑');
              del.title = 'Delete this page';
              del.onclick = async () => {
                if (!(await api.ask(`Delete page ${pg} of ${book.name} (${byPage.get(pg).length} cards)?`, { ok: 'Delete', danger: true }))) return;
                st.cards = st.cards.filter((c) => !(c.book === book.id && c.page === pg)); save(); paint();
              };
              ph.append(del);
            }
            blk.append(ph);
          }
          const grid = el('div', small ? 'bgt-page' : 'bgt-cards');
          byPage.get(pg).forEach((c) => grid.append(render(c)));
          blk.append(grid);
        }
      }
      box.append(blk);
    }
  }

  /** A small card for long lists: a 5×5 of numbers, daubed, with the squares one away (or the win) lit. Tap → details. */
  function mini(card, called, pattern) {
    const live = playing(card), daub = daubsOf(card.nums, called);
    const win = live ? K.wins(daub, pattern) : null, near = new Set(live && !win ? K.oneToGo(daub, pattern) : []);
    const wc = new Set(win?.cells || []);
    const b = el('button', `bgt-mini${live ? '' : ' off'}${win ? ' won' : near.size ? ' warm' : ''}`);
    b.style.setProperty('--bk', bookOf(card.book).color || '#8d99ae');
    b.title = fullLabel(card);
    b.append(el('span', 'mn', `${win ? '🎉 ' : near.size ? '🔥 ' : ''}${cardLabel(card)}`));
    const g = el('span', 'mg');
    card.nums.forEach((n, i) => g.append(el('i', i === 12 ? 'f' : wc.has(i) ? 'w' : daub[i] ? 'd' : near.has(i) ? 'n' : '', i === 12 ? '★' : String(n))));
    b.append(g);
    b.onclick = () => cardDetail(card);
    return b;
  }

  function bigCard(card, called, pattern) {
    const live = playing(card), daub = daubsOf(card.nums, called);
    const win = live ? K.wins(daub, pattern) : null, near = live && !win ? K.oneToGo(daub, pattern) : [];
    const wrap = el('div', `bgt-cardwrap${live ? '' : ' off'}`);
    wrap.append(cardView(card.nums, called, { win, near, name: `${win ? '🎉 ' : ''}${cardLabel(card)}`, seed: card.id }));
    const row = el('div', 'bgt-cardbtns');
    const mk = (txt, tip, fn) => { const b = el('button', 'ghost-btn', txt); b.title = tip; b.onclick = fn; row.append(b); };
    mk(card.on ? '⏸' : '▶', card.on ? 'Not playing this card this game' : 'Play this card', () => { card.on = !card.on; save(); paint(); });
    mk('✎', 'Fix numbers, rename, move to a book', () => cardDetail(card));
    mk('🗑', 'Delete', () => deleteCard(card));
    wrap.append(row);
    return wrap;
  }

  async function deleteCard(card) {
    closeOverlay();
    if (!(await api.ask(`Delete ${fullLabel(card)}?`, { ok: 'Delete', danger: true }))) return;
    st.cards = st.cards.filter((c) => c !== card); save(); paint();
  }

  /** One saved card, big, with everything you can do to it. */
  function cardDetail(card) {
    const called = new Set(st.calls), pattern = pat(st.pattern, st.custom), daub = daubsOf(card.nums, called);
    const live = playing(card), win = live ? K.wins(daub, pattern) : null;
    const panel = overlay(`${win ? '🎉 ' : ''}${fullLabel(card)}`);
    const near = live && !win ? K.oneToGo(daub, pattern) : [];
    panel.append(cardView(card.nums, called, { win, near, seed: card.id }));
    const left = card.nums.filter((n, i) => i !== 12 && !called.has(n)).length;
    panel.append(el('p', 'muted', `${card.serial ? `Serial ${card.serial} · ` : ''}${card.page ? `page ${card.page} · ` : ''}${24 - left} of 24 daubed${near.length ? ` · needs ${near.map((i) => K.name(card.nums[i])).join(' or ')}` : ''}`));
    const mv = el('label', 'bgt-addto');
    mv.append('Book ');
    mv.append(bookSelect(card.book, (id) => { if (id !== card.book) { card.book = id; card.page = 0; save(); paint(); } cardDetail(card); }, () => cardDetail(card)));
    panel.append(mv);
    const row = el('div', 'row bgt-row');
    const tg = el('button', '', card.on ? '⏸ Sit out' : '▶ Play');
    tg.onclick = () => { card.on = !card.on; save(); paint(); cardDetail(card); };
    const ed = el('button', '', '✎ Fix / rename');
    ed.onclick = () => editCard(card, (v) => { card.nums = v.nums; card.name = v.name; st.alerted = []; save(); paint(); }, { title: '✎ Edit card' });
    const del = el('button', 'ghost-btn', '🗑 Delete');
    del.onclick = () => deleteCard(card);
    const ok = el('button', 'primary', 'Close');
    ok.onclick = closeOverlay;
    row.append(ok, tg, ed, del);
    panel.append(row);
  }

  /** New book (book = null) or edit one: name, colour, play only this one, delete. */
  function editBook(book, done, back = null) {
    const panel = overlay(book ? `✎ ${book.name}` : '📚 New book');
    const used = new Set(st.books.map((b) => b.color));
    let color = book?.color || (BOOK_COLORS.find(([, c]) => !used.has(c)) || BOOK_COLORS[0])[1];
    const name = el('input', 'bgt-name');
    name.maxLength = 24;
    name.placeholder = 'Name (e.g. Blue book, Game 3)';
    name.value = book?.name || `${BOOK_COLORS.find(([, c]) => c === color)?.[0] || 'New'} book`;
    const sw = el('div', 'bgt-swatches');
    for (const [nm, c] of BOOK_COLORS) {
      const b = el('button', c === color ? 'on' : '');
      b.title = nm; b.style.background = c;
      b.onclick = () => {
        const auto = !book && /^\w+ book$/.test(name.value);
        color = c;
        if (auto) name.value = `${nm} book`;
        for (const x of sw.children) x.classList.toggle('on', x === b);
      };
      sw.append(b);
    }
    panel.append(el('p', 'muted', 'A book is a pad of paper sheets. Its colour tags its cards, and you can switch the whole book on or off.'), name, sw);
    const row = el('div', 'row bgt-row');
    const ok = el('button', 'primary', book ? 'Save' : 'Make book');
    ok.onclick = () => {
      const nm = name.value.trim() || 'Book';
      let b = book;
      if (b) Object.assign(b, { name: nm, color });
      else { b = { id: st.nextBook++, name: nm, color, on: true, open: true }; st.books.push(b); st.addTo = b.id; }
      save(); closeOverlay(); paint();
      done?.(b);
    };
    row.append(ok);
    if (book) {
      const only = el('button', '', '▶ Play only this book');
      only.onclick = () => { for (const b of st.books) b.on = b === book; st.alerted = []; save(); closeOverlay(); paint(); };
      const del = el('button', 'ghost-btn', '🗑 Delete book');
      del.onclick = async () => {
        const n = st.cards.filter((c) => c.book === book.id).length;
        closeOverlay();
        if (!(await api.ask(n ? `Delete ${book.name} and its ${n} card${n > 1 ? 's' : ''}?` : `Delete ${book.name}?`, { ok: 'Delete', danger: true }))) return;
        st.cards = st.cards.filter((c) => c.book !== book.id);
        st.books = st.books.filter((b) => b !== book);
        if (st.addTo === book.id) st.addTo = 0;
        save(); paint();
      };
      row.append(only, del);
    }
    const cancel = el('button', 'ghost-btn', 'Cancel');
    cancel.onclick = () => (back ? back() : closeOverlay());
    row.append(cancel);
    panel.append(row);
    setTimeout(() => name.focus(), 50);
  }

  /** The scanner's cards → review items, numbering their sheets on from `after` (a later batch's pages follow). */
  const scanned = (got, after = 0) => got.map((g) => ({ nums: g.nums.map((n) => n ?? null), serial: g.serial || '', name: '', sheet: after + (g.sheet || 1) }));
  const numsKey = (nums) => nums.map((n) => n || 0).join(',');

  /** After a scan: every card read, flagged where it needs a look, saved together as the next page(s) of a book. */
  function reviewScan() {
    if (!pending) return;
    const P = pending, items = P.items;
    const panel = overlay(`✓ Check ${items.length} card${items.length > 1 ? 's' : ''}`, 'tall');
    overlayEl.onbye = () => paint();  // dismissed: the "finish checking" button shows up in the list
    // the same card twice (a page shot twice, or one already saved): flagged, and left out unless fixed
    const saved = new Map(st.cards.map((c) => [numsKey(c.nums), c]));
    const twin = new Map(), seen = new Map();
    for (const it of items) {
      if (!K.checkCard(it.nums).empty.length) {
        const key = numsKey(it.nums);
        if (saved.has(key)) twin.set(it, `already saved as ${fullLabel(saved.get(key))}`);
        else if (seen.has(key)) twin.set(it, `same as card ${items.indexOf(seen.get(key)) + 1}`);
        else seen.set(key, it);
      }
    }
    const good = (it) => { const r = K.checkCard(it.nums); return !r.bad.size && !r.dup.size && !r.empty.length && !twin.has(it); };
    const nBad = items.filter((it) => !good(it)).length;
    panel.append(el('p', 'muted', nBad ? `${nBad} need${nBad === 1 ? 's' : ''} a look (⚠): tap ✎ and check them against the paper, or ✕ a repeat.` : 'All read. Give them a quick look against the paper, then save.'));
    // the sheets, renumbered 1, 2, … in order (a page whose cards were all dropped leaves no gap)
    const sheets = [...new Set(items.map((it) => it.sheet || 1))].sort((a, b) => a - b);
    const nth = (it) => sheets.indexOf(it.sheet || 1);
    const pageNo = P.book === -1 ? 1 : 1 + Math.max(0, ...st.cards.filter((c) => c.book === P.book).map((c) => c.page || 0));
    const list = el('div', 'bgt-review');
    items.forEach((it, k) => {
      if (sheets.length > 1 && (!k || nth(items[k - 1]) !== nth(it))) {
        const n = items.filter((x) => nth(x) === nth(it)).length;
        list.append(el('h4', 'bgt-revpage', `📄 Page ${pageNo + nth(it)} · ${n} card${n > 1 ? 's' : ''}`));
      }
      const r = K.checkCard(it.nums), ok = good(it);
      const rowEl = el('div', `bgt-revrow${ok ? '' : ' bad'}`);
      const g = el('span', 'mg');
      it.nums.forEach((n, i) => g.append(el('i', i === 12 ? 'f' : r.bad.has(i) || r.dup.has(i) || n == null ? 'x' : '', i === 12 ? '★' : n == null ? '?' : String(n))));
      const pv = el('div', 'bgt-mini still');
      pv.style.setProperty('--bk', '#4cc9f0');
      pv.append(g);
      const info = el('div', 'bgt-revinfo');
      const nm = el('input');
      nm.maxLength = 24;
      nm.placeholder = it.serial ? `#${it.serial}` : `Card ${k + 1}`;
      nm.value = it.name;
      nm.oninput = () => { it.name = nm.value; };
      const ser = el('input', 'bgt-serial');
      ser.maxLength = 8; ser.inputMode = 'numeric';
      ser.placeholder = 'Serial';
      ser.value = it.serial;
      ser.oninput = () => { it.serial = ser.value.replace(/\D/g, ''); nm.placeholder = it.serial ? `#${it.serial}` : `Card ${k + 1}`; };
      const st2 = el('small', ok ? 'okc' : 'badc', ok ? '✓ 24 read' : `⚠ ${[r.empty.length && `${r.empty.length} unread`, r.bad.size && `${r.bad.size} wrong column`, r.dup.size && 'a number twice', twin.get(it)].filter(Boolean).join(', ')}`);
      const btns = el('div', 'bgt-cardbtns');
      const fx = el('button', ok ? 'ghost-btn' : 'primary', '✎');
      fx.title = 'Fix this card';
      fx.onclick = () => editCard({ nums: it.nums, name: it.name }, (v) => { it.nums = v.nums; it.name = v.name; reviewScan(); },
        { title: `✎ Card ${k + 1}${it.serial ? ` (#${it.serial})` : ''}`, scan: false, okText: 'Done', onCancel: reviewScan });
      const dr = el('button', 'ghost-btn', '✕');
      dr.title = 'Leave this card out';
      dr.onclick = () => { items.splice(k, 1); if (!items.length) { pending = null; closeOverlay(); paint(); } else reviewScan(); };
      btns.append(fx, dr);
      const line = el('div', 'bgt-revline');
      line.append(nm, ser);
      info.append(el('b', '', `Card ${k + 1}`), line, st2, btns);
      rowEl.append(pv, info);
      list.append(rowEl);
    });
    panel.append(list);
    const to = el('label', 'bgt-addto');
    to.append('Save to ');
    if (P.book !== -1 && !st.books.some((b) => b.id === P.book)) P.book = 0;
    // a whole sheet with nowhere picked yet: offer a fresh book (made on save) rather than the loose pile
    const used = new Set(st.books.map((b) => b.color));
    const [freshName, freshColor] = BOOK_COLORS.find(([, c]) => !used.has(c)) || BOOK_COLORS[0];
    const bs = bookSelect(P.book, (id) => { P.book = id; reviewScan(); }, reviewScan);
    const fo = el('option', '', `📒 A new ${freshName.toLowerCase()} book`);
    fo.value = '-1'; fo.selected = P.book === -1;
    bs.insertBefore(fo, bs.lastChild);
    to.append(bs);
    to.append(sheets.length > 1 ? ` as pages ${pageNo}–${pageNo + sheets.length - 1}` : ` as page ${pageNo}`);
    panel.append(to);
    const row = el('div', 'row bgt-row');
    const more = el('button', '', '＋ Scan more pages');
    more.title = 'Scan the next pages of this book: they join this check list';
    more.onclick = () => {
      const pn = overlay('📷 Scan more pages', 'tall');
      overlayEl.onbye = () => paint();
      const top = Math.max(0, ...items.map((it) => it.sheet || 1));
      scanInto((got) => { items.push(...scanned(got, top)); }, pn, true, () => reviewScan());
    };
    const sv = el('button', 'primary', `💾 Save ${items.length} card${items.length > 1 ? 's' : ''}`);
    sv.onclick = async () => {
      const keep = items.filter(good);
      if (keep.length < items.length) {
        closeOverlay();
        const ok = keep.length && (await api.ask(`${items.length - keep.length} card${items.length - keep.length > 1 ? 's still need' : ' still needs'} fixing (or ${items.length - keep.length > 1 ? 'are repeats' : 'is a repeat'}). Save the ${keep.length} good one${keep.length > 1 ? 's' : ''} now and drop the rest?`, { ok: 'Save the good ones', cancel: 'Keep fixing' }));
        if (!ok) { if (!keep.length) api.toast('Fix the cards marked ⚠ first.'); return reviewScan(); }
      }
      if (P.book === -1) {
        const nb = { id: st.nextBook++, name: `${freshName} book`, color: freshColor, on: true, open: true };
        st.books.push(nb);
        P.book = nb.id;
      }
      const kept = [...new Set(keep.map((it) => it.sheet || 1))].sort((a, b) => a - b);
      for (const it of keep) st.cards.push({ id: st.nextId++, name: it.name.trim(), nums: it.nums.map((n) => n || 0), on: true, book: P.book, page: pageNo + kept.indexOf(it.sheet || 1), serial: it.serial });
      const b = bookOf(P.book);
      b.open = true;
      st.addTo = P.book;
      pending = null;
      save(); closeOverlay(); paint();
      api.sfx('deal');
      api.toast(`💾 ${keep.length} card${keep.length > 1 ? 's' : ''} saved to ${b.name}${kept.length > 1 ? `, pages ${pageNo}–${pageNo + kept.length - 1}` : keep.length > 1 ? `, page ${pageNo}` : ''}.`);
    };
    const later = el('button', 'ghost-btn', 'Later');
    later.title = 'Keep these scanned cards and finish checking them later';
    later.onclick = () => { closeOverlay(); paint(); };
    const drop = el('button', 'ghost-btn', 'Discard');
    drop.onclick = () => { pending = null; closeOverlay(); paint(); };
    row.append(sv, more, later, drop);
    panel.append(row);
  }

  /** A legal 75-ball card: column c draws 5 distinct numbers from 15c+1..15c+15, free centre (0). Row-major. */
  function randomCard() {
    const nums = Array(25).fill(0);
    for (let c = 0; c < 5; c++) {
      const pool = Array.from({ length: 15 }, (_, i) => c * 15 + i + 1);
      for (let r = 0; r < 5; r++) {
        if (r === 2 && c === 2) continue;
        nums[r * 5 + c] = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      }
    }
    return nums;
  }

  function addCard(v) {
    st.cards.push({ id: st.nextId++, name: v.name, nums: v.nums, on: true, book: bookOf(st.addTo).id, page: 0, serial: '' });
    bookOf(st.addTo).open = true;
    save(); paint();
    api.sfx('deal');
  }

  function toggleCall(n, onlyAdd = false) {
    const i = st.calls.indexOf(n);
    if (i >= 0) { if (onlyAdd) return api.toast(`${K.name(n)} is already marked.`); st.calls.splice(i, 1); }
    else { st.calls.push(n); api.sfx('pop'); }
    save();
    paint();
    if (i < 0) checkWins();
  }

  function checkWins() {
    const called = new Set(st.calls), pattern = pat(st.pattern, st.custom);
    st.cards.forEach((card, idx) => {
      if (!playing(card)) return;
      const w = K.wins(daubsOf(card.nums, called), pattern);
      if (!w) return;
      const sig = `${card.id}:${st.pattern}:${w.cells.join('.')}`;
      if (st.alerted.includes(sig)) return;
      st.alerted.push(sig);
      save();
      winScreen(card, idx, w, called);
    });
  }

  function winScreen(card, idx, w, called) {
    const panel = overlay('', 'win');
    const word = el('div', 'bgo-word bgt-word');
    panel.append(word);
    K.wordPop(word, { top: patName(st.pattern) });
    word.classList.add('stay');
    panel.append(el('h2', '', `${fullLabel(card)}: shout it!`));
    panel.append(cardView(card.nums, called, { win: w, seed: card.id }));
    const last = st.calls[st.calls.length - 1];
    panel.append(el('p', 'muted', `Won on ${K.name(last)} · ${st.calls.length} calls. Read your numbers out to the caller.`));
    const ok = el('button', 'primary big', '👍 Got it');
    ok.onclick = closeOverlay;
    panel.append(ok);
    api.sfx('fanfare');
    api.confetti();
    try { navigator.vibrate?.([200, 100, 200, 100, 400]); } catch {}
  }

  // ---------- 🎙️ Be the caller

  function paintCaller(body) {
    const C = st.caller;
    const called = new Set(C.called);
    const lastN = C.called[C.called.length - 1];
    const top = el('div', 'bgt-callertop');
    const mbox = el('div', 'bgo-machine bgt-machine');
    const cv = el('canvas');
    mbox.append(cv);
    const big = el('div', 'bgt-bigball');
    big.append(lastN ? K.ballEl(lastN, 'big') : Object.assign(el('div', 'bgo-ball big empty'), { innerHTML: '<span>?</span>' }));
    const rail = el('div', 'bgo-rail');
    for (let i = Math.max(0, C.called.length - 6); i < C.called.length - 1; i++) rail.prepend(K.ballEl(C.called[i]));
    const callBtn = el('button', 'bgo-btn bgt-callbtn', C.called.length >= 75 ? 'All 75 called' : '🎱 Call a ball');
    callBtn.disabled = C.called.length >= 75;
    callBtn.onclick = () => callBall();
    const side = el('div', 'bgt-callside');
    side.append(big, el('b', 'bgt-count', `${C.called.length} / 75 called`), rail);
    top.append(mbox, side);
    const ctl = el('div', 'bgt-ctl');
    const auto = el('select');
    for (const [v, t] of [[0, '👆 Call by tapping'], [5, '⏱️ Auto every 5 s'], [8, '⏱️ Auto every 8 s'], [12, '⏱️ Auto every 12 s'], [20, '⏱️ Auto every 20 s']]) {
      const o = el('option', '', t); o.value = v; if (+C.auto === v) o.selected = true; auto.append(o);
    }
    auto.onchange = () => { C.auto = +auto.value; save(); startAuto(); paint(); };
    const pause = el('button', '', autoT ? '⏸ Pause' : '▶ Start');
    pause.hidden = !C.auto;
    pause.onclick = () => { autoT ? stopAuto() : startAuto(true); paint(); };
    const voice = el('button', C.voice ? 'on' : '', C.voice ? '🔊 Voice on' : '🔇 Voice off');
    voice.hidden = !('speechSynthesis' in window);
    voice.onclick = () => { C.voice = !C.voice; save(); if (C.voice && lastN) say(lastN); paint(); };
    const undo = el('button', '', '↶ Undo');
    undo.disabled = !C.called.length;
    undo.onclick = () => { C.called.pop(); save(); paint(); };
    const reset = el('button', '', '🔄 New game');
    reset.onclick = async () => { if (await api.ask('Start a new game? All the balls go back in.', { ok: 'New game' })) { stopAuto(); C.called = []; save(); paint(); } };
    const proj = el('button', '', '📺 Big screen');
    proj.onclick = () => {
      host.classList.toggle('bgt-projector');
      try { if (host.classList.contains('bgt-projector')) host.requestFullscreen?.(); else document.exitFullscreen?.(); } catch {}
    };
    ctl.append(callBtn, auto, pause, voice, undo, reset, proj);
    const board = el('div', 'bgo-board bgt-board');
    for (let c = 0; c < 5; c++) {
      const row = el('div', 'bgo-brow');
      const h = el('b', '', L[c]); h.style.background = COLS[c];
      row.append(h);
      for (let n = c * 15 + 1; n <= c * 15 + 15; n++) row.append(el('span', called.has(n) ? `on${n === lastN ? ' last' : ''}` : '', String(n)));
      board.append(row);
    }
    const chk = el('section', 'bgt-sec');
    chk.append(el('h3', '', `✅ Check a claim: ${patName(C.pattern)}`));
    chk.append(patternPicker(C.pattern, st.custom, (k) => { C.pattern = k; save(); paint(); },
      () => customEditor(st.custom, (cells) => { st.custom = cells; save(); paint(); })));
    const cb = el('button', 'primary', '🔍 Check a card');
    cb.onclick = () => editCard(null, (v) => {
      const w = K.wins(daubsOf(v.nums, called), pat(C.pattern, st.custom));
      const panel = overlay(w ? '✅ It\'s a BINGO!' : '❌ Not yet', w ? 'win' : '');
      const missing = v.nums.filter((n, i) => n && i !== 12 && !called.has(n));
      panel.append(cardView(v.nums, called, { win: w, near: w ? [] : K.oneToGo(daubsOf(v.nums, called), pat(C.pattern, st.custom)) }));
      panel.append(el('p', 'muted', w ? `${patName(C.pattern)} complete with ${C.called.length} balls called.` : `Not called yet: ${missing.slice(0, 10).map(K.name).join(', ')}${missing.length > 10 ? '…' : ''}`));
      const ok = el('button', 'primary', 'OK');
      ok.onclick = closeOverlay;
      panel.append(ok);
      if (w) { api.sfx('fanfare'); api.confetti(); } else api.sfx('wrong');
    }, { title: '🔍 Type the claimed card', okText: 'Check it' });
    chk.append(cb);
    body.append(top, ctl, board, chk);
    mach = K.machine(cv, mbox, {});
    kick();
    if (C.auto && !autoT && C.called.length && C.called.length < 75) pause.textContent = '▶ Resume';
  }

  function callBall() {
    const C = st.caller;
    const left = [];
    for (let n = 1; n <= 75; n++) if (!C.called.includes(n)) left.push(n);
    if (!left.length) { stopAuto(); return; }
    const r = new Uint32Array(1);
    (window.crypto?.getRandomValues ? crypto.getRandomValues(r) : (r[0] = Math.random() * 2 ** 32));
    const n = left[r[0] % left.length];
    C.called.push(n);
    save();
    api.sfx('drop');
    if (C.voice) say(n);
    paint();
    mach?.launch(n, false);
    const big = host.querySelector('.bgt-bigball .bgo-ball');
    if (big && motion()) big.classList.add('slam');
    if (C.called.length >= 75) stopAuto();
  }

  function say(n) {
    try {
      const d = String(n).split('').join(' ');
      const u = new SpeechSynthesisUtterance(n > 9 ? `${K.letter(n)}. ${d}. ${n}` : `${K.letter(n)}. ${n}`);
      u.rate = 0.9;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {}
  }

  function startAuto(now = false) {
    stopAuto();
    const s = +st.caller.auto;
    if (!s) return;
    autoT = setInterval(() => { if (st.tab === 'caller' && host?.isConnected) callBall(); else stopAuto(); }, s * 1000);
    if (now) callBall();
  }
  function stopAuto() { clearInterval(autoT); autoT = 0; }

  function kick() { if (!raf && motion()) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function frame(t) {
    raf = 0;
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016); last = t;
    if (!mach || !host?.isConnected) return;
    mach.frame(dt);
    raf = requestAnimationFrame(frame);
  }

  return { open, close };
})();
