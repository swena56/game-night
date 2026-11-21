#!/usr/bin/env python3
"""Read the Game Night feedback inbox over SSH."""

import argparse
import ipaddress
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

from droplet import DigitalOcean, DropletError, find_droplet, ssh_command, ssh_environment


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("id", nargs="?", type=int, help="DigitalOcean Droplet ID")
    parser.add_argument("--name", default="game-night", help="Droplet name (default: game-night)")
    parser.add_argument("--ssh-key", type=Path, help="path to an SSH private key")
    args = parser.parse_args()
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

        remote = shlex.join([
            "docker", "exec", "game-night-game-night-1", "python", "-c",
            "import sys; from urllib.request import urlopen; "
            "sys.stdout.buffer.write(urlopen('http://127.0.0.1:8000/api/feedback', timeout=10).read())",
        ])
        response = subprocess.run(
            ssh_command(key) + ["-T", f"root@{address}", remote],
            stdout=subprocess.PIPE, check=True, env=ssh_environment(),
        )
        print(json.dumps(json.loads(response.stdout), indent=2))
        return 0
    except (DropletError, OSError, KeyError, ValueError) as error:
        message = str(error).replace(token, "[redacted]") if token else str(error)
        print(f"Could not fetch feedback: {message}", file=sys.stderr)
    except subprocess.CalledProcessError as error:
        print(f"Could not fetch feedback over SSH (exit {error.returncode}).", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
