// Core client: session, connection, lobby, game shell, log, chat, scoreboard, replays.
// Each game registers a UI module in window.UI (see static/games/*.js):
//   mount(main, side)   build the game's DOM once
//   render(S, ctx)      update it from the latest state
//   turnText?(S)        override the top-bar text (e.g. simultaneous games)
//   logButton?(entry)   optional button to attach to a log entry
//   unmount?()          stop loops / listeners when the game screen goes away
const $ = (s) => document.querySelector(s);
const REACTIONS = ['😂', '😱', '🤔', '😏', '🔥', '👀', '🙈', '🎉'];
const QUICK_CHAT = ['gg', 'nice! 👏', 'hmm… 🤔', 'your turn 😴', 'rematch? 🔁', 'no way 😱'];
const SOLO_GAMES = [['unmask', '🎭 Unmask'], ['doodle', '✏️ Doodle Dash'], ['lucky', '🎡 Lucky Letters'], ['wordsmith', '🔤 Wordsmith'], ['chess', '♟️ Chess'], ['checkers', '⛀ Checkers'],
  ['go', '⚫ Go'], ['lastcard', '🃏 Last Card'], ['seabattle', '🚢 Sea Battle'], ['dropfour', '🔴 Drop Four'],
  ['boxes', '🔳 Dots & Boxes'], ['tictactoe', '❌ Tic-Tac-Toe'], ['heist', '🥷 Night Heist'], ['moonshot', '🚀 Moon Shot'], ['spire', '🗼 Spire Siege'], ['hockey', '🏒 Air Hockey'], ['riders', '🏍️ Light Riders']];
const CATEGORIES = [['party', '🎉 Party'], ['action', '⚡ Action'], ['board', '♟️ Board'], ['cards', '🃏 Cards'],
  ['dice', '🎲 Dice'], ['words', '🔤 Words']];
const SOLO_BOTS = { riders: 3, doodle: 2, heist: 3, moonshot: 2, lastcard: 2, spire: 2, lucky: 2 };
const MODE_DESC = {
  duel: 'Duel: each of you hides a face. Questions are answered automatically and truthfully. A wrong accusation loses.',
  manhunt: 'Manhunt: everyone hunts the same hidden culprit. Your question is public, but only you hear the answer. Guess wrong and you become a ghost 👻.',
};
const PREFS = [
  ['sound', '🔊 Sound effects', true],
  ['vibrate', '📳 Vibrate on my turn', true],
  ['motion', '✨ Animations', true],
  ['bubbles', '💬 Chat pop-ups', true],
];

let session = load('unmask.session');
let prefs = { ...Object.fromEntries(PREFS.map(([k, , d]) => [k, d])), ...(load('unmask.prefs') || {}) };
let S = null;               // latest server state
let stateAt = 0;            // when S arrived (for the countdown)
let es = null;
let mounted = null;         // game id whose UI is mounted
let lastTurn = null;
let lastLogId = 0;
let lastChatId = null;
let unread = 0;
const seenReactions = new Set();
let firstState = true;
let lastBeat = 0;           // last time the server said anything (state or heartbeat)
let retryDelay = 1000;      // reconnect backoff
let retryTimer = null;
const HEARTBEAT_TIMEOUT = 25000;
let replay = null;          // { frames, i, timer } while watching a replay
// The last few JavaScript errors, so a bug report can say what actually broke.
const recentErrors = [];
function noteError(message, where) {
  recentErrors.push({ message: String(message).slice(0, 200), where, at: new Date().toISOString() });
  if (recentErrors.length > 5) recentErrors.shift();
}
addEventListener('error', (e) => noteError(e.message, `${(e.filename || '').split('/').pop()}:${e.lineno || '?'}`));
addEventListener('unhandledrejection', (e) => noteError(e.reason?.message || e.reason, 'promise'));

// ---------- utils
function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function store(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2800);
}
async function api(path, body) {
  let r;
  try {
    r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw Object.assign(new Error("Can't reach the server."), { network: true });
  }
  const j = await r.json().catch(() => ({ error: 'Bad response' }));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Request failed'), { network: r.status >= 500 });
  return j;
}
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
// Every action carries an id; the server applies each id once, so network retries are safe.
async function act(type, extra = {}) {
  const body = { ...session, type, ...extra, aid: newId() };
  for (let attempt = 0; ; attempt++) {
    try { return await api('/api/action', body); }
    catch (e) {
      if (e.network && attempt < 4) { await sleep(500 * 2 ** attempt); continue; }
      toast(e.message); throw e;
    }
  }
}
const quiet = (p) => p.catch(() => {});
// Real-time input: fire-and-forget, one request in flight. Positions (mallets) coalesce, so only the
// newest pending one is sent; inputs sent with keep = true (turns) are all delivered, in order.
const input = (() => {
  let busy = false, queue = [];
  const send = (data, keep = false) => {
    if (busy) { queue = keep ? [...queue, { data, keep }] : [...queue.filter((q) => q.keep), { data, keep }]; return; }
    busy = true;
    fetch('/api/input', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...session, ...data }) })
      .catch(() => {}).finally(() => { busy = false; const next = queue.shift(); if (next) send(next.data, next.keep); });
  };
  return send;
})();
// In-app dialog: resolves true (OK) or false (Cancel, Escape, tap outside).
function ask(text, { ok = 'OK', cancel = 'Cancel', danger = false, title = '', body = null } = {}) {
  ask.close?.(false);  // a newer question replaces an unanswered one
  return new Promise((resolve) => {
    const m = $('#modal');
    $('#modalTitle').textContent = title; $('#modalTitle').hidden = !title;
    $('#modalText').textContent = text; $('#modalText').hidden = !text;
    $('#modalBody').innerHTML = ''; if (body) $('#modalBody').append(body);
    $('#modalOk').textContent = ok; $('#modalOk').className = danger ? 'danger' : 'primary';
    $('#modalCancel').textContent = cancel || ''; $('#modalCancel').hidden = !cancel;
    const key = (e) => { if (e.key === 'Escape') done(false); };
    const done = (v) => {
      m.hidden = true; ask.close = null;
      document.removeEventListener('keydown', key);
      resolve(v);
    };
    ask.close = done;
    document.addEventListener('keydown', key);
    $('#modalOk').onclick = () => done(true);
    $('#modalCancel').onclick = () => done(false);
    m.onclick = (e) => { if (e.target === m) done(false); };
    m.hidden = false;
    $('#modalOk').focus();
  });
}
function showHelp(id = S?.gameId) {
  const g = gameInfo(id);
  const body = el('div');
  const ul = el('ul', 'rules');
  for (const line of g.howto) ul.append(el('li', '', line));
  const report = el('button', 'ghost-btn', `🐞 Something wrong with ${g.name}? Tell us`);
  report.onclick = () => reportDialog('bug');
  body.append(ul, report);
  ask(g.blurb, { title: `${g.icon} How to play ${g.name}`, body, ok: 'Got it', cancel: '' });
}

// ---------- bug reports & suggestions
function reportContext() {
  const ctx = {
    screen: `${innerWidth}×${innerHeight}`, userAgent: navigator.userAgent.slice(0, 200),
    view: replay ? 'replay' : ['home', 'lobby', 'game'].find((id) => !$('#' + id).hidden),
    errors: recentErrors,
  };
  if (S) {  // never the seat token or player id
    Object.assign(ctx, {
      room: S.code, game: S.gameId, phase: S.phase, settings: S.settings, players: S.players.length,
      bots: S.players.filter((p) => p.bot).map((p) => p.bot),
      me: { spectator: S.me.spectator, eliminated: S.me.eliminated, myTurn: S.turn === S.me.id },
      recentLog: S.log.slice(-5).map((e) => e.text),
    });
  }
  return ctx;
}

async function reportDialog(kind = 'bug', draft = '') {
  const body = el('div', 'report');
  const kinds = el('div', 'seg');
  for (const [value, label] of [['bug', '🐞 Bug'], ['idea', '💡 Suggestion']]) {
    const lab = el('label', 'seg-opt');
    const r = el('input'); r.type = 'radio'; r.name = 'reportKind'; r.value = value; r.checked = value === kind;
    lab.append(r, label); kinds.append(lab);
  }
  const text = el('textarea'); text.id = 'reportText'; text.maxLength = 2000; text.rows = 5; text.value = draft;
  const placeholder = () => (body.querySelector('input[name=reportKind]:checked').value === 'bug'
    ? 'What happened, and what did you expect? Which game?' : 'What would make Game Night more fun?');
  const details = el('label', 'check');
  const include = el('input'); include.type = 'checkbox'; include.checked = true; include.id = 'reportDetails';
  details.append(include, 'Include technical details');
  const peek = el('button', 'ghost-btn', 'What’s included?'); peek.type = 'button';
  const pre = el('pre', 'report-pre'); pre.hidden = true;
  peek.onclick = () => { pre.textContent = JSON.stringify(reportContext(), null, 2); pre.hidden = !pre.hidden; };
  body.append(kinds, text, details, peek, pre,
    el('p', 'hint left', 'Sent to whoever runs this Game Night server, along with your name.'));
  kinds.onchange = () => { text.placeholder = placeholder(); };
  text.placeholder = placeholder();
  setTimeout(() => text.focus(), 50);

  if (!(await ask('', { title: 'Report a bug or suggest an idea', body, ok: 'Send' }))) return;
  const chosen = body.querySelector('input[name=reportKind]:checked').value;
  if (text.value.trim().length < 5) {
    toast('Please describe it in a few words.');
    return reportDialog(chosen, text.value);
  }
  try {
    const res = await api('/api/feedback', {
      kind: chosen, text: text.value, name: S?.me.name || $('#name').value,
      context: include.checked ? reportContext() : {},
    });
    toast(`Thanks! ${chosen === 'bug' ? 'Bug report' : 'Suggestion'} #${res.id} sent.`);
  } catch (e) {
    toast(e.message);
    if (e.network) reportDialog(chosen, text.value);  // keep their words if the network blipped
  }
}
const logHasEntries = () => $('#log').childElementCount > 0;
function show(id) {
  for (const s of ['home', 'lobby', 'game']) $('#' + s).hidden = s !== id;
  $('#fabs').hidden = id === 'home';
  if (id === 'home') { $('#chatPanel').hidden = true; }
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const player = (id) => S.players.find((p) => p.id === id);
const gameInfo = (id = S.gameId) => S.games.find((g) => g.id === id);

// ---------- sound (tiny WebAudio blips, no files)
let audio;
function blip(kind) {
  if (!prefs.sound) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const notes = { turn: [660, 880], chat: [520], win: [523, 659, 784, 1047], lose: [392, 330] }[kind];
    notes.forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * 0.11;
      o.frequency.value = f; o.type = 'triangle';
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.15, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.2);
    });
  } catch {}
}

// ---------- connection
function enter(res) { session = res; store('unmask.session', res); store('unmask.name', $('#name').value.trim()); connect(); }
function connect() {
  if (es) es.close();
  clearTimeout(retryTimer);
  firstState = true; mounted = null; lastLogId = 0; lastBeat = performance.now();
  const source = es = new EventSource('/api/events?' + new URLSearchParams(session));
  source.onopen = () => { retryDelay = 1000; };
  source.onmessage = (e) => { beat(); onState(JSON.parse(e.data)); };
  source.addEventListener('ping', beat);
  source.addEventListener('fast', (e) => { beat(); if (mounted && !replay) UI[mounted]?.fast?.(JSON.parse(e.data)); });
  source.onerror = () => {
    setBanner(true);
    // CONNECTING = the browser is already retrying. CLOSED = it gave up (e.g. the server
    // answered with an error), so check whether our seat still exists before giving up too.
    if (source.readyState === EventSource.CLOSED && es === source) verifySeat();
  };
}
function beat() { lastBeat = performance.now(); setBanner(false); }
function setBanner(down) {
  clearTimeout(setBanner.t);
  if (!down) { $('#connBanner').hidden = true; return; }
  setBanner.t = setTimeout(() => ($('#connBanner').hidden = false), 1500);  // ignore blips
}
async function verifySeat() {
  if (!session) return;
  try {
    await api('/api/status', session);
    reconnectSoon();                      // seat is fine: the stream just broke
  } catch (e) {
    if (e.network) return reconnectSoon(); // server unreachable: keep trying
    leaveLocal(); toast(`${e.message} Your seat is gone.`);
  }
}
function reconnectSoon() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => session && connect(), retryDelay);
  retryDelay = Math.min(retryDelay * 2, 15000);
}
function checkLiveness() {
  if (session && es && performance.now() - lastBeat > HEARTBEAT_TIMEOUT) { setBanner(true); connect(); }
}
setInterval(checkLiveness, 5000);
// Presence heartbeat: tells the server this page is alive (it can't see dead connections).
async function presence() {
  if (!session || document.hidden) return;
  try { await api('/api/status', session); }
  catch (e) { if (!e.network && session) { leaveLocal(); toast(`${e.message} Your seat is gone.`); } }
}
setInterval(presence, 10000);
// Phones freeze background tabs and change networks: re-check as soon as we're back.
document.addEventListener('visibilitychange', () => { if (!document.hidden) { presence(); checkLiveness(); } });
addEventListener('online', () => { if (session) connect(); });
addEventListener('beforeunload', (e) => {
  if (S?.phase === 'playing' && !S.me.spectator && !S.me.eliminated) { e.preventDefault(); e.returnValue = ''; }  // desktop: confirm leaving
});
function unmountUI() {
  if (mounted) UI[mounted]?.unmount?.();
  mounted = null;
}
function leaveLocal() {
  clearTimeout(retryTimer); setBanner(false); stopReplay(false); unmountUI();
  if (es) es.close(); es = null; session = null; S = null; lastChatId = null; unread = 0; renderChat.key = null;
  store('unmask.session', null); history.replaceState(null, '', '/'); show('home');
}

function onState(s) {
  const prev = S;
  S = s; stateAt = performance.now();
  history.replaceState(null, '', '?room=' + s.code);
  if (prev && prev.phase === 'playing' && s.phase === 'over' && !firstState) {
    blip(s.winner === s.me.id ? 'win' : 'lose');
    if (s.winner === s.me.id) confetti();
  }
  if (!replay) {
    if (s.phase === 'lobby') { show('lobby'); renderLobby(); unmountUI(); }
    else { show('game'); renderGame(); }
  }
  renderReactions();
  renderChat();
  firstState = false;
}

// ---------- lobby
function renderLobby() {
  const host = S.host === S.me.id;
  const info = gameInfo();
  $('#lobbyCode').textContent = S.code;

  const pick = $('#gamePicker'); pick.innerHTML = '';
  const seated = S.players.filter((p) => !p.spectator).length;
  for (const [cat, label] of CATEGORIES) {
    const games = S.games.filter((g) => g.category === cat);
    if (!games.length) continue;
    pick.append(el('div', 'picker-cat', label));
    for (const g of games) {
      const fit = seated < g.min ? `needs ${g.min}+` : seated > g.max ? `max ${g.max}` : '';
      const b = el('button', 'game-tile' + (g.id === S.gameId ? ' on' : '') + (fit ? ' nofit' : ''));
      b.append(el('span', 'gicon', g.icon), el('b', '', g.name),
        el('small', '', fit || (g.min === g.max ? `${g.min} players` : `${g.min}–${g.max} players`)));
      b.disabled = !host && g.id !== S.gameId;
      b.setAttribute('aria-pressed', g.id === S.gameId);
      b.onclick = () => host && quiet(act('settings', { settings: { game: g.id } }));
      pick.append(b);
    }
  }
  $('#gameDesc').textContent = info.blurb + (S.gameId === 'unmask' ? ' ' + MODE_DESC[S.settings.mode] : '');
  $('#howto').innerHTML = '';
  for (const line of info.howto) $('#howto').append(el('li', '', line));

  const ul = $('#lobbyPlayers'); ul.innerHTML = '';
  for (const p of S.players) {
    const li = el('li');
    const dot = el('span', 'dot'); dot.style.background = p.online ? p.color : '#555';
    li.append(dot, el('span', '', p.name + (p.id === S.me.id ? ' (you)' : '')));
    if (p.id === S.host) li.append(el('span', '', '👑'));
    if (p.spectator) li.append(el('span', 'hint', 'spectating'));
    if (p.wins) li.append(el('span', 'hint', `🏆 ${p.wins}`));
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
    const label = f.key === 'timer' && S.gameId === 'heist' ? 'Night timer' : f.label;
    const lab = el('label', '', label);
    const sel = el('select');
    for (const [v, l] of f.options) { const o = el('option', '', l); o.value = JSON.stringify(v); sel.append(o); }
    sel.value = JSON.stringify(S.settings[f.key]);
    sel.disabled = !host;
    sel.onchange = () => quiet(act('settings', { settings: { [f.key]: JSON.parse(sel.value) } }));
    lab.append(sel); box.append(lab);
  }
  $('#startBtn').hidden = !host; $('#waitHost').hidden = host; $('#botRow').hidden = !host;
  $('#lobbyReplayBtn').hidden = !S.hasReplay;
  renderScores(host);
}

function renderScores(host) {
  const played = S.players.filter((p) => p.played);
  $('#scoreSection').hidden = !played.length && !S.history.length;
  const board = $('#scoreboard'); board.innerHTML = '';
  if (played.length) {
    const games = [...new Set(played.flatMap((p) => Object.keys(p.byGame)))];
    const t = el('table', 'scores');
    const head = el('tr');
    head.append(el('th', '', 'Player'), el('th', '', '🏆'), el('th', '', 'Played'), el('th', '', '🔥 Best'),
      ...games.map((g) => el('th', '', gameInfo(g)?.icon ?? g)));
    t.append(head);
    for (const p of [...played].sort((a, b) => b.wins - a.wins || a.played - b.played)) {
      const tr = el('tr');
      const name = el('td', '', p.name); name.style.color = p.color;
      tr.append(name, el('td', '', p.wins), el('td', '', p.played),
        el('td', '', p.best + (p.streak > 1 ? ` (now ${p.streak})` : '')),
        ...games.map((g) => el('td', '', p.byGame[g] || '')));
      t.append(tr);
    }
    board.append(t);
  }
  const hist = $('#history'); hist.innerHTML = '';
  for (const h of [...S.history].reverse()) {
    const li = el('li');
    li.append(el('b', '', `${h.icon} ${h.name}`), ` — ${h.winner ? '🏆 ' + h.winner : 'no winner'}`);
    const scored = h.players.filter((x) => x.score != null);
    if (scored.length) li.append(el('div', 'hint left', scored.map((x) => `${x.name} ${x.score}`).join(' · ')));
    hist.append(li);
  }
  $('#resetScoresBtn').hidden = !host;
}

// ---------- game shell
function renderGame(view = S, readOnly = false) {
  const ui = UI[view.gameId];
  if (mounted !== view.gameId) {
    unmountUI();
    $('#arena').innerHTML = ''; $('#sideGame').innerHTML = '';
    ui.mount($('#arena'), $('#sideGame'));
    mounted = view.gameId;
  }
  const me = view.me, playing = view.phase === 'playing', myTurn = !readOnly && playing && view.turn === me.id;
  $('#gameCode').textContent = `${gameInfo(view.gameId).icon} ${S.code}`;

  const tt = $('#turnText');
  const custom = readOnly ? null : ui.turnText?.(view);
  const turnName = view.players.find((p) => p.id === view.turn)?.name ?? '…';
  tt.textContent = readOnly ? `▶ Replay — ${playing ? `${turnName}'s turn` : 'final position'}`
    : custom ?? (!playing ? 'Game over' : myTurn ? '✨ Your turn!' : `${turnName}'s turn`);
  tt.classList.toggle('mine', myTurn || (!readOnly && !!ui.myMove?.(view)));
  if (!readOnly) {
    if (myTurn && lastTurn !== me.id && !firstState) {
      blip('turn');
      flashTurn();
      if (prefs.vibrate) navigator.vibrate?.(120);
    }
    document.title = myTurn ? '🔔 Your turn — Game Night' : 'Game Night';
    lastTurn = view.turn;
  }

  const chips = $('#players'); chips.innerHTML = '';
  for (const p of view.players) {
    const c = el('div', 'chip' + (p.id === view.turn ? ' turn-now' : '') + (p.eliminated ? ' out' : ''));
    const dot = el('span', 'dot'); dot.style.background = p.online ? p.color : '#555';
    c.append(dot, el('b', '', p.name));
    const bits = [p.spectator ? '👁 watching' : p.meta, p.wins ? '🏆' + p.wins : '', p.eliminated ? '👻' : '',
      p.standin ? '🤖 autopilot' : p.away ? '📡 away' : ''].filter(Boolean);
    if (bits.length) c.append(el('span', 'meta', bits.join(' · ')));
    chips.append(c);
  }

  const lookup = (id) => view.players.find((p) => p.id === id);
  const readOnlyAct = () => { toast('This is a replay.'); return Promise.reject(new Error('replay')); };
  ui.render(view, { act: readOnly ? readOnlyAct : act, input: readOnly ? () => {} : input, quiet, toast, el, ask, player: lookup, myTurn,
    rerender: () => (replay ? showFrame() : renderGame()) });
  renderLog(ui, view);

  $('#overBanner').hidden = readOnly || view.phase !== 'over';
  if (!readOnly && view.phase === 'over') renderOver();
}

function renderOver() {
  const me = S.me, host = S.host === me.id;
  const w = player(S.winner);
  $('#overText').textContent = w ? (w.id === me.id ? '🏆 You win!' : `🏆 ${w.name} wins!`) : (S.log.at(-1)?.text ?? 'Game over');
  $('#overBanner').classList.toggle('won', w?.id === me.id);
  const last = S.history.at(-1);
  const scored = last?.players.filter((x) => x.score != null) ?? [];
  $('#overScores').textContent = scored.length
    ? [...scored].sort((a, b) => b.score - a.score).map((x) => `${x.name}: ${x.score}`).join(' · ') : '';
  const readyNames = S.ready.map((id) => player(id)?.name).filter(Boolean);
  $('#rematchBtn').hidden = !host; $('#lobbyBtn').hidden = !host;
  $('#readyBtn').textContent = S.ready.includes(me.id) ? '✋ Ready!' : "🙋 I'm in!";
  $('#readyBtn').classList.toggle('on', S.ready.includes(me.id));
  $('#replayBtn').hidden = !S.hasReplay;
  $('#overWait').textContent = (readyNames.length ? `Ready for more: ${readyNames.join(', ')}. ` : '')
    + (host ? '' : 'Waiting for the host…');
}

function renderLog(ui, view) {
  const newestId = view.log.at(-1)?.id ?? 0;
  // Fast games push many updates; only rebuild when the log (or a log button) can have changed.
  if (newestId === lastLogId && !ui.logButton && logHasEntries()) return;
  const box = $('#log'); box.innerHTML = '';
  for (const e of view.log) {
    const row = el('div', 'entry ' + e.kind, e.text);
    const b = replay ? null : ui.logButton?.(e);
    if (b) row.append(b);
    box.append(row);
  }
  $('#logLast').textContent = view.log.at(-1)?.text ?? '';
  if (newestId !== lastLogId) { box.scrollTop = box.scrollHeight; lastLogId = newestId; }
}

// ---------- replays
async function startReplay() {
  try {
    const { frames } = await api('/api/replay', session);
    if (frames.length < 2) return toast('No replay for that game.');
    replay = { frames, i: 0, timer: null };
    $('#rpSlider').max = frames.length - 1;
    $('#replayBar').hidden = false;
    show('game');
    unmountUI();
    showFrame();
  } catch (e) { toast(e.message); }
}
function showFrame() {
  const f = replay.frames[replay.i];
  const prev = replay.frames[replay.i - 1];
  $('#rpSlider').value = replay.i;
  // Some games don't log every move: then say whose turn it is rather than repeating an old line.
  const fresh = !prev || f.log.at(-1)?.id !== prev.log.at(-1)?.id;
  const turnName = f.players.find((p) => p.id === f.turn)?.name;
  const caption = fresh || !turnName ? f.log.at(-1)?.text ?? '' : `${turnName} to move`;
  $('#replayCaption').textContent = `Move ${replay.i} / ${replay.frames.length - 1} — ${caption}`;
  renderGame(f, true);
}
function stepReplay(to) {
  if (!replay) return;
  replay.i = Math.max(0, Math.min(replay.frames.length - 1, to));
  showFrame();
  if (replay.i === replay.frames.length - 1) pauseReplay();
}
function pauseReplay() { if (replay) { clearInterval(replay.timer); replay.timer = null; $('#rpPlay').textContent = '▶'; } }
function stopReplay(rerender = true) {
  if (!replay) return;
  pauseReplay(); replay = null; unmountUI();
  $('#replayBar').hidden = true;
  if (rerender && S) onState(S);
}

// ---------- chat
function renderChat() {
  const chatKey = `${S.chat.length}:${S.chat.at(-1)?.id}:${S.phase}`;
  if (chatKey === renderChat.key) return;
  renderChat.key = chatKey;
  const list = $('#chatList');
  const fresh = S.chat.filter((m) => lastChatId == null || m.id > lastChatId);
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.innerHTML = '';
  for (const m of S.chat) {
    const row = el('div', 'msg' + (m.pid === S.me.id ? ' mine' : '') + (m.ghost ? ' ghost' : ''));
    const who = el('b', '', (m.ghost ? '👻 ' : '') + m.name); who.style.color = m.color;
    row.append(who, el('span', '', m.text));
    list.append(row);
  }
  if (atBottom || fresh.some((m) => m.pid === S.me.id)) list.scrollTop = list.scrollHeight;
  const inbound = fresh.filter((m) => m.pid !== S.me.id);
  if (lastChatId != null && inbound.length) {
    if ($('#chatPanel').hidden) {
      unread += inbound.length;
      const m = inbound.at(-1);
      if (prefs.bubbles) {
        const b = $('#chatBubble'); b.textContent = `${m.name}: ${m.text}`; b.hidden = false;
        clearTimeout(renderChat.t); renderChat.t = setTimeout(() => (b.hidden = true), 3500);
      }
    }
    blip('chat');
  }
  lastChatId = S.chat.at(-1)?.id ?? lastChatId ?? 0;
  $('#chatBadge').hidden = !unread; $('#chatBadge').textContent = unread;
  const ghostOnly = S.phase === 'playing' && S.me.ghost && S.settings.ghost_chat === 'private';
  $('#chatNote').textContent = ghostOnly ? '👻 only ghosts & spectators see your messages' : '';
}
function sendChat(text) {
  if (!text.trim()) return;
  quiet(act('chat', { text }));
}

// ---------- reactions
function renderReactions() {
  for (const r of S.reactions) {
    if (seenReactions.has(r.id)) continue;
    seenReactions.add(r.id);
    if (firstState || !prefs.motion) continue;
    const f = el('div', 'floater', r.emoji);
    f.style.left = 10 + Math.random() * 80 + '%';
    f.append(el('small', '', player(r.pid)?.name ?? ''));
    $('#floaters').append(f);
    setTimeout(() => f.remove(), 2700);
  }
}

// ---------- board helpers for game modules
/** Animate a freshly rendered piece sliding in from dr/dc squares away (board may be shown flipped). */
function slideFrom(piece, dr, dc, flipped) {
  const s = flipped ? -1 : 1;
  piece.style.setProperty('--dx', dc * s);
  piece.style.setProperty('--dy', dr * s);
  piece.classList.add('slide');
}

// ---------- celebrations (skipped when animations are off)
const motionOK = () => prefs.motion && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
function flashTurn() {
  if (!motionOK()) return;
  let g = $('#turnGlow');
  if (!g) { g = el('div', 'turn-glow'); g.id = 'turnGlow'; document.body.append(g); }
  g.classList.remove('on'); void g.offsetWidth; g.classList.add('on');  // restart the animation
}
function confetti() {
  if (!motionOK()) return;
  const colors = ['#ffb703', '#ef476f', '#06d6a0', '#8ecae6', '#cc5de8', '#fff'];
  for (let i = 0; i < 70; i++) {
    const c = el('div', 'confetti');
    c.style.left = Math.random() * 100 + '%';
    c.style.background = colors[i % colors.length];
    c.style.setProperty('--x', (Math.random() - 0.5) * 30 + 'vw');
    c.style.setProperty('--r', (Math.random() - 0.5) * 1440 + 'deg');
    c.style.setProperty('--t', 1.8 + Math.random() * 1.6 + 's');
    c.style.animationDelay = Math.random() * 0.4 + 's';
    $('#floaters').append(c);
    setTimeout(() => c.remove(), 4000);
  }
}

// ---------- personal settings
function applyPrefs() { document.body.classList.toggle('calm', !prefs.motion); }
function renderPrefs() {
  const box = $('#prefsList'); box.innerHTML = '';
  for (const [key, label] of PREFS) {
    const lab = el('label', 'check');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = prefs[key];
    cb.onchange = () => { prefs[key] = cb.checked; store('unmask.prefs', prefs); applyPrefs(); if (key === 'sound' && cb.checked) blip('chat'); };
    lab.append(cb, label);
    box.append(lab);
  }
}

// ---------- wiring
$('#name').value = load('unmask.name') || '';
for (const [id, label] of SOLO_GAMES) { const o = el('option', '', label); o.value = id; $('#soloGame').append(o); }
$('#soloGame').value = load('unmask.soloGame') || 'unmask';
$('#createBtn').onclick = () => api('/api/create', { name: $('#name').value }).then(enter).catch((e) => toast(e.message));
$('#soloBtn').onclick = async () => {
  const game = $('#soloGame').value;
  store('unmask.soloGame', game);
  try {
    enter(await api('/api/create', { name: $('#name').value, game }));
    for (let i = 0; i < (SOLO_BOTS[game] || 1); i++) await act('add_bot', { level: $('#soloLevel').value });
    await act('start');
  } catch (e) { toast(e.message); }
};
$('#addBotBtn').onclick = () => quiet(act('add_bot', { level: $('#botLevel').value }));
$('#joinBtn').onclick = () => api('/api/join', { name: $('#name').value, code: $('#code').value.trim() }).then(enter).catch((e) => toast(e.message));
$('#code').addEventListener('keydown', (e) => e.key === 'Enter' && $('#joinBtn').click());
$('#shareBtn').onclick = async () => {
  const url = `${location.origin}/?room=${S.code}`;
  if (navigator.share) { navigator.share({ title: 'Join my Game Night room', url }).catch(() => {}); return; }
  try { await navigator.clipboard.writeText(url); toast('Invite link copied!'); }
  catch {
    const input = el('input'); input.value = url; input.readOnly = true;
    input.onfocus = () => input.select();
    ask('Copy this link and send it to your friends:', { title: 'Invite link', body: input, ok: 'Done', cancel: '' });
  }
};
$('#startBtn').onclick = () => quiet(act('start'));
$('#rematchBtn').onclick = () => quiet(act('rematch'));
$('#lobbyBtn').onclick = () => quiet(act('lobby'));
$('#readyBtn').onclick = () => quiet(act('ready'));
$('#replayBtn').onclick = startReplay;
$('#lobbyReplayBtn').onclick = startReplay;
$('#resetScoresBtn').onclick = async () =>
  (await ask('Reset the scoreboard and match history for everyone?', { ok: 'Reset', danger: true })) && quiet(act('reset_scores'));
const leave = async () => {
  const playing = S?.phase === 'playing' && !S.me.spectator && !S.me.eliminated;
  if (await ask(playing ? 'Leave this room? You will forfeit the current game.' : 'Leave this room?', { ok: 'Leave', danger: playing }))
    act('leave').catch(() => {}).then(leaveLocal);
};
$('#helpBtn').onclick = () => showHelp();
// Phones: fold the log into a one-line ticker so game controls sit right under the board.
const compact = window.matchMedia?.('(max-width: 860px)');
function setLogOpen(open) {
  $('#log').hidden = !open;
  $('#logToggle').setAttribute('aria-expanded', open);
  $('#logToggle').classList.toggle('open', open);
}
setLogOpen(!compact?.matches);
$('#logToggle').onclick = () => setLogOpen($('#log').hidden);
$('#leaveBtn').onclick = leave;
$('#quitBtn').onclick = leave;
for (const e of REACTIONS) {
  const b = el('button', '', e); b.onclick = () => quiet(act('react', { emoji: e }));
  $('#reactBar').append(b);
}
// replay controls
$('#rpFirst').onclick = () => stepReplay(0);
$('#rpPrev').onclick = () => { pauseReplay(); stepReplay(replay.i - 1); };
$('#rpNext').onclick = () => { pauseReplay(); stepReplay(replay.i + 1); };
$('#rpLast').onclick = () => stepReplay(Infinity);
$('#rpSlider').oninput = () => { pauseReplay(); stepReplay(+$('#rpSlider').value); };
$('#rpPlay').onclick = () => {
  if (replay.timer) return pauseReplay();
  if (replay.i >= replay.frames.length - 1) replay.i = 0;
  $('#rpPlay').textContent = '⏸';
  replay.timer = setInterval(() => stepReplay(replay.i + 1), 1200);
};
$('#rpExit').onclick = () => stopReplay();
// chat + prefs drawers
$('#chatBtn').onclick = () => {
  const open = $('#chatPanel').hidden;
  $('#chatPanel').hidden = !open; $('#prefsPanel').hidden = true;
  if (open) { unread = 0; $('#chatBadge').hidden = true; $('#chatBubble').hidden = true; $('#chatList').scrollTop = 1e9; $('#chatInput').focus(); }
};
$('#chatClose').onclick = () => ($('#chatPanel').hidden = true);
$('#chatBubble').onclick = () => $('#chatBtn').click();
$('#chatForm').onsubmit = (e) => { e.preventDefault(); sendChat($('#chatInput').value); $('#chatInput').value = ''; };
for (const q of QUICK_CHAT) { const b = el('button', '', q); b.type = 'button'; b.onclick = () => sendChat(q); $('#quickChat').append(b); }
$('#prefsBtn').onclick = () => { renderPrefs(); $('#prefsPanel').hidden = !$('#prefsPanel').hidden; $('#chatPanel').hidden = true; };
$('#prefsClose').onclick = () => ($('#prefsPanel').hidden = true);
$('#reportLink').onclick = () => reportDialog('bug');
$('#reportBtn').onclick = () => { $('#prefsPanel').hidden = true; reportDialog('bug'); };
applyPrefs();

setInterval(() => {
  const t = $('#timer');
  if (!S || replay || S.timeLeft == null || S.phase !== 'playing') { t.textContent = ''; return; }
  const left = Math.max(0, S.timeLeft - (performance.now() - stateAt) / 1000);
  t.textContent = '⏱ ' + Math.ceil(left) + 's';
  t.classList.toggle('urgent', left < 10);
}, 250);

const roomParam = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
if (roomParam) $('#code').value = roomParam;
if (session && (!roomParam || roomParam === session.code)) connect(); else show('home');
