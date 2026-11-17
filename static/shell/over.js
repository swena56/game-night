// the game-over panel: results table, podium, the next-game vote.
// Part of the shell, split out of app.js: a plain script loaded before app.js, sharing its globals
// (S, $, el, act, prefs, …), which exist by the time anything here is called.
function roomRecord(last) {
  const won = last?.players.find((x) => x.won);
  const scores = last?.players.map((x) => x.score).filter((v) => typeof v === 'number') ?? [];
  if (!won || typeof won.score !== 'number' || scores.length < 2) return '';
  // which way is better shows in who won: the winner holds the top score, or the bottom one (Hearts, Shut the Box)
  const low = won.score === Math.min(...scores) && won.score !== Math.max(...scores);
  const before = S.history.slice(0, -1).filter((h) => h.game === last.game && h.players.filter((x) => x.score != null).length > 1)
    .flatMap((h) => h.players.map((x) => x.score)).filter((v) => typeof v === 'number');
  const beat = low ? won.score < Math.min(...before) : won.score > Math.max(...before);
  return before.length && beat ? `📈 Room record for ${last.name}: ${fmtNum(won.score)}` : '';
}

// #143 a run of the same game back to back (rematches): how many each player has won, and who's on a streak.
// Worked out from the room's history, so it survives a server restart like the rest of it.
function runStats(hist) {
  const last = hist?.at(-1);
  if (!last) return null;
  const wins = new Map();
  let games = 0, streak = 0, streakId = undefined;
  for (let i = hist.length - 1; i >= 0 && hist[i].game === last.game; i--) {
    games++;
    const w = hist[i].players.find((x) => x.won);
    if (w) { const r = wins.get(w.id) || { id: w.id, name: w.name, color: w.color, n: 0 }; r.n++; wins.set(w.id, r); }
    const wid = w ? w.id : null;
    if (streakId === undefined) { streakId = wid; streak = wid ? 1 : 0; } else if (streak && wid === streakId && streak === games - 1) streak++;
  }
  const rows = [...wins.values()].sort((a, b) => b.n - a.n);
  return { games, name: last.name, icon: last.icon, rows, draws: games - rows.reduce((a, r) => a + r.n, 0),
    streak: streak >= 2 ? { name: rows.find((r) => r.id === streakId)?.name, n: streak } : null };
}
function runLine() {
  const r = runStats(S.history);
  if (!r || r.games < 2) return null;
  const line = el('div', 'over-note over-run');
  line.append(el('span', '', `${r.icon} This run (${r.games} games): `));
  r.rows.forEach((x, k) => {
    if (k) line.append(el('span', '', ' · '));
    const nm = el('b', '', `${x.name} ${x.n}`); nm.style.color = player(x.id)?.color || x.color || ''; line.append(nm);
  });
  if (r.draws) line.append(el('span', '', ` · 🤝 ${r.draws}`));
  if (r.streak) line.append(el('span', '', ` · 🔥 ${r.streak.name} ${r.streak.n} in a row`));
  return line;
}

function renderOver() {
  const me = S.me, host = S.host === me.id;
  const w = player(S.winner);
  $('#overText').textContent = w ? (w.id === me.id ? '🏆 You win!' : `🏆 ${w.name} wins!`) : (S.log.at(-1)?.text ?? 'Game over');
  $('#overBanner').classList.toggle('won', w?.id === me.id);
  const last = S.history.at(-1);
  const scored = last?.players.filter((x) => x.score != null) ?? [];
  const mineRow = last?.players.find((x) => x.name === me.name);
  renderPodium(w, scored);
  // the scores as a small table, best first; the extra lines (stars earned, streaks, records) under it (#93)
  const box = $('#overScores'); box.innerHTML = '';
  if (scored.length > 1) {
    const tbl = el('ol', 'over-table');
    [...scored].sort((a, b) => (last.low ? a.score - b.score : b.score - a.score)).forEach((x) => {
      const li = el('li', x.name === me.name ? 'me' : '');
      li.append(el('span', 'ot-name', x.name), el('b', '', fmtNum(x.score)));
      tbl.append(li);
    });
    box.append(tbl);
  }
  const notes = [
    mineRow?.pts ? `You earned +${mineRow.pts} ⭐ (now ${player(me.id)?.points ?? 0})` : '',
    w?.streak > 1 ? `🔥 ${w.id === me.id ? 'You have' : w.name + ' has'} won ${w.streak} in a row` : '',
    roomRecord(last),
    Profile.overLine(S),
  ].filter(Boolean);
  for (const n of notes) box.append(el('div', 'over-note', n));
  const run = runLine(); if (run) box.append(run);
  const readyNames = S.ready.map((id) => player(id)?.name).filter(Boolean);
  const others = S.players.some((p) => p.id !== me.id && !p.bot);
  $('#rematchBtn').hidden = !host; $('#lobbyBtn').hidden = !host;
  // "I'm in!" tells other people you want another round; alone with bots there's nobody to tell
  $('#readyBtn').hidden = !others;
  // one main action (#93): a game picked for next time (solo), the vote winner (host, once anyone voted), else Rematch
  const votes = S.votes || {};
  if (overPick && (overPick.at !== S.history.length || others)) overPick = null;
  const pickG = overPick && gameInfo(overPick.game);
  $('#playPickBtn').hidden = !(host && pickG);
  if (pickG) $('#playPickBtn').textContent = `▶ Play ${pickG.icon} ${pickG.name}`;
  $('#playVoteBtn').hidden = !(host && others && Object.keys(votes).length);
  $('#rematchBtn').className = $('#playPickBtn').hidden && $('#playVoteBtn').hidden ? 'primary' : '';
  const folded = overFoldedAt === S.history.length;  // folding lasts for this game's results only
  $('#overBanner').classList.toggle('folded', folded);
  $('#overFold').textContent = folded ? '▾' : '▴ Board';  // spelled out while open: the way back to the board (#81)
  $('#overFold').ariaExpanded = String(!folded);
  $('#readyBtn').textContent = S.ready.includes(me.id) ? '✋ Ready!' : "🙋 I'm in!";
  $('#readyBtn').classList.toggle('on', S.ready.includes(me.id));
  $('#replayBtn').hidden = !S.hasReplay;
  $('#overWait').textContent = (readyNames.length ? `Ready for more: ${readyNames.join(', ')}. ` : '')
    + (host ? '' : 'The host starts the next game. Your vote below counts 🗳️');
  renderVote(host, others);
  syncOverBack();
}
// the podium: the winner in the middle, up a step, with the runners-up either side (by score when the game
// keeps one, else just the winner)
function renderPodium(w, scored) {
  const box = $('#overPodium'); box.innerHTML = '';
  const byName = (n) => S.players.find((p) => p.name === n);
  let places = scored.length > 1 ? [...scored].sort((a, b) => b.score - a.score).slice(0, 3).map((x) => ({ p: byName(x.name) || { name: x.name }, score: fmtNum(x.score) }))
    : w ? [{ p: w, score: '' }] : [];
  if (!places.length) { box.hidden = true; return; }
  box.hidden = false;
  const order = places.length === 3 ? [1, 0, 2] : places.length === 2 ? [0, 1] : [0];
  for (const k of order) {
    const { p, score } = places[k], col = el('div', 'pod pod-' + (k + 1));
    col.style.setProperty('--pc', p.color || '#888');
    const face = el('div', 'pod-face'); face.append(avatar(p));
    if (k === 0) face.append(el('span', 'pod-crown', '👑'));
    col.append(face, el('b', '', p.name), el('small', '', score || ['Winner', '2nd', '3rd'][k]));
    box.append(col);
  }
}
// the open (unfolded) results banner is an overlay the phone's Back button folds
const foldOver = () => setOverFold(true);
function syncOverBack() {
  const open = !$('#overBanner').hidden && !$('#overBanner').classList.contains('folded');
  const held = backNav.stack.includes(foldOver);
  if (open && !held) backOpen(foldOver); else if (!open && held) backClosed(foldOver);
}

// Next-game vote (#93): four suggestion tiles that fit the table (voted games first, then favourites and games
// played lately here, then a shuffle of ones not played tonight), and "More games…" for the full picker.
// With other people, a tap is a vote (tap again to take it back; a unanimous vote starts the game on the server).
// Alone with bots, a tap only picks: the main button turns into "▶ Play …", so nothing starts by surprise.
let overPick = null;      // { game, at: S.history.length } chosen alone for the next game
let overNextOpen = null;  // { at, open }: the 🗳️ section's fold, for this game's results only
function renderVote(host, others) {
  const box = $('#overVote'); box.innerHTML = '';
  const seated = S.players.filter((p) => !p.spectator).length;
  const fit = S.games.filter((g) => g.min <= seated && seated <= g.max);
  const votes = S.votes || {}, mine = others ? votes[S.me.id] : overPick?.game;
  const voters = (id) => Object.entries(votes).filter(([, v]) => v === id).map(([pid]) => player(pid)).filter(Boolean);
  const tonight = S.history.map((h) => h.game);
  let seed = S.history.length * 7919 + 13;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const fresh = fit.filter((g) => !tonight.includes(g.id)).map((g) => [rnd(), g]).sort((a, b) => a[0] - b[0]).map(([, g]) => g);
  const mineFirst = (ids) => ids.map((id) => fit.find((g) => g.id === id)).filter(Boolean);
  const picked = mine ? fit.filter((g) => g.id === mine) : [];
  const picks = [...picked, ...fit.filter((g) => voters(g.id).length), ...mineFirst(load('favGames') || []), ...mineFirst(load('recentGames') || []), ...fresh, ...fit]
    .filter((g, i, all) => all.indexOf(g) === i && g.id !== S.gameId).slice(0, 4);
  const nVotes = Object.keys(votes).length;
  if (overNextOpen?.at !== S.history.length) overNextOpen = { at: S.history.length, open: others };
  const det = el('details', 'over-next');
  det.open = overNextOpen.open || !!mine;
  det.ontoggle = () => { overNextOpen.open = det.open; };
  const sum = el('summary', '', others ? `🗳️ Vote for the next game${nVotes ? ` · ${nVotes} vote${nVotes > 1 ? 's' : ''}` : ''}` : '🎮 Something else next?');
  det.append(sum);
  const choose = (id) => {
    if (others) return quiet(act('next_vote', { game: id }));
    overPick = overPick?.game === id ? null : { game: id, at: S.history.length };
    renderOver();
    if (overPick) $('#playPickBtn').focus({ preventScroll: true });
  };
  const grid = el('div', 'next-grid'), favs = load('favGames') || [], newTags = Profile.showNew();
  for (const g of picks) {
    const vs = voters(g.id);
    const b = el('button', 'next-tile' + (mine === g.id ? ' on' : ''));
    b.setAttribute('aria-pressed', mine === g.id);
    const txt = el('span', 'nt-text');
    const tag = favs.includes(g.id) ? '⭐ favourite' : newTags && !Profile.tried(g.id) ? '✨ new to you' : playersText(g);
    txt.append(el('b', '', g.name), el('small', '', tag));
    b.append(el('span', 'gicon', g.icon), txt);
    if (vs.length) {
      const who = el('span', 'nt-votes');
      for (const p of vs.slice(0, 4)) who.append(avatar(p));
      who.title = 'Voted: ' + vs.map((p) => p.name).join(', ');
      b.append(who);
    }
    b.onclick = () => choose(g.id);
    grid.append(b);
  }
  const more = el('button', 'next-more', '➕ More games…');
  more.onclick = async () => {
    const id = await pickGameSheet({ title: others ? '🗳️ Vote for a game' : '🎮 Next game', seated, current: mine });
    if (id && S?.phase === 'over') { if (!others && overPick?.game === id) return; choose(id); }
  };
  det.append(grid, more);
  box.append(det);
}
