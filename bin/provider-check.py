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
"""
import json, os, sys, pathlib, urllib.request, urllib.error

REG = os.environ.get("STORYSEAM_REGISTRY",
      "https://pub-597aecbeb0f64dee8c8894e4da9a211c.r2.dev/r").rstrip("/")
ROOT = pathlib.Path(os.environ.get("STORYSEAM_ROOT", os.getcwd()))
UA = "storyseam-registry/1 (+https://github.com/storyseam)"

OK, MISSING, MANUAL = "OK", "MISSING", "CHECK IN CLIENT"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        sys.exit(f"registry: {e.code} fetching {url}")
    except urllib.error.URLError as e:
        sys.exit(f"registry: cannot reach {url} ({e.reason})")


def check(pid, p):
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
                lines.append(f"                  get a key: {auth.get('obtain','—')}")
                lines.append(f"                  then:      export {env}=...")
                lines.append(f"                  never paste it into chat or into config.json")
        elif access == "mcp":
            lines.append(f"  {MANUAL:15s} mcp      probe {auth.get('probe_tool','—')}")
            lines.append(f"                  {auth.get('install','')}")
    return ok, lines


def main(argv):
    provs = get(f"{REG}/providers.json")["providers"]

    if argv and argv[0] == "--all":
        wanted = list(provs)
    elif argv:
        wanted = argv
    else:
        cfg = ROOT / "config.json"
        if not cfg.exists():
            sys.exit(f"no config.json at {ROOT} — pass a provider id, or run from a story folder")
        c = json.loads(cfg.read_text())
        wanted = sorted({v["id"] for v in c.get("providers", {}).values() if isinstance(v, dict)})
        if not wanted:
            sys.exit("config.json has no providers block — nothing to check")
        print(f"config.json providers: " + ", ".join(
            f"{k}={v['id']} ({v.get('access','?')})" for k, v in c["providers"].items()))

    failed = False
    for pid in wanted:
        if pid not in provs:
            print(f"\n{pid}\n  {MISSING:15s} unknown provider. known: {', '.join(sorted(provs))}")
            failed = True
            continue
        p = provs[pid]
        print(f"\n{pid}  ({p['title']}, serves {', '.join(sorted(p['models']))})")
        ok, lines = check(pid, p)
        print("\n".join(lines))
        failed = failed or not ok

    print()
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main(sys.argv[1:])
