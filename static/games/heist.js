UI.heist = (() => {
  let S, ctx;
  const OPTIONS = [
    ['grab', '🥷', 'Grab', 'Steal the whole vault, but only if you are the only grabber and nobody guards.'],
    ['guard', '🛡️', 'Guard', 'Catch grabbers and collect a 💰2 fine from each. Guarding an empty hall costs 💰1.'],
    ['rest', '😴', 'Rest', 'Play it safe: +💰1.'],
  ];
  const ICON = Object.fromEntries(OPTIONS.map(([id, icon]) => [id, icon]));

  function mount(main, side) {
    main.innerHTML = `<div class="heist">
      <div class="vault"><div id="hNight"></div><div id="hPot" class="pot"></div></div>
      <div id="hChoices" class="h-choices"></div>
      <p id="hWaiting" class="hint"></p>
      <div id="hLast" class="panel"></div>
      <div id="hGrid" class="panel h-grid-wrap" hidden><h3>Night by night</h3><table id="hGridT" class="h-grid"></table></div>
    </div>`;
    side.innerHTML = `<div class="panel"><h3>How it works</h3>
      <p class="hint left">Everyone chooses in secret, then all choices are revealed together.</p>
      <ul class="rules">
        <li>🥷 A <b>lone grabber</b> steals the vault.</li>
        <li>🔔 <b>Two or more grabbers</b> trip the alarm, and the loot keeps growing.</li>
        <li>🛡️ <b>Guards</b> fine every grabber 💰2.</li>
        <li>😴 <b>Rest</b> earns 💰1.</li>
      </ul>
      <p class="hint left">You can change your mind until the last player locks in. Most gold after the final night wins.</p></div>`;
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
    document.getElementById('hNight').textContent = `🌙 Night ${h.night} of ${h.rounds}`;
    document.getElementById('hPot').textContent = `💰${h.pot}`;
    const canPlay = S.phase === 'playing' && !S.me.ghost && !S.me.spectator;
    for (const b of document.querySelectorAll('.h-choice')) {
      b.classList.toggle('on', h.mine === b.dataset.id);
      b.disabled = !canPlay;
    }
    const waiting = h.waiting.map((id) => ctx.player(id)?.name).filter(Boolean);
    document.getElementById('hWaiting').textContent =
      S.phase === 'playing' && waiting.length ? `Waiting for: ${waiting.join(', ')}` : '';
    const last = document.getElementById('hLast');
    last.hidden = !h.last;
    if (h.last) {
      last.innerHTML = '';
      last.append(ctx.el('h3', '', `Night ${h.last.night} revealed`));
      const row = ctx.el('div', 'reveal-row');
      for (const [pid, choice] of Object.entries(h.last.choices)) {
        const p = ctx.player(pid);
        const tag = ctx.el('span', 'reveal-tag', `${ICON[choice]} ${p?.name ?? '?'}`);
        tag.style.borderColor = p?.color ?? '#777';
        row.append(tag);
      }
      last.append(row, ctx.el('p', '', h.last.text));
    }
    paintGrid(h);
  }

  // one row per player, one column per night: what they chose and how their gold moved
  function paintGrid(h) {
    const nights = h.nights || [];
    document.getElementById('hGrid').hidden = !nights.length;
    const t = document.getElementById('hGridT'); t.innerHTML = '';
    if (!nights.length) return;
    const head = ctx.el('tr'); head.append(ctx.el('th', '', ''));
    nights.forEach((_, i) => head.append(ctx.el('th', '', String(i + 1))));
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

  return { mount, render, turnText, myMove };
})();
