// Older phones (Android 10 ships Emoji 12) draw newer emoji like 🪙 🪨 🫨 as empty boxes (#168).
// If this device can't draw a recent emoji in colour, add a tiny fallback font holding just the newer
// emoji the app uses (fonts/emoji-fallback.woff2, subset of Noto Color Emoji, OFL) to the page and to
// every canvas font. Newer devices never download it. Rebuild the subset if a game adds a newer emoji.
(() => {
  const FAM = 'GN Emoji';
  function hasColour(ch) {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 32;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.textBaseline = 'top'; g.fillStyle = '#000'; g.font = '24px sans-serif'; g.fillText(ch, 2, 2);
      const d = g.getImageData(0, 0, 32, 32).data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 40 && (Math.abs(d[i] - d[i + 1]) > 24 || Math.abs(d[i + 1] - d[i + 2]) > 24)) return true;
      }
      return false;
    } catch { return true; }  // can't tell: leave things alone
  }
  // 🫨 is Emoji 15, 🪙 Emoji 13: if either fails, use the fallback for all of them
  if (/[?&]emojifb=1/.test(location.search) === false && hasColour('\u{1FAE8}') && hasColour('\u{1FA99}')) return;
  window.EMOJI_FB = FAM;
  const st = document.createElement('style');
  st.textContent = `@font-face { font-family: '${FAM}'; font-display: swap; src: url(/fonts/emoji-fallback.woff2) format('woff2');
    unicode-range: U+1FA70-1FAFF; }
  body, input, select, textarea, button { font-family: system-ui, -apple-system, "Segoe UI", sans-serif, '${FAM}'; }
  :root { --font-display: 'Baloo 2', system-ui, -apple-system, "Segoe UI", sans-serif, '${FAM}'; }`;
  document.head.appendChild(st);
  try { document.fonts.load(`16px '${FAM}'`, '\u{1FA99}'); } catch {}
  // canvas text (Fx2D pops, 3D labels, game boards): append the fallback to whatever font is set
  try {
    const P = CanvasRenderingContext2D.prototype, d = Object.getOwnPropertyDescriptor(P, 'font');
    Object.defineProperty(P, 'font', { configurable: true, get: d.get,
      set(v) { d.set.call(this, typeof v === 'string' && !v.includes(FAM) ? `${v}, '${FAM}'` : v); } });
  } catch {}
})();
