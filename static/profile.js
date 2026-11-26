// 🏆 My record: a lifetime record kept on this device only (localStorage "gn.profile"), across rooms and
// evenings: games played and won per game, a personal best score, ★ bot-ladder stars (win alone against
// Easy, Normal, Hard bots), every 🏅 badge ever earned, and milestones for trying different games.
// The room scoreboard still resets each evening.
// ✨ XP and levels: every finished game adds XP (p.xp, the lifetime total); levels 1–50 open UNLOCKS (avatar frames,
// titles, avatar emoji packs, card backs). The record is mirrored on the server under this device's id
// (localStorage "gn.dev" = { id, key }), so clearing the browser doesn't lose it (sync, below).
// Uses load/store/el/ask/toast from app.js (loaded after this file; only called once the page is up).
const Profile = (() => {
  const KEY = 'gn.profile', LEVELS = ['easy', 'normal', 'hard'], LEVEL_NAME = ['Easy', 'Normal', 'Hard'];
  const today = () => new Date().toLocaleDateString('en-CA');
  // a new record starts from the games this device already shows under "Played lately" (tried, not counted)
  const fresh = () => ({ since: today(), badges: {}, seen: [], snap: {}, xp: 0, lvl: 1,
    games: Object.fromEntries((load('recentGames') || []).map((id) => [id, { played: 0, wins: 0, tried: true }])) });
  const get = () => { const p = load(KEY); return p && p.games ? migrate(p) : fresh(); };

  // ---------- XP and levels
  // need(n) XP from level n to n+1: about 45 games to level 10, about 900 to level 50
  const MAX_LVL = 50, need = (n) => 60 + 20 * n;
  function levelOf(xp) {
    let lvl = 1, into = Math.max(0, Math.floor(xp || 0));
    while (lvl < MAX_LVL && into >= need(lvl)) { into -= need(lvl); lvl++; }
    return { lvl, into, need: lvl < MAX_LVL ? need(lvl) : 0, xp: Math.floor(xp || 0) };
  }
  const xpFor = (lvl) => { let t = 0; for (let n = 1; n < Math.min(lvl, MAX_LVL); n++) t += need(n); return t; };
  const XP = { finish: 10, win: 15, star: 20, best: 15, badge: 10, firstBadge: 25, firstPlay: 30, milestone: 50, long: 5 };
  const BOT_MULT = [1, 1.5, 2];
  // [level, kind, id, label]: what each level opens. server.py LOOK_FRAMES / LOOK_TITLES mirror the frames and titles.
  const UNLOCKS = [
    [2, 'title', 'rookie', 'Rookie'], [3, 'frame', 'bronze', 'Bronze frame'], [4, 'pack', 'animals', 'Animals+ icons'],
    [5, 'title', 'regular', 'Regular'], [6, 'frame', 'silver', 'Silver frame'], [7, 'back', 'sunset', 'Sunset card back'],
    [8, 'title', 'shark', 'Card Shark'], [9, 'pack', 'food', 'Food icons'], [10, 'frame', 'gold', 'Gold frame'],
    [12, 'title', 'devil', 'Dice Devil'], [14, 'pack', 'space', 'Space icons'], [15, 'frame', 'frost', 'Frost frame'],
    [16, 'back', 'galaxy', 'Galaxy card back'], [18, 'title', 'owl', 'Night Owl'], [20, 'frame', 'ember', 'Ember frame'],
    [22, 'pack', 'fantasy', 'Fantasy icons'], [25, 'title', 'veteran', 'Veteran'], [28, 'back', 'royal', 'Royal card back'],
    [30, 'frame', 'rainbow', 'Rainbow frame'], [35, 'title', 'champion', 'Champion'], [40, 'frame', 'crown', 'Crown frame'],
    [50, 'frame', 'legend', 'Legend frame'], [50, 'title', 'legend', 'Legend of the Night'],
  ];
  const KIND_ICON = { frame: '🖼️', title: '🏷️', pack: '🙂', back: '🂠' };
  // avatar emoji packs for the icon picker (all Emoji 12 or older: old Android phones draw them)
  const PACKS = {
    animals: ['🦓', '🦒', '🦘', '🦙', '🦛', '🦜', '🦚', '🦩', '🦥', '🦦', '🦨', '🦡', '🐘', '🐊', '🐆', '🦌', '🦀', '🐌', '🐞', '🦂'],
    food: ['🍩', '🍪', '🧁', '🍰', '🍦', '🍉', '🍓', '🍒', '🍍', '🥑', '🌮', '🌯', '🍔', '🍟', '🍣', '🥟', '🥨', '🧇', '🧀', '🍿'],
    space: ['🪐', '🌍', '🌌', '☄️', '🛸', '🛰️', '👽', '🌠', '🌞', '🌛', '🔭', '👨‍🚀', '🌑', '🌟', '💫', '🌈'],
    fantasy: ['🧙', '🧚', '🧛', '🧜', '🧝', '🧞', '🧟', '🐉', '🔮', '🗡️', '🛡️', '🏰', '👑', '💎', '🦸', '🦹', '🧿', '🏹', '📜', '⚔️'],
  };
  const unlockAt = (kind, id) => UNLOCKS.find((u) => u[1] === kind && u[2] === id)?.[0] ?? 1;
  const level = (p = get()) => levelOf(p.xp).lvl;
  const unlocked = (kind, id, p = get()) => level(p) >= unlockAt(kind, id);
  const titleName = (id) => UNLOCKS.find((u) => u[1] === 'title' && u[2] === id)?.[3] || '';
  const lockText = (kind, id) => `🔒 Lv ${unlockAt(kind, id)}`;
  // what shows at the table: the frame and title picked (undefined = the newest unlocked one, '' = none)
  function look(p = get()) {
    const lvl = level(p), pick = (kind) => {
      const want = p.look?.[kind];
      if (want === '') return null;
      if (want && lvl >= unlockAt(kind, want)) return want;
      return UNLOCKS.filter((u) => u[1] === kind && u[0] <= lvl).at(-1)?.[2] || null;
    };
    return { lvl, frame: pick('frame'), title: pick('title') };
  }
  // existing records get the XP their history is worth, once, so nobody starts back at level 1
  function migrate(p) {
    if (typeof p.xp === 'number') return p;
    let xp = 0;
    for (const g of Object.values(p.games || {})) {
      if (!g.played) continue;
      xp += XP.firstPlay + g.played * XP.finish + (g.wins || 0) * XP.win + (g.stars || 0) * XP.star;
    }
    for (const b of Object.values(p.badges || {})) xp += XP.firstBadge + Math.max(0, (b.n || 1) - 1) * XP.badge;
    const n = Object.values(p.games || {}).filter((g) => g.played || g.tried).length;
    xp += MILESTONES().filter(([m]) => n >= m).length * XP.milestone;
    p.xp = xp; p.lvl = levelOf(xp).lvl;
    p.unl = UNLOCKS.filter((u) => u[0] <= p.lvl).map((u) => u[1] + ':' + u[2]);  // no toasts for what you already had
    return p;
  }
  // add XP lines to the record; returns the unlocks a level-up opened
  function gain(p, lines) {
    const add = lines.reduce((s, [, x]) => s + x, 0), was = levelOf(p.xp).lvl;
    p.xp = (p.xp || 0) + add;
    p.lvl = levelOf(p.xp).lvl;
    const ups = UNLOCKS.filter((u) => u[0] > was && u[0] <= p.lvl && !(p.unl || []).includes(u[1] + ':' + u[2]));
    if (ups.length) p.unl = [...(p.unl || []), ...ups.map((u) => u[1] + ':' + u[2])];
    return ups;
  }
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
    let dirty = false, synced = false;
    // 🏅 badges: the room counts them per evening, so add whatever grew since this room's last snapshot
    const mine = S.players.find((x) => x.id === S.me.id)?.badges || {};
    const snap = p.snap[S.code] || {}, badgeXp = [];
    for (const [k, n] of Object.entries(mine)) {
      if (n <= (snap[k] || 0)) continue;
      const [gid, key] = k.split(':'), b = S.games?.find((g) => g.id === gid)?.badges?.[key];
      const rec = p.badges[k] ||= { n: 0, emo: b?.[0] || '🏅', name: b?.[1] || key, how: b?.[2] || '' };
      const more = n - (snap[k] || 0);
      badgeXp.push([`${rec.emo} ${rec.name}` + (rec.n ? '' : ' (first!)'), (rec.n ? 0 : XP.firstBadge - XP.badge) + more * XP.badge]);
      rec.n += more;
      dirty = synced = true;
    }
    // badge XP joins the next results card (or this one, when the badge lands after the finish)
    if (badgeXp.length) {
      const last0 = S.history?.at(-1), key0 = last0 && `${S.code}:${last0.at}`;
      news.push(...upNews(gain(p, badgeXp)));
      if (S.phase === 'over' && p.last?.key === key0) { p.last.lines.push(...badgeXp); p.last.to = p.xp; }
      else { p.pend = [...(p.pend || []), ...badgeXp].slice(-12); p.pendXp = (p.pendXp || 0) + badgeXp.reduce((s, [, x]) => s + x, 0); }
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
      if (me) { news.push(...record(p, last, me, key)); synced = true; }
    }
    if (dirty) store(KEY, p);
    if (synced) sync();
    return news;
  }
  const upNews = (ups) => ups.map((u) => `🆙 Level ${u[0]}! 🔓 ${u[3]}`);

  const lowerRecord = (kind) => ['lowPoints', 'strokes', 'time'].includes(kind);
  const winRecord = (kind) => kind === 'wins' || kind === 'crew';
  const recordValue = (value, kind) => kind === 'time' ? `${(value / 1000).toFixed(3)} s` :
    `${Number.isInteger(value) ? fmt(value) : value.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${kind === 'strokes' ? (value === 1 ? 'stroke' : 'strokes') : 'pts'}`;
  const recentValue = (b) => winRecord(b.kind) ? b.recent.reduce((sum, row) => sum + row[2], 0) :
    (lowerRecord(b.kind) ? Math.min : Math.max)(...b.recent.map((row) => row[2]));

  function recordBenchmark(p, last, me, key) {
    const rules = last.record;
    if (!rules || rules.kind === 'progress' || me.bot) return null;
    const { kind } = rules;
    const wins = winRecord(kind);
    const value = wins ? Number(me.won) : me.recordScore;
    if (!Number.isFinite(value)) return null;
    const records = p.benchmarks ||= {};
    const b = records[rules.key] ||= { game: last.game, label: rules.label, kind, recent: [] };
    if (b.recent.some(([id]) => id === key)) return null;
    const previous = b.recent.length ? recentValue(b) : null;
    const best = b.best;
    b.recent = [...b.recent, [key, last.at, value]].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).slice(-5);
    const current = wins ? recentValue(b) : value;
    const improves = (target) => target == null || (lowerRecord(kind) ? current < target : current > target);
    const newBest = (!wins || b.recent.length === 5) && improves(best);
    if (newBest) b.best = current;
    const keys = Object.keys(records);
    if (keys.length > 256) {
      keys.sort((a, b) => records[a].recent.at(-1)[1] - records[b].recent.at(-1)[1] || a.localeCompare(b));
      delete records[keys[0]];
    }
    if (wins) {
      const target = b.best ?? current;
      const possible = b.recent.slice(-4).reduce((sum, row) => sum + row[2], 0) + 1;
      const result = `${current} ${kind === 'crew' ? 'crew wins' : 'wins'} in your last ${b.recent.length}`;
      const goal = b.recent.length < 5 ? 'Play toward your first five-game record.' :
        possible > target ? 'Win the next round for a new five-game best.' :
        possible === target ? 'Win the next round to match your five-game best.' :
        possible > current ? 'Win the next round to improve your recent record.' : `Your five-game best is ${target}.`;
      return { text: `${result}. ${goal}` };
    }
    const next = recentValue(b);
    const gap = previous == null ? '' : recordValue(Math.abs(value - previous), kind);
    const result = previous == null ? 'First mark' : newBest && best != null ? 'New all-time best' :
      value === previous ? 'Matched your recent best' : improves(previous) ? 'New recent best' :
      `${gap} ${lowerRecord(kind) ? 'over' : 'short of'} your recent best`;
    const verb = kind === 'lowPoints' && next === 0 ? 'match' : 'beat';
    return { text: `${result}. Next round, ${verb} ${recordValue(next, kind)}.`, reward: newBest && best != null };
  }

  function replayGoal(S) {
    const last = S.history?.at(-1);
    const key = last && `${S.code}:${last.at}`;
    const result = get().last;
    return result?.key === key ? result?.goal || '' : '';
  }

  // ♟ Elo for chess (#25): bots have fixed ratings, people bring their own; a quicker K for the first 20 games
  const ELO_START = 1000, ELO_BOT = { easy: 700, normal: 1100, hard: 1500 };
  function rateChess(g, last, me) {
    const foe = last.players.find((x) => x.id !== me.id);
    if (last.players.length !== 2 || !foe || last.low) return null;
    const data = g.data ||= {}, mine = data.elo ?? ELO_START, rated = data.eloGames || 0;
    const theirs = foe.bot ? ELO_BOT[foe.bot] ?? ELO_START : foe.elo ?? ELO_START;
    const score = me.won ? 1 : foe.won ? 0 : 0.5;
    const next = Math.max(100, Math.round(mine + (rated < 20 ? 40 : 20) * (score - 1 / (1 + 10 ** ((theirs - mine) / 400)))));
    Object.assign(data, { elo: next, eloGames: rated + 1 });
    return `♟ Elo ${next} (${next >= mine ? '+' : '−'}${Math.abs(next - mine)} against ${theirs})`;
  }
  const chessElo = () => get().games.chess?.data?.elo ?? ELO_START;

  function record(p, last, me, key = '') {
    const news = [], gid = last.game, name = `${last.icon} ${last.name}`;
    const before = triedCount(p);
    const g = p.games[gid] ||= { played: 0, wins: 0 };
    // ✨ the XP this game earns, line by line, for the results card
    const lines = [['Finished', XP.finish]];
    if (!g.played) lines.push(['🆕 First play', XP.firstPlay]);
    g.played++; g.lastAt = today();
    const rating = gid === 'chess' ? rateChess(g, last, me) : null;
    if (rating) news.push(rating);
    const humans = last.players.filter((x) => !x.bot), bots = last.players.filter((x) => x.bot);
    if (me.won) {
      g.wins++;
      const weakest = bots.length ? Math.min(...bots.map((x) => Math.max(0, LEVELS.indexOf(x.bot)))) : -1;
      const mult = (weakest >= 0 ? BOT_MULT[weakest] : 1) * (humans.length > 1 ? 1.5 : 1);
      const vs = [weakest >= 0 ? `vs ${LEVEL_NAME[weakest]}` : '', humans.length > 1 ? 'vs people' : ''].filter(Boolean).join(' & ');
      lines.push([`🏆 Win${vs ? ' ' + vs : ''}${mult !== 1 ? ` ×${mult}` : ''}`, Math.round(XP.win * mult)]);
    }
    // personal best: which way is better comes from the game, or from who won (the winner holds the top
    // score, or the bottom one as in Hearts)
    if (!last.record && !last.recordExcluded && typeof me.score === 'number') {
      const scores = last.players.map((x) => x.score).filter((v) => typeof v === 'number');
      const won = last.players.find((x) => x.won);
      if (last.low) g.low = true;
      else if (won && typeof won.score === 'number' && scores.length > 1 && Math.min(...scores) !== Math.max(...scores)) g.low = won.score === Math.min(...scores);
      const better = g.best == null || (g.low ? me.score < g.best : me.score > g.best);
      if (better && g.best != null) { news.push(`📈 Personal best at ${name}: ${fmt(me.score)} (was ${fmt(g.best)})`); lines.push(['📈 Personal best', XP.best]); }
      if (better) g.best = me.score;
    }
    const benchmark = recordBenchmark(p, last, me, key);
    if (benchmark?.reward) lines.push(['📈 Personal best', XP.best]);
    // ★ bot ladder: a win as the only person at the table earns the star for the weakest bot level there
    if (me.won && humans.length === 1 && bots.length) {
      const lvl = Math.min(...bots.map((x) => Math.max(0, LEVELS.indexOf(x.bot))));
      if (lvl + 1 > (g.stars || 0)) {
        const n = lvl + 1 - (g.stars || 0);
        lines.push([`${'★'.repeat(n)} New star${n > 1 ? 's' : ''}`, n * XP.star]);
        g.stars = lvl + 1;
        news.push(`${starText(g.stars)} ${name}: you beat ${LEVEL_NAME[lvl]} bots!` + (lvl < 2 ? ` Try ${LEVEL_NAME[lvl + 1]} next.` : ' Top of the ladder.'));
      }
    }
    const now = triedCount(p);
    if (now > before) {
      const m = MILESTONES().find(([n]) => n === now);
      if (m) { news.push(`${m[1]} ${m[2]}: you've played ${now} different games!`); lines.push([`${m[1]} ${m[2]}`, XP.milestone]); }
    }
    if (last.secs >= 180) lines.push(['⏳ A long game', XP.long]);
    // badges earned during play (already counted in p.xp) go on this card too
    const pend = p.pend || [], pendXp = p.pendXp || 0;
    delete p.pend; delete p.pendXp;
    const from = (p.xp || 0) - pendXp;
    news.push(...upNews(gain(p, lines)));
    p.last = { key, game: gid, from, to: p.xp, lines: [...lines, ...pend], goal: benchmark?.text };
    return news;
  }

  // ---------- the server mirror: data/profiles/<id>.json, written only with this device's key
  function dev() {
    let d = load('gn.dev');
    if (d?.id && d?.key) return d;
    const bytes = new Uint8Array(26);
    try { crypto.getRandomValues(bytes); } catch { for (let i = 0; i < bytes.length; i++) bytes[i] = (Math.random() * 256) | 0; }
    const hex = [...bytes.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const ab = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    d = { id: hex, key: [...bytes.slice(2, 26)].map((b) => ab[b & 63]).join('') };
    store('gn.dev', d);
    return d;
  }
  let syncT = 0, onSynced = null;
  // send the record (debounced); the server keeps the larger of each count and the union of the lists, and the answer
  // replaces the local copy unless something changed meanwhile (then the next sync catches up). Offline: nothing lost.
  function sync(delay = 1500) {
    if (typeof location === 'undefined' || typeof fetch !== 'function') return;
    clearTimeout(syncT);
    syncT = setTimeout(async () => {
      const d = dev(), sent = localStorage.getItem(KEY), was = level();
      try {
        const r = await fetch('/api/profile/put', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: d.id, key: d.key, profile: get() }) });
        const j = await r.json();
        if (!r.ok || !j.profile?.games) return;
        if (localStorage.getItem(KEY) !== sent) { sync(); return; }
        store(KEY, j.profile);
        if (level() !== was || sent == null) onSynced?.();
      } catch {}
    }, delay);
  }

  // ---------- ✨ the XP card on the results screen: the bar fills from the old total to the new one, line by line
  let card = null;
  function xpCard(S) {
    const last = S.history?.at(-1), p = get();
    if (!last || !p.last || p.last.key !== `${S.code}:${last.at}`) return null;
    const stamp = `${p.last.key}:${p.last.to}`;
    if (card?.stamp === stamp) return card.node;
    const { from, to, lines } = p.last;
    const box = el('div', 'xp-card'), head = el('div', 'xp-head'), lvlB = el('b', 'xp-lvl'), gainB = el('span', 'xp-gain', `+${to - from} XP`);
    head.append(lvlB, gainB);
    const bar = el('div', 'xp-bar'), fill = el('i'); bar.append(fill);
    const sub = el('small', 'xp-sub'), list = el('ul', 'xp-lines'), up = el('div', 'xp-up');
    up.hidden = true;
    up.addEventListener('animationend', () => { up.style.animation = 'none'; });  // renderOver re-inserts the card: pop once
    box.append(head, bar, sub, list, up);
    const show = (xp) => {
      const L = levelOf(xp);
      lvlB.textContent = `Lv ${L.lvl}`;
      fill.style.width = L.need ? `${(100 * L.into) / L.need}%` : '100%';
      sub.textContent = L.need ? `${L.into} / ${L.need} XP to Lv ${L.lvl + 1}` : 'Top level!';
      return L.lvl;
    };
    const ups = UNLOCKS.filter((u) => u[0] > levelOf(from).lvl && u[0] <= levelOf(to).lvl);
    const reveal = () => {
      const L = levelOf(to);
      up.hidden = !ups.length && L.lvl === levelOf(from).lvl;
      up.textContent = `🆙 Level ${L.lvl}!` + (ups.length ? ' 🔓 ' + ups.map((u) => u[3]).join(', ') : '');
    };
    const rows = lines.map(([t, x]) => { const li = el('li'); li.append(el('span', '', t), el('b', '', `+${x}`)); list.append(li); return li; });
    const motion = typeof motionOK === 'function' ? motionOK() : true;
    if (!motion || typeof requestAnimationFrame !== 'function') {
      show(to); rows.forEach((r) => r.classList.add('in')); reveal();
    } else {
      show(from);
      rows.forEach((r, k) => setTimeout(() => { r.classList.add('in'); if (typeof sfx === 'function') sfx('rise', k * 2); }, 250 + k * 180));
      const t0 = performance.now() + 250, dur = 1200;
      let lvlNow = levelOf(from).lvl;
      const step = (now) => {
        const k = Math.min(1, Math.max(0, (now - t0) / dur)), e = 1 - (1 - k) ** 3;
        const l = show(from + (to - from) * e);
        if (l > lvlNow) { lvlNow = l; levelUp(box, bar); }
        if (k < 1) requestAnimationFrame(step); else { show(to); reveal(); }
      };
      requestAnimationFrame(step);
    }
    card = { stamp, node: box };
    return box;
  }
  // a level-up on the card: the bar flashes and a burst of confetti flies from it (Fx2D on a canvas over the card)
  function levelUp(box, bar) {
    bar.classList.remove('flash'); void bar.offsetWidth; bar.classList.add('flash');
    if (typeof sfx === 'function') sfx('fanfare');
    if (typeof Fx2D === 'undefined' || typeof motionOK === 'function' && !motionOK()) return;
    const cv = el('canvas', 'xp-fx'), w = box.clientWidth || 300, h = 140;
    box.append(cv);
    const r = Fx2D.fit(cv, w, h), fx = Fx2D.create({ cap: 160 }), g = cv.getContext('2d');
    if (!g) { cv.remove(); return; }
    fx.burst(w * r * 0.5, h * r * 0.55, 60, { colors: ['#ffb703', '#ef476f', '#06d6a0', '#8ecae6', '#cc5de8', '#fff'], speed: [120 * r, 380 * r], gravity: 700 * r, size: 6 * r, up: 160 * r });
    fx.ring(w * r * 0.5, h * r * 0.55, { r0: 10 * r, r1: 120 * r, color: '#ffd166', width: 4 * r, life: 0.6 });
    let t = performance.now();
    const loop = (now) => {
      const live = fx.step(Math.min(0.05, (now - t) / 1000)); t = now;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
      fx.begin(g); fx.draw(g); fx.end(g);
      if (live && cv.isConnected) requestAnimationFrame(loop); else cv.remove();
    };
    requestAnimationFrame(loop);
  }

  // ---------- the level bar (record sheet header, home screen line)
  function levelBar(p = get(), compact = false) {
    const L = levelOf(p.xp), lk = look(p), box = el('div', compact ? 'lvl-line' : 'lvl-head');
    const badge = el('span', 'lvl-badge', `Lv ${L.lvl}`);
    const txt = el('span', 'lvl-txt');
    txt.append(el('b', '', titleName(lk.title) || (compact ? 'Your level' : 'Level ' + L.lvl)),
      el('small', '', L.need ? `${L.need - L.into} XP to Lv ${L.lvl + 1}` : `${L.xp.toLocaleString()} XP · top level`));
    const bar = el('div', 'xp-bar'), fill = el('i'); fill.style.width = L.need ? `${(100 * L.into) / L.need}%` : '100%'; bar.append(fill);
    txt.append(bar);
    box.append(badge, txt);
    return box;
  }
  // the home screen's compact level line (opens the record)
  function homeLine(btn) {
    if (!btn) return;
    btn.replaceChildren(levelBar(get(), true));
    btn.title = 'Your level and XP: open 🏆 My record';
  }
  const setLook = (kind, id) => { const p = get(); p.look = { ...(p.look || {}), [kind]: id }; store(KEY, p); sync(); onLook?.(); };
  let onLook = null;

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
    body.append(levelBar(p), unlockTrack(p), lookPickers(p), iconPicker());
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
      const hr = el('tr'); for (const h of ['', 'Bots', 'Played', 'Won', 'Historical best']) hr.append(el('th', '', h));
      t.append(hr);
      for (const [gid, g] of games.sort((a, b) => b[1].played - a[1].played)) {
        const tr = el('tr');
        tr.append(el('td', '', label(gid)), el('td', 'rec-stars', starText(g.stars || 0)), el('td', '', g.played), el('td', '', g.wins),
          el('td', '', g.best != null ? fmt(g.best) : ''));
        if (g.data?.elo) tr.lastChild.append(el('div', 'hint', `♟ Elo ${g.data.elo}`));
        const lv = g.data?.levels && Object.values(g.data.levels).reduce((a, b) => a + b, 0);
        if (lv) tr.lastChild.append(el('div', 'hint', `🎯 ${lv}★`));
        t.append(tr);
      }
      body.append(el('h4', '', '🎮 By game'), t);
    } else body.append(el('p', 'hint', 'Finish a game and it shows up here. Win alone against bots to earn ★ stars: Easy, Normal, then Hard.'));
    const benchmarks = Object.values(p.benchmarks || {}).sort((a, b) => b.recent.at(-1)[1] - a.recent.at(-1)[1]);
    if (benchmarks.length) {
      const table = el('table', 'rec-table');
      const head = el('tr');
      for (const heading of ['Game and rules', 'Recent', 'All-time best']) head.append(el('th', '', heading));
      table.append(head);
      for (const b of benchmarks) {
        const row = el('tr'), game = el('td', '', label(b.game));
        const wins = winRecord(b.kind);
        game.append(el('div', 'hint', b.label));
        const recent = wins ? `${recentValue(b)} wins in ${b.recent.length}` : recordValue(recentValue(b), b.kind);
        const best = b.best == null ? '—' : wins ? `${b.best} wins in 5` : recordValue(b.best, b.kind);
        row.append(game, el('td', '', recent), el('td', '', best));
        table.append(row);
      }
      body.append(el('h4', '', 'Personal benchmarks'), table);
    }
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
    body.append(el('p', 'hint', `Kept since ${p.since}, on this device and backed up on the server (device ${dev().id.slice(0, 6)}).`));
    return ask('', { title: '🏆 My record', body, ok: 'Close', cancel: '' });
  }

  // #144 pick your icon: Auto (the face your name gives you), a page of generated faces (🎲 for another page) or an
  // emoji. Kept on this device; app.js sends it to every room you're in.
  const EMOJI = ['🦊', '🐼', '🐸', '🐙', '🦁', '🐯', '🐨', '🐵', '🦄', '🐲', '🐧', '🦉', '🐢', '🦖', '🐝', '🦋', '🐳', '🦈', '🐺', '🐱',
    '🐶', '🐰', '🦝', '🦔', '🍄', '🌵', '🌻', '🍀', '🔥', '⭐', '🌙', '⚡', '🎸', '🎲', '🚀', '👾', '🤖', '👻', '🎃', '🍕'];
  let facePage = 0;
  function iconPicker() {
    const box = el('div', 'icon-box'), cur = load('gn.icon') || '';
    box.append(el('h4', '', '🙂 Your icon'));
    const grid = el('div', 'icon-pick');
    const pickBtn = (val, fill, title) => {
      const b = el('button', val === cur ? 'on' : ''); b.type = 'button'; b.title = title;
      if (typeof fill === 'string') b.textContent = fill; else b.append(fill);
      b.onclick = () => {
        store('gn.icon', val || null);
        grid.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on');
        if (typeof S !== 'undefined' && S) { iconSentAt = 0; syncIcon(S); }
      };
      return b;
    };
    const auto = pickBtn('', 'Auto', 'The face your name gives you'); auto.classList.add('auto'); grid.append(auto);
    const faces = el('span'); faces.style.display = 'contents';
    const fillFaces = () => {
      faces.innerHTML = '';
      for (let k = 0; k < 12; k++) {
        const val = `f:${facePage * 12 + k}`, f = el('span'); f.innerHTML = faceSVG(avatarFace(val));
        faces.append(pickBtn(val, f.firstChild, 'A face'));
      }
    };
    if (typeof faceSVG === 'function') { fillFaces(); grid.append(faces); }
    const more = el('button', 'auto', '🎲'); more.type = 'button'; more.title = 'More faces';
    more.onclick = () => { facePage = (facePage + 1) % 800; fillFaces(); };
    grid.append(more);
    for (const e of EMOJI) grid.append(pickBtn(e, e, 'Use ' + e));
    box.append(grid);
    // ✨ the packs levels unlock; locked ones show greyed with the level that opens them
    for (const [id, list] of Object.entries(PACKS)) {
      const open = unlocked('pack', id), name = UNLOCKS.find((u) => u[1] === 'pack' && u[2] === id)[3];
      const h = el('div', 'pack-head' + (open ? '' : ' locked'), open ? name : `${name} · ${lockText('pack', id)}`);
      const g2 = el('div', 'icon-pick' + (open ? '' : ' locked'));
      for (const e of list) {
        const b = pickBtn(e, e, open ? 'Use ' + e : `Opens at level ${unlockAt('pack', id)}`);
        if (!open) { b.disabled = true; b.onclick = null; }
        g2.append(b);
      }
      box.append(h, g2);
    }
    return box;
  }
  // the next unlocks, in a strip under the level bar
  function unlockTrack(p) {
    const lvl = level(p), next = UNLOCKS.filter((u) => u[0] > lvl).slice(0, 5);
    const row = el('div', 'unlock-track');
    if (!next.length) { row.append(el('span', 'ut-item got', '👑 Everything unlocked')); return row; }
    for (const [n, kind, , name] of next) {
      const it = el('span', 'ut-item');
      it.append(el('i', '', KIND_ICON[kind]), el('b', '', name), el('small', '', `🔒 Lv ${n}`));
      row.append(it);
    }
    return row;
  }
  // pick your frame, title and card back (locked ones greyed with the level that opens them)
  function lookPickers(p) {
    const box = el('div', 'look-pick'), lk = look(p);
    const picker = (kind, label, cur, onPick, noneLabel = 'None') => {
      const lab = el('label', '', label), sel = el('select');
      if (noneLabel) sel.append(Object.assign(el('option', '', noneLabel), { value: '' }));
      for (const [n, k, id, name] of UNLOCKS) {
        if (k !== kind) continue;
        const o = Object.assign(el('option', '', n > level(p) ? `${name} · 🔒 Lv ${n}` : name), { value: id });
        o.disabled = n > level(p); sel.append(o);
      }
      sel.value = cur || '';
      sel.onchange = () => onPick(sel.value);
      lab.append(sel); box.append(lab);
    };
    picker('frame', '🖼️ Frame', lk.frame, (v) => setLook('frame', v));
    picker('title', '🏷️ Title', lk.title, (v) => setLook('title', v));
    if (typeof prefs !== 'undefined') {
      const base = typeof CARD_BACKS !== 'undefined' ? CARD_BACKS.filter(([k]) => !UNLOCKS.some((u) => u[2] === k && u[1] === 'back')) : [];
      const lab = el('label', '', '🂠 Card back'), sel = el('select');
      for (const [k, name] of base) sel.append(Object.assign(el('option', '', name), { value: k }));
      for (const [n, k, id, name] of UNLOCKS) {
        if (k !== 'back') continue;
        const o = Object.assign(el('option', '', n > level(p) ? `${name} · 🔒 Lv ${n}` : name), { value: id }); o.disabled = n > level(p); sel.append(o);
      }
      sel.value = prefs.cardBack || 'blue';
      sel.onchange = () => { prefs.cardBack = sel.value; store('unmask.prefs', prefs); if (typeof applyPrefs === 'function') applyPrefs(); };
      lab.append(sel); box.append(lab);
    }
    return box;
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
  // per-game extras a game keeps on this device (Prism Pop: 🎯 level stars, XP, board theme)
  const best = (gid, rules) => rules ? get().benchmarks?.[rules.key]?.best ?? null : get().games[gid]?.best ?? null;
  const bestLabel = (gid, rules) => {
    const profile = get();
    const benchmark = rules ? profile.benchmarks?.[rules.key] : null;
    if (benchmark?.best != null) return recordValue(benchmark.best, benchmark.kind);
    const gameBest = profile.games?.[gid]?.best;
    return gameBest == null ? '' : recordValue(gameBest, profile.games?.[gid]?.low ? 'lowPoints' : 'points');
  };
  const gameData = (gid) => ({ ...(get().games[gid]?.data || {}) });
  function saveGameData(gid, data) { const p = get(); (p.games[gid] ||= { played: 0, wins: 0 }).data = data; store(KEY, p); }

  // for the picker's sorts (#98): how often, and when last, this device finished a game
  const played = (gid) => get().games[gid]?.played || 0;
  const lastAt = (gid) => get().games[gid]?.lastAt || '';

  return { chessElo, onState, replayGoal, formatBenchmark: recordValue, overLine, show, suggest, stars, tried, starText, showNew, best, bestLabel, gameData, saveGameData, played, lastAt,
    xpCard, homeLine, look, level, levelOf, xpFor, unlocked, unlockAt, titleName, lockText, sync, dev, migrate, UNLOCKS, PACKS,
    set onSynced(f) { onSynced = f; }, set onLook(f) { onLook = f; } };
})();
