"""Gin Rummy: knock options carry a rough undercut-risk tag based only on your own deadwood.

    python3 tests/gin_risk_tag.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games.gin import Gin  # noqa: E402

ok = (Gin.risk_tag(0) == "" and Gin.risk_tag(4) == "" and "some risk" in Gin.risk_tag(5)
      and "some risk" in Gin.risk_tag(7) and "undercut risk" in Gin.risk_tag(8) and "undercut risk" in Gin.risk_tag(10))
room = server.Room("TEST")
room.add_player("Ann")
room.add_player("Bo")
room.switch_game("gin")
room.start()
g = room.game
i = 0
hand = ["AC", "2C", "3C", "7H", "7D", "7S", "9D", "TD", "JD", "2S", "KS"]
g.discard = ["4C", "8D", "QD"]
g.hands[i] = hand
label = g.knock_label(hand, "KS")
ok &= bool(label and "Knock (2)" in label and "Estimate" in label and "7♣" in label
           and "4♣" not in label and "8♦" not in label and "Q♦" not in label)
g.hands[1] = ["7C"]
ok &= label == g.knock_label(hand, "KS")
g.hands[1] = ["5S"]
ok &= label == g.knock_label(hand, "KS")
gin = hand.copy()
gin[9] = "4C"
ok &= g.knock_label(gin, "KS") == "🍸 Gin! No layoffs"
print("ok  " if ok else "FAIL", "knock labels use public information and distinguish gin")
sys.exit(0 if ok else 1)
