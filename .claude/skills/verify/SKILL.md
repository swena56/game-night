---
name: verify
description: Drive the real Game Night app in headless Chromium to verify a change at its surface (phone-sized page, real clicks).
---

# Verifying a Game Night change in a real browser

## Handle
- Test server on its own port (it writes `data/rooms-<PORT>.pickle`; delete it afterwards):
  `PORT=8791 python3 server.py &`
- Browser: `cd tests && npm install` brings in `playwright-core` (and jsdom). Run driver scripts with
  `NODE_PATH=/home/kali/game-night/tests/node_modules node drive.js`. Don't use the Kali `python3-playwright` apt package: it
  lacks its Node driver (`/usr/share/nodejs/playwright/cli.js`, from the `node-playwright` package).
  `chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] })`, viewport 485×900
  (the phone width every player report came from).

## Driving
- Start a solo game: `#name` → select `#soloGame` = `<game id>` → click `#soloBtn`. Solo seats
  `SOLO_BOTS[game]` bots (static/app.js), e.g. Twenty-One seats 2.
- Rematch: `#rematchBtn`. The page's own `act(type, extra)` is global and can be called with
  `page.evaluate` (useful to fire two actions at once).
- Rare deals or states: run the real server through a small wrapper that monkeypatches the game
  (e.g. stacks the shoe in `deal`) and then `runpy.run_path("server.py", run_name="__main__")`.
- Run one Chromium at a time: four at once (WebGL games) crashed every browser.
- Check sideways overflow: `document.documentElement.scrollWidth` should be 485. `tests/layout.js` does this for every game.

## Gotchas
- Never `pkill -f server.py` / `pgrep -f <name>`: the pattern matches your own shell and kills it.
  Find test servers by port: `tr '\0' '\n' < /proc/$p/environ | grep PORT=`.
- To compare with the old behaviour: `git worktree add --detach <scratch>/head HEAD`, copy
  `data/words.txt` into it, and run a second server from there.
- Layout columns are `minmax(0, 1fr)` so long text can't widen the page. A board whose own grid uses plain `1fr` can
  then spill past the edge instead (Ultimate did): give it `minmax(0, 1fr)` too. Sweep every game: start each solo
  at 485 and 1280 px and compare `scrollWidth` with the previous commit (one browser at a time, about 5 minutes).
