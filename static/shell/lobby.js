// the game picker (lobby, home-screen sheet, game-over "More games…"), the lobby and its scoreboard.
// Part of the shell, split out of app.js: a plain script loaded before app.js, sharing its globals
// (S, $, el, act, prefs, …), which exist by the time anything here is called.
// ---------- the game picker (#67, #98), shared by the lobby, the home screen's sheet and the game-over "More games…"
const PICKER_SORTS = [['type', '📂 Type'], ['az', '🔤 A–Z'], ['recent', '🕘 Recent'], ['most', '🔥 Most played'], ['untried', '✨ Untried']];
let familyOrder = {};  // category -> its families in order, from /api/games
let catalog = null;    // the slim catalogue, for screens without a room (the home screen)
function loadCatalog() {
  if (catalog) return Promise.resolve(catalog);
  return fetch('/api/games').then((r) => r.json()).then((d) => { familyOrder = d.families || {}; return (catalog = d.games); });
}
const playersText = (g) => (g.min === g.max ? `${g.min} players` : `${g.min}–${g.max} players`);
// what kind of game a tile is, from its category (#189): card games sit on a playing card, dice games on a die,
// word games on a letter tile (style.css .game-tile[data-cat]); the name is read out for screen readers
const TILE_KINDS = { cards: 'card game', dice: 'dice game', words: 'word game' };
// one game tile: icon, name, players (or why it doesn't fit), this device's ★ stars or a "new" tag
function gameTile(g, seated, current, newTags = Profile.showNew()) {
  const fit = !seated ? '' : seated < g.min ? `needs ${g.min}+` : seated > g.max ? `max ${g.max}` : '';
  const b = el('button', 'game-tile' + (g.id === current ? ' on' : '') + (fit ? ' nofit' : ''));
  if (g.category) b.dataset.cat = g.category;  // the tint and icon shape follow the game, in every group and sort
  // a long single word (Safecracker) gets a slightly smaller name on phones instead of breaking mid-word (#191)
  b.append(el('span', 'gicon', g.icon), el('b', /[^\s-]{9,}/.test(g.name) ? 'long' : '', g.name), el('small', '', fit || playersText(g)));
  if (TILE_KINDS[g.category]) b.append(el('span', 'sr-only', TILE_KINDS[g.category]));
  const st = Profile.stars(g.id);
  if (st) b.append(el('span', 'tile-stars', Profile.starText(st)));
  else if (newTags && !Profile.tried(g.id)) b.append(el('span', 'tile-new', 'new'));
  const personalBest = Profile.bestLabel(g.id);
  if (personalBest) b.append(el('small', 'tile-best', `Best ${personalBest}`));
  b.setAttribute('aria-pressed', g.id === current);
  b.dataset.game = g.id;
  return b;
}
// 🙈 games this device keeps out of the lists (the picker, the game-over suggestions). Searching still finds
// them, the current game stays in place (dimmed), and the picker's "🙈 N hidden" row shows or restores them.
const hiddenGames = () => load('hiddenGames') || [];
const isHidden = (id) => hiddenGames().includes(id);
function toggleHidden(id) {
  const h = hiddenGames(), next = h.includes(id) ? h.filter((g) => g !== id) : [...h, id];
  store('hiddenGames', next.length ? next : null);
}
let showHidden = false;  // the picker's hidden group is open (this visit only)
// the sort chips, and (sorted by type) a row of category chips that jump to their group
function renderPickerBar(bar, pick, redraw) {
  const sort = load('pickerSort') || 'type';
  bar.innerHTML = '';
  const sorts = el('div', 'picker-sorts');
  sorts.setAttribute('role', 'group'); sorts.setAttribute('aria-label', 'Sort the games');
  for (const [key, label] of PICKER_SORTS) {
    const c = el('button', 'chip-btn', label);
    c.setAttribute('aria-pressed', key === sort);
    c.onclick = () => { store('pickerSort', key === 'type' ? null : key); redraw(); };
    sorts.append(c);
  }
  // tiles or a one-per-line list (#315), remembered on this device
  const list = el('button', 'chip-btn', '☰ List');
  list.title = 'Show the games as a list instead of tiles';
  list.setAttribute('aria-pressed', load('pickerView') === 'list');
  list.onclick = () => { store('pickerView', load('pickerView') === 'list' ? null : 'list'); redraw(); };
  sorts.prepend(list);
  bar.append(sorts);
  if (sort !== 'type' || load('pickerKind')) return;  // only card games showing (#189): nothing to jump between
  const jump = el('div', 'picker-jump');
  for (const [cat, label] of CATEGORIES) {
    const c = el('button', 'chip-btn', label.split(' ')[0]);
    c.title = c.ariaLabel = 'Jump to ' + label.replace(/^\S+ /, '');
    c.onclick = () => pick.querySelector(`.picker-cat[data-cat="${cat}"]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    jump.append(c);
  }
  bar.append(jump);
}
// the 💬 chip shows only the games you haven't left feedback on yet
function feedbackChip(btn) {
  const on = !!load('pickerFeedback');
  btn.textContent = '💬 Needs feedback'; btn.setAttribute('aria-pressed', on);
}
const toggleFeedback = () => store('pickerFeedback', load('pickerFeedback') ? null : 'none');
// fills `pick` with the games in groups; tile(b, g) wires each tile (clicks, wishes)
function renderPickerGrid(pick, opts) {
  let { games, seated = 0, current = null, query = '', onlyFits = false, kind = load('pickerKind'), tile, redraw } = opts;
  redraw ||= () => renderPickerGrid(pick, opts);
  pick.innerHTML = '';
  pick.classList.toggle('as-list', load('pickerView') === 'list');
  query = query.trim().toLowerCase();
  const hidden = hiddenGames();
  // 🙈 hidden games leave every group, unless you're searching or it's the game picked right now
  const hide = (g) => hidden.includes(g.id) && !query && g.id !== current;
  const sort = load('pickerSort') || 'type';
  const fits = (g) => !seated || (seated >= g.min && seated <= g.max);
  const fed = load('feedbackGames') || [], fedFilter = load('pickerFeedback');  // 'given' | 'none' | null
  const shown = games.filter((g) => !hide(g) && (!query || g.name.toLowerCase().includes(query) || g.category.includes(query) || (g.family || '').toLowerCase().includes(query))
    && (!onlyFits || fits(g) || g.id === current) && (!kind || g.category === kind || g.id === current)
    && (!fedFilter || !fed.includes(g.id) || g.id === current));
  const byId = (ids) => ids.map((id) => shown.find((g) => g.id === id)).filter(Boolean);
  const newTags = Profile.showNew();
  const groups = [];  // [label, games, category, sub-header?]
  if (sort === 'type') {
    if (!query) groups.push(['⭐ Favourites', byId(load('favGames') || [])], ['🕘 Played lately', byId(load('recentGames') || [])]);
    for (const [cat, label] of CATEGORIES) {
      const list = shown.filter((g) => g.category === cat);
      const fams = [...new Set([...(familyOrder[cat] || []), ...list.map((g) => g.family).filter(Boolean)])];
      if (!fams.length || query) { groups.push([label, list, cat]); continue; }
      groups.push([label, [], cat]);  // the category's header, then a small one per family
      for (const f of fams) groups.push([f, list.filter((g) => g.family === f), cat, true]);
      groups.push(['Other', list.filter((g) => !g.family), cat, true]);
    }
  } else {
    const recent = load('recentGames') || [];
    const key = {
      az: (a, b) => a.name.localeCompare(b.name),
      recent: (a, b) => ((recent.indexOf(a.id) + 1 || 99) - (recent.indexOf(b.id) + 1 || 99))
        || Profile.lastAt(b.id).localeCompare(Profile.lastAt(a.id)) || a.name.localeCompare(b.name),
      most: (a, b) => Profile.played(b.id) - Profile.played(a.id) || a.name.localeCompare(b.name),
      untried: (a, b) => Profile.tried(a.id) - Profile.tried(b.id) || Profile.stars(a.id) - Profile.stars(b.id) || a.name.localeCompare(b.name),
    }[sort] || ((a, b) => a.name.localeCompare(b.name));
    groups.push([`${PICKER_SORTS.find(([k]) => k === sort)?.[1] || ''} · ${shown.length} games`, [...shown].sort(key), '', false, true]);
  }
  const hiddenList = games.filter(hide);
  if (showHidden && hiddenList.length) groups.push([`🙈 Hidden · ${hiddenList.length}`, hiddenList, '', false, true]);
  if (!shown.length) pick.append(el('p', 'hint', fedFilter ? 'No games needing feedback match the active filters.' : query ? `No game matches “${query}”.` : kind ? `No ${TILE_KINDS[kind] || kind} fits this many players.` : 'No game fits this many players.'));
  for (const [label, list, cat, sub, flat] of groups) {
    // games that fit the players here come first in each group (a flat sort keeps its own order)
    const gs = flat ? list : [...list].sort((a, b) => fits(b) - fits(a));
    if (!gs.length && !(cat && !sub && groups.some(([, l, c, s]) => s && c === cat && l.length))) continue;
    const head = el('div', sub ? 'picker-cat picker-sub' : 'picker-cat', label);
    if (cat && !sub) head.dataset.cat = cat;
    pick.append(head);
    if (!gs.length) continue;
    const group = el('div', 'picker-group');
    group.dataset.count = gs.length;
    group.dataset.cat = cat || '';
    pick.append(group);
    for (const g of gs) {
      const b = gameTile(g, seated, current, newTags); tile?.(b, g); group.append(b);
      if (!hidden.includes(g.id)) continue;
      b.classList.add('is-hidden');
      // a hidden tile can be put back in the list from its 👁️ corner
      const back = el('span', 'tile-unhide', '👁️');
      back.title = back.ariaLabel = `Show ${g.name} in the list again`;
      back.setAttribute('role', 'button');
      back.onclick = (e) => { e.stopPropagation(); toggleHidden(g.id); redraw(); };
      b.append(back);
    }
  }
  // the row that shows, hides again or restores the hidden games
  if (hidden.length && !query) {
    const row = el('div', 'picker-hidden');
    const n = hiddenList.length;  // the picked game stays in place, so it isn't counted
    const tog = el('button', 'chip-btn', showHidden ? `🙈 Hide the ${n} hidden again` : `🙈 ${n} hidden · show`);
    tog.setAttribute('aria-pressed', showHidden);
    tog.onclick = () => { showHidden = !showHidden; redraw(); };
    const all = el('button', 'chip-btn', '👁️ Unhide all');
    all.onclick = () => { store('hiddenGames', null); showHidden = false; redraw(); };
    row.append(tog, all);
    if (n) pick.append(row);
  }
  fitPicker(pick);
}
// the picker in a dialog, for the home screen and the game-over panel: resolves with a game id, or null
async function pickGameSheet({ title = '🎮 Choose a game', current = null, seated = 0 } = {}) {
  let games = S?.games?.length ? S.games : null;
  if (!games) {
    try { games = await loadCatalog(); } catch { games = SOLO_GAMES.map(([id, label]) => ({ id, icon: label.split(' ')[0], name: label.replace(/^\S+ /, ''), category: '', min: 1, max: 6 })); }
  }
  const body = el('div', 'picker-sheet');
  const find = el('input'); find.type = 'search'; find.placeholder = '🔎 Find a game'; find.autocomplete = 'off';
  find.setAttribute('aria-label', 'Find a game');
  const cards = el('button', 'chip-btn kind-chip', '🃏 Cards');
  cards.title = 'Show only card games';
  cards.onclick = () => { store('pickerKind', load('pickerKind') === 'cards' ? null : 'cards'); draw(); };
  const fedBtn = el('button', 'chip-btn', '');
  fedBtn.title = 'Show only games you have not left feedback on';
  fedBtn.onclick = () => { toggleFeedback(); draw(); };
  const tools = el('div', 'picker-tools');
  tools.append(find, cards, fedBtn);
  const bar = el('div', 'picker-bar'), pick = el('div', 'picker');
  body.append(tools, bar, pick);
  let chosen = null;
  const draw = () => {
    cards.setAttribute('aria-pressed', load('pickerKind') === 'cards');
    feedbackChip(fedBtn);
    renderPickerBar(bar, pick, draw);
    renderPickerGrid(pick, { games, seated, current, query: find.value, redraw: draw, tile: (b, g) => { b.onclick = () => { chosen = g.id; ask.close?.(true); }; } });
  };
  find.oninput = draw;
  $('#modal').classList.add('sheet');
  const shown = ask('', { title, ok: 'Close', cancel: '', body });
  draw();
  requestAnimationFrame(() => { fitPicker(pick); pick.querySelector('.game-tile.on')?.scrollIntoView?.({ block: 'center' }); });
  await shown;
  $('#modal').classList.remove('sheet');
  return chosen;
}
let pickedGame = null;  // the game this host just tapped, scrolled to once the server confirms it
let pickerFolded = false;  // the host has picked: the picker folds away until 🔄 Change game (or the next lobby visit)
// (#343) on a large screen the game library has its own column, so it never folds (the same width as style.css's)
const wideLobby = window.matchMedia?.('(min-width: 1000px)');
wideLobby?.addEventListener?.('change', () => { if (S?.phase === 'lobby') renderLobby(); });
const unfoldPicker = () => { if (!pickerFolded) return false; pickerFolded = false; renderLobby(); return true; };
// seats a game is best with: the solo bot count plus you, within the game's limits
const recSeats = (g) => Math.min(g.max, Math.max(g.min, (SOLO_BOTS[g.id] ?? 1) + 1));
const sameVal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isDefault = (f, settings = S.settings) => f.default === undefined || sameVal(settings[f.key], f.default);

// arrow keys move between game tiles by where they sit on screen, across categories (#37)
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
function stepPicker(cur, dir) {
  const mid = (r) => [r.left + r.width / 2, r.top + r.height / 2];
  const [x0, y0] = mid(cur.getBoundingClientRect());
  let best = null, bestScore = Infinity;
  for (const t of document.querySelectorAll('#gamePicker .game-tile')) {
    if (t === cur) continue;
    const [x, y] = mid(t.getBoundingClientRect());
    const along = (x - x0) * dir[0] + (y - y0) * dir[1], across = Math.abs((x - x0) * dir[1] + (y - y0) * dir[0]);
    if (along < 4) continue;
    const score = along + across * 3;
    if (score < bestScore) { best = t; bestScore = score; }
  }
  best?.focus();
  best?.scrollIntoView?.({ block: 'nearest' });
  return best;
}

const playlistRequest = () => ({
  gameNo: S.gameNo, revision: S.playlistRevision, index: S.playlist?.index ?? null,
});

function renderPlaylistGames(list, games, index = null, edit = null) {
  list.replaceChildren();
  games.forEach((id, i) => {
    const g = gameInfo(id), item = el('li');
    const label = el('span', '', `${g.icon} ${g.name}`);
    if (i === index) item.setAttribute('aria-current', 'step');
    item.append(label);
    if (edit) {
      const row = el('div', 'playlist-edit');
      for (const [text, action, to] of [['↑', 'Move up', i - 1], ['↓', 'Move down', i + 1], ['✕', 'Remove', null]]) {
        const btn = el('button', 'chip-btn', text);
        btn.setAttribute('aria-label', `${action}: game ${i + 1}, ${g.name}`);
        btn.disabled = to === -1 || to === games.length;
        btn.onclick = () => {
          const reordered = [...games];
          const [game] = reordered.splice(i, 1);
          if (to !== null) reordered.splice(to, 0, game);
          edit(reordered);
        };
        row.append(btn);
      }
      item.append(row);
    }
    list.append(item);
  });
}

function renderLobbyPlaylist(host, seated) {
  const games = S.playlist?.games || [];
  const request = playlistRequest();
  const save = (lineup) => quiet(act('set_playlist', { ...request, games: lineup }));
  const add = async () => {
    const id = await pickGameSheet({ title: 'Add a game to the playlist', seated });
    if (id) save([...games, id]);
  };
  $('#lobbyPlaylist').hidden = !games.length;
  // Keep playlist creation hidden while allowing existing playlists to continue.
  $('#addPlaylistGame').hidden = !host || games.length >= 8;
  $('#addPlaylistGame').onclick = add;
  $('#playlistBlock').textContent = S.playlist?.blocked || '';
  renderPlaylistGames($('#playlistGames'), games, null, host ? save : null);
  const start = $('#startPlaylistBtn');
  start.hidden = !host;
  start.disabled = !!S.playlist?.blocked;
  start.onclick = () => quiet(act('start_playlist', request));
  if (games.length) $('#startBtn').hidden = true;
}

function renderLobby() {
  const host = S.host === S.me.id;
  const info = gameInfo();
  $('#lobbyCode').textContent = S.code;

  const pick = $('#gamePicker');
  const focused = document.activeElement?.closest?.('#gamePicker .game-tile')?.dataset.game;  // keep keyboard focus across redraws (#37)
  const seated = S.players.filter((p) => !p.spectator).length;
  // organising (#67, #98): favourites and lately played on top, families inside Cards and Dice, sorts, a name filter, "fits us"
  const onlyFits = !!load('pickerFits');
  $('#pickerFits').setAttribute('aria-pressed', onlyFits);
  $('#pickerFits').textContent = `👥 Fits ${seated}`;
  $('#pickerCards')?.setAttribute('aria-pressed', load('pickerKind') === 'cards');
  if ($('#pickerFeedback')) feedbackChip($('#pickerFeedback'));
  renderPickerBar($('#pickerBar'), pick, () => renderLobby());
  renderPickerGrid(pick, {
    games: S.games, seated, current: S.gameId, query: $('#pickerFind').value, onlyFits, redraw: () => renderLobby(),
    tile: (b, g) => {
      const wishers = S.players.filter((p) => p.wish === g.id);
      if (S.me && wishers.some((p) => p.id === S.me.id)) b.classList.add('wished');
      // players ask the host for games; the host sees who asked (#70)
      if (wishers.length) {
        const w = el('span', 'wishes', `🙏${wishers.length > 1 ? ' ' + wishers.length : ''}`);
        w.title = 'Asked for by ' + wishers.map((p) => p.name).join(', ');
        b.append(w);
      }
      b.title = host ? '' : g.id === S.gameId ? 'The host picked this game' : 'Ask the host for this game (tap again to take it back)';
      b.onclick = () => {
        if (host && g.id === S.gameId && wideLobby?.matches) return;  // already chosen and in view
        if (host && g.id === S.gameId) { pickerFolded = true; renderLobby(); $('#gameChosen').scrollIntoView?.({ behavior: 'smooth', block: 'start' }); }
        else if (host) { pickedGame = g.id; quiet(act('settings', { settings: { game: g.id } })); }
        else quiet(act('wish', { game: g.id }));
      };
    },
  });
  fitPicker();
  if (focused && !pickerFolded) pick.querySelector(`[data-game="${focused}"]`)?.focus({ preventScroll: true });
  // the chosen game sits above its rules and settings; after the host picks one, bring it into view (#38, #39)
  const chosen = $('#gameChosen'); chosen.innerHTML = '';
  chosen.append(el('span', 'gicon', info.icon), el('b', '', info.name));
  const favs = load('favGames') || [], fav = favs.includes(S.gameId);
  const star = el('button', 'ghost-btn fav-btn' + (fav ? ' on' : ''), fav ? '★' : '☆');
  star.title = fav ? 'Remove from your favourites' : 'Add to your favourites (kept on this device)';
  star.setAttribute('aria-pressed', fav);
  star.onclick = () => { store('favGames', fav ? favs.filter((g) => g !== S.gameId) : [S.gameId, ...favs]); renderLobby(); };
  chosen.append(star);
  // 🙈 keep this game out of the lists on this device (the picker can show it again)
  const hid = isHidden(S.gameId);
  const eye = el('button', 'ghost-btn hide-btn' + (hid ? ' on' : ''), hid ? '👁️' : '🙈');
  eye.title = eye.ariaLabel = hid ? 'Show this game in the list again' : 'Hide this game from the list (on this device)';
  eye.setAttribute('aria-pressed', hid);
  eye.onclick = () => { toggleHidden(S.gameId); renderLobby(); };
  star.after(eye);
  const course = S.gameId === 'archery' && info.settings.find((f) => f.key === 'course');
  const selectedCourse = course && (S.settings.course ?? course.default);
  const darts = course && selectedCourse !== 'archery';
  const courseName = course?.options?.find(([id]) => id === selectedCourse)?.[1] ?? info.name;
  $('#settingsHead').textContent = `${courseName} settings`;
  document.title = `${info.name} — Game Night`;
  if (pickedGame && pickedGame === S.gameId) {
    pickedGame = null; pickerFolded = host;
    requestAnimationFrame(() => chosen.scrollIntoView?.({ behavior: 'smooth', block: wideLobby?.matches ? 'nearest' : 'start' }));
  }
  // folded: the chosen game heads the lobby with a way back to the full list
  if (!host || wideLobby?.matches) pickerFolded = false;
  $('#pickerTools').classList.toggle('folded', pickerFolded); $('#pickerBar').classList.toggle('folded', pickerFolded); pick.classList.toggle('folded', pickerFolded);
  chosen.classList.toggle('folded', pickerFolded);
  if (pickerFolded) {
    const change = el('button', 'change-game', '🔄 Change game');
    change.title = 'Show all the games again';
    change.onclick = () => { unfoldPicker(); pick.querySelector(`[data-game="${S.gameId}"]`)?.focus({ preventScroll: true }); };
    eye.after(change);
    if (focused || document.activeElement?.closest?.('#gamePicker')) change.focus({ preventScroll: true });  // keyboard users land on it
  }
  $('#gameDesc').textContent = (course && !darts ? 'Read the wind and aim at apples, balloons, and a swinging target.' : info.blurb) + (S.gameId === 'unmask' ? ' ' + MODE_DESC[S.settings.mode] : '');
  const family = CATEGORIES.find(([cat]) => cat === info.category)?.[1];
  $('#gameMeta').replaceChildren(...[family, `👥 ${playersText(info)}`].filter(Boolean).map((t) => el('span', 'meta-chip', t)));
  $('#howto').innerHTML = '';
  for (const line of info.howto) $('#howto').append(el('li', '', line));

  $('#playerCount').textContent = ` (${S.players.length})`;
  const ul = $('#lobbyPlayers'); ul.innerHTML = '';
  for (const p of S.players) {
    const li = el('li');
    const lt = lookTitle(p);
    li.append(lookAvatar(p), mark(p, p.online), el('span', '', p.name + (p.id === S.me.id ? ' (you)' : '')));
    if (lt) li.append(el('small', 'look-title', lt));
    if (p.id === S.host) li.append(el('span', '', '👑'));
    if (p.id === S.me.id && S.phase !== 'playing') {
      const edit = el('button', 'ghost-btn', '✏️');
      edit.title = 'Change your name or colour';
      edit.onclick = editProfile;
      li.append(edit);
    }
    if (p.spectator) li.append(el('span', 'hint', p.watching ? '👁 watching' : 'spectating'));
    if (p.wish) li.append(el('span', 'hint', '🙏 ' + (gameInfo(p.wish)?.name || p.wish)));
    if (p.id === S.me.id && !p.bot && S.phase === 'lobby') {  // sit out or take a seat (#71)
      const w = el('button', 'ghost-btn watch-btn', p.spectator ? '🙋 Play' : '👁 Watch');
      w.title = p.spectator ? 'Take a seat in the next game' : 'Sit out and watch the next games';
      w.onclick = () => quiet(act('watch', { on: !p.spectator }));
      li.append(w);
    }
    if (p.played || p.points) li.append(el('span', 'hint', `⭐ ${p.points}${p.wins ? ` · 🏆 ${p.wins}` : ''}`));
    if (p.away) li.append(el('span', 'hint', '📡 away'));
    if (p.bot) li.append(el('span', 'hint', `${p.bot} bot`));
    if (host && p.id !== S.me.id) {
      const x = el('button', 'ghost-btn', '✕');
      x.title = p.bot ? 'Remove bot' : 'Remove player';
      x.onclick = async () => p.bot ? quiet(act('remove_bot', { bot: p.id }))
        : (await ask(`Remove ${p.name} from the room?`, { ok: 'Remove', danger: true })) && quiet(act('kick', { player: p.id }));
      li.append(x);
    }
    ul.append(li);
  }

  const box = $('#settingsBox'); box.innerHTML = '';
  for (const f of [...info.settings, ...S.roomSettings]) {
    if (darts && ['ends', 'wind'].includes(f.key)) continue;
    const label = f.key === 'timer' && S.gameId === 'heist' ? 'Night timer' : f.label;
    const lab = el('label', '', label);
    const sel = el('select');
    for (const [v, l] of f.options) { const o = el('option', '', l); o.value = JSON.stringify(v); sel.append(o); }
    sel.value = JSON.stringify(S.settings[f.key]);
    sel.disabled = !host;
    // judged on every option, so the layout doesn't jump when the choice changes
    if (f.options.some(([, l]) => [...String(l)].length > 23)) lab.classList.add('wide');
    sel.onchange = () => quiet(act('settings', { settings: { [f.key]: JSON.parse(sel.value) } }));
    if (!isDefault(f)) { lab.classList.add('changed'); lab.title = 'Changed from the default (' + (f.options.find(([v]) => sameVal(v, f.default))?.[1] ?? '?') + ')'; }
    lab.append(sel); box.append(lab);
  }
  if (S.gameId === 'putt') {
    const saved = S.settings.course_code ?? '';
    const label = el('label', 'wide', 'Course code');
    const input = el('input');
    input.value = saved;
    input.placeholder = 'Random course';
    input.maxLength = 48;
    input.disabled = !host;
    input.onchange = () => quiet(act('settings', { settings: { course_code: input.value.trim() } }));
    label.append(input);
    box.append(label);
  }
  $('#defaultsBtn').hidden = !host || info.settings.every((f) => isDefault(f));
  $('#lobbyEditorBtn').hidden = !(S.gameId === 'pinball' && window.gnEditor);
  // table size: a Start that says what's missing, and one tap to seat the right number of bots
  const rec = recSeats(info), short = seated < info.min, over = seated > info.max;
  const humanOnly = S.gameId === "switchyard";
  const hasBots = humanOnly && S.players.some((p) => !p.spectator && p.bot);
  const fill = $('#fillBtn');
  fill.hidden = !host || humanOnly || seated >= rec || seated >= 6;
  fill.textContent = `🤖 Fill to ${rec} players`;
  fill.title = `Add ${rec - seated} computer player${rec - seated > 1 ? 's' : ''} (${$('#botLevel').selectedOptions[0]?.textContent || 'Normal'})`;
  fill.classList.toggle('nudge', short);
  $('#startBtn').hidden = !host; $('#waitHost').hidden = host; $('#botRow').hidden = !host || humanOnly;
  const chosenInfo = gameInfo(S.gameId);
  $('#startBtn').textContent = !chosenInfo ? 'Start game'
    : hasBots ? "Remove computer players to start"
    : short ? `▶ Start — needs ${info.min === info.max ? info.min : info.min + '+'} players`
    : over ? `▶ Start — ${info.max} players at most` : `▶ Start ${chosenInfo.icon} ${chosenInfo.name}`;
  $('#startBtn').classList.toggle('blocked', short || over || hasBots);
  $('#startBtn').disabled = hasBots;
  renderLobbyPlaylist(host, seated);
  $('#lobbyReplayBtn').hidden = !S.hasReplay;
  renderScores(host);
}

// a player's 🏅 badges this evening as a row of emoji (×n when earned more than once), named on hover
function badgeShelf(p) {
  const td = el('td', 'badge-shelf');
  for (const [k, n] of Object.entries(p.badges || {})) {
    const [gid, key] = k.split(':'), g = gameInfo(gid), b = g?.badges?.[key];
    if (!b) continue;
    const s = el('span', '', b[0] + (n > 1 ? `×${n}` : ''));
    s.title = `${b[1]} (${g.icon} ${g.name}): ${b[2]}`;
    td.append(s);
  }
  return td;
}

function renderScoreTable(board, played) {
  if (played.length) {
    const games = [...new Set(played.flatMap((p) => Object.keys(p.byGame)))];
    const t = el('table', 'scores');
    const head = el('tr');
    head.append(el('th', '', 'Player'), el('th', '', '⭐'), el('th', '', '🏆'), el('th', '', 'Played'), el('th', '', '🔥 Best'), el('th', '', '🏅'),
      ...games.map((g) => el('th', '', gameInfo(g)?.icon ?? g)));
    t.append(head);
    const ranked = [...played].sort((a, b) => b.points - a.points || b.wins - a.wins || a.played - b.played);
    const top = Math.max(1, ...ranked.map((p) => p.points));
    ranked.forEach((p, rank) => {
      const tr = el('tr');
      const name = el('td', '', (p.points > 0 ? ['🥇 ', '🥈 ', '🥉 '][rank] || '' : '') + p.name); name.style.color = p.color;
      const pts = el('td', 'pts', String(p.points));
      if (p.points > 0) { const bar = el('i', 'pts-bar'); bar.style.setProperty('--w', `${Math.round((100 * p.points) / top)}%`); bar.style.background = p.color; pts.append(bar); }
      if (p.quits) pts.title = `${p.quits} walk-out${p.quits > 1 ? 's' : ''} (${p.quits * -2} ⭐)`;
      tr.append(name, pts, el('td', '', p.wins), el('td', '', p.played),
        el('td', '', p.best + (p.streak > 1 ? ` (now ${p.streak})` : '')), badgeShelf(p),
        ...games.map((g) => el('td', '', p.byGame[g] || '')));
      t.append(tr);
    });
    board.append(t);
  }
}

function renderScores(host) {
  const played = S.players.filter((p) => p.played || p.points);
  $('#scoreSection').hidden = !played.length && !S.history.length;
  const board = $('#scoreboard');
  const roomBestsOpen = board.querySelector('details.room-bests')?.open;
  board.innerHTML = '';
  renderScoreTable(board, played);
  const records = Object.values(S.roomRecords || {});
  if (records.length) {
    const details = el('details', 'room-bests'), list = el('ul');
    details.open = !!roomBestsOpen;
    details.append(el('summary', '', 'Room bests'), list);
    for (const record of records.sort((a, b) => b.at - a.at)) {
      const row = el('li', '', `${gameInfo(record.game)?.name || record.game} · ${player(record.id)?.name || record.name} · ${Profile.formatBenchmark(record.value, record.kind)}`);
      row.append(el('div', 'hint', record.label));
      list.append(row);
    }
    board.append(details);
  }
  const hist = $('#history'); hist.innerHTML = '';
  for (const h of [...S.history].reverse()) {
    const li = el('li');
    li.append(el('b', '', `${h.icon} ${h.name}`), ` — ${h.winner ? '🏆 ' + h.winner : 'no winner'}`);
    const scored = h.players.filter((x) => x.score != null);
    if (scored.length) li.append(el('div', 'hint left', scored.map((x) => `${x.name} ${fmtNum(x.score)}`).join(' · ')));
    hist.append(li);
  }
  $('#resetScoresBtn').hidden = !host;
}
