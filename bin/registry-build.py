#!/usr/bin/env python3
"""Build the Storyseam registry from registry/sources/ into registry/r/.

Each source is a directory with meta.json + SKILL.md. Each becomes one installable
registry item, shadcn-style: the item carries the files to write and where to write them.

    bin/registry-build.py [BASE_URL]

Output:
    registry/r/index.json          the catalogue
    registry/r/skills/<name>.json  one route per director skill
    registry/r/models.json         model id -> director route (what the agent resolves against)
"""
import json, pathlib, sys, hashlib, datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC  = ROOT / "registry" / "sources"
OUT  = ROOT / "registry" / "r"
BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8788").rstrip("/")

(OUT / "skills").mkdir(parents=True, exist_ok=True)
items, by_model, errors = [], {}, []

for d in sorted(p for p in SRC.iterdir() if p.is_dir()):
    meta_f, skill_f = d / "meta.json", d / "SKILL.md"
    if not meta_f.exists(): errors.append(f"{d.name}: no meta.json"); continue
    if not skill_f.exists(): errors.append(f"{d.name}: no SKILL.md"); continue
    try:
        meta = json.loads(meta_f.read_text())
    except json.JSONDecodeError as e:
        errors.append(f"{d.name}: bad meta.json — {e}"); continue

    for f in ("name", "model", "kind", "title", "description"):
        if f not in meta: errors.append(f"{d.name}: meta missing '{f}'")

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
    item["files"]   = [{
        "path": f".claude/skills/{name}/SKILL.md",
        "type": "skill",
        "content": skill,
    }]

    (OUT / "skills" / f"{name}.json").write_text(json.dumps(item, indent=2, ensure_ascii=False) + "\n")

    route = f"{BASE}/skills/{name}.json"
    entry = {"name": name, "model": meta["model"], "kind": meta["kind"],
             "title": meta["title"], "description": meta["description"],
             "url": route, "sha256": item["sha256"], "updated": item["updated"],
             "constraints": meta.get("constraints", {})}
    items.append(entry)
    if meta["model"] in by_model:
        errors.append(f"duplicate director for model {meta['model']}")
    by_model[meta["model"]] = route

if errors:
    print("BUILD FAILED:", file=sys.stderr)
    for e in errors: print("  -", e, file=sys.stderr)
    sys.exit(1)

(OUT / "index.json").write_text(json.dumps({
    "name": "storyseam-registry", "version": 1,
    "description": "Installable per-model director skills for Storyseam. One route per model.",
    "base_url": BASE, "updated": datetime.date.today().isoformat(),
    "items": items,
}, indent=2, ensure_ascii=False) + "\n")

(OUT / "models.json").write_text(json.dumps({
    "description": "Resolve config.json's model id to its director skill route.",
    "base_url": BASE, "models": by_model,
}, indent=2, ensure_ascii=False) + "\n")

print(f"built {len(items)} director(s)")
for i in items:
    print(f"  {i['model']:16s} -> {i['url']}")
print(f"  index:  {BASE}/index.json")
print(f"  models: {BASE}/models.json")
