---
name: commit-restart
description: Commit the current work in Game Night and restart the dev server on port 8000 safely. Use when the user asks to commit and restart, deploy locally, make changes live on the dev server, or just restart the server after changes.
---

# Commit and restart the Game Night dev server

Work from the repository root. If the user asks only to restart, skip to **Restart**. If they ask only to commit, stop
after **Commit**. Do not push unless the user asks.

## Check the changes

1. Run `git status --short` and read `git diff`. Work out which changes belong to this task. Other sessions and the user
   edit this repo too, so ask about changes you can't account for.
2. If files under `static/` changed, check that `CACHE` in `static/sw.js` was bumped, with a short note in its comment.
3. Run the checks for what changed:
   - Python: `python3 tests/<game>_rules.py` and any other `tests/<game>_*.py`. Some take several minutes
     (`pinball_levels.py` takes about 6), and this host has one core, so run them one at a time.
   - JavaScript: `node --check <file>` for each changed file.
4. Unless only docs or tests changed, run the `/verify` skill right before committing. A check already made in this
   session counts only if the code hasn't changed since.

If a check fails, stop and report it with its output. Don't commit or restart.

## Commit

- If the current branch is `main`, create a branch first.
- Stage files by name; don't use `git add -A` or `git add .`. Leave out local files such as `.mcp.json`, anything that
  may hold secrets, and files from other work.
- Make separate commits for unrelated changes. For player feedback, put the report IDs in the message (`#249`).
- Git has no identity configured on this host. Don't change the config. Pass the previous commit's author instead:

  ```sh
  git -c user.name="$(git log -1 --format=%an)" -c user.email="$(git log -1 --format=%ae)" commit -F <message-file>
  ```

- End the message with the attribution lines the session gives you, if any.
- Check the result with `git log -1 --stat` and `git status --short`.

Committing does not change feedback status. Use the `resolve-player-feedback` skill for that, only when asked.

## Restart

A restart is needed for changes to Python files (`server.py`, `games/`). Files under `static/` are served without one;
players only need to reload.

1. Check whether anyone is connected:

   ```sh
   curl -s -m5 http://localhost:8000/api/health
   ```

   If `streams` is above 0, someone has the app open. Tell the user and ask before restarting. If `streams` is 0,
   continue, even if `playing` is above 0: rooms are saved and restored. If the request fails, check
   `bash start.sh status`.
2. Restart with `bash start.sh restart`. Don't run `./start.sh`, whose shebang is for Termux. Never use
   `pkill -f server.py`, which can match your own shell.
3. Confirm that the new server is running:
   - `curl -s -m5 http://localhost:8000/api/health` shows a small `uptime`, and `rooms` matches the count from before.
   - `tail -20 data/server.log` shows no new traceback.
   - For a new or changed endpoint, request it. Don't send requests that write to real data, such as the feedback inbox.

If the server doesn't come up, show the last lines of `data/server.log` and fix the cause before reporting success.

## Report

Give the commit hash and subject (or say nothing was committed), the checks that ran, whether the server was restarted,
and anything left uncommitted.
