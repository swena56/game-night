"""Lane Night's score explainer (the 📖 list under the scoresheet) must add up to the server's cumulative score for
every kind of game: strikes, spares, opens, the last frame's bonus balls and the cosmic +10.

    python3 tests/lanes_explain.py
"""
import json, os, random, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from games import lanes as L  # noqa: E402

rng = random.Random(7)
cases = []
for _ in range(300):
    nf = rng.choice([10, 10, 5])
    rolls, fr = [], 0
    # a random but legal game, sometimes cut short
    full = []
    for f in range(nf):
        a = 10 if rng.random() < 0.3 else rng.randint(0, 10)
        full.append(a)
        if a < 10 or f == nf - 1:
            b = rng.randint(0, 10 - (a if a < 10 else 0)) if a < 10 else (10 if rng.random() < 0.4 else rng.randint(0, 9))
            full.append(b)
            if f == nf - 1 and (a == 10 or a + b == 10):
                full.append(rng.randint(0, 10) if (a == 10 and b == 10) or a + b == 10 else rng.randint(0, 10 - b))
    cut = len(full) if rng.random() < 0.5 else rng.randint(1, len(full))
    rolls = full[:cut]
    cosmic = rng.randrange(1, nf - 1) if nf > 3 else 0
    cases.append({"nf": nf, "cosmic": cosmic, "frames": L.frame_rolls(rolls, nf), "cum": L.score(rolls, nf, cosmic)})

js = r"""
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(process.argv[1], 'utf8');
const ctx = { UI: {}, window: {}, document: {}, performance: { now: () => 0 }, console };
vm.createContext(ctx); vm.runInContext(src, ctx);
const cases = JSON.parse(fs.readFileSync(0, 'utf8')); let bad = 0;
for (const c of cases) {
  const ex = ctx.UI.lanes.explain({ frames: c.frames, cum: c.cum, splits: [], saved: [] }, c.nf, c.cosmic);
  ex.forEach((x, f) => { if (x.pts != null && x.total !== c.cum[f]) { bad++; if (bad < 4) console.log('MISMATCH', JSON.stringify(c), f, x.total, c.cum[f]); } if (x.pts == null && c.cum[f] != null) { bad++; } });
}
console.log(bad ? 'FAIL ' + bad : 'all ok');
"""
r = subprocess.run(["node", "-e", js, os.path.join(ROOT, "static/games/lanes.js")], input=json.dumps(cases), capture_output=True, text=True)
print(r.stdout.strip() or r.stderr.strip())
sys.exit(0 if r.stdout.strip().endswith("all ok") else 1)
