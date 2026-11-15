// 📷 The Bingo tools' card scanner (loaded only when 📷 is tapped): point the camera at a paper 75-ball card, or
// shoot a whole bingo book page after page (6-on sheets and the like), or pick a pile of photos at once. The 5×5
// number grids are found by themselves (detect(), below) and read in the background while the next page is shot;
// any page can be opened to drag a card's four corners, add a card it missed or drop one. Each square is
// straightened, cleaned up and read with Tesseract.js (vendored in static/vendor/tesseract, digits only; one reader
// for the whole scan), and on a sheet the serial number printed in the FREE square too. Anything doubtful is
// checked by hand in the tools' card editor before saving.
//   UI.bingoscan.scan(host, { toast })               → Promise<Array(25) | null>    (FREE = 0, unread = null)
//   UI.bingoscan.scan(host, { toast, multi: true })  → Promise<Array<{ nums, serial, sheet }> | null>  (sheet: 1, 2, …)
UI.bingoscan = (() => {
  const T = '/vendor/tesseract';
  const SIZE = 500;  // the straightened grid, in pixels
  let tessLoad = null;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function loadTess() {
    if (window.Tesseract) return Promise.resolve();
    return (tessLoad ??= new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = `${T}/tesseract.min.js`;
      s.onload = ok;
      s.onerror = () => { tessLoad = null; fail(new Error('The text reader did not load.')); };
      document.head.append(s);
    }));
  }

  // ---------- geometry: the homography taking the unit square's corners to a quad, and grayscale warping

  function solve(A, b) {  // Gaussian elimination, 8×8
    const n = b.length, M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      if (Math.abs(M[c][c]) < 1e-12) return null;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((r, i) => r[n] / r[i]);
  }
  /** h such that (u,v) in [0,1]² maps to the quad tl,tr,br,bl. */
  function homography(q) {
    const src = [[0, 0], [1, 0], [1, 1], [0, 1]], A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [u, v] = src[i], [x, y] = q[i];
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
    }
    const h = solve(A, b);
    return h && ((u, v) => { const w = h[6] * u + h[7] * v + 1; return [(h[0] * u + h[1] * v + h[2]) / w, (h[3] * u + h[4] * v + h[5]) / w]; });
  }
  function gray(img) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.videoWidth || img.width; c.height = img.naturalHeight || img.videoHeight || img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data, out = new Float32Array(c.width * c.height);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    return { w: c.width, h: c.height, px: out };
  }
  function warp(src, quad) {
    const map = homography(quad), out = new Float32Array(SIZE * SIZE);
    if (!map) return null;
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const [sx, sy] = map((x + 0.5) / SIZE, (y + 0.5) / SIZE);
      const x0 = Math.max(0, Math.min(src.w - 2, Math.floor(sx))), y0 = Math.max(0, Math.min(src.h - 2, Math.floor(sy)));
      const fx = Math.max(0, Math.min(1, sx - x0)), fy = Math.max(0, Math.min(1, sy - y0)), i = y0 * src.w + x0;
      out[y * SIZE + x] = (src.px[i] * (1 - fx) + src.px[i + 1] * fx) * (1 - fy) + (src.px[i + src.w] * (1 - fx) + src.px[i + src.w + 1] * fx) * fy;
    }
    return out;
  }
  // ---------- finding cards: every 5×5 number grid in a photo (one card, or a whole 6-on sheet)
  // The photo is shrunk, inked pixels are found with a local-mean threshold, and the paper between the grid lines
  // falls apart into one blob per square. Blobs of a similar size that sit side by side or one above the other
  // are chained into lattices; each lattice is a card. Squares lost to an open edge (no outer line, so they run
  // into the margin) are put back by trying each way the 5×5 could sit and keeping the one that lands on paper.

  /** Grey pixels of an image, shrunk so its long side is at most `max`. */
  function graySmall(img, max = 900) {
    const W = img.naturalWidth || img.videoWidth || img.width, H = img.naturalHeight || img.videoHeight || img.height;
    const k = Math.min(1, max / Math.max(W, H)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(H * k));
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data, px = new Float32Array(c.width * c.height);
    for (let i = 0, j = 0; i < px.length; i++, j += 4) px[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    return { w: c.width, h: c.height, px, k };
  }

  /** Least-squares homography taking lattice points (u,v) to image points (x,y); returns the map or null. */
  function fitMap(pairs) {
    const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0)), Atb = new Array(8).fill(0), S = 1000;
    const add = (row, rhs) => { for (let i = 0; i < 8; i++) { Atb[i] += row[i] * rhs; for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j]; } };
    for (const [u, v, X, Y] of pairs) {
      const x = X / S, y = Y / S;
      add([u, v, 1, 0, 0, 0, -u * x, -v * x], x);
      add([0, 0, 0, u, v, 1, -u * y, -v * y], y);
    }
    const h = solve(AtA, Atb);
    return h && h.every(Number.isFinite) && ((u, v) => { const w = h[6] * u + h[7] * v + 1; return [S * (h[0] * u + h[1] * v + h[2]) / w, S * (h[3] * u + h[4] * v + h[5]) / w]; });
  }

  /** Quads (tl, tr, br, bl, in g's pixels) of the 5×5 number grids found in grey image g, in reading order. */
  function detect(g) {
    const { w, h, px } = g, n = w * h;
    // 1. ink: darker than 82% of the local mean (integral image, window ~1/40 of the long side)
    const I = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) { row += px[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; }
    }
    const r = Math.max(4, Math.round(Math.max(w, h) / 40)), ink = new Uint8Array(n), D = Math.max(2, Math.round(Math.max(w, h) / 450));
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
        const i = y * w + x, v = px[i], m = sum / ((x1 - x0) * (y1 - y0)), t = 0.07 * m;
        if (v < 0.88 * m) ink[i] = 1;
        // thin grid lines go faint in a blurry photo: also take pixels darker than both sides of them
        else if (x >= D && x < w - D && v < (px[i - D] + px[i + D]) / 2 - t && v < Math.max(px[i - D], px[i + D]) - 1.5 * t) ink[i] = 1;
        else if (y >= D && y < h - D && v < (px[i - D * w] + px[i + D * w]) / 2 - t && v < Math.max(px[i - D * w], px[i + D * w]) - 1.5 * t) ink[i] = 1;
      }
    }
    // 2. blobs of paper (4-connected)
    const lab = new Int32Array(n).fill(-1), stack = new Int32Array(n), blobs = [];
    const minS = Math.min(w, h);
    for (let s = 0; s < n; s++) {
      if (ink[s] || lab[s] >= 0) continue;
      const id = blobs.length;
      let top = 0, area = 0, sum = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
      stack[top++] = s; lab[s] = id;
      while (top) {
        const p = stack[--top], x = p % w, y = (p / w) | 0;
        area++; sum += px[p];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && !ink[p - 1] && lab[p - 1] < 0) { lab[p - 1] = id; stack[top++] = p - 1; }
        if (x < w - 1 && !ink[p + 1] && lab[p + 1] < 0) { lab[p + 1] = id; stack[top++] = p + 1; }
        if (y > 0 && !ink[p - w] && lab[p - w] < 0) { lab[p - w] = id; stack[top++] = p - w; }
        if (y < h - 1 && !ink[p + w] && lab[p + w] < 0) { lab[p + w] = id; stack[top++] = p + w; }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      blobs.push({ bw, bh, area, cx: (x0 + x1 + 1) / 2, cy: (y0 + y1 + 1) / 2, paper: sum / area,
        ok: bw >= minS / 70 && bh >= minS / 70 && bw <= minS / 4 && bh <= minS / 4 && bw / bh < 2.2 && bh / bw < 2.2 && area / (bw * bh) > 0.3 && x0 > 0 && y0 > 0 && x1 < w - 1 && y1 < h - 1 });
    }
    const cells = blobs.filter((b) => b.ok);
    // 3. neighbours: about one square across (or down), similar size, not diagonal
    const like = (a, b) => a.bw / b.bw < 1.6 && b.bw / a.bw < 1.6 && a.bh / b.bh < 1.6 && b.bh / a.bh < 1.6;
    const nb = cells.map(() => []);
    const order = cells.map((_, i) => i).sort((a, b) => cells[a].cx - cells[b].cx);
    for (let oi = 0; oi < order.length; oi++) {
      const i = order[oi], a = cells[i];
      for (let oj = oi + 1; oj < order.length; oj++) {
        const j = order[oj], b = cells[j];
        const W2 = (a.bw + b.bw) / 2, H2 = (a.bh + b.bh) / 2;
        if (b.cx - a.cx > 1.45 * W2) break;
        if (!like(a, b)) continue;
        const dx = b.cx - a.cx, dy = b.cy - a.cy;
        if (Math.abs(dx) > 0.6 * W2 && Math.abs(dx) < 1.45 * W2 && Math.abs(dy) < 0.35 * H2) { nb[i].push([j, 1, 0]); nb[j].push([i, -1, 0]); }
        else if (Math.abs(dy) > 0.6 * H2 && Math.abs(dy) < 1.45 * H2 && Math.abs(dx) < 0.35 * W2) { const s2 = Math.sign(dy); nb[i].push([j, 0, s2]); nb[j].push([i, 0, -s2]); }
      }
    }
    // 4. chain them into lattices (breadth first, each square gets a column and row)
    const seen = new Int8Array(cells.length), found = [];
    for (let s = 0; s < cells.length; s++) {
      if (seen[s] || !nb[s].length) continue;
      const pos = new Map([[s, [0, 0]]]), taken = new Map([['0,0', s]]), q = [s];
      seen[s] = 1;
      while (q.length) {
        const i = q.shift(), [c, rr] = pos.get(i);
        for (const [j, dc, dr] of nb[i]) {
          if (seen[j]) continue;
          const key = `${c + dc},${rr + dr}`;
          if (taken.has(key)) continue;
          seen[j] = 1; pos.set(j, [c + dc, rr + dr]); taken.set(key, j); q.push(j);
        }
      }
      if (pos.size < 8) continue;
      let c0 = Infinity, r0 = Infinity, c1 = -Infinity, r1 = -Infinity;
      for (const [c, rr] of pos.values()) { c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, rr); r1 = Math.max(r1, rr); }
      const C = c1 - c0 + 1, R = r1 - r0 + 1;
      if (C < 3 || R < 3) continue;
      // a lattice wider than 5 is cards printed edge to edge: cut it into 5s when it divides
      if ((C > 5 && C % 5) || (R > 5 && R % 5)) continue;
      for (let bc = 0; bc < Math.max(1, C / 5); bc++) for (let br = 0; br < Math.max(1, R / 5); br++) {
        const pts = [];
        let paper = 0;
        for (const [i, [c, rr]] of pos) {
          const u = c - c0 - bc * 5, v = rr - r0 - br * 5;
          if (u < 0 || v < 0 || (C > 5 && u >= 5) || (R > 5 && v >= 5)) continue;
          pts.push([u + 0.5, v + 0.5, cells[i].cx, cells[i].cy]); paper += cells[i].paper;
        }
        if (pts.length < 8) continue;
        const map = fitMap(pts);
        if (!map) continue;
        paper /= pts.length;
        const have = new Set(pts.map(([u, v]) => `${u - 0.5},${v - 0.5}`));
        const cw = Math.min(C, 5), rh = Math.min(R, 5);
        // 5. where do the missing rows/columns go? score each placement by how much paper is under its new squares
        let best = null;
        for (let oc = 0; oc <= 5 - cw; oc++) for (let orr = 0; orr <= 5 - rh; orr++) {
          let score = 0, cnt = 0;
          for (let u = -oc; u < 5 - oc; u++) for (let v = -orr; v < 5 - orr; v++) {
            if (have.has(`${u},${v}`)) continue;
            let hit = 0, tot = 0;
            for (let a = 0.2; a < 0.85; a += 0.15) for (let b = 0.2; b < 0.85; b += 0.15) {
              const [x, y] = map(u + a, v + b);
              tot++;
              if (x >= 0 && y >= 0 && x < w && y < h && px[(y | 0) * w + (x | 0)] > 0.8 * paper) hit++;
            }
            score += hit / tot; cnt++;
          }
          // cards without an outer frame lose their whole outside ring to the margin: lean towards growing evenly
          const sc = (cnt ? score / cnt : 1) - 0.12 * (Math.abs(oc - (5 - cw) / 2) + Math.abs(orr - (5 - rh) / 2));
          if (!best || sc > best.sc) best = { sc, oc, orr };
        }
        const u0 = -best.oc, v0 = -best.orr;
        const quad = [map(u0, v0), map(u0 + 5, v0), map(u0 + 5, v0 + 5), map(u0, v0 + 5)];
        if (quad.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) continue;
        found.push(quad);
      }
    }
    // 6. reading order: rows of cards top to bottom, then left to right
    const mid = (q) => [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2];
    const ht = (q) => Math.abs(q[3][1] - q[0][1]);
    found.sort((a, b) => mid(a)[1] - mid(b)[1]);
    const rows = [];
    for (const q of found) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(mid(q)[1] - mid(last[0])[1]) < 0.5 * ht(last[0])) last.push(q); else rows.push([q]);
    }
    return rows.flatMap((row) => row.sort((a, b) => mid(a)[0] - mid(b)[0]));
  }
  /** detect() on an image, with the quads in the image's own pixels. */
  function findCards(img) {
    try {
      const g = graySmall(img);
      return detect(g).map((q) => q.map(([x, y]) => [x / g.k, y / g.k]));
    } catch { return []; }
  }

  /** One cell, cropped to its middle (or to `box`, in fractions of the cell), black digits on white (Otsu),
   *  scaled up with a white margin. */
  function cellCanvas(grid, ci, box = [0.14, 0.14, 0.86, 0.86]) {
    const cs = SIZE / 5, x0 = (ci % 5) * cs + box[0] * cs, y0 = ((ci / 5) | 0) * cs + box[1] * cs;
    const w = Math.round((box[2] - box[0]) * cs), hh = Math.round((box[3] - box[1]) * cs);
    const hist = new Array(256).fill(0), vals = new Float32Array(w * hh);
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const v = grid[Math.min(SIZE - 1, Math.round(y0 + y)) * SIZE + Math.min(SIZE - 1, Math.round(x0 + x))];
      vals[y * w + x] = v; hist[Math.max(0, Math.min(255, v | 0))]++;
    }
    let sum = 0, sumB = 0, wB = 0, best = 0, th = 128;
    for (let t = 0; t < 256; t++) sum += t * hist[t];
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = vals.length - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) ** 2;
      if (between > best) { best = between; th = t; }
    }
    let dark = 0;
    for (const v of vals) if (v < th) dark++;
    const invert = dark > vals.length / 2;  // light digits on a dark cell
    const S = 2, pad = 16, c = document.createElement('canvas');
    c.width = w * S + pad * 2; c.height = hh * S + pad * 2;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    const img = g.createImageData(w * S, hh * S);
    let ink = 0;
    for (let y = 0; y < hh * S; y++) for (let x = 0; x < w * S; x++) {
      const v = vals[((y / S) | 0) * w + ((x / S) | 0)];
      const on = invert ? v >= th : v < th, o = (y * w * S + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = on ? 0 : 255; img.data[o + 3] = 255;
      if (on) ink++;
    }
    g.putImageData(img, pad, pad);
    return { canvas: c, blank: ink < w * hh * S * S * 0.015 };
  }

  // ---------- the reader: one Tesseract worker for the whole scan, made as soon as the scanner opens

  const blankCard = () => Array.from({ length: 25 }, (_, i) => (i === 12 ? 0 : null));
  function reader() {
    let worker = null, mode = null, dead = false;
    const ready = loadTess().then(() => Tesseract.createWorker('eng', 1, {
      workerPath: `${T}/worker.min.js`, corePath: `${T}/tesseract-core-simd-lstm.wasm.js`, langPath: T,
      workerBlobURL: false, gzip: true, cacheMethod: 'none',
    })).then(async (w) => {
      if (dead) { w.terminate(); throw new Error('stopped'); }
      worker = w;
      await w.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '8' });
      mode = '8';
      return w;
    });
    ready.catch(() => {});
    const setMode = async (m) => { if (m !== mode) { await worker.setParameters({ tessedit_pageseg_mode: m }); mode = m; } };
    /** Read one straightened grid → { nums, serial }, or null when alive() turns false part way. */
    async function card(grid, { serial = false, alive = () => true, tick = () => {} } = {}) {
      await ready;
      const nums = blankCard(), todo = [];
      for (let i = 0; i < 25; i++) {
        if (i === 12) continue;
        const { canvas, blank } = cellCanvas(grid, i);
        if (!blank) todo.push({ i, canvas });
      }
      // every square in single-word mode first; the empty or wrong-column ones get a second and third look
      let left = todo, done = 0;
      for (const m of ['8', '7', '13']) {
        if (!left.length) break;
        await setMode(m);
        const miss = [];
        for (const t of left) {
          if (!alive()) return null;
          const { data } = await worker.recognize(t.canvas);
          const n = parseInt((data.text || '').replace(/\D/g, '').slice(0, 2), 10), lo = (t.i % 5) * 15 + 1;
          if (n >= lo && n <= lo + 14) nums[t.i] = n; else miss.push(t);
          if (m === '8') tick(++done / Math.max(1, todo.length));
        }
        left = miss;
      }
      let sn = '';
      // many sheets print the card's serial number in the FREE square, under the word FREE
      if (serial) {
        const { canvas, blank } = cellCanvas(grid, 12, [0.06, 0.48, 0.94, 0.96]);
        if (!blank && alive()) {
          await setMode('7');
          const { data } = await worker.recognize(canvas);
          const m = (data.text || '').replace(/\s/g, '').match(/\d{3,7}/);
          if (m && (data.confidence ?? 100) > 55) sn = m[0];
        }
      }
      return alive() ? { nums, serial: sn } : null;
    }
    return { ready, card, stop() { dead = true; worker?.terminate().catch?.(() => {}); worker = null; } };
  }

  // ---------- pictures: a photo is kept as its file (or a JPEG of the camera frame) and decoded when needed

  const WORK = 2000;  // the long side a page is worked on at (plenty for a 6-on sheet; keeps memory low on phones)
  function decode(blob) {
    return new Promise((ok, fail) => {
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(img.src); ok(img); };
      img.onerror = () => { URL.revokeObjectURL(img.src); fail(new Error('That picture could not be opened.')); };
      img.src = URL.createObjectURL(blob);
    });
  }
  function shrink(img, max = WORK) {
    const W = img.naturalWidth || img.videoWidth || img.width, H = img.naturalHeight || img.videoHeight || img.height;
    const k = Math.min(1, max / Math.max(W, H)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(H * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  const defaultQuad = (W, H, f = 0.8) => {
    const s = Math.min(W, H) * f, x = (W - s) / 2, y = (H - s) / 2;
    return [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
  };
  /** A small picture of a page with its grids drawn on (the batch tray). */
  function thumb(img, quads, h = 84) {
    const W = img.width, H = img.height, k = h / H, c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W * k)); c.height = h;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, c.width, c.height);
    g.strokeStyle = '#ffd166'; g.lineWidth = 2;
    for (const q of quads) {
      g.beginPath();
      q.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k)));
      g.closePath(); g.stroke();
    }
    return c;
  }

  // ---------- fixing the grids on one picture: drag ✥ / a card's number to slide it, the dots onto its corners

  function adjust(box, host, img, quads, nFound, multi, { go, buttons = [] }) {
    box.textContent = '';
    const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    let sel = quads.length === 1 || !nFound ? 0 : -1;
    if (!quads.length) quads.push(defaultQuad(W, H, 0.4));
    const title = el('h3');
    const tip = el('p', 'muted bgt-tip');
    const wrap = el('div', 'bgt-adjust');
    const cv = el('canvas');
    const view = Math.min(multi ? 520 : 460, (host.clientWidth || 360) - 8);
    const k = Math.min(view / W, (multi ? 560 : 460) / H);
    cv.width = Math.round(W * k); cv.height = Math.round(H * k);
    const g = cv.getContext('2d');
    wrap.append(cv);
    let dots = [], tags = [];
    const row = el('div', 'row bgt-scan-row');
    const goB = el('button', 'primary');
    const addB = el('button', '', '＋ Add');
    addB.title = 'Add a card it missed';
    const delB = el('button', '');
    function paint() {
      g.drawImage(img, 0, 0, cv.width, cv.height);
      quads.forEach((quad, qi) => {
        const map = homography(quad);
        const on = qi === sel || !multi;
        g.strokeStyle = on ? '#ffd166' : '#4cc9f0'; g.lineWidth = on ? 2 : 1.5;
        if (map) for (let i = 0; i <= 5; i++) {
          const a = map(i / 5, 0), b = map(i / 5, 1), c = map(0, i / 5), d = map(1, i / 5);
          g.beginPath(); g.moveTo(a[0] * k, a[1] * k); g.lineTo(b[0] * k, b[1] * k); g.moveTo(c[0] * k, c[1] * k); g.lineTo(d[0] * k, d[1] * k); g.stroke();
        }
      });
      dots.forEach((d, i) => { d.style.left = `${quads[sel][i][0] * k}px`; d.style.top = `${quads[sel][i][1] * k}px`; });
      tags.forEach((t, qi) => {
        const q = quads[qi];
        t.style.left = `${((q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4) * k}px`;
        t.style.top = `${((q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4) * k}px`;
      });
    }
    function build() {
      dots.forEach((d) => d.remove()); tags.forEach((t) => t.remove());
      dots = []; tags = [];
      // the middle handle: drag it to slide the whole grid; on a sheet, a tap picks that card for its corners
      quads.forEach((_, qi) => {
        const t = el('button', `bgt-qtag${qi === sel || !multi ? ' on' : ''}`, multi ? String(qi + 1) : '✥');
        t.title = multi ? (qi === sel ? 'Drag to move this grid · tap when it fits' : 'Drag to move this grid · tap to fix its corners') : 'Drag to move the whole grid';
        t.onpointerdown = (e) => {
          e.preventDefault();
          t.setPointerCapture?.(e.pointerId);
          const x0 = e.clientX, y0 = e.clientY, start = quads[qi].map((p) => p.slice());
          let moved = false;
          t.onpointermove = (ev) => {
            const dx = (ev.clientX - x0) / k, dy = (ev.clientY - y0) / k;
            if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
            moved = true;
            // keep every corner inside the photo
            const cx = Math.max(-Math.min(...start.map((p) => p[0])), Math.min(W - Math.max(...start.map((p) => p[0])), dx));
            const cy = Math.max(-Math.min(...start.map((p) => p[1])), Math.min(H - Math.max(...start.map((p) => p[1])), dy));
            quads[qi] = start.map(([x, y]) => [x + cx, y + cy]);
            paint();
          };
          t.onpointerup = () => {
            t.onpointermove = null;
            if (multi && (!moved || sel !== qi)) { sel = moved || sel !== qi ? qi : -1; build(); }
          };
        };
        t.onclick = (e) => e.preventDefault();
        wrap.append(t); tags.push(t);
      });
      if (sel >= 0) dots = quads[sel].map((_, i) => {
        const d = el('span', 'bgt-dot');
        d.onpointerdown = (e) => {
          e.preventDefault();
          d.setPointerCapture?.(e.pointerId);
          const r = cv.getBoundingClientRect();
          d.onpointermove = (ev) => {
            quads[sel][i] = [Math.max(0, Math.min(W, (ev.clientX - r.left) / k)), Math.max(0, Math.min(H, (ev.clientY - r.top) / k))];
            paint();
          };
          d.onpointerup = () => { d.onpointermove = null; };
        };
        wrap.append(d);
        return d;
      });
      const n = quads.length;
      title.textContent = multi ? (nFound ? `📐 Found ${nFound} card${nFound > 1 ? 's' : ''}` : '📐 Show me the cards') : '📐 Line up the corners';
      tip.textContent = !multi ? (nFound ? 'Found it. If the yellow grid is off, drag ✥ to slide it and the four dots onto the corners of the 25 numbers.'
        : 'Drag ✥ to slide the grid, and the four dots onto the corners of the number grid (not the B I N G O header).')
        : sel >= 0 ? `Card ${sel + 1}: drag its number to slide the grid, the dots to fit its corners. Tap the number when done.`
          : nFound ? 'Grid off? Drag the card\'s number to slide it, or tap it to fix the corners. ＋ adds a card I missed.'
            : 'I could not find them by myself: drag the dots onto one card\'s 25 numbers, then ＋ for each other card.';
      goB.textContent = multi ? `🔎 Read ${n} card${n === 1 ? '' : 's'}` : '🔎 Read the numbers';
      goB.disabled = !n;
      delB.hidden = !multi || sel < 0;
      delB.textContent = `✕ Card ${sel + 1}`;
      delB.title = `Leave card ${sel + 1} out`;
      addB.hidden = !multi || n >= 12;
      paint();
    }
    addB.onclick = () => { quads.push(defaultQuad(W, H, 0.35)); sel = quads.length - 1; build(); };
    delB.onclick = () => { quads.splice(sel, 1); sel = -1; build(); };
    goB.onclick = () => go(quads);
    row.append(goB, addB, delB, ...buttons);
    box.append(title, tip, wrap, row);
    build();
  }

  // ---------- the camera

  function camera(stage, video, onFail) {
    let stream = null, dead = false;
    if (!navigator.mediaDevices?.getUserMedia) { onFail(); return { stop() {} }; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => { if (dead) return s.getTracks().forEach((t) => t.stop()); stream = s; video.srcObject = s; return video.play(); })
      .catch(() => { if (!dead) onFail(); });
    return { stop() { dead = true; stream?.getTracks().forEach((t) => t.stop()); stream = null; } };
  }
  function frame(video) {
    if (!video.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    return c;
  }

  // ---------- one card: capture → line up the corners → read

  function single(host, toast) {
    return new Promise((resolve) => {
      const box = el('div', 'bgt-scan');
      host.append(box);
      let cam = null, R = null;
      const finish = (v) => { cam?.stop(); R?.stop(); box.remove(); resolve(v); };

      function capture() {
        box.textContent = '';
        box.append(el('h3', '', '📷 Scan a card'),
          el('p', 'muted', 'Fill the square with the card\'s 25 numbers (below the B I N G O letters), flat and well lit.'));
        const stage = el('div', 'bgt-cam');
        const video = el('video');
        video.setAttribute('playsinline', ''); video.muted = true;
        const guide = el('div', 'bgt-guide');
        for (let i = 0; i < 25; i++) guide.append(el('i'));
        stage.append(video, guide);
        const row = el('div', 'row bgt-scan-row');
        const snap = el('button', 'primary', '📸 Capture');
        const file = el('input');
        file.type = 'file'; file.accept = 'image/*'; file.hidden = true;
        const pickBtn = el('button', '', '🖼️ Use a photo');
        const cancel = el('button', 'ghost-btn', 'Cancel');
        pickBtn.onclick = () => file.click();
        cancel.onclick = () => finish(null);
        file.onchange = () => {
          const f = file.files?.[0];
          if (f) decode(f).then((img) => { cam?.stop(); look(shrink(img), null); }, (e) => toast(e.message));
        };
        row.append(snap, pickBtn, cancel, file);
        box.append(stage, row);
        cam = camera(stage, video, () => { stage.hidden = true; snap.hidden = true; box.querySelector('p').textContent = 'No camera here (or it was blocked): pick a photo of the card instead.'; });
        snap.onclick = () => {
          const c = frame(video);
          if (!c) return;
          // the guide square, in video pixels (object-fit: cover)
          const r = stage.getBoundingClientRect(), sc = Math.max(r.width / c.width, r.height / c.height);
          const gw = guide.getBoundingClientRect(), ox = (c.width * sc - r.width) / 2, oy = (c.height * sc - r.height) / 2;
          const toV = (x, y) => [(x - r.left + ox) / sc, (y - r.top + oy) / sc];
          cam.stop();
          look(c, [toV(gw.left, gw.top), toV(gw.right, gw.top), toV(gw.right, gw.bottom), toV(gw.left, gw.bottom)]);
        };
      }

      function look(img, guideQ) {
        box.textContent = '';
        box.append(el('h3', '', '🔎 Looking for the card…'));
        R ??= reader();  // warm the number reader up while the corners are checked
        setTimeout(() => {
          const found = findCards(img), W = img.width, H = img.height;
          // the card under the guide's middle (or the photo's), else the guide itself
          const [mx, my] = guideQ ? [(guideQ[0][0] + guideQ[2][0]) / 2, (guideQ[0][1] + guideQ[2][1]) / 2] : [W / 2, H / 2];
          const dist = (q) => Math.hypot((q[0][0] + q[2][0]) / 2 - mx, (q[0][1] + q[2][1]) / 2 - my);
          const best = found.slice().sort((a, b) => dist(a) - dist(b))[0];
          const retake = el('button', '', '↩︎ Retake'), cancel = el('button', 'ghost-btn', 'Cancel');
          retake.onclick = capture; cancel.onclick = () => finish(null);
          adjust(box, host, img, [(best || guideQ || defaultQuad(W, H)).map((p) => p.slice())], found.length, false,
            { go: (quads) => read(img, quads[0]), buttons: [retake, cancel] });
        }, 30);
      }

      async function read(img, quad) {
        box.textContent = '';
        const bar = el('div', 'bgo-pace'), fill = el('span');
        bar.append(fill);
        const msg = el('p', 'muted', 'Loading the number reader…');
        const cancel = el('button', 'ghost-btn', 'Cancel');
        let stopped = false;
        cancel.onclick = () => { stopped = true; finish(null); };
        box.append(el('h3', '', '🔎 Reading…'), msg, bar, cancel);
        try {
          const grid = warp(gray(img), quad);
          if (!grid) throw new Error('Those corners do not make a card: retake it.');
          await R.ready;
          msg.textContent = 'Reading the 24 numbers…';
          const got = await R.card(grid, { alive: () => !stopped, tick: (f) => { fill.style.width = `${100 * f}%`; } });
          if (!stopped) finish(got.nums);
        } catch (e) {
          if (stopped) return;
          toast(e?.message?.length < 90 ? e.message : 'The card could not be read: type it in instead.');
          finish(blankCard());
        }
      }

      capture();
    });
  }

  // ---------- a pile of sheets: shoot (or pick) page after page; each is found and read while the next is shot

  function batch(host, toast) {
    return new Promise((resolve) => {
      const box = el('div', 'bgt-scan');
      host.append(box);
      const R = reader();
      const pages = [];  // { id, blob, W, H, quads, nFound, state: find|wait|read|done|fix, cards, thumb, gen, prog }
      let cam = null, busy = false, closing = false, waiting = false, nextId = 1, findChain = Promise.resolve(), failed = null;
      let tray = null, doneB = null, status = null;
      const finish = (v) => { closing = true; cam?.stop(); R.stop(); box.remove(); resolve(v); };
      const nCards = () => pages.reduce((s, p) => s + (p.state === 'done' ? p.cards.length : p.quads.length), 0);
      const result = () => {
        let sheet = 0;
        const out = [];
        for (const p of pages) {
          const cards = p.state === 'done' ? p.cards : p.quads.map(() => ({ nums: blankCard(), serial: '' }));
          if (!cards.length) continue;
          sheet++;
          for (const c of cards) out.push({ nums: c.nums, serial: c.serial, sheet });
        }
        return out;
      };

      function shoot() {
        box.textContent = '';
        box.append(el('h3', '', '📷 Scan your cards'),
          el('p', 'muted', 'One card or a whole sheet, flat and in good light, every card in the frame. Got a book? 📸 a page, turn it, 📸 the next: I read them while you shoot.'));
        const stage = el('div', 'bgt-cam sheet');
        const video = el('video');
        video.setAttribute('playsinline', ''); video.muted = true;
        stage.append(video, el('div', 'bgt-guide sheet'));
        const row = el('div', 'row bgt-scan-row');
        const snap = el('button', 'primary', '📸 Capture');
        const file = el('input');
        file.type = 'file'; file.accept = 'image/*'; file.multiple = true; file.hidden = true;  // no `capture`: the gallery, many at once
        const pickBtn = el('button', '', '🖼️ Pick photos');
        pickBtn.title = 'Pick one photo or many (a page each): they are read in the order they were taken';
        pickBtn.onclick = () => file.click();
        file.onchange = () => {
          const fs = [...(file.files || [])].sort((a, b) => (a.lastModified || 0) - (b.lastModified || 0) || a.name.localeCompare(b.name, undefined, { numeric: true }));
          file.value = '';
          for (const f of fs) add(f);
          if (fs.length > 1) toast(`🖼️ ${fs.length} pages added: reading them now.`);
        };
        row.append(snap, pickBtn, file);
        tray = el('div', 'bgt-tray');
        status = el('p', 'muted bgt-tstat');
        const end = el('div', 'row bgt-scan-row');
        doneB = el('button', 'primary');
        doneB.onclick = () => {
          if (!nCards()) return;
          if (!pages.some((p) => ['find', 'wait', 'read'].includes(p.state))) return finish(result());
          waiting = true; paintTray();
        };
        const cancel = el('button', 'ghost-btn', 'Cancel');
        let sure = 0;
        cancel.onclick = () => {
          const n = nCards();
          if (!n || Date.now() - sure < 4000) return finish(null);
          sure = Date.now();
          cancel.textContent = `Drop ${n} card${n > 1 ? 's' : ''}?`;
          setTimeout(() => { cancel.textContent = 'Cancel'; }, 4000);
        };
        end.append(doneB, cancel);
        box.append(stage, row, tray, status, end);
        cam = camera(stage, video, () => { stage.hidden = true; snap.hidden = true; box.querySelector('p').textContent = 'No camera here (or it was blocked): pick photos of your cards instead, as many pages as you like.'; });
        snap.onclick = () => {
          const c = frame(video);
          if (!c) return;
          stage.classList.remove('flash'); void stage.offsetWidth; stage.classList.add('flash');
          c.toBlob((b) => b && add(b), 'image/jpeg', 0.92);
        };
        paintTray();
      }

      const label = (p) => {
        const n = p.quads.length;
        return { find: '🔎 finding', wait: `⏳ ${n} card${n === 1 ? '' : 's'}`, read: `📖 ${Math.round(100 * p.prog)}%`,
          done: `✓ ${p.cards.length} card${p.cards.length === 1 ? '' : 's'}`, fix: '⚠ tap to fix' }[p.state];
      };
      function paintTray() {
        if (!tray) return;
        tray.textContent = '';
        pages.forEach((p, i) => {
          const t = el('div', `bgt-shot ${p.state}`);
          const b = el('button', 'bgt-pagebtn');
          b.title = p.state === 'find' ? 'Looking for cards…' : 'Check or fix this page\'s grids';
          if (p.thumb) b.append(p.thumb); else b.append(el('span', 'bgt-pageph', '📄'));
          p.labEl = el('small', '', label(p));
          b.append(el('b', '', `Page ${i + 1}`), p.labEl);
          b.onclick = () => { if (p.state !== 'find') fix(p); };
          const x = el('button', 'bgt-pagex', '✕');
          x.title = `Leave page ${i + 1} out`;
          x.onclick = () => { pages.splice(pages.indexOf(p), 1); p.gen++; paintTray(); pump(); };
          t.append(b, x);
          tray.append(t);
        });
        const n = nCards(), left = pages.filter((p) => ['find', 'wait', 'read'].includes(p.state)).length;
        const bad = pages.filter((p) => p.state === 'fix').length;
        status.textContent = !pages.length ? 'Nothing scanned yet.'
          : [`${pages.length} page${pages.length > 1 ? 's' : ''}, ${n} card${n === 1 ? '' : 's'}`,
            left && `reading ${left} page${left > 1 ? 's' : ''}…`, bad && `${bad} with no cards found (tap ⚠ to show me)`].filter(Boolean).join(' · ');
        doneB.disabled = !n;
        doneB.textContent = waiting && left ? `⏳ Finishing ${left} page${left > 1 ? 's' : ''}…` : `✅ Check ${n || ''} card${n === 1 ? '' : 's'}`.replace('  ', ' ');
      }

      function add(blob) {
        const p = { id: nextId++, blob, W: 0, H: 0, quads: [], nFound: 0, state: 'find', cards: [], thumb: null, gen: 0, prog: 0 };
        pages.push(p);
        paintTray();
        if (tray) tray.scrollLeft = tray.scrollWidth;
        findChain = findChain.then(() => new Promise((ok) => setTimeout(ok, 30))).then(async () => {
          if (closing || !pages.includes(p)) return;
          try {
            const img = shrink(await decode(blob));
            p.W = img.width; p.H = img.height;
            p.quads = findCards(img);
            p.nFound = p.quads.length;
            p.thumb = thumb(img, p.quads);
            p.state = p.quads.length ? 'wait' : 'fix';
          } catch (e) { toast(e.message); pages.splice(pages.indexOf(p), 1); }
          paintTray(); pump();
        });
      }

      async function pump() {
        if (busy || closing) return;
        const p = pages.find((q) => q.state === 'wait');
        if (!p) { if (waiting && !pages.some((q) => ['find', 'read'].includes(q.state))) finish(result()); return; }
        busy = true;
        const gen = p.gen, alive = () => !closing && p.gen === gen && pages.includes(p);
        p.state = 'read'; p.prog = 0; paintTray();
        try {
          if (failed) throw failed;
          const src = gray(shrink(await decode(p.blob)));
          const cards = [];
          for (let qi = 0; qi < p.quads.length && alive(); qi++) {
            const grid = warp(src, p.quads[qi]);
            const got = grid ? await R.card(grid, { serial: true, alive, tick: (f) => { p.prog = (qi + f) / p.quads.length; if (alive() && p.labEl) p.labEl.textContent = label(p); } })
              : { nums: blankCard(), serial: '' };
            if (!got) break;
            cards.push(got);
          }
          if (alive()) { p.cards = cards; p.state = 'done'; }
        } catch (e) {
          // the reader would not start: hand the cards over unread, to type in
          if (!failed) toast(e?.message?.length < 90 ? e.message : 'The cards could not be read: type them in instead.');
          failed ||= e;
          if (alive()) { p.cards = p.quads.map(() => ({ nums: blankCard(), serial: '' })); p.state = 'done'; }
        }
        busy = false;
        if (!closing) { paintTray(); pump(); }
      }

      async function fix(p) {
        cam?.stop(); cam = null;
        waiting = false;
        let img;
        try { img = shrink(await decode(p.blob)); } catch (e) { toast(e.message); return; }
        if (closing) return;
        const back = el('button', '', '↩︎ Back to pages');
        back.onclick = shoot;
        const del = el('button', 'ghost-btn', '🗑 Drop page');
        del.onclick = () => { pages.splice(pages.indexOf(p), 1); p.gen++; shoot(); pump(); };
        adjust(box, host, img, p.quads.map((q) => q.map((pt) => pt.slice())), p.nFound, true, {
          buttons: [back, del],
          go: (quads) => {
            p.quads = quads.map((q) => q.map((pt) => pt.slice()));
            p.gen++; p.cards = [];
            p.state = p.quads.length ? 'wait' : 'fix';
            p.thumb = thumb(img, p.quads);
            shoot(); pump();
          },
        });
      }

      shoot();
    });
  }

  /** One card: scan(host, opts) → Promise<Array(25) | null>. Cards in bulk: scan(host, { multi: true }) →
   *  Promise<Array<{ nums, serial, sheet }> | null>, every card found, page by page in reading order. */
  function scan(host, { toast = () => {}, multi = false } = {}) {
    return multi ? batch(host, toast) : single(host, toast);
  }

  return { scan, _test: { homography, warp, cellCanvas, gray, SIZE, detect, fitMap, findCards } };
})();
