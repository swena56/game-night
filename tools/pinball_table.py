#!/usr/bin/env python3
"""Review and add player-made pinball tables to the curated list (games/pinball_tables/*.json).

  python3 tools/pinball_table.py list                         the curated tables
  python3 tools/pinball_table.py inbox [--inbox FILE]         table suggestions waiting in a feedback inbox
  python3 tools/pinball_table.py check SOURCE                 build it, play it with the test bot, print the verdict
  python3 tools/pinball_table.py add SOURCE --name "Pop Pit" --blurb "one line" [--author NAME] [--force]
  python3 tools/pinball_table.py remove SLUG

SOURCE is a share code (PT1.…), a JSON file (an editor table or a curated file), or "#12" for suggestion 12 in the inbox.
The inbox is data/feedback.jsonl, or the items of a `fetch_feedback.py` export given with --inbox. The full process, and what a
table has to do to be listed, is in docs/pinball-tables.md. A listed table appears in the lobby after the server restarts.
"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from games.base import GameError                                  # noqa: E402
from games.pinball_custom import build, decode_table              # noqa: E402
from games import pinball_tables                                  # noqa: E402
from games.pinball_tables.check import check                      # noqa: E402


def inbox_items(path):
    path = path or os.path.join(ROOT, "data", "feedback.jsonl")
    with open(path, encoding="utf-8") as f:
        text = f.read()
    try:                                                            # a fetch_feedback.py export: {"items": [...]}
        data = json.loads(text)
        items = data.get("items", [data]) if isinstance(data, dict) else data      # a one-entry raw inbox is a bare object
    except json.JSONDecodeError:                                    # the raw inbox: one JSON object per line
        items = [json.loads(line) for line in text.splitlines() if line.strip()]
    return [i for i in items if isinstance(i, dict) and i.get("kind") == "table"]


def resolve(source, inbox=None):
    """Return (spec, suggested name, credit) for a code, file or #id."""
    if source.startswith("#"):
        want = int(source[1:])
        for item in inbox_items(inbox):
            if item.get("id") == want:
                spec = decode_table(item["context"]["pinball_table"])
                return spec, spec.get("name") or "", item.get("name") or ""
        raise SystemExit(f"No table suggestion #{want} in the inbox.")
    if os.path.isfile(source):
        with open(source, encoding="utf-8") as f:
            data = json.load(f)
        if "spec" in data:                                          # a curated file
            return data["spec"], data.get("name", ""), data.get("author", "")
        return data, data.get("name", ""), ""
    spec = decode_table(source.strip())
    return spec, spec.get("name", "") if isinstance(spec, dict) else "", ""


def report(result):
    s = result["stats"]
    if s:
        print(f"  parts {s['parts']} ({s['kinds']} kinds) · test score avg {s['avg_score']:,} (min {s['min_score']:,}) · "
              f"ball lasts avg {s['avg_ball_s']} s (min {s['min_ball_s']} s)")
    for note in result["notes"]:
        print("  note:", note)
    for problem in result["problems"]:
        print("  PROBLEM:", problem)
    print("  verdict:", "PASS (now play it yourself before adding)" if result["ok"] else "FAIL")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    p = sub.add_parser("inbox"); p.add_argument("--inbox")
    for name in ("check", "add"):
        p = sub.add_parser(name); p.add_argument("source"); p.add_argument("--inbox")
    p.add_argument("--name"); p.add_argument("--blurb", default=""); p.add_argument("--author"); p.add_argument("--force", action="store_true")
    p = sub.add_parser("remove"); p.add_argument("slug")
    a = ap.parse_args(argv)

    if a.cmd == "list":
        for table_id, e in pinball_tables.load().items():
            print(f"{table_id:22s} {e['name']:24s} {len(e['spec']['items']):3d} parts  {e['author'] or '-':10s} {e['blurb'][:60]}")
        return 0
    if a.cmd == "inbox":
        for i in inbox_items(a.inbox):
            try:
                n = len(build(decode_table(i["context"]["pinball_table"]))[1]["items"])
            except (GameError, KeyError, TypeError):
                n = "?"
            print(f"#{i.get('id')}  {i.get('status', 'open'):9s} {i.get('text', '')[:60]}  ({n} parts)  by {i.get('name') or '-'}")
        return 0
    if a.cmd == "remove":
        path = os.path.join(pinball_tables.FOLDER, a.slug + ".json")
        if not os.path.isfile(path):
            raise SystemExit(f"No curated table '{a.slug}'.")
        os.remove(path)
        print(f"Removed {a.slug}. Restart the server to take it out of the lobby.")
        return 0

    try:
        spec, suggested, credit = resolve(a.source, a.inbox)
    except (GameError, OSError, ValueError, KeyError) as e:
        raise SystemExit(f"Can't read that table: {e}")
    print(f"Checking {a.source[:40]}{'…' if len(a.source) > 40 else ''} ({suggested or 'unnamed'})")
    result = check(spec)
    report(result)
    if a.cmd == "check":
        return 0 if result["ok"] else 1
    name = " ".join((a.name or suggested or "").split())[:24]
    if len(name) < 3:
        raise SystemExit("Give it a name of 3 to 24 characters with --name.")
    if not result["ok"] and not a.force:
        raise SystemExit("It failed the checks. Fix the table, or add it anyway with --force.")
    slug = pinball_tables.slugify(name)
    if not pinball_tables.SLUG.match(slug):
        raise SystemExit(f"'{name}' doesn't make a usable file name.")
    path = os.path.join(pinball_tables.FOLDER, slug + ".json")
    if os.path.exists(path):
        raise SystemExit(f"A curated table called '{slug}' already exists; pick another name or remove it first.")
    entry = {"name": name, "blurb": " ".join(a.blurb.split())[:160], "author": " ".join((a.author or credit or "").split())[:16],
             "spec": {**build(spec)[1], "name": name}}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(entry, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"Added games/pinball_tables/{slug}.json. Play it, then commit it and restart the server: it will show as t_{slug} in the lobby.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
