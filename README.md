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
| #️⃣ **Ultimate Tic-Tac-Toe** | 2 | The folk game: nine small boards in one. Where you play sends your rival to that board. Win three small boards in a row. | The boards you may play in glow; won boards show a big mark. |
| ⚫ **Nine Men's Morris** | 2 | The traditional mill game: place 9 men, then slide them; a line of three (a mill) takes a rival man. Fewer than 3 men or no move loses. | Optional flying with 3 men. Tap a man, then its destination; after a mill, rival men you can take pulse red. |
| ❌ **Tic-Tac-Toe** | 2 | The classic. | 👻 **Vanishing**: you keep only your 3 newest marks, and the oldest fades out. |
| 🕵️ **Odd One Out** | 3–6 | Everyone gets the same secret word except one player, whose word is similar. Take turns giving one-word clues, then vote. | The odd one **doesn't know they're odd**. Catch them for +2 each; if they escape they get +4. A caught odd one can still guess the real word for +3. |
| 🖍️ **Scribble Relay** | 3–6 | Everyone writes a phrase, then the chains pass round the table: draw what you're handed, caption the drawing you're handed, and so on. Drawing happens on your own phone (6 ink colours, undo). | You only see the entry right before yours. At the end each chain is revealed card by card and everyone ❤️ votes for their favourite entry. 🎯 A chain that ends where it started earns everyone in it +1. |
| 🤥 **Fib Finder** | 2–6 | A strange-but-true fact appears with a word missing (118 facts). Everyone writes a believable fake answer, then picks which answer is real. | +3 for finding the truth, +2 for each player your fib fools. Typing the real answer is caught and rejected. House fibs make sure there are always enough answers. The last fact counts double. |
| 🪜 **Word Ladder** | 1–6 | Lewis Carroll's public-domain "doublets" as a race: everyone climbs from the same start word to the same goal word, changing one letter per step, every step a real word. | Par is the shortest ladder of everyday words; any dictionary word is allowed in between. ↩ takes a step back for free, 💡 fills in the next step for 3 points. 3- or 4-letter words. |
| 🧠 **Trivia Rush** | 1–6 | Quick-fire quiz: everyone gets the same question with four answers and picks at once (188 original questions in 9 topics). | 100 for a right answer plus up to 100 for speed; the last question counts double. Pick one topic or everything. Alone, get 70% right to win. |
| 🥷 **Night Heist** *(the surprise)* | 2–6 | A simultaneous bluffing game. Each night everyone secretly picks **Grab**, **Guard** or **Rest**, then all choices are revealed together. | A lone grabber steals the whole vault. Two grabbers trip the alarm and the loot grows. Guards fine grabbers 💰2 each, and guarding an empty hall costs 💰1. Reading the table is the whole game. |

| 🚀 **Moon Shot** | 2–6 | Push-your-luck dice race to the moon. Roll to build fuel, then bank it to fly. Any 1 loses this turn's fuel; double 1s crash you to the start. | A random track of ⭐ boosts (+5), ☄️ meteors (−5) and 🌀 wormholes (swap with the leader), so *where* you stop matters. Doubles earn 🛡️ shields. |
| 🎲 **Yacht** | 1–6 | The traditional dice game: five dice, up to three rolls (tap to hold), then fill one of twelve boxes. Classic scoring: Ones–Sixes, Full House, Four of a Kind, Little and Big Straight (30), Choice, Yacht (50). | Your open boxes show what the roll would score before you commit. Solo is a score attack: reach 150 to win. |
| 🎯 **Farkle** | 1–6 | The traditional push-your-luck dice game: roll six, set aside scoring dice, roll the rest or bank. A roll with nothing scoring is a FARKLE and the turn's points are gone; score all six for hot dice. | Live total of the dice you've picked, a ✨ best-pick button, and everyone sees each farkle and bank. Play to 10,000 or 5,000, with a final round for the others; optional 500 to get on the board and −1,000 for three farkles in a row. |
| 🚢 **Ship, Captain & Crew** | 1–6 | The traditional tavern dice game: three rolls of five dice to find a 6 (ship), then a 5 (captain), then a 4 (crew), in order. The last two dice are your cargo. | Tap cargo dice to reroll one or both with the rolls you have left, or ⚓ dock. 3, 5 or 8 rounds; alone, average 5 cargo a round to win (best play averages about 4.3). Optional 🍺 pub pot: ante a coin a round, best cargo takes the pot. |
| 🤥 **Liar's Dice** | 2–6 | The traditional bluffing game: everyone rolls in secret, then bids rise ("four 3s") until someone calls 🤥 Liar!. Whoever was wrong loses a die; the last with dice wins. | Optional wild 1s and 🎯 Exact calls (spot on and everyone else loses a die). A helper shows how many of a face to expect, and the showdown stays up with everyone's dice. |

| ✏️ **Doodle Dash** | 2–6 | The computer draws a picture one line at a time (52 original line drawings in 6 categories) and everyone types guesses at once. Earlier guesses score more. | Letter blanks appear halfway through, then the first letter. A wrong guess locks you out for 3 s. Typos, plurals and synonyms are accepted. Scoring: everyone can score (the first gets +2), or ⚡ first correct only. Strokes reach the browser only as they're drawn, so nobody can peek. |
| 🎡 **Lucky Letters** | 2–6 | Spin a **3D prize wheel** (three.js), call consonants, solve the hidden phrase. 78 original puzzles in 8 categories. | Vowels can only be called by landing on ✨ VOWEL. Special wedges: 💀 Bust, ⛔ Skip, 🎁 Wild (a free letter), 🦊 Steal (take 500 from the leader), and a growing ⚡ Jackpot. The server picks where the wheel stops, and every phone animates the same spin. |
| 🗼 **Spire Siege** | 1–6 | **Real-time 3D** (three.js) falling-block battle on a cylindrical tower that wraps around. Pieces are 2-, 3- and 5-block shapes, or pick the 🟦 4-block set. ⇄ **Hold** parks a piece for later. Fill a whole ring to clear it. Clearing 2+ rings, or chaining clears, sends junk rings to a random rival. | The tower spins so your piece always faces you. Power cells: ⚡ surge (rivals fall faster), 🛡️ shield (blocks junk), 💣 blast (removes your bottom two rings). Solo survival works with 1 player. Prefer an upright board? 🧱 **Flat well** mode has side walls and a flat view. |
| 🏍️ **Light Riders** | 2–6 | **Real-time** light-cycle duels in a **3D neon arena** (three.js; flat fallback). Your bike never stops and leaves a wall of light behind it. Crash into any wall and you're out; the last rider standing wins the round. | ⚡ 3 boosts per round (double speed). Swipe, D-pad or keyboard. Quick double turns are queued, so you can whip round a corner. Medium, small or large arena; chill, normal or fast speed. |
| 🎨 **Paint Blast** | 2–6 | **Real-time** bomb maze: run through pillars and crates and drop bombs whose blasts run in a straight line in all four directions. Crates hide 💣 extra bombs, 🔥 longer blasts and 🪣 paint splashes. | **Every blast paints the floor in your colour**, and when the clock stops each painted tile is a point (+10 for catching a rival). Caught players are stunned for 3 s and respawn at home, so nobody sits out. The maze is mirror-symmetric and new every round. Swipe-and-hold to run, tap to bomb. |
| 🪐 **Sumo Saucers** | 2–6 | **Real-time 3D** (three.js; flat fallback): pilot a hover saucer on a floating platform and shove rivals off the edge. Drag anywhere for a virtual stick, tap to 💨 dash. | Glowing rim bumpers bounce you back once, then shatter, and the platform shrinks every 15 s. Last saucer floating wins the round; first to 3 wins. Optional sudden death with no bumpers. |
| ⛳ **Putt Party** | 1–6 | **3D** mini golf (three.js; top-down fallback) on holes generated each game: a winding walled fairway with ⚪ bumpers, 🟫 sand, ↗ slopes and 💧 water. Drag back and let go to putt. | The server simulates every putt and sends the ball's path, so every phone plays back the same shot. Everyone plays the same hole, a stroke each in turn. Solo: finish at or under par (3 a hole). |
| 🛸 **Hover Rally** | 1–6 | **Real-time 3D** hover-craft race (three.js chase camera; top-down fallback) on a looping track generated each game. The throttle is automatic: hold a side of the screen (or ←/→) to steer. | Bends push you outward and the inside line is shorter, so racing lines matter; walls scrub speed. ⚡ Boost pads plus 3 boosts of your own, sideways bumps. Alone: beat a target time. |
| 🏒 **Air Hockey** | 2 | **Real-time** table hockey: drag your mallet around your half, bank shots off the walls. Server-side physics at 60 fps. | 🏒🏒 Double Trouble puts two pucks on the table. Each player sees the table from their own end. |
| 🎱 **Billiards** | 2 | Eight-ball pool on a top-down table with real physics (cushions, ball-to-ball collisions, six pockets). Drag to aim, set the power, shoot. | The server simulates every shot and sends the ball paths, so every phone plays back the same shot. A 🎯 aim guide (full, short or off) shows where both balls go. Fouls give ✋ ball in hand. The table stands upright on phones. |
| ♟️ **Chess** | 2 | Full rules: castling, en passant, promotion, check/mate, stalemate, 50-move rule, threefold repetition, insufficient material. Draw offers and resignation. Optional ⏱️ clock: 3+2, 5+0 or 10+5. | Move generation is checked against standard perft counts. Black sees the board from their side. 🧊 **3D board** (three.js) by default: tap a piece, then its square; drag sideways to turn the board. The flat board is one tap away and is used automatically without WebGL. |
| ⛀ **Checkers** | 2 | American rules: compulsory captures, multi-jumps in one move, kings, and a 40-move no-progress draw. | Legal pieces and landing squares are highlighted. Optional 🦅 flying kings glide any distance and jump from afar. |
| 🔎 **Grid Hunt** | 2–6 | Timed word hunt: everyone searches the same freshly shaken 4×4 or 5×5 letter grid at once, tracing words through touching tiles. Drag, tap, or type. | When time runs out the lists are compared, and **a word a rival also found scores nothing**. A ⭐ star tile doubles words through it. The grid is reshaken until it holds plenty of words, and the results show the longest ones nobody found. |
| 🔐 **Safecracker** | 1–6 | Code-breaking: crack a hidden 4- or 5-peg colour code from ● (right spot) and ○ (wrong spot) hints. | **Everyone cracks the same safe at once**: guesses are locked in secretly, then all are revealed, so rivals' clues help you too. Crack it alone for 3, share the crack for 2. A private 🔍 probe per safe counts one colour, for a point. Pegs show numbers as well as colours. |
| 🔺 **Backgammon** | 2 | The traditional race game, full rules: opening roll, doubles move four times, hits and the bar, bearing off (higher dice only for the farthest checker), and the must-use-both-dice / use-the-larger-die rules. | The board is drawn from your side, so your home is bottom right in either colour. Tap a checker, then a glowing point; undo until you end your turn. Gammons (2) and backgammons (3); one game or a match to 3 or 5. Optional 🎲 doubling cube. |
| 🫘 **Oware** | 2 | The traditional mancala game (abapa rules): sow seeds counter-clockwise, capture rival pits you leave at 2 or 3, chaining backwards. 25 seeds wins. | The grand-slam rule, the must-feed rule, and an endless-circling stop. Captured pits flash and the last pit sown is ringed. |
| ⚪ **Reversi** | 2 | The 19th-century public-domain disc-flipping game on 8×8: trap a line of rival discs to flip them. Passes when you can't move. | Legal squares glow, and flipped discs spin over. |
| ⚫ **Go** | 2 | 9×9, 13×13 or 19×19. Tromp–Taylor area scoring, positional superko, no suicide, 6.5 komi. | A live "score if it ended now" readout. |
| 🃏 **Last Card** | 2–6 | Shedding game from the public-domain Crazy Eights / Mau-Mau family, with a standard 52-card deck. Optional action cards: 7 draw-two (stackable), 8 skip, Q reverse, J wild. | Call **“Last card!”** in time, or any opponent can 🚨 catch you for +2. |
| ♠️ **Texas Hold'em** | 2–6 | No-limit poker, the traditional game: blinds, two private cards, five shared cards, four betting rounds, all-ins with proper side pots. | Blinds rise every 6, 10 or 15 hands so every game ends. Uncalled chips come back, odd chips go to the first winner after the button, and showdown hands are named. Starting stacks of 1,000, 2,000 or 5,000. 💸 **Buy back in** (off, once, or up to 3 times) when you bust; if your bust would end the game, the table waits 12 s for you. |
| 📍 **Cribbage** | 2–3 | The traditional pegging card game: discard to the crib, cut the starter, then the play (15s, pairs, runs, 31, go) and the show (fifteens, pairs, runs, flushes, nobs). | Scored exactly by the book, including his heels, the crib's five-card flush rule, and pegging out mid-hand. A peg track shows the race; the show lists every hand's points. Game to 121 or 61. |
| ♥️ **Hearts** | 3–6 | The traditional trick-dodging game: pass three, follow suit, avoid hearts (1) and the Q♠ (13), or shoot the moon. Game to 100 or 50, lowest wins. | No points on the first trick, hearts must be broken before they're led. With 3, 5 or 6 players low cards are removed so the deal is even. |
| ⚡ **Speed** | 2 | The traditional two-player race card game (also called Spit), in real time: no turns, both players slap cards one rank up or down onto two centre piles. | Kings and aces wrap round. When nobody can play, fresh cards flip from the side piles. First to empty hand and stock wins; one round or best of 3. |
| 🂡 **Twenty-One** | 1–6 | The traditional casino game against a dealer bot: everyone bets at once, then hits, stands or doubles in turn. Dealer draws to 17; a two-card 21 pays 3:2. | Four-deck shoe, no splits. Most chips after 5, 8 or 12 hands wins; alone, beat your starting 100. |
| 🀄 **Contract Rummy** | 2–6 | The traditional rummy game where each hand has a contract (two sets of 3; a set and a run of 4; … three runs of 4), with two decks and four wild jokers. The answer to #39. | Lay down the whole contract at once, then add to anyone's melds. Cards left in hand count against you; lowest total after 7 (or 4) hands wins. |
| 🚢 **Sea Battle** | 2 | The classic pencil-and-paper fleet hunt: hide 5 ships, then take turns firing. | Firing rules: 1 shot, hit = fire again, or Salvo (1 shot per ship afloat). Optional 📡 sonar counts the ship squares in a 3×3 area. |

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
- **Billiards:** bots aim with the ghost-ball method, checking that both paths are clear and the cut isn't too thin, and pick a power that gets the ball to the pocket. With ball in hand they choose the spot with the best shot. The hard bot runs its five best ideas through the real physics engine and also weighs the next shot it leaves itself.
- **Farkle:** bots weigh the chance of farkling with the dice left (measured: 67% with one die down to 2% with six) against the average gain, and keep rolling when it pays; in the final round they roll until they beat the leader. Hard keeps fewer dice to roll more. Simulation shows Farkle is mostly luck past that: hard and normal finish about even, both well ahead of easy.
- **Ship, Captain & Crew:** hard bots reroll cargo by an exact expected-value table (one die or both); normal bots reroll below 7, easy below 6; in the last round, bots behind the leader gamble.
- **Liar's Dice:** bots judge bids with the binomial odds from their own dice and the hidden count, bid the most believable raise and sometimes bluff; hard bots also assume a bidder holds one of the face they bid, and call 🎯 Exact when it is the likeliest count.
- **Yacht:** bots judge a roll by its best box minus that box's typical value, so they don't waste Choice or Yacht on a weak roll. The hard bot tries all 32 ways to hold the dice, simulating the remaining rolls for each; normal keeps its most common face or a straight draw. Hard averages about 140 points.
- **Cribbage:** bots keep the four cards worth the most averaged over every possible starter; the hard bot also feeds its own crib and starves a rival's. In the play they take the most points now, and the hard bot avoids leaving 5 or 21 (an easy 15 or 31) and inviting runs.
- **Texas Hold'em:** bots estimate their share of the pot by simulating random runouts from their own two cards and the board only (no peeking), against the number of players still in. They compare that with the pot odds, raise strong hands by ½ to 1 pot, and stronger bots bluff now and then and shove the nuts on the river. Easy bots misjudge their hands and call too loosely.
- **Grid Hunt:** the server solves every grid (a dictionary walk with prefix pruning). Each bot "spots" a share of the words at random moments, fewer of the long ones: about 5% (easy), 9% (normal) or 15% (hard) of the grid, so a quick human beats easy and normal bots.
- **Safecracker:** bots keep the list of codes that fit every revealed clue. Normal guesses one of them at random; hard picks among the guesses that would split the rest most evenly and only spends its probe when the answer should pin the code down; easy mostly tracks its own clues only. Because every clue is shared, hard and normal finish about even, both far ahead of easy.
- **Backgammon:** bots list every distinct end-of-turn position and score it on pip count, borne-off and hit checkers, points made (home board weighted), blots weighed by how many enemy rolls hit them, and primes. The hard bot then checks its top four against all 21 enemy rolls and the enemy's best reply to each; normal sometimes settles for its second-best play. Hard beat normal 46–14 and normal beat easy 52–8 in simulation.
- **Oware, Reversi, Ultimate Tic-Tac-Toe, Nine Men's Morris:** one shared search (`games/search.py`): negamax with alpha-beta and iterative deepening under a time budget (hard: 2.5 s, 6–9 moves deep; normal: 3–4 deep; easy: 1 deep with noise). Each game adds its own evaluation: Oware weighs captured seeds, seeds at home and rival pits sitting on 1–2; Reversi uses square weights (corners high, the squares next to an empty corner low), mobility and, near the end, disc count; Ultimate scores open two-in-a-rows on the big and small boards; Morris counts men, open two-man lines and mobility. Hard beat easy 6–0 in every one.
- **Hearts:** bots pass their most dangerous cards (high spades, high hearts, cards from short suits), duck under the winning card when they can, win clean tricks when they play last, and dump the Q♠ and high hearts when void. Hard also avoids leading or taking high spades while the queen is out. Hard and normal finish about even; both beat easy.
- **Twenty-One:** hard plays full basic strategy (soft totals and doubles included, no splits), normal a simplified version, easy hits below 15. Over a few hands it's mostly luck, as at a real table.
- **Speed:** bots play at a human pace (about 2 s a card for easy, 1.2 s for normal, 0.8 s for hard). Normal and hard prefer plays that leave another card playable straight after.
- **Trivia Rush:** bots "know" an answer with some chance (45% easy, 62% normal, 80% hard) and otherwise guess; harder bots also answer faster.
- **Contract Rummy:** bots search their hand for the contract (every way of making 3-card sets and 4-card runs, jokers included, both copies of a card), take the discard only when it completes the contract or helps and they wouldn't throw it straight back, and discard the card that helps least (pairs for set contracts, same-suit neighbours for run contracts). After laying down they add every card that fits. Hard beat normal 9–6 and normal beat easy 12–3.
- **Putt Party:** bots try 25 (easy) to 160 (hard) putts aimed at the cup and along the fairway in the real physics, keep the one that ends nearest the cup along the fairway, then add aim and power error by level.
- **Chess:** alpha-beta search with iterative deepening (hard bot: up to 4 moves deep, 4s budget). It finishes off a lone king and avoids repetition draws when ahead.
- **Checkers:** alpha-beta search (hard bot: up to 8 moves deep).
- **Go:** heuristic play: captures, rescuing groups in atari, avoiding self-atari, shape. It recognises settled territory and passes. On 9×9 and 13×13 the hard bot shortlists the best heuristic moves and picks among them by Monte Carlo playouts (about 2.5 s per move, successive halving).
- **Last Card:** keeps its long suit and saves wild Jacks for later. Normal and hard bots also catch players who forget to call “Last card!”.
- **Sea Battle:** probability-density targeting (hard), hunt-and-target with parity (normal).
- **Lucky Letters:** the hard bot picks consonants by matching the revealed pattern against the 172k-word dictionary, and solves when each word has only one possible fit. All bots recognise familiar phrases once enough letters show; the stronger the bot, the sooner it notices.
- **Doodle Dash:** bots "recognise" each picture at a random point in the drawing (sooner on harder levels), take a moment to type, and sometimes blurt out a wrong guess first.
- **Light Riders:** bots steer toward open space (a flood fill). Hard bots, once three or fewer riders remain, fight for territory: they count the cells they can reach before any rival can, refuse head-on gambles, and only boost onto a clear straight. They never drive into a cell a rival could also take.
- **Paint Blast:** bots map where every ticking bomb will blast (chain reactions included) and when, run for the nearest safe tile, and only drop a bomb when they can still escape it. They then head for the spot worth the most (crates to break, floor to paint, rivals to catch, power-ups) per step of walking. Hard thinks every tick and values paint and rivals more; easy reacts slowly and sometimes walks into its own blast. In simulation hard won 4 of 6 three-way games.
- **Sumo Saucers:** bots keep away from the rim, pick the rival easiest to push out (near the edge and near them), line up on the inside of it and dash outward through it. Normal and hard bots sidestep a rival's dash. In simulation hard beat normal 20–0 and normal beat easy 20–0; rounds last about 30 s.
- **Hover Rally:** bots look ahead for the next bend, take the inside line, counter the outward push and correct toward their line; they dodge out from behind rivals. Hard reacts fastest, looks furthest ahead, hunts boost pads and boosts on straights. On the same track with no bumping, hard finished first in 6 of 8 races, normal second, easy third, and a craft that never steered last every time.
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
  - A scoreboard for the evening, ranked by ⭐ points (+3 win, +1 played, −2 for walking out mid-game): wins, games played, 🔥 best streak, and wins per game.
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
| **Server restart or crash** | Rooms are saved to `data/rooms.pickle` every few seconds and restored at startup. Turn timers restart in full. Open pages reconnect on their own. |
| **Room really gone** | Only a definite "room not found / not in this room" answer from the server clears your saved seat. Network errors never do. |

## Testing

```bash
python3 tests/jscheck.py static/app.js static/games/*.js   # structural check, no Node needed
python3 tests/csscheck.py                                    # layout lint (jsdom does no layout)
node --check static/app.js                                  # real syntax check (Node.js)
PORT=8767 python3 server.py &                               # a separate test server (own rooms-8767.pickle / feedback-8767.jsonl)
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
2. **Next up:** a shared "results card" component for multi-round games (Grid Hunt, Safecracker,
   Lucky Letters and Doodle Dash each draw their own today), and reserved heights for every game's
   status line so nothing jumps (#18).
3. **A real-device check of the 3D views and the touch feel** (Light Riders, Paint Blast, Billiards),
   which a simulated browser can't judge.
4. **A bottom-sheet layout with tabs** (*Actions · Log · Players*) and a sticky action bar for the main
   action, plus undo toasts (Unmask flips, Wordsmith tiles).
5. ✅ **More motion.** Animated captures in Chess, cards dealt into the Last Card hand, and a "your turn"
   chime for each lobby group (strategy, cards, dice, words… each sound different).
6. **Accessibility.**
   - Player colours that are safe for colour-blind players, with a shape or pattern as well (never
     colour alone).
   - ✅ Screen-reader labels on every board square ("e4, white knight") in Chess, Checkers, Go,
     Tic-Tac-Toe, Drop Four, Reversi, Sea Battle and Ultimate Tic-Tac-Toe.
   - ✅ Keyboard play on those boards: arrow keys move between squares (skipping ones you can't
     press yet), Enter or Space plays. The shared `gridKeys(box, cols)` in `app.js` adds it to any grid.
   - Contrast checks, and text that scales with the browser font size.
7. **Themes.** A light theme that follows the system setting. Board themes (wood, classic,
   high-contrast) and card-back styles, chosen under ⚙️ My settings.
8. **Identity and social.**
   - Avatars generated with the Unmask face generator.
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
- Reserve space for status lines and action rows in the other games too, the way Lucky Letters does now (#18).
- A short results card between rounds in every multi-round game, like the Lucky Letters solve pause (#17).
- 🗳️ ✅ **Next-game voting** (#25): the game-over banner suggests five games that fit the table
  (skipping recent ones) plus an "Other game…" list. Tap to vote, tap again to take it back. When every
  human picks the same game it starts at once; otherwise the host taps **▶ Play the vote winner** (a
  tie goes to the host's pick). Each game keeps its own settings. Bots don't vote. (The room action is
  `next_vote`: an earlier `vote` name swallowed Odd One Out's in-game vote, #33/#34.)
- ✅ Taps no longer get lost while bots act (#33, #34): the game screen skips redraws for chat- and
  reaction-only updates, and Odd One Out / Fib Finder update their buttons in place.
- ✅ **🙋 Join in mid-game** (#36): someone who arrives while a game is running gets a "Join in" button
  in games that can take them: Texas Hold'em (from the next hand, full stack), Lucky Letters and Moon
  Shot (0 points, next in seat order), Doodle Dash and Fib Finder (start guessing/writing at once).
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
  buttons no longer cover Shoot (#29), and the cue is a full-size tapered stick (#30). Next: pinch zoom (#28), spin (follow / draw),
  calling the pocket for the 8, and a 3D table.
- 🗼 **Spire Siege:** ✅ a 🟦 4-block piece set beside the mixed 2/3/5-block set (#13), a ⇄ hold slot
  (C / Shift / swipe up), and a sharper flat well on high-DPI screens. ✅ 🟦 4-block is now the default
  (#26); the odd shapes are the 🧩 Mixed option. ✅ Normal and hard bots use the ⇄ hold slot (they park a piece and
  play whichever of it and the new piece fits better). ✅ Ring clears call out RING! / DOUBLE! / TRIPLE! / SPIRE!
  (with ×combo), buzz, and shake the stage for three or more.
- 🏍️ **Light Riders:** ✅ the swipe threshold scales with the arena (18–48 px), a 📳 vibration tick on each
  turn and a longer buzz when you crash, and a countdown overlay. Next: check the swipe fixes on a phone (#14).
- 🏒 **Air Hockey:** ✅ a score-to-win setting, and 📳 haptics when your mallet hits the puck and on goals. Next: goal replay.
- 🎨 **Paint Blast:** ✅ added (#20). ✅ A paint-coverage bar under the clock, and a 📳 buzz when you're
  caught. ✅ 🧱 The walls close in during the last 15 s, a ring every 4 s (an option, on by default); paint
  under them still counts and anyone caught there is pushed inside. Next: a kick power-up.
- 🪐 **Sumo Saucers:** ✅ added (#46). ✅ 📳 Haptics when you're shoved and when you fall. Next: a
  slow-motion replay of the final knock-off. The original plan:
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
- ✏️ **Doodle Dash:** more drawings than 52, and a reveal card for each answer.
- 🕵️ **Odd One Out:** ✅ 50 word pairs (up from 36), and an animated "who voted for whom" reveal: a row per
  suspect, most votes first, the voters popping in one by one.
- 🖍️ **Scribble Relay:** ✅ thin, normal and thick brushes (stored in each stroke's ink number, so older
  drawings and the bots' are unchanged), and 💾 saving a revealed chain as one tall PNG.
- 🧠 **Trivia Rush:** ✅ added (#49), 188 questions in 9 topics. ✅ The quickest right answer gets a ⚡ callout. ✅ An Answers setting adds ✅ true/false rounds (every question, or every third). Next: more questions.
- 🥷 **Night Heist:** ✅ a night-by-night grid of everyone's choices and gold changes. ✅ Bots get a personality, shown on their chip: 🦊 greedy, 🐢 cautious or 🦉 watchful.
- 🎭 **Unmask:** an undo toast for flips, generated avatars, and pinch-zoom on the board.

**Strategy**
- 🔺 **Backgammon:** ✅ added (#42). ✅ A 🎲 doubling cube (on by default): double before you roll, take to own
  the cube or drop and lose at its value; bots double and take from the race. Next: the Crawford rule for
  matches, and a stronger evaluation for the hard bot.
- ♟️ **Chess:** ✅ a move list in standard notation (Nf3, exd5, O-O, e8=Q#), and ✅ captured pieces tumble off
  their square as the capturer slides in. Next: premoves.
- ⛀ **Checkers:** ✅ last-move highlight, and an optional 🦅 flying-kings variant.
- ⚫ **Go:** ✅ a territory overlay (shown at the end, ◫ toggle during play), and ↶ undo requests (bots always agree).

**Quick classics**
- 🔴 **Drop Four:** ✅ the winning line glows, and a move history of coloured column chips.
- 🔳 **Dots & Boxes:** ✅ a last-line highlight. Next: a bigger grid when the phone is sideways.
- ❌ **Tic-Tac-Toe:** ✅ in Vanishing mode, the mark that fades next is dimmed.

**Words & puzzles**
- 🔎 **Grid Hunt:** ✅ added (#24, #37). ✅ A "Still to find" line counts the words of each length you
  haven't found. ✅ A 6×6 grid for big tables (4+ letters). Next: a "trace" replay of each word in the results.
- 🔐 **Safecracker:** ✅ added (#22). ✅ Each round starts from an empty guess, with ↺ Last to bring
  back your previous one (#45). ✅ A 📝 notes row marks colours ✗ out or ✓ in (shown on the pad too). ✅ A colour-blind-friendly palette
  (Okabe–Ito, per device). Next: a duel mode where each player sets the other's code.
- 🤥 **Fib Finder:** ✅ 118 facts, up from 56 (#51); moved here from Party to balance the lobby. ✅ A Facts setting picks a topic: 🐾 Animals, 🔬 Science & nature, 🏛️ History & inventions or 🔤 Words & names (a duplicate apple fact became the Hundred Years' War).
- 🪜 **Word Ladder:** ✅ added: par, hints and bots use everyday words only, so revealed ladders never lean on obscure words. ✅ 📅 Today's ladders: the puzzles come from the date, so every room plays the same ones that day. Next: a 5-letter mode once the everyday list is big enough (today it links only 154 pairs).
- 🔤 **Wordsmith:** ✅ a live score preview as you place tiles (the words and points, or why it won't play), and a
  💡 hint button when you're the only person playing. Both use the new read-only `/api/peek` (a game opts in
  with `peek(p, body)`). Next: drag-and-drop tiles.

**Cards / dice**
- 🎯 **Farkle:** ✅ added (#40). ✅ Dice pips show on phones again (#44, shared with Yacht). ✅ The hint shows the
  chance of farkling with the dice you're about to roll. ✅ Hot dice get a 🔥 flourish on every screen.
- 🚢 **Ship, Captain & Crew:** ✅ added to fill the 🎲 Dice & casino row. ✅ Fresh rolls shake the dice, and a 🍺 **Pub pot** option: everyone antes 1 🪙 a round, the best cargo takes the pot (ties roll it over), most coins wins.
- 🤥 **Liar's Dice:** ✅ added to fill the 🎲 Dice & casino row. ✅ The showdown has a 📊 "How likely was each bid?" list: each bid's odds from the bidder's own seat, and whether it held. ✅ A bid clock is the room's Turn timer: run out and you bid or call automatically.
- 🎲 **Yacht:** ✅ added (#38: the traditional game the branded one grew from). ✅ The dice pips were
  invisible: the die's padding was a percentage, which CSS measures against the whole dice row, so it
  squeezed the pips to nothing (#44). ✅ Asks before you score a 0. ✅ A 🏅 solo best-score table (top 5, kept on the device).
- 📍 **Cribbage:** ✅ added (#23). Next: animate pegging along the track, and an optional muggins rule.
- ♠️ **Texas Hold'em:** ✅ added (#21). ✅ Buy back in after busting (#35; people only, bots don't). ✅ A 📜 hand-history panel (the last 8
  hands: board, result, cards shown and your own two), and 🙂 a winner whose rivals all folded can show their cards. Next: a time bank.
- 🃏 **Last Card:** ✅ a fanned hand in one swipeable row (playable cards lift out), and drawn cards are dealt in
  from the deck.
- ⚡ **Speed:** ✅ added (#48). Next: drag a card onto a pile, a two-phones-face-to-face table layout, and a
  "slap" sound.
- 🚢 **Sea Battle:** ✅ drag a placed ship to move it (tap still picks it up; the page doesn't scroll while placing).
- 🚀 **Moon Shot:** ✅ on phones the rockets become coloured dots so six fit a square (#6), and fresh rolls tumble in.

**New games players asked for**
- ✅ 🔐 **Safecracker** (#22) and ✅ 🔎 **Grid Hunt** (#24, #37): original designs in the code-breaking and
  word-hunt genres, not copies of branded games.
- ✅ **Lobby grid** (#43): Board split into ♟️ Strategy and ✏️ Quick classics, Words became 🔤 Words &
  puzzles, and every group fills its rows evenly. Every group now holds 3, 4, 6 or 8 games; a new game should
  go where it keeps that balance.
- ✅ 🎨 **Paint Blast** (#20): an original real-time bomb maze where blasts paint the floor and the
  most colour wins. Next: a shrinking arena in the last 15 s, a kick power-up, and 3D tiles.
- ✅ 🀄 **Contract Rummy** (#39 asked for a branded game): the traditional contract-rummy family it grew from.
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
| 3 | 🛸 **Hover Rally** ✅ | Action | 2–6 | Real-time, three.js | Hover-racers on a looping track: steer left/right, the throttle is automatic, ⚡ boost pads and personal boosts. The track is a spline plus a side offset, so the server sim stays tiny. |
| 4 | 🫘 **Oware** ✅ | Strategy | 2 | Turn-based | The traditional mancala game: sow seeds, capture twos and threes, the grand-slam rule. Alpha-beta bots, like Checkers. |
| 5 | ⚪ **Reversi** ✅ | Strategy | 2 | Turn-based | The 19th-century public-domain game (not the branded version): flip lines of discs. Bots weigh corners, edges and mobility. |
| 6 | #️⃣ **Ultimate Tic-Tac-Toe** ✅ | Quick classics | 2 | Turn-based | The folk game: nine boards in one, and your move sends your rival to a board. Monte Carlo bot. |
| 7 | ⚫ **Nine Men's Morris** ✅ | Quick classics | 2 | Turn-based | The traditional mill game: place, move, then fly. Alpha-beta bot. |
| 8 | 🃏 **Contract rummy** ✅ | Cards | 2–6 | Turn-based | Answers #39 with an original design in the public-domain rummy family: each hand demands a contract (two sets, a set and a run…). |
| 9 | ♥️ **Hearts** ✅ | Cards | 3–6 (best 4) | Turn-based | The traditional trick-avoiding game: pass three, avoid hearts and the queen of spades, or shoot the moon. |
| 10 | 🂡 **Twenty-One** ✅ | Cards | 1–6 | Simultaneous | The traditional casino game against a dealer bot, everyone at once, with chips across rounds. Instant solo play. |

**After the plan:** Speed (#48) and Trivia Rush (#49) took the lobby to **41**. To keep groups even,
Trivia Rush joined Party, Fib Finder moved to Words & puzzles, and Twenty-One moved from Cards to a
renamed 🎲 **Dice & casino**: Party 6 · Action 8 · Strategy 6 · Quick classics 6 · Cards 6 · Dice &
casino 4 · Words & puzzles 5. ✅ 🪜 **Word Ladder** (Lewis Carroll's public-domain "doublets" puzzle as a
race) then brought Words & puzzles to 6.

✅ 🎲 Dice & casino then reached 6 with 🚢 **Ship, Captain & Crew** and 🤥 **Liar's Dice**, so all seven groups fill
their rows: **44 games**, Party 6 · Action 8 · Strategy 6 · Quick classics 6 · Cards 6 · Dice & casino 6 ·
Words & puzzles 6. An original roll-and-write is still on the list if #41's "qork" turns out to be one.

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
- **Wordsmith:** a live score preview while placing tiles, drag-and-drop, and challenge voting
  as a house-rules dictionary.
- **Night Heist:** character roles (the Insider sees one other player's choice), and a
  heat meter that makes repeat grabbers easier to catch.
- **Infrastructure:** persist rooms across restarts, and host online behind HTTPS.
