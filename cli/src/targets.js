// What each agent target needs on disk.
//
// Storyseam's content is the same everywhere: 10 pipeline skills, 21 specialists, one
// entry file. What differs is where a given tool LOOKS for them. Claude Code discovers
// `.claude/skills/`, `.claude/commands/` and `.claude/agents/` natively; nothing else
// does, so every other target gets the same files under a neutral `.storyseam/` and an
// entry file that tells the agent to read them.
import { CLAUDE_PREFIX, PORTABLE_PREFIX } from "./registry.js";

const chain = "/start-story ──▶ /write-script ──▶ /shotlist ──▶ /cast ──▶ /render ──▶ /edit";

const portableStages = (dir) => `A \`/command\` above is a name for a stage, not a feature of your tool. To run one, read
\`${dir}/<skill>/SKILL.md\` and follow it — the skill file is the whole instruction.

| Stage | Read |
| --- | --- |
| \`/write-script\` | \`${dir}/script-writing/SKILL.md\` |
| \`/script-agents\` | \`${dir}/script-agents/SKILL.md\` |
| \`/shotlist\` | \`${dir}/shotlist/SKILL.md\` |
| \`/cast\` | \`${dir}/asset-check/SKILL.md\` |
| \`/render\` | \`${dir}/render-clips/SKILL.md\` |
| \`/edit\` | \`${dir}/edit/SKILL.md\` |
| \`/assemble\` | \`${dir}/assemble/SKILL.md\` (what \`/edit\` runs when \`editor.id\` is \`none\`) |

The specialist room is \`.storyseam/agents/*.md\`: one system prompt per specialist. Run one
as a subagent if your tool has them, or inline it and end with the envelope from
\`docs/specialist-contract.md\`. \`mcp__claude_ai_higgsfield__*\` are the Higgsfield MCP
server's tools as Claude names them; any MCP client sees the same tools without the prefix.`;

const runtime = `This folder is self-contained: the skills, the specialists and the schemas are all
here, installed by \`npx storyseam init\`. The command-line tools are the \`storyseam\`
CLI itself, run from this folder:

\`\`\`
npx storyseam check          validate shotlist.json / state.json / media.json against schema/
npx storyseam providers      is the backend in config.json reachable?
npx storyseam voice <slug>   mux a cast voice into the black-frame mp4 Seedance takes
npx storyseam last-frame     pull block N's last frame for chaining into block N+1
\`\`\``;

export const TARGETS = {
  claude: {
    id: "claude",
    label: "Claude Code",
    hint: "native: /write-script and the 21 specialists work as slash commands and subagents",
    skillsPrefix: CLAUDE_PREFIX,
    skillsDir: ".claude/skills",
    agentsDir: ".claude/agents",
    commandsDir: ".claude/commands",
    entryFile: "CLAUDE.md",
    linkAgentsMd: true,
    stages: `Each \`/command\` is a thin wrapper that loads \`.claude/skills/<name>/SKILL.md\`, and the
specialist room is \`.claude/agents/\` — 21 subagents, dispatched in stage order.`,
  },
  codex: {
    id: "codex",
    label: "Codex / generic AGENTS.md",
    hint: "skills under .storyseam/skills/, AGENTS.md as the entry file. Works for any tool that reads AGENTS.md",
    skillsPrefix: PORTABLE_PREFIX,
    skillsDir: ".storyseam/skills",
    agentsDir: ".storyseam/agents",
    commandsDir: null,
    entryFile: "AGENTS.md",
    linkAgentsMd: false,
    stages: portableStages(".storyseam/skills"),
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    hint: "same as generic, plus a .cursor/rules/ pointer so the entry file is always in context",
    skillsPrefix: PORTABLE_PREFIX,
    skillsDir: ".storyseam/skills",
    agentsDir: ".storyseam/agents",
    commandsDir: null,
    entryFile: "AGENTS.md",
    linkAgentsMd: false,
    stages: portableStages(".storyseam/skills"),
    extraFiles: {
      ".cursor/rules/storyseam.mdc": `---
description: Storyseam — this folder is a film. Read AGENTS.md before touching it.
alwaysApply: true
---

This project is a Storyseam story: the filesystem is the state. Before any edit, read
\`AGENTS.md\` in the project root — it names every path, the five invariants that must not
be broken, and which stage comes next. Stage instructions live in \`.storyseam/skills/\`.

Never generate music. Never raise the video resolution above 480p.
`,
    },
  },
};

export const targetChoices = () =>
  Object.values(TARGETS).map((t) => ({ value: t.id, label: t.label, hint: t.hint }));

/** Fill the story entry file's placeholders for one target. */
export function renderEntry(template, { title, target }) {
  return template
    .replaceAll("{{TITLE}}", title)
    .replaceAll("{{RUNTIME}}", runtime)
    .replaceAll("{{VOICE_TOOL}}", "npx storyseam voice <slug>")
    .replaceAll("{{STAGES}}", target.stages)
    .replaceAll("{{ENGINE}}", ".");
}

export { chain };
