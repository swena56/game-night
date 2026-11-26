# How a player-made pinball table joins the table list

Anyone can build a table in the **pinball table editor** (home screen → 🛠️ Pinball table editor) and play it. Those tables belong to
the room that uploaded them and disappear with it. The **table list** (the lobby's *Table* setting and the editor's *Featured
tables*) is different: it is a small, reviewed set, so every entry is a table worth playing. Getting onto it is a five-step process.

## 1. Build and play it
Build the table in the editor and play it until it feels right (the ▶ Play button). Nothing to submit yet.

## 2. Suggest it
In the editor press **📮 Suggest**, give the table a name (3 to 24 characters) and, if you like, a credit name (up to 16). The editor
sends the table's share code to the player feedback inbox as a suggestion of kind `table`.
- The editor needs at least 6 parts before it offers to send. The server only accepts a suggestion if the table builds (it runs the same
  checks as playing it) and the share code is at most 8,000 characters. Suggestions are rate limited like all feedback (5 per 10 minutes).
- A suggestion changes nothing in the game. It sits in the inbox as an open report.

## 3. Automatic check
A maintainer fetches the inbox (see the *resolve-player-feedback* skill; the local inbox is `data/feedback.jsonl`) and runs:

    python3 tools/pinball_table.py inbox                  # lists table suggestions: #id, status, name, parts
    python3 tools/pinball_table.py check "#12"            # or a share code, or a JSON file

`check` rebuilds the table exactly as the server would, then plays six three-ball games with a simple flipper bot. It **fails** the
table if any of these is true (limits are in `games/pinball_tables/check.py`):
- it has fewer than 6 parts, or nothing on it scores (bumper, target, lane, ramp, saucer, ...);
- no ball ever drains (the ball gets stuck, or there is no way down);
- balls drain too fast (average under 6 s) or last too long (over 70 s);
- the bot averages under 2,000 points.

It also notes parts the bot never triggered; that is a hint to look at, not a failure. The bot is crude: it catches broken tables, not
boring ones.

## 4. Play it, and decide
A person plays the table in the editor (or from the share code). It is added only if it is:
- **fun and fair**: shots are reachable, no spot where the ball gets stuck for good, scoring makes sense for the parts used;
- **different**: not a copy of an existing table with a part moved (compare with `python3 tools/pinball_table.py list`);
- **clean**: a sensible name and credit (no links, no contact details, nothing offensive), and no personal information in either.

If it needs small changes, tell the player what to fix (reply in the feedback inbox) or tweak it in the editor yourself and keep their
credit. Otherwise close the report as not added, with a reason.

## 5. Add it
    python3 tools/pinball_table.py add "#12" --name "Pop Pit" --blurb "One line for the gallery." --author "Sam"

This re-runs the check, and if it passes writes `games/pinball_tables/<slug>.json` (the slug comes from the name; it must be unused).
`--force` adds a table that failed the check, for the rare case where the bot is wrong; say why in the commit message.
Then:
1. play it once more from the lobby after a local server restart (it appears as **⭐ name**, id `t_<slug>`);
2. commit the new file with the report id in the message;
3. restart the production server (`bash start.sh restart`). Tables are read once at start-up, which is deliberate: nothing a visitor
   sends can add to the list while the server runs;
4. close the report as resolved.

## Afterwards
- A listed table gets its own best scores and top-scores list on each player's device (keyed by its id), and is a normal three-ball
  game with the usual modes (classic, time attack, zen, practice). Parts that a table limits to some modes (editor: *Active in*) work
  per mode.
- **Renaming** a table is a new table: its id comes from the file name, so scores stay with the old file name. Fix a typo in the `name`
  field inside the file instead of renaming the file.
- **Removing** one: `python3 tools/pinball_table.py remove <slug>`, commit, restart. Rooms already playing it carry on; new games fall
  back to Golden Hour.
- Rejected or removed tables are never deleted from the player's own saved tables; they stay in the editor's *Your saved tables*.

## Where things live
| What | Where |
|---|---|
| Listed tables | `games/pinball_tables/*.json` (loaded by `games/pinball_tables/__init__.py`) |
| The automatic check | `games/pinball_tables/check.py` |
| Maintainer tool | `tools/pinball_table.py` |
| Player suggestion (server) | `submit_feedback` in `server.py`, kind `table` |
| Lobby setting and game start | `games/pinball.py` (`CURATED`, `TABLES`) |
| Editor gallery and 📮 Suggest | `static/pinball-editor.js`, endpoint `GET /api/pinball-tables` |
