# pinball_engine

A small, dependency-free pinball simulation. It steps one ball per table at a fixed 240 Hz and keeps
all physics and scoring in plain Python, so a table is data plus a few tunables.

```python
from games.pinball_engine import Layout, Rules, Table, flipper_pair

class Mini(Table):
    layout = Layout(rails=..., flippers=flipper_pair(7.5, 1.5, 4.5), launch=(5.5, 7),
                    bumps=((3, 3, 0.5),), width=6, height=8)
    rules = Rules(balls=2, bumper=7)

table = Mini()
table.input(held=4, nudge=0, now=0)   # bit 0/1 = left/right flipper, bit 2 = plunger
table.step()                          # advance 1/240 s
table.public()                        # packed row for renderers
```

## Pieces
- `Layout` (`layout.py`): rails, slings, bumpers, targets, rollover lanes, flippers, plus the optional
  spinner, ramp, one-way gate and outlane kickback. `Layout.public()` is the dict sent to the browser.
- `Rules` (`rules.py`): points, ball count, save/jackpot/combo timers, multiplier cap, nudge limit.
- `Table` (`table.py`): physics (swept flipper capsules, bumpers, slings, speed cap), nudge and tilt,
  lit shot and combo chain, ball save, end-of-ball bonus, stuck-ball recovery.

Optional parts are skipped when left as `None`/empty. Rendering is not part of the engine; the packed
`public()` row indices are mirrored by `static/games/pinball.js`.

Golden Hour (`games/pinball.py`) is the reference table. Tests: `tests/pinball_engine.py` (a second
table) and `tests/pinball_rules.py` (Golden Hour rules).
