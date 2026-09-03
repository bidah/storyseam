#!/usr/bin/env python3
"""Install skills from the Storyseam registry into a project.

    bin/registry-add.py seedance_2_5                      the DEFAULT skill for that model id
    bin/registry-add.py seedance-2-5-extension-director   a skill by name
    bin/registry-add.py provider-atlas                    a provider adapter by name
    bin/registry-add.py --model seedance_2_5 --all        every skill compatible with a model
    bin/registry-add.py --list                            the catalogue, grouped by model
    bin/registry-add.py --all                             every item in the registry

A model has one default skill and any number of alternates. A bare model id — the string in
config.json — installs the default. An alternate, or a provider, is asked for by name.

Every item is hash-checked against the catalogue and may only write under .claude/skills/.

Env:
    STORYSEAM_REGISTRY   registry base url (default: the published R2 registry)
    STORYSEAM_ROOT       project to install into (default: cwd)
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from storyseam_registry import REG, ROOT, fetch, install  # noqa: E402

USAGE = "usage: registry-add.py <model-id|skill-name|--list|--all|--model ID [--all]>"


def show_list():
    idx = fetch("index.json")
    mods = fetch("models.json")["models"]
    provs = fetch("providers.json")["providers"]
    print("{} v{}  updated {}".format(idx["name"], idx["version"], idx["updated"]))
    print(f"  {REG}\n  installing into {ROOT}\n")
    by_name = {i["name"]: i for i in idx["items"]}
    for model, e in mods.items():
        print(f"{model}  (served by {', '.join(e.get('providers', [])) or 'nobody'})")
        for n in e["skills"]:
            tag = "default " if n == e["default"] else "alt     "
            print(f"  {tag} {n}")
            print(f"           {by_name[n]['description']}")
        print()
    print("providers")
    for pid, p in provs.items():
        print(f"  {p['name']:24s} {p['title']}  access={'/'.join(p['access'])}  "
              f"serves={', '.join(sorted(p['models']))}")


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        sys.exit(USAGE)

    if argv[0] == "--list":
        return show_list()

    if argv[0] == "--model":
        if len(argv) < 2:
            sys.exit("--model needs a model id")
        model = argv[1]
        mods = fetch("models.json")["models"]
        if model not in mods:
            sys.exit("unknown model {!r}. known: {}".format(model, ", ".join(sorted(mods))))
        e = mods[model]
        targets = e["skills"] if "--all" in argv[2:] else [e["default"]]
        for n in targets:
            install(e["routes"][n])
        return

    if argv[0] == "--all":
        for i in fetch("index.json")["items"]:
            install(i["url"])
        return

    if argv[0].startswith("-"):
        sys.exit(f"unknown flag {argv[0]!r}\n{USAGE}")

    for key in argv:
        mods = fetch("models.json")["models"]
        if key in mods:                                   # a model id -> its default
            e = mods[key]
            print(f"resolving model {key} -> default {e['default']}")
            install(e["routes"][e["default"]])
            continue

        idx = {i["name"]: i for i in fetch("index.json")["items"]}
        if key in idx:                                    # a skill or provider name
            models = idx[key].get("models", [])
            models = list(models) if isinstance(models, dict) else models
            print("resolving {} {} (models {})".format(idx[key]["type"], key, "/".join(models) or "—"))
            install(idx[key]["url"])
            continue

        sys.exit("unknown model or skill {!r}.\n  models: {}\n  items: {}".format(
            key, ", ".join(sorted(mods)), ", ".join(sorted(idx))))


if __name__ == "__main__":
    main(sys.argv[1:])
