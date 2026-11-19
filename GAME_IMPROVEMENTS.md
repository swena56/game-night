# Game Night Improvement Guide

This guide proposes one practical next improvement for every game currently registered in
`games/__init__.py`. Each one names the player behavior to change and a check that should pass.
Items marked **implemented; verification pending** have code changes but still need the listed
acceptance check before they can be considered complete.

## How to use the guide

1. Pick one proposal and read its current rules in `games/<id>.py`, its screen in
   `static/games/<id>.js`, and the corresponding README entry. Confirm that the behavior is still
   missing; this project changes quickly and the README or this guide can become stale.
2. Keep the change focused on the stated player benefit. Decide the rule and edge cases before
   editing; update the server view, bot behavior, help text, and styles only where that behavior
   requires them. Keep player-specific secrets inside that player's view.
3. Check compatibility with existing room settings and saved state. Validate every server input.
   For simultaneous and real-time games, keep scoring and shared physics server-authoritative.
4. Verify the listed scenario, then run the project checks from `.claude/skills/add-game/SKILL.md`:
   Python compilation, bot simulation, JavaScript syntax, and the browser UI harness. Add a UI
   driver or targeted rule coverage when the change adds a new interaction or rule. For 3D games,
   check both WebGL and the existing fallback; touch feel still needs a real device.
5. Update the game help, README game table, and this guide's status when the feature ships. Do not
   mark a proposal complete from a code change alone: verify the player-facing behavior.

## Party

| Game (`id`) | What to change | Acceptance check |
|---|---|---|
| Unmask (`unmask`) | Add a post-round deduction recap that shows which asked traits eliminated which faces, while keeping unrevealed faces hidden until the round ends. **Implemented; verification pending.** | In a completed round, each elimination can be traced to a public answer; private Manhunt answers remain private until reveal. |
| Odd One Out (`oddone`) | Add a short optional final defense: after votes lock, let the accused odd player give one last clue before the reveal. | The defense appears once, cannot change votes, and the odd player still does not learn their role early. |
| Scribble Relay (`relay`) | Add a replay control for each revealed chain so players can step through it again after the initial reveal. | Replay shows the same cards in order, does not duplicate votes or scores, and works on a narrow phone screen. |
| Trivia Rush (`trivia`) | Add a one-sentence explanation to each answer reveal, including why the correct answer is right. **Implemented; verification pending.** | The explanation follows the question through server state, renders after answers lock, and does not reveal the answer before then. |
| Doodle Dash (`doodle`) | Add a post-round gallery that lets players compare the original picture with the final guesses and accepted answers. | Gallery order and answer data match the round; it appears only after guessing closes and is usable on mobile. |
| Bingo Bash (`bingo`) | Add a visual near-win callout when a card is one daub away from a winning pattern. | The callout reflects the selected pattern and card, updates after each ball, and never marks an invalid bingo as a win. |
| Frozen Pond (`pond`) | Add a short catch log with species, weight, location, and fight result for every landed or escaped fish. | The log distinguishes catches from escapes, keeps score consistent, and stays readable during the live round. |
| Domino Run (`domino`) | Add a build-phase preview that names the first target and likely score for each placed run before the push. | The preview matches the server's topple simulation for paths, merges, blockers, and target scores. |
| Coin Cascade (`pusher`) | Add an adjustable drop strength so players can trade a shallow safe drop for a deeper, riskier shove. | Strength changes the server's drop physics, is visible before release, and identical inputs produce identical results. |
| Wobble Tower (`wobble`) | Add a placement preview that shows the likely lean direction and a simple stability grade before committing a block. | Preview and server verdict agree for edge placements and both Build and Pull & Stack modes. |
| Night Heist (`heist`) | Add a round-to-round history of each player's public outcomes so the table can read patterns without revealing current picks. | Current choices stay secret until reveal; the history contains only resolved rounds and survives refresh. |

## Action

| Game (`id`) | What to change | Acceptance check |
|---|---|---|
| Spire Siege (`spire`) | Add a short between-wave choice that lets players spend a cleared-ring reward on one of two balanced upgrades. | The choice is private to the player, applies only to their tower, and cannot be selected twice for one reward. |
| Prism Pop (`prism`) | Add a board preview for incoming frost or stone attacks so players can plan a match before the obstruction lands. | Preview identifies the affected board cells without changing them; attack resolution stays consistent across browsers. |
| Marble Rush (`marble`) | Add optional checkpoint split times and a personal best ghost for the same course seed. | Ghost follows only that player's saved run, split times sum to the final time, and the race remains fair across players. |
| Light Riders (`riders`) | Add a limited-use brake or sharp-turn control so riders can choose a precise corner at a speed cost. | Braking reduces speed on server simulation, works from touch and keyboard, and cannot be held to stop indefinitely. |
| Whisker Run (`whisker`) | Add a visible, brief warning when a mouse is close to a cat that is just outside the camera view. | Warning direction points toward the nearest off-screen cat, disappears when safe, and does not reveal hidden maze information. |
| Paint Blast (`paintblast`) | Add a clearly marked blast preview while a bomb is active, including which crates or walls block each ray. | Preview matches the final blast geometry and changes correctly when the bomb timer or maze state changes. |
| Sumo Saucers (`sumo`) | Add a recoverable practice option that replays the last collision with player positions and impact direction. | Replay uses recorded server positions, does not alter the next round, and can be skipped on small screens. |
| Putt Party (`putt`) | Add a course scorecard with per-hole strokes, par, best shot, and a running match total. | Card totals match the server's strokes across lost balls, pickups, ties, and rematches. |
| Hover Rally (`rally`) | Add a lap-by-lap racing line trace so players can compare where they gained or lost time. | Trace is local to each racer, uses the same track seed, and does not expose another player's hidden input. |
| Air Hockey (`hockey`) | Add a short goal replay with the puck path and last mallet touch. | Replay matches the server puck path, attributes the touch correctly, and finishes before the next serve. |
| Snowball Scramble (`snowball`) | Add team or solo practice drills that teach aiming, sheltering, and dodging before a match. | Each drill gives a clear objective and result, uses the same controls as live play, and does not award match points. |
| Paper Boat Rapids (`rapids`) | Add a river map that previews the next stretch's rapids, falls, and safe gaps. | Map coordinates align with the shared generated course and update at the same time for every player. |
| Midway Night (`midway`) | Add a per-booth tutorial shot that shows the aim and power effect before the first scored throw. | Tutorial is skippable, consumes no throw, and explains the correct control for each booth. |
| Paper Planes (`planes`) | Add a post-flight flight telemetry panel showing launch speed, lift, wind, and the cause of the final landing. | Values come from the server's simulated path and explain the outcome without changing scoring. |
| Orbit Golf (`orbit`) | Add a trajectory preview that can be toggled between a short near-field path and the full predicted shot. | Both previews use the authoritative shot simulation and show black holes, wormholes, and planet collisions accurately. |
| Regatta (`regatta`) | Add an upwind layline indicator showing the two practical tack routes to the next buoy. | Indicator uses current wind and buoy position, updates after wind shifts, and leaves the boat's physics unchanged. |
| Spin Tops (`tops`) | Add a pre-round matchup card comparing each top's speed, mass, attack, and stamina in the chosen arena. | Card reflects the actual selected top and arena modifiers and remains understandable without relying on color alone. |
| Moon Lander (`lander`) | Add a landing replay with a timeline for descent speed, horizontal speed, tilt, and fuel. | Replay values match the server's verdict and make a successful and failed landing distinguishable. |
| Billiards (`billiards`) | Add a practice table with no opponent and a resettable cue-ball position for learning spin and bank shots. | Practice does not affect room wins, supports the existing physics controls, and can reset without reloading the room. |
| Cannon Hills (`cannon`) | Add an aim preview that shows likely impact and blast radius for the selected shell under current wind. | Preview agrees with server resolution for terrain collision, wind, and every shell type. |
| Ice Stones (`stones`) | Add an end replay that draws every stone path and highlights the scoring stone and measurement distance. | Replay recomputes neither score nor turns and clearly explains ties, hot stones, and removed stones. |
| Wind Archery (`archery`) | Add a compact shot history showing aim, wind correction, target motion, and score for each arrow. | History matches the server result and can be opened after the shot without blocking the next archer. |
| Meteor Shot (`meteorshot`) | Add a ghost path and closest-approach marker while adjusting a comet's launch parameters. | Preview uses the same physics as the scored shot and clearly distinguishes a near miss from a hit. |
| Lane Night (`lanes`) | Add a frame-by-frame score explanation for strikes, spares, splits, and bonus balls. | Frame totals reconcile with standard bowling scoring, including the tenth-frame bonus rolls. |
| Sky Drop (`skydrop`) | Add a race replay with a depth timeline and a selectable overlay for ring catches, hazard hits, and boost use. | Replay uses server snapshots, finish order and scores remain unchanged, and the overlay is readable on mobile. |

## Strategy

| Game (`id`) | What to change | Acceptance check |
|---|---|---|
| Tide Castles (`tide`) | Add a wave-by-wave forecast comparison that shows which build pieces protected the keep and which failed. | Explanation follows the actual resolved wave path and scores, including moats, ramparts, and moved keeps. |
| Chess (`chess`) | Add a post-game move review that flags major swings and offers one legal alternative for each turning point. | Alternatives are legal in the recorded position; review is optional and does not change the game result. |
| Checkers (`checkers`) | Add a move-history replay with forced-capture chains shown as one grouped turn. | Replay reproduces captures, crowning, flying kings, and undo-resolved state exactly. |
| Backgammon (`backgammon`) | Add a turn analysis that shows legal dice uses the player missed before ending the move. | Analysis respects doubles, bar entry, bearing off, and the must-use-both-or-higher-die rules. |
| Go (`go`) | Add an endgame territory estimate that marks unsettled groups before both players pass. | Estimate is clearly advisory, does not auto-remove stones, and preserves the chosen scoring rules and komi. |
| Oware (`oware`) | Add a sowing-path preview that highlights which rival pits would be captured for a selected move. | Preview accounts for wraparound, grand-slam and must-feed rules, and matches the accepted move result. |
| Reversi (`reversi`) | Add an endgame hint that compares legal moves by immediate flips and exposed corner risk. | Hint never recommends an illegal square and respects blocked-square variants. |
| Hedgerow (`hedgerow`) | Add a route comparison showing the shortest path before and after a proposed hedge. | Comparison accounts for all placed hedges, hops, and other pawns without suggesting a sealed path. |
| Kindred (`kindred`) | Add a one-turn lookahead that previews both placement score and the strongest piece the rival could receive. | Preview uses the current scoring rules and cannot leak a piece choice before it is made. |
| Realm Wars (`realm`) | Add a compact threat forecast for the next rival turn, based on reachable borders and visible troop counts. | Forecast updates after moves and storms, explains its assumptions, and never uses hidden bot or player state. |
| Sky Drift (`drift`) | Add a wind-route planner that compares likely pennant paths for climb, hold, and descend over the next few turns. | Planner uses the public forecast and storm path and updates when the forecast changes. |

## Quick classics

| Game (`id`) | What to change | Acceptance check |
|---|---|---|
| Sea Battle (`seabattle`) | Add a post-game shot map that separates confirmed hits, misses, and sonar information used during the hunt. | Map reveals fleets only after the game and reproduces all prior scan and shot results. |
| Drop Four (`dropfour`) | Add a one-move threat preview for every column, showing immediate wins and immediate opponent wins. **Implemented; browser verification pending.** | Preview respects gravity, player count, bomb discs, pull-outs, and variant board sizes. |
| Dots & Boxes (`boxes`) | Add an endgame chain annotation that labels the remaining chains and who is expected to take each one. | Labels match the actual open edge graph and do not affect scoring or move legality. |
| Tic-Tac-Toe (`tictactoe`) | Add a short rematch series with alternating first move and a series score. | Starter alternates correctly, each board uses the chosen variant, and series standings survive each round. |
| Ultimate Tic-Tac-Toe (`ultimate`) | Add a route preview showing which small boards a move sends the rival to and which boards are already closed. | Preview follows forced-board rules and correctly handles a move that frees the rival to play anywhere. |
| Nine Men's Morris (`morris`) | Add a repetition and blocked-position warning so players can see when a move risks a draw or loss. | Warning matches movement, flying, mill capture, and current repetition rules. |
| Sudoku (`sudoku`) | Add a step-by-step explanation for a hint that names the row, column, or box constraint used. | Explanation is valid for each difficulty and does not reveal unrelated puzzle cells. |

## Cards

Card games usually use `games/<id>.py` for rules and `static/games/<id>.js` for the screen. Several
share `static/cardtable.js`; inspect that shared renderer before proposing a visual change that
would affect other games. Preserve each game's hidden hands and use its existing `Cards` helpers.

| Game (`id`) | What to change | Acceptance check |
|---|---|---|
| Last Card (`lastcard`) | Add a clear explanation for why a jump-in is legal or rejected, including the active rank and suit. | The explanation matches jump-in settings and never allows a player to interrupt an illegal turn. |
| Lantern Market (`lantern`) | Add a post-auction value report comparing each private bid with the winning and clashing bids. | Report appears only after reveal and never exposes bids before all players have locked in. |
| Texas Hold'em (`holdem`) | Add a hand-range practice mode that deals a scenario and asks whether to fold, call, or raise. | Practice uses real hand evaluation and odds, is separate from the live room, and explains the result. |
| Cribbage (`cribbage`) | Add a pegging replay that groups each run, pair, fifteen, thirty-one, and go into a score explanation. | Replay sums to the recorded peg movement and handles a pegging-out win mid-hand. |
| Hearts (`hearts`) | Add a passing preview showing the likely suit voids and point exposure created by the selected three cards. | Preview uses only the player's hand and public deal information; it cannot expose opponents' cards. |
| Speed (`speed`) | Add a face-to-face two-phone table layout with larger center piles and synchronized stock indicators. | Both layouts accept the same legal plays and remain synchronized under rapid simultaneous input. |
| Contract Rummy (`rummy`) | Add a layoff planner that shows which cards can extend existing melds before the player ends their turn. | Planner respects contract completion, wild-card rules, and the current turn's allowed layoffs. |
| Solitaire (`klondike`) | Add an optional move counter and personal best for each deal and draw mode. | Counter excludes undo-restored moves and separates daily deals from random deals. |
| FreeCell (`freecell`) | Add a safe-move explanation to auto-home so players can see why a card can no longer block a needed sequence. | Explanation follows the selected auto-home policy and never moves a card that makes the deal less solvable under that rule. |
| Cheat (`cheat`) | Add a bluff-confidence recap after each challenge based on cards already seen and claims made. | Recap uses only public plays and the player's own hand, and does not influence challenge resolution. |
| President (`president`) | Add a passing screen that previews the rank exchange and the likely strength of the resulting hand. | Preview reflects finish order and exchanged cards without exposing private hands to other players. |
| Spoons (`spoons`) | Add a practice tutorial that demonstrates the pass timing and spoon scramble with no elimination. | Tutorial uses the live timing rules but does not modify room score or player lives. |
| Knock Out Whist (`kowhist`) | Add a hand summary explaining which trick-taking choice would have avoided elimination. | Summary uses the public trick history and correct trump choice; it appears after the hand resolves. |
| Spades (`spades`) | Add a partnership bid review that compares contract, nil, bags, and tricks actually taken. | Review computes team score correctly, including nil bonuses and bag penalties. |
| Oh Hell (`ohhell`) | Add a round forecast showing how the dealer's hook changes the table's total bid target. | Forecast updates with each bid and never permits the dealer to make the forbidden total. |
| Euchre (`euchre`) | Add a trump-ordering recap that labels the right and left bower and explains the winning trick. | Labels and recap follow the turned suit, going-alone state, and current trick. |
| GOPS (`gops`) | Add an end-of-round reveal chart showing the value of each prize and the bid cards spent on it. | Reveal occurs only after simultaneous bids lock and accounts for ties exactly. |
| Scopa (`scopa`) | Add a capture-plan preview that highlights all table cards taken by the selected card. | Preview matches rank and sum captures, Escoba rules, and the sweep condition. |
| Gin Rummy (`gin`) | Add an undercut risk preview that shows the opponent's possible layoff exposure before knocking. | Preview uses only known cards, clearly labels estimates, and does not reveal the opponent's hand. |
| German Whist (`germanwhist`) | Add a stock-pick history explaining how each won trick affected the next card choice. | History matches the face-up stock card and recorded trick winner throughout the deal. |
| Fan Tan (`fantan`) | Add a pass estimate that shows how many turns each playable suit sequence could take to empty the hand. | Estimate updates after each play and marks itself as a heuristic rather than a guaranteed finish time. |
| Palace (`palace`) | Add a private planning strip for the face-down finish cards that records which ranks are still unseen. | Strip never reveals face-down cards and resets correctly when the hand is taken or restarted. |
| Egyptian Ratscrew (`ratscrew`) | Add a slap review that explains the exact pattern recognized or why a slap was early. | Review checks the enabled variant, face-card challenge, and timing window from the resolved pile. |
| Nertz (`nertz`) | Add a shared-foundation activity indicator that makes another player's newest move visible without exposing their hand. | Indicator reflects the live pile update, stays readable at speed, and cannot be mistaken for a playable card. |
| Whist (`whist`) | Add a trick-by-trick partnership recap showing which side took each point-scoring trick. | Recap totals match the chosen game length and partnership score. |
| Briscola (`briscola`) | Add a trick preview that compares the played card with the current briscola and lead suit. | Preview matches the 40-card deck ranking and never changes the winner calculation. |
| Blitz (`blitz`) | Add a knock decision aid showing the player's current same-suit total against the best possible unseen draw. | Aid uses only known cards, marks uncertainty, and respects the selected knock and scoring rules. |
| Ranter-Go-Round (`ranter`) | Add a pass-choice recap that explains how a king block or neighbor swap changed the final low card. | Recap follows seat order and king blocking without revealing cards before the reveal. |
| Big Two (`bigtwo`) | Add a combination builder that validates a selected poker-style play before it is submitted. | Builder follows the active variant's legal combinations and rank/suit ordering. |
| Go Fish (`gofish`) | Add a private memory panel of ranks each opponent has requested or denied during the current hand. | Panel is player-specific, resets with the hand, and contains only public asks and replies. |
| Old Maid (`oldmaid`) | Add a visual history of pair removals so players can follow how the odd card moved around the table. | History shows only resolved draws and never exposes an opponent's current hand. |
| Cassino (`cassino`) | Add a build ledger showing each table build's target sum, owner, and cards committed. | Ledger enforces ownership and matches the cards available for a later capture. |
| Spite & Malice (`spite`) | Add a planning hint for legal pay-off pile plays and the next card that would be uncovered. | Hint uses the player's own piles and shared state only; it never exposes another hand. |
| War (`war`) | Add a compact battle history with each tie's war cards and the cards ultimately won. | History handles empty piles and configured battle limits without changing card ownership. |
| Ninety-Nine (`ninetynine`) | Add a bid-planning screen that estimates which three discards best support the intended trick count. | Estimate respects the special discard bids and is private to the bidding player. |
| Sixty-Six (`sixtysix`) | Add a score-to-66 tracker that explains when closing the stock is safe or risky. | Tracker uses public points and the player's own hand, and distinguishes known from unknown cards. |
| Pitch (`pitch`) | Add a scoring preview during bidding that explains which High, Low, Jack, and Game points are still attainable. | Preview matches the chosen partnership and deck settings and reconciles with the final hand score. |
| Écarté (`ecarte`) | Add a private exchange preview showing which cards the player gives up and the trump exposure that remains. | Preview updates with each proposed exchange and does not reveal discarded cards to the opponent early. |
| Five Hundred (`fivehundred`) | Add a contract-risk summary showing the tricks needed, score swing, and misère exposure before bidding. | Summary follows kitty pickup, joker/bower rules, partnership scoring, and the current contract. |
| Canasta (`canasta`) | Add a meld tracker for natural, mixed, and wild-card canastas and the current team's red threes. | Tracker matches opening requirements, frozen-pile rules, and bonus scoring. |
| Eleusis (`eleusis`) | Add a rule-learning notebook that lets players record their own accepted/rejected pattern hypotheses privately. | Notes are private and never alter the secret rule or reveal the answer to other players. |
| Mao (`mao`) | Add a private penalty history that groups repeated rule mistakes and their exact penalties. | History reveals only penalties already incurred and preserves the secret rules until the game ends. |
| Belote (`belote`) | Add a declaration and trick scorecard that separates belote-rebelote, melds, and card points. | Scorecard reconciles with contract success and all team bonuses. |
| Pinochle (`pinochle`) | Add a meld selection helper that totals legal melds before the partnership commits its bid. | Helper follows the selected pinochle rules and keeps partner cards hidden. |
| Bezique (`bezique`) | Add a meld history that shows which cards were declared and when they return to play. | History follows the draw pile and meld timing, including double bezique scoring. |
| Bridge (`bridge`) | Add a post-deal auction review showing the final contract, declarer, dummy, and missed scoring opportunities. | Review uses the actual auction and Chicago score and never reveals hands before play permits it. |
| Truc (`truc`) | Add a stake timeline that shows how each Truc raise changed the value of the hand. | Timeline matches fold, call, and put-rule outcomes without revealing unplayed cards. |
| Skat (`skat`) | Add a declarer's contract-value calculator before play, including skat pickup or hand-game choice. | Calculator follows game value, matadors, multipliers, and the selected contract. |
| Piquet (`piquet`) | Add a declaration comparison card showing point, sequence, and set totals against the rival's declarations. | Card is shown at the proper declaration phase and reconciles with repique, pique, and capot scoring. |

## Dice & casino

| Game (`id`) | What to change | Acceptance check |
|---|---|---|
| Moon Shot (`moonshot`) | Add a route preview that shows the likely landing spaces for each possible roll before the player chooses to bank. | Preview uses the current track and accurately marks boosts, meteors, wormholes, and bumps. |
| Yacht (`yacht`) | Add a category comparison that shows the best remaining box for the current dice and its opportunity cost. | Comparison follows bonus-roll and extra-Yacht settings and leaves the final category choice to the player. |
| Farkle (`farkle`) | Add a bank-versus-roll odds panel using the dice already set aside and the remaining dice count. | Probabilities match the scoring dice rules, including hot dice, and update after a selection. |
| Qork (`qork`) | Add a reaction-practice mode with varied trigger rules and a post-trial reaction-time benchmark. | Practice tests the same tap timing as live play, excludes practice from room scores, and handles false starts. |
| Ship, Captain & Crew (`shipcrew`) | Add a cargo decision aid comparing reroll risk with the current haul and pub-pot or raid stakes. | Aid respects remaining rolls, locked ship/captain/crew dice, and current optional rules. |
| Shut the Box (`shutbox`) | Add a remaining-total forecast that compares legal tile combinations and the chance of closing the box. | Forecast uses the current open tiles and one- or two-die mode and does not auto-select a move. |
| Liar's Dice (`liars`) | Add a bid history with estimated odds recalculated from each player's public bid and known dice count. | Odds exclude hidden dice values, support wild and palifico rules, and are clearly labeled estimates. |
| Midnight (`midnight`) | Add a risk comparison for keeping the current score versus rerolling the unkept dice. | Odds account for the required 1 and 4 and match the current kept dice. |
| Mia (`mia`) | Add a bluff likelihood indicator after a call, based only on the public claim sequence and remaining lives. | Indicator does not inspect the hidden roll and disappears before the next secret roll. |
| Dice Squares (`squares`) | Add a live score forecast for every row and column affected by the selected die placement. | Forecast matches final scoring for all dice-hand categories and remains private until placement locks. |
| Dice Brawl (`brawl`) | Add a combat preview that summarizes likely damage, guard, healing, and skull risk before banking a roll. | Preview follows held dice and chosen target, including third-skull backfire and quake effects. |
| Dice Derby (`derby`) | Add a ticket portfolio view that shows current payouts and which horse movements help or hurt each ticket. | View reflects secret tickets for their owner only and reconciles after every roll. |
| Blackjack (`twentyone`) | Add a split-hand summary showing each hand's current stake, dealer up-card, and recommended basic-strategy action. | Recommendation follows the active shoe/rule options, is labeled advisory, and handles split aces and surrender. |

## Words & puzzles

| Game (`id`) | What to change | Acceptance check |
|---|---|---|
| Lucky Letters (`lucky`) | Add a puzzle archive that lets players review solved phrases and their category after the round. | Archive contains only completed puzzles, respects rematch reuse rules, and does not expose an active phrase. |
| Wordsmith (`wordsmith`) | Add a private rack-planning view that previews likely next turns after a proposed play. | Preview uses the current board and dictionary, and never commits tiles or changes the live score. |
| Word Bomb (`wordbomb`) | Add a post-round review of valid words used and the bomb chunks that caused each loss. | Review appears only after the fuse resolves and does not leak an active fuse timer. |
| Grid Hunt (`gridhunt`) | Add a personal grid heatmap showing searched paths and high-value words the player missed. | Missed words are shown only after time expires and the heatmap matches the current grid rotation. |
| Word Search (`wordsearch`) | Add a per-word progress list that distinguishes found, claimed by a rival, and still-hidden words. | Shared and solo-copy modes show the correct ownership and do not expose paths before discovery. |
| Word Garden (`garden`) | Add an optional hint ladder that reveals one letter at a time with a clearly shown score cost. | Each hint deducts exactly the announced score and leaves bonus-word scoring unchanged. |
| Safecracker (`safecracker`) | Add a hypothesis board that lets players mark candidate colors privately between simultaneous guesses. | Notes remain local to the player and never affect the shared clue history or code count. |
| Fib Finder (`fibfinder`) | Add a post-vote fact card with a source note and a short context explanation for the true answer. | Source/context is associated with the revealed fact and cannot be inspected before voting closes. |
| Word Ladder (`ladder`) | Add an optional shortest-path hint that shows the next letter change without filling the whole answer. | Hint uses the selected dictionary and word length, charges the configured hint cost, and preserves race timing. |

## Cross-game implementation notes

- The catalog and category assignment come from `games/__init__.py`; use it as the source of truth
  when checking whether this guide covers every game.
- Game rules and bot behavior normally live in `games/<id>.py`. Browser code normally lives in
  `static/games/<id>.js`, with per-game styles in `static/games/<id>.css` when present. Some screens
  share helper modules; inspect `UI_EXTRA` in `static/app.js` and the relevant module before changing
  a shared interaction.
- Add or extend the smallest relevant automated check. Bot simulations should check that games
  finish, views serialize, and stronger bots behave as intended. Browser checks should cover touch,
  keyboard, help, replay/rematch where supported, and missing-WebGL behavior for 3D games.
- A proposed improvement is ready to ship only when its acceptance check passes, the help text and
  README describe the actual behavior, and the change does not break existing settings or player
  privacy.
