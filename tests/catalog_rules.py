#!/usr/bin/env python3
"""The game list lives in one place, games/__init__.py: the browser gets it from /games/list.js and keeps no copy.

    python3 tests/catalog_rules.py
"""
import json
import os
import re
import sys
import threading
from http.client import HTTPConnection

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import CATEGORIES, FAMILIES, GAMES  # noqa: E402


def read(name):
    with open(os.path.join(ROOT, name), encoding="utf-8") as f:
        return f.read()


headings = [c for c, _ in CATEGORIES]
assert len(set(headings)) == len(headings), "a heading is listed twice"
missing = sorted({g.category for g in GAMES.values()} - set(headings))
assert not missing, f"categories without a heading: {missing}"
for cat, families in FAMILIES.items():
    listed = [i for _, ids in families for i in ids.split()]
    games = {i for i, g in GAMES.items() if g.category == cat}
    assert sorted(listed) == sorted(games), f"{cat}: not in a family {sorted(games - set(listed))}, or listed twice"
for gid, g in GAMES.items():
    assert type(g.solo_bots) is int and 0 <= g.solo_bots <= 5, (gid, g.solo_bots)
    # solo play must be able to start: the player and the bots fill the smallest table
    assert g.min_players <= g.solo_bots + 1 <= g.max_players, (gid, g.solo_bots, g.min_players, g.max_players)

httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
httpd.ssl_context = None
threading.Thread(target=httpd.serve_forever, daemon=True).start()
conn = HTTPConnection("127.0.0.1", httpd.server_address[1], timeout=10)
conn.request("GET", "/games/list.js")
reply = conn.getresponse()
script = reply.read().decode()
httpd.shutdown()
assert reply.status == 200 and reply.getheader("Content-Type").startswith("text/javascript")
data = json.loads(script.removeprefix("window.GAME_CATALOG=").removesuffix(";"))
assert [g["id"] for g in data["games"]] == list(GAMES)
assert data["categories"] == [list(c) for c in CATEGORIES]
assert all(g["soloBots"] == GAMES[g["id"]].solo_bots and g["name"] == GAMES[g["id"]].name for g in data["games"])

page, app = read("static/index.html"), read("static/app.js")
assert page.index("/games/list.js") < page.index("/app.js"), "the list must load before app.js"
assert not re.search(r"const (SOLO_GAMES|SOLO_BOTS|CATEGORIES) = [\[{]\s*[\['\w]", app.replace("= CATALOG", "= x")), "a hand-written list is back in app.js"
for name in ("static/index.html", "static/manifest.webmanifest"):
    assert not re.search(r"\d+\s*(</span>\s*)?games", read(name)), f"a fixed game count in {name}"
print(f"catalog rules OK ({len(GAMES)} games)")
