"""Rasterise every Doodle Dash drawing onto one PNG contact sheet (pure Python, no dependencies), so the
art can be eyeballed without a browser. Usage: python3 tests/doodle_sheet.py out.png [first_n_strokes_fraction]"""
import os
import re
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from games.doodle_art import DRAWINGS  # noqa: E402

CELL, COLS, PAD = 120, 8, 10


def points(d):
    """Sample an M/L/C/Q/Z path into polylines."""
    toks = re.findall(r"[MLCQZ]|-?\d+(?:\.\d+)?", d)
    lines, cur, start, i, cmd = [], None, None, 0, None
    nums = lambda k: [float(t) for t in toks[i:i + k]]
    while i < len(toks):
        if toks[i] in "MLCQZ":
            cmd = toks[i]; i += 1
            if cmd == "Z":
                if cur and start:
                    lines[-1].append(start)
                    cur = start
                continue
        if cmd == "M":
            x, y = nums(2); i += 2; cur = start = (x, y); lines.append([cur]); cmd = "L"
        elif cmd == "L":
            x, y = nums(2); i += 2; cur = (x, y); lines[-1].append(cur)
        elif cmd == "Q":
            cx, cy, x, y = nums(4); i += 4
            x0, y0 = cur
            for s in range(1, 13):
                t = s / 12
                lines[-1].append(((1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y))
            cur = (x, y)
        elif cmd == "C":
            c1x, c1y, c2x, c2y, x, y = nums(6); i += 6
            x0, y0 = cur
            for s in range(1, 17):
                t = s / 16; u = 1 - t
                lines[-1].append((u ** 3 * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t ** 3 * x,
                                  u ** 3 * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t ** 3 * y))
            cur = (x, y)
        else:
            raise ValueError(f"bad path {d!r} at {toks[i]}")
    return lines


def main():
    out = sys.argv[1]
    frac = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
    rows = (len(DRAWINGS) + COLS - 1) // COLS
    W, H = COLS * CELL, rows * CELL
    px = bytearray([255]) * (W * H)
    def dot(x, y):
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                xx, yy = int(x) + dx, int(y) + dy
                if 0 <= xx < W and 0 <= yy < H:
                    px[yy * W + xx] = 0
    for n, (_, _, _, strokes) in enumerate(DRAWINGS):
        ox, oy = (n % COLS) * CELL + PAD, (n // COLS) * CELL + PAD
        sc = (CELL - 2 * PAD) / 100
        for x in range(CELL):  # cell border
            for yy in (0, CELL - 1):
                px[((n // COLS) * CELL + yy) * W + (n % COLS) * CELL + x] = 180
        for d in strokes[:max(1, round(len(strokes) * frac))]:
            for line in points(d):
                for (x0, y0), (x1, y1) in zip(line, line[1:]):
                    steps = int(max(abs(x1 - x0), abs(y1 - y0)) * sc) + 1
                    for s in range(steps + 1):
                        t = s / steps
                        dot(ox + (x0 + (x1 - x0) * t) * sc, oy + (y0 + (y1 - y0) * t) * sc)
    raw = b"".join(b"\0" + bytes(px[y * W:(y + 1) * W]) for y in range(H))
    chunk = lambda t, data: struct.pack(">I", len(data)) + t + data + struct.pack(">I", zlib.crc32(t + data) & 0xffffffff)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 0, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    open(out, "wb").write(png)
    print("\n".join(f"{i:2} {a}" for i, (a, *_ ) in enumerate(DRAWINGS)))


if __name__ == "__main__":
    main()
