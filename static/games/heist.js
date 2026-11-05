UI.heist = (() => {
  let S, ctx, seenNight = null, shownPot = null, potTimer = 0;
  const OPTIONS = [
    ['grab', '🦹', 'Grab', 'Steal the whole vault, but only if you are the only grabber and nobody guards.'],
    ['guard', '🛡️', 'Guard', 'Catch grabbers and collect a 💰2 fine from each. Guarding an empty hall costs 💰1.'],
    ['rest', '😴', 'Rest', 'Play it safe: +💰1.'],
  ];
  const ICON = Object.fromEntries(OPTIONS.map(([id, icon]) => [id, icon]));

  function mount(main, side) {
    seenNight = null; shownPot = null;
    main.innerHTML = `<div class="heist">
      <div class="vault" id="hVault"><div class="h-night" aria-hidden="true"><i class="moon"></i><i class="beam"></i></div>
        <svg class="vault-door" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" class="vd-rim"/><circle cx="50" cy="50" r="38" class="vd-face"/>
          <g class="vd-wheel"><circle cx="50" cy="50" r="12"/><path d="M50 22v56M22 50h56M30 30l40 40M70 30 30 70"/></g>
          <circle cx="50" cy="50" r="5" class="vd-hub"/></svg>
        <div class="vault-info"><div id="hNight"></div><div id="hPot" class="pot"></div><div id="hCoins" class="coins"></div></div></div>
      <div id="hChoices" class="h-choices"></div>
      <div class="row center"><button id="hTip" hidden>🕵️ Ask your inside man</button></div>
      <p id="hWaiting" class="hint"></p>
      <div id="hLast" class="panel"></div>
      <div id="hGrid" class="panel h-grid-wrap" hidden><h3>Night by night</h3><table id="hGridT" class="h-grid"></table></div>
    </div>`;
    side.innerHTML = `<div class="panel"><h3>How it works</h3>
      <p class="hint left">Everyone chooses in secret, then all choices are revealed together.</p>
      <ul class="rules">
        <li>🦹 A <b>lone grabber</b> steals the vault.</li>
        <li id="hRuleTwo">🔔 <b>Two or more grabbers</b> trip the alarm, and the loot keeps growing.</li>
        <li>🛡️ <b>Guards</b> fine every grabber 💰2.</li>
        <li>😴 <b>Rest</b> earns 💰1.</li>
      </ul>
      <p class="hint left">You can change your mind until the last player locks in. Most gold after the final night wins.</p></div>`;
    main.querySelector('#hTip').onclick = () => ctx.quiet(ctx.act('tip'));
    const box = main.querySelector('#hChoices');
    for (const [id, icon, label, desc] of OPTIONS) {
      const b = document.createElement('button');
      b.className = 'h-choice'; b.dataset.id = id;
      b.innerHTML = `<span class="big-icon">${icon}</span><b>${label}</b><small>${desc}</small>`;
      b.onclick = () => ctx.quiet(ctx.act('choose', { choice: id }));
      box.append(b);
    }
  }

  function render(s, c) {
    S = s; ctx = c;
    const h = S.heist;
    const two = document.getElementById('hRuleTwo');
    if (two && h.crew) two.innerHTML = '🤝 <b>Two grabbers</b> split the vault; <b>three or more</b> trip the alarm.';
    document.getElementById('hNight').textContent = h.rounds ? `🌙 Night ${h.night} of ${h.rounds}` : `🌙 Night ${h.night} · ♾️`;
    // ♾️ endless: the host decides when everyone cashes out (#63)
    let out = document.getElementById('hCashout');
    if (!h.rounds && h.host && S.phase === 'playing' && h.night > 1) {
      if (!out) {
        out = ctx.el('button', 'ghost-btn h-cashout', '🏁 Cash out');
        out.id = 'hCashout';
        out.onclick = async () => (await ctx.ask('End the heist now? Most gold wins.', { ok: '🏁 Cash out' })) && ctx.quiet(ctx.act('cashout'));
        document.getElementById('hNight').after(out);
      }
    } else out?.remove();
    paintPot(h.pot);
    const canPlay = S.phase === 'playing' && !S.me.ghost && !S.me.spectator;
    for (const b of document.querySelectorAll('.h-choice')) {
      b.classList.toggle('on', h.mine === b.dataset.id);
      b.disabled = !canPlay;
    }
    const tip = document.getElementById('hTip');
    tip.hidden = !h.tips || !canPlay;
    tip.disabled = !!h.mine || h.waiting.length >= Object.keys(h.gold).length;  // nobody has chosen yet
    tip.title = 'Once a game: how many of those who have chosen tonight are grabbing';
    const waiting = h.waiting.map((id) => ctx.player(id)?.name).filter(Boolean);
    document.getElementById('hWaiting').textContent =
      S.phase === 'playing' && waiting.length ? `Waiting for: ${waiting.join(', ')}` : '';
    const last = document.getElementById('hLast');
    last.hidden = !h.last;
    const fresh = h.last && seenNight !== null && h.last.night !== seenNight;
    if (h.last && (fresh || h.last.night !== seenNight || !last.childElementCount)) {
      last.innerHTML = '';
      last.append(ctx.el('h3', '', `Night ${h.last.night} revealed`));
      const row = ctx.el('div', 'reveal-row');
      const tags = [];
      for (const [pid, choice] of Object.entries(h.last.choices)) {
        const p = ctx.player(pid);
        // each choice is a card that turns over in turn: the reveal is the whole game
        const tag = ctx.el('span', 'reveal-tag h-card' + (fresh && motionOK() ? ' down' : ''));
        // each card wears the player's face, so the table reads at a glance who did what
        const front = ctx.el('b', 'h-front'), back = ctx.el('b', 'h-back');
        front.append(avatar(p), `${ICON[choice]} ${p?.name ?? '?'}`); back.append(avatar(p), `❓ ${p?.name ?? '?'}`);
        tag.append(front, back);
        tag.dataset.pid = pid;
        tag.style.borderColor = p?.color ?? '#777';
        tag.dataset.choice = choice;
        row.append(tag); tags.push(tag);
      }
      const text = ctx.el('p', 'h-outcome' + (fresh && motionOK() ? ' wait' : ''), h.last.text);
      last.append(row, text);
      if (fresh) Kit.reveal(tags, 550, (t) => t.classList.remove('down'), { done: () => { text.classList.remove('wait'); outcome(h); } });
    }
    if (h.last) seenNight = h.last.night; else if (seenNight === null) seenNight = 0;
    paintGrid(h);
  }

  // the night's result lands: an alarm, a catch, a heist, or a quiet night
  function outcome(h) {
    const t = h.last.text, vault = document.getElementById('hVault');
    const flash = (cls) => { vault.classList.remove('alarm', 'caught', 'stolen'); void vault.offsetWidth; vault.classList.add(cls); };
    if (t.startsWith('🔔')) { flash('alarm'); strobe(); ctx.sfx('alarm'); Kit.callout('🔔 ALARM!', 'bad'); }
    else if (t.startsWith('🚨')) { flash('caught'); ctx.sfx('alarm'); Kit.callout('🚨 Caught!', 'cool'); }
    else if (t.startsWith('💎') || t.startsWith('🤝')) {
      flash('stolen'); ctx.sfx('fanfare'); Kit.callout(t.startsWith('🤝') ? '🤝 CREW HEIST!' : '💎 HEIST!', 'gold');
      const thieves = Object.entries(h.last.choices).filter(([, c]) => c === 'grab').map(([pid]) => pid);
      if (thieves.includes(S.me.id)) ctx.confetti();
      // the loot leaves the vault: coins fly from the pile to each thief's card
      const coins = [...document.querySelectorAll('#hCoins i')].slice(-6);
      thieves.forEach((pid, k) => {
        const card = document.querySelector(`#hLast .h-card[data-pid="${pid}"]`);
        coins.forEach((c, i) => Kit.fly(c, card, { ms: 520, delay: k * 120 + i * 70, scale: 1.3 }));
      });
      if (coins.length) setTimeout(() => ctx.sfx('chip'), 450);
    } else if (t.startsWith('🥱')) ctx.sfx('bad');
    else ctx.sfx('pop');
  }

  // the alarm: the whole screen strobes red for a moment
  function strobe() {
    if (!motionOK()) return;
    const s = ctx.el('div', 'h-strobe');
    document.body.append(s);
    setTimeout(() => s.remove(), 1750);
  }

  // the pot counts up or down to its new size, with a pile of coins that grows with it
  function paintPot(pot) {
    const el = document.getElementById('hPot'), coins = document.getElementById('hCoins');
    const from = shownPot ?? pot;
    shownPot = pot;
    clearInterval(potTimer);
    if (from === pot || !motionOK()) el.textContent = `💰${pot}`;
    else {
      let v = from;
      potTimer = setInterval(() => { v += Math.sign(pot - v); el.textContent = `💰${v}`; if (v === pot) clearInterval(potTimer); }, Math.max(20, 600 / Math.abs(pot - from)));
      if (pot > from) ctx.sfx('chip');
    }
    const n = Math.min(40, pot);
    if (coins.childElementCount !== n) {
      coins.replaceChildren(...Array.from({ length: n }, (_, k) => { const c = ctx.el('i'); c.style.bottom = (k % 8) * 3 + 'px'; c.style.left = Math.floor(k / 8) * 22 + (k % 2) * 4 + 'px'; return c; }));
    }
    document.getElementById('hVault').dataset.heat = pot >= 35 ? 3 : pot >= 20 ? 2 : pot >= 10 ? 1 : 0;
  }

  // one row per player, one column per night: what they chose and how their gold moved
  function paintGrid(h) {
    const all = h.nights || [], from = Math.max(0, all.length - 10), nights = all.slice(from);  // the last 10 nights fit a phone
    document.getElementById('hGrid').hidden = !nights.length;
    const t = document.getElementById('hGridT'); t.innerHTML = '';
    if (!nights.length) return;
    const head = ctx.el('tr'); head.append(ctx.el('th', '', ''));
    nights.forEach((_, i) => head.append(ctx.el('th', '', String(from + i + 1))));
    head.append(ctx.el('th', '', '💰'));
    t.append(head);
    for (const pid of Object.keys(h.gold)) {
      const p = ctx.player(pid); if (!p) continue;
      const tr = ctx.el('tr');
      const name = ctx.el('td', 'h-name', p.name); name.style.color = p.color;
      tr.append(name);
      for (const n of nights) {
        const [choice, delta] = n[pid] || [];
        const td = ctx.el('td', delta > 0 ? 'up' : delta < 0 ? 'down' : '');
        td.append(choice ? ICON[choice] : '·');
        if (delta) td.append(ctx.el('small', '', (delta > 0 ? '+' : '') + delta));
        tr.append(td);
      }
      tr.append(ctx.el('td', 'h-total', String(h.gold[pid])));
      t.append(tr);
    }
  }

  const turnText = (s) => s.phase !== 'playing' ? null
    : s.me.ghost || s.me.spectator ? '🌙 Watching the heist'
    : s.heist.mine ? `Locked in ${ICON[s.heist.mine]} — waiting…` : '🌙 Make your move!';
  const myMove = (s) => s.phase === 'playing' && !s.heist.mine && !s.me.spectator;

  const unmount = () => clearInterval(potTimer);
  return { mount, render, turnText, myMove, unmount };
})();
