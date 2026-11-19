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

**HTTPS** is on by default. The first start makes a self-signed certificate in `data/` (needs
`openssl`; on Termux: `pkg install openssl-tool`), so each browser shows a one-time "not private"
warning: tap *Advanced → Proceed*. To use your own certificate, set `CERT_FILE=… KEY_FILE=…`.
`SSL=0` turns HTTPS off. Old `http://` links from other devices redirect to `https://` on the same
port, and `http://localhost` still works on the server's own device.

**🎨 Graphics** (in ⚙️ settings): *Auto*, *High* or *Low*. The 3D games share one look (filmic tone mapping, a room
for metal and glass to reflect, soft shadows); Low turns the shadows, reflections and extra particles off and drops the
resolution, and Auto does that on its own on a weak phone or once a 3D game has had to slow down. The display face is
Baloo 2 (`static/fonts`, OFL).

**🂠 Playing cards** (`Cards` in `static/kit.js`, used by every card game) are one SVG per card, built once and
cloned: suits are drawn shapes (not font glyphs, so every phone shows the same thing), number cards have real pip
layouts, aces a large pip, and the court cards are original drawn figures, two-ended as on a real deck. One knob,
`--cw` (the card's width), sizes everything; cards 52 px wide or narrower (solitaire columns on a phone, small and tiny
cards) switch by container query to a big rank and suit that stay readable when cards overlap. **Card backs** (in ⚙️
settings) come in midnight blue, ruby, emerald and onyx & gold.

## The games

### 🎉 Party (6)

| Game | Players | What it is | Twist |
|---|---|---|---|
| 🎭 **Unmask** | 1–6 | Ask yes/no questions to find a hidden face. Faces are generated fresh every game: man or woman, hair, eyes (still visible under sunglasses, worn low on the nose), glasses, hats, facial hair, earrings, expression, shirt. | Power cards. In Manhunt, everyone hears your question but only you hear the answer. Knocked-out players become ghosts who see everything. 🃏 **Bluff card** (off by default, duels): your rival's next question about you gets the wrong answer; everyone sees a bluff is waiting, and it's owned up at the end. Faces show ♀/♂ on their names, and zoom steps faces per row. The table hears when someone is down to their last two faces. After the round, review each answer and the faces it ruled out. |
| 🕵️ **Odd One Out** | 3–6 | Everyone gets the same secret word except one player, whose word is similar. Take turns giving one-word clues, then vote. | The odd one **doesn't know they're odd**. Catch them for +2 each; if they escape they get +4. A caught odd one can still guess the real word for +3. 🫥 **Blank** (off by default): the odd one gets no word at all and knows it, so they bluff. A rematch uses word pairs not played tonight. A unanimous vote is called out, and 🐐 an innocent who drew the most votes gets +1 for the trouble. After votes lock, the most-voted player may give one final clue or pass before the reveal. |
| 🖍️ **Scribble Relay** | 3–6 | Everyone writes a phrase, then the chains pass round the table: draw what you're handed, caption the drawing you're handed, and so on. Drawing happens on your own phone (6 ink colours, undo). | You only see the entry right before yours. At the end each chain is revealed card by card and everyone ❤️ votes for their favourite entry. Replay any chain to watch its cards appear again in order. 🎯 A chain that ends where it started earns everyone in it +1. 🎲 **Twist cards** (off by default): every drawing comes with a twist (one continuous line and four strokes are enforced on the pad). A new step arrives with a whoosh, the last five seconds tick, each card in the reveal clicks in, and votes are stamped on the cards. The crowd favourite of each chain is called out, and taking half the table's hearts earns the 🖼️ Masterpiece badge. |
| 🧠 **Trivia Rush** | 1–6 | Quick-fire quiz: everyone gets the same question with four answers and picks at once (273 original questions in 9 topics). | 100 for a right answer plus up to 100 for speed; the last question counts double. Pick one topic or everything. Alone, get 70% right to win. ✂️ **Lifeline** (off by default): one 50:50 each per game takes two wrong answers away, just for you. At the reveal each answer fills with the share of the table that picked it, followed by a one-sentence explanation. Questions asked tonight are kept back on a rematch (until the pool runs low), and each question card takes its topic's colour. 🎲 One surprise **Double question** in the middle of the quiz scores twice, announced as it comes up. |
| ✏️ **Doodle Dash** | 2–6 | The computer draws a picture one line at a time (199 original line drawings in 8 categories) and everyone types guesses at once. Earlier guesses score more. | Letter blanks appear halfway through, then the first letter. A wrong guess locks you out for 3 s. Typos, plurals and synonyms are accepted. Scoring: everyone can score (the first gets +2), or ⚡ first correct only. Strokes reach the browser only as they're drawn, so nobody can peek. Once the picture is finished, up to three more letters show through the last seconds, each a point off a correct guess. **Drawing speed**: 18 s (default), ⚡ 12 s or 🐢 25 s a picture. Wrong guesses drift up over the paper as speech bubbles, and a rival's solve has its own sound. 🔥 Name three pictures in a row and the third pays +1. |
| 🔵 **Bingo Bash** | 2–6 | 75-ball bingo on 1–8 cards each (5×5, FREE centre). A glass ball machine calls a ball every few seconds; tap to daub (or auto-daub). Four styles: 🎉 Bash (every row, column, diagonal and the corners scores, on every card), 🏁 First to Bingo (best of 1/3/5 rounds), 🎯 Pattern hunt (a target shape each round: X, frame, postage stamp, …), 📈 Ladder (one line → two lines → corners → blackout). | Combos ×1.5, first-of-a-kind +150, on-the-ball +50; claims within 2 s of the first share a race win; ✨ golden balls; ⭐ cells give a wild daub, or power-ups (👁️ peek, ✖️2, ❄️ freeze a rival); options for a false-claim penalty, 💤 sleepers, ⚡⚡ 2 s pace. The home screen's 🔵 Bingo tools help with bingo in real life (below) |
| 🎣 **Frozen Pond** | 2–6 | Original ice fishing in 3D (three.js, with a flat top-down fallback). Everyone fishes the same pond at once against the clock (2/3/4 minutes). The loop: drill a hole → drop your line → wait for a nibble → hook and reel when it strikes (a step strip under the pond lights up where you are). Tap the ice to drill a hole (up to 3, two seconds each, any time you haven't a fish on; an auger and a % ring show the progress) and tap a hole of yours to drop the line in. Schools drift under the ice on slow paths: shallow ones show as shadows, deep ones only as bubbles, and pulsing ⛏ sonar pings mark the two best spots to drill over the next few seconds (⛏ Drill here / ⛏ New hole drill at the best one). Your line is a thick yellow line from the rod into the hole and on through the ice (x-ray) to the lure; a ring on the ice shows how far it reaches, and while your line is in, a sonar box shows the lure's depth and the fish nearby (tap it to fold it to a 📡 chip; remembered on the device). Fish inside the ring nibble (a twitch: wait); when it STRIKES (flag up, red button with a draining bar, buzz, "STRIKE! Tap now"), HOOK it within about a second (the big button or Space); then fight it: hold to reel while the fish rests, let go when it lunges or the line snaps, and reel it all the way in. Tension and line meters show the fight. | 🐟 Perch 10, 🐠 trout 25, 🦈 pike 60 (pulls hard, long line), ✨ the golden char 150 (once a pond, it turns up partway through and pulls fiercest). ❄️ Snow squalls hide the shadows and the pings for about ten seconds. A missed bite or a snapped line puts the line back in after a moment. The server runs the pond on its own clock (bites, lunges, snaps, landings); the page works out the fish and the fight from the same numbers. Most points when time runs out wins (ties: the biggest fish, then the most fish). Badges: 🦈 Pike wrangler, ✨ Golden char, 🧺 Full creel. |
| 🁫 **Domino Run** | 2–6 | An original domino-toppling builder on one shared 3D table (three.js, with a flat top-down fallback). Each player has a starter domino on the edge, pointing in. Take turns standing up 3 dominoes: tap a square, tap it again (or ⟳ / R) to turn it 45°, then ✔ Place (arrow keys and Enter work too). The squares each run reaches right now glow in its colour. After the last build turn every starter is pushed at once and the topple plays out. | A falling domino knocks the one in the next square it falls toward unless that one is side-on (so a 45° domino turns the run, and a side-on one stops it). Runs score 🔔 bells 10 and ⛩ gates 20 (a gate only when the run falls through along it) and carry on past them; 🏯 the cup tower pays 50 and ends the run; plus 1 a domino. Runs can merge: whoever's push reaches a domino first owns the rest, so hijack a rival's run or cut it off. 🔥 Combo: each target a run reaches after its first pays +5 more than the last. Each table has a theme (🔔 Bell garden, 🎆 Fireworks night, 🛹 Skate park, ⛩ Temple steps) with ⤴ ramps (5; along it the run leaps the next square) and 🎆 poppers (10; burst and knock dominoes every way but back). Each table: ✂ a split domino (forks the run 45° both ways) and 🏴‍☠️ a pirate domino (put it in a rival's path: their run scores for you too from there on). The topple has a ready-steady lead-in, slow motion at the tower and poppers, a camera that follows your run, floating score pops and a live tally; build-time callouts when someone beats you to a target or reaches the tower. **Tables**: 1 / 2 / 3. **Build turns**: 3 / 4 / 5 each. Badges: 🏯 Tower toppler, 🏴‍☠️ Hijacker, 📏 Long run, 🔥 Combo, 🏴‍☠️ Stowaway. |
| 🦹 **Night Heist** *(the surprise)* | 2–6 | A simultaneous bluffing game. Each night everyone secretly picks **Grab**, **Guard** or **Rest**, then all choices are revealed together. | A lone grabber steals the whole vault. Two grabbers trip the alarm and the loot grows. Guards fine grabbers 💰2 each, and guarding an empty hall costs 💰1. Reading the table is the whole game. Option 🕵️ **Inside man**: once a game, before you choose, learn how many of those who've already chosen are grabbing. ♾️ **Endless** nights (a Nights choice): play on until the host taps 🏁 Cash out (most gold wins). 🤝 **Crews** (off by default): two grabbers split the vault, three or more trip the alarm. 🌕 One night is a **full moon**, announced the night before: twice the loot arrives and guards fine 💰4 (bots guard more). |

**🔵 Bingo tools** (home screen, no room needed, kept on the device and usable offline): 📋 *My paper cards* takes your real cards (typed, or 📷 scanned with the camera: Tesseract.js, vendored in `static/vendor/tesseract`, reads each square and you fix anything red), then you tap or type each number the caller calls; your cards daub themselves, the squares one away shimmer, and a winning card fills the screen. Wins can be any line, two lines, corners, blackout, any hunt shape, or a pattern you draw. 🎙️ *Be the caller* draws fair random balls by tap or every 5–20 s, can say them aloud, has a 📺 big-screen board, and checks a claimed card.

### 🔤 Words & puzzles (8)

| Game | Players | What it is | Twist |
|---|---|---|---|
| 🎡 **Lucky Letters** | 2–6 | Spin a **3D prize wheel** (three.js), call consonants, solve the hidden phrase. 78 original puzzles in 8 categories. | Vowels can only be called by landing on ✨ VOWEL. Special wedges: 💀 Bust, ⛔ Skip, 🎁 Wild (a free letter), 🦊 Steal (take 500 from the leader), and a growing ⚡ Jackpot. The server picks where the wheel stops, and every phone animates the same spin. 🔮 **Mind reader**: solve while half the letters or more are still hidden for +500 and a badge. |
| 🔤 **Wordsmith** | 2–4 | Crossword tile game on an original 11×11 board (80 tiles, ENABLE dictionary). | A **bounty letter** rerolls every turn (+10). Using all 7 tiles is a **clean sweep** (+40). Optional **blank tiles**: 2 that can be any letter and score 0. 🎯 **Comeback bounty** (off by default): the bounty letter scores double for whoever is behind everyone. The word just played glows, a refused play shakes and says why, and the bag running dry gets a callout. 📖 The **word of the game** (the best single play so far) is tracked and called out when it changes hands. |
| 💣 **Word Bomb** | 2–6 | A party word race: the bomb shows 2–3 letters (ING, PL, OUS…) and whoever holds it types a real word containing them, then presses Enter to pass it on. Everyone watches the holder's letters appear as they type. | The **fuse is hidden** and different every bomb: when it runs out in your hands you lose a ♥, and the last player with a heart wins. Words can't repeat in a game. 🔤 Use every letter A–Y (J, Q, X, Z don't count) to win a ♥ back; 📏 a word of 9+ letters adds 2 s to the fuse. Hearts 2–4, fuse short/normal/long, and easy/normal/hard letter chunks. Badges: 😅 close call, 🔤 alphabet, 📏 a 12+ letter word. |
| 🔎 **Grid Hunt** | 2–6 | Timed word hunt: everyone searches the same freshly shaken 4×4 or 5×5 letter grid at once, tracing words through touching tiles. Drag, tap, or type. | When time runs out the lists are compared, and **a word a rival also found scores nothing**. A ⭐ star tile doubles words through it. The grid is reshaken until it holds plenty of words, and the results show the longest ones nobody found. 📅 Today's grids (an option) are the same in every room. ⚡ **Frenzy** (off by default): words found in the last 15 seconds score double. A trail joins the tiles of the word you trace, and ⟳ turns the grid on your screen only. 🧵 The round's longest word that nobody else found (5+ letters) earns +3. |
| 🔍 **Word Search** | 1–6 | The puzzle-page classic: a themed letter grid (Animals, Space, Kitchen, …) with words hidden in straight lines. Drag across a word, or tap its first and last letters. | 🏴 **Grab** (default): one shared grid, and a word goes to whoever circles it first (a point per letter, scored at once). 🏁 **Race**: everyone has their own copy; a point per letter, +10 for finding them all, +5 for first. 8×8, 10×10 or 12×12; words run across and down, add diagonals (default), or any way including backwards. 💡 shows where a word starts for 2 points. Filler letters come from the theme's own words, every word hides exactly once, and grey lines show the missed words afterwards. 📅 Today's grids option. 🧹 badge: grab more than half a shared grid. |
| 🌻 **Word Garden** | 1–6 | The relaxed one: everyone gets the same ring of letters and the same little crossword (the garden). Drag across the letters, tap them, or type, to spell words that fill it in. No clock (unless you pick one) and wrong words cost nothing. | A point per garden letter, +10 for growing the whole garden; any other real word is a bonus word (1 point, 2 for 6+ letters). Start with 3 💧; every 3 bonus words earn another, and a 💧 reveals a letter (which then scores nothing). Finishers keep hunting bonus words while the others finish; 🏳️ Rest stops early. 5, 6 or 7 letters; 1, 3 or 5 gardens; 📅 Today's gardens option. 🌱 badge: a whole garden without a 💧. |
| 🔐 **Safecracker** | 1–6 | Code-breaking: crack a hidden 4- or 5-peg colour code from ● (right spot) and ○ (wrong spot) hints. | **Everyone cracks the same safe at once**: guesses are locked in secretly, then all are revealed, so rivals' clues help you too. Crack it alone for 3, share the crack for 2. A private 🔍 probe per safe counts one colour, for a point. Pegs show numbers as well as colours. 📅 Today's safes (an option): the same codes in every room that day, with a day streak kept on your device. After each reveal, 🔐 a counter shows how many codes still fit every clue, and the history reads like a ledger with the newest round outlined. 🔥 Crack safes alone back to back for +1 each. |
| 🤥 **Fib Finder** | 2–6 | A strange-but-true fact appears with a word missing (118 facts). Everyone writes a believable fake answer, then picks which answer is real. | +3 for finding the truth, +2 for each player your fib fools. Typing the real answer is caught and rejected. House fibs make sure there are always enough answers. The last fact counts double. **Pace**: normal, ⚡ quick (45 s to write, 25 s to pick) or 🐢 relaxed. Each fact comes on a "strange but true" card. ✌️ **Double down** on a pick: +5 if it's the truth, −2 if you were fooled (bots do it too, and the reveal shows who dared). |
| 🧗 **Word Ladder** | 1–6 | Lewis Carroll's public-domain "doublets" as a race: everyone climbs from the same start word to the same goal word, changing one letter per step, every step a real word. | Par is the shortest ladder of everyday words; any dictionary word is allowed in between. ↩ takes a step back for free, 🔎 shows which letter to change next for 1 point, 💡 fills in the next step for 3 points. 3- or 4-letter words. 🏃 **Sprint** (off by default): the first to the top cuts everyone else to 15 seconds. Letters already matching the goal word turn green on every rung, a rejected word shakes, the last ten seconds tick, and badges for ⛳ on par and 🦅 under par. The first to the top and any under-par climb are called out. |

### ⚡ Action (10)

| Game | Players | What it is | Twist |
|---|---|---|---|
| 🗼 **Spire Siege** | 1–6 | **Real-time 3D** (three.js) falling-block battle on a cylindrical tower that wraps around. Pieces are 2-, 3- and 5-block shapes (bevelled, with lit edges), or pick the 🟦 4-block set. ⇄ **Hold** parks a piece for later. Fill a whole ring to clear it. Clearing 2+ rings, or chaining clears, sends junk rings to a random rival. | The tower spins so your piece always faces you. Power cells: ⚡ surge (rivals fall faster), 🛡️ shield (blocks junk), 💣 blast (removes your bottom two rings). Solo survival works with 1 player. A comeback rule: once your tower is two-thirds full, power cells turn up twice as often. Prefer an upright board? 🧱 **Flat well** mode has side walls and a flat view. 👑 **Junk goes to** the leader (off by default): junk from big clears lands on whoever has cleared the most rings, so nobody runs away with it. **Speed-up**: 🌱 Gentle by default (a level every 45 s with a top speed); 📈 Steady is the old faster curve (every 30 s, no limit); ⏸️ Off keeps the start speed. Unlike the other added options, the default here changed (player feedback: it sped up too quickly). The flat well fills a phone's width. ✨ **Perfect clear**: empty your whole tower with one piece and every rival gets 2 junk (and you a badge). |
| 🪂 **Sky Drop** | 2–6 | **Real-time 3D** ring race through a generated sky shaft (Three.js; canvas fallback). Everyone dives the same course, steering in two axes with touch, device tilt, or keyboard. Your diver is the swept wing in your colour with a glowing disc and a YOU tag; rivals are smaller. | Thread rings for points and combos, dodge rotating turbines and storm gates, and ride shifting air streams. Three boosts refill at checkpoints. Finish order adds a bonus, and the seat chips count your points live during a run; choose Cloud Spire, Stormwell or Aurora Shaft, and play 1 or 3 runs. The server simulates movement and scoring for every player. |
| 💎 **Prism Pop** | 1–6 | An original **match-3 race**: everyone plays their own 8×8 gem board at the same time, with no turns. Swap two neighbouring gems to line up 3+ of a kind. 4 in a row makes a ⚡ beam (clears a row or column), an L or T a 💥 nova (clears the 3×3), 5 in a row a 🌈 prism (swap it with a gem to clear that colour). Swapping two specials combines them. | Cascades raise the multiplier (×2, ×3…). Big plays send 🧊 **frost** (frozen gems can't move) and 🪨 **stones** to a rival; a match next to them breaks them. Highest score when the clock runs out (60 s, 90 s or 2 min) wins. Options: attacks off, attacks aimed at the leader, 5 gem colours for more cascades. Drawn on a 2D canvas: gems burst into shards and sparks, beams sweep, novas send shockwaves, prisms throw rainbow arcs. A change of leader mid-race is called out. |
| 🌀 **Marble Rush** | 1–6 | An original **tilt-maze race** in 3D: everyone gets their own copy of the same maze board at the same time and tilts it to roll a marble from the 🟢 start pad to the 🏁 goal cup. Drag anywhere on the board (a virtual stick), tip your phone (📱 Use tilt), or use arrows/WASD. | 🕳️ Holes sit in the outer corner of turns and catch a marble that comes in too fast (back to your last 🚩 flag). 💎 Gems off the quick route take 1 s off your time, but only once you carry them past a 🚩 flag or the goal (fall first and they roll back); ⏩ pads shove you along. Most boards fork: a 🔥 shortcut lined with holes, or a longer 🌿 way round with a pad and a gem. Between boards everyone picks a perk for the next one (⚡ Turbo, a shove when you tap; 🛡️ Shield, your first fall doesn't count; 🧲 Magnet, gems from a cell away), and whoever is last picks two. Rivals show as ghost marbles. Lowest total time over 1, 3 or 5 boards wins; a board you don't finish counts as its full time limit. Options: maze size, hazards, time per board. The marble rolls in your browser (120 Hz physics); the server checks finish times against the marble's top speed. |
| 🏍️ **Light Riders** | 2–6 | **Real-time** light-cycle duels in a **3D neon arena** (three.js; flat fallback). Your bike never stops and leaves a wall of light behind it. Crash into any wall and you're out; the last rider standing wins the round. | ⚡ 3 boosts per round (double speed). Swipe, D-pad or keyboard. Quick double turns are queued, so you can whip round a corner. Medium, small or large arena; chill, normal or fast speed. 🧱 **Closing arena** (off by default): after a minute of riding, the walls close in a band at a time (they glow red and move inward), and bots keep clear. ✂️ A crash into someone's trail credits them, called out on every screen. |
| 🐭 **Whisker Run** | 2–6 | **Real-time** maze chase, mice against cats, in a fresh symmetric maze every round, sized to the number of mice (21×19 for one, up to 29×23 for four) and themed in turn: 🌿 Hedge Garden, 🫙 Pantry (long shelves) and 🕯️ Cellar (deep shafts, more holes). 🐭 Mice nibble crumbs (+1); 🐱 cats hunt them, and a catch snatches half of what that mouse nibbled this round. Roles rotate so everyone hunts equally often (1 cat up to 3 players, 2 from 4). | 🔔 Bells make every cat panic for 6 s: bump one then (+20) to send it to its basket. Cats run as fast as mice, but each crumb costs a mouse a moment, so cats catch you while you eat. Three lives per mouse per round; a tunnel wraps side to side. 🕳️ Mouse holes in the walls let mice through but not cats (squeezing in costs a mouse a moment), and a cat at either end can reach in with a paw. When two or more cats face more mice, the cats run 3% faster per extra mouse. 🐈‍⬛ Alley cats (auto: one when mice outnumber cats) hunt for nobody. Swipe, tap toward a spot, arrow pad or keys; turns are held until the corner comes. |
| 🎨 **Paint Blast** | 2–6 | **Real-time** bomb maze: run through pillars and crates and drop bombs whose blasts run in a straight line in all four directions. Crates hide 💣 extra bombs, 🔥 longer blasts and 🖌️ paint splashes. | **Every blast paints the floor in your colour**, and when the clock stops each painted tile is a point (+10 for catching a rival). Caught players are stunned for 3 s and respawn at home, so nobody sits out. The maze is mirror-symmetric and new every round. Swipe-and-hold to run, tap to bomb. ⭐ **Gold tiles** (off by default): a few floor tiles are worth 3 each. Paint lands as splats with drops, bombs light the floor as their fuse runs down, and getting splatted yourself has its own sound and buzz. 💥 **Double splat**: two rivals caught by one blast pays +10 more. |
| 🪐 **Sumo Saucers** | 2–6 | **Real-time 3D** (three.js; flat fallback): pilot a hover saucer on a floating platform and shove rivals off the edge. Drag anywhere for a virtual stick, tap to 💨 dash. | Glowing rim bumpers bounce you back once, then shatter, and the platform shrinks every 15 s (the rim glows red first); after 75 s it's 💀 sudden death. Power-up orbs: 🪨 heavy, ⚡ shockwave, 🔁 quick dashes, 🛡️ a save at the edge. Knocked out? Your 👻 ghost drops ☄️ meteors on the rest. Last saucer floating wins the round; first to 3 wins. A 👑 floats over whoever leads on rounds won, and the arena sizes itself to the screen. 💥 Two knockouts in one round is a **Double KO** badge. |
| ⛳ **Putt Party** | 1–6 | **3D** mini golf (three.js; top-down fallback) on holes generated each game: a winding walled fairway with ⚪ bumpers, ▪️ posts, 🌑 rocks, 🟫 sand, long grass, ↗ slopes, ⛰️ humps and bowls, curved banks, a 🌀 windmill to time, a ramp jump and 💧 water. Drag back from your ball and let go to putt; a drag anywhere else moves the view, and the camera swings behind your ball after each putt. | The server simulates every putt and sends the ball's path, so every phone plays back the same shot. Everyone plays the same hole, a stroke each in turn. Solo: finish at or under par (3 a hole, 4 for a hole with a jump or a windmill). **Stroke limit** 8 (default), 6, 10 or ∞: with no limit, ⛳ Pick up ends your hole at strokes +1 (a lost ball still stops at 20). **Course**: Classic (default), 🎲 Surprise each hole, 🌊 Water hazards, 🌀 Obstacle alley or ⛰️ Hills and bowls. Each hole has its own sky and scenery (day, sunset, night with lanterns, autumn). Holes in one, eagles, birdies and snowmen are called out. |
| 🛸 **Hover Rally** | 1–6 | **Real-time 3D** hover-craft race (three.js chase camera; top-down fallback) on a looping track generated each game. The throttle is automatic: hold a side of the screen (or ←/→) to steer; the further out you hold, the harder you turn. | Bends push you outward and the inside line is shorter, so racing lines matter; walls scrub speed. ⚡ Boost pads plus 3 boosts of your own, a 🚀 start boost for pressing boost just before GO (too early stalls), a 💨 slipstream behind rivals, 🎁 item pickups: 🚀 homing missiles, 💣 mines and 🛡️ shields, leaders getting more mines and shields and the pack more missiles (a hit spins you out; setting to turn items off), sideways bumps. 🚧 Track features: ❄️ ice, narrows, and ramps over a gap (too slow and you fall short). 💥 Elimination mode: last place is out every lap. 📅 Today's track: the same track in every room for the day, with a best-lap board, and your best lap of the day races you as a 👻 ghost. Alone: beat a target time. **Class**: 150cc (default), 100cc (gentler) or 200cc (fast!). The last lap gets a 🏁 callout, and gaining or losing a place flashes ▲ or ▼. ⏱ The race's fastest lap is called out as it changes hands. |
| 💥 **Cannon Hills** | 2–6 | An original artillery duel on a side-on range of hills generated each round (2D canvas). Take turns to set an angle and a power (drag back on the range like a slingshot, or ◀ ▶ − +), pick a shell and fire over the hills. | The wind changes every turn (the clouds drift and the grass leans with it), and your last shot's path stays as a dashed line so you can correct. Blasts throw clods and smoke. Blasts blow craters and hurt every cannon nearby (yours too); a cannon whose ground is blown away drops (a long drop hurts) and the sea knocks it out. Shells: 🔵 plain, 💥 Big Bang, ✨ Splitter (three bomblets at the top of its arc) and 🪨 Dirt Bomb (builds a wall). Last cannon standing takes the round; most rounds wins (1, 3 or 5). **Wind**: 🍃 light (default), 🌪️ wild or off. **Terrain**: 🎲 rolling hills, ⛰️ mountains or 🏝️ islands. ⚡ **All at once** (off by default): everyone aims in secret and all the shells fly together. Badges: 🎯 Direct hit, 🪃 Comeback. Direct hits, double hits and shelling yourself are called out. |
| 🥌 **Ice Stones** | 2–6 | An original curling-style game in 3D (three.js, with a flat top-down fallback). Take turns sliding granite stones down the ice: set the 🧹 broom (tap the ice, drag sideways to nudge it, or ◀ ▶), the weight (coloured zones under the slider: guard, draw, hit, peel, with where it would stop) and ↺ / ↻ curl, with the path drawn to the hog line, then throw. The stone slides **live**: hold the 🧹 pad (or the ice) to sweep it, scrub fast to sweep hard, and it runs further and straighter; a ring on the ice shows where it will stop, and the brooms scrub, kick up frost and leave brushed streaks. The glide slows evenly and curls more as it slows (about a metre on a draw). | Real curling's count: after every stone of an end, only the player with the stone nearest the button scores, one point for each of their stones in the house closer than anyone else's best. A gold measuring ring and numbered stones show who's lying how many as you go, and each end's result is explained with a per-end scoreboard. 🔥 One stone each end is hot and scores double. A stone short of the hog line comes off; stones over the boards or the back line are out. The hammer moves round the table; a tie after the last end plays up to two ⚖️ extra ends. **Ends**: 2, 4 (default), 6 or 8. **Ice**: ❄️ keen, 🌀 swingy (more curl) or 🧊 heavy. Badges: 🎯 On the button, 💥 Double takeout. |
| 🎯 **Wind Archery** | 2–6 | An original archery game in 3D (three.js, with a flat target-face fallback). One arrow a turn at the same target in the same wind: drag to move the sight (it moves like a trackpad), hold to draw and let go to loose, or nudge with ◀ ▲ ▼ ▶ and tap 🏹 Loose. The sight sways more the longer you hold. The camera follows the arrow down the range and closes in on the hit; big shots (✖, a prize, a flaming gold, a split) play in slow motion with a crowd cheer. | The wind carries an arrow by more the further the target: 30 m, 50 m, then 70 m. The flag and the km/h readout are a guide; the real wind runs a little stronger or weaker for the whole end, and every arrow meets its own gust, so each shot shows where it was aimed and you learn the wind from every arrow, rivals' too. Rings score 10 to 1. Each end is a different course: 🍎 an apple end (first arrow through the apple +5), 🎈 a balloon end (four balloons round the face, +3 each, a gold one right on the edge +6), then a 🪝 swinging target that hangs from a frame and swings side to side, so you lead it. 🔥 Once an end each archer may loose a fire arrow: the gold (9 or 10) scores double, anything else scores nothing. ✨ From the third gold in a row on, every gold is +1. 🧘 Once a game a steady breath removes the sway and the gust. A tie on points goes to a one-arrow 🏹 shoot-off at 70 m, closest to the middle wins. **Ends**: 2, 3 (default) or 5. **Wind**: 🍃 breezy, 🌬 gusty or 🪶 calm. Badges: 🎯 Dead centre, 🍎 Apple shot, 🏹 Split the arrow, 🔥 Gold on fire, ✨ Golden streak. |
| ☄️ **Meteor Shot** | 1–6 | Arc a comet through a floating ring in 3D (three.js, with a flat fallback). Set the angle (how high), power (how far) and aim (left/right) and fire; wind pushes the comet sideways the longer it flies. Everyone fires once a round, then the ring and the wind move. Closer is better (100 dead centre); 3 or 5 shots each, highest total wins. |
| 🎳 **Lane Night** | 1–6 | Tenpin bowling in 3D (three.js, with a flat top-down fallback), everyone on their own lane at once with rivals' lanes either side. Set where you stand (◀ ▶) and the hook, then drag back anywhere on the lane and let go: sideways sets the line, further back is faster. | The ball skids through the oil, then hooks; the server rolls it into the pins (falling pins knock others) and every phone plays it back, with STRIKE! / SPARE! calls. Standard scoring with bonus balls in the last frame. 🌟 One cosmic frame (black light) gives a strike or spare +10. 🎯 Once a game, the spare saver drops a lone pin left by a spare ball. Nobody gets more than two frames ahead of the slowest bowler. **Frames**: 10 or 5. **Oil**: medium, dry (big hook) or slick. Badges: 🦃 Turkey, 🪓 Split converted. |
| 🧱 **Wobble Tower** | 2–6 | An original block-stacking game in 3D (three.js, with a flat top-down fallback). Take turns setting odd blocks (cube, plank, slab, beam, pillar, ell, roof) on one shared tower on a 4×4 plinth: drag the see-through ghost (or ◀ ▶ ▲ ▼), ⟳ turn it, then 🧱 Place, and it drops onto whatever is highest under it. 🎁 Then pick which of the next three blocks the next player must set. | The server checks the tower with a small statics model: every block's load (its own weight plus everything resting on it) must sit over what holds it up. A roof carries only along its ridge. The 📏 wobble meter runs the same check on your ghost before you place, and the tower sways more the closer it is to going over. Topple it and you lose a ❤️ (the whole thing comes down over the edge that gave, and a new tower starts). Hands slip more the higher you build (a ring shows how far), and 🌬 gusts lean on the tower every fourth turn (forecast a turn ahead). The last builder standing wins; ⭐ a block that makes the tower its tallest yet earns a star (ties go to stars). **Mode**: 🧱 Build (above) or 🪵 **Pull & Stack** (#190): the tower starts built, 12 layers of three planks, each layer crossed over the one below. On your turn tap a plank to feel it (it jiggles; the chip says 🟢 loose, 🟡 snug or 🔴 tight, the risk, and 💥 if it's the plank holding its layer up), drag it out along its length (or ◀ ▶ and 🪵 Pull), then tap a glowing spot on top (or Edge / Middle / Edge). Not from the top layer, nor the one under it while the top isn't finished; a new layer starts only once the top one is full. Every pull leans the tower a little the way you pull it, much more for a tight plank (it's held by the weight on it), and the lean adds up: the server checks the tower sheared by its lean, so a layer thinned to its middle plank gives way once the tower leans far enough. Pull toward the high side to straighten it. Topple it and lose a ❤️ (it comes down in slow motion and a fresh tower is built); ⭐ for every tight plank you get out. Bots pick the plank with the least chance of a topple (easy goes by feel). Works in the flat view too (drawn from the side at a slant). **Lives**: 2, 1 or 3. **Gusts** and **Blocks** (Build only): on or off; mixed or boxes only. Badges: 🤲 Steady hands, 🏙️ Skyscraper. |
| ❄️ **Snowball Scramble** | 2–6 | A real-time 3D snowball fight (three.js, with a flat top-down fallback) in a walled snowfield with snow forts. Drag anywhere to run (or WASD / arrows); tap ❄️ (or Space) to lob a snowball at the nearest rival, the one you're facing first; hold it to pack a big one (two hits, wider splash; you move slowly while packing). You carry 3 and scoop more as you go. | Snowballs land where the target stood when thrown, and a shadow shows where (red when it's coming for you), so keep moving. Forts take the hit for whoever shelters close behind them, crumble after enough hits and grow back. Three hits snow you in for 3 s, and the thrower scores a point. ⛄ Run through a patch of fresh snow to roll a giant; ram a rival with it to knock them flat (two hits' worth). 🗺️ Each game is on a field of its own (🏰 Fort Meadow, 🏘️ Snow Village, or ⛸️ Frozen Pond, where you slide on the ice). 🎁 Gifts drop every 10 s: walk over one to carry it and spend it with ✨ (or E; the button names the gift and its effect, and a ring on the field shows where it will go): 🧊 ice ball (flies fast, two hits and a chill that slows), ☃️ decoy (a snowman rivals' auto-aim goes for; it soaks two throws), 💦 slush bomb (a puddle that bogs rivals down for 7 s). 👑 At half time a crown lands on a hill (a gold ring with a beacon): stand in it with more kids than any rival side (you alone, or your team) until the ring fills (5 s) to win it for +2 (the holder nearest the middle wears it and scores). Then it flies to a new hill elsewhere on the field, shown 4 s ahead with a pulsing ring and countdown, so everyone regroups; nobody near it for 20 s and it moves on by itself. Holding it is risky: each hit on a holder inside knocks the ring back by 15 %, and being snowed in on the hill loses half the ring. Level at the top, the side that held it keeps filling at half speed (⚔️) until outnumbered or snowed out, and a side pushed off keeps its count for a while. 🔥 Three snow-ins without being snowed in is a streak; whoever ends one scores +1. Most points when the clock runs out wins. The server runs the field 30 times a second. **Length**: 2 min, 90 s or 3 min. **Giants**: on/off. **Field**: a different one each game, or pick one. **Gifts, crown & streaks**: on/off (off = the classic game). Badges: 🏔️ Avalanche, 🧊 Untouchable, 👑 King of the Hill, 🧯 Shutdown, ☃️ Snow Double. |
| 🚣 **Paper Boat Rapids** | 2–6 | A real-time 3D river race in folded paper boats (three.js, with a flat top-down fallback). Everyone races the same seeded river at once: drag sideways (or ←/→ / A/D) to steer across it while the current carries you; tap 🛶 (or Space) to paddle (3 charges that refill), hold it (or ↓) to brace. Stretches of calm water with a faster lane, rocks, whirlpools, white-water rapids, small waterfalls with gaps, and sunny pools. | Paper gets **soggy**: rocks, waterfall splashes, white water and bumping boats soak it, and a soggy boat is slower and turns worse. At 100 % it sinks and you refold at the start of the stretch, 30 % damp. ☀️ Sun patches and dry folds dry you out; 🍃 leaf sails give a burst of speed. Bracing halves the soak in white water but slows you. At a waterfall the middle gap is safe; the edge gaps are faster but drench you. Finishing order scores 10/7/5/3/2/1; the race ends 20 s after the winner. The server runs the river 30 times a second. **River**: short / medium / long (~1–2 min). **Races**: 1 or 3. **Leaves**: on/off. Badges: 🌊 White-water ace, 🧻 Soggy survivor. |
| 🎪 **Midway Night** | 2–6 | An original carnival night in 3D (three.js, with a flat face-on fallback). Each round is one booth that everyone plays at the same time, each in their own copy with the same layout, against a throw clock (30/45/60 s). Swipe up anywhere on the booth to throw: sideways aims, a longer swipe goes further (or higher); or use ◀ ▶ ▲ ▼ and 🎯 Throw (arrow keys and Space). A dotted arc shows where it will land. The side panel races everyone's tickets; tap a name to watch their booth once you're out of throws. | 🎳 **Skee Roll** (9 balls): rings pay 10–50 and the two corner cups 100; a weak roll falls short. ⭕ **Ring Toss** (8 rings): a 5×5 grid of bottles, green 30, blue 50, red 80 (back rows pay more); a near miss can clip a rim and hop on once. 🥫 **Can Slam** (6 balls): 10 a can, and a can falls when a can it stands on falls; clearing the stack pays +50 and restacks it. 🔔 Each booth hides a gold jackpot (a cup, a bottle or a can) that pays the first to hit it +100. 🔥 After three good throws in a row every good throw pays double until a miss. The server works out every landing; phones play it out. Most tickets wins; ties go to the most jackpots. **Booths**: 3 (one of each) or 6 (each twice). **Throw clock**: 30 / 45 / 60 s. Badges: 🔔 Jackpot, 🥫 Clean sweep, 🔥 Hot hand. |
| ✈️ **Paper Planes** | 2–6 | An original paper-plane contest in a 3D park (three.js, with a flat top-down fallback). Each round is one challenge and everyone throws at the same time, two planes each; the better plane counts. Pick a fold, then swipe up on the park: sideways aims, a longer swipe throws harder; ▲ ▼ set the loft. Or ◀ ▶, − +, ✈️ Throw (arrow keys, W/S for loft, 1/2/3 for the fold, Space). A dotted line shows the first moment of the flight. | Folds: 🎯 **Dart** (fast and straight, the wind barely moves it), 🕊 **Glider** (floats furthest and longest, but the wind pushes it), 🌀 **Stunt** (loops when thrown hard and high, curls to the right). Challenges: 📏 longest throw (a point a metre), ⭕ through the hoop (60, a little for a near miss), 🎯 the picnic blanket (50/35/20/10), 💫 three rings (20 each, +20 for all), ⏱ longest flight (10 a second). The windsock shows the round's wind; every throw meets its own small gust. 🔥 Warm air over the grills lifts a plane that crosses it. 📎 Once a game, a paperclip makes one throw fly true (no wobble, no gust). The server flies every plane and the browsers play the path back. **Rounds**: 3 / 5 / 8. **Wind**: calm / breezy / gusty. Badges: ⭕ Threaded, 💫 Ring run, 🧺 Picnic bullseye. |
| 🪐 **Orbit Golf** | 2–6 | Original space mini-golf in 3D (three.js, with a flat top-down fallback). Take turns launching your probe at a glowing cup: drag back anywhere on the course like a slingshot (the pull sets the direction and power) and let go, or use ◀ ▶ − + and 🚀 Launch (arrow keys, Shift for fine steps, Space). A dotted line shows how the probe sets off. A grid of space-time dips into every gravity well. | Planets pull probes into curves, so the way in is often round a planet or a slingshot past one. Space has a little drag: probes slow down and rest in open space or on a planet's surface, and you play on from there. Arrive slowly to drop in; too fast and it lips out. 🕳 A black hole swallows a probe and drifting off the course loses it: +1 stroke, back where you hit from. ☄️ Asteroid belts bounce probes; 🌀 a wormhole sends them out of its twin. Holes: 🌗 Twin Moons, 🪐 The Slingshot, ☄️ Asteroid Alley (par 4), 🕳 Event Horizon, 🌀 Wormhole Way (par 3). Whoever is furthest from the cup goes next; 8 strokes at most on a hole. Fewest strokes wins. The server simulates every shot; phones play it back. **Holes**: 3 / 5 / 9. Badges: 🌟 Hole in one, 🪐 Slingshot, 🌀 Through the wormhole. |
| ⛵ **Regatta** | 2–6 | An original real-time sailing race in 3D (three.js, with a flat north-up fallback). Everyone races the same buoys at once from a chase view with a minimap. Drag sideways on the lake (or ← → / A D, or hold ◀ ▶) to steer; ⟲ Tack (Space / T) turns you through the wind. | Boats are fastest across the wind, a little slower with it behind, and stall "in irons" within about 40° of it, so the first buoy (upwind) means zig-zagging; each tack costs some speed. Round each buoy in order (pass close by: the glowing one is next), then cross the finish line between the flags. The wind shifts every 15–25 s; on 🌬 shifty days dark gust patches (+30 % wind) drift down the lake. Sitting just downwind of a rival's sail (their wind shadow) costs a quarter of your speed. Finishing order scores 10/7/5/3/2/1; the race ends 20 s after the winner. 🏴‍☠️ **Pirates** (default on): the boats are pirate sloops; 💥 Fire (F) shoots a broadside at the nearest rival abeam (within 50° of either beam, 32 m, red ring); the ball leads the target and lands ~1 s later, so a sharp turn can dodge it. A hit halves the target's speed, luffs its sails for 2 s and slews it off course, then gives 5 s of cover. Up to 3 balls, one reloads every 10 s (the leader slower, boats behind faster); floating 🛢 powder kegs give one more; the pirate ship Black Jack patrols one side of the first leg firing at anyone within 28 m (hit it to silence it for 15 s and plunder a ball). The water is a wave shader (swell the boats ride, fresnel sky, sun glint, crest foam, foam wakes; flat and cheaper on 🔋 Low graphics). The server sails the lake 30 times a second. **Course**: 2 / 3 / 4 buoys (~75 s / 90 s / 2 min). **Races**: 1 or 3. **Wind**: steady or shifty & gusty. **Pirates**: on / off. Badges: 🏁 Wire to wire, 🌬 Wind thief, 💨 Gust rider, 💥 Master gunner. |
| 🌀 **Spin Tops** | 2–6 | An original real-time spinning-top battle in a wooden 3D bowl (three.js, with a flat top-down fallback). Pick a top between rounds (⚖️ Balanced, ⚔️ Attack, 🛡️ Defense, 🌀 Stamina), then each round opens with a launch: tap 🚀 while the swinging meter is high for more spin. Drag anywhere to steer (or WASD / arrows), tap 💨 (or Space) to dash, and 🌀 Rev (or R) when its meter is full. | The bowl pulls everything toward the middle. Tops bounce apart when they meet; each one's spin flings the other, the slower spinner loses more spin, and the top charging in hits harder and loses less. A hit within half a second of your dash is a 💥 **smash** (harder shove, you lose less spin; a smash ring-out scores 2). Tops: ⚔️ Attack hits hardest but spins down fast, 🛡️ Defense is heavy and hard to shift, 🌀 Stamina spins longest and steers well. 🌀 Rev adds up to +0.14 spin when timed at the top of its meter (a bad one costs a little), every 7 s. Out of spin you topple; knocked over the rim you're out (the last top to hit you scores 1). Pickups: ⚡ spin, ⚓ heavy (6 s), 💨 turbo (faster, dash ready). Arenas change every round after the first: 🥣 classic, 🔵 bumpers (posts that fling you back), 🔥 closing ring (outside it the rim drains spin), ❄️ ice (slippery); after 28 s the rim heats up in every arena. The final duel is called, and the knockout that decides a round plays in slow motion with the camera swooping in. Last top spinning scores 3, the runner-up 1. Callouts for two ring-outs in a round, clearing the bowl, three wins in a row and a win on a wobble. The server runs the bowl 30 times a second. **Rounds**: 5 / 3 / 7. **Arenas**: a new one each round / classic only. **⚡ Pickups**: on / off. Badges: 💎 Flawless, 🧹 Sweeper, 💥 Smasher, 😅 Wobble win, 🔥 On fire. |
| 🚀 **Moon Lander** | 1–6 | An original lunar-landing contest in 3D (three.js, with a flat side-view fallback); everyone flies at once over the same moon, with rivals shown as ghost landers and a strip map of the whole moon. Hold 🔥 (or ↑ / W / Space) to burn, ◀ ▶ (or ← → / A D) to lean. | Each round has three pads: a wide ×1, a ×2 and a narrow ×3 up on a mesa. Touch down under 2.5 m/s down, 1.5 m/s sideways and 11° of tilt (the gauges turn green) or it's a crash. A landing scores the pad's multiplier × (50 + up to 30 for softness + up to 20 for landing near the middle). Fuel carries over: the tank is only topped up (+14 s, at most 36 s) each round. Your browser flies the lander on a fixed 30 Hz tick and sends its input log on touchdown; the server replays it with the same arithmetic and its verdict counts. **Rounds**: 5 / 3 / 7. Badges: 🪶 Feather, 🎯 Bullseye. |
| 🪙 **Coin Cascade** | 2–6 | An original coin-pusher game on one shared 3D arcade machine (three.js, with a flat top-down fallback), taking turns. Drag across the machine (or the slider, or ← →) to move the chute; tap 🪙 Drop (or Space). | Each player owns a stretch of the front edge: coins pushed over it fall into their tray (1 point, 3 for a ⭐ prize token). A turn drops a handful of three coins a moment apart; dropped while the shelf is pulled back they land deep and get the full shove. Coins pushed off the open sides near the front are lost. Land on a 🔔 bell for 🧱 side guards (3 drops), a 🫨 shake (an extra stroke) or a 🪙 mega coin in your next handful. A new ⭐ drops in at the back every 3 turns. The server simulates each drop and streams the motion once; between turns the shelf keeps stroking but never past the pile. **Turns each**: 10 / 6 / 14. Badges: 🎰 Jackpot, ⭐ Collector. |
| 🏖️ **Tide Castles** | 1–6 | An original sand-castle game in 3D (three.js, with a flat top-down fallback) on a sunny golden-hour beach; everyone builds on their own beach at once (tap a tool, then squares: a ghost shows where it goes, pieces pop in with a thud and a puff of sand; tap what you built this tide to take it back; ✅ when you're done), then the same waves roll up every beach. 👀 All shows every beach. | Three tides of five waves that swell to the big one; the forecast shows while you build, and each tide has a 🎯 goal (3 towers standing, a rampart of 4, a dry keep, 2 shells, 2 flags, moats soaking 3 waves) worth 8. A bucket of sand per tide: 🧱 wall 1, 🗼 tower 2 (or 1 more on a wall, up to 4), 🕳️ moat 1, 🐚 shell 1, 🚩 flag 1 (on a tower 2+); the 🏰 keep sits in the back row and moves once a tide. A wave loses a force a square and flows round things; it stops at walls and towers but wears them a level when it hits 4 harder than they're tall. Three or more walls/towers side by side are a braced 🧱 rampart (5 harder), three moats a channel (soaks two waves; a lone moat one). Water on the keep knocks a third of its force off its 10 strength. Each wave the keep stands scores 6, its strength left, each shell and flag left 3, each piece still standing 1 (2 in a rampart): the tally counts up over your beach. What's left stands for the next tide (survivors wear seaweed); a tie goes to the tallest castle. **Sand per tide**: 12 / 9 / 16. **Build time**: 45 / 60 / 30 s. Badges: 🏰 Fortress, 🐚 Beachcomber, 🚩 Standard Bearer. |
| 🏒 **Air Hockey** | 2 | **Real-time** table hockey: drag your mallet around your half, bank shots off the walls. Server-side physics at 60 fps. | 🏒🏒 Double Trouble puts two pucks on the table. Each player sees the table from their own end. 🔥 At match point the puck gets faster and slows down less. 🥅 **Leader's goal widens** (off by default): each goal of lead widens your goal by 15% (up to 50%). Real puck and rail sounds, a cheer or a groan on a goal (a ring and sparks burst from the goal mouth), and the new score slams onto the board. 🎩 Three goals in a row is a **hat-trick** badge; goals off the wall are bank shots. |
| 🎱 **Billiards** | 2 | Eight-ball pool on a top-down table with real physics (spin that skids then rolls, follow, draw and english, cushions, throw, six pockets with jaws). Drag to aim, set the power, shoot. | The server simulates every shot and sends the ball paths, so every phone plays back the same shot. A 🎯 aim guide (full, light, short or off) shows where both balls go, its line thin and green for a soft touch and thick and red for a break; light shows just the ghost ball and a hint of the angle. Fouls give ✋ ball in hand. 🏁 Play one rack or a race to 2, 3 or 5. The table stands upright on phones. Two or more balls in one shot is called out. |

### ♟️ Strategy (6)

| Game | Players | What it is | Twist |
|---|---|---|---|
| ♟️ **Chess** | 2 | Full rules: castling, en passant, promotion, check/mate, stalemate, 50-move rule, threefold repetition, insufficient material. Draw offers and resignation. Optional ⏱️ clock: 3+2, 5+0 or 10+5. | Move generation is checked against standard perft counts. Black sees the board from their side. 🧊 **3D board** (three.js) by default: tap a piece, then its square; drag sideways to turn the board. The flat board is one tap away and is used automatically without WebGL. 👑 **King of the Hill** (a Variant choice): a king that reaches d4, e4, d5 or e5 wins at once (the centre glows on the flat board, and bots go for it). ↶ Undo in untimed games. A wooden frame round the flat board, and callouts for castling and promotion. 🤫 Capturing en passant earns the Sneaky badge; taking the queen is called out. |
| ⛀ **Checkers** | 2 | American rules: compulsory captures, multi-jumps in one move, kings, and a 40-move no-progress draw. | Legal pieces and landing squares are highlighted. Optional 🦅 flying kings glide any distance and jump from afar. 🤝 Draw offers and ↶ undo requests. 🎁 **Giveaway** (a To-win choice): the first side with no pieces or no move left wins, and the bots play to lose. Rank and file labels, a material bar, and a tap on a piece that can't move during a forced capture says why. Crowning and double or triple jumps are called out. |
| 🔺 **Backgammon** | 2 | The traditional race game, full rules: opening roll, doubles move four times, hits and the bar, bearing off (higher dice only for the farthest checker), and the must-use-both-dice / use-the-larger-die rules. | The board is drawn from your side, so your home is bottom right in either colour. Tap a checker, then a glowing point; undo until you end your turn. Gammons (2) and backgammons (3); one game or a match to 3 or 5. Optional 🎲 doubling cube. ⚡ **Hypergammon** (a Checkers choice): three checkers each, for quick games. The doubling cube sits on the bar (on its owner's side), a checker with one place to go moves on the first tap, and hits, gammons and backgammons get callouts. Hitting two in one turn and closing your board are called out. |
| ⚫ **Go** | 2 | 9×9, 13×13 or 19×19. Tromp–Taylor area scoring, positional superko, no suicide, 6.5 komi. | A live "score if it ended now" readout. Komi of 6.5, 7.5, 5.5 or 0.5, and 2–9 handicap stones on the star points (you take Black against a bot). Captured stones fly into each player's bowl of prisoners. ⚔️ **Atari Go** (a Rules choice, for learning): the first capture wins. Coordinates round the edge, a thick wooden border, and on a 13×13 or 19×19 board on a touch screen the first tap shows a ghost stone and a second tap places it. Capturing four or more stones is called out. |
| 🌰 **Oware** | 2 | The traditional mancala game (abapa rules): sow seeds counter-clockwise, capture rival pits you leave at 2 or 3, chaining backwards. 25 seeds wins. | The grand-slam rule, the must-feed rule, and an endless-circling stop. Captured pits flash and the last pit sown is ringed. ↶ Undo requests. **Seeds per pit**: 4 (classic), 3 (quick) or 5 (long); more than half the seeds in play wins. Captured seeds pile up in the stores, every sown seed clicks, a big harvest gets a callout, and you're told when you must feed your rival. A harvest of 6+ and the clinching capture are called out. |
| ⚪ **Reversi** | 2 | The 19th-century public-domain disc-flipping game on 8×8: trap a line of rival discs to flip them. Passes when you can't move. | Legal squares glow, and flipped discs spin over. Optional flip hints show how many discs each square would flip. ↶ Undo requests. ⬛ **Blocked squares** (a Board choice): four squares, placed symmetrically, that nobody can play on and that stop a line of flips. Corners are outlined and the squares that give them away marked ×; a corner taken flashes gold, and a pass gets a callout. Flipping 8+ and taking a corner are called out. |
| 🦋 **Kindred** | 2 | An original piece-giving game on 4×4 (our take on the "your rival picks your piece" idea, asked for as Quarto in feedback #96). 16 pieces, each a mix of four traits: ☀️/🌙, ●/■, big/small, ✦/plain. Place the piece you were handed, then hand your rival one. | Filling a line scores it trait by trait: four alike 2 points, three alike 1, a 2–2 split 0 (up to 8 a line). The board always fills; highest total wins. Each empty square shows what your piece would score there, and each piece you could hand over shows the most your rival could score with it. Options: 1, 2 or 4 boards (who gives first alternates); ➕ 2×2 kin squares score too. |
| ⚔️ **Realm Wars** | 2–6 | An original conquest game on made-up archipelagos: **Six Isles** (30 lands) or the **Grand Archipelago** (44 lands, 8 islands), with coast roads and dashed sea lanes. Draft troops (lands ÷ 3, at least 3, plus island bonuses), attack neighbours with up to 3 dice against 2 (defender wins ties), move in, then make one fortifying move. Taking a land earns a banner; three alike or one of each (⭐ wild) trade for a growing bonus. | **Goal:** 🏁 Dominion (default: start your turn holding ⅔ of the map and you win, so the others get one round, under a red alarm, to break you), rule the whole map, or hold every capital 👑. **💰 Bounties** (on): each round a price on one of the leader's border lands (+3 troops and a banner). **🔥 Rampage:** 3 lands in a turn earns a bonus banner. ⏪ A "while you waited" recap opens each of your turns. **Starting lands:** dealt, or picked in turn. **⛈️ Storms** (on): a sea lane closes each round. **🏰 Forts** (on): 4 draft troops; the defender's best die gets +1. **🎺 Gambits** (on): once a game each, 📯 Muster (+50% draft), 🛡️ Shield wall (all your lands defend as if forted until your next turn), 🎺 Forced march (two fortify moves), ⛵ Storm runner (cross stormy lanes). **🎯 Ambitions** (off): a secret goal each; fulfil one for +6 troops and a ⭐, three win. **Round limit** 20/12/none; **🤖 Bot pace**. 💡 Advisor (a suggested move with its reasons and a ✓ button); 🧭 lenses for threats and island progress; ↶ undo while drafting; chained attacks; press and hold a land for its card; pinch/drag/＋− zoom with a camera that follows the action. Battles play roll by roll (dice, lunges, counts ticking down), marching troops, flags, turn ribbons, storms rolling in, island ripples, and a 📜 chronicle chart. Low graphics keeps these one-off effects and drops only textures and endless loops. |
| 🎈 **Sky Drift** | 1–6 | An original hot-air balloon race over a 3D countryside (three.js, with a flat map fallback). Balloons can't steer: each turn everyone secretly picks ⬆ Climb, ⏸ Hold or ⬇ Descend (a dotted line previews where each would carry you), then every balloon drifts with the wind of its new layer at once. | Four wind layers, each with its own direction and speed (arrows stream through the sky; a gauge lists them). Pass within a cell of a 🚩 pennant to take it (a new one appears elsewhere). 🔥 Burner: +1 cell, 3 per game. Balloons that start a turn together in one cell and layer draft (+1 cell each). The winds shift every 3 turns, with a forecast a turn ahead. 🌩 A storm wanders the map and throws (and drops) any balloon that ends a turn under it. Most pennants wins; ties go to whoever is nearest a pennant. **Turns**: 10, 15 (default) or 20. **Storm**: on or off. Badges: 🎏 Double sweep, 🌪️ Storm chaser. |
| 🌿 **Hedgerow** | 2–4 | An original garden-maze race (in the pawn-and-wall genre): step your pawn to the far edge or plant a two-square hedge to send rivals the long way round; a hedge may never seal anyone in. Face-to-face pawns leap or slip diagonally. 9×9 or 7×7; 10 hedges each for two players, 5 each for three or four. | 🐇 **Hop** (on by default): once a game, step straight through a hedge. The board turns so your pawn starts at the bottom; faint dots show your shortest route; move targets glow, and a hedge you're placing shows as a ghost (red where it isn't allowed). A hedge that adds 2+ steps to a rival flies a +N. Hops and detours of 4+ steps are called out. |

### 🃏 Cards (49)

| Game | Players | What it is | Twist |
|---|---|---|---|
| 🃏 **Last Card** | 2–6 | Shedding game from the public-domain Crazy Eights / Mau-Mau family, with a standard 52-card deck. Optional action cards: 7 draw-two (stackable), 8 skip, Q reverse, J wild. | Call **“Last card!”** in time, or any opponent can 🚨 catch you for +2. ⚡ **Jump-in** (off by default): out of turn, snap the top card's twin (same rank and colour) onto the pile, and play carries on from you. Rivals sit round the table holding fans of card backs, and their cards fly to the pile. Catches, big 7-stacks and big draws are called out. |
| 🏮 **Lantern Market** *(a surprise)* | 2–6 | An original sealed-bid auction at a night market (the bidding-card genre). Each round a lot goes up, everyone secretly plays one of their bid tiles (1–10 or 1–13), and all bids are shown together. | The **highest bid nobody matched** wins, and matching bids cancel each other out. If every bid is matched, nobody buys and the next lot piles on top. Every tile is used once, so everyone's remaining tiles are public. 🏮 Once a game, light your **lantern** on a bid: a win counts double, and it burns out either way. 👀 The next lot is shown (an option). Each tile shows how many rivals still hold that number (✓ = nobody, so it can't clash). **Market events** (off by default): 🎁 a mystery lot hides its value until someone buys it, and 🌧 rain washes an unsold table away. The last two reveals play in turn, and a recap of the night (best buys, lanterns, clashes) closes the game. Lit-lantern wins, bargains and wash-outs are called out. |
| ♠️ **Texas Hold'em** | 2–6 | No-limit poker, the traditional game: blinds, two private cards, five shared cards, four betting rounds, all-ins with proper side pots. | Blinds rise every 6, 10 or 15 hands so every game ends. Uncalled chips come back, odd chips go to the first winner after the button, and showdown hands are named. Your own best hand is named live ("Pair of 7s"). Starting stacks of 1,000, 2,000 or 5,000. 💸 **Buy back in** (off, once, or up to 3 times) when you bust; if your bust would end the game, the table waits 12 s for you. Each hand ends with a callout of who won and with what ("Robo wins 60 with two pair, kings and 9s"), and a bar runs down to the next deal: **Between hands** sets the pause (⚡ quick 2.5 s, normal 5 s, 🐢 relaxed 9 s; longer after a showdown), and ▶ **Next hand** deals as soon as everyone still in has pressed it (#58). 📊 **Win chance** (off by default) shows your rough chance to win from your own cards and the board, worked out the way the bots judge it. 🎯 **Bounties** (off by default): knock a player out and collect 10% of the starting chips. When everyone is all in, the hands turn face up and the turn and river come out a second apart, with a heartbeat. 😵 Losing a showdown with three of a kind or better is a **bad beat** (a badge); flushes and better are called out. |
| 📍 **Cribbage** | 2–3 | The traditional pegging card game: discard to the crib, cut the starter, then the play (15s, pairs, runs, 31, go) and the show (fifteens, pairs, runs, flushes, nobs). | Scored exactly by the book, including his heels, the crib's five-card flush rule, and pegging out mid-hand. A peg track shows the race; the show lists every hand's points. Game to 121 or 61. A 🦨 skunk line marks 30 short of the finish (pegging out before a rival reaches it earns the 🦨 Skunk badge), and during the play each card that would score right now wears its points. Hands of 16+ (and the 29) and his heels are called out. |
| ♥️ **Hearts** | 3–6 | The traditional trick-dodging game: pass three, follow suit, avoid hearts (1) and the Q♠ (13), or shoot the moon. Game to 100 or 50, lowest wins. | No points on the first trick, hearts must be broken before they're led. With 3, 5 or 6 players low cards are removed so the deal is even. Optional 💎 J♦ worth −10. Everyone sits round an oval table and plays each card in front of themselves; an arrow points at whoever gets your passed cards, and the cards passed to you glow. 🌙 **Shooter's choice** (off by default): a moon shot takes −26 off the shooter instead of +26 to the rest, unless +26 wins them the game or they lead. The Q♠ and J♦ sit on the seat of whoever took them, and a seat holding every point so far glows with a 🌙. The Queen landing and moon shots are called out. |
| ⚡ **Speed** | 2 | The traditional two-player race card game (also called Spit), in real time: no turns, both players slap cards one rank up or down onto two centre piles. | Kings and aces wrap round. When nobody can play, fresh cards flip from the side piles. First to empty hand and stock wins; one round or best of 3. 👯 **Pairs** (off by default): a card of the same rank fits too. The centre piles are real stacks on a wood-rimmed table, and the rival's cards fly onto them. 🔥 Three cards slapped in quick succession is a combo. |
| 🀄 **Contract Rummy** | 2–6 | The traditional rummy game where each hand has a contract (two sets of 3; a set and a run of 4; … three runs of 4), with two decks and four wild jokers. The answer to #39. | Lay down the whole contract at once, then add to anyone's melds. Cards left in hand count against you; lowest total after 7 (or 4) hands wins. 🙋 **May I?** (off by default): before the next player draws, buy the top discard out of turn and take a penalty card with it (3 buys a hand). 💡 Find my contract stages the melds in your hand. Between hands, a recap shows what everyone was caught holding. 🀄 Laying down and going out in the same turn is a RUMMY. |
| ♣️ **Solitaire** (Klondike) | 1–6 | The traditional patience: seven columns with only their top cards face up, a stock to turn one or three cards at a time (unlimited passes), and four foundations built up by suit from the ace. Kings alone fill an empty column; a foundation card may come back down. | A **same-deal race**: everyone plays their own copy of the same deal at once (alone, it's plain solitaire). 1 point per card home, +10 for clearing it, +5 for clearing it first; 💡 hint −1, ↩ undo free, 🏳️ ends your deal early and banks your cards. Drag a card (its run comes with it), or tap it and tap where it goes; tapping it again sends it to its best spot. ⏫ sends everything it can home, and glows to finish the deal once everything is face up. 1 or 3 deals of 5, 8 or 12 minutes; 📅 today's deals are the same everywhere. A clear bounces the deck off the foundations. 🎩 badge: clear a deal drawing three. |
| 🗃️ **FreeCell** | 1–6 | The traditional open patience: all 52 cards face up in eight columns, four free cells, four foundations. Almost every deal can be won. | The same same-deal race and scoring as Solitaire. Runs move in one go when there's room for them ((free cells + 1) × 2 per empty column; the note under the board says how many), and safe cards fly home on their own (a setting). 🧊 badge: clear a deal without touching a free cell. |
| 🙊 **Cheat** | 3–6 | Play face down and say what they are. Lie when you must, and call out the liars. | Play face down and claim the next rank: call 🙊 Cheat! on anyone. A wrong call takes the pile, a caught liar takes it. Bots weigh how likely a claim is from the cards they've seen. |
| 👑 **President** | 3–6 | Climb out of your hand first: beat the pile with higher pairs and sets, and become President. | Singles, pairs, triples and quads, 2s high. Finish order sets next hand's ranks, and the Scum hands their best cards to the President. |
| 🥄 **Spoons** | 3–6 | Pass cards round the table all at once; get four of a kind and grab a spoon. One spoon too few! | Pass cards round at once; four of a kind and you grab a spoon, then everyone scrambles. The one left without is out (or gets a letter, S-P-O-O-N). |
| 🥊 **Knock Out Whist** | 2–6 | Win at least one trick or you're out. Each hand has one card fewer, and the most tricks picks trumps. | Seven cards, then six, five… Take no trick and you're knocked out; the trick-taking leader picks trumps. |
| ♠️ **Spades** | 4 | Bid your tricks with a partner, spades always trump. Make your contract, mind the bags. | Partnership bidding with nil, bags and the spade-breaking lead rule. |
| 🔥 **Oh Hell** | 3–6 | Bid exactly how many tricks you'll take. One too many is as bad as one too few. | Bid exactly; the dealer's bid can't make the total come out even (the hook). |
| 🃎 **Euchre** | 4 | Order up trumps with your partner; the two jacks rule. Take three of five tricks or get euchred. | 24 cards, order up the turned card, the right and left bowers, going alone, euchred for 2. |
| 🎯 **GOPS** | 2–3 | Bid for each prize card with a card of your own, all at once. No luck, just nerve. | Bid one of your 13 cards for each revealed prize card at the same time; ties split nothing. |
| 🧹 **Scopa** | 2–4 | The Italian fishing game: capture table cards that match or add up to yours, and sweep the table. | The Italian fishing game: capture by rank or sums, sweep the table for a scopa. ⚙️ Escoba rules (capture to 15) as a setting. |
| 🍸 **Gin Rummy** | 2 | Draw, discard, and arrange ten cards into sets and runs. Knock low, or go gin. | Draw, discard, knock at 10 or under, gin for 25, undercut for 25; layoffs counted for you. |
| 🦅 **German Whist** | 2 | Two-player whist: win tricks to pick your cards from the stock, then play the thirteen that count. | Two players: win tricks to choose cards from the stock, then the last thirteen count. |
| 🪭 **Fan Tan** | 3–6 | Sevens: build each suit up and down from its seven. Block your rivals, and run out first. | Build sevens out in each suit; pass and pay a chip when you can't. |
| 🏰 **Palace** | 2–6 | Shed your hand, then your face-up cards, then the blind ones. 2 resets, 10 burns, can't play? Take the pile. | Hand, face-up and face-down cards; 2 resets, 10 burns the pile, four of a kind burns too. |
| 🐀 **Egyptian Ratscrew** | 2–6 | Flip cards onto the pile and slap doubles and sandwiches first. Face cards demand an answer. | Slap doubles and sandwiches, face-card challenges. ⚙️ Variants: Beggar My Neighbour, Slapjack and Snap. |
| 🏁 **Nertz** | 2–6 | Real-time racing solitaire: everyone plays at once onto shared aces. Empty your Nertz pile first! | Real-time: everyone builds on the shared foundations at once from their own nertz pile. |
| 🎩 **Whist** | 4 | The grand old partnership trick-taker: thirteen tricks, trumps turned up, every trick over six scores. | Partnership whist to 5 or 7, trumps turned from the deal. |
| 🍷 **Briscola** | 2–4 | Italy's favourite: three cards in hand, no need to follow suit, and the aces and threes carry the points. | Italian 40-card trick game: no need to follow suit, trumps from the turned card, 61 of 120 wins. |
| ⚡ **Blitz** | 2–6 | Thirty-One: draw and discard toward 31 in one suit, knock when you're ahead, and hang on to your lives. | Thirty-One: draw and discard to the best same-suit total, knock to end the round, lose a life when lowest. |
| 🔄 **Ranter-Go-Round** | 3–6 | Chase the Ace: one card each, swap it with your neighbour or keep it, and don't be the lowest. | Ranter-Go-Round (Cuckoo): swap your card with your neighbour's or keep it, lowest loses a life; a king blocks. |
| 🐉 **Big Two** | 2–4 | Climb with singles, pairs and poker hands. 2 is top, spades break ties. Shed all thirteen first. | Climbing game with poker hands, 2s high. ⚙️ Tiến Lên rules (sequences, bombs that beat 2s, passing sits you out). |
| 🐟 **Go Fish** | 2–6 | Ask for the cards you need, remember who has what, and collect books of four. Go fish! | Ask for ranks, collect books of four. Hard bots remember every ask. |
| 👵 **Old Maid** | 2–6 | Pair up your cards and pass the odd queen along. Don't be left holding the Old Maid! | Pair off and draw from your neighbour; whoever is left with the odd queen loses. |
| 🎰 **Cassino** | 2–4 | Capture and build: pair cards, take sums, make builds for later, and chase big and little casino. | Capture by rank or sums, build and trail; big and little cassino, spades and sweeps score. |
| 😈 **Spite & Malice** | 2–4 | Race to empty your pay-off pile onto shared aces-up piles, and block your rival out of spite. | Pay-off pile race with shared ace-to-queen builds and kings wild; two decks (three at 3–4 players). |
| ⚔️ **War** | 2–4 | Flip your top card, highest takes all. Tie? It's war: three down, one up, winner takes the lot. | Flip and compare; ties go to war. Battle limit setting so it ends. |
| 💯 **Ninety-Nine** | 3 | Bid by discarding three cards, then take exactly that many tricks. Three players, nine tricks. | Three players bid by discarding three cards (♣3 ♥2 ♠1 ♦0) and try to take exactly that many of nine tricks. |
| 6️⃣ **Sixty-Six** | 2 | Two-player race to 66 card points: draw from the stock, call marriages, close the stock and squeeze. | Race to 66 card points: marriages, swapping the trump 9, closing the stock. ⚙️ Schnapsen rules (20 cards). |
| ⚾ **Pitch** | 2–4 | Bid for High, Low, Jack and Game, then pitch your trump. Make the bid or get set back. | Bid for High, Low, Jack and Game; the first card pitched sets trumps. Pairs at four (a setting). |
| 🎩 **Écarté** | 2 | Five cards, five tricks, king high. Propose an exchange, or dare to play as dealt. | Five cards, king high: propose an exchange or play as dealt; the vole for all five tricks. |
| 5️⃣ **Five Hundred** | 3–4 | Bid tricks and trumps, grab the kitty, ride the joker and bowers to 500. | Bid tricks and trumps, take the kitty; joker and bowers on top, misère. Pairs at four. |
| 🧺 **Canasta** | 2–4 | Meld sets, build canastas of seven with wild twos and jokers, and grab the pile when it's fat. | Two decks and jokers: meld, build canastas of seven, take the (frozen) pile with a natural pair. Pairs at four. |
| 🔮 **Eleusis** | 2–6 | Crack the secret rule from the cards it accepts and rejects. Shed your hand, or name the rule. | The game picks a secret rule from 20; play cards and watch what's accepted. Name the rule to shed three cards. |
| 🤐 **Mao** | 2–6 | Shed your cards, but the rules are secret: learn them from the penalties, and say the right things. | Our own take on the folk game: three secret say-it rules each game, learned only from the penalty reasons. |
| 🥖 **Belote** | 4 | The French classic: take trumps, ride the jack and nine, and call belote. Four players in pairs. | The French Jass-family game: take trumps, jack and nine on top, belote-rebelote, 82 to make it. |
| 💍 **Pinochle** | 4 | Bid your side's meld and tricks, name trumps, show your pinochles and marriages. Four players in pairs. | Partnership auction pinochle: 48 cards, meld (runs, marriages, pinochle, arounds) plus counters. |
| 🎴 **Bezique** | 2 | Two packs, eight cards: win tricks to declare beziques, marriages and sequences, then the last eight count. | Two packs, melds declared after winning tricks (bezique, sequence, double bezique 500); melded cards stay playable. |
| 🌉 **Bridge** | 4 | Contract Bridge with Chicago scoring: bid with your partner, declare, and play dummy's hand too. | Auction with doubles and redoubles, the declarer plays dummy's hand, Chicago vulnerability and scoring. |
| 🗡️ **Truc** | 2 | Three cards, best of three tricks, and a stake you can keep raising. Bluff them into folding. | Three-card bluffing: raise the stake with Truc! or fold. ⚙️ Put rules (a call decides the game). |
| 🍺 **Skat** | 3 | One declarer against two: bid your game's value, take the skat, and make 61 with the jacks on top. | Bid game values, take the skat or play hand, suit, grand or null; jacks on top, matadors count. |
| ⚜️ **Piquet** | 2 | Exchange from the talon, outdeclare your rival on point, sequence and sets, then win the tricks. | Exchanges from the talon, automatic point/sequence/sets declarations, repique and pique, capot. |

### ✏️ Quick classics (6)

| Game | Players | What it is | Twist |
|---|---|---|---|
| 🚢 **Sea Battle** | 2 | The classic pencil-and-paper fleet hunt: hide 5 ships, then take turns firing. | Firing rules: 1 shot, hit = fire again, or Salvo (1 shot per ship afloat). Optional 📡 sonar counts the ship squares in a 3×3 area. A 12×12 sea with a sixth ship (a Frigate) for longer hunts. 💥 **Torpedo** (off by default): once a game, fire at three squares in a line, across or down, as one shot (bots keep to single shots). 📡 **Bounty** (off by default): sinking a ship earns another sonar scan. Shots land as pegs (a white ring for a miss, a red peg for a hit), both fleets show as ship silhouettes, and a hit on your fleet makes your grid pulse and name the ship. Three hits running and a fleet down to its last ship are called out. |
| 🔴 **Drop Four** | 2–4 | Gravity four-in-a-row. 3–4 players get a 9×7 board. | Optional 💣 **bomb disc**: it clears its 3×3 neighbourhood and the stack falls, which can complete *someone else's* line. Optional ⬇️ **pull-outs**: take one of your own discs out of the bottom row instead of dropping, and the column slides down. Two players can pick a **bigger board** (7 × 8 or 7 × 9; 6 × 7 by default). ⚠ An optional on-device warning marks any column where a rival's next disc makes four, and a win or a bomb gets its callout. ⚡ A double threat is called out. |
| 🔳 **Dots & Boxes** | 2–6 | The pencil-and-paper classic on a 3×3 to 6×6 grid. Close a box to claim it and move again. On touch screens a line takes two taps (pick, then confirm). | Optional 💎 **gem boxes** worth 3 points. In the endgame, when every line gives boxes away, a ⛓ hint lists the chains and loops left. ✏️ **Head start** (off by default): a quarter of the lines start drawn (never a box's third side), skipping the slow opening. A line you pick or hover tints red any box it would give away. A chain of 4+ boxes is called out. |
| ❌ **Tic-Tac-Toe** | 2 | The classic. | 👻 **Vanishing**: you keep only your 3 newest marks, and the oldest fades out. A 4×4 board (four in a row; Vanishing keeps 4). 🙃 **Misère** (a Variant choice): completing a line loses (the hard bot plays it perfectly). The grid is drawn in pen too, a faint ghost of your mark follows the mouse, and a draw is a 🐱 cat's game. 🍴 A fork is called out. |
| #️⃣ **Ultimate Tic-Tac-Toe** | 2 | The folk game: nine small boards in one. Where you play sends your rival to that board. Win three small boards in a row. | The boards you may play in glow; won boards show a big mark; the last move is outlined. ↶ Undo requests. 🏆 **Most small boards** (off by default): when no line is left, whoever won more small boards wins instead of a draw. Marks are drawn in pen like Tic-Tac-Toe's, a won board gets a big mark and a "Board n!", and three in a row is struck through. Each small board won is called out with the running count. |
| ⚫ **Nine Men's Morris** | 2 | The traditional mill game: place 9 men, then slide them; a line of three (a mill) takes a rival man. Fewer than 3 men or no move loses. | Optional flying with 3 men. Tap a man, then its destination; after a mill, rival men you can take pulse red. A **⚠ Show threats** toggle rings the points where your rival could finish a mill next move. **Twelve Men's Morris** option: 12 men each and the corner diagonals are lines (a full board is a draw). **Lasker Morris** (a Men choice): 10 men each, and while you still hold men you may place or move. ↶ Undo. The men still to place wait in a row beside the board and fly out to their point; mills and flying get callouts. A double mill and a rival down to three men are called out. |
| 🔢 **Sudoku** | 1–6 | The public-domain number-place puzzle as a race: everyone gets the same grid at once. | Tap a cell, then a digit (or type it; arrows move). A right digit stays and scores 1; a wrong one bounces off and costs 1. ✏️ pencil marks are private to your screen and clear themselves as digits land. 💡 fills a cell that can be worked out, for 1 point. Finishing scores +10, +5 for first. 9×9 or 6×6 mini; easy puzzles need only "one digit fits here", medium also "this digit fits only here", hard anything (every puzzle has exactly one solution). Rows, columns and boxes glow as you complete them; the solution shows in red afterwards. ✨ badge: a 9×9 with no slips or hints. |

### 🎲 Dice & casino (13)

| Game | Players | What it is | Twist |
|---|---|---|---|
| 🚀 **Moon Shot** | 1–6 | Push-your-luck dice race to the moon. Roll to build fuel, then bank it to fly. Any 1 loses this turn's fuel; double 1s crash you to the start. | A random track of ⭐ boosts (+5), ☄️ meteors (−5) and 🌀 wormholes (swap with the leader), so *where* you stop matters. Doubles earn 🛡️ shields. Alone, reach the moon within 4, 6 or 9 turns (by distance). 💥 **Bumping** (off by default): landing exactly on a rival knocks them back 3. The route snakes from 🌍 to 🌕 through a starfield, and your turn shows the odds of the next roll. Flights of 15+ and wormhole swaps are called out. |
| 🎲 **Yacht** | 1–6 | The traditional dice game: five dice, up to three rolls (tap to hold), then fill one of twelve boxes. Classic scoring: Ones–Sixes, Full House, Four of a Kind, Little and Big Straight (30), Choice, Yacht (50). | Your open boxes show what the roll would score before you commit. Solo is a score attack: reach 150 to win. Optional bonuses: +35 for 63 in Ones–Sixes, +50 per extra Yacht. ⭐ **Bonus roll** (off by default): one extra roll a game, after your third. The dice you hold show on everyone's screen as you tap them, and the number rows carry a little die. Yachts, straights and the upper bonus are called out. |
| 🎯 **Farkle** | 1–6 | The traditional push-your-luck dice game: roll six, set aside scoring dice, roll the rest or bank. A roll with nothing scoring is a FARKLE and the turn's points are gone; score all six for hot dice. | Live total of the dice you've picked, a ✨ best-pick button, and everyone sees each farkle and bank. Play to 10,000 or 5,000, with a final round for the others; optional 500 to get on the board and −1,000 for three farkles in a row. 🐷 **Piggyback** (off by default): after a bank with dice left, the next player may take over those points and dice instead of starting fresh. In the final round a 🏁 line marks the score to beat on every bar, and Bank says how far short you are. Hot dice, banks of 2,000+ and farkles of 1,000+ are called out. |
| 🥤 **Qork** | 2–6 | A reaction dice game (#41): the Cupper keeps rolling two dice, and on doubles or a seven every Corker yanks their Qork off the mat while the Cupper slams the cup down. Escape for +1; each trapped Qork is +1 to the Cupper (+1 more for trapping everyone); jumping early on any other roll is −1. The cup passes every round. | Reaction times are measured on each phone from the moment the dice land there, so a slow network doesn't lose the race; everyone's time is shown after each slam. Tap the mat, the big button or Space. 1–3 turns as Cupper each. 🍀 **Lucky number** (off by default): each round draws a lucky total that triggers just like a 7. ⚡ The night's fastest escape and clean sweeps are called out. |
| 🚢 **Ship, Captain & Crew** | 1–6 | The traditional tavern dice game: three rolls of five dice to find a 6 (ship), then a 5 (captain), then a 4 (crew), in order. The last two dice are your cargo. | Tap cargo dice to reroll one or both with the rolls you have left, or ⚓ dock. 3, 5 or 8 rounds; alone, average 5 cargo a round to win (best play averages about 4.3). Optional 🍺 pub pot: ante a coin a round, best cargo takes the pot. A 🏅 best-solo-hauls table on your device. 🏴‍☠️ **Raids** (off by default): dock 11 or 12 cargo and plunder 2 from the leader. A little ship builds up as the 6, 5 and 4 come in: hull, mast and sails, then the crew. All three in one roll and a full hold are called out. |
| 📦 **Shut the Box** | 1–6 | The traditional pub dice game: roll two dice and shut open tiles (1–9, or 1–12) that add up to the roll, until nothing fits. The open tiles are your points; lowest total after 1, 3 or 5 rounds wins. | Shut every tile to shut the box for 0. Once 7 and up are shut you may roll one die. Tiles that can't fit your roll are dimmed, and a single possible fit is picked for you. Alone, beat 10 points a round; a 🏅 best-solo-totals table on your device. 📦 **Shut it, win it** (off by default): shutting the box wins the game on the spot. Each roll button shows the chance that roll leaves you stuck. One tile left and shutting the box are called out. |
| 🤥 **Liar's Dice** | 2–6 | The traditional bluffing game: everyone rolls in secret, then bids rise ("four 3s") until someone calls 🤥 Liar!. Whoever was wrong loses a die; the last with dice wins. | Optional wild 1s and 🎯 Exact calls (spot on and everyone else loses a die). A helper shows how many of a face to expect, and the showdown stays up with everyone's dice. Optional 🗿 **palifico**: the first time someone is down to one die they open a round where 1s aren't wild and every bid keeps the opening face. 🎲 **Show & reroll** (off by default): once a round, on your turn, put some dice on show for everyone and reroll the rest, then bid. Caught bluffs (and pure bluffs with none of the face), wrong calls and spot-on calls are called out. |
| 🕛 **Midnight** | 1–6 | The traditional 1-4-24 dice game: roll six dice and set aside at least one each roll until all six are kept. You need a 1 and a 4; the other four dice score (24 is midnight). | 1, 3 or 5 rounds; alone, average 17 a round to win (best play averages about 18.7). Optional 🌙 **Round wins**: each round's best score takes a moon. A little clock hand creeps toward 12 as your score climbs. |
| 🎭 **Mia** | 2–6 | The traditional two-dice bluffing game (Mäxchen): roll in secret, announce a value that beats the last call, true or not. The next player believes it and rolls to beat it, or lifts the cup. | 2, 3 or 5 lives. A lift over a Mia (2-1) costs 2 lives; facing a Mia you can concede 1 instead. A ladder of all 21 values with your true roll outlined. |
| 🧮 **Dice Squares** | 1–6 | Original: everyone writes the same rolls into their own 4×4 or 5×5 grid at the same time; each row and column scores as a dice hand (pairs, runs, full house, four or five of a kind). | Simultaneous; rivals' newest square stays hidden until everyone has placed. ✌️ **Two dice** option: pick one of two dice each roll. Alone, beat the goal (about a normal bot's average). |
| ⚔️ **Dice Brawl** | 2–6 | Original last-one-standing combat dice: five dice, three rolls, hold what you like. ⚔️ hits 1, 💥 hits 2 on the rival you pick, 🛡️ guards until your next turn, ❤️ heals. | 💀 Skulls lock, and a third one backfires for 2. Three or more 💥 quake the whole table. 8, 12 or 18 health. |
| 🏇 **Dice Derby** | 2–6 | Original betting race: six horses and two secret tickets each per race. Each turn roll three dice: one horse gallops +2, another trots +1, a third stumbles −1. | The race ends when a horse reaches 12; tickets on 1st/2nd/3rd pay 5/3/1. Everyone sees what you push, so steer without showing your hand. 1, 3 or 5 races. |
| ♦️ **Blackjack** (Twenty-One) | 1–6 | The casino game against a dealer bot: everyone stacks up a bet from 5–100 chips (or all-in, or ↺ last bet) at once, then hits, stands, doubles or ✂️ splits a pair in turn. Dealer draws to 17; a two-card 21 pays 3:2. | Four-deck shoe. Split up to four hands (split aces get one card each; a 21 after a split pays even money). Most chips after 5, 8 or 12 hands wins; alone, beat your starting 100. Option 👯 **Perfect Pairs**: a 5-chip side bet on your first two cards making a pair (6:1 mixed colours, 12:1 same colour, 25:1 same suit). Option 🛡️ **Insurance**: when the dealer shows an ace, insure for half your bet before the dealer peeks; it pays 2:1 if the dealer has blackjack (bots never take it, and the clock declines for you). 🏳️ **Surrender** (off by default): give up half your bet on your first two cards. 💡 Tips (on your device) tag the move basic strategy picks. The seats sit on the dealer's felt. Blackjacks and a dealer bust are called out. |

Every game has ✨ **moments**: the big plays above (a perfect clear, a bad beat, a full moon…) pop up as a callout on every phone at the table as well as in the log.

Every game has **Easy / Normal / Hard bots**:
- **Unmask:** the bot picks the question that splits the remaining faces best.
- **Wordsmith:** the bot searches the dictionary against the board with a time budget.
- **Drop Four:** the hard bot searches 4 moves ahead (alpha-beta pruning).
- **Dots & Boxes:** bots take free boxes and avoid drawing third sides. When forced to give boxes away, normal and hard give the fewest. Hard also uses chain strategy: in two-player games it *double-deals* (leaves the last two boxes of a long chain to keep control), and it opens two-box chains in the middle so they can't be double-dealt back.
- **Tic-Tac-Toe:** the hard bot plays perfectly (minimax) in the classic variant.
- **Odd One Out:** bots give clues from per-word clue lists (hard bots favour clues that fit both words) and vote by comparing everyone's clues with what they would expect. Bots also notice when the table's clues don't fit their own word.
- **Scribble Relay:** bots draw from the Doodle Dash picture book, so anything not in it comes out as some other picture. They recognise each other's drawings, and stronger bots more often "get" a human's drawing.
- **Fib Finder:** bots write plausible decoy answers. Like people, they sometimes just know the fact; hard bots are also suspicious of answers that don't sound like a real guess.
- **Word Ladder:** bots step along a shortest everyday-word ladder; easier bots take wrong turns more often, back up when stuck and climb more slowly.
- **Night Heist:** the bot reads the pot size and the table size.
- **Billiards:** bots aim with the ghost-ball method, checking that both paths are clear and the cut isn't too thin, and pick a power that gets the ball to the pocket. With ball in hand they choose the spot with the best shot. The hard bot runs its five best ideas through the real physics engine and also weighs the next shot it leaves itself, then tries its pick with follow and with draw in case either leaves a better one. All bots cut a touch thinner to allow for throw. Bots never push out in 9-ball; after a rival's push they shoot only if they have a decent pot (the easy bot always shoots) and otherwise hand the table back.
- **Farkle:** bots weigh the chance of farkling with the dice left (measured: 67% with one die down to 2% with six) against the average gain, and keep rolling when it pays; in the final round they roll until they beat the leader. Hard keeps fewer dice to roll more. Simulation shows Farkle is mostly luck past that: hard and normal finish about even, both well ahead of easy.
- **Qork:** bots react after a human-like delay (easy ≈ 640 ms, normal ≈ 480 ms, hard ≈ 350 ms) and sometimes flinch at a near miss (a 6 or 8, or dice one apart): easy 10%, normal 7%, hard 2%. They only see what's on the table. Simulation: hard wins almost every bot-only game.
- **Ship, Captain & Crew:** hard bots reroll cargo by an exact expected-value table (one die or both); normal bots reroll below 7, easy below 6; in the last round, bots behind the leader gamble.
- **Shut the Box:** the hard bot plays perfectly: it works out the lowest expected score for every possible box and roll (11.0 points a round with tiles 1–9; it scored 10.85 over 450 rounds and shut the box 9% of the time). Normal shuts the fewest, highest tiles (11.6), easy picks any fit (20.2). It's mostly luck: hard and normal finish about even.
- **Liar's Dice:** bots judge bids with the binomial odds from their own dice and the hidden count, bid the most believable raise and sometimes bluff; hard bots also assume a bidder holds one of the face they bid, and call 🎯 Exact when it is the likeliest count.
- **Midnight:** the hard bot plays perfectly for points (an exact expected-value search over every keep, averaging 18.7 a turn); normal keeps 6s and late 5s (16.4); easy grabs 5s too early (13.8).
- **Mia:** bots weigh how likely a call is (the dice odds, and how often a liar would land on that value given the call before) against the chance they could beat it themselves; hard bots also stretch true rolls now and then and vary their bluffs.
- **Dice Squares:** bots score each square by how it lifts the hands its row and column can still become; hard also looks one roll ahead (the best follow-up for every next die).
- **Dice Brawl:** the hard bot searches every hold and reroll left in the turn exactly; normal holds attack dice and stops on a strong hand; easy keeps rolling. Hard targets the damage that sticks, and any knockout.
- **Dice Derby:** bots play out the rest of the race at random for each way to use the dice; hard bots also read which horses rivals keep pushing and avoid helping them.
- **Yacht:** bots judge a roll by its best box minus that box's typical value, so they don't waste Choice or Yacht on a weak roll. The hard bot tries all 32 ways to hold the dice, simulating the remaining rolls for each; normal keeps its most common face or a straight draw. Hard averages about 140 points.
- **Cribbage:** bots keep the four cards worth the most averaged over every possible starter; the hard bot also feeds its own crib and starves a rival's. In the play they take the most points now, and the hard bot avoids leaving 5 or 21 (an easy 15 or 31) and inviting runs.
- **Texas Hold'em:** bots estimate their share of the pot by simulating random runouts from their own two cards and the board only (no peeking), against the number of players still in. They compare that with the pot odds, raise strong hands by ½ to 1 pot, and stronger bots bluff now and then and shove the nuts on the river. Easy bots misjudge their hands and call too loosely.
- **Grid Hunt:** the server solves every grid (a dictionary walk with prefix pruning). Each bot "spots" a share of the words at random moments, fewer of the long ones: about 5% (easy), 9% (normal) or 15% (hard) of the grid, so a quick human beats easy and normal bots.
- **Word Search:** a bot "spots" one open word at a time (longer words catch its eye first): about every 16 s (easy), 10 s (normal) or 6.5 s (hard), slower on bigger grids and when words run backwards.
- **Word Garden:** a bot thinks of one garden word at a time (shorter ones first), about every 15 s (easy), 9.5 s (normal) or 6 s (hard), slower on 7-letter rings; now and then it spots an everyday bonus word instead (more often the harder it is), and easy bots reach for a 💧 when stuck.
- **Word Bomb:** a bot picks an unplayed dictionary word containing the letters (easy: short words; hard: longer words with the letters it still needs for 🔤), thinks for 3–7.5 s (easy), 2.5–5.5 s (normal) or 1.8–3.8 s (hard) and types it key by key; now and then it freezes on rare letters (18% / 9% / 5%) and the bomb goes off. Tuned so a human averaging ~4.5 s a word wins ~70% / ~50% / ~25% against two bots.
- **Safecracker:** bots keep the list of codes that fit every revealed clue. Normal guesses one of them at random; hard picks among the guesses that would split the rest most evenly and only spends its probe when the answer should pin the code down; easy mostly tracks its own clues only. Because every clue is shared, hard and normal finish about even, both far ahead of easy.
- **Backgammon:** bots list every distinct end-of-turn position and score it on pip count, borne-off and hit checkers, points made (home board weighted), blots weighed by how many enemy rolls hit them, and primes. The hard bot then checks its top four against all 21 enemy rolls and the enemy's best reply to each; normal sometimes settles for its second-best play. Hard beat normal 46–14 and normal beat easy 52–8 in simulation.
- **Oware, Reversi, Ultimate Tic-Tac-Toe, Nine Men's Morris:** one shared search (`games/search.py`): negamax with alpha-beta and iterative deepening under a time budget (hard: 2.5 s, 6–9 moves deep; normal: 3–4 deep; easy: 1 deep with noise). Each game adds its own evaluation: Oware weighs captured seeds, seeds at home and rival pits sitting on 1–2; Reversi uses square weights (corners high, the squares next to an empty corner low), mobility and, near the end, disc count; Ultimate scores open two-in-a-rows on the big and small boards; Morris counts men, open two-man lines and mobility. Hard beat easy 6–0 in every one.
- **Realm Wars:** exact odds (a roll-until-settled table, with and without a fort or shield). Each attack is scored by its chance to take the land plus bonuses for finishing an island, breaking a rival's, a capital, knocking a player out, the first land of the turn (a banner) and its own secret ambition; storms are respected. Easy places troops at random on its front and attacks on noisy scores; normal spreads troops on its most pressed front and attacks at 62%; hard stacks everything on its best attack, saves banners for bigger trades and attacks at 70%. Normal and hard fort a threatened land guarding a (nearly) held island, and play gambits when they fit (shield wall from round 3 when a border faces twice its troops; muster with a big draft and a good target; storm runner for a strong attack across a storm; forced march with two idle stacks). The 💡 advisor shows the hard bot's choice in words. Measured over 60 two-player games, hard only edges easy (33–27): the dice decide a lot and the bots' plans need work.
- **Sky Drift:** bots try every height (and the burner when fuel allows) in the known winds and score where each lands: pennants taken, distance to the nearest one left, the storm nearby. Easy is noisy and sometimes picks at random; normal adds a little noise; hard also looks a turn ahead in the forecast winds and saves fuel. About 3 / 5 / 6 pennants over 15 turns.
- **Hedgerow:** shortest-route races. Every option (each pawn move, and each legal hedge that touches a rival's shortest route) is scored as the leading rival's distance minus its own, plus a little for hedges and the 🐇 hop still in hand. Easy mostly walks its route with random hedges; normal takes the best-scored option (sometimes the second); hard, with two players, also looks one reply deep (the rival's best answer to each of its top 14 options). Hard beat easy 11–1 over 12 games.
- **Hearts:** bots pass their most dangerous cards (high spades, high hearts, cards from short suits), duck under the winning card when they can, win clean tricks when they play last, and dump the Q♠ and high hearts when void. Hard also avoids leading or taking high spades while the queen is out. Hard and normal finish about even; both beat easy.
- **Blackjack:** hard plays full basic strategy (soft totals, doubles and pair splits), normal a simplified version that splits only aces and 8s, easy hits below 15. Over a few hands it's mostly luck, as at a real table.
- **Speed:** bots play at a human pace (about 2 s a card for easy, 1.2 s for normal, 0.8 s for hard). Normal and hard prefer plays that leave another card playable straight after.
- **FreeCell:** bots solve the deal before they start (a best-first search over whole-run moves with a time budget: hard 1.8 s, normal 0.4 s, easy a glance), then play the plan out at a human pace (hard ≈ 1.6 s a move, normal 2.6 s, easy 3.4 s). Without a plan they play the best-looking move and call it a day when stuck. Seeded tests: hard clears 6 of 6 deals.
- **Sudoku:** bots solve like people: "only one digit fits this cell" (easy) plus "this digit fits only one cell here" (normal, hard). Stuck, easy and normal bots guess between the tightest cell's candidates (and pay for wrong guesses); the hard bot stands in for the advanced techniques and fills the tightest cell. Pace per digit: about 11 s (easy), 7 s (normal), 4 s (hard), slower on harder puzzles.
- **Solitaire:** bots play fair, from what anyone could see (never the face-down cards or the stock): aces and twos home at once, uncover the deepest column first, move part of a run to free a card for home, empty a column only for a waiting king, and draw when there's nothing better; a full pass of the stock with nothing to play and they call it a day. Easy and normal sometimes draw past a good move. Drawing one, normal and hard clear about a third of deals.
- **Trivia Rush:** bots "know" an answer with some chance (45% easy, 62% normal, 80% hard) and otherwise guess; harder bots also answer faster.
- **Contract Rummy:** bots search their hand for the contract (every way of making 3-card sets and 4-card runs, jokers included, both copies of a card), take the discard only when it completes the contract or helps and they wouldn't throw it straight back, and discard the card that helps least (pairs for set contracts, same-suit neighbours for run contracts). After laying down they add every card that fits. Hard beat normal 9–6 and normal beat easy 12–3.
- **The card-table games** (Cheat to Piquet, 40 games on one shared table, `games/cardbase.py` and `games/tricks.py`): bots see only what a player at the table could (their own hand, the cards played, the calls made). The trick games share one card-picker: win the trick cheaply when you want it, duck when you don't, and keep the boss cards; hard also remembers every card played this hand. Each game adds its own judgement: bidding from a hand estimate (Spades, Oh Hell, Ninety-Nine, Pitch, Five Hundred, Pinochle, Bridge, Skat, Belote), Cheat bots weigh how likely a claim is from the cards they've seen, Eleusis bots keep every rule that still fits the evidence, Mao bots learn a secret rule when they see it penalised (hard always, easy 40%), Go Fish hard remembers every ask, Bridge bots cap their bidding by what the opponents have shown. Over seeded bot-only games hard beats easy in nearly all of them; pure-luck games (War, Old Maid, Ranter-Go-Round, Put) come out about even.
- **Putt Party:** bots try 25 (easy) to 160 (hard) putts aimed at the cup and along the fairway in the real physics, keep the one that ends nearest the cup along the fairway, then add aim and power error by level.
- **Cannon Hills:** bots try 25 (easy) to 120 (hard) angle-and-power pairs in the real physics with the wind everyone can see, keep the one that lands nearest the target, then add aim error by level. Easy aims at the nearest cannon, normal at the weakest, hard weighs every rival, saves 💥 for a sure hit and walls itself in with 🪨 when low.
- **Ice Stones:** bots try 10 (easy) to 55 (hard) throws in the real physics, mixing draws and guards (picked by where they should stop) and takeouts of the nearest rival stone, and score the position each one leaves (counting stones, closeness to the button, guards; with the hammer only the count matters). Hard then polishes the best throw. Aim and weight error shrink by level. A bot sweeps at the level it planned, so its live slide ends exactly where it planned.
- **Wind Archery:** bots aim against the drift they expect, with a hand that shakes less by level. Easy allows for only 60% of the flag's wind. Normal corrects from where its own arrows landed this end; hard reads every arrow on the target (each shot shows its aim, so a person could do the same), goes for the 🍎 apple or a 🎈 balloon when its odds beat the gold, and saves its 🧘 steady breath for the longest range. On the swinging end every bot leads the face, with timing that's sloppier by level; normal and hard loose the 🔥 fire arrow when their odds of gold make doubling pay (or on their last arrow of the end), easy only now and then, when its odds of gold are fair. Over 3 ends bots average about easy 64, normal 84, hard 101 (a careful person scores 60–90).
- **Meteor Shot:** bots find the best angle, power and aim on a grid (aiming into the wind), then miss by a hand that shakes less by level (easy ≈67, normal ≈83, hard ≈93 a shot).
- **Lane Night:** bots aim for the pocket (or the middle of a spare leave), steer each try onto that line with a few test rolls in the real physics, keep the best of 3 (easy) to 22 (hard) tries, then add aim and hook error by level: about 100 / 170 / 190 a game. Normal and hard arm the spare saver on one- or two-pin leaves.
- **Snowball Scramble:** bots keep a lobbing distance from the nearest rival and throw with aim error by level (easy ±1.2, hard ±0.2 units). Normal and hard dodge landing shadows coming for them, pack big ones and roll giants; hard also shelters behind the fort nearest to it, on the far side from its target. With gifts on, bots walk to gifts within reach (easy 3, normal 6, hard 9 units), throw ice and slush at a rival in range, drop a decoy when a snowball is coming or they carry hits, step out of rivals' slush (not easy), and play for the crown (hard mostly, normal half the time, easy only when close), heading for the next hill while it flies there; normal and hard throw at a rival wearing the crown within 9 units; decoys fool their aim too.
- **Paper Boat Rapids:** bots look a few units downstream and score 13 lines across the river: the current there, minus rocks, whirlpools, the waterfall's lip and (by how soggy they are) white water, plus sun patches when soggy and pickups. Easy reacts in 0.5 s with ±1.2 units of aim noise, paddles at random and never braces; normal (0.3 s, ±0.6) braces in white water and paddles when full; hard (0.15 s, ±0.25) shoots the wet edge gaps while dry and saves a paddle for whirlpools. Over 8 medium rivers: hard averaged 1.25th, normal 1.75th, easy 3rd.
- **Midway Night:** each bot picks the spot worth most to a hand as steady as its own (16 sampled throws per target, with the server's wobble: jackpot, corner cups, red bottles, the bottom cans that bring a pyramid down) and throws at it with ±0.10 m (easy, which just aims at whatever looks biggest), ±0.055 m (normal, weighing 6 targets) or ±0.03 m (hard, all of them). Bots throw every 2–4 s on their own clocks. Over 20 three-bot nights hard won 17, normal 3.
- **Paper Planes:** each bot flies throws in its head with the server's flight model (the wind it can see on the windsock, no gusts or wobble) and throws the best: easy tries 5 throws with one random fold and ignores the wind; normal 12 per fold; hard 18 per fold, then refines the best 10 more times and saves the 📎 for a hoop or ring round. Its hand then shakes by ±4°/±0.08 power (easy), ±2°/±0.04 (normal) or ±0.9°/±0.018 (hard). Over 20 three-bot games hard won 17, normal 3.
- **Orbit Golf:** each bot tries launches in its head with the server's physics (a mix of near-straight shots and wide curves, at a power for the distance or at random) and keeps the one that ends nearest the cup, counting a black hole or deep space as a disaster: easy tries 12, normal 30, hard 40 and then refines its best 14 times. Its hand then shakes by ±5°/±0.09 power (easy), ±2.4°/±0.045 (normal) or ±1.1°/±0.02 (hard). Over 20 three-bot 5-hole games hard won 15, normal 4 (one tie).
- **Regatta:** bots steer for the next buoy; when it's upwind they sail close-hauled on the side it lies and tack on the layline (easy tacks early and needs extra tacks, normal a little early), and they sail a little off dead downwind. Reactions 0.6 / 0.35 / 0.18 s with ±0.22 / ±0.1 / ±0.04 rad of heading noise; easy oversteers; hard bends its course toward gusts on the way. Over 8 three-bot races hard won 7, normal 1. With pirates on, bots fire at the rival their guns bear on when it is within 70 / 80 / 75 % of the range and within 40° / 30° / 22° of the beam (hard saves its shot for boats ahead, close by, or Black Jack), and normal and hard swing by a powder keg near their way.
- **Spin Tops:** bots pick a top each round (easy at random, normal mostly ⚖️, hard counters the most common rival top 70% of the time), launch and rev near the meter's top (easy 0.25–0.75, normal 0.5–0.9, hard 0.78–1), chase the rival they out-hit (spin × punch; hard also weighs how near the rim it is and swings round to hit it outward), keep away when weaker, grab pickups in reach (easy 1.5, normal 3.5, hard 5), steer back from the rim or the hot ring (normal and hard), and dash when lined up and close, which usually lands a smash. Reactions 0.42 / 0.24 / 0.12 s. Over 20 three-bot games (easy, normal, hard) points were about 67 / 210 / 368.
- **Moon Lander:** bots fly a PD autopilot through the same tick as everyone (so the server judges their input logs like anyone's): pick a pad (easy ×1, normal ×2, hard ×3; the ×1 when the tank is low), climb over ridges in the way, lean toward the pad, then come straight down aiming at 2.0 / 1.4 / 1.0 m/s, deciding every 6 / 3 / 1 ticks with shaky gains (±35 % / 15 % / 4 %). Over 60 moons they averaged 60 / 155 / 210 points a round.
- **Coin Cascade:** bots try drops in their head on a copy of the pile (the machine is deterministic, so they see exactly what a drop does): easy 3 random ones (and doesn't look), normal 8 round its own stretch (a coin into a rival's tray counts −0.1), hard 18 on a grid across its stretch at three timings (rival coins −0.3, plus a little for coins left teetering over its own tray). Bells are worth a bit extra. Over 12 rotated three-bot games: easy 16.6, normal 19.8, hard 19.8 points (6 turns each): the pile decides a lot.
- **Tide Castles:** bots try layouts against the forecast on a copy of their beach and build the best: rings of walls and towers round the keep (one or two deep), a rampart across the front in some, moats in front, flags on tall towers, the rest scattered, sometimes a moved keep; normal and hard also score the tide's goal. Easy tries 2 (one of them random) against a forecast it underestimates; normal 25; hard 70 and also values what will still be standing next tide. Over 18 rotated three-bot games: easy 112, normal 144, hard 146 points.
- **Frozen Pond:** bots drill where they see shadows or bubbles heading (normal looks 5 s ahead; hard looks 10 s ahead, averages the next 16 s and leans toward trout and pike; easy drills at random), move their line to a better hole, hook with a person's reactions (easy 0.78 ± 0.25 s, so it misses some; normal 0.5 ± 0.15; hard 0.34 ± 0.08) and reel through the rests, easing off a lunge after 0.42 / 0.26 / 0.13 s (easy sometimes gets greedy and reels into one). Over 10 three-bot ponds hard won 8, normal 2.
- **Domino Run:** each bot tries every square its run pushes into, at every angle (and its split), runs the whole topple for each and scores it: its own points ×3, plus a pull toward the nearest target nobody reaches yet, minus rivals' gains (normal ×0.4, hard ×0.8). With nowhere left to build it stands a domino side-on in a rival's path. Every bot slips its 🏴‍☠️ pirate onto a rival's run end (easy only sometimes); hard also looks one domino ahead; easy just builds on with a lot of randomness.
- **Chess:** alpha-beta search with iterative deepening (hard bot: up to 4 moves deep, 4s budget). It finishes off a lone king and avoids repetition draws when ahead.
- **Checkers:** alpha-beta search (hard bot: up to 8 moves deep).
- **Go:** heuristic play: captures, rescuing groups in atari, avoiding self-atari, shape. It recognises settled territory and passes. On 9×9 and 13×13 the hard bot shortlists the best heuristic moves and picks among them by Monte Carlo playouts (about 2.5 s per move, successive halving).
- **Last Card:** keeps its long suit and saves wild Jacks for later. Normal and hard bots also catch players who forget to call “Last card!”.
- **Lantern Market:** normal bots bid higher tiles for richer lots. Hard bots sample what each rival will bid (reading from their past bids how plainly or wildly they play) and weigh each tile's chance of winning this lot against its share of the market still to come; head to head they pick sharply, at 3–4 players they leave the plain bid only for a clearly better move (with a little randomness so two hard bots don't clash), and at 5–6, where the table is mostly a lottery, they bid plainly.
- **Sea Battle:** probability-density targeting (hard), hunt-and-target with parity (normal).
- **Lucky Letters:** the hard bot picks consonants by matching the revealed pattern against the 172k-word dictionary, and solves when each word has only one possible fit. All bots recognise familiar phrases once enough letters show; the stronger the bot, the sooner it notices.
- **Doodle Dash:** bots "recognise" each picture at a random point in the drawing (sooner on harder levels), take a moment to type, and sometimes blurt out a wrong guess first.
- **Bingo Bash:** bots only know the called balls. After each ball they look over their cards after a delay (easy 1.5–4 s, hard 0.3–0.8 s), easy bots miss a number now and then (they catch it on a later look), and they claim with a lag (easy often lets a line go cold, or sleep, or loses a race's split window). Hard bots play 4+ cards, spend wild daubs on the cell nearest the target, and freeze the leader; easy bots shout a false BINGO! 3% of the time when there's a penalty.
- **Light Riders:** bots steer toward open space (a flood fill). Hard bots, once three or fewer riders remain, fight for territory: they count the cells they can reach before any rival can, refuse head-on gambles, and only boost onto a clear straight. They never drive into a cell a rival could also take.
- **Whisker Run:** bots decide at every cell with breadth-first searches of the maze. Mice head for the nearest crumb whose whole path stays ahead of every cat, take a nearby bell when a cat closes in, chase panicking cats they can reach in time, and otherwise run for open space; a mouse hole counts as safe only while no cat is near either end. Cats path around mouse holes. Normal and hard cats chase by maze distance (easy ones go as the crow flies, and wander); hard cats race for the junction a mouse is heading to and cut it off there. Alley cats play like normal cats, a little slower.
- **Paint Blast:** bots map where every ticking bomb will blast (chain reactions included) and when, run for the nearest safe tile, and only drop a bomb when they can still escape it. They then head for the spot worth the most (crates to break, floor to paint, rivals to catch, power-ups) per step of walking. Hard thinks every tick and values paint and rivals more; easy reacts slowly and sometimes walks into its own blast. In simulation hard won 4 of 6 three-way games.
- **Sumo Saucers:** bots keep away from the rim, pick the rival easiest to push out (near the edge and near them), line up on the inside of it and dash outward through it. Normal and hard bots sidestep a rival's dash and step out from under a meteor, and they grab an orb when nobody is close enough to charge them (hard bots from further away). A bot's ghost hunts the leader, aiming where it's heading. In simulation (`python3 tests/sumo_sim.py`) hard beat normal 16–0; rounds last about 10–35 s.
- **Hover Rally:** bots look ahead for the next bend, take the inside line, counter the outward push and correct toward their line; they dodge out from behind rivals. Hard reacts fastest, looks furthest ahead, hunts boost pads and boosts on straights. Normal and hard tuck into slipstreams, steer round mines and sidestep missiles closing in on them. Every bot fires a missile at a rival a short way ahead, drops a mine in front of one close behind and raises a shield when a missile is coming (hard most eagerly). On 🚧 features, bots keep inside narrows, normal and hard hold the middle on ice and boost before a ramp when they're too slow to clear the gap; hard and normal also nail the 🚀 start boost now and then. On the same track with no bumping, hard finished first in 6 of 8 races, normal second, easy third, and a craft that never steered last every time.
- **Air Hockey:** bots line up behind the puck on the line to an aim point (sometimes a bank shot off the wall), then strike through it. They guard their goal when the puck is away. Levels differ in reaction time, mallet speed and aim.
- **Spire Siege:** bots run their own towers on the server and choose placements by stack height, holes and bumpiness. Difficulty sets their speed and accuracy.
- **Prism Pop:** bots play their own boards on the server, on their own clock, and wait out each cascade's animation the way a player's screen does. Easy plays any match it sees and never attacks; normal picks one of its three best first clears and attacks half as often; hard looks at the whole cascade it can see (never the gems that haven't fallen yet) and favours specials, attacks and moves low on the board. Roughly 2,000 / 5,000 / 9,500 points in 90 s. Each round's scores (human or bot) go to the server log as a `[prism]` line for tuning.
- **Marble Rush:** bots roll along their route at 1.9 / 2.5 / 2.9 cells a second (easy / normal / hard), brake 0.25 / 0.15 / 0.1 s into each corner, dare the 🔥 shortcut 15% / 50% / 85% of the time (else the 🌿 way round, with its pad and gem), fall into a hole on the way 20% / 8% / 3% of the time (×1.5 on the shortcut; back to their last flag), detour for a gem only when it's worth the second (never / half the time / always), and pick a random perk between boards (🛡️ skips a fall, ⚡ a little faster, 🧲 gems a cell away are free). About 24 / 16 / 12.5 s on a medium board.
- **Kindred:** easy plays at random half the time; otherwise each bot places for the most points now and hands over the piece whose best reply scores least. The last 4 (normal) or 6 (hard) squares are searched exactly (memoised; about 0.1 s). Hard beat normal 14–3 (3 draws) over 20 games.
- **Moon Shot:** the hard bot steers for stars, avoids meteors, aims for wormholes when it's behind, and takes more risk the further back it is.
- **Sky Drop:** bots steer for the next ring, leading for their own drift. Each ring they roll whether they line it up properly or drift toward a spot beside it, so easy / normal / hard thread about 40% / 60% / 80% of the rings (easy also reacts slower and wobbles more); a steady human beats easy and often normal.

## Around the games

- **Settings.**
  - Each game's options appear in the lobby automatically.
  - Room options: turn timer, 🔒 lock the room, and a ghost chat rule.
  - Each game remembers its last settings when you switch away and back.
  - The host can remove players, and every settings change is noted in the log.
  - ⚙️ **My settings** (stored on your device): sound, vibration, animations and chat pop-ups.
- **In the lobby.**
  - Players who aren't the host tap a game tile to 🙏 ask for it (#70); tap it again to take it back. The tile shows how many
    asked, the player list shows each request, and the host still picks whatever they like. A request clears when that game starts.
  - 👁 **Watch** next to your name sits you out of the following games as a spectator until you tap 🙋 **Play** (#71).
- **When a game ends.**
  - The host picks 🔁 **Rematch** (same game and settings, instant) or 🏠 **Lobby**.
  - Everyone can tap 🙋 **I'm in!** so the host sees who wants more.
- **Replays.**
  - ▶ **Replay** plays the finished game move by move as soon as it opens (#68): pause, step, or drag the slider.
  - It shows the spectator's view, so every secret face, hidden choice and culprit is visible.
  - The last game's replay stays available from the lobby.
  - It says it's a replay (#60): a heading in the replay bar explains what you're watching, and a dashed frame
    with a ▶ REPLAY tag surrounds the board.
- **Score keeping.**
  - A scoreboard for the evening, ranked by ⭐ points (+3 win, +1 played, −2 for walking out mid-game): wins, games played, 🔥 best streak, 🏅 badges, and wins per game.
  - 🔥 A win streak of two or more shows on the player's chip, and the results card says so ("has won 3 in a row").
    📈 It also calls a new room record for a game's winning score (highest, or lowest for Hearts and Shut the Box).
  - 🏅 **Badges**: every game has *Giant slayer* (win against a hard bot), and most have one or two of their own, like
    ⛵ Yacht!, 🌙 Shoot the moon, 📦 Shut it!, 🧹 Clean sweep, 🎯 Hole in one or 💎 Mastermind. Each game's ❓ help lists its
    badges and ticks the ones you have. They're counted for the evening, kept if you leave and come back, and the first of
    each kind is announced in the log with a fanfare. Bots don't earn them. Games award them with `self.award(p, key)`.
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
- **Game screens load on demand.** `index.html` loads only the shell (kit, fx2d, patience, gl3, faces,
  qr, profile, app); `needUI(id)` in `app.js` fetches `/games/<id>.js` the first time that game is shown
  (and the lobby prefetches the picked game). A screen that needs a helper file first is listed in
  `UI_EXTRA` (Billiards → `billiards3d.js`, Chess → `chess3d.js`).

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
`UI.<id> = { mount, render }` module in `static/games/<id>.js` (no `<script>` tag: game screens load on
demand, see below); then the
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

**Air Hockey**, **Light Riders** and **Paint Blast** work the other way round, because players share the same puck or
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
| **Server restart or crash** | Rooms are saved to `data/rooms.pickle` every few seconds (only rooms that changed are re-saved) and restored at startup. Turn timers restart in full. Open pages reconnect on their own. A game saved by older code that no longer fits goes back to the lobby with a note instead of crashing. |
| **A bug in a game** | A move that hits one gets an error message at once (500 with `bug: true`, not retried), and the room carries on. A view that fails is skipped for that update; the live stream stays open. Tracebacks are printed at most once a minute per spot; routine disconnects aren't logged. |
| **Room really gone** | Only a definite "room not found / not in this room" answer from the server clears your saved seat. Network errors never do. |

## Server health (for lag reports)

On the device running the server, `curl localhost:8000/api/health` shows the live numbers: the 60 fps frame clock's
gaps (p50/p95/max over the last minute), room-save times, garbage-collector pauses, the slowest bot moves, rooms,
open streams, threads and memory. Any frame gap over 60 ms, save over 40 ms, GC pause over 40 ms or bot move over
100 ms also prints a `[slow]` line in `data/server.log`, so a "lag spike" report can be matched to its cause.
`tests/perf_bench.py` measures the same numbers with busy bot-only rooms.

## Testing

```bash
python3 tests/jscheck.py static/app.js static/games/*.js   # structural check, no Node needed
python3 tests/csscheck.py                                    # layout lint (jsdom does no layout)
node --check static/app.js                                  # real syntax check (Node.js)
python3 tests/billiards_physics.py                          # billiards shot engine, and the aim guide's copy of it
python3 tests/billiards_rules.py                            # billiards rules (push-outs, fouls, breaks) on a scripted engine
python3 tests/blackjack_bets.py                             # Blackjack bets: built from chips, all-in, last bet repeated, Perfect Pairs
python3 tests/stability.py                                  # server keeps going: broken restored games, failing views/saves, 500s
python3 tests/perf_bench.py 20                              # frame-clock gaps, save and GC times with busy rooms (one core: keep short)
python3 tests/wordbomb_rules.py                            # Word Bomb: chunks, hidden fuse, hearts, 🔤 alphabet, 📏 long words, bots
python3 tests/unmask_rules.py                              # Unmask: the 🎲 Bold guess badge
python3 tests/ladder_rules.py                              # Word Ladder: 🔎 peek, once per step, a point off the finish
python3 tests/heist_rules.py                               # Night Heist: the 🕵️ inside man tip-off
python3 tests/patience_rules.py                            # FreeCell + Solitaire: same deal, rules, hidden cards, scoring, bots
python3 tests/puzzle_rules.py                              # Sudoku + Word Search: unique puzzles, digits, finds, grab, scoring
python3 tests/garden_rules.py                              # Word Garden: layouts, hidden letters, bonus words, 💧 hints, no-clock rounds
python3 tests/whisker_rules.py                             # Whisker Run: maze sizes + themes, mouse holes + paws, glide head start, bot games
python3 tests/lantern_rules.py                             # Lantern Market: unique bids, carry-over, lantern, last lot, events
python3 tests/prism_rules.py                               # Prism Pop: matches, specials, combos, cascades, frost/stones, act validation
python3 tests/marble_rules.py                              # Marble Rush: courses, forks, finish checks, perks, rounds, totals, bots by level
python3 tests/doodle_rules.py                              # Doodle Dash: late letters in the last-chance time
python3 tests/bingo_rules.py                               # Bingo Bash: all four styles, power-ups, penalties, sleepers
python3 tests/archery_rules.py                             # Wind Archery: drift, rings, apple, steady breath, act validation, shoot-off, course (balloons, swing), fire arrows, streaks, old saves, bot levels
node tests/bingo_kit.js                                    # Bingo tools: win patterns, call parsing, card checks
cd tests && BASE=http://localhost:8767 node bingo_scan.js  # Bingo tools: scan a drawn card photo (needs Chromium)
PORT=8767 python3 server.py &                               # a separate test server (own rooms-8767.pickle / feedback-8767.jsonl)
cd tests && npm install && BASE=http://localhost:8767 node ui.js          # every game
BASE=http://localhost:8767 node ui.js chess spire                          # just some
```

```bash
BASE=http://localhost:8767 node layout.js            # every game at 485 and 1280 px in real Chromium (about 10 minutes)
BASE=http://localhost:8767 SHOTS=/tmp/shots node layout.js yacht go    # some games, with screenshots
OFFLINE_GRACE=2 PORT=8768 python3 ../server.py &     # jumps.js needs a short autopilot grace
BASE=http://localhost:8768 node jumps.js             # does anything move while the game is played? (about 20 minutes)
```

`jumps.js` (#18) starts each game solo at 485 px and blocks the page's presence heartbeat, so autopilot plays your seat
while the page keeps receiving every update. It samples the game area every 120 ms and reports every time a board, a row of
dice or a hand moves up or down, naming what above it grew or shrank. A move when the stage changes (placing ships, then
battle) is expected; one on every turn is the bug.

`tests/` also installs **playwright-core** for checks in a real browser (layout, WebGL), which jsdom can't do. It drives the
system Chromium (`chromium.launch({ executablePath: '/usr/bin/chromium' })`) and downloads no browsers of its own. On Kali,
the `python3-playwright` apt package doesn't work on its own: it needs the separate `node-playwright` package for its driver.

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
- ✅ **Phone-first layout.** The game log folds into a one-line ticker in the dock, so controls sit right under the
  board. Player chips scroll sideways instead of wrapping. Boards are capped to the screen height, which
  also covers landscape.
- ✅ **In-app dialogs.** Every `confirm()` / `prompt()` is replaced by a styled dialog (resign, accuse,
  pass, leave, remove player, reset scores, invite link). Escape or tapping outside cancels.
- ✅ **Better game picker.** Games are grouped by category (*Party · Action · Strategy · Quick classics · Cards ·
  Dice & casino · Words & puzzles*), and each group picks its column count so its rows fill evenly (#43). Games that don't fit the current player count are dimmed, with a reason ("needs 2+",
  "max 4"). Each game has **How to play** rules in the lobby and a ❓ button during play.
- ✅ Visible keyboard-focus outlines, and `prefers-reduced-motion` is respected automatically.
- ✅ **Graphics pass.** A slowly drifting ambient background, glossy buttons with press feedback, and depth on
  every board (wood frames, glossy discs and checkers, a wood-grain goban, felt and water gradients). Motion
  explains each move: chess and checkers pieces slide from their origin square, Drop Four discs fall and
  bounce, Go stones and tic-tac-toe marks pop in, the new top card is tossed onto the Last Card pile, Sea
  Battle shots splash, and Dots & Boxes lines draw themselves while boxes fill in. A gold glow marks the start
  of your turn, and winning brings confetti and a shimmering banner. The Animations setting and
  `prefers-reduced-motion` turn all of it off.

**Still to do** (in priority order):
1. **Screenshot checks come first.** #44 (invisible dice pips) passed every automated test, because
   jsdom doesn't lay pages out. A Playwright pass that screenshots each game at 485 px and checks key
   elements have a real size would have caught it.
2. ✅ A shared results card for multi-round games and reserved heights so nothing jumps (#17, #18): see *Across all games*
   below.
3. **A real-device check of the 3D views and the touch feel** (Light Riders, Paint Blast, Billiards),
   which a simulated browser can't judge.
4. ✅ **A dock and bottom sheets.** On a phone the reactions, the latest log line and chat share one dock
   under the game; the log, chat and settings open as bottom sheets over it, and the ⋯ menu in the top bar
   holds bigger board, full screen, chat, settings and leave. A phone on its side drops the dock and chips
   row and puts the log back in the side column. `app.js` measures the room a board has (`--stage-h`,
   `--room` in `style.css`), so boards no longer guess the chrome's height; `.stick-top` / `.stick-bottom`
   keep a game's main controls in view over a long card or list (Yacht's dice, Sea Battle's Ready). A pressed
   button shows a spinner while the server answers and shakes if the move is refused. ✅ Undo toasts: `toast(msg, { label, run })` adds a button; Unmask offers ↶ Undo after a batch flip
   (Wordsmith already has Recall).
5. ✅ **More motion.** Animated captures in Chess, cards dealt into the Last Card hand, and a "your turn"
   chime for each lobby group (strategy, cards, dice, words… each sound different).
6. **Accessibility.**
   - ✅ Player colours that are safe for colour-blind players, with a shape as well (never colour alone). The
     palette is reordered so the first seats stay far apart under simulated protanopia, deuteranopia and
     tritanopia (the closest pair among 3 players went from ΔE 5 to 18), and every colour has its own shape
     (● ▲ ■ ◆ ★ ✚ ⬟ ⬢) in the player chips, the lobby list, and every player dot a game draws.
   - ✅ Screen-reader labels on every board square ("e4, white knight") in Chess, Checkers, Go,
     Tic-Tac-Toe, Drop Four, Reversi, Sea Battle and Ultimate Tic-Tac-Toe.
   - ✅ Keyboard play on those boards: arrow keys move between squares (skipping ones you can't
     press yet), Enter or Space plays. The shared `gridKeys(box, cols)` in `app.js` adds it to any grid.
   - Contrast checks, and text that scales with the browser font size.
7. **Themes.** ✅ ⚙️ My settings → Theme: 🌙 Dark, ☀️ Light or 🌓 Match my phone. Light turns the home screen,
   lobby, chips, log, drawers and dialogs light (text checked at WCAG AA, 5:1 or better) and keeps the game
   table and its side panel on dark felt, since every board, card and canvas is drawn for it. Still to do:
   board themes (wood, classic, high-contrast) and card-back styles.
8. **Identity and social.**
   - ✅ Avatars generated with the Unmask face generator: every player gets a face picked by their name (the same
     on every phone), shown in the player chips and the lobby list.
   - ✅ A colour picker and rename in the lobby (✏️ next to your name, between games; names must be
     unique in the room and colours can't be shared).
   - ✅ A QR code for the invite link (📲 in the lobby). `static/qr.js` is a small dependency-free encoder
     (byte mode, level M, versions 1–9), checked bit for bit against the `segno` library across five
     versions and all eight masks. A host on the server's own device gets the Wi-Fi address in the link,
     since "localhost" means nothing on a friend's phone.
   - ✅ Spectators show as "👁 watching" on their player chip.
9. **Game-specific polish:** see the per-game plan below.
10. ✅ **Installable app (PWA).** A web manifest with a 🎲 icon (`static/icons/`, drawn by a tiny
   pure-Python PNG writer) for home-screen install and full-screen play; a service worker (`static/sw.js`)
   that serves the network first and falls back to the cached app shell after 1.5 s or when offline
   (the API is never cached); and a screen wake lock while a game is in progress. Browsers only allow
   the service worker and the wake lock on HTTPS or localhost, so on a plain-HTTP LAN address they quietly
   stay off (the manifest still gives an "Add to Home screen" shortcut).
11. **Rendering performance.** Update the log, chat and player chips in place instead of rebuilding
   them on every update. Send changes rather than the full state for large boards (19×19 Go,
   Wordsmith).

## Improvement plan: round 2 (October 2026)

Almost everything in the per-game plan below is done, so this is the next list. **S/M/L** is a rough size estimate.
Items that become ✅ move into the per-game plan.

**Across all games**
1. ✅ **Layout check in a real browser:** `tests/layout.js` starts every game at 485 and 1280 px in Chromium and fails on sideways
   scrolling, a game area with no size, visible elements squeezed to nothing (#44) and JavaScript errors. Its first run found
   13 games that scrolled sideways on phones, all fixed.
2. ✅ **A shared results card** between rounds: `Game.mark_round()` / `standings()` on the server and `standingsCard()` in
   app.js show each player's gain, running total, rank and ▲/▼ places moved. Used by Grid Hunt, Safecracker, Lucky Letters,
   Doodle Dash and Shut the Box.
   ✅ **Nothing jumps (#18):** `tests/jumps.js` lets autopilot play each game in Chromium and reports every time the board or
   the controls move. It found 12 games that moved on every turn, all fixed: hint lines that emptied out (Reversi, Oware,
   Ultimate), Backgammon's dice row, a global `.preview` margin that made Yacht's score rows and Moon Shot's track 12 px taller
   every turn, Farkle's wrapping dice and buttons, Ship Captain & Crew's empty dice row, Safecracker's guess list (now a fixed
   height, so the colour pad stays put), Twenty-One's Hit/Stand bar (now under the dealer, above the seats that grow with each
   card), Odd One Out's clue box (now under the clues), Rummy's first meld and Paint Blast's clock. It also caught a Putt error
   on the first frame of every shot. What still moves is a stage change (Sea Battle placing → firing, Cribbage's count).
3. ✅ **Even the 🎲 Dice & casino row again:** Qork made it 7 games; 📦 **Shut the Box** makes it 8 (46 games).
4. **Keyboard and screen-reader play** in the boards that still lack it (Backgammon, Oware, Ultimate, Morris, Dots & Boxes,
   the card games, Yacht, Farkle) using the shared `gridKeys`. **M**
6. ✅ **🎵 Move sounds:** every move now makes a sound, picked by the game's lobby group: a wooden click for board games, a
   card flick, a dice rattle, a soft pop for word and party games, a capture thud and a little fanfare for big moments. All
   synthesized; switch them off with 🎵 in the settings (🔊 still mutes everything). All of them pass through one output with a 🔉 volume slider, a gentle low-pass and a soft compressor, and the chip, card and tick sounds are soft clacks and swishes rather than pings (#57). Games can ask for one with `ctx.sfx(kind)`.
7. ✅ **Shared 3D layer** (`static/gl3.js`) for the seven three.js games: three.js loads once, the picture drops to a lower
   resolution when frames get slow and climbs back when they're smooth again, and when a phone throws the GPU away
   (switching apps) the game builds a fresh 3D view instead of freezing on a black one. Camera shake for hits (Sumo, Riders).
5. ✅ **🙋 Join in mid-game** for Odd One Out, Safecracker and Shut the Box. (Grid Hunt already could; Yacht can't fairly,
   since a late card would make everyone wait for its twelve boxes.)

**Party**
- 🎭 **Unmask:** ✅ a 🗒️ clues panel: each answer you've had, how many faces it ruled out, and how many still fit.
- 🕵️ **Odd One Out:** word pairs written by the host; join between rounds. **S**
- 🖍️ **Scribble Relay:** a fill tool, and a timer per step so slow drawers don't stall the table. **M**
- 🧠 **Trivia Rush:** ✅ a 🔥 streak bonus (+50 per right answer in a row from the third, up to +150). Still to do: a host-supplied question pack. **M**
- ✏️ **Doodle Dash:** a mode where players draw and the rest guess (Relay's canvas). **L**
- 🦹 **Night Heist:** a two-player balance pass in simulation. **S**

**Action**
- 🗼 **Spire Siege:** ✅ a 🧱 incoming-junk meter: junk sent to you waits 3 s on the edge of your well (flashing when it's
  about to land), and every ring you clear before then knocks it down. Still to do: a solo sprint/marathon with a best-score table. **M**
- 🏍️ **Light Riders:** check the swipe fixes on a phone (#14); 2v2 teams. **M**
- 🎨 **Paint Blast:** 3D tiles; teams. **L**
- 🪐 **Sumo Saucers:** ✅ a 🍩 ring arena with a pit in the middle (or 🔀 alternating with the disc each round); bots keep off
  both edges and only charge toward the pit from well back (hard beats normal 21–8 in 30 three-bot games). The camera shakes
  when you're shoved. ✅ **Fun pass:** ⚡ power-up orbs (🪨 heavy, ⚡ shockwave, 🔁 turbo dash, 🛡️ shield; a setting), 👻 ghosts
  (players who are out steer a ghost and drop ☄️ meteors; a setting), 💥 a knockout count per player, a red rim warning 3 s
  before each shrink that now eases in, and 💀 sudden death after 75 s (no bumpers, keeps shrinking). Looks: sparks and shock
  rings on hits, dash spark trails, bumpers that shatter into shards, the rim crumbling as it shrinks, blob shadows, underglow
  lights, a panelled deck, a nebula sky with a planet below, a dash-cooldown arc round your saucer, and a camera that closes
  in as the platform shrinks. Sounds for everything (synthesized, like Hover Rally's), countdown beeps, and "Double
  knockout!" / "Last two!" call-outs. The server sends hits, shatters, falls and pickups as numbered events. Still to do: a
  figure-8. **M**
- ⛳ **Putt Party:** ✅ playable on phones: the 3D camera now fits each hole (the tee row, with your ball, used to sit below the
  bottom of a phone screen), a touch while a putt rolls skips to its end instead of silently ignoring your drag, the power bar
  moved off the tee, and the scorecard total sits in its column. ✅ **Camera controls:** two fingers pan, pinch to zoom and
  twist to turn the view (mouse: wheel zooms, right-drag pans); buttons on the view turn it 45°, zoom, 🎯 stand behind your ball
  facing the cup, ⛳ show the whole hole, and ✋ make one-finger drags move the view instead of aiming. Your ball has a ring
  under it (pulsing on your turn). ✅ **Round 3:** a putt has to start on your ball (a drag anywhere else pans the view; a
  right-drag turns it); after each of your putts the camera swings round behind your ball looking down the fairway; putts play
  back one after another and the next player (bot) waits for the ball to stop, so balls no longer jump; and after the last putt
  of a hole there's a pause with the hole's strokes and the standings before the next hole. ✅ **Round 4 (feedback #18–28):**
  a drag away from the ball turns and tilts the view (right-drag pans; keys ← → ↑ ↓, W A S D, + −); full power is a shorter
  pull; the camera follows your rolling ball; a waving flag; dimpled balls that visibly roll; shadows, mown grass and the rough
  around the course; ⛰️ humps and bowls, ▪️ posts and 🌑 rocks; three grass lengths (fairway, fringe, long rough) with their
  own friction and visible blades; corner banks, straight or curved; a 🌀 windmill whose sails close its doorway on a clock
  (the server simulates the putt against the sails' real position, so you time your shot); a ramp jump over a stream; a
  splash with ripples when a ball goes in the water; and collision effects: rings, a bumper that squashes, flashes and boings,
  knocks and a cup rattle. Each hole has its own par (4 with a jump or a windmill). ✅ **A golf scorecard:** a par row, birdies circled, bogeys
  boxed, a ± to-par column, and the between-holes card names the result (🐦 Birdie!, Par, Bogey…). Still to do: a course of the day. **M**
- 🛸 **Hover Rally:** ✅ ⏱ lap splits (each lap's time, faster/slower than the last, the best starred, called out on screen)
  and a 👻 ghost of your best lap so far racing beside you. ✅ **Feel:** a craft model that leans into turns and lifts its
  nose on boost, light trails, sparks off walls and bumps, camera shake, pulsing chevron boost pads, and synthesized sound
  (an engine hum pitched by speed, pad and boost whooshes, bump thuds, wall scrapes, 3-2-1-GO, a lap chime). ✅ **💨 Slipstream:**
  close behind a rival on a straight your top speed rises (15 → 17.5) so you can pull out and pass. ✅ **🚀 Missiles**
  (setting, on by default; not in solo): pickups give one homing missile; a hit keeps 35% of your speed and spins you for
  0.7 s, then 2 s of protection; a warning beep while one is locked on you. About 70% of shots land against bots that dodge.
  Next:
  - ✅ 🗺️ A minimap in the top corner of the 3D view (track outline, the line, every craft with you ringed, missiles in
    flight), and when you're watching, the chase camera follows the leader instead of a fixed overhead view.
  - ✅ 📳 Phone vibration when you're hit, your shield blocks, you bump someone, or you cross a pad or a pickup (follows the
    📳 Vibrate setting).
  - ✅ 🎁 Random items from the pickups: 🚀 a missile, 💣 a mine dropped behind you (armed after 0.6 s, lasts 25 s, hits its
    owner too) or 🛡️ a shield (6 s, stops one missile or mine). The leader gets a mine half the time and a missile 20%; last
    place gets a missile 70%. In 4-bot races about 70% of missiles and mines land, and easy still finishes last.
  - ✅ 📅 Today's track (lobby setting): the same track in every room for the day (seeded from the date, like Grid Hunt's
    daily grids). The server times every lap; people's laps go on a board for the day (top 10, kept in
    `data/rally-daily.json`, shown in the side panel), and your best lap from earlier in the day is kept on your device
    and comes back as the 👻 ghost.
  - ✅ 🚧 Track features (lobby setting, on by default): two or three per track, away from the line. ❄️ Ice (a quarter of
    the steering, bends push 30% harder), narrows (the track pinches from 2.4 to 1.4 half-width) and ramps over a 7-unit
    gap: a jump carries speed × 0.6 s, so a craft under about 11.7 (after a hit or a wall) falls short, drops into the pit
    and is put back past it, slow and spinning. Mines miss craft in the air and can't be laid on a ramp. Bots hold the
    middle on ice, keep inside narrows and boost before a ramp when they're slow; in 20 four-bot races hard still
    averaged 1.7th, normal 2.6th and easy last, with about one fall in ten races.
  - ✅ 💥 Elimination mode (lobby setting): each time the leader completes a lap, whoever is furthest back is out and takes the
    lowest place still free; the last one flying wins (laps don't apply). Six racers take 5 laps, about 80 s. Knocked-out
    craft settle onto the track with their engines off.
  - ✅ 🎮 Analog touch steering (the further from the middle you hold, the harder you turn, in quarter steps) and a 🚀
    start boost: press boost in the last 0.45 s before GO to leave the line at 9 with a short boost; earlier than 1 s
    stalls you. Hard bots nail it 70% of the time, normal 35%.
  - ✅ 🏔️ Hills and scenery in the 3D view: gentle rises and dips (drawing only, the race stays flat; level at the line and
    over ramps, gaps and narrows) with embankments down to the ground, glowing pylons along both sides, arches over the
    track with a checkered one at the line, and a ring of mountains fading into the fog. Craft pitch with the slope.
    ✅ Then: banked bends (the outside edge rises with the curve, up to about 16°, level at the line and over features;
    craft and camera roll with it, and boost pads lie on the slope), a sky dome glowing violet at the horizon with stars
    and a ringed planet, clusters of glowing crystals on the ground, and a grandstand at the line whose crowd jumps
    as craft go by (still with 🧘 calm). Sparks and smoke now start from, and bounce off, the track surface on the hills.
- 🏒 **Air Hockey:** 2v2 with four mallets. **M**
- 🎱 **Billiards:** ✅ the 3D table; ✅ a 9-ball variant; ✅ a livelier break, push-outs and match play; ✅ the cue strokes
  and a ⏪ replay; ✅ the aim guide no longer drifts on hard shots near the foot rail (the server now sends exact
  ball positions; a ball rounded to 0.01 had sent the guide up to about a unit off the real path).

**Words & puzzles**
- 🎡 **Lucky Letters:** a bonus round for the winner. **M**
- 🔤 **Wordsmith:** ✅ a turn history (each player's words and points, swaps and passes, the best play starred). ✅ Optional blank tiles (lobby setting): a blank is any letter you pick after placing it, scores 0 and shows its letter in italics; bots and 💡 hints use blanks too.
- 🔎 **Grid Hunt:** ✅ 📅 today's grids, the same in every room (like Word Ladder's daily ladders).
- 🔐 **Safecracker:** ✅ 📅 today's safes (the codes come from the date and settings).
- 🤥 **Fib Finder:** more facts in the thinner topics. **M**
- 🧗 **Word Ladder:** a missing-rung puzzle mode. **M**

**Strategy**
- ♟️ **Chess:** a stronger hard bot (quiescence search, transposition table, small opening book); Chess960. **M–L**
- ⛀ **Checkers:** ✅ undo requests and draw offers, like Go and Chess.
- 🔺 **Backgammon:** ~~a pip count~~: it already shows both pip counts by the players' names.
- ⚫ **Go:** ✅ handicap stones (2–9, on the star points; White moves first, komi 0.5) and a komi setting.
- 🌰 **Oware:** ✅ undo requests (shared with Reversi, Ultimate and Checkers: `games/undo.py`).
- ⚪ **Reversi:** ✅ a flip-hints option and undo requests.

**Cards**
- 🃏 **Last Card:** play several cards of one rank at once (option). **M**
- ♠️ **Texas Hold'em:** ✅ your best hand named live under your cards ("Pair of 7s", "Kings full of 3s").
- 📍 **Cribbage:** ✅ 💡 Suggest a discard (against bots only): picks the cards the hard bot would throw and says what the
  four you keep score on average over every starter.
- ♥️ **Hearts:** ✅ an optional 💎 J♦ −10 (bots keep it, and win tricks for it).
- ⚡ **Speed:** the face-to-face two-phone layout. **M**
- 🀄 **Contract Rummy:** "may I?" buys of the discard out of turn. **M**

**Quick classics**
- 🚢 **Sea Battle:** ✅ a 12×12 sea with a sixth ship.
- 🔴 **Drop Four:** ✅ ⬇️ pull-outs (an option): take one of your own discs out of the bottom row instead of dropping.
- 🔳 **Dots & Boxes:** ✅ an endgame hint listing the chains and loops left once every line gives boxes away.
- ❌ **Tic-Tac-Toe:** ✅ a 4×4 board, four in a row (Vanishing keeps 4 marks there). ✅ The newest mark is outlined.
- #️⃣ **Ultimate Tic-Tac-Toe:** ✅ undo requests. (It already outlined the last move: the plan was wrong.)
- ⚫ **Nine Men's Morris:** ✅ a Twelve Men's Morris option (12 men, corner diagonals).

**Dice & casino**
- 🚀 **Moon Shot:** ✅ solo: reach the moon within 4, 6 or 9 turns (a hard bot alone makes it 53–61% of the time).
- 🎲 **Yacht:** ✅ optional bonuses: +35 for 63 in Ones–Sixes (the card shows progress, 41/63) and +50 per extra Yacht; bots play for them.
- 🎯 **Farkle:** ~~extra scores~~: three pairs and the 1–6 straight already score 1,500.
- 🥤 **Qork:** collect real-phone reports on reaction fairness. **S**
- 🚢 **Ship, Captain & Crew:** ✅ a solo best-hauls table (shared `soloBest()` in app.js, also used by Shut the Box).
- 🤥 **Liar's Dice:** ✅ an optional 🗿 palifico round when someone first drops to one die (not with two players left).
- ♦️ **Twenty-One:** ✅ ✂️ splitting pairs: up to four hands, one card each on split aces, double after a split; bots split by basic strategy.

## Per-game plan (with player feedback)

Numbers like **#13** are reports in the feedback inbox (`data/feedback.jsonl`).

**Done from feedback:** 3D chess (#3) and chess clocks (#5), Air Hockey (#1), Light Riders (#4), the
Doodle Dash keyboard fit (#7), a loading screen instead of a blank one (#8), full screen (#9),
swipes that can't scroll the page (#10), the 🧱 flat well (#11), a full-screen icon that is an SVG
instead of a glyph many Android fonts lack (#16), a 4.5 s solve celebration in Lucky Letters before
the next puzzle (#17), a fixed-height Lucky Letters action area so the page stops jumping (#18),
thousands separators for money and scores (#19), and **focus mode** (the ▣ button in the top bar
hides the player chips, log and floating buttons so the board fills the screen; Spire Siege, Light
Riders and Air Hockey start in it) (#13, #15).

**Across all games**
- A real-phone screenshot pass at 485 px wide. Every phone report came from a 485–555 px screen (#6, #18).
- ✅ Reserve space for status lines and action rows in the other games too (#18): see `tests/jumps.js` above.
- ✅ A short results card between rounds (#17): the shared standings card in Grid Hunt, Safecracker, Lucky Letters, Doodle Dash and Shut the Box.
- 🗳️ ✅ **Next-game voting** (#25): the game-over banner suggests five games that fit the table
  (skipping recent ones) plus an "Other game…" list. Tap to vote, tap again to take it back. When every
  human picks the same game it starts at once; otherwise the host taps **▶ Play the vote winner** (a
  tie goes to the host's pick). Each game keeps its own settings. Bots don't vote. (The room action is
  `next_vote`: an earlier `vote` name swallowed Odd One Out's in-game vote, #33/#34.)
- ✅ Taps no longer get lost while bots act (#33, #34): the game screen skips redraws for chat- and
  reaction-only updates, and Odd One Out / Fib Finder update their buttons in place.
- ✅ **🙋 Join in mid-game** (#36): someone who arrives while a game is running gets a "Join in" button
  in games that can take them: Texas Hold'em (from the next hand, full stack), Lucky Letters and Moon
  Shot (0 points, next in seat order), Doodle Dash, Fib Finder, Grid Hunt and Safecracker races (start
  guessing/writing at once), Odd One Out (from the next round, since watchers have seen this round's
  words) and Shut the Box (from the next round; each missed round counts as that round's worst score).
  Board games and the rest say no politely and seat them for the next game. A game opts in by defining
  `late_join(p)`.
- ✅ **⚙️ Options first** on the home screen sets up a solo game in the lobby so you can change its
  options before starting (#32).
- 🏅 ✅ **Overall points** (#31): **+3 ⭐** for a win, **+1 ⭐** for playing a game to the end (draws and
  knock-outs included), **−2 ⭐** for walking out of a game in progress. The scoreboard ranks by ⭐, player
  chips show it, and the game-over banner says what you earned. The room remembers each human's evening
  by name, so leaving and rejoining keeps your points (and the penalty). A dropped connection (autopilot)
  or being removed by the host is not a walk-out. Resetting the scoreboard clears points too.
- ✅ **Phone clean-up:** the game-over banner folds to one line (▴/▾, remembered) so the final board
  stays in view; "I'm in!" only shows when there are other people to tell; the top bar keeps the turn
  text on one line; every game leaves room under the floating ⚙️ 💬 buttons (#29 everywhere).

**Action / real-time**
- 🎱 **Billiards:** ✅ added (#12). ✅ Dragging now turns the cue like a dial around the ball, so
  touching the stick no longer flips the aim 180° (#28). ✅ It starts in focus mode, so the floating
  buttons no longer cover Shoot (#29), and the cue is a full-size tapered stick (#30). ✅ Spin: a follow / draw slider; after the
  cue ball's first hit it rolls on or screws back. ✅ 📣 Calling the 8 (on by default): tap the pocket you're aiming at;
  the 8 in any other pocket loses (bots call theirs too). ✅ Pinch zoom (#28): two fingers zoom the table up to 3× and
  pan, without moving the aim; 🔍 1× resets. ✅ Ball physics: every ball carries spin, skids until it rolls
  and only then slows at the rolling rate, so follow, draw and stun come from the cloth (a centre hit stops dead
  up close but rolls through from afar, and the cue ball's path bends after a cut); english is real spin that
  cushion friction turns into a sideways kick on any ball; hits are wound back to the exact moment of contact
  (cut angles were up to 19° off) and fast balls sub-step so they can't pass through each other. ✅ Pockets have
  jaws: the cushion ends at a point and an angled facing runs in to the hole, so a ball straight in drops and one
  coming in at a slant or off line can catch a point and rattle out (side pockets only take fairly straight balls).
  ✅ Cushions meet the ball at natural-roll height, so a rolling ball comes off still rolling and a skidding one
  picks up topspin; soft hits keep more speed than hard ones. ✅ Throw: a cut drags the object ball 1–4° toward the
  cue ball's line, and english turns it further or back. ✅ `tests/billiards_physics.py` checks all of it and
  that the aim guide's copy of the engine follows the server's paths exactly (to 0.01, against the server's
  position at every sub-step, so cushion contacts and pocket drops are compared too). The cloth is about 9× slower than a
  real one (so position play stays on the table), which left a break potting almost nothing. ✅ A livelier break:
  the break gets its own top speed (720, about twice a hard shot) and a faster cloth (rolling friction 18 instead of
  70), so about four breaks in ten pot a ball in 8-ball and half in 9-ball; the aim guide uses the same values.
  ✅ Fuller rules: a scratch on an 8-ball break gives ball in hand behind the head line; 9-ball has the 🔀 push-out
  (the first shot after the break needn't hit anything; the rival shoots from there or hands it back) and three fouls
  in a row lose (a warning after two). `tests/billiards_rules.py` checks the rules with a scripted engine. ✅ 🏁 Match play: a race to 2, 3 or 5 racks
  (lobby setting), the break alternating; between racks a card shows who took the rack and the match score. ✅ The cue
  strokes: every shot (the rival's too) opens with the stick drawing back and driving through the cue ball (0.35 s, which the
  server allows for before the result or the next turn), and ⏪ Replay plays the last shot again at 0.6× (tap to stop).
  ✅ A 🏎️ Fast cloth table setting (#54): rolling friction 15 (about a real table) instead of 70, with a top speed of
  320 so the power bar stays usable; a ball at the same speed rolls about 3× further, the same power about 1.5×.
  🐢 Classic stays the default. The bots and the aim guide follow the setting.
  ✅ ⤴ Cue elevation (#45): raise the butt of the cue up to 60°; with side spin the cue ball also rolls sideways
  while it skids, so the cloth curves it toward the side struck (a swerve, or a massé when steep: about 40 units
  sideways over a long shot at 55°), and a steep stroke loses some speed into the cloth. The aim guide shows the curve.
- 🗼 **Spire Siege:** ✅ a 🟦 4-block piece set beside the mixed 2/3/5-block set (#13), a ⇄ hold slot
  (C / Shift / swipe up), and a sharper flat well on high-DPI screens. ✅ 🟦 4-block is now the default
  (#26); the odd shapes are the 🧩 Mixed option. ✅ Normal and hard bots use the ⇄ hold slot (they park a piece and
  play whichever of it and the new piece fits better). ✅ Ring clears call out RING! / DOUBLE! / TRIPLE! / SPIRE!
  (with ×combo), buzz, and shake the stage for three or more. ✅ The flat well (#65, #66) outlines where the
  piece will land, shows the two spawn rows above a dashed top line, has a floor, and shows power cells on the
  falling piece; the 3D ghost is brighter.
- 🏍️ **Light Riders:** ✅ the swipe threshold scales with the arena (18–48 px), a 📳 vibration tick on each
  turn and a longer buzz when you crash, and a countdown overlay. Next: check the swipe fixes on a phone (#14).
- 🏒 **Air Hockey:** ✅ a score-to-win setting, 📳 haptics when your mallet hits the puck and on goals, and a ⏪ goal
  replay: the last 1.4 s before each goal at 60% speed, during a longer (2.8 s) pause before the serve.
- 🎨 **Paint Blast:** ✅ added (#20). ✅ A paint-coverage bar under the clock, and a 📳 buzz when you're
  caught. ✅ 🧱 The walls close in during the last 15 s, a ring every 4 s (an option, on by default); paint
  under them still counts and anyone caught there is pushed inside. ✅ A 👟 kick power-up: walk into a bomb to send
  it sliding until something stops it.
- 🪐 **Sumo Saucers:** ✅ added (#46). ✅ 📳 Haptics when you're shoved and when you fall. ✅ Each round ends with a
  ⏪ slow-motion replay of the knock-off (half speed, inside the pause before the next round). The original plan:
  - Everyone pilots a hover saucer on a round platform floating in space. Drag anywhere to steer
    (momentum, like Air Hockey's physics); tap to 💨 dash, a big shove with a 2 s cooldown.
  - Knock rivals off the edge; the last saucer on the platform wins the round, first to 3 rounds wins.
  - Twist: the rim is lined with glowing bumpers that bounce you back once and then shatter, so the
    edge gets more dangerous as the round goes on, and the platform shrinks every 20 s.
  - Built on `games/hockey.py`'s server physics (circle collisions, 60 fps `frame`, `push_fast`).
    Bots steer to stay near the centre, line up behind a rival who is near the edge, and dash
    through them; harder bots also dodge dashes and save bumpers.
  - It would make ⚡ Action 6 games (two even rows of 3).

**Party**
- 🎡 **Lucky Letters:** done for now (#17, #18, #19). ✅ The 3D wheel's camera now backs off to fit the whole wheel at any stage shape (#27).
  ✅ On a sideways phone (#64) the wheel sits beside the phrase board and the controls beside the game; every
  game gets that side-by-side layout on short landscape screens. ✅ The board keeps room for three lines of tiles, so
  a new phrase doesn't shift the page (#61). ✅ ⏱️ Time to call a letter (#63): 15 s by default (10, 20 or no limit),
  with a bar that empties for everyone. ✅ 💰 Buy a vowel (#62): an optional setting; pay 250 from your round bank at the
  start of a turn or after a right letter (bots buy too, without peeking at the answer).
- ✏️ **Doodle Dash:** ✅ 199 drawings, up from 99, with two new categories (Clothing, Sport): 17 more animals (horse to
  seahorse), 18 foods, 8 vehicles, 7 places, 11 nature pictures, 8 clothes, 10 sports and 21 things. Volcano is now its
  own picture, no longer another word for mountain.
  ✅ 99 drawings, up from 68: ten animals (dog, mouse, duck, pig, owl, octopus, bee, crab, elephant,
  frog), eight foods (grapes, watermelon, hamburger, lollipop, egg, strawberry, donut, cheese), bus, truck, helicopter,
  submarine, bridge, windmill, city, barn, cactus, lightning, snowflake, fire and tornado. A near-miss guess that is
  another picture's name no longer counts ("mouse" for a house, "lock" for a clock, "rain" for a train).
  ✅ 68 drawings, up from 52 (star, heart, envelope, bell, anchor, ladder, candle, hat, sock, ghost, dice,
  book, pencil, spoon, drum, snowman; each checked on the `tests/doodle_sheet.py` contact sheet). ✅ A reveal card for
  each answer: the word, its category, who got it first and how many got it.
- 🕵️ **Odd One Out:** ✅ 50 word pairs (up from 36), and an animated "who voted for whom" reveal: a row per
  suspect, most votes first, the voters popping in one by one.
- 🖍️ **Scribble Relay:** ✅ thin, normal and thick brushes (stored in each stroke's ink number, so older
  drawings and the bots' are unchanged), and 💾 saving a revealed chain as one tall PNG.
- 🧠 **Trivia Rush:** ✅ added (#49), now 228 questions in 9 topics. ✅ The quickest right answer gets a ⚡ callout. ✅ An Answers setting adds ✅ true/false rounds (every question, or every third). ✅ 40 more questions, filling out the smaller topics (Space, Sport, Food). ✅ Steady layout (#58): the question, answers and
  note keep reserved heights, so the answer buttons never move between questions (true/false fills the same space).
- 🦹 **Night Heist:** ✅ a night-by-night grid of everyone's choices and gold changes. ✅ Bots get a personality, shown on their chip: 🦊 greedy, 🐢 cautious or 🦉 watchful.
- 🎭 **Unmask:** ✅ an ↶ Undo toast after flipping a batch of faces (toasts can now carry an action button).
  ✅ Pinch the board (or 🔍 − / +) to make the faces bigger or smaller; the size is kept on the device.

**Strategy**
- 🔺 **Backgammon:** ✅ added (#42). ✅ A 🎲 doubling cube (on by default): double before you roll, take to own
  the cube or drop and lose at its value; bots double and take from the race. ✅ The Crawford rule in matches
  (no doubling the game after someone first reaches match point). ✅ A stronger hard bot: in a pure race it plays
  for pips and a smooth bear-off (it used to fear blots nobody could hit), and in contact it values anchors in your
  home board, a closed board when you're on the bar, and avoids tall stacks. It beat the old hard bot 116–84.
- ♟️ **Chess:** ✅ a move list in standard notation (Nf3, exd5, O-O, e8=Q#), and ✅ captured pieces tumble off
  their square as the capturer slides in. ✅ ⏩ Premoves: during your rival's turn, tap a piece and a square; it plays the instant your turn starts
  if it's still legal (pawns promote to a queen), or is dropped with a note. ✕ cancels it.
- ⛀ **Checkers:** ✅ last-move highlight, and an optional 🦅 flying-kings variant.
- ⚫ **Go:** ✅ a territory overlay (shown at the end, ◫ toggle during play), and ↶ undo requests (bots always agree).

**Quick classics**
- 🔴 **Drop Four:** ✅ the winning line glows, and a move history of coloured column chips.
- 🌰 **Oware:** ✅ seeds lie scattered in each pit at fixed spots, so pits never grow or reshuffle (#55, #57), and a
  sowing drops its seeds in one pit at a time along the path, with captures flashing after they land (#56).
- 🔳 **Dots & Boxes:** ✅ a last-line highlight. ✅ Wide grids (4×6, 5×8) that lie the long way on each screen: across on a sideways phone, down on an upright one.
- ❌ **Tic-Tac-Toe:** ✅ in Vanishing mode, the mark that fades next is dimmed.

**Words & puzzles**
- 🔎 **Grid Hunt:** ✅ added (#24, #37). ✅ A "Still to find" line counts the words of each length you
  haven't found. ✅ A 6×6 grid for big tables (4+ letters). ✅ Tap any word in the results to see it traced across
  the grid, tile by tile.
- 🔐 **Safecracker:** ✅ added (#22). ✅ Each round starts from an empty guess, with ↺ Last to bring
  back your previous one (#45). ✅ The guess is a fixed row of spots: tap a spot to select it, the next colour goes there,
  and tapping it again empties it without shifting the other pegs (#42); without repeats, tapping a colour that's already
  in the row swaps it into the selected spot (#41). ✅ A 📝 notes row marks colours ✗ out or ✓ in (shown on the pad too). ✅ A colour-blind-friendly palette
  (Okabe–Ito, per device). ✅ ⚔️ Duel mode (two players): each secretly sets a code, then you race to crack each
  other's in simultaneous rounds; your rival's guesses at your code show too, and both codes open at the end.
- 🤥 **Fib Finder:** ✅ 118 facts, up from 56 (#51); moved here from Party to balance the lobby. ✅ A Facts setting picks a topic: 🐾 Animals, 🔬 Science & nature, 🏛️ History & inventions or 🔤 Words & names (a duplicate apple fact became the Hundred Years' War).
- 🧗 **Word Ladder:** ✅ added: par, hints and bots use everyday words only, so revealed ladders never lean on obscure words. ✅ 📅 Today's ladders: the puzzles come from the date, so every room plays the same ones that day. ✅ A 5-letter mode: the everyday list grew from 182 to 802
  five-letter words, plus 236 plurals and past tenses that may be steps but never a puzzle's ends, linking over 8,000
  ladders of 4–7 steps.
- 🔤 **Wordsmith:** ✅ a live score preview as you place tiles (the words and points, or why it won't play), and a
  💡 hint button when you're the only person playing. Both use the new read-only `/api/peek` (a game opts in
  with `peek(p, body)`). ✅ Tile colours (#67): a bar in each player's colour shows who played every tile, and
  this turn's tiles are pale with a dashed outline in your colour, lifted, so they can't be mistaken for the ★.
  ✅ Drag and drop: drag a rack tile onto a square (it rides above your finger so you can see where it lands),
  drag a placed tile to move it, or off the board to take it back. Tapping still works.

**Cards / dice**
- 🎯 **Farkle:** ✅ added (#40). ✅ Dice pips show on phones again (#44, shared with Yacht). ✅ The hint shows the
  chance of farkling with the dice you're about to roll. ✅ Hot dice get a 🔥 flourish on every screen.
- 🚢 **Ship, Captain & Crew:** ✅ added to fill the 🎲 Dice & casino row. ✅ Fresh rolls shake the dice, and a 🍺 **Pub pot** option: everyone antes 1 💰 a round, the best cargo takes the pot (ties roll it over), most coins wins.
- 🤥 **Liar's Dice:** ✅ added to fill the 🎲 Dice & casino row. ✅ The showdown has a 📊 "How likely was each bid?" list: each bid's odds from the bidder's own seat, and whether it held. ✅ A bid clock is the room's Turn timer: run out and you bid or call automatically.
- 🎲 **Yacht:** ✅ added (#38: the traditional game the branded one grew from). ✅ The dice pips were
  invisible: the die's padding was a percentage, which CSS measures against the whole dice row, so it
  squeezed the pips to nothing (#44). ✅ Asks before you score a 0. ✅ A 🏅 solo best-score table (top 5, kept on the device).
- 📍 **Cribbage:** ✅ added (#23). ✅ Pegging animates along the track (the back peg leapfrogs, a floating +N). ✅ Optional muggins rule: in the show you count your own hand, and a rival takes any points you miss.
- ♠️ **Texas Hold'em:** ✅ added (#21). ✅ Buy back in after busting (#35; people only, bots don't). ✅ A 📜 hand-history panel (the last 8
  hands: board, result, cards shown and your own two), and 🙂 a winner whose rivals all folded can show their cards.
  ✅ With a turn timer, a 60 s ⏳ time bank each, spent 20 s at a time before you're folded.
- 🃏 **Last Card:** ✅ a fanned hand in one swipeable row (playable cards lift out), and drawn cards are dealt in
  from the deck.
- ⚡ **Speed:** ✅ added (#48). ✅ Drag a card onto a pile (or tap as before), and a 👋 "slap" sound whenever a
  card lands. Next: a two-phones-face-to-face table layout.
- 🚢 **Sea Battle:** ✅ drag a placed ship to move it (tap still picks it up; the page doesn't scroll while placing).
- 🚀 **Moon Shot:** ✅ on phones the rockets become coloured dots so six fit a square (#6), and fresh rolls tumble in.

**New games players asked for**
- ✅ 🔐 **Safecracker** (#22) and ✅ 🔎 **Grid Hunt** (#24, #37): original designs in the code-breaking and
  word-hunt genres, not copies of branded games.
- ✅ **Lobby grid** (#43): Board split into ♟️ Strategy and ✏️ Quick classics, Words became 🔤 Words &
  puzzles, and every group fills its rows evenly. Every group now holds 3, 4, 6 or 8 games; a new game should
  go where it keeps that balance.
- ✅ 🎨 **Paint Blast** (#20): an original real-time bomb maze where blasts paint the floor and the
  most colour wins. ✅ Walls close in over the last 15 s (setting), and a 👟 kick power-up. ✅ A gamepad (#54): a
  round d-pad that follows your thumb as it slides (no lifting to turn), and a big 💣 button to its right. Next: 3D tiles.
- ✅ 🀄 **Contract Rummy** (#39 asked for a branded game): the traditional contract-rummy family it grew from.
  ✅ Your own hand order (#59): drag a card to move it (any time, not just on your turn), or Sort by 🔢 rank or ♠ suit;
  the choice is kept on the device, and drawn cards join at the right end.
- ✅ ⚡ **Speed** (#48): the traditional real-time race card game, two players.
- ✅ 🧠 **Trivia Rush** (#49): an original quick-fire quiz with its own question bank.
- 🎲 #41 asks for "qork", which we couldn't identify. Ask the player which game they meant; if it's a
  dice game, it can join Liar's Dice and Ship, Captain and Crew in bringing 🎲 Dice to 6.
- #2 asks for a remake of an NES game. We don't copy existing games.

## The next 10 games (balance plan)

On a phone the picker fits 4 tiles a row, so a group fills its rows evenly at **3, 4, 6 or 8** games
(5 and 7 leave a ragged row). ✅ **Done:** all 10 are in, taking the lobby from 29 games (Party 6 ·
Action 5 · Strategy 4 · Quick classics 4 · Cards 3 · Dice 3 · Words & puzzles 4) to **39: Party 6 ·
Action 8 · Strategy 6 · Quick classics 6 · Cards 6 · Dice 3 · Words & puzzles 4**, every group filling its rows:

| # | Game | Group | Players | Kind | Notes |
|---|---|---|---|---|---|
| 1 | 🪐 **Sumo Saucers** ✅ | Action | 2–6 | Real-time, three.js | Planned for #46: shove rivals off a shrinking floating platform. Air Hockey's physics. |
| 2 | ⛳ **Putt Party** ✅ | Action | 1–6 | Turn-based physics, three.js | Original mini golf: procedurally built 3D holes (bumpers, sand, slopes, water), everyone putts the same hole, fewest strokes over 3, 6 or 9. Server simulates each putt and sends the path, like Billiards. |
| 3 | 🛸 **Hover Rally** ✅ | Action | 2–6 | Real-time, three.js | Hover-racers on a looping track: steer left/right, the throttle is automatic, ⚡ boost pads and personal boosts, 💨 slipstreams and 🚀 homing missiles. The track is a spline plus a side offset, so the server sim stays tiny. |
| 4 | 🌰 **Oware** ✅ | Strategy | 2 | Turn-based | The traditional mancala game: sow seeds, capture twos and threes, the grand-slam rule. Alpha-beta bots, like Checkers. |
| 5 | ⚪ **Reversi** ✅ | Strategy | 2 | Turn-based | The 19th-century public-domain game (not the branded version): flip lines of discs. Bots weigh corners, edges and mobility. |
| 6 | #️⃣ **Ultimate Tic-Tac-Toe** ✅ | Quick classics | 2 | Turn-based | The folk game: nine boards in one, and your move sends your rival to a board. Monte Carlo bot. |
| 7 | ⚫ **Nine Men's Morris** ✅ | Quick classics | 2 | Turn-based | The traditional mill game: place, move, then fly. Alpha-beta bot. |
| 8 | 🃏 **Contract rummy** ✅ | Cards | 2–6 | Turn-based | Answers #39 with an original design in the public-domain rummy family: each hand demands a contract (two sets, a set and a run…). |
| 9 | ♥️ **Hearts** ✅ | Cards | 3–6 (best 4) | Turn-based | The traditional trick-avoiding game: pass three, avoid hearts and the queen of spades, or shoot the moon. |
| 10 | ♦️ **Twenty-One** ✅ | Cards | 1–6 | Simultaneous | The traditional casino game against a dealer bot, everyone at once, with chips across rounds. Instant solo play. |

**After the plan:** Speed (#48) and Trivia Rush (#49) took the lobby to **41**. To keep groups even,
Trivia Rush joined Party, Fib Finder moved to Words & puzzles, and Twenty-One moved from Cards to a
renamed 🎲 **Dice & casino**: Party 6 · Action 8 · Strategy 6 · Quick classics 6 · Cards 6 · Dice &
casino 4 · Words & puzzles 5. ✅ 🧗 **Word Ladder** (Lewis Carroll's public-domain "doublets" puzzle as a
race) then brought Words & puzzles to 6.

✅ 🎲 Dice & casino then reached 6 with 🚢 **Ship, Captain & Crew** and 🤥 **Liar's Dice**, so all seven groups fill
their rows: **44 games**, Party 6 · Action 8 · Strategy 6 · Quick classics 6 · Cards 6 · Dice & casino 6 ·
Words & puzzles 6. ✅ #41's "qork" turned out to be a reaction game, now 🥤 **Qork**: **45 games**, Dice & casino 7. ✅ 📦 **Shut the Box** brings it to 8: **46 games**, every group
filling its rows again.

**More three.js action ideas** (each works with the existing real-time plumbing: a server-owned sim
with `frame` / `push_fast`, or each browser simulating its own board like Spire Siege):
- 🥌 **Ice Stones:** curling-style sliding stones on a 3D sheet, turn-based physics like Billiards.
- 🧱 **Stack Duel:** stack sliding blocks into a tower (overhang gets sliced off); each phone runs its
  own tower, and perfect drops send a wobble to a rival.
- ❄️ **Snowball Pit:** top-down 3D dodgeball arena; pick up snowballs and throw on release.
- 🎳 **Pin Rush:** bowling with a swipe-to-throw and spin; everyone rolls the same frame at once.
- 🪂 **Sky Drop:** fall through a 3D shaft of rings, steering by tilt or drag; most rings wins.
- 🚤 **Bumper Boats:** bumper-car physics on water, with splash power-ups. It shares Sumo Saucers' code.
- 🧊 **3D Paint Blast:** the same game drawn as a lit 3D maze (the plan's "3D tiles" item).

## Roadmap

- **More games:** a drawing-and-guessing game (it fits the reactions feature well), a
  dots-and-boxes variant for up to 6 players, and a co-op deduction puzzle.
- **Meta:** a game-night playlist that rotates games automatically, plus a running
  scoreboard across the evening.
- **Unmask:** Mole mode, Bluff Duel (lie tokens), a Daily Puzzle, and theme packs.
- **Wordsmith:** challenge voting as a house-rules dictionary (the live score preview, drag-and-drop and blank tiles are done).
- **Night Heist:** character roles (the Insider sees one other player's choice), and a
  heat meter that makes repeat grabbers easier to catch.
- **Infrastructure:** persist rooms across restarts, and host online behind HTTPS.
