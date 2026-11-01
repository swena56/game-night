// Shut the Box: the box being played (tiles 1–9 or 1–12), the dice, and Roll / Shut. After a roll, tap
// open tiles that add up to it; tiles that can't be part of any fit are dimmed. The side panel shows
// every player's box and round scores.
UI.shutbox = (() => {
  let S, ctx, pick = new Set(), pickKey = '', seenRoll = -1;
  const $ = (id) => document.getElementById(id);
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

  function die(value, cls = '') {
    const b = ctx.el('span', 'ya-die ' + cls);
    const on = new Set(PIPS[value]);
    for (let k = 0; k < 9; k++) b.append(ctx.el('span', on.has(k) ? 'on' : ''));
    return b;
  }

  function mount(main, side) {
    pick = new Set(); pickKey = ''; seenRoll = -1;
    main.innerHTML = `<div class="sb">
      <div id="sbWho" class="sb-who"></div>
      <div id="sbBox" class="sb-box"></div>
      <div id="sbDice" class="ya-dice sb-dice"></div>
      <div id="sbSum" class="sb-sum"></div>
      <div class="row sb-actions"><button id="sbRoll2" class="primary big">🎲 Roll</button>
        <button id="sbRoll1" class="big">🎲 One die</button><button id="sbShut" class="primary big">📦 Shut</button></div>
      <p id="sbHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3 id="sbRound">Boxes</h3><div id="sbBoxes"></div><p id="sbTarget" class="hint left"></p></div>';
    $('sbRoll2').onclick = () => ctx.quiet(ctx.act('roll', { dice: 2 }));
    $('sbRoll1').onclick = () => ctx.quiet(ctx.act('roll', { dice: 1 }));
    $('sbShut').onclick = () => {
      const tiles = [...pick];
      pick = new Set();
      ctx.quiet(ctx.act('shut', { tiles }));
    };
  }

  function render(s, c) {
    S = s; ctx = c;
    const sb = S.shutbox, cur = S.turn, box = sb.boxes[cur] || { tiles: [] };
    const mine = ctx.myTurn && sb.stage === 'play';
    const total = sb.dice.reduce((a, b) => a + b, 0);
    // a new roll (or a new box) clears the selection; a single possible fit is picked for you
    const key = `${cur}:${sb.rollId}:${sb.rolled}`;
    if (key !== pickKey) {
      pickKey = key;
      pick = new Set(mine && sb.rolled && sb.options.length === 1 ? sb.options[0] : []);
    }
    for (const t of [...pick]) if (!box.tiles.includes(t)) pick.delete(t);
    const usable = new Set(sb.options.flat());
    const chosen = [...pick].reduce((a, b) => a + b, 0);

    const who = ctx.player(cur);
    $('sbWho').textContent = sb.stage === 'between' ? `Round ${sb.round} is over` : who ? `${who.name}'s box${cur === S.me.id ? ' (you)' : ''}` : '';
    $('sbWho').style.color = sb.stage === 'between' ? '' : who?.color ?? '';

    const bx = $('sbBox'); bx.innerHTML = '';
    for (let t = 1; t <= sb.n; t++) {
      const open = box.tiles.includes(t);
      const b = ctx.el('button', 'sb-tile' + (open ? '' : ' shut') + (pick.has(t) ? ' picked' : '') +
        (mine && sb.rolled && open && !usable.has(t) ? ' dim' : ''), String(t));
      b.disabled = !(mine && sb.rolled && open && usable.has(t));
      b.setAttribute('aria-label', `tile ${t}${open ? '' : ', shut'}`);
      b.onclick = () => { pick.has(t) ? pick.delete(t) : pick.add(t); ctx.rerender(); };
      bx.append(b);
    }

    const dc = $('sbDice');
    if (sb.rollId !== seenRoll || !dc.children.length !== !sb.dice.length) {
      const fresh = sb.rollId !== seenRoll && seenRoll !== -1;
      seenRoll = sb.rollId;
      dc.innerHTML = '';
      for (const v of sb.dice) dc.append(die(v, fresh ? 'roll' : ''));
    }
    dc.classList.toggle('faded', !sb.rolled);

    $('sbSum').textContent = sb.rolled && sb.stage === 'play' ? (mine ? `Roll ${total} · picked ${chosen}` : `Rolled ${total}`)
      : sb.stage === 'stuck' && sb.last ? `Rolled ${total}: nothing fits · ${sb.last.pts} points` : '';
    $('sbRoll2').hidden = $('sbRoll1').hidden = !(mine && !sb.rolled);
    $('sbRoll2').textContent = sb.canOne ? '🎲🎲 Two dice' : '🎲 Roll';
    $('sbRoll1').hidden = !(mine && !sb.rolled && sb.canOne);
    $('sbShut').hidden = !(mine && sb.rolled);
    $('sbShut').disabled = chosen !== total;
    $('sbShut').textContent = chosen === total && pick.size ? `📦 Shut ${[...pick].sort((a, b) => b - a).join(' + ')}` : '📦 Shut';
    $('sbHint').textContent = S.phase !== 'playing' ? '' : sb.stage === 'between' ? 'Next round in a moment…'
      : !mine ? (who ? `${who.name} is playing…` : '') : !sb.rolled ? (sb.canOne ? 'Roll two dice, or one now that 7 and up are shut.' : 'Roll the dice.')
      : chosen > total ? 'Too much: tap a tile to put it back.' : 'Tap tiles that add up to your roll, then Shut.';

    $('sbRound').textContent = `Round ${sb.round} of ${sb.rounds}`;
    const list = $('sbBoxes'); list.innerHTML = '';
    for (const pid of sb.seats) {
      const p = ctx.player(pid), bxp = sb.boxes[pid];
      if (!bxp) continue;
      const row = ctx.el('div', 'sb-row' + (pid === cur && sb.stage !== 'between' ? ' now' : ''));
      const head = ctx.el('div', 'seat-row');
      const nm = ctx.el('span', 'grow', `${p?.name ?? 'left'}${pid === S.me.id ? ' (you)' : ''}`); nm.style.color = p?.color ?? '';
      head.append(nm, ctx.el('b', '', `${bxp.total}`));
      const mini = ctx.el('div', 'sb-mini');
      for (let t = 1; t <= sb.n; t++) mini.append(ctx.el('span', bxp.tiles.includes(t) ? '' : 'shut', String(t)));
      const sc = ctx.el('div', 'hint left', (bxp.scores.length ? 'Rounds: ' + bxp.scores.join(' · ') : '') +
        (S.phase === 'playing' && pid === cur && sb.stage !== 'between' ? (bxp.scores.length ? ' · ' : '') + 'Playing…'
          : !bxp.scores.length && !sb.done.includes(pid) ? 'Not played yet' : ''));
      row.append(head, mini, sc);
      list.append(row);
    }
    $('sbTarget').textContent = sb.target != null ? `Alone: finish on ${sb.target} points or fewer to win.` : 'Lowest total after the last round wins.';
  }

  return { mount, render };
})();
