#!/usr/bin/env python3
"""Verify a provider's access requirement is satisfied, before anything is spent.

    bin/provider-check.py                 check every provider named in ./config.json
    bin/provider-check.py atlas           check one provider by id
    bin/provider-check.py --all           check every provider in the registry

Access types:
    mcp       the client must have the provider's MCP server connected. This script CANNOT
              verify that (it has no view of the agent's tools) — it reports what to probe.
    api_key   the named environment variable must be set and non-empty.

SECURITY: this script never reads, prints, logs or stores a key's VALUE. It reports only
whether the variable is set, and its length, so a truncated paste is visible without the
secret being. Nothing here writes a credential to disk.

Exit codes: 0 every api_key requirement met (mcp is always "check in client"), 1 otherwise.
"""
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from storyseam_registry import ROOT, fetch, load_config  # noqa: E402

OK, MISSING, MANUAL = "OK", "MISSING", "CHECK IN CLIENT"


def check(p):
    lines, ok = [], True
    for access in p["access"]:
        auth = p["auth"][access]
        if access == "api_key":
            env = auth["env"]
            val = os.environ.get(env, "")
            if val.strip():
                # length only — never the value
                lines.append(f"  {OK:15s} api_key  ${env} is set ({len(val)} chars)")
            else:
                ok = False
                lines.append(f"  {MISSING:15s} api_key  ${env} is not set")
                lines.append(f"                  get a key: {auth.get('obtain', '—')}")
                lines.append(f"                  then:      export {env}=...")
                lines.append("                  never paste it into chat or into config.json")
        elif access == "mcp":
            lines.append(f"  {MANUAL:15s} mcp      probe {auth.get('probe_tool', '—')}")
            lines.append(f"                  {auth.get('install', '')}")
        else:
            ok = False
            lines.append(f"  {MISSING:15s} unknown access type {access!r}")
    return ok, lines


def wanted_from_config():
    c = load_config(ROOT)
    provs = c.get("providers")
    if not isinstance(provs, dict) or not provs:
        sys.exit("config.json has no providers block — nothing to check")
    bad = [k for k, v in provs.items() if not isinstance(v, dict) or not v.get("id")]
    if bad:
        sys.exit(f"config.json providers.{bad[0]} must be an object with an 'id'")
    print("config.json providers: " + ", ".join(
        f"{k}={v['id']} ({v.get('access', '?')})" for k, v in provs.items()))
    return sorted({v["id"] for v in provs.values()})


def main(argv):
    provs = fetch("providers.json")["providers"]

    if argv and argv[0] in ("-h", "--help"):
        sys.exit(__doc__)
    if argv and argv[0] == "--all":
        wanted = list(provs)
    elif argv:
        wanted = argv
    else:
        wanted = wanted_from_config()

    failed = False
    for pid in wanted:
        if pid not in provs:
            print(f"\n{pid}\n  {MISSING:15s} unknown provider. known: {', '.join(sorted(provs))}")
            failed = True
            continue
        p = provs[pid]
        print(f"\n{pid}  ({p['title']}, serves {', '.join(sorted(p['models']))})")
        ok, lines = check(p)
        print("\n".join(lines))
        failed = failed or not ok

    print()
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main(sys.argv[1:])
