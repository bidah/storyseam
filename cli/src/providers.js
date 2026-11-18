// Verify a provider's access requirement is satisfied, before anything is spent.
// The Node port of bin/provider-check.py.
//
// Access types:
//   mcp       the client must have the provider's MCP server connected. This CANNOT be
//             verified here (the CLI has no view of the agent's tools) — it reports what
//             the agent should probe.
//   api_key   the named environment variable must be set and non-empty.
//
// SECURITY: never reads, prints, logs or stores a key's VALUE. It reports only whether the
// variable is set, and its length, so a truncated paste is visible without the secret being.
import { fetchJson, loadConfig } from "./registry.js";
import { die } from "./util.js";

const OK = "OK";
const MISSING = "MISSING";
const MANUAL = "CHECK IN CLIENT";
const pad = (s) => s.padEnd(15);

function check(p) {
  const lines = [];
  let ok = true;
  for (const access of p.access) {
    const auth = p.auth[access];
    if (access === "api_key") {
      const env = auth.env;
      const val = process.env[env] || "";
      if (val.trim()) {
        lines.push(`  ${pad(OK)} api_key  $${env} is set (${val.length} chars)`); // length only — never the value
      } else {
        ok = false;
        lines.push(`  ${pad(MISSING)} api_key  $${env} is not set`);
        lines.push(`                  get a key: ${auth.obtain || "—"}`);
        lines.push(`                  then:      export ${env}=...`);
        lines.push("                  never paste it into chat or into config.json");
      }
    } else if (access === "mcp") {
      lines.push(`  ${pad(MANUAL)} mcp      probe ${auth.probe_tool || "—"}`);
      lines.push(`                  ${auth.install || ""}`);
    } else {
      ok = false;
      lines.push(`  ${pad(MISSING)} unknown access type ${JSON.stringify(access)}`);
    }
  }
  return { ok, lines };
}

function wantedFromConfig(root) {
  const c = loadConfig(root);
  const provs = c.providers;
  if (!provs || typeof provs !== "object" || !Object.keys(provs).length) {
    die("config.json has no providers block — nothing to check");
  }
  const bad = Object.entries(provs).find(([, v]) => !v || typeof v !== "object" || !v.id);
  if (bad) die(`config.json providers.${bad[0]} must be an object with an 'id'`);
  console.log(
    "config.json providers: " +
      Object.entries(provs).map(([k, v]) => `${k}=${v.id} (${v.access || "?"})`).join(", ")
  );
  return [...new Set(Object.values(provs).map((v) => v.id))].sort();
}

/** Returns true when every api_key requirement is met (mcp is always "check in client"). */
export async function checkProviders(root, { ids = [], all = false } = {}) {
  const provs = (await fetchJson("providers.json")).providers;
  const wanted = all ? Object.keys(provs) : ids.length ? ids : wantedFromConfig(root);

  let failed = false;
  for (const pid of wanted) {
    if (!provs[pid]) {
      console.log(`\n${pid}\n  ${pad(MISSING)} unknown provider. known: ${Object.keys(provs).sort().join(", ")}`);
      failed = true;
      continue;
    }
    const p = provs[pid];
    // `models` is an object in the catalogue and a list in older items — accept both.
    const models = (Array.isArray(p.models) ? p.models : Object.keys(p.models || {})).sort();
    console.log(`\n${pid}  (${p.title}, serves ${models.join(", ")})`);
    const { ok, lines } = check(p);
    console.log(lines.join("\n"));
    failed = failed || !ok;
  }
  console.log();
  return !failed;
}
