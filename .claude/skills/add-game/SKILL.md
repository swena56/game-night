---
name: add-game
description: Add a new game to the Game Night app (server rules module, bot, browser UI module, registration, tests). Use when the user asks to add, create or build a new game, or to port a game idea into this app.
---

# Adding a game to Game Night

Game Night is one Python server (`server.py`, stdlib only) plus plug-in games. A game is two files:

| Layer | File | Owns |
|---|---|---|
| Rules, bot, per-player view | `games/<id>.py` | a `Game` subclass (see `games/base.py`) |
| Screen | `static/games/<id>.js` | `UI.<id> = { mount, render, … }` |

The room (`server.py`) already handles everything else: lobby, host, bots, turn order, turn timer,
log, chat, reactions, scoreboard, match history, replays, reconnects, autopilot for dropped players,
and saving rooms across restarts. Don't reimplement any of that inside a game.

Working templates: `templates/game.py` and `templates/ui.js` (**Race to 21**, a complete small
turn-based game with a bot). Copy them, rename them, and replace the rules.

## Step 0: Pick an original design

Don't recreate a specific commercial or trademarked game, even under a new name. That includes
Wheel of Fortune, Tetris, UNO, Battleship, Scrabble and Connect Four. Build an original game in the
genre and give it its own twist. That's how this app got Lucky Letters, Spire Siege, Last Card, Sea
Battle, Wordsmith and Drop Four. Traditional public-domain games (chess, checkers, Go, Crazy Eights,
Mau-Mau, Tic-Tac-Toe, the pencil-and-paper fleet game) are fine to build faithfully. Tell the user
in one line when you're making an original version instead of the named game.

Then decide:
- **Players:** `min_players` / `max_players` (the room caps seats at 6). Override `check_players`
  for mode-specific rules (see Unmask's Duel).
- **Flow:**
  - Turn-based (most games): use the room's turns.
  - Simultaneous (Night Heist): no `room.turn`; override `bot_ready` / `bot_tick` / `on_timeout`.
  - Real-time, each player separate (Spire Siege): each browser runs its own simulation; the
    server routes events; `replayable = False`.
  - Real-time, shared objects (Air Hockey): the server owns the physics. Define `frame(now)` (the
    server calls it at 60 fps; return True to re-send full views), take high-rate input in
    `on_input(p, a)` (from `POST /api/input`), and stream positions with `self.room.push_fast(data)`.
    In the browser, send with `ctx.input({...})` and receive in the module's `fast(data)`.
  - Clock-driven (Doodle Dash): schedule events on your own clock, return True from `bot_ready()`
    when one is due, and make `on_timeout()` jump to the next event so `simulate.py` can fast-forward.
- **Hidden information:** decide what each viewer may see. `view(p)` must never leak another
  player's secrets.
- **Bots:** every game has easy / normal / hard bots. Bots must play fair: no peeking at hidden
  state that a human couldn't see, unless it stands in for human knowledge (e.g. recognising a
  familiar phrase, as in Lucky Letters).

## Step 1: Server module `games/<id>.py`

Start from `templates/game.py`. The contract (`games/base.py`):

```python
class MyGame(Game):
    id = "mygame"                  # url-safe, unique; also the UI module name
    category = "board"             # party | action | board | cards | dice | words (lobby grouping)
    howto = ["…", "…", "…"]        # 3–5 short rules: shown in the lobby and the ❓ dialog
    name, icon, blurb = "My Game", "🎲", "One-sentence pitch."
    min_players, max_players = 2, 4
    settings_schema = {"size": ("Board", [(9, "9×9"), (13, "13×13")], 9)}   # key: (label, options, default)
    replayable = True              # False for real-time games

    def start(self, seated, rng): ...   # set up; then self.room.begin_turn(first.id)
    def act(self, p, a): ...            # a["type"] is your action name; raise GameError("why") on bad input
    def view(self, p): return {"mygame": {...}}   # this viewer's slice; a "me" key merges into S.me
    def meta(self, p): return "12 pts"  # short text on the player's chip
    def final_scores(self): return {pid: score}   # optional, for the match history
    def bot_turn(self, p): ...          # one decision per call; the room paces calls via room.bot_at
```

Rules that keep games consistent:
- **Per-player state goes in `p.g`** (a `SimpleNamespace` reset before every game), never directly on
  `Player`. Spectators who join mid-game have an empty `p.g`, so use `getattr(p.g, "x", default)` in
  `view` / `meta`.
- **Turn flow:**
  - `self.require_turn(p)` guards actions.
  - `self.room.advance()` passes the turn (it skips spectators, eliminated players, and anyone your
    `skip_turn(p)` returns True for).
  - `self.room.begin_turn(pid)` jumps to a specific player.
  - `self.room.finish(winner_or_None, text)` ends the game. The room records stats, history and
    bot banter.
- **The log:** `self.room.add_log(text, kind)`, where kind is `info` | `question` | `power` | `big`
  | `private`. Private lines take `to=pid`. Log each move in readable form; replays use the log as
  captions.
- **Timeouts:** the turn timer calls `on_timeout()` (default: log it and advance). You can also set
  `self.room.deadline` yourself to schedule a one-off event: Lucky Letters resolves its spin that way.
- **Leaving:** `on_leave(p)` defaults to forfeit-or-continue. Override it if your game must clean up.
- **Validate every field of `a`** (types, ranges, ownership). Players can send anything.
- **Use the `rng` passed to `start`** for game randomness, and keep it (`self.rng = rng`) if you need
  more later.
- **Real-time games:** either let each browser simulate its own board (copy `games/spire.py`), or
  run shared physics on the server (copy `games/hockey.py`). Bots then run inside `bot_tick` or
  `frame`.

Register it in `games/__init__.py`: import the class and add it to the `GAMES` tuple. The tuple's order
is the order within each lobby category.

## Step 2: Bot

- **One decision per `bot_turn` call.** If the bot keeps the turn (e.g. rolls again), set
  `self.room.bot_at = time.time() + 0.8` so humans can follow.
- **Difficulty:** use `p.bot`, which is `"easy"` | `"normal"` | `"hard"`, for noise, search depth or
  time budgets. Patterns that already work here:
  - Alpha-beta with iterative deepening and a time budget (`games/chess.py`, `games/checkers.py`).
  - Heuristic move scoring (`games/go.py`, `games/spire.py`).
  - Heuristic shortlist re-ranked by random playouts, Monte Carlo style (`games/go.py`, hard bot).
  - Probability density (`games/seabattle.py`).
  - Dictionary pattern matching (`games/lucky.py`, which reuses `wordsmith.words()`).
  - Steering toward a target point, then striking through it (`games/hockey.py`).
- **Time budget:** keep the hard bot under about 4 s per move on a phone.
- **Stand-ins:** the same code also plays for humans who drop out (autopilot), so it must work from
  any mid-game state.

## Step 3: Browser module `static/games/<id>.js`

Start from `templates/ui.js`. The contract (top of `static/app.js`):

```js
UI.mygame = {
  mount(main, side) {},   // build DOM once into the board area and side panel
  render(S, ctx) {},      // update from state; S.mygame is your view, S.me / S.players / S.phase / S.turn
  turnText(S) {},         // optional: top-bar text (return null for the default)
  myMove(S) {},           // optional: highlight "your move" in simultaneous games
  logButton(entry) {},    // optional: a button attached to a log entry
  unmount() {},           // required if you start rAF loops, timers or window listeners
  fast(data) {},          // optional: real-time updates from room.push_fast (see games/hockey.py)
};
```

`ctx` gives you `act(type, extra)` (a promise, retried safely), `input(data)` (fire-and-forget
real-time input), `quiet(promise)`, `toast(msg)`,
`el(tag, cls, text)`, `ask(text, {ok, danger})` (an in-app dialog; never use `confirm()`),
`player(id)`, `myTurn`, and `rerender()`.

Guidelines:
- **Render from state every time**, and build DOM once in `mount`. Keep local-only UI state (a
  selected piece, tiles placed but not played) in module variables, and reset it in `mount`.
- **Prefix element ids** with a short game code (e.g. `ms…`, `lk…`). Ids must be unique on the page.
- **Text:** use `textContent` / `ctx.el` for anything players or the server wrote. Never put it into
  `innerHTML`.
- **Replay mode:** `render` runs with `ctx.myTurn === false` and `ctx.act` rejected. Buttons must
  handle that.
- **Boards:** cap the size to the screen, e.g. `width: min(100%, 560px, calc(100vh - 150px))`.
- **three.js:** use it for 3D. It's in the repo as `/vendor/three.min.js` (r128; global `THREE`, works
  offline). Load it on demand in `mount` exactly like `static/games/lucky.js` does. Always provide a
  2D or SVG fallback for when WebGL or canvas is missing, and guard `getContext('2d')` returning null.
  Dispose the renderer in `unmount`.

Wire-up:
- `static/index.html`: add `<script src="/games/<id>.js"></script>` next to the others.
- `static/app.js`: add `['<id>', '<icon> <Name>']` to `SOLO_GAMES`, and an entry in `SOLO_BOTS` if
  solo play needs more than one bot.
- `static/style.css`: append a `/* <name> */` block. Reuse the CSS variables (`--panel`,
  `--accent`, …).
- Bump the game count in the home-screen tagline (`index.html`, the `.tag` paragraph).

## Step 4: Test, in this order

```bash
python3 -m py_compile games/*.py server.py
python3 .claude/skills/add-game/scripts/simulate.py <id> --players 3 --runs 20   # bots play full games
node --check static/games/<id>.js && node --check static/app.js
```

`simulate.py` plays bot-only games through the real `Room`. It fails if a game stalls or a view
can't be serialised, and it reports winners by bot level, so check that hard beats easy. It also
accepts a file path (`simulate.py games/mygame.py`) to test a module before registering it.

Then the browser test. It drives the real UI in jsdom, a simulated phone-sized browser:
1. Add a `MOVES.<id>(d, S, n, w)` entry in `tests/ui.js` that makes one human move through clicks.
2. If your game isn't turn-based, extend the `mine` condition in `playSolo`.
3. If games run long, add a duration in the `g === …` time map near the bottom.

```bash
PORT=8767 python3 server.py &            # a separate test server
cd tests && npm install && BASE=http://localhost:8767 node ui.js <id>
```

It must report the game reaching `phase=over` (or still playing at the time limit for long games),
then replay, rematch and help working, with **no ERROR lines**. Missing-WebGL messages are expected,
because jsdom has no 3D.

Finally:
- Restart the live server. Kill the old one with `kill $(pgrep -f "[p]ython3 -u server.py")`; the
  `[p]` keeps pgrep from matching your own shell. Then start `python3 -u server.py` in the
  background. Saved rooms survive the restart.
- Add a row to the games table and a bot line in `README.md`.
- Tell the user what's verified and what isn't. In particular, 3D views and touch feel can only be
  checked on a real device.
