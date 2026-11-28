// the game-over panel: results table, podium, the next-game vote.
// Part of the shell, split out of app.js: a plain script loaded before app.js, sharing its globals
// (S, $, el, act, prefs, …), which exist by the time anything here is called.
function roomRecord(last) {
  const record = S.roomRecords?.[last?.record?.key];
  if (!record) return '';
  const holder = player(record.id)?.name || record.name;
  return `${record.at === last.at ? 'New room mark' : 'Room best'} · ${holder} · ${Profile.formatBenchmark(record.value, record.kind)}`;
}

// #143 a run of the same game back to back (rematches): how many each player has won, and who's on a streak.
// Worked out from the room's history, so it survives a server restart like the rest of it.
function runStats(hist) {
  const last = hist?.at(-1);
  if (!last || last.record?.kind === 'progress') return null;
  const wins = new Map();
  const cooperative = last.game === "switchyard";
  let crewWins = 0, shutdowns = 0;
  let games = 0, draws = 0, streak = 0, streakId = undefined;
  const sameSeries = (h) => h.game === last.game && !h.recordExcluded && (!last.record ||
    (h.record?.key === last.record.key && h.record.roster.join(',') === last.record.roster.join(',')));
  for (let i = hist.length - 1; i >= 0 && sameSeries(hist[i]); i--) {
    games++;
    if (cooperative) {
      if (hist[i].teamWinnerIds?.length) crewWins++;
      else shutdowns++;
      continue;
    }
    const winners = hist[i].teamWinnerIds === undefined
      ? hist[i].players.filter((x) => x.won).slice(0, 1) : hist[i].players.filter((x) => x.won);
    if (!winners.length) draws++;
    for (const w of winners) {
      const r = wins.get(w.id) || { id: w.id, name: w.name, color: w.color, n: 0 };
      r.n++;
      wins.set(w.id, r);
    }
    const wid = winners.length === 1 ? winners[0].id : null;
    if (streakId === undefined) { streakId = wid; streak = wid ? 1 : 0; } else if (streak && wid === streakId && streak === games - 1) streak++;
  }
  const rows = [...wins.values()].sort((a, b) => b.n - a.n);
  return { games, name: last.name, icon: last.icon, rows, draws, cooperative, crewWins, shutdowns,
    streak: streak >= 2 ? { name: rows.find((r) => r.id === streakId)?.name, n: streak } : null };
}
function runLine() {
  const r = runStats(S.history);
  if (!r || r.games < 2) return null;
  const line = el('div', 'over-note over-run');
  line.append(el('span', '', `${r.icon} This run (${r.games} games): `));
  if (r.cooperative) {
    line.append(el("span", "", `${r.crewWins} crew ${r.crewWins === 1 ? "win" : "wins"} · ${r.shutdowns} yard ${r.shutdowns === 1 ? "shutdown" : "shutdowns"}`));
    return line;
  }
  r.rows.forEach((x, k) => {
    if (k) line.append(el('span', '', ' · '));
    const nm = el('b', '', `${x.name} ${x.n}`); nm.style.color = player(x.id)?.color || x.color || ''; line.append(nm);
  });
  if (r.draws) line.append(el('span', '', ` · 🤝 ${r.draws}`));
  if (r.streak) line.append(el('span', '', ` · 🔥 ${r.streak.name} ${r.streak.n} in a row`));
  return line;
}

function isDraw(result) {
  return result?.draw || (['midway', 'basketball'].includes(result?.game) && result.text?.startsWith('🤝 A tie on '));
}

function renderOver() {
  const me = S.me, host = S.host === me.id;
  const w = player(S.winner);
  const last = S.history.at(-1);
  const team = last?.teamWinnerIds;
  const draw = isDraw(last);
  const typingResult = S.gameId === 'keyclash' && S.keyclash?.mode === 'race' && last?.text;
  $('#overText').textContent = team || draw || typingResult ? last.text : w ? (w.id === me.id ? '🏆 You win!' : `🏆 ${w.name} wins!`) : (S.log.at(-1)?.text ?? 'Game over');
  $('#overBanner').classList.toggle('won', w?.id === me.id || !!team?.includes(me.id));
  const scored = last?.players.filter((x) => x.score != null) ?? [];
  const mineRow = last?.players.find((x) => x.id === me.id);
  renderPodium(w, scored, last?.low, draw);
  // the scores as a small table, best first; the extra lines (stars earned, streaks, records) under it (#93)
  const box = $('#overScores'); box.innerHTML = '';
  if (scored.length > 1) {
    const tbl = el('ol', 'over-table');
    [...scored].sort((a, b) => (last.low ? a.score - b.score : b.score - a.score)).forEach((x) => {
      const li = el('li', x.id === me.id ? 'me' : '');
      li.append(el('span', 'ot-name', x.name), el('b', '', fmtNum(x.score)));
      tbl.append(li);
    });
    box.append(tbl);
  }
  if (mineRow && typeof mineRow.score === 'number') {
    const best = Profile.bestLabel(last.game, last.record);
    if (best) {
      box.append(el('div', 'over-note', `🏅 Personal best · ${best}`));
    }
  }
  const notes = [
    mineRow?.pts ? `You earned +${mineRow.pts} ⭐ (now ${player(me.id)?.points ?? 0})` : '',
    w?.streak > 1 ? `🔥 ${w.id === me.id ? 'You have' : w.name + ' has'} won ${w.streak} in a row` : '',
    roomRecord(last),
    Profile.overLine(S),
    last?.game === 'chess' && mineRow ? `♟ Your Elo: ${Profile.chessElo()}` : '',
  ].filter(Boolean);
  for (const n of notes) box.append(el('div', 'over-note', n));
  const run = runLine(); if (run) box.append(run);
  const goal = $('#overGoal');
  if (goal) {
    const series = last?.record?.kind === 'wins' && runStats(S.history);
    const own = series && (series.rows.find((r) => r.id === me.id)?.n || 0);
    const leader = series && series.rows[0]?.n;
    const headToHead = last?.players.length === 2 && last.players.every((p) => !p.bot)
      && last.players.some((p) => p.id === me.id);
    goal.textContent = headToHead && leader && leader - own === 1
      ? 'Win the next round to tie the series.' : Profile.replayGoal(S);
    goal.hidden = !!S.playlist || !goal.textContent;
  }
  const xp = Profile.xpCard(S); if (xp) box.append(xp);  // ✨ the XP this game earned, and any level-up
  const readyNames = S.ready.map((id) => player(id)?.name).filter(Boolean);
  const others = S.players.some((p) => p.id !== me.id && !p.bot);
  const playlist = S.playlist;
  const nextId = playlist?.games[playlist.index + 1];
  const next = nextId && gameInfo(nextId);
  const request = playlistRequest();
  $('#overPlaylist').hidden = !playlist;
  $('#overStandings').hidden = !playlist;
  if (playlist) {
    $('#overPlaylistTitle').textContent = next ? `Next up · ${next.name}` : 'Playlist complete';
    $('#overPlaylistBlock').textContent = playlist.blocked || '';
    renderPlaylistGames($('#overPlaylistGames'), playlist.games, playlist.index);
    const board = $('#overScoreboard');
    board.replaceChildren();
    renderScoreTable(board, S.players.filter((p) => p.played || p.points));
  }
  const playNext = $('#playNextBtn');
  playNext.hidden = !(host && next);
  playNext.disabled = !!playlist?.blocked;
  playNext.onclick = () => quiet(act('next_playlist', request));
  const lobby = $('#lobbyBtn');
  lobby.hidden = !host;
  lobby.textContent = playlist ? (next ? 'End playlist' : 'Return to lobby') : '🏠 Lobby';
  lobby.onclick = () => quiet(act('lobby', playlist ? request : {}));
  $('#rematchBtn').hidden = !host || !!playlist;
  // "I'm in!" tells other people you want another round; alone with bots there's nobody to tell
  $('#readyBtn').hidden = !others;
  // one main action (#93): a game picked for next time (solo), the vote winner (host, once anyone voted), else Rematch
  const votes = S.votes || {};
  if (overPick && (overPick.at !== S.history.length || others)) overPick = null;
  const pickG = overPick && gameInfo(overPick.game);
  $('#playPickBtn').hidden = !!playlist || !(host && pickG);
  if (pickG) $('#playPickBtn').textContent = `▶ Play ${pickG.icon} ${pickG.name}`;
  $('#playVoteBtn').hidden = !!playlist || !(host && others && Object.keys(votes).length);
  $('#rematchBtn').className = $('#playPickBtn').hidden && $('#playVoteBtn').hidden ? 'primary' : '';
  $('#readyBtn').textContent = S.ready.includes(me.id) ? '✋ Ready!' : "🙋 I'm in!";
  $('#readyBtn').classList.toggle('on', S.ready.includes(me.id));
  $('#replayBtn').hidden = !S.hasReplay;
  const folded = overFoldedAt === S.gameNo;  // folding lasts for this game's results only
  $('#overBanner').classList.toggle('folded', folded);
  $('#overFold').textContent = folded ? '▾' : '▴ Board';  // spelled out while open: the way back to the board (#81)
  $('#overFold').ariaExpanded = String(!folded);
  // folded, the actions stay one tap away as icons in the slim bar (#170)
  const mini = $('#overMini'); mini.innerHTML = '';
  if (folded) for (const b of $('#overBanner .over-actions').children) {
    if (b.hidden) continue;
    const label = b.textContent.trim();
    const icon = { playPickBtn: '▶', playVoteBtn: '🗳️', replayBtn: '🎬', lobbyBtn: '🏠' }[b.id] || label.match(/^\p{Extended_Pictographic}\uFE0F?/u)?.[0] || '▶';
    const m = el('button', 'icon-btn mini-act' + (b.classList.contains('primary') ? ' primary' : '') + (b.classList.contains('on') ? ' on' : ''), icon);
    m.title = label; m.ariaLabel = label;
    m.disabled = b.disabled;
    m.onclick = (e) => { e.stopPropagation(); b.click(); };
    mini.append(m);
  }
  $('#overWait').textContent = (readyNames.length ? `Ready for more: ${readyNames.join(', ')}. ` : '')
    + (host ? '' : playlist ? (next ? 'The host starts the next game.' : 'The host can return everyone to the lobby.') : 'The host starts the next game. Your vote below counts 🗳️');
  $('#overVote').hidden = !!playlist;
  if (!playlist) renderVote(host, others);
  syncOverBack();
}
// the podium: the winner in the middle, up a step, with the runners-up either side (by score when the game
// keeps one, else just the winner)
function renderPodium(w, scored, low, draw) {
  const box = $('#overPodium'); box.innerHTML = '';
  if (draw) { box.hidden = true; return; }
  const places = scored.length > 1 ? [...scored].sort((a, b) => {
    const scoreOrder = low ? a.score - b.score : b.score - a.score;
    return scoreOrder || Number(b.id === w?.id) - Number(a.id === w?.id);
  }).slice(0, 3).map((x) => ({ p: player(x.id) || { name: x.name }, score: fmtNum(x.score) }))
    : w ? [{ p: w, score: '' }] : [];
  if (!places.length) { box.hidden = true; return; }
  box.hidden = false;
  const order = places.length === 3 ? [1, 0, 2] : places.length === 2 ? [0, 1] : [0];
  for (const k of order) {
    const { p, score } = places[k], col = el('div', 'pod pod-' + (k + 1));
    col.style.setProperty('--pc', p.color || '#888');
    const face = el('div', 'pod-face'); face.append(lookAvatar(p));
    if (k === 0) face.append(el('span', 'pod-crown', '👑'));
    col.append(face, el('b', '', p.name), el('small', '', score || ['Winner', '2nd', '3rd'][k]));
    box.append(col);
  }
}
// Back on the open results: the host goes to the lobby (#28); anyone else folds them to see the board
const foldOver = () => {
  if (S?.phase === 'over' && S.host === S.me.id) setTimeout(() => backFromResults().then(syncOverBack));
  else setOverFold(true);
};
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
  const shownFit = fit.filter((g) => !isHidden(g.id));  // 🙈 hidden games aren't suggested (votes still show)
  const picked = mine ? fit.filter((g) => g.id === mine) : [];
  const picks = [...picked, ...fit.filter((g) => voters(g.id).length), ...mineFirst(load('favGames') || []).filter((g) => !isHidden(g.id)), ...mineFirst(load('recentGames') || []).filter((g) => !isHidden(g.id)), ...fresh.filter((g) => !isHidden(g.id)), ...shownFit]
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
