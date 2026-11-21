#!/usr/bin/env python3
"""Start, connect to, deploy Game Night to, stop, or remove a DigitalOcean Droplet."""

import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


API = "https://api.digitalocean.com/v2"
APP_FILES = (".dockerignore", "Dockerfile", "compose.yaml", "compose.droplet.yaml",
             "Caddyfile", "server.py",
             "games", "static", "data/words.txt")
DEPLOY_SCRIPT = """set -eu
export DEBIAN_FRONTEND=noninteractive
umask 077
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
tar -xzf - -C "$stage"
cd "$stage"

if command -v cloud-init >/dev/null; then
    cloud-init status --wait
fi
exec 9>/run/lock/game-night-deploy.lock
flock 9
if ! docker compose version >/dev/null 2>&1; then
    apt-get -o DPkg::Lock::Timeout=120 update
    apt-get -o DPkg::Lock::Timeout=120 install -y docker.io docker-compose-v2
fi
systemctl enable --now docker
export PORT=8000
export GAME_NIGHT_ADDRESS="$1"
compose() {
    docker compose -p game-night -f compose.yaml -f compose.droplet.yaml "$@"
}
compose build
compose run --rm -T --no-deps game-night sh -ec \
    'cat > /app/data/.words.txt.tmp && mv /app/data/.words.txt.tmp /app/data/words.txt' \
    < data/words.txt
compose up -d
for attempt in $(seq 1 15); do
    if compose exec -T game-night python -c \
        'from urllib.request import urlopen; urlopen("http://127.0.0.1:8000/api/health", timeout=3).close()' \
        >/dev/null 2>&1; then
        exit 0
    fi
    sleep 2
done
compose logs --tail 40
exit 1
"""


class DropletError(Exception):
    pass


class DigitalOcean:
    def __init__(self, token):
        self.token = token

    def request(self, path, payload=None, *, method=None):
        data = None if payload is None else json.dumps(payload).encode()
        request = Request(API + path, data=data, method=method, headers={
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        })
        try:
            with urlopen(request, timeout=20) as response:
                if response.status == 204:
                    return None
                return json.load(response)
        except HTTPError as error:
            try:
                message = json.load(error).get("message", error.reason)
            except ValueError:
                message = error.reason
            raise DropletError(f"DigitalOcean returned HTTP {error.code}: {message}") from None
        except (OSError, ValueError) as error:
            raise DropletError(f"Could not get a usable API response: {error}") from None

    def items(self, path, key):
        for page in range(1, 10000):
            query = urlencode({"page": page, "per_page": 200})
            response = self.request(f"{path}?{query}")
            yield from response[key]
            if not response.get("links", {}).get("pages", {}).get("next"):
                return
        raise DropletError(f"Too many pages from {path}.")


def choose_key(api):
    keys = list(api.items("/account/keys", "ssh_keys"))
    if not keys:
        raise DropletError(
            "Add your SSH public key in DigitalOcean → Settings → Security, then rerun."
        )
    print("Choose an SSH key whose private key you have on this device:")
    for number, key in enumerate(keys, 1):
        print(f"  {number}. {key['name']} ({key['fingerprint']})")
    while True:
        choice = input("Key number (Enter to cancel): ").strip()
        if not choice:
            return None
        if choice.isascii() and choice.isdecimal() and len(choice) <= len(str(len(keys))):
            number = int(choice)
            if 1 <= number <= len(keys):
                return keys[number - 1]["id"]
        print(f"Enter a number from 1 to {len(keys)}.")


def find_droplet(api, name):
    matches = [item for item in api.items("/droplets", "droplets")
               if item["name"].casefold() == name.casefold()]
    if len(matches) > 1:
        ids = ", ".join(str(item["id"]) for item in matches)
        raise DropletError(f"Multiple Droplets are named {name} (IDs: {ids}). "
                           "Run the command with the ID you want.")
    return matches[0] if matches else None


def create_droplet(api, args):
    existing = find_droplet(api, args.name)
    if existing:
        droplet_id = existing["id"]
        raise DropletError(
            f"A Droplet named {args.name} already exists (ID: {droplet_id}). "
            f"Use 'python3 droplet.py start {droplet_id}' to deploy to it."
        )
    key_id = choose_key(api)
    if key_id is None:
        return None
    print(f"New Droplet: {args.name} / {args.region} / {args.size} / {args.image}")
    print("DigitalOcean bills for this Droplet until you destroy it.")
    if input("Type CREATE to continue: ").strip() != "CREATE":
        return None
    try:
        result = api.request("/droplets", {
            "name": args.name,
            "region": args.region,
            "size": args.size,
            "image": args.image,
            "ssh_keys": [key_id],
        })
        return result["droplet"]["id"]
    except (DropletError, KeyboardInterrupt, KeyError):
        print(f"Check the DigitalOcean dashboard for {args.name} before retrying.",
              file=sys.stderr)
        raise


def power_on(api, droplet_id):
    path = f"/droplets/{droplet_id}"
    droplet = api.request(path)["droplet"]
    if droplet["status"] == "off":
        print(f"Powering on {droplet['name']} (ID {droplet_id})...")
        return api.request(path + "/actions", {"type": "power_on"})["action"]["id"]
    if droplet["status"] not in ("new", "active"):
        raise DropletError(f"Droplet {droplet_id} has status {droplet['status']!r}.")
    return None


def wait_for_droplet(api, droplet_id, action_id, *, stopping=False):
    expected = "off" if stopping else "active with a public IPv4 address"
    print(f"Waiting for Droplet {droplet_id} to be {expected}...", flush=True)
    deadline = time.monotonic() + 300
    path = f"/droplets/{droplet_id}"
    while time.monotonic() < deadline:
        if action_id is not None:
            action = api.request(f"{path}/actions/{action_id}")["action"]
            if action["status"] == "errored":
                raise DropletError(f"DigitalOcean action {action_id} failed for Droplet {droplet_id}.")
        droplet = api.request(path)["droplet"]
        if stopping and droplet["status"] == "off":
            return
        if not stopping and droplet["status"] == "active":
            for network in droplet.get("networks", {}).get("v4", []):
                if network["type"] == "public":
                    return str(ipaddress.IPv4Address(network["ip_address"]))
        time.sleep(5)
    raise DropletError(f"Droplet {droplet_id} did not become {expected} after five minutes. "
                       "Check its status in the DigitalOcean dashboard.")


def stop_droplet(api, droplet_id):
    path = f"/droplets/{droplet_id}"
    droplet = api.request(path)["droplet"]
    if droplet["status"] != "off":
        action = api.request(path + "/actions", {"type": "shutdown"})["action"]
        wait_for_droplet(api, droplet_id, action["id"], stopping=True)
    print(f"Droplet {droplet_id} is off. DigitalOcean still bills for it.")


def remove_droplet(api, droplet_id):
    path = f"/droplets/{droplet_id}"
    droplet = api.request(path)["droplet"]
    print(f"Deleting {droplet['name']} ({droplet_id}) permanently erases its disk and Game Night saves.")
    if input(f"Type {droplet_id} to confirm deletion: ").strip() != str(droplet_id):
        print("Canceled.")
        return
    api.request(path, method="DELETE")
    print(f"DigitalOcean accepted deletion of Droplet {droplet_id}.")


def ssh_command(ssh_key):
    ssh = ["ssh", "-o", "ConnectTimeout=5",
           "-o", "StrictHostKeyChecking=accept-new", "-o", "ServerAliveInterval=15",
           "-o", "ServerAliveCountMax=3"]
    if ssh_key:
        ssh.extend(["-i", str(ssh_key), "-o", "IdentitiesOnly=yes"])
    return ssh


def ssh_environment():
    ssh_env = os.environ.copy()
    ssh_env.pop("DIGITALOCEAN_TOKEN", None)
    ssh_env.pop("DUCKDNS_TOKEN", None)
    return ssh_env


def wait_for_ssh(droplet_id, address, ssh, ssh_env, *, interactive=False):
    print(f"Waiting for SSH on Droplet {droplet_id} ({address})...", flush=True)
    deadline = time.monotonic() + 180
    while True:
        try:
            probe = subprocess.run(ssh + ["-T", "-o", "BatchMode=yes", f"root@{address}", "true"],
                                   stdin=subprocess.DEVNULL,
                                   capture_output=True, text=True, timeout=10, env=ssh_env)
        except subprocess.TimeoutExpired:
            probe = None
        if probe is not None and probe.returncode == 0:
            return
        error = probe.stderr.strip() if probe is not None else "SSH timed out."
        if interactive and "Permission denied" in error:
            # The server is reachable. Let OpenSSH prompt for authentication.
            return
        if ("Permission denied" in error or "Host key verification failed" in error
                or time.monotonic() >= deadline):
            raise DropletError(f"SSH to {address} failed. {error} "
                               "Check the SSH key, known_hosts, and inbound TCP port 22.")
        time.sleep(5)


def update_duckdns(name, address, token):
    query = urlencode({"domains": name, "ip": address, "token": token})
    try:
        with urlopen(f"https://www.duckdns.org/update?{query}", timeout=20) as response:
            success = response.read(16).strip() == b"OK"
    except OSError:
        raise DropletError("Could not reach the Duck DNS update endpoint.") from None
    if not success:
        raise DropletError("Duck DNS rejected the update. Check the hostname and DUCKDNS_TOKEN.")
    return f"{name}.duckdns.org"


def deploy_app(droplet_id, address, hostname, ssh, ssh_env):
    print(f"Deploying Game Night to {address}...", flush=True)
    repo = Path(__file__).resolve().parent
    with tempfile.TemporaryFile() as bundle:
        with tarfile.open(fileobj=bundle, mode="w:gz") as archive:
            for filename in APP_FILES:
                archive.add(repo / filename, arcname=filename, filter=app_member)
        bundle.seek(0)
        try:
            subprocess.run(ssh + ["-T", "-o", "BatchMode=yes", f"root@{address}",
                                  shlex.join(["sh", "-c", DEPLOY_SCRIPT, "deploy", hostname])], stdin=bundle,
                           check=True, timeout=1200, env=ssh_env)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            raise DropletError(f"Deployment failed on Droplet {droplet_id}: {error.__class__.__name__}. "
                               f"After checking SSH output, retry with 'python3 droplet.py start {droplet_id} --deploy'.") from None
    print("Game Night passed its server health check. Waiting for public HTTPS...", flush=True)
    url = f"https://{hostname}/"
    deadline = time.monotonic() + 180
    while True:
        try:
            with urlopen(url, timeout=5) as response:
                if response.status == 200 and response.geturl() == url:
                    break
                error = f"Unexpected HTTPS response: HTTP {response.status} at {response.geturl()}"
        except (OSError, ValueError) as failure:
            error = str(failure)
        if time.monotonic() >= deadline:
            raise DropletError(f"Could not verify {url}: {error}. "
                               "Check that TCP ports 80 and 443 are publicly reachable "
                               "and inspect Caddy's Docker logs.")
        time.sleep(3)
    print(f"Game Night is live with verified HTTPS. Open {url}")


def app_member(member):
    if "__pycache__" in Path(member.name).parts or member.name.endswith((".pyc", ".pyo")):
        return None
    return member if member.isfile() or member.isdir() else None


def add_start_options(parser, *, defaults=None):
    parser.add_argument("--wait", action="store_true", default=defaults,
                        help="wait for the Droplet to start and print its public IPv4 address")
    parser.add_argument("--ssh", action="store_true", default=defaults,
                        help="open an interactive root SSH session when the Droplet is ready")
    parser.add_argument("--deploy", action="store_true", default=defaults,
                        help="deploy Game Night and wait for its health check")
    parser.add_argument("--duckdns", default=defaults, metavar="NAME",
                        help="update a claimed Duck DNS name and deploy HTTPS for it")


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        epilog="Run without arguments to deploy to game-night or create it if missing. "
               "Set DIGITALOCEAN_TOKEN in the environment first.")
    lifecycle = parser.add_mutually_exclusive_group()
    lifecycle.add_argument("--stop", nargs="?", type=int, default=argparse.SUPPRESS,
                           metavar="ID", help="shut down the named Droplet or an explicit ID")
    lifecycle.add_argument("--remove", nargs="?", type=int, default=argparse.SUPPRESS,
                           metavar="ID", help="delete the named Droplet or an explicit ID")
    parser.add_argument("--name", default="game-night", help="Droplet name (default: game-night)")
    parser.add_argument("--ssh-key", type=Path, help="path to an SSH private key")
    add_start_options(parser)
    parser.set_defaults(region="nyc3", size="s-1vcpu-1gb", image="ubuntu-24-04-x64")
    commands = parser.add_subparsers(dest="command")
    create = commands.add_parser("create", help="create a new billable Droplet")
    create.add_argument("--region", default=argparse.SUPPRESS)
    create.add_argument("--size", default=argparse.SUPPRESS)
    create.add_argument("--image", default=argparse.SUPPRESS)
    start = commands.add_parser("start", help="power on if needed and deploy to an existing Droplet")
    start.add_argument("id", nargs="?", type=int, help="optional numeric Droplet ID")
    for command in (create, start):
        add_start_options(command, defaults=argparse.SUPPRESS)
        command.add_argument("--name", default=argparse.SUPPRESS, help="Droplet name")
        command.add_argument("--ssh-key", type=Path, default=argparse.SUPPRESS,
                             help="path to an SSH private key")
    args = parser.parse_args()
    operation = next((flag for flag in ("stop", "remove") if hasattr(args, flag)), args.command)
    if operation in ("stop", "remove") and (args.command or args.wait or args.ssh or args.deploy or args.duckdns):
        parser.error("Use --stop or --remove without a startup option or subcommand.")
    deploy = args.deploy or args.duckdns is not None or not (args.wait or args.ssh)
    duckdns_name = None
    if args.duckdns is not None:
        duckdns_name = args.duckdns.lower().removesuffix(".duckdns.org")
        if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", duckdns_name):
            parser.error("Use a Duck DNS name such as your-game-night or your-game-night.duckdns.org.")
    droplet_id = getattr(args, operation if operation in ("stop", "remove") else "id", None)
    if droplet_id is not None and droplet_id <= 0:
        parser.error("Droplet ID must be a positive integer.")
    if droplet_id is None and not re.fullmatch(
            r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?", args.name):
        parser.error("Use 1–63 letters, numbers or hyphens. Start and end with a letter or number.")

    token = os.environ.get("DIGITALOCEAN_TOKEN", "").strip()
    try:
        duckdns_token = os.environ.get("DUCKDNS_TOKEN", "").strip()
        if duckdns_name and not duckdns_token:
            raise DropletError("Set DUCKDNS_TOKEN in your environment before using --duckdns.")
        if not token:
            raise DropletError("Set the DIGITALOCEAN_TOKEN environment variable.")
        if not token.isascii() or not token.isprintable() or " " in token:
            raise DropletError("DIGITALOCEAN_TOKEN is invalid.")
        api = DigitalOcean(token)
        if droplet_id is None and operation != "create":
            existing = find_droplet(api, args.name)
            if existing:
                droplet_id = existing["id"]
                print(f"Found {existing['name']} (ID {droplet_id}).")
            elif operation or args.wait or args.ssh or args.deploy or duckdns_name:
                raise DropletError(f"No Droplet named {args.name}. Use --name NAME or pass its ID.")
        if operation == "stop":
            stop_droplet(api, droplet_id)
            return 0
        if operation == "remove":
            remove_droplet(api, droplet_id)
            return 0
        if deploy or args.ssh:
            if not shutil.which("ssh"):
                raise DropletError("Install OpenSSH on this device (Termux: pkg install openssh).")
            ssh_key = args.ssh_key.expanduser() if args.ssh_key else None
            if ssh_key and not ssh_key.is_file():
                raise DropletError(f"SSH private key file does not exist: {ssh_key}")
            ssh = ssh_command(ssh_key)
            ssh_env = ssh_environment()
        if droplet_id is None:
            droplet_id = create_droplet(api, args)
            if droplet_id is None:
                print("Canceled.")
                return 0
            action_id = None
        else:
            action_id = power_on(api, droplet_id)
        address = wait_for_droplet(api, droplet_id, action_id)
        print(f"Droplet {droplet_id} is active at {address}.", flush=True)
        if deploy or args.ssh:
            wait_for_ssh(droplet_id, address, ssh, ssh_env, interactive=not deploy)
        if deploy:
            hostname = update_duckdns(duckdns_name, address, duckdns_token) if duckdns_name else address
            deploy_app(droplet_id, address, hostname, ssh, ssh_env)
        if args.ssh:
            return subprocess.run(ssh + ["-t", f"root@{address}"], env=ssh_env).returncode
    except EOFError:
        print("The confirmation prompt requires terminal input.", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nStopped. Check the dashboard if a request was already submitted.", file=sys.stderr)
        return 130
    except DropletError as error:
        print(f"Error: {str(error).replace(token, '[redacted]') if token else error}",
              file=sys.stderr)
        return 1
    except (KeyError, TypeError, ipaddress.AddressValueError):
        print("Unexpected DigitalOcean API response. Check the dashboard before retrying.",
              file=sys.stderr)
        return 1
    except OSError as error:
        print(f"Droplet error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
