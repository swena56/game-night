// 🏆 My record: a lifetime record kept on this device only (localStorage "gn.profile"), across rooms and
// evenings: games played and won per game, a personal best score, ★ bot-ladder stars (win alone against
// Easy, Normal, Hard bots), every 🏅 badge ever earned, and milestones for trying different games.
// The room scoreboard still resets each evening; this never leaves the device.
// Uses load/store/el/ask/toast from app.js (loaded after this file; only called once the page is up).
const Profile = (() => {
  const KEY = 'gn.profile', LEVELS = ['easy', 'normal', 'hard'], LEVEL_NAME = ['Easy', 'Normal', 'Hard'];
  const today = () => new Date().toLocaleDateString('en-CA');
  // a new record starts from the games this device already shows under "Played lately" (tried, not counted)
  const fresh = () => ({ since: today(), badges: {}, seen: [], snap: {},
    games: Object.fromEntries((load('recentGames') || []).map((id) => [id, { played: 0, wins: 0, tried: true }])) });
  const get = () => { const p = load(KEY); return p && p.games ? p : fresh(); };
  const label = (gid) => (SOLO_GAMES.find(([id]) => id === gid) || [gid, gid])[1];
  const starText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
  const stars = (gid, p = get()) => p.games[gid]?.stars || 0;
  const tried = (gid, p = get()) => !!(p.games[gid]?.played || p.games[gid]?.tried);
  const triedCount = (p = get()) => Object.values(p.games).filter((g) => g.played || g.tried).length;
  const fmt = (n) => (typeof n === 'number' ? (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1)) : '');
  const MILESTONES = () => [[5, '🧭', 'Explorer'], [15, '🗺️', 'Globetrotter'], [30, '🌍', 'World tour'], [SOLO_GAMES.length, '👑', 'Played them all']];

  // Called with every new state. Records each finished game once (by room + finish time) and counts badges
  // earned since the last state. Returns lines worth telling the player (a new star, best or milestone).
  function onState(S) {
    if (!S?.me || !S.players) return [];
    const p = get(), news = [];
    let dirty = false;
    // 🏅 badges: the room counts them per evening, so add whatever grew since this room's last snapshot
    const mine = S.players.find((x) => x.id === S.me.id)?.badges || {};
    const snap = p.snap[S.code] || {};
    for (const [k, n] of Object.entries(mine)) {
      if (n <= (snap[k] || 0)) continue;
      const [gid, key] = k.split(':'), b = S.games?.find((g) => g.id === gid)?.badges?.[key];
      const rec = p.badges[k] ||= { n: 0, emo: b?.[0] || '🏅', name: b?.[1] || key, how: b?.[2] || '' };
      rec.n += n - (snap[k] || 0);
      dirty = true;
    }
    if (JSON.stringify(mine) !== JSON.stringify(snap)) {
      p.snap[S.code] = mine;  // also follows a scoreboard reset down to zero
      const codes = Object.keys(p.snap); if (codes.length > 6) delete p.snap[codes[0]];
      dirty = true;
    }
    const last = S.history?.at(-1);
    const key = last && `${S.code}:${last.at}`;
    if (S.phase === 'over' && last && !p.seen.includes(key)) {
      p.seen = [...p.seen, key].slice(-40);
      dirty = true;
      const me = last.players.find((x) => x.id === S.me.id);
      if (me) news.push(...record(p, last, me));
    }
    if (dirty) store(KEY, p);
    return news;
  }

  function record(p, last, me) {
    const news = [], gid = last.game, name = `${last.icon} ${last.name}`;
    const before = triedCount(p);
    const g = p.games[gid] ||= { played: 0, wins: 0 };
    g.played++; g.lastAt = today();
    if (me.won) g.wins++;
    // personal best: which way is better comes from the game, or from who won (the winner holds the top
    // score, or the bottom one as in Hearts)
    if (typeof me.score === 'number') {
      const scores = last.players.map((x) => x.score).filter((v) => typeof v === 'number');
      const won = last.players.find((x) => x.won);
      if (last.low) g.low = true;
      else if (won && typeof won.score === 'number' && scores.length > 1 && Math.min(...scores) !== Math.max(...scores)) g.low = won.score === Math.min(...scores);
      const better = g.best == null || (g.low ? me.score < g.best : me.score > g.best);
      if (better && g.best != null) news.push(`📈 Personal best at ${name}: ${fmt(me.score)} (was ${fmt(g.best)})`);
      if (better) g.best = me.score;
    }
    // ★ bot ladder: a win as the only person at the table earns the star for the weakest bot level there
    const humans = last.players.filter((x) => !x.bot), bots = last.players.filter((x) => x.bot);
    if (me.won && humans.length === 1 && bots.length) {
      const lvl = Math.min(...bots.map((x) => Math.max(0, LEVELS.indexOf(x.bot))));
      if (lvl + 1 > (g.stars || 0)) {
        g.stars = lvl + 1;
        news.push(`${starText(g.stars)} ${name}: you beat ${LEVEL_NAME[lvl]} bots!` + (lvl < 2 ? ` Try ${LEVEL_NAME[lvl + 1]} next.` : ' Top of the ladder.'));
      }
    }
    const now = triedCount(p);
    if (now > before) {
      const m = MILESTONES().find(([n]) => n === now);
      if (m) news.push(`${m[1]} ${m[2]}: you've played ${now} different games!`);
    }
    return news;
  }

  // a line for the results card: where you stand on this game's bot ladder (solo tables only)
  function overLine(S) {
    const last = S.history?.at(-1);
    if (!last || !last.players.some((x) => x.id === S.me.id)) return '';
    const humans = last.players.filter((x) => !x.bot);
    if (humans.length !== 1 || humans.length === last.players.length) return '';
    const n = stars(last.game);
    return n >= 3 ? `${starText(3)} ladder complete` : `${starText(n)} — beat ${LEVEL_NAME[n]} bots for the next star`;
  }

  // the 🏆 My record dialog; `pick(gid)` (home screen only) lets a "not tried yet" chip choose that game
  function show(pick = null) {
    const p = get(), games = Object.entries(p.games).filter(([, g]) => g.played), triedN = triedCount(p);
    const played = games.reduce((s, [, g]) => s + g.played, 0), wins = games.reduce((s, [, g]) => s + g.wins, 0);
    const starSum = games.reduce((s, [, g]) => s + (g.stars || 0), 0);
    const body = el('div', 'record');
    const stat = (big, small) => { const d = el('div', 'rec-stat'); d.append(el('b', '', big), el('small', '', small)); return d; };
    const head = el('div', 'rec-stats');
    head.append(stat(played, 'games'), stat(played ? Math.round((100 * wins) / played) + '%' : '–', `won (${wins})`),
      stat(`${triedN}/${SOLO_GAMES.length}`, 'tried'), stat(`${starSum}★`, `of ${SOLO_GAMES.length * 3}`));
    body.append(head);
    const ms = el('div', 'rec-miles');
    for (const [n, emo, nm] of MILESTONES()) {
      const s = el('span', triedN >= n ? 'got' : '', `${emo} ${nm}`);
      s.title = `Play ${n} different games`;
      ms.append(s);
    }
    body.append(ms);
    const badges = Object.values(p.badges);
    if (badges.length) {
      const shelf = el('div', 'rec-badges');
      for (const b of badges) { const s = el('span', '', b.emo + (b.n > 1 ? `×${b.n}` : '')); s.title = `${b.name}: ${b.how}`; shelf.append(s); }
      body.append(el('h4', '', `🏅 Badges (${badges.length})`), shelf);
    }
    if (games.length) {
      const t = el('table', 'rec-table');
      const hr = el('tr'); for (const h of ['', 'Bots', 'Played', 'Won', 'Best']) hr.append(el('th', '', h));
      t.append(hr);
      for (const [gid, g] of games.sort((a, b) => b[1].played - a[1].played)) {
        const tr = el('tr');
        tr.append(el('td', '', label(gid)), el('td', 'rec-stars', starText(g.stars || 0)), el('td', '', g.played), el('td', '', g.wins),
          el('td', '', g.best != null ? fmt(g.best) : ''));
        t.append(tr);
      }
      body.append(el('h4', '', '🎮 By game'), t);
    } else body.append(el('p', 'hint', 'Finish a game and it shows up here. Win alone against bots to earn ★ stars: Easy, Normal, then Hard.'));
    const fresh = SOLO_GAMES.filter(([id]) => !tried(id, p));
    if (fresh.length) {
      body.append(el('h4', '', `🆕 Not tried yet (${fresh.length})`));
      const row = el('div', 'rec-fresh');
      for (const [id, lab] of fresh) {
        const b = el(pick ? 'button' : 'span', 'chip-btn', lab);
        if (pick) b.onclick = () => { ask.close?.(false); pick(id); };
        row.append(b);
      }
      body.append(row);
    }
    body.append(el('p', 'hint', `Kept on this device since ${p.since}.`));
    return ask('', { title: '🏆 My record', body, ok: 'Close', cancel: '' });
  }

  // a random game not tried yet, else one with the fewest stars
  function suggest() {
    const p = get(), ids = SOLO_GAMES.map(([id]) => id);
    const fresh = ids.filter((id) => !tried(id, p));
    const pool = fresh.length ? fresh : ids.filter((id) => stars(id, p) === Math.min(...ids.map((i) => stars(i, p))));
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // "new" tags only mean something once a few games have been tried
  const showNew = () => triedCount() >= 3;
  return { onState, overLine, show, suggest, stars, tried, starText, showNew };
})();
