// TEMPLATE browser module for Race to 21 (pairs with templates/game.py).
// Copy to static/games/<id>.js, rename UI.race21 and the "r21" id prefix, then replace the screen.
UI.race21 = (() => {
  let S, ctx;
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    // Build the DOM once. Element ids get a short per-game prefix so they stay unique on the page.
    main.innerHTML = '<div class="r21"><div id="r21Count" class="r21-count"></div><div id="r21Bar" class="r21-bar"><span></span></div></div>';
    side.innerHTML = `<div class="panel">
      <div id="r21Status" class="seat-row"></div>
      <div class="row" id="r21Buttons"></div></div>`;
    for (const n of [1, 2, 3]) {
      const b = document.createElement('button');
      b.className = 'primary';
      b.textContent = `+${n}`;
      b.onclick = () => ctx.quiet(ctx.act('add', { n }));  // server validates; errors become toasts
      $('r21Buttons').append(b);
    }
  }

  function render(s, c) {
    // Called on every state update (and with replay frames, where ctx.myTurn is false).
    S = s; ctx = c;
    const g = S.race21;
    $('r21Count').textContent = `${g.count} / ${g.target}`;
    $('r21Bar').firstElementChild.style.width = `${(100 * g.count) / g.target}%`;
    const last = g.last && ctx.player(g.last.by);
    $('r21Status').textContent = last ? `${last.name} added ${g.last.n}` : 'Nobody has moved yet';
    [...$('r21Buttons').children].forEach((b, i) => {
      b.disabled = !ctx.myTurn || g.count + i + 1 > g.target;
    });
  }

  return { mount, render };
})();

/* Matching CSS for static/style.css:
.r21 { text-align: center; padding: 30px 0; }
.r21-count { font-size: 64px; font-weight: 900; }
.r21-bar { height: 14px; background: var(--panel); border-radius: 999px; overflow: hidden; max-width: 420px; margin: 12px auto; }
.r21-bar span { display: block; height: 100%; background: var(--accent); transition: width .3s; }
*/
