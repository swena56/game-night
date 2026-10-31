// A small QR code encoder for invite links: byte mode, error correction level M, versions 1–9
// (up to 180 bytes). qrMatrix(text) returns rows of booleans (true = dark), without the quiet zone.
const QR = (() => {
  // per version: [error-correction codewords per block, blocks in group 1, data codewords each, group 2 blocks, data each]
  const BLOCKS = [null, [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37]];
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46]];

  // GF(256) arithmetic for Reed–Solomon, primitive polynomial 0x11d
  const EXP = new Array(512), LOG = new Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

  function ecc(data, n) {
    let gen = [1];
    for (let i = 0; i < n; i++) {  // multiply by (x − α^i)
      const next = new Array(gen.length + 1).fill(0);
      gen.forEach((g, j) => { next[j] ^= g; next[j + 1] ^= mul(g, EXP[i]); });
      gen = next;
    }
    const rem = [...data, ...new Array(n).fill(0)];
    for (let i = 0; i < data.length; i++) {
      const f = rem[i];
      if (f) gen.forEach((g, j) => { rem[i + j] ^= mul(g, f); });
    }
    return rem.slice(data.length);
  }

  function codewords(bytes, v) {
    const [ecn, b1, d1, b2, d2] = BLOCKS[v], capacity = b1 * d1 + b2 * d2;
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    put(4, 4); put(bytes.length, 8);
    bytes.forEach((b) => put(b, 8));
    put(0, Math.min(4, capacity * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);
    const blocks = [];
    let at = 0;
    for (let i = 0; i < b1 + b2; i++) {
      const len = i < b1 ? d1 : d2;
      blocks.push(data.slice(at, at + len)); at += len;
    }
    const ecs = blocks.map((b) => ecc(b, ecn)), out = [];
    for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
    for (let i = 0; i < ecn; i++) for (const e of ecs) out.push(e[i]);
    return out;
  }

  // BCH codes for the format (15 bits) and version (18 bits) information
  function bch(value, poly) {
    const top = Math.floor(Math.log2(poly));
    let v = value << top;
    while (v && Math.floor(Math.log2(v)) >= top) v ^= poly << (Math.floor(Math.log2(v)) - top);
    return (value << top) | v;
  }

  const MASKS = [(r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0];

  function build(v, words, mask) {
    const n = 17 + 4 * v;
    const m = Array.from({ length: n }, () => new Array(n).fill(false));
    const fixed = Array.from({ length: n }, () => new Array(n).fill(false));
    const set = (r, c, dark) => { m[r][c] = dark; fixed[r][c] = true; };
    for (const [fr, fc] of [[0, 0], [0, n - 7], [n - 7, 0]])  // finders, with their white separators
      for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
        const rr = fr + r, cc = fc + c;
        if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
        const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        set(rr, cc, ring !== 2 && ring !== 4);
      }
    for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const last = ALIGN[v].length - 1;
    ALIGN[v].forEach((r, i) => ALIGN[v].forEach((c, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;  // finder corners
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }));
    set(n - 8, 8, true);  // the dark module
    // reserve the format and version areas (filled in below)
    for (let i = 0; i < 9; i++) { fixed[8][i] = fixed[i][8] = true; }
    for (let i = 0; i < 8; i++) { fixed[8][n - 1 - i] = fixed[n - 1 - i][8] = true; }
    if (v >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) fixed[i][n - 11 + j] = fixed[n - 11 + j][i] = true;

    // data, in two-column zigzags from the bottom right, skipping the vertical timing column
    let bit = 0;
    const total = words.length * 8;
    for (let right = n - 1, up = true; right > 0; right -= 2, up = !up) {
      if (right === 6) right = 5;
      for (let k = 0; k < n; k++) {
        const r = up ? n - 1 - k : k;
        for (const c of [right, right - 1]) {
          if (fixed[r][c]) continue;
          const dark = bit < total && ((words[bit >> 3] >> (7 - (bit & 7))) & 1) === 1;
          m[r][c] = dark !== MASKS[mask](r, c);
          bit++;
        }
      }
    }

    const format = bch((0 << 3) | mask, 0x537) ^ 0x5412;  // level M is 00
    const fbit = (i) => ((format >> i) & 1) === 1;
    for (let i = 0; i < 6; i++) m[i][8] = fbit(i);
    m[7][8] = fbit(6); m[8][8] = fbit(7); m[8][7] = fbit(8);
    for (let i = 9; i < 15; i++) m[8][14 - i] = fbit(i);
    for (let i = 0; i < 8; i++) m[8][n - 1 - i] = fbit(i);
    for (let i = 8; i < 15; i++) m[n - 15 + i][8] = fbit(i);
    if (v >= 7) {
      const info = bch(v, 0x1f25);
      for (let i = 0; i < 18; i++) {
        const dark = ((info >> i) & 1) === 1, a = Math.floor(i / 3), b = n - 11 + (i % 3);
        m[a][b] = dark; m[b][a] = dark;
      }
    }
    return m;
  }

  // the standard penalty score; the lowest-scoring mask is the easiest to scan
  function penalty(m) {
    const n = m.length;
    let score = 0, dark = 0;
    for (let pass = 0; pass < 2; pass++)
      for (let i = 0; i < n; i++) {
        let run = 1;
        for (let j = 1; j <= n; j++) {
          const same = j < n && (pass ? m[j][i] === m[j - 1][i] : m[i][j] === m[i][j - 1]);
          if (same) run++;
          else { if (run >= 5) score += run - 2; run = 1; }
        }
      }
    for (let r = 0; r < n - 1; r++)
      for (let c = 0; c < n - 1; c++) if (m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) score += 3;
    const pat = [true, false, true, true, true, false, true, false, false, false, false];
    const rev = [...pat].reverse();
    for (let i = 0; i < n; i++)
      for (let j = 0; j + 11 <= n; j++)
        for (const p of [pat, rev]) {
          if (p.every((x, k) => m[i][j + k] === x)) score += 40;
          if (p.every((x, k) => m[j + k][i] === x)) score += 40;
        }
    for (const row of m) for (const x of row) dark += x;
    return score + Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  }

  function qrMatrix(text) {
    const bytes = typeof TextEncoder === 'function' ? [...new TextEncoder().encode(text)]
      : [...unescape(encodeURIComponent(text))].map((ch) => ch.charCodeAt(0));  // UTF-8 without TextEncoder
    const v = BLOCKS.findIndex((b) => b && b[1] * b[2] + b[3] * b[4] >= bytes.length + 2);
    if (v < 1) return null;
    const words = codewords(bytes, v);
    let best = null, low = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const m = build(v, words, mask), p = penalty(m);
      if (p < low) { low = p; best = m; }
    }
    return best;
  }

  // an SVG with a 4-module quiet zone, dark on white so any camera reads it
  function qrSvg(text) {
    const m = qrMatrix(text);
    if (!m) return null;
    const n = m.length + 8;
    let d = '';
    m.forEach((row, r) => row.forEach((dark, c) => { if (dark) d += `M${c + 4} ${r + 4}h1v1h-1z`; }));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${n} ${n}`);
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.innerHTML = `<rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/>`;
    return svg;
  }

  return { qrMatrix, qrSvg };
})();
