// The Node port of bin/storyseam-init.sh, plus the parts a git clone used to provide:
// the skills, the specialist room, the schemas and a config.json.
//
// Idempotent by construction: `seed` never overwrites and directories are created with
// { recursive: true }. Running init twice on a live story must not destroy a draft.
import fs from "node:fs";
import path from "node:path";
import { asset } from "./paths.js";
import { renderEntry } from "./targets.js";
import { rewrite, danglingRefs } from "./rewrite.js";

// The stage skills that ARE the pipeline. Listed, not globbed: the same list is the
// `files` entry in package.json, and a director sitting in a dev checkout must not
// silently become part of a scaffold.
export const PIPELINE_SKILLS = [
  "assemble", "asset-check", "edit", "model-directors", "providers", "render-clips",
  "script-agents", "script-writing", "shotlist", "start-story", "story-engine",
];

const DIRS = [
  "script/drafts",
  "world",
  "prompts",
  "shotlist",
  "assets/images/characters",
  "assets/images/locations",
  "assets/images/props",
  "assets/audio/voices/blackframe",
  "assets/audio/music",
  "assets/video_refs",
  // HUMAN-FILLED: the author's own reference images, one folder per sheet
  // (assets/refs/characters/<slug>/ ...). /cast reads them; nothing writes here.
  "assets/refs/characters",
  "assets/refs/locations",
  "assets/refs/props",
  "renders/clips",
  "renders/frames",
  "renders/final",
  ".storyseam",
];

// script/script.md is deliberately NOT seeded: its absence is how the engine knows
// /write-script has not run yet. The filesystem is the state.
const SEEDS = {
  "script/reviews.json": '{ "passes": [] }\n',
  "world/characters.md": "# Characters\n",
  "world/locations.md": "# Locations\n",
  "world/props.md": "# Props\n",
  "prompts/image_style_prompt.txt":
    "TODO: fill this in. Every image generation appends it.\n",
  "prompts/video_style_prompt.txt":
    "TODO: fill this in. Every video generation appends it. Must end with: Audio: diegetic only. No music.\n",
  ".storyseam/state.json":
    '{ "blocks": {}, "voices": {}, "stills": {}, "credits_spent": 0, "runs_used": 0 }\n',
  ".storyseam/media.json": "{}\n",
};

// Media is output, not source. Without this every 2k plate and every 30s clip lands in
// `git status` the first time /cast runs.
const GITIGNORE = `# Storyseam: the tree is convention, the media is output.
renders/
assets/images/
assets/audio/
assets/video_refs/
.storyseam/media.json
.DS_Store
`;

const seed = (root, rel, content) => {
  const p = path.join(root, rel);
  if (fs.existsSync(p)) return false;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return true;
};

// Markdown is instructions the agent will follow, so it is rehomed for the target on the
// way in (see rewrite.js). JSON gets the same pass — a schema's `description` is prose the
// agent reads too — but only if it still parses afterwards. Anything else is copied byte
// for byte.
const REHOMED = new Set([".md", ".json"]);

/** Rewrite text for the target, refusing any substitution that would break the JSON. */
function rehome(src, target) {
  const raw = fs.readFileSync(src, "utf8");
  const [text, subs] = rewrite(raw, target);
  if (src.endsWith(".json")) {
    try {
      JSON.parse(text);
    } catch {
      return [raw, 0];
    }
  }
  return [text, subs];
}
const copyDir = (from, to, target, report) => {
  if (!fs.existsSync(from)) return 0;
  fs.mkdirSync(to, { recursive: true });
  let n = 0;
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory()) {
      n += copyDir(src, dst, target, report);
      continue;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (target && REHOMED.has(path.extname(e.name))) {
      const [text, subs] = rehome(src, target);
      fs.writeFileSync(dst, text);
      if (report) {
        report.subs += subs;
        for (const ref of danglingRefs(text, target)) report.dangling.push(`${path.relative(to, dst)}: ${ref}`);
      }
    } else {
      fs.copyFileSync(src, dst);
    }
    n++;
  }
  return n;
};

export function defaultConfig({ title, aspect, seconds, provider, videoModels = ["seedance_2_5"], editor = { id: "none" } }) {
  // `video.models` is the candidate list; `video.model` is the one in use and
  // what every skill reads. With one candidate it is chosen already; with
  // several it is left unset, and the agent asks the author (docs/spec.md §7).
  const video = { models: videoModels, resolution: "480p", generate_audio: true };
  if (videoModels.length === 1) video.model = videoModels[0];
  return {
    title,
    providers: {
      video: { id: provider, access: provider === "higgsfield" ? "mcp" : "api_key" },
      image: { id: provider === "higgsfield" ? "higgsfield" : provider, access: provider === "higgsfield" ? "mcp" : "api_key" },
    },
    aspect_ratio: aspect,
    target_seconds: seconds,
    block_seconds: 30,
    image: { model: "gpt_image_2", resolution: "2k", quality: "high" },
    video,
    audio: { music: "never_generated", voice_ref_format: "blackframe_mp4" },
    // Where /edit cuts the film: "none" = the agent alone with ffmpeg (docs/spec.md §8).
    editor,
    continuity: { chain_last_frame: true },
    costs: { block_30s: 75, voice: 15, still: 2.5 },
  };
}

/** Lay down the tree, the seeds, config.json and the entry file. Returns what it wrote. */
export function scaffold(root, { title, target, config }) {
  const written = [];
  fs.mkdirSync(root, { recursive: true });

  for (const d of DIRS) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
    const keep = path.join(root, d, ".gitkeep");
    if (!fs.existsSync(keep)) fs.writeFileSync(keep, "");
  }
  for (const [rel, content] of Object.entries(SEEDS)) {
    if (seed(root, rel, content)) written.push(rel);
  }
  if (seed(root, ".gitignore", GITIGNORE)) written.push(".gitignore");
  if (seed(root, "config.json", JSON.stringify(config, null, 2) + "\n")) written.push("config.json");

  // The entry file: CLAUDE.md for Claude Code, AGENTS.md for everything else.
  const template = fs.readFileSync(asset("templates", "story-CLAUDE.md"), "utf8");
  if (seed(root, target.entryFile, renderEntry(template, { title, target }))) {
    written.push(target.entryFile);
  }
  // AGENTS.md is the cross-tool name for the same instructions: a symlink where the
  // filesystem allows it, a copy where it does not (Windows without symlink support).
  if (target.linkAgentsMd && !fs.existsSync(path.join(root, "AGENTS.md"))) {
    try {
      fs.symlinkSync(target.entryFile, path.join(root, "AGENTS.md"));
    } catch {
      fs.copyFileSync(path.join(root, target.entryFile), path.join(root, "AGENTS.md"));
    }
    written.push("AGENTS.md");
  }
  for (const [rel, content] of Object.entries(target.extraFiles || {})) {
    if (seed(root, rel, content)) written.push(rel);
  }
  return written;
}

/** Copy the packaged skills, specialists, schemas and decision records into the story. */
export function installEngine(root, target) {
  const counts = { subs: 0, dangling: [] };
  // Only the pipeline skills ship with the package; the per-model directors and provider
  // adapters come from the registry, so a local checkout with directors already installed
  // scaffolds exactly what a published tarball does.
  counts.skills = 0;
  for (const name of PIPELINE_SKILLS) {
    counts.skills += copyDir(asset(".claude", "skills", name), path.join(root, target.skillsDir, name), target, counts);
  }
  counts.agents = copyDir(asset(".claude", "agents"), path.join(root, target.agentsDir), target, counts);
  counts.commands = target.commandsDir
    ? copyDir(asset(".claude", "commands"), path.join(root, target.commandsDir), target, counts)
    : 0;
  counts.schema = copyDir(asset("schema"), path.join(root, "schema"), target, counts);
  counts.docs = copyDir(asset("docs", "adr"), path.join(root, "docs", "adr"), target, counts);
  for (const doc of ["spec.md", "storyseam.template.md", "specialist-contract.md", "seedance-2.5-research.md"]) {
    const src = asset("docs", doc);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.join(root, "docs"), { recursive: true });
      const [text, subs] = rewrite(fs.readFileSync(src, "utf8"), target);
      fs.writeFileSync(path.join(root, "docs", doc), text);
      counts.subs += subs;
      counts.docs++;
    }
  }
  return counts;
}
