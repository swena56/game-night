"""Spire Siege ring rewards: private choices, one spend per ring, and both effects."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import spire as Sp  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


r = server.Room("UPGRADE")
ann, bo = r.add_player("Ann"), r.add_player("Bo")
r.switch_game("spire")
r.start()
g = r.game
check("no upgrade before a clear", g.view(ann)["spire"]["upgrade"]["tokens"] == 0)
g.act(ann, {"type": "clear", "rings": 2, "combo": 0, "powers": []})
check("each cleared ring earns a token", ann.g.upgrade_tokens == 2 and g.view(ann)["spire"]["upgrade"]["tokens"] == 2)
check("reward choices stay player-specific", g.view(bo)["spire"]["upgrade"]["tokens"] == 0)
g.act(ann, {"type": "upgrade", "choice": "focus"})
check("focus spends exactly one token and extends a timed benefit",
      ann.g.upgrade_tokens == 1 and ann.g.focus_until >= __import__("time").time() + Sp.FOCUS_SECS - 1)
g.act(ann, {"type": "upgrade", "choice": "shield"})
check("reinforce spends the last token and adds one shield", ann.g.upgrade_tokens == 0 and ann.g.shield == 1)
try:
    g.act(ann, {"type": "upgrade", "choice": "shield"})
    check("a spent reward cannot be selected twice", False)
except GameError:
    check("a spent reward cannot be selected twice", True)
try:
    g.act(bo, {"type": "upgrade", "choice": "unknown"})
    check("invalid upgrades are refused", False)
except GameError:
    check("invalid upgrades are refused", True)

print(f"\n{len(fails)} failed" if fails else "\nall ok")
sys.exit(1 if fails else 0)
