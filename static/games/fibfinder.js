// Fib Finder: write a fake answer, then pick the real one.
UI.fibfinder = (() => {
  let S, ctx, lastRound = 0, revealed = '', hideTruthUntil = 0;
  const $ = (id) => document.getElementById(id);
  const playing = () => S.phase === 'playing' && !S.me.spectator && !S.me.eliminated;

  function mount(main, side) {
    lastRound = 0; revealed = '';
    main.innerHTML = `<div class="fb">
      <div class="fb-head"><span id="fbRound"></span><span id="fbFinal" class="fb-final" hidden>🔥 Double points</span></div>
      <div id="fbFact" class="fb-fact"></div>
      <form id="fbForm" class="fb-form" autocomplete="off" hidden>
        <div class="row"><input id="fbFib" maxlength="40" placeholder="A fake answer that sounds true" enterkeyhint="send">
        <button class="primary">Submit</button></div>
        <p id="fbMine" class="hint left"></p>
      </form>
      <div id="fbOptions" class="fb-options"></div>
      <p id="fbWaiting" class="hint"></p>
    </div>`;
    side.innerHTML = `<div class="panel"><h3>Scoring</h3><ul class="rules">
      <li>🔍 Pick the truth: <b>+3</b></li>
      <li>🤥 Each player fooled by your fib: <b>+2</b></li>
      <li>🏠 House fibs are added so there are always enough answers.</li>
      <li>🔥 The last fact counts double.</li></ul></div>`;
    $('fbForm').onsubmit = (e) => {
      e.preventDefault();
      const text = $('fbFib').value.trim();
      if (!text) return;
      ctx.quiet(ctx.act('fib', { text }).then(() => { $('fbFib').value = ''; }));
    };
  }

  function factLine(f) {
    const box = $('fbFact'); box.innerHTML = '';
    const [before, after = ''] = f.fact.split('____');
    const truth = performance.now() < hideTruthUntil ? null : f.reveal?.find((o) => o.truth)?.text;
    box.append(before, ctx.el('span', truth ? 'fb-blank filled' : 'fb-blank', truth ?? '?'), after);
  }

  function render(s, c) {
    S = s; ctx = c;
    const f = S.fibfinder;
    if (f.round !== lastRound) { lastRound = f.round; $('fbFib').value = ''; }
    $('fbRound').textContent = `Fact ${f.round} of ${f.rounds}`;
    $('fbFinal').hidden = !f.final;
    factLine(f);

    const writing = f.stage === 'write' && playing();
    $('fbForm').hidden = !writing;
    $('fbMine').textContent = f.mine ? `✅ Your fib: “${f.mine}”. You can change it until everyone's in.` : 'Make it believable. If you type the real answer, you\'ll be asked for another.';

    const box = $('fbOptions');
    if (f.stage === 'pick') {
      // Rebuild only when the answers change; otherwise update in place, so a tap that lands while
      // bots are picking isn't lost to a replaced button.
      const key = JSON.stringify([f.options, f.mineIdx]);
      if (box.dataset.key !== key) {
        box.innerHTML = ''; box.dataset.key = key;
        f.options.forEach((text, i) => {
          const b = ctx.el('button', 'fb-opt', text);
          if (f.mineIdx.includes(i)) b.append(ctx.el('small', '', ' (your fib)'));
          b.onclick = () => ctx.quiet(ctx.act('pick', { i }));
          box.append(b);
        });
      }
      [...box.children].forEach((b, i) => {
        b.classList.toggle('on', f.myPick === i);
        b.disabled = f.mineIdx.includes(i) || !playing();
      });
    } else if (f.reveal) {
      // the reveal plays out fib by fib, who fell for each, and the truth comes last
      const rk = `${f.round}`;
      if (revealed === rk) return paintWaiting(f);
      const staged = revealed !== '' || box.dataset.key !== '';
      revealed = rk;
      box.innerHTML = ''; box.dataset.key = '';
      const order = [...f.reveal].sort((a, b) => (a.truth - b.truth) || (a.pickers.length - b.pickers.length));
      const cards = [];
      for (const o of order) {
        const card = ctx.el('div', `fb-res${o.truth ? ' truth' : ''}`);
        card.append(ctx.el('b', '', o.text));
        const by = o.truth ? '✅ The truth' : o.house ? '🏠 House fib'
          : `🤥 ${o.authors.map((id) => ctx.player(id)?.name ?? '?').join(' & ')}`;
        card.append(ctx.el('small', '', by));
        const row = ctx.el('div', 'reveal-row');
        for (const pid of o.pickers) {
          const p = ctx.player(pid);
          const tag = ctx.el('span', 'reveal-tag', p?.name ?? '?');
          tag.style.borderColor = p?.color ?? '#777';
          row.append(tag);
        }
        card.append(row);
        if (!o.truth && o.authors.length && o.pickers.length) card.dataset.fooled = `+${2 * o.pickers.length * (f.final ? 2 : 1)}`;
        box.append(card);
        cards.push(card);
      }
      if (staged && motionOK()) {
        cards.forEach((c2) => c2.classList.add('hidden-card'));
        hideTruthUntil = performance.now() + (cards.length - 1) * 900;
        Kit.reveal(cards, 900, (c2) => {
          c2.classList.remove('hidden-card'); c2.classList.add('flip-in');
          if (c2.dataset.fooled) Kit.flyText(c2, `🤥 ${c2.dataset.fooled}`, 'gold');
          if (c2.classList.contains('truth')) { ctx.sfx('fanfare'); hideTruthUntil = 0; factLine(S.fibfinder); }
        }, { sound: 'flip' });
        factLine(f);  // the blank stays a mystery until the truth card turns
      }
    } else {
      revealed = '';
      box.innerHTML = ''; box.dataset.key = '';
    }
    paintWaiting(f);
  }
  function paintWaiting(f) {
    const waiting = f.waiting.map((id) => ctx.player(id)?.name).filter(Boolean);
    $('fbWaiting').textContent = S.phase === 'playing' && waiting.length ? `Waiting for: ${waiting.join(', ')}` : '';
  }

  function turnText(s) {
    const f = s.fibfinder;
    if (s.phase !== 'playing') return null;
    if (f.stage === 'write') return f.mine ? '✍️ Fib in. Waiting…' : '✍️ Write a fib!';
    if (f.stage === 'pick') return f.myPick != null ? '🔍 Waiting for picks…' : '🔍 Which one is true?';
    return '✅ The truth is out';
  }
  const myMove = (s) => s.phase === 'playing' && !s.me.spectator && !s.me.eliminated
    && ((s.fibfinder.stage === 'write' && !s.fibfinder.mine) || (s.fibfinder.stage === 'pick' && s.fibfinder.myPick == null));

  return { mount, render, turnText, myMove };
})();
