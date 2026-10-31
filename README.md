# 🎲 Game Night

Multiplayer party games in the browser, with one room and one invite link for all of them.
Pick a game in the lobby, add friends or bots, and play. Between rounds you can switch to a
different game without leaving the room, and wins are tallied across games.

```bash
./start.sh                   # start in the background → http://localhost:8000 (log: data/server.log)
./start.sh status | stop | restart | log
PORT=9000 ./start.sh         # another port
python3 server.py            # or run it in the foreground (Ctrl+C stops it)
```

`start.sh` keeps the server running after you close the terminal. On Android it also takes a
Termux wake lock when Termux:API is installed, so the phone doesn't pause the server with the
screen off. To start it automatically when the phone boots, install the Termux:Boot app and add
a one-line script: `~/.termux/boot/game-night` containing `~/guess-who/start.sh` (use the
folder's current name).

No dependencies: Python 3 standard library only. Friends on the same Wi-Fi open the LAN
address the server prints. **Play solo** on the home screen starts any game against bots.

## The games

| Game | Players | What it is | Twist |
|---|---|---|---|
| 🎭 **Unmask** | 1–6 | Ask yes/no questions to find a hidden face. Faces are generated fresh every game. | Power cards. In Manhunt, everyone hears your question but only you hear the answer. Knocked-out players become ghosts who see everything. |
| 🔤 **Wordsmith** | 2–4 | Crossword tile game on an original 11×11 board (80 tiles, no blanks, ENABLE dictionary). | A **bounty letter** rerolls every turn (+10). Using all 7 tiles is a **clean sweep** (+40). |
| 🔴 **Drop Four** | 2–4 | Gravity four-in-a-row. 3–4 players get a 9×7 board. | Optional 💣 **bomb disc**: it clears its 3×3 neighbourhood and the stack falls, which can complete *someone else's* line. |
| 🔳 **Dots & Boxes** | 2–4 | The pencil-and-paper classic on a 3×3 to 6×6 grid. Close a box to claim it and move again. On touch screens a line takes two taps (pick, then confirm). | Optional 💎 **gem boxes** worth 3 points. |
| ❌ **Tic-Tac-Toe** | 2 | The classic. | 👻 **Vanishing**: you keep only your 3 newest marks, and the oldest fades out. |
| 🥷 **Night Heist** *(the surprise)* | 2–6 | A simultaneous bluffing game. Each night everyone secretly picks **Grab**, **Guard** or **Rest**, then all choices are revealed together. | A lone grabber steals the whole vault. Two grabbers trip the alarm and the loot grows. Guards fine grabbers 💰2 each, and guarding an empty hall costs 💰1. Reading the table is the whole game. |

| 🚀 **Moon Shot** | 2–6 | Push-your-luck dice race to the moon. Roll to build fuel, then bank it to fly. Any 1 loses this turn's fuel; double 1s crash you to the start. | A random track of ⭐ boosts (+5), ☄️ meteors (−5) and 🌀 wormholes (swap with the leader), so *where* you stop matters. Doubles earn 🛡️ shields. |

| ✏️ **Doodle Dash** | 2–6 | The computer draws a picture one line at a time (52 original line drawings in 6 categories) and everyone types guesses at once. Earlier guesses score more. | Letter blanks appear halfway through, then the first letter. A wrong guess locks you out for 3 s. Typos, plurals and synonyms are accepted. Scoring: everyone can score (the first gets +2), or ⚡ first correct only. Strokes reach the browser only as they're drawn, so nobody can peek. |
| 🎡 **Lucky Letters** | 2–6 | Spin a **3D prize wheel** (three.js), call consonants, solve the hidden phrase. 78 original puzzles in 8 categories. | Vowels can only be called by landing on ✨ VOWEL. Special wedges: 💀 Bust, ⛔ Skip, 🎁 Wild (a free letter), 🦊 Steal (take 500 from the leader), and a growing ⚡ Jackpot. The server picks where the wheel stops, and every phone animates the same spin. |
| 🗼 **Spire Siege** | 1–6 | **Real-time 3D** (three.js) falling-block battle on a cylindrical tower that wraps around. Pieces are 2-, 3- and 5-block shapes. Fill a whole ring to clear it. Clearing 2+ rings, or chaining clears, sends junk rings to a random rival. | The tower spins so your piece always faces you. Power cells: ⚡ surge (rivals fall faster), 🛡️ shield (blocks junk), 💣 blast (removes your bottom two rings). Solo survival works with 1 player. |
| 🏍️ **Light Riders** | 2–6 | **Real-time** light-cycle duels in a **3D neon arena** (three.js; flat fallback). Your bike never stops and leaves a wall of light behind it. Crash into any wall and you're out; the last rider standing wins the round. | ⚡ 3 boosts per round (double speed). Swipe, D-pad or keyboard. Quick double turns are queued, so you can whip round a corner. Medium, small or large arena; chill, normal or fast speed. |
| 🏒 **Air Hockey** | 2 | **Real-time** table hockey: drag your mallet around your half, bank shots off the walls. Server-side physics at 60 fps. | 🏒🏒 Double Trouble puts two pucks on the table. Each player sees the table from their own end. |
| ♟️ **Chess** | 2 | Full rules: castling, en passant, promotion, check/mate, stalemate, 50-move rule, threefold repetition, insufficient material. Draw offers and resignation. | Move generation is checked against standard perft counts. Black sees the board from their side. 🧊 **3D board** (three.js) by default: tap a piece, then its square; drag sideways to turn the board. The flat board is one tap away and is used automatically without WebGL. |
| ⛀ **Checkers** | 2 | American rules: compulsory captures, multi-jumps in one move, kings, and a 40-move no-progress draw. | Legal pieces and landing squares are highlighted. |
| ⚫ **Go** | 2 | 9×9, 13×13 or 19×19. Tromp–Taylor area scoring, positional superko, no suicide, 6.5 komi. | A live "score if it ended now" readout. |
| 🃏 **Last Card** | 2–6 | Shedding game from the public-domain Crazy Eights / Mau-Mau family, with a standard 52-card deck. Optional action cards: 7 draw-two (stackable), 8 skip, Q reverse, J wild. | Call **“Last card!”** in time, or any opponent can 🚨 catch you for +2. |
| 🚢 **Sea Battle** | 2 | The classic pencil-and-paper fleet hunt: hide 5 ships, then take turns firing. | Firing rules: 1 shot, hit = fire again, or Salvo (1 shot per ship afloat). Optional 📡 sonar counts the ship squares in a 3×3 area. |

Every game has **Easy / Normal / Hard bots**:
- **Unmask:** the bot picks the question that splits the remaining faces best.
- **Wordsmith:** the bot searches the dictionary against the board with a time budget.
- **Drop Four:** the hard bot searches 4 moves ahead (alpha-beta pruning).
- **Dots & Boxes:** bots take free boxes and avoid drawing third sides. When forced to give boxes away, normal and hard give the fewest. Hard also uses chain strategy: in two-player games it *double-deals* (leaves the last two boxes of a long chain to keep control), and it opens two-box chains in the middle so they can't be double-dealt back.
- **Tic-Tac-Toe:** the hard bot plays perfectly (minimax) in the classic variant.
- **Night Heist:** the bot reads the pot size and the table size.
- **Chess:** alpha-beta search with iterative deepening (hard bot: up to 4 moves deep, 4s budget). It finishes off a lone king and avoids repetition draws when ahead.
- **Checkers:** alpha-beta search (hard bot: up to 8 moves deep).
- **Go:** heuristic play: captures, rescuing groups in atari, avoiding self-atari, shape. It recognises settled territory and passes. On 9×9 and 13×13 the hard bot shortlists the best heuristic moves and picks among them by Monte Carlo playouts (about 2.5 s per move, successive halving).
- **Last Card:** keeps its long suit and saves wild Jacks for later. Normal and hard bots also catch players who forget to call “Last card!”.
- **Sea Battle:** probability-density targeting (hard), hunt-and-target with parity (normal).
- **Lucky Letters:** the hard bot picks consonants by matching the revealed pattern against the 172k-word dictionary, and solves when each word has only one possible fit. All bots recognise familiar phrases once enough letters show; the stronger the bot, the sooner it notices.
- **Doodle Dash:** bots "recognise" each picture at a random point in the drawing (sooner on harder levels), take a moment to type, and sometimes blurt out a wrong guess first.
- **Light Riders:** bots steer toward open space (a flood fill). Hard bots, once three or fewer riders remain, fight for territory: they count the cells they can reach before any rival can, refuse head-on gambles, and only boost onto a clear straight. They never drive into a cell a rival could also take.
- **Air Hockey:** bots line up behind the puck on the line to an aim point (sometimes a bank shot off the wall), then strike through it. They guard their goal when the puck is away. Levels differ in reaction time, mallet speed and aim.
- **Spire Siege:** bots run their own towers on the server and choose placements by stack height, holes and bumpiness. Difficulty sets their speed and accuracy.
- **Moon Shot:** the hard bot steers for stars, avoids meteors, aims for wormholes when it's behind, and takes more risk the further back it is.

## Around the games

- **Settings.**
  - Each game's options appear in the lobby automatically.
  - Room options: turn timer, 🔒 lock the room, and a ghost chat rule.
  - Each game remembers its last settings when you switch away and back.
  - The host can remove players, and every settings change is noted in the log.
  - ⚙️ **My settings** (stored on your device): sound, vibration, animations and chat pop-ups.
- **When a game ends.**
  - The host picks 🔁 **Rematch** (same game and settings, instant) or 🏠 **Lobby**.
  - Everyone can tap 🙋 **I'm in!** so the host sees who wants more.
- **Replays.**
  - ▶ **Replay** steps through the finished game move by move: play/pause, step, or drag the slider.
  - It shows the spectator's view, so every secret face, hidden choice and culprit is visible.
  - The last game's replay stays available from the lobby.
- **Score keeping.**
  - A scoreboard for the evening: wins, games played, 🔥 best streak, and wins per game.
  - A match history with final scores (Wordsmith points, Heist gold, Moon Shot distance).
  - The host can reset it.
- **Chat.**
  - A 💬 drawer on every screen, with an unread badge, pop-ups and quick phrases.
  - Messages are rate-limited and length-capped.
  - During a game, knocked-out players and spectators know the secrets, so by default they only chat with each other.
  - Bots occasionally comment when a game ends.

## How game selection works (architecture)

```
server.py            Room: players, host, lobby, bots, turns, timer, log, reactions, SSE
games/base.py        Game base class: the contract every game implements
games/<game>.py      Rules, settings schema, per-player view, bot
static/app.js        Shell: home, lobby (game picker + generated settings), top bar, log
static/games/<game>.js   UI module: mount(main, side) + render(state, ctx)
```

- The lobby **game picker** and **settings form** are generated from each game's
  `settings_schema`, so a new game needs no lobby code.
- Each player receives **their own filtered view** over Server-Sent Events, so hidden
  information (secret faces, tile racks, heist choices) never leaves the server.
- Turn-based games use the room's `begin_turn` / `advance` and the turn timer. Simultaneous
  games (Night Heist) override `bot_ready` / `bot_tick` / `on_timeout` instead.
- Leaving mid-game is handled once for every game: you forfeit, and the game continues
  if enough players remain.

### Adding a game

Use the project skill **`.claude/skills/add-game/`**. In Claude Code, just ask *“add a game where …”*,
or run `/add-game`. It covers:
- the server and UI contracts, the conventions, and the originality rule (no clones of trademarked games);
- copy-ready templates: `templates/game.py` + `templates/ui.js`, a complete small game with a bot;
- `scripts/simulate.py`, which plays bot-only games through the real `Room` to catch stalls, crashes
  and broken views, and checks that hard bots beat easy ones:

```bash
python3 .claude/skills/add-game/scripts/simulate.py chess --runs 5
python3 .claude/skills/add-game/scripts/simulate.py games/mygame.py   # before registering it
```

In short: a `Game` subclass in `games/<id>.py`, registered in `games/__init__.py`; a
`UI.<id> = { mount, render }` module in `static/games/<id>.js` with its `<script>` tag; then the
simulator, `node --check`, and the jsdom UI test in `tests/`.

## Real-time games

Spire Siege runs each player's tower **in their own browser** (so controls feel instant) and talks
to the server only for what's shared:
- board snapshots, about 3 per second, which drive the rivals' mini-towers;
- ring clears, which the server turns into junk attacks;
- a "topped out" message when a tower falls.

Bots and autopilot stand-ins simulate towers on the server. After a refresh, your tower is rebuilt
from your last snapshot. Real-time games set `replayable = False`, so no move-by-move replay is
recorded for them.

**Air Hockey** and **Light Riders** work the other way round, because players share the same puck or
arena: the **server owns the simulation**. Light Riders steps a grid at the arena's tick rate inside
`frame()`. Turns are sent as *kept* inputs (`ctx.input(data, true)`), so a quick double turn never
loses its first half. Each fast update carries every rider's newest cells, so a missed update or a
boost doesn't leave gaps, and a full resync goes out every 3 s.
- A 60 fps thread (`frame_ticker` in `server.py`) calls `game.frame(now)` for any game that has one.
- Players send finger positions about 30 times a second to `POST /api/input`. That handler calls
  `game.on_input` with no replay frame and no full-view broadcast. The server moves mallets toward those
  positions with a speed cap, so nobody can teleport through the puck.
- `room.push_fast(data)` streams positions (~100 bytes, ~30 per second) as an SSE `event: fast`. Pages pass
  it to the game module's `fast(data)` without re-rendering the room. Full views are only sent on goals.
- The browser predicts its own mallet with the same speed cap and extrapolates the puck between
  updates, so it stays smooth.

`static/vendor/three.min.js` is three.js r128 (MIT licence), kept in the repo so the game also
works on a LAN without internet. It is only downloaded when someone opens a 3D game (Spire Siege, Lucky Letters, Chess).

## Bug reports & suggestions

Players can send a **🐞 bug report or 💡 suggestion** from three places: the home screen, ⚙️ My settings,
or the ❓ How-to-play dialog during a game ("Something wrong with …?").
- **Optional technical details** (ticked by default, previewable via "What's included?"): the game,
  phase, settings, bot levels, the last few log lines, screen size, browser, and the **last 5 JavaScript
  errors** the page hit. The seat token and player id are never sent.
- **Storage:** reports are appended to `data/feedback.jsonl`, one JSON object per line, with done/open
  status in `data/feedback-status.json`. The server console prints each new report as it arrives.
- **Limits:** 5 reports per 10 minutes per address, 2000 characters each, and details are capped.
- **Reading them:** open **http://localhost:8000/feedback.html on the device running the server.** The
  inbox filters open, done, bugs and ideas, expands details, and marks reports done. The inbox and its
  data API only answer the server's own device (loopback), so players can't read each other's reports.
  If you ever put the server behind a reverse proxy, all requests look local, so protect the inbox
  another way.

## Refreshes and dropped connections

| Situation | What happens |
|---|---|
| **Accidental refresh / closed tab** | Your seat (room, player id, secret token) is stored in the browser, so reopening the page puts you straight back in your seat with the full current state. Half-placed Wordsmith tiles are kept for that tab. Desktop browsers ask before you leave a live game. |
| **Network blip** | The page reconnects by itself and shows a *Reconnecting…* banner if the outage lasts more than 1.5s. Every update contains the full state, so nothing is missed. |
| **Silent dead connection** (phone asleep, Wi-Fi switch) | The server sends a heartbeat every 10s. If the page hears nothing for 25s, it reconnects, and it also checks when you return to the tab or the network comes back. |
| **A move sent during an outage** | Each move carries a unique ID and is retried automatically (4 tries). The server applies each ID only once, so a move can never happen twice. |
| **Player drops out mid-game** | The page reports presence every 10s. After 20s of silence the player shows 📡 *away*. After 45s (`OFFLINE_GRACE`), a 🤖 **autopilot** plays their turns so the table isn't stuck, and they take over again the moment they're back. |
| **Host drops out** | After 45s, hosting passes to a player who is online. |
| **Server restart or crash** | Rooms are saved to `data/rooms.pickle` every few seconds and restored at startup. Turn timers restart in full. Open pages reconnect on their own. |
| **Room really gone** | Only a definite "room not found / not in this room" answer from the server clears your saved seat. Network errors never do. |

## Testing

```bash
python3 tests/jscheck.py static/app.js static/games/*.js   # structural check, no Node needed
node --check static/app.js                                  # real syntax check (Node.js)
PORT=8767 python3 server.py &                               # a separate test server
cd tests && npm install && BASE=http://localhost:8767 node ui.js          # every game
BASE=http://localhost:8767 node ui.js chess spire                          # just some
```

`tests/ui.js` loads the real page in **jsdom**, a simulated browser sized like a phone. It plays each
game solo against bots **through real clicks and key presses**, then exercises game over, replay,
chat, settings, ❓ help and rematch, and reports every JavaScript error. It has already caught three
real bugs: a keyboard handler that crashed on window-level key events, a missing-feature crash that
left half the page unwired, and stale replay captions. jsdom has no WebGL, so Spire Siege and Chess run
their 2D fallbacks there; the 3D views still need a look on a real device. For Air Hockey the test gives
canvases a do-nothing 2D context so the real drawing and pointer code runs.

`python3 tests/doodle_sheet.py out.png [fraction]` rasterises every Doodle Dash drawing onto one PNG
contact sheet (pure Python), optionally only the first fraction of each drawing's strokes, so the art can
be checked without a browser.

## User-interface improvement plan

**Done:**
- ✅ **Simulated-browser test pass** (above). Everything it found is fixed.
- ✅ **Phone-first layout.** The game log folds into a one-line ticker, so controls sit right under the
  board. Player chips scroll sideways instead of wrapping. Boards are capped to the screen height, which
  also covers landscape.
- ✅ **In-app dialogs.** Every `confirm()` / `prompt()` is replaced by a styled dialog (resign, accuse,
  pass, leave, remove player, reset scores, invite link). Escape or tapping outside cancels.
- ✅ **Better game picker.** Games are grouped by category (*Party · Action · Board · Cards · Dice ·
  Words*). Games that don't fit the current player count are dimmed, with a reason ("needs 2+",
  "max 4"). Each game has **How to play** rules in the lobby and a ❓ button during play.
- ✅ Visible keyboard-focus outlines, and `prefers-reduced-motion` is respected automatically.
- ✅ **Graphics pass.** A slowly drifting ambient background, glossy buttons with press feedback, and depth on
  every board (wood frames, glossy discs and checkers, a wood-grain goban, felt and water gradients). Motion
  explains each move: chess and checkers pieces slide from their origin square, Drop Four discs fall and
  bounce, Go stones and tic-tac-toe marks pop in, the new top card is tossed onto the Last Card pile, Sea
  Battle shots splash, and Dots & Boxes lines draw themselves while boxes fill in. A gold glow marks the start
  of your turn, and winning brings confetti and a shimmering banner. The Animations setting and
  `prefers-reduced-motion` turn all of it off.

**Still to do:**
1. **A real-device check of the 3D view and the touch feel**, plus automated screenshots (Playwright on a
   laptop) to catch visual problems that a simulated browser can't see.
2. **A bottom-sheet layout with tabs** (*Actions · Log · Players*) and a sticky action bar for the main
   action, plus undo toasts (Unmask flips, Wordsmith tiles).
3. **More motion.** A "your turn" chime per game, animated captures (pieces fading off the board), and
   cards dealt into hands.
4. **Accessibility.**
   - Player colours that are safe for colour-blind players, with a shape or pattern as well (never
     colour alone).
   - Screen-reader labels on every board square ("e4, white knight").
   - Keyboard play: arrow keys plus Enter.
   - Contrast checks, and text that scales with the browser font size.
5. **Themes.** A light theme that follows the system setting. Board themes (wood, classic,
   high-contrast) and card-back styles, chosen under ⚙️ My settings.
6. **Identity and social.**
   - Avatars generated with the Unmask face generator.
   - A colour picker and rename in the lobby.
   - A QR code for the invite link.
   - Spectator count and "👀 watching" names.
7. **Game-specific polish.**
   - Chess: a move list in standard notation, premoves and an optional chess clock.
   - Go: a territory overlay at the end, and a request-undo button.
   - Wordsmith: drag-and-drop tiles with a live score preview.
   - Sea Battle: drag-to-place ships.
   - Last Card: a fanned, swipeable hand.
   - Unmask: pinch-zoom on the board.
8. **Installable app (PWA).** Home-screen install, full-screen play, and keep the screen awake
    during a game. Cache the app shell so reconnecting is instant.
9. **Rendering performance.** Update the log, chat and player chips in place instead of rebuilding
    them on every update. Send changes rather than the full state for large boards (19×19 Go,
    Wordsmith).

## Roadmap

- **More games:** a drawing-and-guessing game (it fits the reactions feature well), a
  dots-and-boxes variant for up to 6 players, and a co-op deduction puzzle.
- **Meta:** a game-night playlist that rotates games automatically, plus a running
  scoreboard across the evening.
- **Unmask:** Mole mode, Bluff Duel (lie tokens), a Daily Puzzle, and theme packs.
- **Wordsmith:** a live score preview while placing tiles, drag-and-drop, and challenge voting
  as a house-rules dictionary.
- **Night Heist:** character roles (the Insider sees one other player's choice), and a
  heat meter that makes repeat grabbers easier to catch.
- **Infrastructure:** persist rooms across restarts, and host online behind HTTPS.
