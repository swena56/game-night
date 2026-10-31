"""Layout lint for static/style.css, for mistakes the jsdom test can't see (it does no layout).

Flags a percentage padding in a rule that also gives the element a fixed width: CSS measures
percentage padding against the *parent's* width, so on a small element (a die, a tile) it can eat
the whole content box. That hid every pip on the Yacht and Farkle dice (#44).
Usage: python3 tests/csscheck.py [static/style.css]"""
import re
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "static/style.css"
css = re.sub(r"/\*.*?\*/", "", open(path, encoding="utf-8").read(), flags=re.S)
problems = 0
for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
    selector, body = m.group(1).strip(), m.group(2)
    padding = re.search(r"(?<![-\w])padding(?:-\w+)?\s*:\s*([^;]*\d%[^;]*)", body)
    width = re.search(r"(?<![-\w])width\s*:\s*([^;]+)", body)
    if padding and width and "100%" not in width.group(1):
        line = css.count("\n", 0, m.start()) + 1
        print(f"{path}:{line}: {selector}: padding {padding.group(1).strip()} with a fixed width "
              f"({width.group(1).strip()}); a % padding is measured against the parent's width")
        problems += 1
print("ok" if not problems else f"{problems} problem(s)")
sys.exit(1 if problems else 0)
