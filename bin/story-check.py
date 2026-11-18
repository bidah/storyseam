#!/usr/bin/env python3
"""Validate a story's machine-read files against the schemas in schema/.

    bin/story-check.py [story-root]          validate shotlist.json, state.json, media.json, reviews.json
    bin/story-check.py --file <path> <schema> validate one file against one schema

No third-party dependencies: this is a small validator for the subset of JSON Schema the
Storyseam schemas use (type, required, properties, additionalProperties, patternProperties,
items, minItems, enum, minimum, maximum, minLength, pattern). It also runs the cross-file
checks a schema cannot express: a `done` block must have its clip on disk, every path the
media cache names must exist, and a block's `references` order must agree with the
`@Image N` numbering in its prompt (anchor frame first on a chained block).

Exit codes: 0 valid, 1 invalid, 2 bad input.
"""
import json
import os
import pathlib
import re
import sys

ENGINE = pathlib.Path(__file__).resolve().parent.parent
SCHEMAS = ENGINE / "schema"

TYPES = {
    "object": dict, "array": list, "string": str, "boolean": bool,
    "integer": int, "number": (int, float), "null": type(None),
}


def _is_type(v, t):
    if t == "integer":
        return isinstance(v, int) and not isinstance(v, bool)
    if t == "number":
        return isinstance(v, (int, float)) and not isinstance(v, bool)
    return isinstance(v, TYPES[t])


def validate(value, schema, path="$", errors=None):
    """Collect every violation as `path: message`. Returns the error list."""
    errors = [] if errors is None else errors
    t = schema.get("type")
    if t is not None:
        allowed = t if isinstance(t, list) else [t]
        if not any(_is_type(value, x) for x in allowed):
            errors.append(f"{path}: expected {'/'.join(allowed)}, got {type(value).__name__}")
            return errors
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: {value!r} not one of {schema['enum']}")
    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            errors.append(f"{path}: shorter than {schema['minLength']}")
        if "pattern" in schema and not re.search(schema["pattern"], value):
            errors.append(f"{path}: {value!r} does not match /{schema['pattern']}/")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(f"{path}: {value} < minimum {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            errors.append(f"{path}: {value} > maximum {schema['maximum']}")
    if isinstance(value, dict):
        for k in schema.get("required", []):
            if k not in value:
                errors.append(f"{path}: missing required '{k}'")
        props = schema.get("properties", {})
        pprops = schema.get("patternProperties", {})
        extra = schema.get("additionalProperties", True)
        for k, v in value.items():
            if k in props:
                validate(v, props[k], f"{path}.{k}", errors)
                continue
            matched = [s for pat, s in pprops.items() if re.search(pat, k)]
            if matched:
                for s in matched:
                    validate(v, s, f"{path}.{k}", errors)
            elif extra is False:
                errors.append(f"{path}: unexpected key '{k}'")
            elif isinstance(extra, dict):
                validate(v, extra, f"{path}.{k}", errors)
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            errors.append(f"{path}: fewer than {schema['minItems']} items")
        if "items" in schema:
            for i, v in enumerate(value):
                validate(v, schema["items"], f"{path}[{i}]", errors)
    return errors


def load_json(p):
    try:
        return json.loads(pathlib.Path(p).read_text())
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as e:
        sys.exit(f"story-check: {p} is not valid JSON ({e})")


def check_file(root, rel, schema_name, required):
    data = load_json(root / rel)
    if data is None:
        if required:
            print(f"MISSING  {rel}")
            return False
        print(f"absent   {rel} (fine — not written yet)")
        return True
    schema = load_json(SCHEMAS / schema_name)
    if schema is None:
        sys.exit(f"story-check: schema {schema_name} not found under {SCHEMAS}")
    errs = validate(data, schema)
    if errs:
        print(f"INVALID  {rel}")
        for e in errs:
            print(f"           {e}")
        return False
    print(f"ok       {rel}")
    return True


PRESET_SETTINGS = {"video.generate_audio"}


def preset_problems(config):
    """config.json presets (docs/spec.md section 14). Mirrors cli/src/presets.js presetProblems."""
    p = config.get("presets")
    if p is None:
        return []
    if not isinstance(p, dict):
        return ["config.json presets must be an object keyed by section"]
    out = []
    for section, v in p.items():
        if not isinstance(v, dict):
            out.append(f"config.json presets.{section} must be an object")
            continue
        if v.get("section") and v["section"] != section:
            out.append(f'config.json presets.{section} holds a "{v["section"]}" preset')
        if not v.get("id"):
            out.append(f"config.json presets.{section} has no id")
        if not isinstance(v.get("prompt"), str) or not v.get("prompt"):
            out.append(f"config.json presets.{section} has no prompt line, so no block will carry it")
        if v.get("position") is not None and v.get("position") not in ("before", "after"):
            out.append(f'config.json presets.{section} has position "{v.get("position")}"; use before or after')
        for k, val in (v.get("settings") or {}).items():
            if k not in PRESET_SETTINGS:
                out.append(f'config.json presets.{section} sets "{k}", which a preset may not change')
            elif k == "video.generate_audio" and (config.get("video") or {}).get("generate_audio") != val:
                js = lambda x: "true" if x is True else "false" if x is False else "undefined" if x is None else x
                out.append(f"config.json presets.{section} ({v.get('id')}) sets video.generate_audio to {js(val)} but video.generate_audio is {js((config.get('video') or {}).get('generate_audio'))}")
    return out


def cross_checks(root):
    """What the schemas cannot say: the files the JSON points at must exist."""
    ok = True
    config = load_json(root / "config.json") or {}
    for p in preset_problems(config):
        print(f"BROKEN   {p}")
        ok = False
    sp = config.get("shot_preview")
    if sp is not None and not isinstance((sp or {}).get("enabled") if isinstance(sp, dict) else None, bool):
        print('BROKEN   config.json shot_preview must be { "enabled": true | false }')
        ok = False
    # mcp_servers: what the story needs connected, and how to install it (docs/spec.md section 10).
    # The same rules as cli/src/mcp.js mcpProblems.
    servers = config.get("mcp_servers")
    if servers is not None:
        if not isinstance(servers, dict):
            print("BROKEN   config.json mcp_servers must be an object keyed by server name")
            ok = False
            servers = {}
        for name, s in servers.items():
            if not isinstance(s, dict):
                print(f"BROKEN   config.json mcp_servers.{name} must be an object")
                ok = False
                continue
            if not isinstance(s.get("used_for"), list) or not s["used_for"]:
                print(f"BROKEN   config.json mcp_servers.{name} needs used_for (what the story uses it for)")
                ok = False
            if not isinstance(s.get("install"), dict) or not s["install"]:
                print(f'BROKEN   config.json mcp_servers.{name} needs install (a command per agent, or "any")')
                ok = False
        for p in (config.get("providers") or {}).values():
            if p.get("access") == "mcp" and p.get("id") not in servers:
                print(f"BROKEN   config.json provider {p.get('id')} is reached by MCP but mcp_servers has no {p.get('id')} entry")
                ok = False
        ed = config.get("editor") or {}
        if ed.get("mcp") and ed.get("id") != "none" and not any("editor" in (s.get("used_for") or []) for s in servers.values() if isinstance(s, dict)):
            print(f'BROKEN   config.json editor {ed.get("id")} has mcp: true but no mcp_servers entry is used_for "editor"')
            ok = False
    # editor: where /edit cuts the film (docs/spec.md section 8). Absent = none.
    if "editor" in config:
        e = config["editor"]
        if not isinstance(e, dict) or not isinstance(e.get("id"), str) or not e.get("id"):
            print('BROKEN   config.json editor must be an object with an id ("none", "davinci_resolve", ...)')
            ok = False
        elif e["id"] != "none" and not (isinstance(e.get("mcp"), bool) and isinstance(e.get("computer_use"), bool)):
            print(f"BROKEN   config.json editor {e['id']} needs mcp and computer_use set to true or false")
            ok = False
    # video.models is the candidate list, video.model the pick (docs/spec.md section 7).
    video = config.get("video") or {}
    candidates = video.get("models") if isinstance(video.get("models"), list) else []
    # A block's own `model` (docs/spec.md section 9) must be a model the story offers.
    allowed = candidates or [m for m in [video.get("model")] if m]
    for b in (load_json(root / "shotlist/shotlist.json") or {}).get("blocks") or []:
        if b.get("model") and b["model"] not in allowed:
            print(f"BROKEN   shotlist.json {b.get('id')} renders on {b['model']}, which is not in config.json video.models ({', '.join(allowed)})")
            ok = False
    if not video.get("model") and len(candidates) > 1:
        print(f"UNCHOSEN config.json lists video models {', '.join(candidates)} and video.model is unset — ask the author which to use")
        ok = False
    elif not video.get("model") and not candidates:
        print("BROKEN   config.json names no video model (video.model or video.models)")
        ok = False
    elif video.get("model") and candidates and video["model"] not in candidates:
        print(f"BROKEN   config.json video.model {video['model']} is not one of video.models ({', '.join(candidates)})")
        ok = False
    state = load_json(root / ".storyseam/state.json") or {}
    for bid, b in (state.get("blocks") or {}).items():
        if b.get("status") == "done":
            clip = b.get("clip") or f"renders/clips/{bid}.mp4"
            if not (root / clip).exists():
                print(f"BROKEN   state.json says {bid} is done but {clip} is not on disk")
                ok = False
    media = load_json(root / ".storyseam/media.json") or {}
    for path in media:
        if not (root / path).exists():
            print(f"BROKEN   media.json names {path}, which is not on disk")
            ok = False
    sl = load_json(root / "shotlist/shotlist.json") or {}
    ids = [b.get("id") for b in sl.get("blocks", [])]
    expected = [f"block_{i:02d}" for i in range(1, len(ids) + 1)]
    if ids and ids != expected:
        print(f"BROKEN   shotlist block ids are {ids}; expected {expected} (contiguous, zero-padded, in order)")
        ok = False
    for b in sl.get("blocks", []):
        extra = set(b.get("voices", [])) - set(b.get("characters", []))
        if extra:
            print(f"BROKEN   {b.get('id')}: voices {sorted(extra)} are not in the block's characters")
            ok = False
    ok &= reference_contract(sl)
    return ok


IMAGE_KINDS = ("anchor", "character", "location", "prop")


def reference_contract(sl):
    """The prompt numbers @Image 1..K in the order of the block's image-kind references, the
    anchor frame first on a chained block. Only checked when a block carries `references`."""
    ok = True
    blocks = sl.get("blocks", [])
    for i, b in enumerate(blocks):
        refs = b.get("references")
        if not isinstance(refs, list):
            continue
        bid = b.get("id", f"#{i}")
        images = [r for r in refs if r.get("kind") in IMAGE_KINDS]
        chained = bool(b.get("start_from_previous_last_frame"))
        anchors = [j for j, r in enumerate(refs) if r.get("kind") == "anchor"]
        if chained:
            prev = blocks[i - 1].get("id") if i else None
            want = f"renders/frames/{prev}_last.jpg" if prev else None
            if anchors != [0]:
                print(f"BROKEN   {bid}: chained, so references[0] must be the one anchor frame (found anchors at {anchors})")
                ok = False
            elif want and refs[0].get("path") != want:
                print(f"BROKEN   {bid}: anchor path is {refs[0].get('path')}, expected {want}")
                ok = False
        elif anchors:
            print(f"BROKEN   {bid}: not chained but carries an anchor reference")
            ok = False
        prompt = b.get("prompt", "")
        mentioned = sorted({int(n) for n in re.findall(r"@Image\s+(\d+)", prompt)})
        if mentioned and mentioned[-1] > len(images):
            print(f"BROKEN   {bid}: prompt cites @Image {mentioned[-1]} but only {len(images)} image references are listed")
            ok = False
        if chained and images and 1 not in mentioned:
            print(f"BROKEN   {bid}: chained but the prompt never declares @Image 1 (the anchor frame)")
            ok = False
        missing = [n for n in range(1, len(images) + 1) if n not in mentioned]
        if mentioned and missing:
            print(f"WARN     {bid}: image references {missing} are listed but never cited in the prompt")
    return ok


def outline_beats(root):
    p = root / "script/outline.md"
    if not p.exists():
        return []
    return [int(m.group(1)) for line in p.read_text().split("\n")
            for m in [re.match(r"^(?:\*\*|#{2,4}\s+)(\d+)\.\s", line)] if m]


def beat_problems(root, blocks):
    """Blocks land on beats (docs/spec.md section 12). Mirrors cli/src/beats.js."""
    out = []
    tagged = [b for b in blocks if isinstance(b.get("beats"), list)]
    if not tagged:
        return out
    if len(tagged) != len(blocks):
        return [f"shotlist.json: {len(blocks) - len(tagged)} block(s) have no beats; every block must say which beats it lands on"]
    prev = None
    for b in blocks:
        beats = b["beats"]
        for i in range(1, len(beats)):
            if beats[i] != beats[i - 1] + 1:
                out.append(f"{b['id']} covers beats {', '.join(map(str, beats))}, which are not consecutive")
        if b.get("beat_part") and len(beats) != 1:
            out.append(f"{b['id']} is part of a split beat but covers {len(beats)} beats")
        if prev:
            last, first = prev["beats"][-1], beats[0]
            if first == last:
                a, c = prev.get("beat_part"), b.get("beat_part")
                if not a or not c or len(prev["beats"]) != 1 or c.get("n") != a.get("n", 0) + 1 or c.get("of") != a.get("of"):
                    out.append(f"{prev['id']} ends in the middle of beat {last} and {b['id']} picks it up: end {prev['id']} on the beat, or mark both blocks beat_part")
            elif first != last + 1:
                gap = f"beat {last + 1} is" if first - 1 == last + 1 else f"beats {last + 1}-{first - 1} are"
                out.append(f"{b['id']} starts on beat {first} but {prev['id']} ended on beat {last}: {gap} in no block")
            elif prev.get("beat_part") and prev["beat_part"].get("n") != prev["beat_part"].get("of"):
                pp = prev["beat_part"]
                out.append(f"{prev['id']} is part {pp.get('n')} of {pp.get('of')} of beat {last}, but the next block moves on")
        prev = b
    outline = outline_beats(root)
    if outline:
        covered = {n for b in blocks for n in b["beats"]}
        missing = [n for n in outline if n not in covered]
        unknown = sorted(n for n in covered if n not in outline)
        if missing:
            out.append(f"outline beats {', '.join(map(str, missing))} land in no block")
        if unknown:
            out.append(f"blocks cite beats {', '.join(map(str, unknown))}, which script/outline.md does not have")
    return out


def main(argv):
    if argv and argv[0] in ("-h", "--help"):
        sys.exit(__doc__)
    if argv and argv[0] == "--file":
        if len(argv) != 3:
            sys.exit("usage: story-check.py --file <path> <schema-name>")
        data = load_json(argv[1])
        if data is None:
            sys.exit(f"story-check: {argv[1]} not found")
        errs = validate(data, load_json(SCHEMAS / argv[2]))
        for e in errs:
            print(e)
        sys.exit(1 if errs else 0)

    root = pathlib.Path(argv[0] if argv else os.environ.get("STORYSEAM_ROOT", os.getcwd())).resolve()
    if not (root / "config.json").exists():
        sys.exit(f"story-check: no config.json in {root} — is this a story folder?")
    ok = True
    ok &= check_file(root, "shotlist/shotlist.json", "shotlist.schema.json", required=False)
    ok &= check_file(root, ".storyseam/state.json", "state.schema.json", required=True)
    # media.json exists only on upload-then-confirm providers (Higgsfield); URL providers have none
    ok &= check_file(root, ".storyseam/media.json", "media.schema.json", required=False)
    ok &= check_file(root, "script/reviews.json", "reviews.schema.json", required=False)
    ok &= check_file(root, "shotlist/assets.json", "assets.schema.json", required=False)
    for p in beat_problems(root, (load_json(root / "shotlist/shotlist.json") or {}).get("blocks") or []):
        print(f"BROKEN   {p}")
        ok = False
    # the same rules as cli/src/assets.js assetSheetProblems
    sheet = load_json(root / "shotlist/assets.json") or {}
    for a in sheet.get("assets") or []:
        if a.get("source") == "refs" and not a.get("refs"):
            print(f'BROKEN   assets.json {a.get("kind")} {a.get("slug")} is source "refs" with no reference images')
            ok = False
        for r in a.get("refs") or []:
            if not (root / r).exists():
                print(f"BROKEN   assets.json {a.get('kind')} {a.get('slug')} cites {r}, which is not on disk")
                ok = False
    ok &= cross_checks(root)
    print("story is consistent" if ok else "story has problems — fix them before spending credits")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main(sys.argv[1:])
