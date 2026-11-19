// Dice Brawl: the brawlers (health bars and shields), five combat dice (tap to hold; skulls lock), and
// Roll / Fight. With damage to deal, tap a rival to pick the target before you fight.
UI.brawl = (() => {
  let S, ctx, hold = new Set(), target = null, turnKey = '', rollKey = '', seenLast = -1;
  const $ = (id) => document.getElementById(id);
  const NAME = { 1: 'skull', 2: 'sword', 3: 'sword', 4: 'smash', 5: 'shield', 6: 'heart' };

  function mount(main, side) {
    hold = new Set(); target = null; turnKey = ''; rollKey = ''; seenLast = -1;
    main.innerHTML = `<div class="brw">
      <div id="brwTurn" class="brw-turn"></div>
      <div id="brwRing" class="brw-ring"></div>
      <div id="brwTally" class="brw-tally"></div>
      <div id="brwPreview" class="brw-preview"></div>
      <div class="ya-tray"><div id="brwDice" class="brw-dice"></div></div>
      <div class="row brw-actions"><button id="brwRoll" class="primary big"></button><button id="brwFight" class="big danger"></button></div>
      <p id="brwHint" class="hint"></p>
      <div id="brwLast" class="brw-last"></div></div>`;
    const face = (n, f, text) => `<li><span class="brw-die mini f${f}">${Dice.art(n)}</span><span>${text}</span></li>`;
    side.innerHTML = `<div class="panel"><h3>The faces</h3><ul class="brw-legend">${face('skull', 1, '<b>Skull</b>: locks. Three backfire: −2 ❤️')}${face('sword', 2, '<b>Sword</b> (two faces): 1 hit')}${face('smash', 4, '<b>Smash</b>: 2 hits. Three hit everyone')}${face('shield', 5, '<b>Shield</b>: blocks 1 until your next turn')}${face('heart', 6, '<b>Heart</b>: heals 1')}</ul></div>`;
    $('brwRoll').onclick = () => ctx.quiet(ctx.act('roll', { hold: [...hold] }));
    $('brwFight').onclick = () => ctx.quiet(ctx.act('fight', { target }));
  }

  function render(s, c) {
    S = s; ctx = c;
    const b = S.brawl;
    const mine = ctx.myTurn && !!ctx.act && S.phase === 'playing';
    const key = `${S.turn}|${b.seats.length}`;
    if (key !== turnKey) { turnKey = key; hold = new Set(); target = null; }
    const who = ctx.player(S.turn);
    $('brwTurn').textContent = S.phase !== 'playing' ? '' : `${mine ? 'Your turn' : `${who?.name ?? '?'}'s turn`} · ${'🎲'.repeat(b.maxRolls - b.rolls) || 'no rolls left'}`;

    const t = b.tally;
    const quake = t && t.smash >= 3, needTarget = mine && t && t.dmg > 0 && !quake;
    const alive = b.seats.filter((pid) => (b.hp[pid] ?? 0) > 0);
    if (needTarget && (!target || target === S.me.id || !alive.includes(target))) {
      // default: the rival you'd knock out, else the weakest
      const rivals = alive.filter((pid) => pid !== S.me.id);
      target = rivals.find((pid) => t.dmg - (b.guard[pid] ?? 0) >= b.hp[pid]) ?? rivals.sort((x, y) => b.hp[x] - b.hp[y])[0] ?? null;
    }

    // the ring of brawlers
    const ring = $('brwRing'); ring.innerHTML = '';
    for (const pid of b.seats) {
      const p = ctx.player(pid); if (!p) continue;
      const hp = b.hp[pid] ?? 0, out = hp <= 0;
      const card = ctx.el('button', 'brw-fighter' + (S.turn === pid ? ' turn' : '') + (out ? ' out' : '') + (needTarget && pid === target ? ' target' : ''));
      card.dataset.k = pid;
      card.disabled = !needTarget || pid === S.me.id || out;
      const name = ctx.el('b', '', p.name); name.style.color = p.color;
      const bar = ctx.el('div', 'brw-bar'); const fill = ctx.el('i'); fill.style.width = `${Math.max(0, hp) / b.maxHp * 100}%`;
      fill.classList.toggle('low', hp <= b.maxHp / 3); bar.append(fill);
      card.append(name, bar, ctx.el('span', 'brw-hp', out ? '☠️ out' : `❤️ ${hp}` + (b.guard[pid] ? ` · 🛡️ ${b.guard[pid]}` : '')));
      if (needTarget && pid === target) card.append(ctx.el('span', 'brw-aim', `🎯 −${Math.max(0, t.dmg - (b.guard[pid] ?? 0))}`));
      card.onclick = () => { target = pid; render(S, ctx); };
      ring.append(card);
    }

    $('brwTally').textContent = !t ? '' : t.skulls >= 3 ? '💀💀💀 Backfire!'
      : [t.dmg ? `⚔️ ${t.dmg} damage${quake ? ' to EVERYONE 🌋' : ''}` : '', t.shield ? `🛡️ ${t.shield}` : '', t.heal ? `❤️ +${t.heal}` : '', t.skulls ? `💀 ${t.skulls}/3` : ''].filter(Boolean).join(' · ');

    // ⚔️ combat preview (mirrors preview() in games/brawl.py): fighting now on the chosen target, and
    // the average of every way the unheld dice could land, with the backfire and quake chances
    const pv = $('brwPreview'); pv.innerHTML = '';
    if (mine && t && t.skulls < 3) {
      const guards = Object.fromEntries(alive.filter((pid) => pid !== S.me.id).map((pid) => [pid, b.guard[pid] ?? 0]));
      // no damage showing yet: aim the reroll forecast at the weakest rival (the default pick)
      const aim = target ?? Object.keys(guards).sort((x, y) => b.hp[x] - b.hp[y])[0] ?? null;
      const P = preview(b.dice, b.rolls < b.maxRolls ? hold : new Set(b.dice.keys()), guards, aim, b.maxHp - (b.hp[S.me.id] ?? 0));
      const fmt = (o, avg) => {
        const n = (v) => avg ? v.toFixed(1) : String(v);
        return [`⚔️ ${n(o.dmg)} dmg${o.quake === 1 ? ' 🌋' : ''}`, `🛡️ ${n(o.guard)}`, `❤️ +${n(o.heal)}`].join(' · ');
      };
      pv.append(ctx.el('div', '', `👊 Fight now${P.now.quake ? ' (quake)' : t.dmg ? ` on ${ctx.player(aim)?.name ?? '…'}` : ''}: ${fmt(P.now)}`));
      if (P.reroll) {
        const R = P.reroll, pct = (v) => `${Math.round(v * 100)}%`;
        const row = ctx.el('div', '', `🎲 Reroll ${P.free}${Object.keys(guards).length > 1 && aim ? ` (on ${ctx.player(aim)?.name ?? '…'})` : ''}, likely: ${fmt(R, true)} · `);
        row.append(ctx.el('b', R.backfire >= 0.25 ? 'brw-risk' : '', `💀 backfire ${pct(R.backfire)}`), ` · 🌋 quake ${pct(R.quake)}`);
        pv.append(row);
      }
    }

    const rk = `${S.turn}|${b.n}`, fresh = b.dice.length && rk !== rollKey && rollKey !== '';
    rollKey = rk;
    const tray = $('brwDice'); tray.innerHTML = '';
    const canHold = mine && b.dice.length && b.rolls < b.maxRolls;
    const nodes = b.dice.map((v, i) => {
      const skull = v === 1;
      const d = ctx.el('button', 'brw-die f' + v + (skull ? ' locked' : hold.has(i) ? ' held' : ''));
      d.innerHTML = Dice.art(NAME[v]);
      d.disabled = !canHold || skull;
      d.setAttribute('aria-label', `${NAME[v]}${skull ? ', locked' : hold.has(i) ? ', held' : ''}`);
      d.onclick = () => { hold.has(i) ? hold.delete(i) : hold.add(i); render(S, ctx); };
      tray.append(d);
      return d;
    });
    if (!b.dice.length) for (let i = 0; i < 5; i++) tray.append(ctx.el('span', 'brw-die blank', '·'));
    if (fresh) Dice.roll(nodes);

    const free = b.dice.filter((v) => v !== 1).length;
    $('brwRoll').hidden = !mine || b.rolls >= b.maxRolls;
    $('brwRoll').disabled = b.dice.length > 0 && hold.size >= free;
    $('brwRoll').textContent = !b.dice.length ? '🎲 Roll' : `🎲 Reroll ${free - hold.size}`;
    $('brwFight').hidden = !mine || !b.dice.length;
    $('brwFight').textContent = quake ? '🌋 Quake!' : t && t.dmg ? `👊 Hit ${ctx.player(target)?.name ?? '…'}` : '👊 Done';
    $('brwHint').textContent = !mine ? '' : !b.dice.length ? 'Roll five combat dice.' : b.rolls < b.maxRolls ? 'Tap dice to hold them, then reroll the rest — or fight now.' : 'No rolls left: fight!';

    const last = $('brwLast'); last.innerHTML = '';
    if (b.last) {
      const L = b.last, p = ctx.player(L.by);
      if (L.n !== seenLast && seenLast !== -1) {
        if (L.backfire) Kit.callout('💀 Backfire!', 'bad', { ms: 1200 });
        else if (L.quake) Kit.callout('🌋 QUAKE!', 'gold', { sound: 'boom' });
        for (const [pid, [dmg]] of Object.entries(L.hits || {})) if (dmg) Kit.flyText(ring.querySelector(`[data-k="${pid}"]`), `−${dmg}`, 'bad');
        if (L.heal) Kit.flyText(ring.querySelector(`[data-k="${L.by}"]`), `+${L.heal}`, 'good');
      }
      seenLast = L.n;
      const name = ctx.el('b', '', p?.name ?? '?'); name.style.color = p?.color ?? 'inherit';
      const hits = Object.entries(L.hits || {}).map(([pid, [d, bl]]) => `${ctx.player(pid)?.name ?? '?'} −${d}${bl ? ` (🛡️${bl})` : ''}`);
      const what = L.backfire ? ' backfired: −2 ❤️' : ' ' + ([hits.length ? 'hit ' + hits.join(', ') : '', L.heal ? `healed ${L.heal}` : '', L.shield ? `🛡️ ${L.shield}` : ''].filter(Boolean).join(' · ') || 'did nothing much');
      last.append(name, ctx.el('span', '', what));
    }
  }

  function outcome(dice, guards, target, missing) {
    const sk = dice.filter((v) => v === 1).length, sm = dice.filter((v) => v === 4).length;
    if (sk >= 3) return { backfire: 1, quake: 0, dmg: 0, guard: 0, heal: 0 };
    const raw = dice.filter((v) => v === 2 || v === 3).length + 2 * sm, quake = sm >= 3;
    const hit = quake ? Object.keys(guards) : raw && target in guards ? [target] : [];
    return { backfire: 0, quake: quake ? 1 : 0, dmg: hit.reduce((a, q) => a + Math.max(0, raw - guards[q]), 0),
      guard: dice.filter((v) => v === 5).length, heal: Math.min(dice.filter((v) => v === 6).length, missing) };
  }

  function preview(dice, hold, guards, target, missing) {
    const now = outcome(dice, guards, target, missing);
    const free = dice.map((v, i) => i).filter((i) => dice[i] !== 1 && !hold.has(i));
    if (!free.length) return { now, reroll: null, free: 0 };
    const tot = { backfire: 0, quake: 0, dmg: 0, guard: 0, heal: 0 }, n = 6 ** free.length;
    for (let code = 0; code < n; code++) {
      const d = [...dice];
      free.forEach((i, k) => { d[i] = Math.floor(code / 6 ** k) % 6 + 1; });
      const o = outcome(d, guards, target, missing);
      for (const k in tot) tot[k] += o[k];
    }
    for (const k in tot) tot[k] /= n;
    return { now, reroll: tot, free: free.length };
  }

  const turnText = (s) => s.phase !== 'playing' || s.turn !== s.me.id ? null : !s.brawl.dice.length ? '⚔️ Roll!' : '⚔️ Hold, reroll or fight';

  return { mount, render, turnText };
})();
