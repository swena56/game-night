// personal settings: theme, graphics level, card backs, sound; applied to <body>.
// Part of the shell, split out of app.js: a plain script loaded before app.js, sharing its globals
// (S, $, el, act, prefs, …), which exist by the time anything here is called.
// ---------- personal settings
const THEMES = [['dark', '🌙 Dark'], ['light', '☀️ Light'], ['system', '🌓 Match my phone']];
// 🖌️ Background colour of the whole app (#321). Green is the look the app ships with and adds no rules; each other
// one is a base colour that style.css mixes its shades from. The second value is the phone's address bar (dark theme).
const COLORS_BG = [['green', '🟢 Green felt', null], ['blue', '🔵 Ocean blue', '#101c2c'], ['purple', '🟣 Royal purple', '#1a132c'],
  ['red', '🔴 Burgundy', '#2a1019'], ['pink', '🌸 Rose', '#2a1220'], ['brown', '🟤 Walnut', '#261a10'],
  ['slate', '🩶 Slate grey', '#161a1f'], ['black', '⚫ Midnight', '#0b0b0d']];
// 🎨 Graphics: Auto turns shadows, reflections and extra particles off on a weak device (few cores or little
// memory, data saver, or a 3D game that had to drop its resolution to keep up: GL3.strained)
const GFX = [['auto', '🪄 Auto'], ['high', '✨ High (shadows, reflections, more particles)'], ['low', '🔋 Low (smoother, saves battery)']];
const CARD_BACKS = [['blue', '🔵 Midnight blue'], ['red', '🔴 Ruby'], ['green', '🟢 Emerald'], ['night', '⚫ Onyx & gold'],
  ['sunset', '🌅 Sunset'], ['galaxy', '🌌 Galaxy'], ['royal', '👑 Royal']];  // the last three open with levels (Profile.UNLOCKS)
const AUTO_LOW = (navigator.deviceMemory || 8) <= 2 || (navigator.hardwareConcurrency || 8) <= 2 || !!navigator.connection?.saveData;
function gfxLevel() {
  const g = prefs.gfx || 'auto';
  if (g !== 'auto') return g;
  return AUTO_LOW || window.GL3?.strained?.() ? 'low' : 'high';
}
const lightQuery = window.matchMedia?.('(prefers-color-scheme: light)');
function applyPrefs() {
  document.body.classList.toggle('calm', !prefs.motion);
  const light = prefs.theme === 'light' || (prefs.theme === 'system' && !!lightQuery?.matches);
  document.body.classList.toggle('light', light);
  document.body.dataset.back = prefs.cardBack || 'blue';   // the colour of every card back (style.css)
  const colour = COLORS_BG.find(([k]) => k === prefs.color);
  if (colour?.[2]) document.body.dataset.color = colour[0];
  else delete document.body.dataset.color;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f4f1fa' : colour?.[2] || '#16131f');
  const low = gfxLevel() === 'low';
  if (document.body.classList.contains('lowgfx') !== low) {
    document.body.classList.toggle('lowgfx', low);
    window.dispatchEvent(new CustomEvent('gfxchange', { detail: low ? 'low' : 'high' }));
  }
}
lightQuery?.addEventListener?.('change', applyPrefs);
function renderPrefs() {
  const box = $('#prefsList'); box.innerHTML = '';
  const theme = el('label', '', 'Theme (the game table stays dark)');
  const pick = el('select');
  for (const [k, label] of THEMES) pick.append(Object.assign(el('option', '', label), { value: k }));
  pick.value = prefs.theme || 'dark';
  pick.onchange = () => { prefs.theme = pick.value; store('unmask.prefs', prefs); applyPrefs(); };
  theme.append(pick);
  box.append(theme);
  const colour = el('label', '', '🖌️ Background colour');
  const cpick = el('select');
  for (const [k, label] of COLORS_BG) cpick.append(Object.assign(el('option', '', label), { value: k }));
  cpick.value = COLORS_BG.some(([k]) => k === prefs.color) ? prefs.color : 'green';
  cpick.onchange = () => { prefs.color = cpick.value; store('unmask.prefs', prefs); applyPrefs(); };
  colour.append(cpick);
  box.append(colour);
  const gfx = el('label', '', '🎨 Graphics');
  const gpick = el('select');
  for (const [k, label] of GFX) gpick.append(Object.assign(el('option', '', label), { value: k }));
  gpick.value = prefs.gfx || 'auto';
  gpick.onchange = () => {
    prefs.gfx = gpick.value; store('unmask.prefs', prefs); applyPrefs();
    if (S?.game) toast('3D games use the new setting from their next start.');
  };
  gfx.append(gpick);
  box.append(gfx);
  const backs = el('label', '', '🂠 Card backs');
  const bpick = el('select');
  for (const [k, label] of CARD_BACKS) {
    const open = Profile.unlocked('back', k), o = Object.assign(el('option', '', open ? label : `${label} · ${Profile.lockText('back', k)}`), { value: k });
    o.disabled = !open; bpick.append(o);
  }
  bpick.value = prefs.cardBack || 'blue';
  bpick.onchange = () => { prefs.cardBack = bpick.value; store('unmask.prefs', prefs); applyPrefs(); };
  backs.append(bpick);
  box.append(backs);
  const vol = el('label', '', '🔉 Volume');
  const range = el('input'); range.type = 'range'; range.min = '0'; range.max = '100'; range.step = '5';
  range.value = String(prefs.volume ?? 70); range.setAttribute('aria-label', 'Volume');
  range.oninput = () => { prefs.volume = +range.value; store('unmask.prefs', prefs); };
  range.onchange = () => sfx('chip');  // a sample at the new level
  vol.append(range);
  box.append(vol);
  for (const [key, label] of PREFS) {
    const lab = el('label', 'check');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = prefs[key];
    cb.onchange = () => { prefs[key] = cb.checked; store('unmask.prefs', prefs); applyPrefs(); if (key === 'sound' && cb.checked) blip('chat'); };
    lab.append(cb, label);
    box.append(lab);
  }
  const reset = el('button', 'ghost-btn', '💡 Show the first-time tips again');
  reset.onclick = () => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('seen:')) store(k, null);
    if (!prefs.tips) { prefs.tips = true; store('unmask.prefs', prefs); renderPrefs(); }
    toast('Each game shows its tip again the next time it starts.');
  };
  box.append(reset);
}
