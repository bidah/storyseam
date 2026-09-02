#!/usr/bin/env python3
"""Install skills from the Storyseam registry into a project.

    bin/registry-add.py seedance_2_5                  the DEFAULT skill for that model id
    bin/registry-add.py seedance-2-5-extension-director   a skill by name
    bin/registry-add.py --model seedance_2_5 --all     every skill compatible with a model
    bin/registry-add.py --list                         the catalogue, grouped by model
    bin/registry-add.py --all                          every skill in the registry

A model has one default skill and any number of alternates. A bare model id — the string in
config.json — installs the default. An alternate is asked for by name.

Env:
    STORYSEAM_REGISTRY   registry base url (default: the published R2 registry)
    STORYSEAM_ROOT       project to install into (default: cwd)
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
    print("installed {} (models {}, updated {}, sha {})".format(
        item["name"], "/".join(item["models"]), item["updated"], item["sha256"]))


def show_list():
    idx = get(f"{REG}/index.json")
    mods = get(f"{REG}/models.json")["models"]
    print("{} v{}  updated {}".format(idx["name"], idx["version"], idx["updated"]))
    print(f"  {REG}\n")
    by_name = {i["name"]: i for i in idx["items"]}
    for model, e in mods.items():
        print(f"{model}")
        for n in e["skills"]:
            tag = "default " if n == e["default"] else "alt     "
            print(f"  {tag} {n}")
            print(f"           {by_name[n]['description']}")
        print()


def main(argv):
    if not argv:
        sys.exit("usage: registry-add.py <model-id|skill-name|--list|--all|--model ID --all>")

    if argv[0] == "--list":
        return show_list()

    if argv[0] == "--model":
        if len(argv) < 2:
            sys.exit("--model needs a model id")
        model = argv[1]
        mods = get(f"{REG}/models.json")["models"]
        if model not in mods:
            sys.exit("unknown model {!r}. known: {}".format(model, ", ".join(sorted(mods))))
        e = mods[model]
        targets = e["skills"] if "--all" in argv[2:] else [e["default"]]
        for n in targets:
            install(e["routes"][n])
        return

    if argv[0] == "--all":
        for i in get(f"{REG}/index.json")["items"]:
            install(i["url"])
        return

    key = argv[0]
    mods = get(f"{REG}/models.json")["models"]
    if key in mods:                                   # a model id -> its default
        e = mods[key]
        print(f"resolving model {key} -> default {e['default']}")
        return install(e["routes"][e["default"]])

    idx = {i["name"]: i for i in get(f"{REG}/index.json")["items"]}
    if key in idx:                                    # a skill name -> that skill
        print("resolving skill {} (models {})".format(key, "/".join(idx[key]["models"])))
        return install(idx[key]["url"])

    sys.exit("unknown model or skill {!r}.\n  models: {}\n  skills: {}".format(
        key, ", ".join(sorted(mods)), ", ".join(sorted(idx))))


if __name__ == "__main__":
    main(sys.argv[1:])
