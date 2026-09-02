#!/usr/bin/env python3
"""Build the Storyseam registry from registry/sources/ into registry/r/.

Each source is a directory with meta.json + SKILL.md, and becomes one installable item.

A skill declares the models it is COMPATIBLE with (`models`, an array) and the models it is
the DEFAULT for (`default_for`, a subset). That is what lets a model carry several skills:
one default that a bare model id resolves to, plus alternates asked for by name.

    bin/registry-build.py [BASE_URL]

Output:
    registry/r/index.json          the catalogue
    registry/r/skills/<name>.json  one route per skill
    registry/r/models.json         model id -> { default, skills[] }
"""
import json, pathlib, sys, hashlib, datetime, collections

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC  = ROOT / "registry" / "sources"
OUT  = ROOT / "registry" / "r"
BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8788").rstrip("/")

(OUT / "skills").mkdir(parents=True, exist_ok=True)
for stale in (OUT / "skills").glob("*.json"):
    stale.unlink()

items, errors = [], []
compat  = collections.defaultdict(list)   # model -> [skill name]
default = collections.defaultdict(list)   # model -> [skill name claiming default]

for d in sorted(p for p in SRC.iterdir() if p.is_dir()):
    meta_f, skill_f = d / "meta.json", d / "SKILL.md"
    if not meta_f.exists(): errors.append(f"{d.name}: no meta.json"); continue
    if not skill_f.exists(): errors.append(f"{d.name}: no SKILL.md"); continue
    try:
        meta = json.loads(meta_f.read_text())
    except json.JSONDecodeError as e:
        errors.append(f"{d.name}: bad meta.json — {e}"); continue

    # accept legacy single "model", normalise to the array form
    if "model" in meta and "models" not in meta:
        meta["models"] = [meta.pop("model")]
    meta.setdefault("default_for", [])

    for f in ("name", "models", "kind", "title", "description"):
        if f not in meta: errors.append(f"{d.name}: meta missing '{f}'")
    if not isinstance(meta.get("models"), list) or not meta.get("models"):
        errors.append(f"{d.name}: 'models' must be a non-empty array")
        continue
    for m in meta["default_for"]:
        if m not in meta["models"]:
            errors.append(f"{d.name}: default_for '{m}' is not in its own models list")

    skill = skill_f.read_text()
    if not skill.lstrip().startswith("---"):
        errors.append(f"{d.name}: SKILL.md has no YAML frontmatter")
    if f"name: {meta.get('name')}" not in skill:
        errors.append(f"{d.name}: SKILL.md frontmatter name != meta.name ({meta.get('name')})")

    name = meta["name"]
    item = dict(meta)
    item["$schema"] = f"{BASE}/schema/registry-item.json"
    item["version"] = 1
    item["updated"] = datetime.date.today().isoformat()
    item["sha256"]  = hashlib.sha256(skill.encode()).hexdigest()[:16]
    item["files"]   = [{"path": f".claude/skills/{name}/SKILL.md", "type": "skill",
                        "content": skill}]
    (OUT / "skills" / f"{name}.json").write_text(json.dumps(item, indent=2, ensure_ascii=False) + "\n")

    for m in meta["models"]:
        compat[m].append(name)
    for m in meta["default_for"]:
        default[m].append(name)

    items.append({"name": name, "models": meta["models"], "default_for": meta["default_for"],
                  "kind": meta["kind"], "title": meta["title"],
                  "description": meta["description"],
                  "url": f"{BASE}/skills/{name}.json",
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

names = [i["name"] for i in items]
for n in {n for n in names if names.count(n) > 1}:
    errors.append(f"duplicate skill name '{n}'")

if errors:
    print("BUILD FAILED:", file=sys.stderr)
    for e in errors: print("  -", e, file=sys.stderr)
    sys.exit(1)

by_model = {m: {"default": default[m][0],
                "skills": sorted(compat[m]),
                "routes": {n: f"{BASE}/skills/{n}.json" for n in sorted(compat[m])}}
            for m in sorted(compat)}

(OUT / "index.json").write_text(json.dumps({
    "name": "storyseam-registry", "version": 2,
    "description": "Installable per-model skills for Storyseam. A model has one default "
                   "skill and any number of alternates, asked for by name.",
    "base_url": BASE, "updated": datetime.date.today().isoformat(),
    "items": items,
}, indent=2, ensure_ascii=False) + "\n")

(OUT / "models.json").write_text(json.dumps({
    "description": "Resolve a model id from config.json to its default skill, or list the "
                   "alternates available for it and ask by name.",
    "base_url": BASE, "models": by_model,
}, indent=2, ensure_ascii=False) + "\n")

print(f"built {len(items)} skill(s) across {len(by_model)} model(s)")
for m, e in by_model.items():
    alts = [s for s in e["skills"] if s != e["default"]]
    print(f"  {m:16s} default={e['default']}" + (f"  alternates={', '.join(alts)}" if alts else ""))
