#!/usr/bin/env python3
"""Play bot-only games of one Game Night game through the real Room, to catch stalls,
crashes and view-serialisation errors, and to check that harder bots win more.

Usage (from the project root):
  python3 .claude/skills/add-game/scripts/simulate.py <game_id> [--players N] [--runs N] [--set key=value ...]
  python3 .claude/skills/add-game/scripts/simulate.py games/mygame.py     # test before registering

Simulated time: bot pacing and timers are skipped, so real-time games run much faster than real play.
Games with server-side physics (a frame(now) method, e.g. Air Hockey) are stepped at 60 fps of simulated time."""
import argparse
import ast
import collections
import importlib.util
import json
import os
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
sys.path.insert(0, ROOT)

import server  # noqa: E402
from games import GAMES, GAME_INFO, Game  # noqa: E402


def load_file(path):
    """Import a games/<file>.py module that isn't registered yet and register it for this run."""
    name = "games." + os.path.splitext(os.path.basename(path))[0]
    spec = importlib.util.spec_from_file_location(name, os.path.abspath(path))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    cls = next(v for v in vars(mod).values() if isinstance(v, type) and issubclass(v, Game) and v is not Game and v.id)
    GAMES[cls.id] = cls
    GAME_INFO.append(cls.info())
    return cls.id


def play(game_id, players, settings, levels):
    room = server.Room("SIM")
    host = room.add_player("Host")
    room.settings = server.default_settings(game_id)
    room.settings.update(settings)
    for i in range(players - 1):
        room.add_bot(levels[(i + 1) % len(levels)])
    host.bot = levels[0]  # the host plays as a bot too
    room.start()
    steps, started = 0, time.time()
    physics = hasattr(room.game, "frame")  # real-time physics games run on a simulated 60 fps clock
    clock, limit = time.time(), 400000 if physics else 20000
    while room.phase == "playing":
        steps += 1
        if steps > limit:
            raise RuntimeError(f"game did not finish within {limit} steps")
        if physics:
            clock += 1 / 60
            with room.cond:  # push_fast notifies streams, which needs the lock (as on the live server)
                room.game.frame(clock)
            if steps % 600 == 0:
                for p in room.players.values():
                    json.dumps(room.view(p))
            continue
        for p in room.contenders():  # skip real-time pacing
            if hasattr(p.g, "next_at"):
                p.g.next_at = 0
        room.bot_at = 0
        if room.game.bot_ready():
            room.game.bot_tick()
        elif room.deadline:
            room.game.on_timeout()
        else:
            raise RuntimeError(f"stalled: no bot can move and no timer is set (turn={room.turn})")
        room.snap()
        if steps % 5 == 0:  # every view must serialise for every viewer
            for p in room.players.values():
                json.dumps(room.view(p))
    winner = room.players.get(room.winner)
    return (winner.bot if winner else "no winner"), steps, time.time() - started, room.log[-1]["text"]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("game", help="game id, or a path to a games/*.py file")
    ap.add_argument("--players", type=int, default=0, help="default: the game's minimum (at least 2)")
    ap.add_argument("--runs", type=int, default=10)
    ap.add_argument("--set", action="append", default=[], metavar="KEY=VALUE",
                    help="game setting, e.g. --set size=13 --set powers=False")
    args = ap.parse_args()

    gid = load_file(args.game) if args.game.endswith(".py") else args.game
    if gid not in GAMES:
        sys.exit(f"Unknown game {gid!r}. Registered: {', '.join(GAMES)}")
    cls = GAMES[gid]
    players = args.players or max(2, cls.min_players)
    settings = {k: ast.literal_eval(v) if v[:1] in "0123456789-[{(\"'" or v in ("True", "False", "None") else v
                for k, v in (s.split("=", 1) for s in args.set)}
    levels = ["hard", "easy", "normal"]

    results = [play(gid, players, settings, levels) for _ in range(args.runs)]
    wins = collections.Counter(r[0] for r in results)
    print(f"{cls.icon} {cls.name}: {args.runs} games, {players} players "
          f"(host=hard, then {', '.join(levels[(i + 1) % 3] for i in range(players - 1))})")
    print(f"  wins:  {dict(wins)}")
    print(f"  steps: avg {sum(r[1] for r in results) // len(results)}, max {max(r[1] for r in results)}")
    print(f"  time:  avg {sum(r[2] for r in results) / len(results):.2f}s per game (simulated)")
    print(f"  e.g.   {results[0][3]}")


if __name__ == "__main__":
    main()
