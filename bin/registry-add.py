#!/usr/bin/env python3
"""Install director skills from the Storyseam registry into a project.

    bin/registry-add.py seedance_2_5     install the director for that model id
    bin/registry-add.py --all            install every director in the registry
    bin/registry-add.py --list           show what the registry offers

Env:
    STORYSEAM_REGISTRY   registry base url (default: the published R2 registry)
    STORYSEAM_ROOT       project to install into (default: cwd)

Resolves a model id — the same string that appears in a story's config.json — against
<registry>/models.json, fetches that route, and writes each file the item names to the path
the item names. Idempotent: re-running overwrites with the published version.
"""
import json, os, sys, pathlib, urllib.request, urllib.error

REG  = os.environ.get("STORYSEAM_REGISTRY",
       "https://pub-597aecbeb0f64dee8c8894e4da9a211c.r2.dev/r").rstrip("/")
ROOT = pathlib.Path(os.environ.get("STORYSEAM_ROOT", os.getcwd()))


# Cloudflare's bot protection 403s the default "Python-urllib/x.y" User-Agent, so the
# registry is unreachable without a real one. This is not optional.
UA = "storyseam-registry/1 (+https://github.com/storyseam)"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        sys.exit(f"registry: {e.code} fetching {url}")
    except urllib.error.URLError as e:
        sys.exit(f"registry: cannot reach {url} ({e.reason})")
    except json.JSONDecodeError:
        sys.exit(f"registry: {url} did not return JSON")


def install(url):
    item = get(url)
    for f in item["files"]:
        dest = ROOT / f["path"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(f["content"])
        print("  wrote " + f["path"])
    print("installed {} (model {}, updated {}, sha {})".format(
        item["name"], item["model"], item["updated"], item["sha256"]))
    return item


def main(argv):
    if not argv:
        sys.exit("usage: registry-add.py <model-id|--all|--list>")
    arg = argv[0]

    if arg == "--list":
        d = get(f"{REG}/index.json")
        print("{} v{}  updated {}".format(d["name"], d["version"], d["updated"]))
        print(f"  {REG}")
        for i in d["items"]:
            print("\n  {}  ({}, {})".format(i["title"], i["model"], i["kind"]))
            print("    {}".format(i["description"]))
            print("    {}".format(i["url"]))
        return

    if arg == "--all":
        for i in get(f"{REG}/index.json")["items"]:
            install(i["url"])
        return

    models = get(f"{REG}/models.json")["models"]
    if arg not in models:
        sys.exit("unknown model {!r}. known: {}".format(arg, ", ".join(sorted(models))))
    print(f"resolving {arg} -> {models[arg]}")
    install(models[arg])


if __name__ == "__main__":
    main(sys.argv[1:])
