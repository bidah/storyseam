#!/usr/bin/env python3
"""The five hard rules have one owner: the "## The five hard rules" block in CLAUDE.md.

    bin/rules-check.py            check: copies match the owner, no known contradiction anywhere
    bin/rules-check.py --write    regenerate the marked copies from CLAUDE.md, then check

Each rule in the owner is a numbered item whose bold first sentence is its HEADLINE. A copy
is the numbered list of headlines plus each rule's first plain sentence, written between
these markers wherever they appear:

    <!-- rules: generated from CLAUDE.md, do not edit here -->
    ...
    <!-- /rules -->

The check also greps the engine for phrasings that contradict the rules — every pattern
here is one that has actually appeared in a skill after a rule changed.

Exit codes: 0 consistent, 1 drift or contradiction (file:line printed), 2 bad input.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OWNER = ROOT / "CLAUDE.md"
OPEN = "<!-- rules: generated from CLAUDE.md, do not edit here -->"
CLOSE = "<!-- /rules -->"

# Files that carry a generated copy. A copy missing its markers is a failure.
COPIES = [
    ROOT / "README.md",
    ROOT / ".claude" / "skills" / "story-engine" / "SKILL.md",
    ROOT / "templates" / "story-CLAUDE.md",
]

# Where contradictions are looked for.
SCAN_DIRS = [ROOT / ".claude", ROOT / "templates", ROOT / "registry" / "sources", ROOT / "bin"]
SCAN_FILES = [ROOT / "README.md", ROOT / "CLAUDE.md"]

# (regex, why it is wrong, regex that excuses the line). Keep this list short and earned.
CONTRADICTIONS = [
    (r"Higgsfield MCP only",
     "rule 4: the backend is configuration, not Higgsfield only", None),
    (r"the `?start_image`? of block|becomes the `?start_image`?|start_image of block N\+1|"
     r"as the `?start_image`? of|is ever `?start_image`?",
     "rule 5: the anchor is the first image_references entry, never start_image on 2.5",
     r"2\.0|ignores|never|not |accepts"),
    (r"No music, no discernible dialogue",
     "rule 1: the canonical audio line ends `No music.`; that phrasing is a quote of published "
     "practice, not the instruction",
     r"documented|published|convention"),
    (r"`seedance-director`",
     "no such skill: directors are resolved per model (seedance-2-5-director, ...)", None),
    (r"generate_video_batch(?!`?[^\n]*(never|not|Never))",
     "rule 5: blocks are never batched", r"never|Never|not "),
]


def parse_owner():
    text = OWNER.read_text()
    m = re.search(r"^## The five hard rules\n(.*?)(?=^## )", text, re.S | re.M)
    if not m:
        sys.exit("rules-check: CLAUDE.md has no '## The five hard rules' block")
    block = m.group(1)
    items = re.findall(r"^(\d)\. \*\*(.+?)\*\*\s+(.*?)(?=^\d\. \*\*|\Z)", block, re.S | re.M)
    if len(items) != 5:
        sys.exit(f"rules-check: expected 5 numbered rules in CLAUDE.md, found {len(items)}")
    rules = []
    for n, headline, rest in items:
        body = " ".join(rest.split())
        first = re.split(r"(?<=[.!?])\s+(?=[A-Z`])", body, maxsplit=1)[0]
        rules.append((int(n), headline.strip(), first.strip()))
    return rules


def render(rules):
    return "\n".join(f"{n}. **{h}** {s}" for n, h, s in rules)


def copy_region(text):
    a, b = text.find(OPEN), text.find(CLOSE)
    if a < 0 or b < 0 or b < a:
        return None
    return a + len(OPEN), b


def write_copies(rules):
    body = "\n" + render(rules) + "\n"
    for f in COPIES:
        text = f.read_text()
        r = copy_region(text)
        if r is None:
            sys.exit(f"rules-check: {f.relative_to(ROOT)} has no rules markers to write into")
        f.write_text(text[:r[0]] + body + text[r[1]:])
        print(f"  wrote {f.relative_to(ROOT)}")


def check_copies(rules):
    errors = []
    expected = render(rules).strip()
    for f in COPIES:
        text = f.read_text()
        r = copy_region(text)
        if r is None:
            errors.append(f"{f.relative_to(ROOT)}: no generated rules block (markers missing)")
            continue
        got = text[r[0]:r[1]].strip()
        if got != expected:
            line = text[:r[0]].count("\n") + 1
            errors.append(f"{f.relative_to(ROOT)}:{line}: rules copy differs from CLAUDE.md "
                          f"— run bin/rules-check.py --write")
    return errors


def scan_files():
    for d in SCAN_DIRS:
        for p in sorted(d.rglob("*")):
            if p.is_file() and p.suffix in (".md", ".sh", ".py", ".json", ".txt"):
                yield p
    for f in SCAN_FILES:
        yield f


def check_contradictions():
    errors = []
    for p in scan_files():
        try:
            lines = p.read_text().splitlines()
        except UnicodeDecodeError:
            continue
        for i, line in enumerate(lines, 1):
            if p.name == "rules-check.py":
                continue
            for pat, why, excuse in CONTRADICTIONS:
                if re.search(pat, line) and not (excuse and re.search(excuse, line)):
                    errors.append(f"{p.relative_to(ROOT)}:{i}: {why}\n      {line.strip()[:110]}")
    return errors


def main(argv):
    if argv and argv[0] in ("-h", "--help"):
        sys.exit(__doc__)
    rules = parse_owner()
    if argv and argv[0] == "--write":
        write_copies(rules)
    errors = check_copies(rules) + check_contradictions()
    if errors:
        print("RULES DRIFT:")
        for e in errors:
            print("  -", e)
        sys.exit(1)
    print("rules: one owner, {} copies in sync, no contradiction in {} files".format(
        len(COPIES), sum(1 for _ in scan_files())))
    for n, h, _ in rules:
        print(f"  {n}. {h}")


if __name__ == "__main__":
    main(sys.argv[1:])
