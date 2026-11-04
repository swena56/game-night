// Ship, Captain & Crew: three slots for the 6, 5 and 4, the loose dice (the cargo once all three are
// in), and Roll / Dock. Once loaded, tap cargo dice to pick which ones to reroll.
UI.shipcrew = (() => {
  let S, ctx, pick = new Set([0, 1]), turnKey = '', seenLast = -1, rollKey = '', seenFound = 0;
  const $ = (id) => document.getElementById(id);
  const PIPS = Dice.PIPS;
  const SLOTS = [[6, '🚢', 'Ship'], [5, '🧭', 'Captain'], [4, '👥', 'Crew']];

  const die = (value, cls = '', tag = 'span') => Dice.die(value, cls, tag);

  function mount(main, side) {
    pick = new Set([0, 1]); turnKey = ''; seenLast = -1; rollKey = '';
    main.innerHTML = `<div class="crew">
      <div id="scTurn" class="crew-turn"></div>
      <div id="scSlots" class="crew-slots"></div>
      <div id="scLabel" class="crew-label"></div>
      <div id="scFree" class="ya-dice crew-free"></div>
      <div class="row crew-actions"><button id="scRoll" class="primary big"></button><button id="scDock" class="big">⚓ Dock</button></div>
      <p id="scHint" class="hint"></p>
      <div id="scLast" class="crew-last"></div></div>`;
    side.innerHTML = `<div class="panel"><h3>Cargo</h3><div id="scScores"></div><p class="hint left">Find 6 → 5 → 4 in order. The other two dice are your cargo.</p>
      <div id="scBest" hidden><h3>🏅 Best solo hauls</h3><ol class="ya-best"></ol><p class="hint left">Kept on this device, for this number of rounds.</p></div></div>`;
    $('scRoll').onclick = () => {
      const sc = S.shipcrew;
      ctx.quiet(ctx.act('roll', sc.loaded ? { reroll: [...pick].sort() } : {}));
    };
    $('scDock').onclick = () => ctx.quiet(ctx.act('dock', {}));
  }

  function render(s, c) {
    S = s; ctx = c;
    const sc = S.shipcrew;
    const mine = ctx.myTurn && !!ctx.act && S.phase === 'playing';
    const who = ctx.player(S.turn);
    const key = `${S.turn}|${sc.round}`;
    if (key !== turnKey || !sc.loaded) { turnKey = key; if (!sc.loaded) pick = new Set([0, 1]); }

    $('scTurn').textContent = S.phase !== 'playing' ? '' : `Round ${sc.round}/${sc.rounds} · ${mine ? 'Your turn' : `${who?.name ?? '?'}'s turn`} · ${'🎲'.repeat(sc.maxRolls - sc.rolls) || 'no rolls left'}`;

    // a fresh roll shakes the dice that just landed
    const rk = `${S.turn}|${sc.round}|${sc.rolls}`, shake = !!sc.rolls && rollKey !== '' && rk !== rollKey;
    rollKey = rk;
    const slots = $('scSlots'); slots.innerHTML = '';
    SLOTS.forEach(([v, icon, label], i) => {
      const slot = ctx.el('div', 'crew-slot' + (i < sc.found.length ? ' got' : i === sc.found.length ? ' next' : '')
        + (shake && i < sc.found.length && i >= seenFound ? ' landed' : ''));
      slot.append(i < sc.found.length ? die(v) : ctx.el('span', 'crew-empty', String(v)), ctx.el('small', '', `${icon} ${label}`));
      slots.append(slot);
    });

    // the ship's crew coming aboard, and a full hold, are moments
    if (shake && sc.found.length > seenFound) {
      ctx.sfx('good');
      if (sc.loaded) Kit.callout('⚓ Loaded!', 'good', { ms: 1100 });
    }
    if (shake && sc.loaded && sc.free[0] + sc.free[1] === 12) Kit.callout('Full hold! 12', 'gold', { sound: 'fanfare' });
    seenFound = sc.found.length;
    $('scLabel').textContent = sc.loaded ? `Cargo: ${sc.free[0] + sc.free[1]}` : sc.rolls ? `Still looking for a ${SLOTS[sc.found.length][0]} (${SLOTS[sc.found.length][2].toLowerCase()})` : '';
    const free = $('scFree'); free.innerHTML = '';
    sc.free.forEach((v, i) => {
      const canPick = mine && sc.loaded && sc.rolls < sc.maxRolls;
      const b = die(v, (canPick && pick.has(i) ? 'held' : '') + (sc.loaded ? ' cargo' : ' dim'), 'button');
      if (shake) setTimeout(() => Dice.roll([b], { sound: false }), 0);
      b.disabled = !canPick;
      b.setAttribute('aria-label', `${v}${canPick ? (pick.has(i) ? ', will reroll' : ', keeping') : ''}`);
      b.onclick = () => { pick.has(i) ? pick.delete(i) : pick.add(i); render(S, ctx); };
      free.append(b);
    });

    const rollsLeft = sc.rolls < sc.maxRolls;
    $('scRoll').hidden = !mine || !rollsLeft;
    $('scRoll').disabled = sc.loaded && pick.size === 0;
    $('scRoll').textContent = !sc.rolls ? '🎲 Roll' : sc.loaded ? (pick.size === 2 ? '🎲 Reroll cargo' : pick.size ? '🎲 Reroll one' : 'Tap dice to reroll') : '🎲 Roll again';
    $('scDock').hidden = !mine || !sc.loaded;
    $('scHint').textContent = !mine ? '' : sc.loaded && rollsLeft ? 'Raised dice get rerolled. Dock to keep your cargo.' : '';

    const last = $('scLast'); last.innerHTML = '';
    if (sc.last) {
      const p = ctx.player(sc.last.by);
      const line = ctx.el('div', 'crew-lastline' + (sc.last.n !== seenLast ? ' fresh' : ''));
      if (sc.last.n !== seenLast && seenLast !== -1 && !sc.last.cargo.length) Kit.callout('🌊 Sunk', 'bad', { ms: 1100 });
      seenLast = sc.last.n;
      const name = ctx.el('b', '', p?.name ?? '?'); name.style.color = p?.color ?? 'inherit';
      line.append(name, ctx.el('span', '', sc.last.cargo.length ? ` docked with ${sc.last.pts} cargo (${sc.last.cargo.join(' + ')})` : ` sank: no ${['ship', 'captain', 'crew'][sc.last.found.length]} — 0`));
      last.append(line);
    }

    const box = $('scScores'); box.innerHTML = '';
    for (const pid of sc.seats) {
      const p = ctx.player(pid); if (!p) continue;
      const row = ctx.el('div', 'seat-row' + (S.turn === pid ? ' turn' : ''));
      const dot = ctx.el('span', 'dot'); dot.style.background = p.color;
      row.append(dot, ctx.el('span', '', sc.coins ? `${p.name}: ${sc.coins[pid] ?? 0} 💰 · ${sc.scores[pid] ?? 0} cargo` : `${p.name}: ${sc.scores[pid] ?? 0}`));
      box.append(row);
    }
    if (sc.pot != null) box.append(ctx.el('div', 'crew-pot', `🍺 Pot: ${sc.pot} 💰`));
    if (sc.solo) box.append(ctx.el('div', 'hint left', `Solo goal: ${sc.goal} cargo`));
    if (sc.solo && sc.seats[0] === S.me.id && !!ctx.act) soloBest($('scBest'), `shipcrew.best.${sc.rounds}`, `${S.code}#${S.gameNo}`, sc.scores[S.me.id] ?? 0, S.phase === 'over', { fmt: (v) => `${v} cargo` });
  }

  const turnText = (s) => s.phase !== 'playing' || s.turn !== s.me.id ? null
    : !s.shipcrew.rolls ? '🚢 Roll!' : s.shipcrew.loaded ? '🚢 Reroll or dock?' : '🚢 Roll again';

  return { mount, render, turnText };
})();
