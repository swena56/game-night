#!/usr/bin/env python3
"""Read, resolve, or reopen Game Night feedback over SSH."""

import argparse
import ipaddress
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

from droplet import DigitalOcean, DropletError, find_droplet, ssh_command, ssh_environment


# Run inside the app container to reach its loopback-only administrative API.
INBOX_SCRIPT = """
import json
import sys
from urllib.request import Request, urlopen

inbox = "http://127.0.0.1:8000/api/feedback"
status, *ids = sys.argv[1:]
ids = set(map(int, ids))

def read():
    with urlopen(inbox, timeout=10) as response:
        return json.load(response)

data = read()
if ids:
    known = {item["id"]: item["status"] for item in data["items"]}
    missing = ids - known.keys()
    if missing:
        sys.exit("Unknown report IDs: " + ", ".join(map(str, sorted(missing))))
    for report_id in sorted(ids):
        if known[report_id] == status:
            continue
        request = Request(inbox + "/status",
                          data=json.dumps({"id": report_id, "status": status}).encode(),
                          headers={"Content-Type": "application/json"})
        with urlopen(request, timeout=10) as response:
            if not json.load(response).get("ok"):
                sys.exit(f"Status update failed for report #{report_id}")
    data = read()
    data["items"] = [item for item in data["items"] if item["id"] in ids]
    if {item["id"] for item in data["items"] if item["status"] == status} != ids:
        sys.exit("Read-back verification failed")
elif status:
    data["items"] = [item for item in data["items"] if item["status"] == status]
print(json.dumps(data, indent=2))
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("id", nargs="?", type=int, help="DigitalOcean Droplet ID")
    parser.add_argument("--name", default="game-night", help="Droplet name (default: game-night)")
    parser.add_argument("--ssh-key", type=Path, help="path to an SSH private key")
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--status", choices=("open", "done"), help="filter the inbox by status")
    action.add_argument("--resolve", nargs="+", type=int, metavar="REPORT_ID",
                        help="mark verified reports done and read back their status")
    action.add_argument("--reopen", nargs="+", type=int, metavar="REPORT_ID",
                        help="reopen reports and read back their status")
    args = parser.parse_args()
    report_ids = args.resolve or args.reopen or []
    if any(report_id <= 0 for report_id in report_ids):
        parser.error("Report IDs must be positive.")
    status = "done" if args.resolve else "open" if args.reopen else args.status or ""
    if args.id is not None and args.id <= 0:
        parser.error("Droplet ID must be positive.")

    token = os.environ.get("DIGITALOCEAN_TOKEN", "").strip()
    try:
        if not token:
            raise DropletError("Set DIGITALOCEAN_TOKEN in your environment.")
        api = DigitalOcean(token)
        droplet = (api.request(f"/droplets/{args.id}")["droplet"] if args.id is not None
                   else find_droplet(api, args.name))
        if not droplet:
            raise DropletError(f"No Droplet named {args.name}.")
        if droplet["status"] != "active":
            raise DropletError("The Droplet must be running to read its feedback.")
        address = next((str(ipaddress.IPv4Address(net["ip_address"]))
                        for net in droplet.get("networks", {}).get("v4", [])
                        if net["type"] == "public"), None)
        if address is None:
            raise DropletError("The Droplet has no public IPv4 address.")
        key = args.ssh_key.expanduser() if args.ssh_key else None
        if key and not key.is_file():
            raise DropletError(f"SSH private key file does not exist: {key}")

        if report_ids:
            print(f"Updating feedback on {droplet['name']} (Droplet {droplet['id']}) to {status}.",
                  file=sys.stderr, flush=True)
        remote = shlex.join([
            "docker", "exec", "game-night-game-night-1", "python", "-c",
            INBOX_SCRIPT, status, *map(str, sorted(set(report_ids))),
        ])
        response = subprocess.run(
            ssh_command(key) + ["-T", "-o", "BatchMode=yes", f"root@{address}", remote],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, check=True,
            timeout=120, env=ssh_environment(),
        )
        print(json.dumps(json.loads(response.stdout), indent=2))
        return 0
    except (DropletError, OSError, KeyError, ValueError) as error:
        message = str(error).replace(token, "[redacted]") if token else str(error)
        print(f"Feedback operation failed: {message}", file=sys.stderr)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        print(f"Feedback operation failed over SSH ({error.__class__.__name__}).", file=sys.stderr)
        if report_ids:
            print("Fetch the inbox again to check whether any status updates took effect.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
