// Procedural face renderer: every askable trait must be clearly visible.
const PAL = {
  hair: { black: '#2a2a2e', brown: '#6b4226', blonde: '#e9c46a', red: '#c2452d', white: '#f4f4ef', blue: '#3a86ff', none: '#6b5a4a' },
  eye: { brown: '#6b3e1e', blue: '#2f80ed', green: '#2e9e5b' },
  shirt: { red: '#e63946', blue: '#1d4ed8', green: '#2a9d8f', yellow: '#f4c430', purple: '#8e44ad' },
  skin: ['#fde0c5', '#f5c6a0', '#e0a878', '#c68642', '#8d5524', '#5c3a21'],
  bg: ['#ffd6e0', '#d0f4de', '#cde7ff', '#fff1c1', '#e4d9ff', '#ffe0cc', '#d9f2f2', '#ececec'],
  hat: ['#264653', '#e76f51', '#6a4c93', '#1b998b'],
};
const LINE = 'rgba(0,0,0,.35)';

function faceSVG(f) {
  const skin = PAL.skin[f.skin];
  const hair = PAL.hair[f.hair_color];
  const brow = f.hair_color === 'none' || f.hair_color === 'white' ? '#5a4632' : hair;
  const s = [`<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`,
    `<rect width="100" height="100" fill="${PAL.bg[f.bg]}"/>`];

  if (f.hair_style === 'long') s.push(`<path d="M24 44 Q20 84 28 94 L72 94 Q80 84 76 44 Z" fill="${hair}" stroke="${LINE}"/>`);
  s.push(`<path d="M12 100 Q14 80 36 75 L64 75 Q86 80 88 100 Z" fill="${PAL.shirt[f.shirt]}" stroke="${LINE}"/>`);
  s.push(`<rect x="43" y="64" width="14" height="14" fill="${skin}"/>`);
  s.push(`<ellipse cx="28" cy="50" rx="5" ry="7" fill="${skin}" stroke="${LINE}"/><ellipse cx="72" cy="50" rx="5" ry="7" fill="${skin}" stroke="${LINE}"/>`);
  if (f.earrings === 'yes') s.push(`<circle cx="27" cy="59" r="2.8" fill="#ffd166" stroke="#a37400"/><circle cx="73" cy="59" r="2.8" fill="#ffd166" stroke="#a37400"/>`);
  s.push(`<ellipse cx="50" cy="48" rx="22" ry="25" fill="${skin}" stroke="${LINE}"/>`);

  // hair on top
  const cap = `<path d="M26 50 Q23 18 50 18 Q77 18 74 50 Q70 31 50 29 Q30 31 26 50 Z" fill="${hair}" stroke="${LINE}"/>`;
  switch (f.hair_style) {
    case 'short': case 'long': s.push(cap); break;
    case 'bun': s.push(`<circle cx="50" cy="13" r="9" fill="${hair}" stroke="${LINE}"/>`, cap); break;
    case 'mohawk': s.push(`<path d="M44 31 Q45 3 50 3 Q55 3 56 31 Z" fill="${hair}" stroke="${LINE}"/>`); break;
    case 'curly':
      for (const [x, y] of [[27, 46], [27, 36], [32, 27], [40, 21], [50, 19], [60, 21], [68, 27], [73, 36], [73, 46]])
        s.push(`<circle cx="${x}" cy="${y}" r="7.5" fill="${hair}" stroke="${LINE}"/>`);
      break;
    case 'bald': s.push(`<ellipse cx="41" cy="30" rx="6" ry="3" fill="#fff" opacity=".35"/>`); break;
  }

  // eyes & brows
  const big = f.expression === 'surprised';
  for (const x of [41, 59]) {
    s.push(`<ellipse cx="${x}" cy="48" rx="4.6" ry="${big ? 5.6 : 4}" fill="#fff" stroke="${LINE}"/>`,
      `<circle cx="${x}" cy="48.5" r="2.5" fill="${PAL.eye[f.eye_color]}"/><circle cx="${x}" cy="48.5" r="1.1" fill="#111"/>`);
  }
  const by = big ? 37 : 40;
  s.push(`<path d="M35 ${by} Q41 ${by - 3} 46 ${by}M54 ${by} Q59 ${by - 3} 65 ${by}" stroke="${brow}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`);
  s.push(`<path d="M50 51 Q46.5 57 50 58" stroke="${LINE}" stroke-width="1.5" fill="none"/>`);

  // facial hair, then mouth
  if (f.facial_hair === 'beard') s.push(`<path d="M28 50 Q27 78 50 77 Q73 78 72 50 Q70 67 60 66 Q50 61 40 66 Q30 67 28 50 Z" fill="${brow}" stroke="${LINE}"/>`);
  if (f.expression === 'smile') s.push(`<path d="M42 63 Q50 71 58 63 Z" fill="#7a2e2e" stroke="#5a1f1f" stroke-width="1.2"/>`);
  else if (f.expression === 'neutral') s.push(`<path d="M44 65 L56 65" stroke="#5a1f1f" stroke-width="2" stroke-linecap="round"/>`);
  else s.push(`<ellipse cx="50" cy="66" rx="3.4" ry="4.4" fill="#5a1f1f"/>`);
  if (f.facial_hair !== 'none') s.push(`<path d="M40 62 Q45 56 50 59 Q55 56 60 62 Q55 60 50 61.5 Q45 60 40 62 Z" fill="${brow}" stroke="${LINE}"/>`);

  // glasses
  if (f.glasses === 'round') s.push(`<g fill="rgba(255,255,255,.15)" stroke="#222" stroke-width="1.8"><circle cx="41" cy="48" r="7"/><circle cx="59" cy="48" r="7"/><path d="M48 48 L52 48"/></g>`);
  if (f.glasses === 'shades') s.push(`<g fill="#151515" stroke="#000" stroke-width="1.2"><rect x="32.5" y="43" width="16" height="10" rx="3.5"/><rect x="51.5" y="43" width="16" height="10" rx="3.5"/><path d="M48.5 46 L51.5 46" fill="none" stroke-width="2"/></g>`);

  // hats
  const hc = PAL.hat[f.hat_color];
  if (f.hat === 'cap') s.push(`<path d="M26 39 Q26 15 50 15 Q74 15 74 39 Z" fill="${hc}" stroke="${LINE}"/><path d="M22 39 Q50 31 78 39 Q50 46 22 39 Z" fill="${hc}" stroke="${LINE}"/><path d="M22 39 Q50 31 78 39 Q50 46 22 39 Z" fill="#000" opacity=".2"/><circle cx="50" cy="15" r="2.5" fill="${hc}" stroke="${LINE}"/>`);
  if (f.hat === 'beanie') s.push(`<path d="M25 40 Q25 11 50 11 Q75 11 75 40 Z" fill="${hc}" stroke="${LINE}"/><rect x="23" y="33" width="54" height="9" rx="4" fill="${hc}" stroke="${LINE}"/><circle cx="50" cy="9" r="5" fill="#fff" stroke="${LINE}"/>`);
  if (f.hat === 'tophat') s.push(`<rect x="33" y="3" width="34" height="31" rx="2" fill="#1f1f1f" stroke="#000"/><rect x="33" y="25" width="34" height="5" fill="${hc}"/><ellipse cx="50" cy="34" rx="30" ry="5" fill="#1f1f1f" stroke="#000"/>`);

  s.push('</svg>');
  return s.join('');
}
