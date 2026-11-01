---
name: verify
description: Drive the real Game Night app in headless Chromium to verify a change at its surface (phone-sized page, real clicks).
---

# Verifying a Game Night change in a real browser

## Handle
- Test server on its own port (it writes `data/rooms-<PORT>.pickle`; delete it afterwards):
  `PORT=8791 python3 server.py &`
- Browser: the Kali `python3-playwright` package is broken (missing `/usr/share/nodejs/playwright/cli.js`).
  Install `playwright-core` into the scratchpad instead and drive the system Chromium:
  ```bash
  cd <scratchpad>/pw && npm init -y && npm install playwright-core@1.48.2
  NODE_PATH=<scratchpad>/pw/node_modules node drive.js
  ```
  `chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] })`, viewport 485×900
  (the phone width every player report came from).

## Driving
- Start a solo game: `#name` → select `#soloGame` = `<game id>` → click `#soloBtn`. Solo seats
  `SOLO_BOTS[game]` bots (static/app.js), e.g. Twenty-One seats 2.
- Rematch: `#rematchBtn`. The page's own `act(type, extra)` is global and can be called with
  `page.evaluate` (useful to fire two actions at once).
- Rare deals or states: run the real server through a small wrapper that monkeypatches the game
  (e.g. stacks the shoe in `deal`) and then `runpy.run_path("server.py", run_name="__main__")`.
- Check sideways overflow: `document.documentElement.scrollWidth` should be 485.

## Gotchas
- Never `pkill -f server.py` / `pgrep -f <name>`: the pattern matches your own shell and kills it.
  Find test servers by port: `tr '\0' '\n' < /proc/$p/environ | grep PORT=`.
- To compare with the old behaviour: `git worktree add --detach <scratch>/head HEAD`, copy
  `data/words.txt` into it, and run a second server from there.
- Known existing issue (October 2026): a long log line (e.g. "🧮 Dealer 23 (bust): …") widens the one-column
  `.layout` grid through the side panel's log ticker, so the page scrolls sideways at 485 px.
