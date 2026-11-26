"""The curated list of player-made pinball tables.

Each ``*.json`` file in this folder is one listed table::

    {"name": "Pop Pit", "blurb": "one line for the gallery", "author": "optional credit", "spec": {...editor table...}}

The file name (without ``.json``) is the table's slug; its id in the lobby's Table setting is ``t_<slug>``. Files are read once at
server start and every spec is rebuilt with the same checks as a table played from the editor; a broken file is skipped and
logged, never fatal. See docs/pinball-tables.md for how a table gets here, and tools/pinball_table.py to add one.
"""
import json
import os
import re

from ..base import GameError
from ..pinball_custom import build

FOLDER = os.path.dirname(os.path.abspath(__file__))
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{1,30}$")


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:31]


def load(folder=FOLDER):
    """{table id: {"slug", "name", "blurb", "author", "spec"}}, in alphabetical order of file name."""
    tables = {}
    for file in sorted(os.listdir(folder)):
        if not file.endswith(".json"):
            continue
        slug = file[:-5]
        try:
            with open(os.path.join(folder, file), encoding="utf-8") as f:
                entry = json.load(f)
            if not SLUG.match(slug):
                raise GameError("bad file name")
            name = " ".join(str(entry["name"]).split())[:24]
            build(entry["spec"])
            if len(name) < 3:
                raise GameError("name too short")
        except (OSError, ValueError, KeyError, TypeError, GameError) as e:
            print(f"pinball_tables: skipping {file}: {e}")
            continue
        tables["t_" + slug] = {"slug": slug, "name": name, "blurb": " ".join(str(entry.get("blurb") or "").split())[:160],
                               "author": " ".join(str(entry.get("author") or "").split())[:16], "spec": entry["spec"]}
    return tables


def save(name, blurb, author, spec, slug=None, folder=FOLDER):
    """Write (or overwrite, when slug names an existing file) one listed table. The spec must build. Returns the slug."""
    name = " ".join(str(name or "").split())[:24]
    if len(name) < 3:
        raise GameError("Give the table a name of 3 to 24 characters.")
    if not isinstance(spec, dict):
        raise GameError("Bad table.")
    build(spec)
    if slug is None:
        base = slugify(name)
        if not SLUG.match(base):
            raise GameError("That name has no letters or digits to make a file name from.")
        slug, n = base, 2
        while os.path.exists(os.path.join(folder, slug + ".json")):
            slug, n = f"{base[:28]}-{n}", n + 1
    elif not SLUG.match(str(slug)) or not os.path.exists(os.path.join(folder, slug + ".json")):
        raise GameError("No such listed table.")
    entry = {"name": name, "blurb": " ".join(str(blurb or "").split())[:160], "author": " ".join(str(author or "").split())[:16],
             "spec": {**spec, "name": name}}
    path = os.path.join(folder, slug + ".json")
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(entry, f, indent=1, ensure_ascii=False)
    os.replace(path + ".tmp", path)
    return slug


def delete(slug, folder=FOLDER):
    if not SLUG.match(str(slug)) or not os.path.exists(os.path.join(folder, slug + ".json")):
        raise GameError("No such listed table.")
    os.remove(os.path.join(folder, slug + ".json"))
