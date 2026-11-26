"""What comes after an Implement run (games/implement.py): commit and push only that run's changes, and restart the dev server.

The working tree often holds other uncommitted work, sometimes in the same files. So a run records a snapshot (a git tree
of the whole working tree) when it starts and when it ends, and the commit is the difference since the start, applied on
top of HEAD in a temporary index. Working files are never rewritten. docs/implement-process.md describes the whole flow.
"""
import glob
import os
import shutil
import subprocess
import sys
import tempfile
import time

from .base import GameError

BOOT = time.time()   # when this server process loaded the code
DIFF_LIMIT = 100_000


def _git(repo, *args, index=None, data=None, timeout=60, check=True, env=None):
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_LITERAL_PATHSPECS": "1", **(env or {})}
    if index:
        env["GIT_INDEX_FILE"] = index
    try:
        done = subprocess.run(["git", "-c", "core.quotepath=off", *args], cwd=repo, env=env, input=data,
                              capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise GameError(f"git {args[0]} didn't finish: {e}") from e
    if check and done.returncode:
        raise GameError(f"git {args[0]} failed: {done.stderr.decode('utf-8', 'replace').strip()[-600:]}")
    return done


def _line(repo, *args, **kw):
    return _git(repo, *args, **kw).stdout.decode("utf-8", "replace").strip()


def snapshot(repo):
    """A tree of the working tree as it is now (ignored files left out), made without touching the real index."""
    with tempfile.TemporaryDirectory() as tmp:
        index = os.path.join(tmp, "index")
        real = os.path.join(repo, _line(repo, "rev-parse", "--git-path", "index"))
        if os.path.exists(real):   # a copy keeps git's file cache, so unchanged files aren't read again
            shutil.copy2(real, index)
        _git(repo, "add", "-A", index=index)
        return _line(repo, "write-tree", index=index)


def changed(repo, before, after):
    out = _git(repo, "diff", "--name-only", "--no-renames", "-z", before, after).stdout.decode("utf-8", "replace")
    return [name for name in out.split("\0") if name]


def _entry(repo, tree, path):
    """(mode, blob) of a file in a tree, or None."""
    out = _line(repo, "ls-tree", tree, "--", path)
    return (out.split()[0], out.split()[2]) if out else None


def carry_base(repo, tree, old_base, files):
    """`tree`, with `files` put back as they were in `old_base`: running a report again keeps the earlier run's changes."""
    with tempfile.TemporaryDirectory() as tmp:
        index = os.path.join(tmp, "index")
        _git(repo, "read-tree", tree, index=index)
        for path in files:
            old = _entry(repo, old_base, path)
            if old:
                _git(repo, "update-index", "--add", "--cacheinfo", f"{old[0]},{old[1]},{path}", index=index)
            else:
                _git(repo, "update-index", "--force-remove", "--", path, index=index)
        return _line(repo, "write-tree", index=index)


def unpushed(repo):
    """(upstream name or None, the commits a push would send besides the one about to be made)."""
    upstream = _line(repo, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}", check=False)
    if not upstream or upstream.startswith("@"):
        return None, []
    return upstream, _line(repo, "log", "--format=%h %s", "@{u}..HEAD").splitlines()


def plan(repo, job, picked=None):
    """What committing a run's changes would do. Nothing is changed. `token` names exactly this commit."""
    base, ran = job.get("base"), job.get("files") or []
    if not base:
        raise GameError("This run has no starting snapshot, so its changes can't be told apart. Commit them by hand, then resolve only.")
    now = snapshot(repo)
    head = _line(repo, "rev-parse", "HEAD")
    live = set(changed(repo, base, now))
    names = [f for f in ran if f in live]
    use = [f for f in names if picked is None or f in picked]
    files = [{"path": f,
              "earlier": _entry(repo, base, f) != _entry(repo, head, f),   # held uncommitted work before the run
              "later": bool(job.get("end")) and _entry(repo, now, f) != _entry(repo, job["end"], f),
              "picked": f in use} for f in names]
    upstream, ahead = unpushed(repo)
    branch = _line(repo, "symbolic-ref", "--short", "-q", "HEAD", check=False)
    result = {"files": files, "branch": branch, "upstream": upstream, "ahead": ahead, "diff": "", "token": None, "blocked": None}
    if not branch or not upstream:
        result["blocked"] = "The current branch has no upstream to push to."
    elif not use:
        result["blocked"] = "No changes from this run are selected." if names else "This run's changes are no longer in the working tree."
    if result["blocked"]:
        return result
    patch = _git(repo, "diff", "--binary", "--full-index", "--no-renames", base, now, "--", *use).stdout
    with tempfile.TemporaryDirectory() as tmp:
        index = os.path.join(tmp, "index")
        _git(repo, "read-tree", head, index=index)
        applied = _git(repo, "apply", "--cached", "--3way", "--whitespace=nowarn", "-", index=index, data=patch, check=False)
        if applied.returncode:
            result["blocked"] = ("These changes build on work that isn't committed yet, so they can't be committed alone. "
                                 "Commit that work first (or in a terminal, together with this), then review again.\n"
                                 + applied.stderr.decode("utf-8", "replace").strip()[-800:])
            return result
        tree = _line(repo, "write-tree", index=index)
    if tree == _line(repo, "rev-parse", head + "^{tree}"):
        result["blocked"] = "These changes are already committed. Use Resolve only."
        return result
    text = _git(repo, "diff", "--stat", "--patch", head, tree).stdout.decode("utf-8", "replace")
    result["diff"] = text if len(text) <= DIFF_LIMIT else text[:DIFF_LIMIT] + "\n… (cut: see the rest with git diff)"
    result["token"] = f"{head}:{tree}"
    return result


def commit(repo, job, picked, token, message):
    """Make the reviewed commit. Refused if anything changed since the review."""
    now = plan(repo, job, picked)
    if now["blocked"]:
        raise GameError(now["blocked"])
    if now["token"] != token:
        raise GameError("Files or commits changed since you reviewed this. Review it again.")
    head, tree = token.split(":")
    # git has no identity configured on some hosts: carry on with the previous commit's author
    name, email = _line(repo, "log", "-1", "--format=%an%x00%ae").split("\0")
    who = {} if _line(repo, "config", "user.email", check=False) else {
        "GIT_AUTHOR_NAME": name, "GIT_AUTHOR_EMAIL": email, "GIT_COMMITTER_NAME": name, "GIT_COMMITTER_EMAIL": email}
    sha = _line(repo, "commit-tree", tree, "-p", head, "-F", "-", data=message.encode(), env=who)
    _git(repo, "update-ref", "-m", "commit: from the admin page", "HEAD", sha, head)
    _git(repo, "reset", "-q", sha, "--", *[f["path"] for f in now["files"] if f["picked"]])   # the index only
    return sha


def push(repo):
    _git(repo, "push", timeout=90, env={"GIT_SSH_COMMAND": os.environ.get("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")})


def stale_code(repo):
    """Python files saved after this server loaded its code: they take effect at the next restart."""
    paths = glob.glob(os.path.join(repo, "*.py")) + glob.glob(os.path.join(repo, "games", "**", "*.py"), recursive=True)
    return sorted(os.path.relpath(p, repo) for p in paths if os.path.getmtime(p) > BOOT)


def cant_restart(repo):
    """Why the page can't restart this server, or None. Only a server that start.sh started can be restarted by it."""
    try:
        with open(os.path.join(repo, "data", "server.pid")) as f:
            if int(f.read()) == os.getpid():
                return None
    except (OSError, ValueError):
        pass
    return "This server wasn't started by start.sh. Restart it where you started it."


def restart(repo):
    why = cant_restart(repo)
    if why:
        raise GameError(why)
    with tempfile.TemporaryDirectory() as tmp:   # don't take the running server down for code that can't even load
        env = {**os.environ, "ROOMS_FILE": os.path.join(tmp, "rooms"), "FEEDBACK_FILE": os.path.join(tmp, "feedback.jsonl")}
        try:
            check = subprocess.run([sys.executable, "-c", "import server"], cwd=repo, env=env, capture_output=True, timeout=60)
        except subprocess.TimeoutExpired as e:
            raise GameError("Checking the new code took too long. Not restarted.") from e
    if check.returncode:
        raise GameError("Not restarted: the new code doesn't load.\n" + check.stderr.decode("utf-8", "replace").strip()[-800:])
    # its own session, so it outlives the server it stops; the pause lets this request be answered first
    with open(os.path.join(repo, "data", "server.log"), "ab") as log:
        subprocess.Popen(["bash", "-c", "sleep 1; exec bash start.sh restart"], cwd=repo, stdin=subprocess.DEVNULL,
                         stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
