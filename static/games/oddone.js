// Odd One Out: your secret word, the table's clues, then a vote.
UI.oddone = (() => {
  let S, ctx, shownVotes = '';
  const $ = (id) => document.getElementById(id);
  const playing = () => S.phase === 'playing' && !S.me.spectator && !S.me.eliminated;

  function mount(main, side) {
    main.innerHTML = `<div class="oo">
      <div class="oo-card"><small id="ooLabel">Your secret word</small><b id="ooWord"></b><span id="ooRound" class="oo-round"></span></div>
      <!-- the clues stay put under the word; what you do now (clue, vote, result) comes after them (#18) -->
      <div class="panel"><h3>Clues</h3><div id="ooClues"></div></div>
      <form id="ooClueForm" class="row oo-form" autocomplete="off" hidden>
        <input id="ooClue" maxlength="20" placeholder="One-word clue" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send">
        <button class="primary">Give clue</button>
      </form>
      <form id="ooGuessForm" class="oo-form panel" autocomplete="off" hidden>
        <p>🎯 You were caught! Your word was the odd one. What was everyone else's word?</p>
        <div class="row"><input id="ooGuess" maxlength="30" placeholder="Their word" autocapitalize="off" spellcheck="false" enterkeyhint="send">
        <button class="primary">Guess</button></div>
      </form>
      <div id="ooVote" class="panel" hidden><h3>Who has the odd word?</h3><div id="ooVoteBtns" class="oo-votes"></div><p id="ooWaiting" class="hint"></p></div>
      <div id="ooResult" class="panel oo-result" hidden></div>
    </div>`;
    side.innerHTML = `<div class="panel"><h3>How it works</h3><ul class="rules">
      <li>Everyone has the same word, <b>except one player</b>, who has a similar one and doesn't know it.</li>
      <li>💬 Give one-word clues. Too vague looks suspicious; too obvious helps the odd one.</li>
      <li>🗳️ Vote for the odd one: <b>+2</b> each if they're caught (+1 if they escape).</li>
      <li>🏃 An odd one who escapes gets <b>+4</b>. Caught? Guess the real word for <b>+3</b>.</li></ul></div>`;
    const send = (form, input, type) => {
      $(form).onsubmit = (e) => {
        e.preventDefault();
        const text = $(input).value.trim();
        if (!text) return;
        ctx.quiet(ctx.act(type, { text }).then(() => { $(input).value = ''; }));
      };
    };
    send('ooClueForm', 'ooClue', 'clue');
    send('ooGuessForm', 'ooGuess', 'guess');
  }

  function dot(p) { const d = ctx.el('span', 'mini-disc'); d.style.background = p?.color ?? '#888'; return d; }

  function render(s, c) {
    S = s; ctx = c;
    const g = S.oddone;
    const watching = !g.word;
    $('ooLabel').textContent = watching ? 'Watching. The words are' : 'Your secret word';
    $('ooWord').textContent = watching ? (g.common ? `${g.common} · ${g.oddWord}` : '🤫') : g.word.toUpperCase();
    $('ooRound').textContent = `Round ${g.round} of ${g.rounds}`;

    $('ooClueForm').hidden = !(g.stage === 'clue' && ctx.myTurn);
    $('ooGuessForm').hidden = !(g.stage === 'guess' && ctx.myTurn);

    // clues, grouped by player in speaking order
    const box = $('ooClues'); box.innerHTML = '';
    const byPlayer = {};
    for (const [pid, text] of g.clues) (byPlayer[pid] ||= []).push(text);
    for (const pid of g.order) {
      const p = ctx.player(pid);
      const row = ctx.el('div', 'oo-clue-row');
      if (g.stage === 'clue' && S.turn === pid) row.classList.add('now');
      if (g.odd === pid) row.classList.add('odd');
      row.append(dot(p), ctx.el('b', '', p?.name ?? '?'));
      for (const t of byPlayer[pid] || []) row.append(ctx.el('span', 'oo-clue', t));
      if (g.stage === 'clue' && S.turn === pid) row.append(ctx.el('span', 'oo-clue pending', '…'));
      box.append(row);
    }

    // voting
    const voting = g.stage === 'vote';
    $('ooVote').hidden = !voting;
    if (voting) {
      // Update the buttons in place: rebuilding them on every update (bots chat and vote constantly)
      // replaced a button between a phone's touch and its click, so taps were lost.
      const btns = $('ooVoteBtns');
      const want = g.order.filter((pid) => { const p = ctx.player(pid); return p && pid !== S.me.id && !p.eliminated; });
      for (const b of [...btns.children]) if (!want.includes(b.dataset.pid)) b.remove();
      want.forEach((pid, i) => {
        let b = [...btns.children].find((x) => x.dataset.pid === pid);
        if (!b) {
          const p = ctx.player(pid);
          b = ctx.el('button', 'oo-vote');
          b.dataset.pid = pid;
          b.append(dot(p), p.name);
          b.onclick = () => ctx.quiet(ctx.act('vote', { target: pid }));
        }
        if (btns.children[i] !== b) btns.insertBefore(b, btns.children[i] || null);
        b.classList.toggle('on', g.myVote === pid);
        b.disabled = !playing();
      });
      const waiting = g.waiting.map((id) => ctx.player(id)?.name).filter(Boolean);
      $('ooWaiting').textContent = waiting.length ? `Waiting for: ${waiting.join(', ')}` : '';
    }

    // result
    const res = $('ooResult');
    res.hidden = !(g.stage === 'reveal' || g.stage === 'guess') || !g.result;
    if (!res.hidden) {
      res.innerHTML = '';
      const odd = ctx.player(g.odd);
      res.append(ctx.el('h3', '', g.result.caught ? '🎯 Caught!' : '🏃 The odd one escaped!'));
      const who = ctx.el('p', 'oo-who');
      who.append(dot(odd), `${odd?.name ?? '?'} had “${g.oddWord}”`);
      res.append(who);
      if (g.common) res.append(ctx.el('p', '', `Everyone else had “${g.common}”.`));
      if (g.result.guess) res.append(ctx.el('p', '', g.result.guessed ? `💡 They guessed “${g.result.guess}”. Correct, +3!` : `❌ They guessed “${g.result.guess}”.`));
      // who voted for whom: a row per suspect, most votes first, the voters' dots popping in one by one
      // (animated the first time this result is shown)
      const by = {};
      for (const [from, to] of Object.entries(g.votes || {})) (by[to] ||= []).push(from);
      const key = `${g.odd}|${g.oddWord}|${JSON.stringify(g.votes)}`, fresh = key !== shownVotes;
      shownVotes = key;
      const tally = ctx.el('div', 'oo-tally');
      let k = 0;
      for (const [to, froms] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) {
        const row = ctx.el('div', 'oo-trow' + (to === g.odd ? ' odd' : ''));
        const name = ctx.el('span', 'oo-tname'); name.append(dot(ctx.player(to)), ctx.player(to)?.name ?? '?');
        const voters = ctx.el('span', 'oo-voters');
        for (const from of froms) {
          const v = ctx.el('span', 'oo-voter', ctx.player(from)?.name ?? '?');
          v.style.borderColor = ctx.player(from)?.color ?? '#777';
          if (fresh) v.style.animationDelay = `${0.35 * k++}s`; else v.style.animation = 'none';
          voters.append(v);
        }
        row.append(name, ctx.el('b', 'oo-count', `${froms.length}`), voters);
        tally.append(row);
      }
      res.append(tally);
    }
  }

  function turnText(s) {
    const g = s.oddone;
    if (s.phase !== 'playing') return null;
    const name = (id) => s.players.find((p) => p.id === id)?.name ?? '?';
    if (g.stage === 'clue') return s.turn === s.me.id ? '💬 Your clue!' : `💬 ${name(s.turn)} is thinking of a clue…`;
    if (g.stage === 'vote') return g.myVote || !g.word ? '🗳️ Waiting for votes…' : '🗳️ Vote for the odd one!';
    if (g.stage === 'guess') return s.turn === s.me.id ? '🎯 Guess the real word!' : `🎯 ${name(s.turn)} is guessing the real word…`;
    return `🕵️ ${name(g.odd)} was the odd one`;
  }
  const myMove = (s) => s.phase === 'playing' && s.oddone.stage === 'vote' && !s.oddone.myVote && !!s.oddone.word && !s.me.eliminated;

  return { mount, render, turnText, myMove };
})();
