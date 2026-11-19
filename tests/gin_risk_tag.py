"""Gin Rummy: knock options carry a rough undercut-risk tag based only on your own deadwood.

    python3 tests/gin_risk_tag.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from games.gin import Gin  # noqa: E402

ok = (Gin.risk_tag(0) == "" and Gin.risk_tag(4) == "" and "some risk" in Gin.risk_tag(5)
      and "some risk" in Gin.risk_tag(7) and "undercut risk" in Gin.risk_tag(8) and "undercut risk" in Gin.risk_tag(10))
print("ok  " if ok else "FAIL")
sys.exit(0 if ok else 1)
