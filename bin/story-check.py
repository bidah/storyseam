#!/usr/bin/env python3
"""Validate a story's machine-read files against the schemas in schema/.

    bin/story-check.py [story-root]          validate shotlist.json, state.json, media.json, reviews.json
    bin/story-check.py --file <path> <schema> validate one file against one schema

No third-party dependencies: this is a small validator for the subset of JSON Schema the
Storyseam schemas use (type, required, properties, additionalProperties, patternProperties,
items, minItems, enum, minimum, maximum, minLength, pattern). It also runs the cross-file
checks a schema cannot express: a `done` block must have its clip on disk, and every path
the media cache names must exist.

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


def cross_checks(root):
    """What the schemas cannot say: the files the JSON points at must exist."""
    ok = True
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
    return ok


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
    ok &= cross_checks(root)
    print("story is consistent" if ok else "story has problems — fix them before spending credits")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main(sys.argv[1:])
