"""The password for the feedback admin tool when it is opened from another device (feedback #271). Not a game.

Run `python3 -m games.admin_auth` to set or change it, with `--remove` to switch remote access off again.
The server notices at once; no restart is needed. Opening the admin tool on the server's own device never asks
for a password.

`--network-tools on` also lets a signed-in device on your own network use Implement, review/push and restart on a
development server (`off` switches it back). Those run code on this machine. A container (production) ignores it.
"""
import getpass
import hashlib
import hmac
import json
import os
import secrets
import sys
import threading
import time

PASSWORD_FILE = os.environ.get("ADMIN_PASSWORD_FILE") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "admin-password.json")
# its presence is the opt-in; data/ is never part of the Docker image
NETWORK_FILE = os.environ.get("ADMIN_NETWORK_FILE") or os.path.join(os.path.dirname(PASSWORD_FILE), "admin-network-tools")
MIN_LENGTH, MAX_LENGTH = 10, 200
SESSION_SECONDS = 12 * 3600
MAX_SESSIONS = 32
_SCRYPT = {"n": 2 ** 14, "r": 8, "p": 1}
SESSIONS_FILE = os.path.join(os.path.dirname(PASSWORD_FILE), "admin-sessions.json")
_lock = threading.Lock()


def _key(token):
    """Sessions are kept by a hash of their token, so the file on disk holds nothing that signs in."""
    return hashlib.sha256(str(token).encode("utf-8", "surrogatepass")).hexdigest()


def _read_sessions():
    try:
        with open(SESSIONS_FILE, encoding="utf-8") as f:
            data = json.load(f)
        return {k: (float(v[0]), str(v[1])) for k, v in data.items() if isinstance(v, list) and len(v) == 2}
    except (OSError, ValueError, TypeError, IndexError, KeyError):
        return {}


def _write_sessions(sessions):
    """Call with _lock held."""
    os.makedirs(os.path.dirname(SESSIONS_FILE), exist_ok=True)
    tmp = SESSIONS_FILE + ".tmp"
    with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as f:
        json.dump({k: [expires, digest] for k, (expires, digest) in sessions.items()}, f)
    os.replace(tmp, SESSIONS_FILE)


# token hash -> (expires, the password hash it was opened with); kept on disk, so a restart keeps a session
_sessions = {}
with _lock:
    _sessions = _read_sessions()


def _hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=salt, dklen=32, **_SCRYPT)


def set_password(password):
    if not MIN_LENGTH <= len(password) <= MAX_LENGTH:
        raise ValueError(f"Use {MIN_LENGTH} to {MAX_LENGTH} characters.")
    salt = secrets.token_bytes(16)
    os.makedirs(os.path.dirname(PASSWORD_FILE), exist_ok=True)
    tmp = PASSWORD_FILE + ".tmp"
    with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as f:
        json.dump({"salt": salt.hex(), "hash": _hash(password, salt).hex()}, f)
    os.replace(tmp, PASSWORD_FILE)


def network_tools():
    return os.path.isfile(NETWORK_FILE)


def set_network_tools(on):
    if on:
        os.makedirs(os.path.dirname(NETWORK_FILE), exist_ok=True)
        with open(NETWORK_FILE, "w", encoding="utf-8") as f:
            f.write("Developer tools are open to signed-in devices on this network. Delete this file to switch that off.\n")
    else:
        try:
            os.remove(NETWORK_FILE)
        except FileNotFoundError:
            pass


def stored():
    """(salt, hash), or None when no password has been set or the file can't be used."""
    try:
        with open(PASSWORD_FILE, encoding="utf-8") as f:
            data = json.load(f)
        salt, digest = bytes.fromhex(data["salt"]), bytes.fromhex(data["hash"])
    except (OSError, ValueError, KeyError, TypeError):
        return None
    return (salt, digest) if salt and digest else None


def login(password):
    """A new session token for the right password, otherwise None."""
    saved = stored()
    if not saved or not isinstance(password, str) or len(password) > MAX_LENGTH:
        return None
    # surrogatepass: JSON can carry a lone surrogate, which must just be a wrong password
    guess = hashlib.scrypt(password.encode("utf-8", "surrogatepass"), salt=saved[0], dklen=32, **_SCRYPT)
    if not hmac.compare_digest(guess, saved[1]):
        return None
    token, now = secrets.token_urlsafe(32), time.time()
    with _lock:
        for old in [t for t, (expires, _) in _sessions.items() if expires <= now]:
            del _sessions[old]
        while len(_sessions) >= MAX_SESSIONS:
            del _sessions[next(iter(_sessions))]
        _sessions[_key(token)] = (now + SESSION_SECONDS, saved[1].hex())
        _write_sessions(_sessions)
    return token


def valid(token):
    """A session ends after SESSION_SECONDS, at logout, or when the password is changed or removed. It survives a restart."""
    saved = stored()
    with _lock:
        session = _sessions.get(_key(token))
    return bool(saved and session and session[0] > time.time() and session[1] == saved[1].hex())


def logout(token):
    with _lock:
        if _sessions.pop(_key(token), None) is not None:
            _write_sessions(_sessions)


def main(argv):
    if argv == ["--remove"]:
        try:
            os.remove(PASSWORD_FILE)
            print("Password removed: the admin tool now opens only on the server's own device.")
        except FileNotFoundError:
            print("No password was set.")
        return 0
    if argv in (["--network-tools", "on"], ["--network-tools", "off"]):
        set_network_tools(argv[1] == "on")
        print(f"Developer tools over the network: {argv[1]}.")
        if argv[1] == "on" and not stored():
            print("They stay closed until you set an admin password: python3 -m games.admin_auth")
        return 0
    if argv:
        print(__doc__)
        return 0 if argv in (["-h"], ["--help"]) else 2
    try:
        if sys.stdin.isatty():
            password = getpass.getpass("New admin password: ")
            if getpass.getpass("Again: ") != password:
                print("The two didn't match. Nothing changed.")
                return 1
        else:   # piped in, for scripts
            password = sys.stdin.readline().rstrip("\n")
        set_password(password)
    except (ValueError, OSError) as e:
        print(f"{e} Nothing changed.")
        return 1
    except (KeyboardInterrupt, EOFError):
        print("\nNothing changed.")
        return 1
    print("Password saved. Remote admin is at /admin.html on your server (HTTPS only).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
