#!/usr/bin/env python3
"""Build the Storyseam registry from registry/sources/ into registry/r/.

Each source is a directory with meta.json + SKILL.md, and becomes one installable item.

A skill declares the models it is COMPATIBLE with (`models`, an array) and the models it is
the DEFAULT for (`default_for`, a subset). That is what lets a model carry several skills:
one default that a bare model id resolves to, plus alternates asked for by name.

    bin/registry-build.py [BASE_URL]

Two item types:
    storyseam:director   a model-specific skill  -> /r/skills/<name>.json
    storyseam:provider   a backend adapter       -> /r/providers/<name>.json

Output:
    registry/r/index.json             the catalogue (both types)
    registry/r/skills/<name>.json     one route per skill
    registry/r/providers/<name>.json  one route per provider
    registry/r/models.json            model id -> { default, skills[], routes{}, providers[] }
    registry/r/providers.json         provider id -> { access[], route, capabilities, models{} }

The build is deterministic: an item's `updated` date only moves when its content hash does,
so a rebuild with no source change is a no-op diff.
"""
import collections
import datetime
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "registry" / "sources"
OUT = ROOT / "registry" / "r"
BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8788/r").rstrip("/")
TODAY = datetime.date.today().isoformat()

ACCESS_TYPES = ("mcp", "api_key")
LEAKY_KEYS = ("key", "token", "secret", "value")


def previous_updated(out_file, sha):
    """Keep the old `updated` date when the content is unchanged."""
    try:
        old = json.loads(out_file.read_text())
        if old.get("sha256") == sha:
            return old.get("updated", TODAY)
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return TODAY


def read_source(d, errors):
    meta_f, skill_f = d / "meta.json", d / "SKILL.md"
    if not meta_f.exists():
        errors.append(f"{d.name}: no meta.json"); return None, None
    if not skill_f.exists():
        errors.append(f"{d.name}: no SKILL.md"); return None, None
    try:
        meta = json.loads(meta_f.read_text())
    except json.JSONDecodeError as e:
        errors.append(f"{d.name}: bad meta.json — {e}"); return None, None
    skill = skill_f.read_text()
    if not skill.lstrip().startswith("---"):
        errors.append(f"{d.name}: SKILL.md has no YAML frontmatter")
    if f"name: {meta.get('name')}" not in skill.split("---", 2)[1] if skill.count("---") >= 2 else True:
        errors.append(f"{d.name}: SKILL.md frontmatter name != meta.name ({meta.get('name')})")
    if meta.get("name") != d.name:
        errors.append(f"{d.name}: meta.name {meta.get('name')!r} != directory name")
    return meta, skill


def make_item(meta, skill, subdir):
    name = meta["name"]
    sha = hashlib.sha256(skill.encode()).hexdigest()[:16]
    out_file = OUT / subdir / f"{name}.json"
    item = dict(meta)
    item["version"] = 1
    item["sha256"] = sha
    item["updated"] = previous_updated(out_file, sha)
    item["files"] = [{"path": f".claude/skills/{name}/SKILL.md", "type": "skill", "content": skill}]
    return item, out_file


def validate_provider(d, meta, errors):
    for f in ("name", "provider", "title", "access", "auth", "capabilities", "models"):
        if f not in meta:
            errors.append(f"{d.name}: provider meta missing '{f}'")
    for a in meta.get("access", []):
        if a not in ACCESS_TYPES:
            errors.append(f"{d.name}: unknown access type '{a}' ({'|'.join(ACCESS_TYPES)})")
        if a not in meta.get("auth", {}):
            errors.append(f"{d.name}: access '{a}' has no matching auth block")
    for a, blk in meta.get("auth", {}).items():
        if a == "api_key" and "env" not in blk:
            errors.append(f"{d.name}: api_key auth must name an 'env' var, never a value")
        for leaky in LEAKY_KEYS:
            if leaky in blk:
                errors.append(f"{d.name}: auth block contains '{leaky}' — a registry must "
                              f"never carry a credential, only the env var name")
    if not isinstance(meta.get("models"), dict):
        errors.append(f"{d.name}: provider 'models' must be a map of model id -> details")


def validate_director(d, meta, errors):
    # accept legacy single "model", normalise to the array form
    if "model" in meta and "models" not in meta:
        meta["models"] = [meta.pop("model")]
    meta.setdefault("default_for", [])
    for f in ("name", "models", "kind", "title", "description"):
        if f not in meta:
            errors.append(f"{d.name}: meta missing '{f}'")
    if not isinstance(meta.get("models"), list) or not meta.get("models"):
        errors.append(f"{d.name}: 'models' must be a non-empty array")
        return False
    for m in meta["default_for"]:
        if m not in meta["models"]:
            errors.append(f"{d.name}: default_for '{m}' is not in its own models list")
    return True


def main():
    (OUT / "skills").mkdir(parents=True, exist_ok=True)
    (OUT / "providers").mkdir(parents=True, exist_ok=True)

    items, providers, errors = [], [], []
    written = set()
    serves = collections.defaultdict(list)    # model id -> [provider id]
    compat = collections.defaultdict(list)    # model id -> [skill name]
    default = collections.defaultdict(list)   # model id -> [skill name claiming default]

    for d in sorted(p for p in SRC.iterdir() if p.is_dir()):
        meta, skill = read_source(d, errors)
        if meta is None:
            continue

        if meta.get("type") == "storyseam:provider":
            validate_provider(d, meta, errors)
            if errors:
                continue
            item, out_file = make_item(meta, skill, "providers")
            out_file.write_text(json.dumps(item, indent=2, ensure_ascii=False) + "\n")
            written.add(out_file)
            for cid in meta["models"]:
                serves[cid].append(meta["provider"])
            providers.append({"name": item["name"], "provider": meta["provider"], "title": meta["title"],
                              "access": meta["access"], "capabilities": meta["capabilities"],
                              "models": meta["models"], "gaps": meta.get("gaps", {}),
                              "auth": meta["auth"],
                              "url": f"{BASE}/providers/{item['name']}.json",
                              "sha256": item["sha256"], "updated": item["updated"]})
            items.append({"name": item["name"], "type": "provider", "provider": meta["provider"],
                          "title": meta["title"], "description": meta.get("description", ""),
                          "access": meta["access"], "models": sorted(meta["models"]),
                          "url": f"{BASE}/providers/{item['name']}.json",
                          "sha256": item["sha256"], "updated": item["updated"]})
            continue

        if not validate_director(d, meta, errors):
            continue
        item, out_file = make_item(meta, skill, "skills")
        out_file.write_text(json.dumps(item, indent=2, ensure_ascii=False) + "\n")
        written.add(out_file)
        for m in meta["models"]:
            compat[m].append(item["name"])
        for m in meta["default_for"]:
            default[m].append(item["name"])
        items.append({"name": item["name"], "type": "director",
                      "models": meta["models"], "default_for": meta["default_for"],
                      "kind": meta["kind"], "title": meta["title"],
                      "description": meta["description"],
                      "url": f"{BASE}/skills/{item['name']}.json",
                      "sha256": item["sha256"], "updated": item["updated"],
                      "constraints": meta.get("constraints", {})})

    # every model reachable by a bare id needs exactly one default
    for m, names in sorted(compat.items()):
        d = default.get(m, [])
        if len(d) == 0:
            errors.append(f"model '{m}' has no default skill — one of {names} needs "
                          f"\"default_for\": [\"{m}\"], or a bare '{m}' cannot resolve")
        elif len(d) > 1:
            errors.append(f"model '{m}' has {len(d)} defaults ({', '.join(d)}) — exactly one")

    # a model no provider serves cannot actually be rendered
    for m in sorted(compat):
        if not serves.get(m):
            errors.append(f"model '{m}' has a director but no provider serves it — "
                          f"add it to a provider's models map or it cannot be rendered")

    names = [i["name"] for i in items]
    for n in sorted({n for n in names if names.count(n) > 1}):
        errors.append(f"duplicate item name '{n}'")

    if errors:
        print("BUILD FAILED:", file=sys.stderr)
        for e in errors:
            print("  -", e, file=sys.stderr)
        sys.exit(1)

    # only now that the build is valid: drop stale outputs from removed sources
    for sub in ("skills", "providers"):
        for stale in (OUT / sub).glob("*.json"):
            if stale not in written:
                stale.unlink()
                print(f"  removed stale {stale.relative_to(ROOT)}")

    by_model = {m: {"default": default[m][0],
                    "skills": sorted(compat[m]),
                    "routes": {n: f"{BASE}/skills/{n}.json" for n in sorted(compat[m])},
                    "providers": sorted(serves.get(m, []))}
                for m in sorted(compat)}

    index_updated = max((i["updated"] for i in items), default=TODAY)
    (OUT / "index.json").write_text(json.dumps({
        "name": "storyseam-registry", "version": 2,
        "description": "Installable per-model skills and provider adapters for Storyseam. A "
                       "model has one default skill and any number of alternates, asked for "
                       "by name.",
        "base_url": BASE, "updated": index_updated,
        "items": items,
    }, indent=2, ensure_ascii=False) + "\n")

    (OUT / "providers.json").write_text(json.dumps({
        "description": "Resolve config.json providers.<capability>.id to its adapter skill, its "
                       "access type, and the canonical models it serves. Auth blocks name the "
                       "ENV VAR to read; the registry never carries a credential.",
        "base_url": BASE,
        "providers": {p["provider"]: p for p in sorted(providers, key=lambda x: x["provider"])},
    }, indent=2, ensure_ascii=False) + "\n")

    (OUT / "models.json").write_text(json.dumps({
        "description": "Resolve a model id from config.json to its default skill, or list the "
                       "alternates available for it and ask by name.",
        "base_url": BASE, "models": by_model,
    }, indent=2, ensure_ascii=False) + "\n")

    print(f"built {len(items)} item(s): {len(items) - len(providers)} skill(s), "
          f"{len(providers)} provider(s), {len(by_model)} model(s) -> {BASE}")
    for m, e in by_model.items():
        alts = [x for x in e["skills"] if x != e["default"]]
        print(f"  {m:16s} default={e['default']}"
              + (f"  alt={', '.join(alts)}" if alts else "")
              + f"  providers={', '.join(e['providers'])}")
    for p in providers:
        print(f"  {p['provider']:16s} access={'/'.join(p['access'])}  serves={', '.join(sorted(p['models']))}")


if __name__ == "__main__":
    main()
