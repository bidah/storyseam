// The MCP servers a story uses, so the setup travels with the folder: a story
// opened on another machine, or in another agent, says which servers it needs
// and how to install each one (docs/spec.md §10).
//
// KNOWN_SERVERS is the catalogue `init` writes entries from. A story may list a
// server that is not here; it then carries its own `install` lines.

const http = (name, url) => ({
  transport: "http",
  url,
  install: {
    claude: `claude mcp add --transport http ${name} ${url}`,
    codex: `codex mcp add ${name} --url ${url}`,
    cursor: `add {"mcpServers":{"${name}":{"url":"${url}"}}} to .cursor/mcp.json`,
  },
});

export const KNOWN_SERVERS = {
  higgsfield: {
    ...http("higgsfield", "https://mcp.higgsfield.ai/mcp"),
    auth: "oauth",
    notes: "Sign in with your Higgsfield account when the client asks. Also available as a claude.ai connector, where its tools are named mcp__claude_ai_higgsfield__*.",
  },
  fal: {
    ...http("fal", "https://mcp.fal.ai/mcp-relay"),
    auth: "oauth",
    notes: "Optional beside the API-key adapter (FAL_KEY): for looking up models and endpoints. Renders still go through provider-fal.",
  },
  "davinci-resolve": {
    transport: "stdio",
    install: {
      any: "npx davinci-resolve-mcp setup",
    },
    notes: "Its installer configures Claude Code, Codex, Cursor and others. Resolve Studio: set Preferences > General > External scripting using to Local. Free edition: use the in-app bridge (Workspace > Scripts).",
  },
};

/** The servers a fresh story uses, from its providers and its editor. */
export function defaultServers(config) {
  const out = {};
  const add = (name, used) => {
    if (!KNOWN_SERVERS[name]) return;
    out[name] ??= { used_for: [], required: false, ...KNOWN_SERVERS[name] };
    for (const u of used) if (!out[name].used_for.includes(u)) out[name].used_for.push(u);
  };
  for (const [cap, p] of Object.entries(config.providers || {})) {
    if (p.id === "higgsfield") add("higgsfield", [cap]);
    if (p.id === "fal") add("fal", [cap]);
  }
  // A provider reached through MCP cannot render without its server.
  for (const p of Object.values(config.providers || {})) {
    if (p.access === "mcp" && out[p.id]) out[p.id].required = true;
  }
  if (config.editor?.id === "davinci_resolve" && config.editor.mcp) {
    add("davinci-resolve", ["editor"]);
    out["davinci-resolve"].required = true;
  }
  return out;
}

/** Problems with config.json `mcp_servers`, as BROKEN lines. Shared shape with bin/story-check.py. */
export function mcpProblems(config) {
  const out = [];
  const servers = config.mcp_servers;
  if (servers === undefined) return out;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return ["config.json mcp_servers must be an object keyed by server name"];
  }
  for (const [name, s] of Object.entries(servers)) {
    if (!s || typeof s !== "object") {
      out.push(`config.json mcp_servers.${name} must be an object`);
      continue;
    }
    if (!Array.isArray(s.used_for) || !s.used_for.length) out.push(`config.json mcp_servers.${name} needs used_for (what the story uses it for)`);
    if (!s.install || typeof s.install !== "object" || !Object.keys(s.install).length) {
      out.push(`config.json mcp_servers.${name} needs install (a command per agent, or "any")`);
    }
  }
  for (const p of Object.values(config.providers || {})) {
    if (p.access === "mcp" && !servers[p.id]) out.push(`config.json provider ${p.id} is reached by MCP but mcp_servers has no ${p.id} entry`);
  }
  if (config.editor?.mcp && config.editor.id !== "none" && !Object.values(servers).some((s) => (s.used_for || []).includes("editor"))) {
    out.push(`config.json editor ${config.editor.id} has mcp: true but no mcp_servers entry is used_for "editor"`);
  }
  return out;
}

/** `storyseam mcp`: what to install, for one agent or all of them. */
export function printInstall(config, agent) {
  const servers = Object.entries(config.mcp_servers || {});
  if (!servers.length) {
    console.log("config.json lists no MCP servers.");
    return;
  }
  for (const [name, s] of servers) {
    console.log(`${name}${s.required ? "  (required)" : ""}: ${(s.used_for || []).join(", ")}`);
    const lines = s.install || {};
    const picks = agent ? [agent, "any"] : Object.keys(lines);
    for (const k of picks) if (lines[k]) console.log(`  ${k.padEnd(7)} ${lines[k]}`);
    if (s.notes) console.log(`  note    ${s.notes}`);
    console.log("");
  }
  console.log("Never paste a token or key into config.json. A server signs you in itself, or reads an env var you export.");
}
