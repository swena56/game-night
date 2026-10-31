// Yacht: five dice (tap to hold), a Roll button, and the scorecard. Your open boxes become buttons
// that show what the current roll would score. The card is built once and updated in place.
UI.yacht = (() => {
  let S, ctx, hold = [false, false, false, false, false], holdFor = null, seenRoll = 0, cardKey = '';
  const $ = (id) => document.getElementById(id);
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

  function mount(main, side) {
    hold = [false, false, false, false, false]; holdFor = null; seenRoll = 0; cardKey = '';
    main.innerHTML = `<div class="ya">
      <div id="yaDice" class="ya-dice"></div>
      <button id="yaRoll" class="primary big"></button>
      <p id="yaHint" class="hint"></p>
      <table id="yaCard" class="scores ya-card"></table>
    </div>`;
    side.innerHTML = `<div class="panel"><div id="yaStatus" class="seat-row"></div>
      <ul class="rules ya-rules"><li>Ones–Sixes: that number's total</li><li>Full House: all dice · Four of a Kind: the four</li>
      <li>Little Straight 1–5 · Big Straight 2–6: 30</li><li>Choice: all dice · Yacht (five alike): 50</li></ul>
      <div id="yaBest" hidden><h3>🏅 Best solo scores</h3><ol class="ya-best"></ol><p class="hint left">Kept on this device.</p></div></div>`;
    const dice = $('yaDice');
    for (let i = 0; i < 5; i++) {
      const b = Object.assign(document.createElement('button'), { className: 'ya-die' });  // ctx arrives with the first render
      b.dataset.i = i;
      for (let k = 0; k < 9; k++) b.append(document.createElement('span'));
      b.onclick = () => { if (canHold()) { hold[i] = !hold[i]; paintDice(); } };
      dice.append(b);
    }
    $('yaRoll').onclick = () => ctx.quiet(ctx.act('roll', { hold: S.yacht.rolled ? hold : [false, false, false, false, false] }));
  }

  const canHold = () => ctx?.myTurn && S.phase === 'playing' && S.yacht.rolled && S.yacht.rollsLeft > 0;

  function paintDice(rolling = false) {
    const y = S.yacht;
    [...$('yaDice').children].forEach((b, i) => {
      const on = new Set(PIPS[y.dice[i]]);
      [...b.children].forEach((pip, k) => pip.classList.toggle('on', on.has(k)));
      b.classList.toggle('held', y.rolled && hold[i]);
      b.classList.toggle('blank', !y.rolled);
      b.disabled = !canHold();
      if (rolling && !(y.held[i])) { b.classList.remove('roll'); void b.offsetWidth; b.classList.add('roll'); }
    });
  }

  function render(s, c) {
    S = s; ctx = c;
    const y = S.yacht, me = S.me.id;
    // a new turn or a new roll: holds start from what the server kept
    const key = `${S.turn}:${y.rollId}`;
    if (key !== holdFor) { holdFor = key; hold = y.rolled ? [...y.held] : [false, false, false, false, false]; }
    paintDice(y.rollId !== seenRoll && seenRoll !== 0);
    seenRoll = y.rollId;

    const mineTurn = ctx.myTurn && S.phase === 'playing';
    $('yaRoll').disabled = !mineTurn || y.rollsLeft === 0;
    $('yaRoll').textContent = !y.rolled ? '🎲 Roll' : y.rollsLeft ? `🎲 Reroll (${y.rollsLeft} left)` : 'No rolls left: pick a box';
    const turnName = ctx.player(S.turn)?.name ?? '';
    $('yaHint').textContent = S.phase !== 'playing' ? y.last : !mineTurn ? `${turnName} is rolling…`
      : !y.rolled ? 'Roll the dice to start your turn.' : 'Tap dice to hold them, reroll, or tap a box below to score.';

    // scorecard: rows = boxes, columns = players (rebuilt only when the players change)
    const t = $('yaCard'), seats = y.seats.filter((id) => y.cards[id]);
    const ck = seats.join(',');
    if (ck !== cardKey) {
      cardKey = ck; t.innerHTML = '';
      const head = ctx.el('tr'); head.append(ctx.el('th', '', ''));
      for (const id of seats) { const th = ctx.el('th', '', ctx.player(id)?.name ?? '?'); th.style.color = ctx.player(id)?.color ?? ''; th.dataset.id = id; head.append(th); }
      t.append(head);
      for (const [cat, label] of y.cats) {
        const tr = ctx.el('tr'); tr.dataset.cat = cat;
        tr.append(ctx.el('td', '', label));
        for (const id of seats) {
          const td = ctx.el('td'); td.dataset.id = id;
          if (id === me) {
            const b = ctx.el('button', 'ya-box');
            b.onclick = async () => {
              // Scoring a 0 burns the box for the rest of the game, so check first.
              if (!S.yacht.preview?.[cat] && !(await ctx.ask(`Score 0 in ${label}? That box is used up for the game.`, { ok: 'Score 0', danger: true }))) return;
              ctx.quiet(ctx.act('score', { cat }));
            };
            td.append(b);
          }
          tr.append(td);
        }
        t.append(tr);
      }
      const tot = ctx.el('tr', 'ya-total'); tot.append(ctx.el('td', '', 'Total'));
      for (const id of seats) { const td = ctx.el('td'); td.dataset.id = id; tot.append(td); }
      t.append(tot);
    }
    for (const tr of t.querySelectorAll('tr[data-cat]')) {
      const cat = tr.dataset.cat;
      for (const td of tr.querySelectorAll('td[data-id]')) {
        const v = y.cards[td.dataset.id]?.[cat];
        const b = td.querySelector('button');
        if (b) {
          const open = v == null, live = open && mineTurn && y.rolled;
          b.disabled = !live;
          b.textContent = !open ? String(v) : live ? String(y.preview[cat] ?? 0) : '';
          b.classList.toggle('preview', live);
          b.classList.toggle('zero', live && !y.preview[cat]);
          b.classList.toggle('filled', !open);
        } else td.textContent = v == null ? '' : String(v);
      }
    }
    for (const td of t.querySelectorAll('tr.ya-total td[data-id]')) td.textContent = String(y.totals[td.dataset.id] ?? 0);
    for (const th of t.querySelectorAll('th[data-id]')) th.classList.toggle('now', th.dataset.id === S.turn);
    $('yaStatus').textContent = y.last ? `Last: ${y.last}` : 'Twelve boxes each';
    if (y.seats.length === 1 && y.seats[0] === me && !!ctx.act) showBest(y, me);
  }

  // solo high scores, kept in this browser; a finished card is recorded once (its boxes identify it)
  function showBest(y, me) {
    let best = [];
    try { best = JSON.parse(localStorage.getItem('yacht.best')) || []; } catch {}
    const card = JSON.stringify(y.cards[me]), score = y.totals[me] ?? 0;
    let fresh = null;
    if (S.phase === 'over' && !best.some((b) => b.card === card)) {
      fresh = { score, card, date: new Date().toISOString().slice(0, 10) };
      best = [...best, fresh].sort((a, b) => b.score - a.score).slice(0, 5);
      try { localStorage.setItem('yacht.best', JSON.stringify(best)); } catch {}
    }
    const box = $('yaBest'), list = box.querySelector('ol');
    box.hidden = !best.length;
    list.innerHTML = '';
    for (const b of best) {
      const li = ctx.el('li', b === fresh || (S.phase === 'over' && b.card === card) ? 'now' : '', `${b.score} `);
      li.append(ctx.el('small', '', b.date));
      list.append(li);
    }
  }

  return { mount, render };
})();
