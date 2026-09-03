"""The registry client, shared by registry-add.py and provider-check.py.

One place knows: where the registry is, how to reach it, what an item looks like, and the
rules for writing an item's files into a project. Callers get `fetch`, `install` and
`load_config`; nothing else is part of the interface.

Env:
    STORYSEAM_REGISTRY   registry base url, or a local directory holding a built registry
                         (default: this checkout's registry/r/ if it exists, else the
                         published registry)
    STORYSEAM_ROOT       project to install into / read config.json from (default: cwd)
"""
import hashlib
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

PUBLISHED_REGISTRY = "https://pub-597aecbeb0f64dee8c8894e4da9a211c.r2.dev/r"
LOCAL_REGISTRY = pathlib.Path(__file__).resolve().parent.parent / "registry" / "r"


def _default_registry():
    if (LOCAL_REGISTRY / "index.json").exists():
        return str(LOCAL_REGISTRY)
    return PUBLISHED_REGISTRY


REG = os.environ.get("STORYSEAM_REGISTRY", _default_registry()).rstrip("/")
IS_LOCAL = "://" not in REG
ROOT = pathlib.Path(os.environ.get("STORYSEAM_ROOT", os.getcwd())).resolve()

# Cloudflare's bot protection 403s the default "Python-urllib/x.y" User-Agent, so the
# registry is unreachable without a real one. This is not optional.
UA = "storyseam-registry/1"

# The only place a registry item may write. Anything else is refused.
INSTALL_PREFIX = ".claude/skills/"


def _local_path(path_or_url):
    """Map a catalogue route to a file under the local registry directory. Routes are
    absolute URLs built for wherever the registry was published, so resolve them by their
    tail: `.../skills/<name>.json` -> <dir>/skills/<name>.json."""
    parts = pathlib.PurePosixPath(path_or_url.split("://", 1)[-1]).parts
    tail = parts[-2:] if len(parts) >= 2 and parts[-2] in ("skills", "providers") else parts[-1:]
    return pathlib.Path(REG).joinpath(*tail)


def fetch(path_or_url, timeout=30):
    """GET a JSON document. `path_or_url` is absolute, or relative to the registry base.
    With a local registry directory it is read from disk instead."""
    if IS_LOCAL:
        f = _local_path(path_or_url)
        try:
            return json.loads(f.read_text())
        except FileNotFoundError:
            sys.exit(f"registry: {f} not found — run bin/registry-build.py, or set STORYSEAM_REGISTRY to a URL")
        except json.JSONDecodeError:
            sys.exit(f"registry: {f} is not valid JSON")
    url = path_or_url if "://" in path_or_url else f"{REG}/{path_or_url.lstrip('/')}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        sys.exit(f"registry: {e.code} fetching {url}")
    except urllib.error.URLError as e:
        sys.exit(f"registry: cannot reach {url} ({e.reason})")
    except json.JSONDecodeError:
        sys.exit(f"registry: {url} did not return JSON")


def install(url, root=ROOT):
    """Fetch one item and write its files into `root`. Verifies the item's sha256 against
    its skill content and refuses any destination outside `.claude/skills/`."""
    item = fetch(url)
    files = item.get("files") or []
    if not files:
        sys.exit(f"registry: {item.get('name', url)} carries no files")

    skill = next((f for f in files if f.get("type") == "skill"), files[0])
    digest = hashlib.sha256(skill["content"].encode()).hexdigest()[:16]
    if item.get("sha256") and digest != item["sha256"]:
        sys.exit(f"registry: {item['name']} content hash {digest} != published {item['sha256']} — "
                 f"the item was altered in transit or the registry is inconsistent; not installing")

    for f in files:
        rel = f["path"]
        if not rel.startswith(INSTALL_PREFIX) or ".." in pathlib.PurePosixPath(rel).parts:
            sys.exit(f"registry: {item['name']} wants to write {rel!r} — only {INSTALL_PREFIX} is allowed")
        dest = (root / rel).resolve()
        if root not in dest.parents:
            sys.exit(f"registry: {item['name']} wants to write outside {root}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(f["content"])
        print("  wrote " + rel)

    models = item.get("models", [])
    models = list(models) if isinstance(models, dict) else models
    print("installed {} (models {}, updated {}, sha {})".format(
        item["name"], "/".join(models) or "—", item.get("updated", "?"), item.get("sha256", "?")))
    return item


def load_config(root=ROOT):
    """Read the story's config.json, or exit with a message that says what to do."""
    cfg = root / "config.json"
    if not cfg.exists():
        sys.exit(f"no config.json at {root} — run from a story folder, or set STORYSEAM_ROOT")
    try:
        return json.loads(cfg.read_text())
    except json.JSONDecodeError as e:
        sys.exit(f"{cfg} is not valid JSON ({e})")
