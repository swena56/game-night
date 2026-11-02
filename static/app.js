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
const SOLO_GAMES = [['unmask', '🎭 Unmask'], ['oddone', '🕵️ Odd One Out'], ['relay', '🖍️ Scribble Relay'], ['trivia', '🧠 Trivia Rush'], ['fibfinder', '🤥 Fib Finder'], ['ladder', '🧗 Word Ladder'], ['doodle', '✏️ Doodle Dash'], ['lucky', '🎡 Lucky Letters'], ['wordsmith', '🔤 Wordsmith'], ['gridhunt', '🔎 Grid Hunt'], ['safecracker', '🔐 Safecracker'], ['chess', '♟️ Chess'], ['checkers', '⛀ Checkers'], ['backgammon', '🔺 Backgammon'], ['oware', '🌰 Oware'], ['reversi', '⚪ Reversi'],
  ['go', '⚫ Go'], ['lastcard', '🃏 Last Card'], ['holdem', "♠️ Texas Hold'em"], ['cribbage', '📍 Cribbage'], ['hearts', '♥️ Hearts'], ['speed', '⚡ Speed'], ['twentyone', '♦️ Twenty-One'], ['rummy', '🀄 Contract Rummy'], ['seabattle', '🚢 Sea Battle'], ['dropfour', '🔴 Drop Four'],
  ['boxes', '🔳 Dots & Boxes'], ['tictactoe', '❌ Tic-Tac-Toe'], ['ultimate', '#️⃣ Ultimate Tic-Tac-Toe'], ['morris', "⚫ Nine Men's Morris"], ['heist', '🦹 Night Heist'], ['moonshot', '🚀 Moon Shot'], ['yacht', '🎲 Yacht'], ['farkle', '🎯 Farkle'], ['qork', '🥤 Qork'], ['shipcrew', '🚢 Ship, Captain & Crew'], ['shutbox', '📦 Shut the Box'], ['liars', '🤥 Liar\'s Dice'], ['spire', '🗼 Spire Siege'], ['hockey', '🏒 Air Hockey'], ['billiards', '🎱 Billiards'], ['riders', '🏍️ Light Riders'], ['paintblast', '🎨 Paint Blast'], ['sumo', '🪐 Sumo Saucers'], ['putt', '⛳ Putt Party'], ['rally', '🛸 Hover Rally']];
const CATEGORIES = [['party', '🎉 Party'], ['action', '⚡ Action'], ['strategy', '♟️ Strategy'], ['classic', '✏️ Quick classics'],
  ['cards', '🃏 Cards'], ['dice', '🎲 Dice & casino'], ['words', '🔤 Words & puzzles']];
const SOLO_BOTS = { rally: 3, hearts: 3, twentyone: 2, rummy: 2, sumo: 3, paintblast: 3, gridhunt: 2, safecracker: 2, oddone: 3, relay: 3, fibfinder: 3, trivia: 3, ladder: 2, liars: 3, riders: 3, doodle: 2, heist: 3, moonshot: 2, lastcard: 2, holdem: 3, spire: 2, lucky: 2, qork: 3 };
const MODE_DESC = {
  duel: 'Duel: each of you hides a face. Questions are answered automatically and truthfully. A wrong accusation loses.',
  manhunt: 'Manhunt: everyone hunts the same hidden culprit. Your question is public, but only you hear the answer. Guess wrong and you become a ghost 👻.',
};
const PREFS = [
  ['sound', '🔊 Sound effects', true],
  ['moves', '🎵 Move sounds (pieces, cards, dice)', true],
  ['vibrate', '📳 Vibrate (your turn, hits)', true],
  ['motion', '✨ Animations', true],
  ['bubbles', '💬 Chat pop-ups', true],
];

let session = load('unmask.session');
let prefs = { ...Object.fromEntries(PREFS.map(([k, , d]) => [k, d])), ...(load('unmask.prefs') || {}) };
let S = null;               // latest server state
let stateAt = 0;            // when S arrived (for the countdown)
let es = null;
let mounted = null;         // game id whose UI is mounted
let mountedNo = null;       // which game of the room it was mounted for: a rematch gets a fresh UI (#53)
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
// a short message; with an action ({ label, run }) it gets a button (e.g. "↶ Undo") and stays up longer
function toast(msg, action = null) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  if (action) {
    const b = el('button', 'toast-btn', action.label);
    b.onclick = () => { t.hidden = true; action.run(); };
    t.append(' ', b);
  }
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), action ? 5000 : 2800);
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
  for (const s of ['loading', 'home', 'lobby', 'game']) $('#' + s).hidden = s !== id;
  if (id !== 'game') document.body.classList.remove('focus');
  if (id !== 'loading') clearTimeout(show.slow);
  $('#fabs').hidden = id === 'home';
  if (id === 'home') { $('#chatPanel').hidden = true; document.title = 'Game Night'; }
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const player = (id) => S.players.find((p) => p.id === id);
// every player colour has its own shape, so who's who never rests on colour alone
const SHAPES = { '#4dabf7': '●', '#ff922b': '▲', '#ff6b6b': '■', '#20c997': '◆', '#fcc419': '★', '#cc5de8': '✚', '#f06595': '⬟', '#51cf66': '⬢' };
// after a game draws, its player-coloured dots become that colour's shape too
function shapeDots(root) {
  for (const d of root.querySelectorAll('.dot:not(.shaped), .mini-disc:not(.shaped)')) {
    const m = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(d.style.backgroundColor || '');
    const hex = m && '#' + m.slice(1).map((x) => (+x).toString(16).padStart(2, '0')).join('');
    if (!hex || !SHAPES[hex] || d.textContent) continue;
    d.classList.add('shaped'); d.textContent = SHAPES[hex]; d.style.color = hex;
  }
}
// a small face for each player (by name), cached since the SVG is the same every time
const avatarCache = new Map();
function avatar(p) {
  const a = el('span', 'avatar');
  if (typeof faceSVG === 'function' && p?.name) {
    const key = p.name.replace(/^🤖\s*/, '');
    if (!avatarCache.has(key)) avatarCache.set(key, faceSVG(avatarFace(key)));
    a.innerHTML = avatarCache.get(key);
  }
  a.setAttribute('aria-hidden', 'true');
  return a;
}
function mark(p, online = true) {
  const m = el('span', 'pmark', SHAPES[p?.color] ?? '●');
  m.style.color = online ? p?.color ?? '#777' : '#555';
  m.setAttribute('aria-hidden', 'true');
  return m;
}
const gameInfo = (id = S.gameId) => S.games.find((g) => g.id === id);

// ---------- sound (tiny WebAudio blips, no files)
let audio;
// each lobby group has its own "your turn" chime, so a glance isn't needed to know which game is calling
const TURN_CHIMES = {
  strategy: [[523, 784], 'sine'], classic: [[660, 880], 'triangle'], cards: [[587, 740, 880], 'triangle'],
  dice: [[440, 554, 659], 'triangle'], words: [[784, 988], 'sine'], party: [[523, 659, 784], 'triangle'], action: [[880, 1175], 'sine'],
};
function blip(kind) {
  if (!prefs.sound) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const chime = kind === 'turn' ? TURN_CHIMES[S && gameInfo()?.category] : null;
    const notes = chime ? chime[0] : { turn: [660, 880], chat: [520], win: [523, 659, 784, 1047], lose: [392, 330] }[kind];
    notes.forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * 0.11;
      o.frequency.value = f; o.type = chime ? chime[1] : 'triangle';
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.15, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.2);
    });
  } catch {}
}

// a card slapped onto a pile: a short burst of filtered noise
function slap() {
  if (!prefs.sound) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const len = Math.floor(audio.sampleRate * 0.08), buf = audio.createBuffer(1, len, audio.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const src = audio.createBufferSource(), f = audio.createBiquadFilter(), g = audio.createGain();
    src.buffer = buf; f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7; g.gain.value = 0.5;
    src.connect(f).connect(g).connect(audio.destination); src.start();
  } catch {}
}

// Move sounds: every game gets a short sound for each move (a new log line), chosen by its lobby group,
// and game modules can ask for one with ctx.sfx(kind). All synthesized, no files.
function tone(f0, f1, dur, type = 'sine', vol = 0.12, at = 0) {
  const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + at;
  o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, freq, q, vol, at = 0) {
  const len = Math.max(1, Math.floor(audio.sampleRate * dur)), buf = audio.createBuffer(1, len, audio.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = audio.createBufferSource(), f = audio.createBiquadFilter(), g = audio.createGain();
  src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q; g.gain.value = vol;
  src.connect(f).connect(g).connect(audio.destination); src.start(audio.currentTime + at);
}
const SFX = {
  place: () => { tone(320, 180, 0.09, 'sine', 0.16); noise(0.03, 2400, 1.2, 0.25); },          // a piece set down
  capture: () => { tone(260, 120, 0.14, 'triangle', 0.16); noise(0.05, 1500, 0.8, 0.35, 0.02); },
  card: () => noise(0.08, 1800, 0.7, 0.5),
  dice: () => { for (let i = 0; i < 5; i++) noise(0.025, 2600 + Math.random() * 1600, 2, 0.35, i * 0.045 + Math.random() * 0.02); },
  pop: () => tone(520, 880, 0.09, 'sine', 0.1),
  tick: () => tone(1200, 1200, 0.03, 'square', 0.03),
  good: () => [659, 880].forEach((f, i) => tone(f, f, 0.16, 'triangle', 0.1, i * 0.09)),
  bad: () => tone(300, 150, 0.25, 'sawtooth', 0.05),
};
const CATEGORY_SFX = { strategy: 'place', classic: 'place', cards: 'card', dice: 'dice', words: 'pop', party: 'pop' };
function sfx(kind) {
  if (!prefs.sound || !prefs.moves || !SFX[kind] || document.hidden) return;
  try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); SFX[kind](); } catch {}
}

// ---------- connection
function enter(res) { session = res; store('unmask.session', res); store('unmask.name', $('#name').value.trim()); connect(); }
function connect() {
  if (es) es.close();
  clearTimeout(retryTimer);
  firstState = true; mounted = null; lastLogId = 0; lastBeat = performance.now();
  if (!S) showLoading();
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
function showLoading() {
  show('loading');
  $('#loadingSlow').hidden = true;
  show.slow = setTimeout(() => { $('#loadingSlow').hidden = false; }, 8000);
}
$('#loadingRetry').onclick = () => { if (session) connect(); };
$('#loadingHome').onclick = () => leaveLocal();

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
  s.games ??= prev?.games ?? [];  // the server sends the game catalogue once per connection
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
// Each category gets as few rows as fit, then the columns that fill those rows most evenly
// (8 games on a 4-wide screen: 4 + 4; 6 games: 3 + 3, never 4 + 2).
function fitPicker() {
  const width = $('#gamePicker').clientWidth;
  const most = width ? Math.max(2, Math.floor((width + 8) / 104)) : 4;
  for (const g of document.querySelectorAll('.picker-group')) {
    const n = +g.dataset.count, rows = Math.ceil(n / most);
    g.style.gridTemplateColumns = `repeat(${Math.ceil(n / rows)}, 1fr)`;
  }
}
window.addEventListener('resize', () => { if (!$('#lobby').hidden) fitPicker(); });
let pickedGame = null;  // the game this host just tapped, scrolled to once the server confirms it

// arrow keys move between game tiles by where they sit on screen, across categories (#37)
$('#gamePicker').addEventListener('keydown', (e) => {
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  const cur = document.activeElement;
  if (!dir || !cur?.classList.contains('game-tile')) return;
  e.preventDefault();
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
  best?.scrollIntoView({ block: 'nearest' });
});

function renderLobby() {
  const host = S.host === S.me.id;
  const info = gameInfo();
  $('#lobbyCode').textContent = S.code;

  const pick = $('#gamePicker');
  const focused = document.activeElement?.closest?.('#gamePicker .game-tile')?.dataset.game;  // keep keyboard focus across redraws (#37)
  pick.innerHTML = '';
  const seated = S.players.filter((p) => !p.spectator).length;
  for (const [cat, label] of CATEGORIES) {
    const games = S.games.filter((g) => g.category === cat);
    if (!games.length) continue;
    const group = el('div', 'picker-group');
    group.dataset.count = games.length;
    pick.append(el('div', 'picker-cat', label), group);
    for (const g of games) {
      const fit = seated < g.min ? `needs ${g.min}+` : seated > g.max ? `max ${g.max}` : '';
      const wishers = S.players.filter((p) => p.wish === g.id);
      const b = el('button', 'game-tile' + (g.id === S.gameId ? ' on' : '') + (fit ? ' nofit' : '')
        + (S.me && wishers.some((p) => p.id === S.me.id) ? ' wished' : ''));
      b.append(el('span', 'gicon', g.icon), el('b', '', g.name),
        el('small', '', fit || (g.min === g.max ? `${g.min} players` : `${g.min}–${g.max} players`)));
      // players ask the host for games; the host sees who asked (#70)
      if (wishers.length) {
        const w = el('span', 'wishes', `🙏${wishers.length > 1 ? ' ' + wishers.length : ''}`);
        w.title = 'Asked for by ' + wishers.map((p) => p.name).join(', ');
        b.append(w);
      }
      b.title = host ? '' : g.id === S.gameId ? 'The host picked this game' : 'Ask the host for this game (tap again to take it back)';
      b.setAttribute('aria-pressed', g.id === S.gameId);
      b.dataset.game = g.id;
      b.onclick = () => {
        if (host) { pickedGame = g.id; quiet(act('settings', { settings: { game: g.id } })); }
        else quiet(act('wish', { game: g.id }));
      };
      group.append(b);
    }
  }
  fitPicker();
  if (focused) pick.querySelector(`[data-game="${focused}"]`)?.focus({ preventScroll: true });
  // the chosen game sits above its rules and settings; after the host picks one, bring it into view (#38, #39)
  const chosen = $('#gameChosen'); chosen.innerHTML = '';
  chosen.append(el('span', 'gicon', info.icon), el('b', '', info.name));
  $('#settingsHead').textContent = `${info.name} settings`;
  document.title = `${info.name} — Game Night`;
  if (pickedGame && pickedGame === S.gameId) {
    pickedGame = null;
    requestAnimationFrame(() => chosen.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
  $('#gameDesc').textContent = info.blurb + (S.gameId === 'unmask' ? ' ' + MODE_DESC[S.settings.mode] : '');
  $('#howto').innerHTML = '';
  for (const line of info.howto) $('#howto').append(el('li', '', line));

  const ul = $('#lobbyPlayers'); ul.innerHTML = '';
  for (const p of S.players) {
    const li = el('li');
    li.append(avatar(p), mark(p, p.online), el('span', '', p.name + (p.id === S.me.id ? ' (you)' : '')));
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
  const played = S.players.filter((p) => p.played || p.points);
  $('#scoreSection').hidden = !played.length && !S.history.length;
  const board = $('#scoreboard'); board.innerHTML = '';
  if (played.length) {
    const games = [...new Set(played.flatMap((p) => Object.keys(p.byGame)))];
    const t = el('table', 'scores');
    const head = el('tr');
    head.append(el('th', '', 'Player'), el('th', '', '⭐'), el('th', '', '🏆'), el('th', '', 'Played'), el('th', '', '🔥 Best'),
      ...games.map((g) => el('th', '', gameInfo(g)?.icon ?? g)));
    t.append(head);
    for (const p of [...played].sort((a, b) => b.points - a.points || b.wins - a.wins || a.played - b.played)) {
      const tr = el('tr');
      const name = el('td', '', p.name); name.style.color = p.color;
      const pts = el('td', 'pts', String(p.points));
      if (p.quits) pts.title = `${p.quits} walk-out${p.quits > 1 ? 's' : ''} (${p.quits * -2} ⭐)`;
      tr.append(name, pts, el('td', '', p.wins), el('td', '', p.played),
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
    if (scored.length) li.append(el('div', 'hint left', scored.map((x) => `${x.name} ${fmtNum(x.score)}`).join(' · ')));
    hist.append(li);
  }
  $('#resetScoresBtn').hidden = !host;
}

// ---------- game shell
// Updates that only carry chat, reactions or the clock don't redraw the game: rebuilding buttons between a
// phone's touch and its click loses the tap (bots chat a lot). `force` (ctx.rerender) always redraws.
let renderedKey = null;
const renderKey = (view, readOnly) => JSON.stringify(view, (k, v) => (k === 'chat' || k === 'reactions' || k === 'timeLeft' ? undefined : v)) + readOnly;
function renderGame(view = S, readOnly = false, force = false) {
  const ui = UI[view.gameId];
  $('#quitBtn').textContent = view.host === view.me.id && view.phase === 'playing' ? '🏠 End game' : 'Leave game';
  if (mounted !== view.gameId || (!readOnly && mountedNo !== view.gameNo)) {
    unmountUI();
    $('#arena').innerHTML = ''; $('#sideGame').innerHTML = '';
    ui.mount($('#arena'), $('#sideGame'));
    mounted = view.gameId; mountedNo = view.gameNo;
    renderedKey = null;  // a fresh mount always draws
  }
  const me = view.me, playing = view.phase === 'playing', myTurn = !readOnly && playing && view.turn === me.id;
  applyFocus(view);
  // spectators can sit in mid-game where the game allows it (Hold'em next hand, party games right away)
  const info = gameInfo(view.gameId), seatedNow = view.players.filter((p) => !p.spectator).length;
  const canJoin = !readOnly && playing && me.spectator && info?.lateJoin && seatedNow < Math.min(6, info.max);
  $('#joinInBtn').hidden = !canJoin;
  if (canJoin) $('#joinInBtn').textContent = `🙋 Join in${view.gameId === 'holdem' ? ' from the next hand' : ''}`;
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
    const gname = gameInfo(view.gameId ?? S.gameId)?.name;
    document.title = (myTurn ? '🔔 Your turn — ' : '') + (gname ? gname + ' — ' : '') + 'Game Night';
    lastTurn = view.turn;
  }

  const chips = $('#players'); chips.innerHTML = '';
  for (const p of view.players) {
    const c = el('div', 'chip' + (p.id === view.turn ? ' turn-now' : '') + (p.eliminated ? ' out' : ''));
    c.append(avatar(p), mark(p, p.online), el('b', '', p.name));
    const bits = [p.spectator ? '👁 watching' : p.meta, p.played || p.points ? '⭐' + p.points : '', p.eliminated ? '👻' : '',
      p.standin ? '🤖 autopilot' : p.away ? '📡 away' : ''].filter(Boolean);
    if (bits.length) c.append(el('span', 'meta', bits.join(' · ')));
    chips.append(c);
  }

  const key = renderKey(view, readOnly);
  if (!force && key === renderedKey && mounted === view.gameId) return;
  renderedKey = key;
  const lookup = (id) => view.players.find((p) => p.id === id);
  const readOnlyAct = () => { toast('This is a replay.'); return Promise.reject(new Error('replay')); };
  ui.render(view, { act: readOnly ? readOnlyAct : act, input: readOnly ? () => {} : input, quiet, toast, el, ask, player: lookup, mark: (id) => mark(lookup(id)), myTurn,
    peek: readOnly ? null : (extra) => api('/api/peek', { ...session, ...extra }),
    confetti: readOnly ? () => {} : confetti, sfx: readOnly ? () => {} : sfx, rerender: () => (replay ? showFrame() : renderGame(S, false, true)) });
  shapeDots($('#arena')); shapeDots($('#sideGame'));
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
  const mineRow = last?.players.find((x) => x.name === me.name);
  $('#overScores').textContent = [
    mineRow?.pts ? `You earned +${mineRow.pts} ⭐ (now ${player(me.id)?.points ?? 0})` : '',
    scored.length ? [...scored].sort((a, b) => b.score - a.score).map((x) => `${x.name}: ${fmtNum(x.score)}`).join(' · ') : '',
  ].filter(Boolean).join(' — ');
  const readyNames = S.ready.map((id) => player(id)?.name).filter(Boolean);
  $('#rematchBtn').hidden = !host; $('#lobbyBtn').hidden = !host;
  // "I'm in!" tells other people you want another round; alone with bots there's nobody to tell
  $('#readyBtn').hidden = !S.players.some((p) => p.id !== me.id && !p.bot);
  const folded = !!load('overFolded');
  $('#overBanner').classList.toggle('folded', folded);
  $('#overFold').textContent = folded ? '▾' : '▴';
  $('#overFold').ariaExpanded = String(!folded);
  $('#readyBtn').textContent = S.ready.includes(me.id) ? '✋ Ready!' : "🙋 I'm in!";
  $('#readyBtn').classList.toggle('on', S.ready.includes(me.id));
  $('#replayBtn').hidden = !S.hasReplay;
  $('#overWait').textContent = (readyNames.length ? `Ready for more: ${readyNames.join(', ')}. ` : '')
    + (host ? '' : 'Waiting for the host…');
  renderVote(host);
}

// Next-game vote: a few suggestions that fit the table (games with votes first), plus every other fitting
// game in a drop-down. Tap again to take a vote back. A unanimous vote starts the game on the server.
function renderVote(host) {
  const box = $('#overVote'); box.innerHTML = '';
  const seated = S.players.filter((p) => !p.spectator).length;
  const fit = S.games.filter((g) => g.min <= seated && seated <= g.max);
  const votes = S.votes || {}, mine = votes[S.me.id];
  const count = (id) => Object.values(votes).filter((v) => v === id).length;
  const recent = S.history.slice(-4).map((h) => h.game);
  // suggestions: voted games, then ones not played lately, in a shuffle that stays put until the next game
  let seed = S.history.length * 7919 + 13;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const fresh = fit.filter((g) => !recent.includes(g.id)).map((g) => [rnd(), g]).sort((a, b) => a[0] - b[0]).map(([, g]) => g);
  const picks = [...fit.filter((g) => count(g.id)), ...fresh, ...fit].filter((g, i, all) => all.indexOf(g) === i).slice(0, 5);
  box.append(el('div', 'hint left', '🗳️ Vote for the next game'));
  const row = el('div', 'vote-row');
  const vote = (id) => quiet(act('next_vote', { game: id }));
  for (const g of picks) {
    const n = count(g.id);
    const b = el('button', 'vote-chip' + (mine === g.id ? ' on' : ''), `${g.icon} ${g.name}${n ? ` · ${n}` : ''}`);
    b.title = Object.entries(votes).filter(([, v]) => v === g.id).map(([pid]) => player(pid)?.name).filter(Boolean).join(', ');
    b.onclick = () => vote(g.id);
    row.append(b);
  }
  const more = el('select', 'vote-more');
  more.append(Object.assign(el('option', '', '➕ Other game…'), { value: '' }));
  for (const g of fit.filter((g) => !picks.includes(g))) more.append(Object.assign(el('option', '', `${g.icon} ${g.name}`), { value: g.id }));
  more.onchange = () => { if (more.value) vote(more.value); };
  if (more.options.length > 1) row.append(more);
  box.append(row);
  if (host && Object.keys(votes).length) {
    const play = el('button', 'primary', '▶ Play the vote winner');
    play.onclick = () => quiet(act('play_vote'));
    box.append(play);
  }
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
  if (newestId !== lastLogId) {
    box.scrollTop = box.scrollHeight;
    // a sound for the new move, unless the game plays its own or it's the first state / a replay
    if (lastLogId && !replay && !firstState && view.phase === 'playing' && !ui.ownSounds) {
      const e = view.log.at(-1), cat = gameInfo(view.gameId)?.category;
      if (cat !== 'action') sfx(e.kind === 'big' ? 'good' : /captur|takes|jump|hit|sunk|bust|farkle/i.test(e.text) && cat !== 'words' ? 'capture' : CATEGORY_SFX[cat]);
    }
    lastLogId = newestId;
  }
}

// ---------- replays
async function startReplay() {
  try {
    const { frames } = await api('/api/replay', session);
    if (frames.length < 2) return toast('No replay for that game.');
    replay = { frames, i: 0, timer: null };
    $('#rpSlider').max = frames.length - 1;
    $('#replayBar').hidden = false;
    document.body.classList.add('replaying');
    show('game');
    unmountUI();
    showFrame();
    $('#rpPlay').click();  // it plays straight away; ⏸ or the slider stops it
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
  document.body.classList.remove('replaying');
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
// The shared results card between rounds: everyone's gain this round, running total and rank, with
// ▲/▼ for places moved. `rows` come from Game.standings() on the server. Fills `box` (emptied first).
// `lower`: fewer points is better (Shut the Box), so gains aren't coloured as good news.
function standingsCard(box, rows, { title = '', note = '', unit = '', fmt = (v) => v.toLocaleString(), lower = false } = {}) {
  box.innerHTML = '';
  box.hidden = !rows?.length;
  if (!rows?.length) return;
  box.classList.add('st-card');
  if (title) box.append(el('h4', 'st-title', title));
  const medal = ['🥇', '🥈', '🥉'];
  for (const r of rows) {
    const p = S.players.find((x) => x.id === r.id);
    const row = el('div', 'st-row' + (r.id === S.me.id ? ' me' : ''));
    const name = el('span', 'st-name', p?.name ?? 'left');
    name.prepend(mark(p));
    const moved = r.was - r.rank;  // positive: climbed
    row.append(el('span', 'st-rank', medal[r.rank - 1] ?? `${r.rank}.`), name,
      el('span', 'st-gain' + (lower ? '' : r.gain > 0 ? ' up' : r.gain < 0 ? ' down' : ''), r.gain ? `${r.gain > 0 ? '+' : '−'}${fmt(Math.abs(r.gain))}` : '·'),
      el('b', 'st-total', `${fmt(r.total)}${unit}`),
      el('span', 'st-move' + (moved > 0 ? ' up' : moved < 0 ? ' down' : ''), moved > 0 ? `▲${moved}` : moved < 0 ? `▼${-moved}` : ''));
    box.append(row);
  }
  if (note) box.append(el('p', 'hint st-note', note));
}

// A device-local top-5 table for solo play. `box` holds an <ol>; `id` names this game (recorded once, when
// `over`), `lower` means fewer is better (Shut the Box), `fmt` turns a score into text.
function soloBest(box, key, id, score, over, { lower = false, fmt = String } = {}) {
  let best = [];
  try { best = JSON.parse(localStorage.getItem(key)) || []; } catch {}
  let fresh = null;
  if (over && !best.some((b) => b.id === id)) {
    fresh = { id, score, date: new Date().toLocaleDateString('en-CA') };
    best = [...best, fresh].sort((a, b) => (lower ? a.score - b.score : b.score - a.score)).slice(0, 5);
    try { localStorage.setItem(key, JSON.stringify(best)); } catch {}
  }
  const list = box.querySelector('ol');
  box.hidden = !best.length;
  list.innerHTML = '';
  for (const b of best) {
    const li = el('li', b === fresh || (over && b.id === id) ? 'now' : '', `${fmt(b.score)} `);
    li.append(el('small', '', b.date));
    list.append(li);
  }
}

// Take-back buttons for a game's `undo` view ({asker, can}, from games/undo.py): "↶ Undo my move", or
// Allow / Refuse when the rival asked. Fills `box` (emptied first); nothing for spectators or after the game.
function undoRow(box, undo, S, ctx, playing) {
  box.innerHTML = '';
  if (!undo || S.phase !== 'playing' || !playing) return;
  if (undo.asker && undo.asker !== S.me.id) {
    const yes = el('button', 'primary', '↶ Allow undo'); yes.onclick = () => quiet(ctx.act('undo_yes'));
    const no = el('button', '', 'Refuse'); no.onclick = () => quiet(ctx.act('undo_no'));
    box.append(yes, no);
  } else {
    const b = el('button', '', undo.asker ? 'Undo asked…' : '↶ Undo my move');
    b.disabled = !!undo.asker || !undo.can; b.onclick = () => quiet(ctx.act('undo_ask'));
    box.append(b);
  }
}
// arrow keys move focus around a board of buttons laid out `cols` wide (Enter/Space then press the
// focused square); squares that can't be pressed right now are skipped over
function gridKeys(box, cols) {
  box.dataset.cols = cols;
  if (box.dataset.keys) return;
  box.dataset.keys = '1';
  box.addEventListener('keydown', (e) => {
    const n = +box.dataset.cols;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -n, ArrowDown: n }[e.key];
    if (!step) return;
    const kids = [...box.children], i = kids.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    for (let j = i + step; j >= 0 && j < kids.length; j += step) {
      if (Math.abs(step) === 1 && Math.floor(j / n) !== Math.floor(i / n)) break;  // stay on the row
      if (!kids[j].disabled) return kids[j].focus();
    }
  });
}
// a short vibration for game events (hits, crashes), if the player allows it; games call it directly
function buzz(pattern) { if (prefs.vibrate) try { navigator.vibrate?.(pattern); } catch {} }
const fmtNum = (n) => (typeof n === 'number' ? n.toLocaleString() : n);
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
const THEMES = [['dark', '🌙 Dark'], ['light', '☀️ Light'], ['system', '🌓 Match my phone']];
const lightQuery = window.matchMedia?.('(prefers-color-scheme: light)');
function applyPrefs() {
  document.body.classList.toggle('calm', !prefs.motion);
  const light = prefs.theme === 'light' || (prefs.theme === 'system' && !!lightQuery?.matches);
  document.body.classList.toggle('light', light);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f4f1fa' : '#16131f');
}
lightQuery?.addEventListener?.('change', applyPrefs);
function renderPrefs() {
  const box = $('#prefsList'); box.innerHTML = '';
  const theme = el('label', '', 'Theme (the game table stays dark)');
  const pick = el('select');
  for (const [k, label] of THEMES) pick.append(Object.assign(el('option', '', label), { value: k }));
  pick.value = prefs.theme || 'dark';
  pick.onchange = () => { prefs.theme = pick.value; store('unmask.prefs', prefs); applyPrefs(); };
  theme.append(pick);
  box.append(theme);
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
// Play solo starts at once; Options first stops in the lobby (bots seated) to change settings before Start.
async function solo(startNow) {
  const game = $('#soloGame').value;
  store('unmask.soloGame', game);
  try {
    enter(await api('/api/create', { name: $('#name').value, game }));
    for (let i = 0; i < (SOLO_BOTS[game] || 1); i++) await act('add_bot', { level: $('#soloLevel').value });
    if (startNow) await act('start');
  } catch (e) { toast(e.message); }
}
$('#soloBtn').onclick = () => solo(true);
$('#soloSetupBtn').onclick = () => solo(false);
$('#addBotBtn').onclick = () => quiet(act('add_bot', { level: $('#botLevel').value }));
$('#joinBtn').onclick = () => api('/api/join', { name: $('#name').value, code: $('#code').value.trim() }).then(enter).catch((e) => toast(e.message));
$('#code').addEventListener('keydown', (e) => e.key === 'Enter' && $('#joinBtn').click());
// rename yourself or pick a colour (between games); colours other players have are greyed out
async function editProfile() {
  const me = S.players.find((p) => p.id === S.me.id);
  const body = el('div', 'profile');
  const input = el('input'); input.value = me.name; input.maxLength = 16; input.autocomplete = 'nickname';
  const swatches = el('div', 'swatches');
  let color = me.color;
  for (const c of S.palette || []) {
    const taken = S.players.some((p) => p.id !== me.id && p.color === c);
    const b = el('button', 'swatch' + (c === color ? ' on' : ''));
    b.style.background = c; b.disabled = taken;
    b.setAttribute('aria-label', taken ? 'colour taken' : 'pick this colour');
    b.onclick = () => { color = c; for (const x of swatches.children) x.classList.toggle('on', x === b); };
    swatches.append(b);
  }
  body.append(input, swatches);
  if (!(await ask('', { title: '✏️ You', body, ok: 'Save' }))) return;
  if (input.value.trim() === me.name && color === me.color) return;
  quiet(act('profile', { name: input.value, color }).then(() => { store('unmask.name', input.value.trim()); $('#name').value = input.value.trim(); }));
}

// the invite: a QR code to scan across the table, plus the link to copy or share. A host on the server's
// own device (localhost) gets the Wi-Fi address instead, since "localhost" means nothing on a friend's phone.
$('#shareBtn').onclick = () => {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const url = `${local && S.lan ? S.lan : location.origin}/?room=${S.code}`;
  const body = el('div', 'invite');
  const qr = QR.qrSvg(url);
  if (qr) { qr.classList.add('invite-qr'); qr.setAttribute('role', 'img'); qr.setAttribute('aria-label', 'QR code for the invite link'); body.append(qr); }
  const input = el('input'); input.value = url; input.readOnly = true;
  input.onfocus = () => input.select();
  const row = el('div', 'row');
  const copy = el('button', '', '📋 Copy link');
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(url); toast('Invite link copied!'); } catch { input.focus(); input.select(); toast('Select the link and copy it.'); }
  };
  row.append(copy);
  if (navigator.share) {
    const share = el('button', '', '📤 Share…');
    share.onclick = () => navigator.share({ title: 'Join my Game Night room', url }).catch(() => {});
    row.append(share);
  }
  body.append(input, row);
  ask('Friends on the same Wi-Fi can scan this or open the link.', { title: `Room ${S.code}`, body, ok: 'Done', cancel: '' });
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
  if (await ask(playing ? 'Leave this room? You will forfeit the current game and lose 2 ⭐ for walking out.' : 'Leave this room?', { ok: 'Leave', danger: playing }))
    act('leave').catch(() => {}).then(leaveLocal);
};
$('#helpBtn').onclick = () => showHelp();
$('#joinInBtn').onclick = () => quiet(act('join_game'));
// The game-over banner folds to one line so the final board stays in view (remembered on this device).
$('#overFold').onclick = () => { store('overFolded', !load('overFolded') || null); renderOver(); };
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
// In a game, the host ends it and goes back to the lobby (#52); everyone else leaves the room.
$('#quitBtn').onclick = async () => {
  if (S?.host !== S?.me.id || S?.phase !== 'playing') return leave();
  let instead = false;
  const other = el('button', 'ghost-btn', 'Leave the room instead');
  other.onclick = () => { instead = true; ask.close?.(false); };
  const others = S.players.some((p) => p.id !== S.me.id && !p.bot);
  const ok = await ask(others ? 'End this game for everyone and go back to the lobby? Nobody gains or loses points.' : 'End this game and go back to the lobby?',
    { ok: '🏠 Back to lobby', body: other });
  if (ok) quiet(act('end_game'));
  else if (instead) leave();
};
for (const e of REACTIONS) {
  const b = el('button', '', e); b.onclick = () => quiet(act('react', { emoji: e }));
  $('#reactBar').append(b);
}
// replay controls
// (a late tap after the replay closed does nothing)
$('#rpFirst').onclick = () => replay && stepReplay(0);
$('#rpPrev').onclick = () => { if (!replay) return; pauseReplay(); stepReplay(replay.i - 1); };
$('#rpNext').onclick = () => { if (!replay) return; pauseReplay(); stepReplay(replay.i + 1); };
$('#rpLast').onclick = () => replay && stepReplay(Infinity);
$('#rpSlider').oninput = () => { if (!replay) return; pauseReplay(); stepReplay(+$('#rpSlider').value); };
$('#rpPlay').onclick = () => {
  if (!replay) return;
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
// a tap anywhere outside an open drawer (or Escape) closes it (#36); its own buttons still toggle it
const closeDrawers = () => { $('#chatPanel').hidden = true; $('#prefsPanel').hidden = true; };
document.addEventListener('pointerdown', (e) => {
  if ($('#chatPanel').hidden && $('#prefsPanel').hidden) return;
  if (e.target.closest?.('.drawer, #fabs, #chatBubble, #modal')) return;
  closeDrawers();
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#modal').hidden && !($('#chatPanel').hidden && $('#prefsPanel').hidden)) closeDrawers();
});
$('#reportLink').onclick = () => reportDialog('bug');
$('#reportBtn').onclick = () => { $('#prefsPanel').hidden = true; reportDialog('bug'); };
applyPrefs();

// ---------- full screen, and fitting the screen when the on-screen keyboard opens
// Focus mode hides the player chips, log and floating buttons so the board gets the whole screen.
// Real-time games (UI module `focus: true`) start in it; each game remembers the player's choice.
const focusOn = (gameId) => load('focus:' + gameId) ?? !!UI[gameId]?.focus;
function applyFocus(view = S) {
  const on = !!view && view.phase === 'playing' && !replay && focusOn(view.gameId);
  document.body.classList.toggle('focus', on);
  $('#focusBtn').ariaPressed = String(on);
}
$('#focusBtn').onclick = () => {
  if (!S) return;
  store('focus:' + S.gameId, !focusOn(S.gameId));
  if (S.phase !== 'playing') toast(focusOn(S.gameId) ? 'Bigger board turns on when the game starts.' : 'Bigger board off.');
  applyFocus();
};
const FULL_ENTER_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const FULL_EXIT_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
  $('#fullBtn').hidden = false;
  $('#fullBtn').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen({ navigationUI: 'hide' })).catch(() => {});
  document.addEventListener('fullscreenchange', () => {
    // SVG icons: the ⛶ / 🗗 glyphs are missing from many Android fonts and showed as boxes
    const on = !!document.fullscreenElement;
    $('#fullBtn').innerHTML = on ? FULL_EXIT_ICON : FULL_ENTER_ICON;
    $('#fullBtn').title = $('#fullBtn').ariaLabel = on ? 'Exit full screen' : 'Full screen';
  });
}
// --app-h is the height actually visible (minus browser bars and the keyboard); boards size against it.
// While typing on a phone, chrome around the game hides so the board and the input both stay in view.
function fitViewport() {
  const vv = window.visualViewport, h = vv ? vv.height : innerHeight;
  document.documentElement.style.setProperty('--app-h', `${Math.round(h)}px`);
  const typing = !!document.activeElement?.matches?.('#arena input, #arena textarea');
  const kb = typing && (!vv || innerHeight - vv.height > 120 || matchMedia('(pointer: coarse)').matches);
  document.body.classList.toggle('kb-open', kb);
  if (kb && vv) requestAnimationFrame(() => { window.scrollTo(0, 0); document.activeElement?.scrollIntoView?.({ block: 'nearest' }); });
}
window.visualViewport?.addEventListener('resize', fitViewport);
addEventListener('resize', fitViewport);
document.addEventListener('focusin', fitViewport);
document.addEventListener('focusout', () => setTimeout(fitViewport, 50));
fitViewport();

setInterval(() => {
  const t = $('#timer');
  if (!S || replay || S.timeLeft == null || S.phase !== 'playing' || UI[S.gameId]?.ownTimer?.(S)) { t.textContent = ''; return; }
  const left = Math.max(0, S.timeLeft - (performance.now() - stateAt) / 1000);
  t.textContent = '⏱ ' + Math.ceil(left) + 's';
  t.classList.toggle('urgent', left < 10);
}, 250);

// keep the screen on while a game is being played (browsers allow this on HTTPS and localhost only)
let wakeLock = null, wakeBusy = false;
async function keepAwake(on) {
  if (wakeBusy || on === !!wakeLock) return;
  wakeBusy = true;
  try {
    if (on) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });  // the browser drops it when the tab is hidden
    } else {
      const lock = wakeLock; wakeLock = null;
      await lock.release();
    }
  } catch { wakeLock = null; }
  wakeBusy = false;
}
setInterval(() => keepAwake(!!S && !replay && S.phase === 'playing' && !document.hidden && !!navigator.wakeLock), 1000);

// installable app: the service worker keeps a copy of the app shell (HTTPS and localhost only)
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});

const roomParam = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
if (roomParam) $('#code').value = roomParam;
if (session && (!roomParam || roomParam === session.code)) connect(); else show('home');
