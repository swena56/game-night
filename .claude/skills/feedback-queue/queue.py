#!/usr/bin/env python3
"""Feedback change queue for the feedback-queue skill.

Watches the local inbox (data/feedback.jsonl + data/feedback-status.json), turns changes into a work queue ordered by
priority then arrival, remembers which files each item's work touched, and stages exactly that work once the report is
accepted (marked done). State lives in .claude/feedback-queue/ (git-ignored).

  queue.py poll                 diff the inbox against the last look; queue changes; print what happened
  queue.py watch [SECS]         poll every SECS (default 20) until there is work or an accepted item; then print + exit
  queue.py list                 queue in work order, items waiting for the user, items accepted
  queue.py next                 the item to work on now (JSON), or nothing
  queue.py start ID             snapshot the working tree before working on ID
  queue.py finish ID            record ID's files + patch, take it off the queue, put it on the user's check list
  queue.py drop ID [REASON]     take ID off the queue without work (duplicate, can't act, already done)
  queue.py stage ID             stage ID's recorded work in the git index (prints what it staged / couldn't)
  queue.py committed ID SHA     record ID as committed
"""
import hashlib, json, os, subprocess, sys, time, urllib.request

ROOT = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True,
                      cwd=os.path.dirname(os.path.abspath(__file__))).stdout.strip()
DATA = os.path.join(ROOT, "data")
FEEDBACK = os.path.join(DATA, "feedback.jsonl")
STATUS = os.path.join(DATA, "feedback-status.json")
STATE_DIR = os.path.join(ROOT, ".claude", "feedback-queue")
STATE = os.path.join(STATE_DIR, "state.json")
PRIO = {"high": 0, "": 1, "low": 2}
API = os.environ.get("FQ_API", "http://localhost:8000/api/admin/feedback/update")
SKIP = (os.path.join(".claude", "feedback-queue"),)   # our own files never count as an item's work


def load_state():
    try:
        with open(STATE, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def save_state(s):
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = STATE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(s, f, indent=1, ensure_ascii=False)
    os.replace(tmp, STATE)


def reports():
    try:
        with open(STATUS, encoding="utf-8") as f:
            status = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        status = {}
    out = {}
    try:
        with open(FEEDBACK, encoding="utf-8") as f:
            for line in f:
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                out[str(e["id"])] = {"kind": e.get("kind"), "text": e.get("text", ""), "note": e.get("note", ""),
                                     "priority": e.get("priority", ""), "verify": bool(e.get("verify")),
                                     "images": len(e.get("images", [])), "touched": e.get("touched_at"), "game": (e.get("context") or {}).get("game"),
                                     "status": status.get(str(e["id"]), "open")}
    except FileNotFoundError:
        pass
    return out


def fresh_state(now):
    return {"snapshot": now, "seq": 0, "queue": {}, "ledger": {}, "log": []}


def diff(old, new):
    """[(id, event)] for the changes that mean work, and the ones that mean accepted."""
    ev = []
    for i, r in new.items():
        o = old.get(i)
        if r["kind"] == "table":   # pinball table suggestions follow docs/pinball-tables.md, not this queue
            continue
        if o is None:
            if r["status"] == "open":
                ev.append((i, "new"))
            continue
        if r["status"] == "done":
            if o["status"] != "done":
                ev.append((i, "accepted"))
            continue
        if o["status"] == "done":
            ev.append((i, "reopened"))
        elif r["text"] != o["text"]:
            ev.append((i, "reworded"))
        elif o["verify"] and not r["verify"]:
            ev.append((i, "sent back"))
        if r["note"] != o["note"] and r["note"]:
            ev.append((i, "note"))
        if r["images"] > o["images"]:
            ev.append((i, "screenshot"))
        if r.get("touched") and r.get("touched") != o.get("touched"):   # 🔄 Refresh on the admin page: work on it again
            ev.append((i, "refreshed"))
    return ev


def poll(s=None, quiet=False):
    now = reports()
    first = s is None
    s = s or fresh_state(now)
    if first:   # first look: the backlog is the baseline, only later changes are work
        save_state(s)
        if not quiet:
            print(f"baseline taken: {len(now)} reports; changes from now on are queued")
        return s, []
    events = diff(s["snapshot"], now)
    t = time.strftime("%Y-%m-%d %H:%M:%S")
    for i, what in events:
        if what == "accepted":
            q = s["queue"].pop(i, None)
            led = s["ledger"].get(i)
            if led and not led.get("commit"):
                led["accepted"] = t
            elif q:
                s["log"].append([t, i, "done before work started; dropped from queue"])
            continue
        q = s["queue"].get(i)
        if q:
            if what not in q["events"]:
                q["events"].append(what)
        else:
            s["seq"] += 1
            s["queue"][i] = {"seq": s["seq"], "events": [what], "queued": t}
        led = s["ledger"].get(i)
        if led:
            led.pop("accepted", None)   # reopened or sent back before the commit: not accepted any more
        if led and led.get("commit"):   # committed earlier, now sent back: a new round of work, a new commit
            s["ledger"][i] = {"rounds": [], "prev_commits": led.get("prev_commits", []) + [led["commit"]]}
    for i, what in events:
        s["log"].append([t, i, what])
    s["log"] = s["log"][-300:]
    s["snapshot"] = now
    save_state(s)
    if events and not quiet:
        for i, what in events:
            r = now[i]
            print(f"#{i} {what} [{r['priority'] or 'normal'}] {r['game'] or '-'}: {r['text'][:100]!r}")
    return s, events


def ignored(i, now):
    """A report marked priority "none" isn't worked: its events stay queued but out of order() until it's raised."""
    return now.get(i, {}).get("priority") == "none"


def order(s, now):
    items = [kv for kv in s["queue"].items() if not ignored(kv[0], now)]
    return sorted(items, key=lambda kv: (PRIO.get(now.get(kv[0], {}).get("priority", ""), 1), kv[1]["seq"]))


def accepted(s):
    return [i for i, led in s["ledger"].items() if led.get("accepted") and not led.get("commit")]


def git(*args, check=True, **kw):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=check, **kw)


def dirty_files():
    out = git("status", "--porcelain", "-z", "--untracked-files=all").stdout.split("\0")
    files, skip = [], False
    for entry in out:
        if skip:
            skip = False
            continue
        if not entry:
            continue
        code, path = entry[:2], entry[3:]
        if code[0] in "RC":
            skip = True
        if not path.startswith(SKIP):
            files.append(path)
    return files


def digest(path):
    try:
        with open(os.path.join(ROOT, path), "rb") as f:
            return hashlib.sha1(f.read()).hexdigest()
    except FileNotFoundError:
        return None


def start(s, i):
    s, _ = poll(s, quiet=True)
    base = os.path.join(STATE_DIR, "base", i)
    subprocess.run(["rm", "-rf", base])
    os.makedirs(base)
    files = {}
    for p in dirty_files():   # the content of every dirty file now, so finish can tell this item's edits apart
        files[p] = digest(p)
        if files[p]:
            dst = os.path.join(base, p)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            subprocess.run(["cp", "-p", os.path.join(ROOT, p), dst])
    led = s["ledger"].setdefault(i, {"rounds": []})
    led["working"] = {"started": time.strftime("%Y-%m-%d %H:%M:%S"), "head": git("rev-parse", "HEAD").stdout.strip(),
                      "dirty": files}
    save_state(s)
    print(f"#{i}: started; {len(files)} files already dirty are the baseline")


def base_content(i, path, dirty, head):
    """What PATH held when work on I started."""
    if path in dirty:
        if dirty[path] is None:
            return None
        with open(os.path.join(STATE_DIR, "base", i, path), "rb") as f:
            return f.read()
    r = subprocess.run(["git", "show", f"{head}:{path}"], cwd=ROOT, capture_output=True)
    return r.stdout if r.returncode == 0 else None


def finish(s, i, mark=True):
    led = s["ledger"].get(i, {})
    w = led.get("working")
    if not w:
        sys.exit(f"#{i} was not started")
    changed = []
    for p in sorted(set(dirty_files()) | set(w["dirty"])):
        if p in w["dirty"]:
            if digest(p) != w["dirty"][p]:
                changed.append(p)
        else:
            changed.append(p)   # clean (or absent) at start, dirty now
    rd = os.path.join(STATE_DIR, "patches")
    os.makedirs(rd, exist_ok=True)
    n = len(led["rounds"]) + 1
    patch_path = os.path.join(rd, f"{i}-{n}.patch")
    patch = b""
    tmp = os.path.join(STATE_DIR, "tmp")
    for p in changed:   # a/<p> = content at start, b/<p> = now; diffed with --no-prefix gives a normal git patch
        subprocess.run(["rm", "-rf", tmp])
        old = base_content(i, p, w["dirty"], w["head"])
        cur = os.path.join(ROOT, p)
        for side, content in (("a", old), ("b", open(cur, "rb").read() if os.path.exists(cur) else None)):
            if content is not None:
                os.makedirs(os.path.dirname(os.path.join(tmp, side, p)), exist_ok=True)
                with open(os.path.join(tmp, side, p), "wb") as f:
                    f.write(content)
        r = subprocess.run(["git", "diff", "--no-index", "--no-prefix", "--binary", "--",
                            f"a/{p}" if old is not None else "/dev/null",
                            f"b/{p}" if os.path.exists(cur) else "/dev/null"], cwd=tmp, capture_output=True)
        patch += r.stdout
    subprocess.run(["rm", "-rf", tmp])
    with open(patch_path, "wb") as f:
        f.write(patch)
    led["rounds"].append({"started": w["started"], "finished": time.strftime("%Y-%m-%d %H:%M:%S"), "files": changed,
                          "clean_at_start": [p for p in changed if p not in w["dirty"]], "patch": patch_path})
    led.pop("working")
    s["queue"].pop(i, None)
    s["log"].append([time.strftime("%Y-%m-%d %H:%M:%S"), i, f"finished: {len(changed)} files"])
    if mark:
        flag(i, True)
    s, _ = poll(s, quiet=True)   # swallow our own verify flip so it isn't read as the user's
    save_state(s)
    print(f"#{i}: finished; files: {', '.join(changed) or '(none)'}; patch {os.path.relpath(patch_path, ROOT)}")


def flag(i, verify):
    req = urllib.request.Request(API, data=json.dumps({"ids": [int(i)], "verify": verify}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=10).read()
        print(f"#{i}: {'on' if verify else 'off'} the 👀 Needs my check list")
    except Exception as e:   # server down mid-restart: say so, the item is still finished
        print(f"#{i}: could not set the check flag ({e}); set it in the admin page")


def stage(s, i):
    led = s["ledger"].get(i)
    if not led or not led["rounds"]:
        sys.exit(f"#{i} has no recorded work")
    others = {p for j, l in s["ledger"].items() if j != i and not l.get("commit")
              for r in l["rounds"] for p in r["files"]}
    files = {p for r in led["rounds"] for p in r["files"]}
    first_clean = set(led["rounds"][0]["clean_at_start"])
    whole = [p for p in sorted(files) if p in first_clean and p not in others and
             all(p in r["clean_at_start"] or p in first_clean for r in led["rounds"])]
    staged, mixed = [], []
    for p in whole:
        git("add", "-A", "--", p)
        staged.append(p)
    rest = sorted(files - set(whole))
    for p in rest:   # shared with other uncommitted work: apply only this item's hunks, round by round
        ok = True
        for r in led["rounds"]:
            if p not in r["files"]:
                continue
            res = git("apply", "--cached", "--3way", "--include", p, r["patch"], check=False)
            if res.returncode:
                ok = False
                break
        (staged if ok else mixed).append(p)
    print(json.dumps({"staged_whole": whole, "staged_hunks": [p for p in staged if p not in whole], "mixed": mixed},
                     indent=1))
    if mixed:
        print("mixed: these files hold other uncommitted work this item's patch could not be separated from; "
              "stage them by hand (see the patch files) or leave them out")


def main():
    cmd, args = (sys.argv[1] if len(sys.argv) > 1 else "list"), sys.argv[2:]
    s = load_state()
    if cmd == "poll":
        poll(s)
    elif cmd == "watch":
        every = float(args[0]) if args else 20
        s, _ = poll(s)
        while True:
            now = reports()
            if order(s, now) or accepted(s):
                for i, q in order(s, now):
                    print(f"queued #{i} ({', '.join(q['events'])})")
                for i in accepted(s):
                    print(f"accepted #{i}: commit its work")
                return
            time.sleep(every)
            s, _ = poll(load_state())
    elif cmd in ("list", "next"):
        s, _ = poll(s, quiet=True)
        now = reports()
        items = order(s, now)
        if cmd == "next":
            if items:
                i, q = items[0]
                print(json.dumps({"id": int(i), **q, **now.get(i, {})}, ensure_ascii=False, indent=1))
            return
        for i, q in items:
            r = now.get(i, {})
            print(f"queue  #{i} [{r.get('priority') or 'normal'}] {', '.join(q['events'])}: {r.get('text', '')[:80]!r}")
        for i, q in s["queue"].items():
            if ignored(i, now):
                print(f"ignored #{i} [none] {', '.join(q['events'])}: {now[i].get('text', '')[:80]!r}")
        for i, led in s["ledger"].items():
            if led.get("working"):
                print(f"working #{i} since {led['working']['started']}")
            elif led.get("commit"):
                continue
            elif led.get("accepted"):
                print(f"accepted #{i} at {led['accepted']}: commit it")
            elif led["rounds"]:
                print(f"waiting #{i}: on the user's check list ({len(led['rounds'])} round(s))")
    elif cmd == "start":
        start(s, args[0])
    elif cmd == "finish":
        finish(s, args[0])
    elif cmd == "drop":
        s, _ = poll(s, quiet=True)
        s["queue"].pop(args[0], None)
        s["log"].append([time.strftime("%Y-%m-%d %H:%M:%S"), args[0], "dropped: " + " ".join(args[1:])])
        save_state(s)
        print(f"#{args[0]} dropped")
    elif cmd == "stage":
        stage(s, args[0])
    elif cmd == "committed":
        led = s["ledger"][args[0]]
        led["commit"] = args[1]
        save_state(s)
        print(f"#{args[0]} recorded as {args[1]}")
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
