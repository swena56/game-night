// personal settings: theme, graphics level, card backs, sound; applied to <body>.
// Part of the shell, split out of app.js: a plain script loaded before app.js, sharing its globals
// (S, $, el, act, prefs, …), which exist by the time anything here is called.
// ---------- personal settings
const THEMES = [['dark', '🌙 Dark'], ['light', '☀️ Light'], ['system', '🌓 Match my phone']];
// 🎨 Graphics: Auto turns shadows, reflections and extra particles off on a weak device (few cores or little
// memory, data saver, or a 3D game that had to drop its resolution to keep up: GL3.strained)
const GFX = [['auto', '🪄 Auto'], ['high', '✨ High (shadows, reflections, more particles)'], ['low', '🔋 Low (smoother, saves battery)']];
const CARD_BACKS = [['blue', '🔵 Midnight blue'], ['red', '🔴 Ruby'], ['green', '🟢 Emerald'], ['night', '⚫ Onyx & gold']];
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
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f4f1fa' : '#16131f');
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
  for (const [k, label] of CARD_BACKS) bpick.append(Object.assign(el('option', '', label), { value: k }));
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
