#!/usr/bin/env node
// storyseam — scaffold a film folder any coding agent can pick up, and keep its
// per-model skills current. The pipeline itself is prose the agent reads; this CLI only
// puts the right files in the places that agent looks.
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { PKG_ROOT, asset, pkgVersion, storyRoot } from "../src/paths.js";
import { select, input, confirm } from "../src/prompt.js";
import { TARGETS, targetChoices } from "../src/targets.js";
import { defaultConfig, scaffold, installEngine, PIPELINE_SKILLS } from "../src/scaffold.js";
import { REG, IS_LOCAL, fetchJson, install, loadConfig, itemsForConfig } from "../src/registry.js";
import { checkStory } from "../src/check.js";
import { runRecommend } from "../src/recommend.js";
import { runAssets } from "../src/assets.js";
import { runPreview } from "../src/shot-preview.js";
import { runPresetAdd, runPresetList, runPresetPage } from "../src/presets.js";
import { KNOWN_SERVERS, defaultServers, printInstall } from "../src/mcp.js";
import { checkProviders } from "../src/providers.js";
import { auditAssets } from "../src/audit.js";
import { voiceToBlackframe, lastFrame } from "../src/ffmpeg.js";
import { die } from "../src/util.js";

/** A path the reader can actually paste: relative when it is short, absolute otherwise. */
const show = (p) => {
  const rel = path.relative(process.cwd(), p);
  return !rel ? "this folder" : rel.startsWith("..") ? p : rel;
};

const program = new Command();

/** Which agent layout a folder already uses. An existing story is never re-homed silently. */
function detectTarget(root) {
  if (fs.existsSync(path.join(root, ".claude", "skills"))) return TARGETS.claude;
  if (fs.existsSync(path.join(root, ".cursor"))) return TARGETS.cursor;
  if (fs.existsSync(path.join(root, ".storyseam", "skills"))) return TARGETS.codex;
  return TARGETS.claude;
}

program
  .name("storyseam")
  .description("A storytelling engine. An idea goes in; a finished film comes out.")
  .version(pkgVersion());

program
  .command("init", { isDefault: true })
  .description("scaffold a story folder and install the skills for your agent")
  .argument("[folder]", "where to create it", ".")
  .option("-t, --title <title>", "working title")
  .option("-a, --agent <id>", `agent target: ${Object.keys(TARGETS).join(" | ")}`)
  .option("--aspect <ratio>", "16:9 (cinematic) or 9:16 (vertical)", "16:9")
  .option("--seconds <n>", "target runtime in seconds; blocks = ceil(seconds / 30)", "120")
  .option("--provider <id>", "higgsfield | atlas | fal", "higgsfield")
  .option("--editor <id>", "editing program: none (the agent edits with ffmpeg) | davinci_resolve | premiere_pro | final_cut_pro | capcut | any name", "none")
  .option("--editor-mcp", "the editing program's MCP server is installed and connected")
  .option("--no-computer-use", "the agent may not drive the screen while editing")
  .option("--mcp <names>", `extra MCP servers the story uses, comma-separated (known: ${Object.keys(KNOWN_SERVERS).join(", ")})`)
  .option("--video <ids>", "video model(s), comma-separated; several = your agent asks which to use", "seedance_2_5")
  .option("-y, --yes", "accept every default, ask nothing")
  .action(async (folder, opts) => {
    const root = path.resolve(folder);
    if ((fs.existsSync(path.join(root, "storyseam.md")) || fs.existsSync(path.join(root, "STORY.md"))) && fs.existsSync(path.join(root, "config.json"))) {
      const cfg = loadConfig(root);
      console.log(`${root} is already a story: "${cfg.title}".`);
      console.log("init never overwrites a live story. Scaffold a new one in a subfolder instead:");
      console.log(`  npx storyseam init ${path.basename(root)}/second-film`);
      process.exit(1);
    }

    const title = opts.title || (opts.yes ? path.basename(root) : await input("Title", path.basename(root)));
    const agentId =
      opts.agent || (opts.yes ? "claude" : await select("Which agent will you write this film with?", targetChoices(), "claude"));
    const target = TARGETS[agentId];
    if (!target) die(`unknown agent ${JSON.stringify(agentId)} — one of: ${Object.keys(TARGETS).join(", ")}`);

    const seconds = Number.parseInt(opts.seconds, 10);
    if (!Number.isInteger(seconds) || seconds < 1) die(`--seconds must be a positive integer, got ${opts.seconds}`);
    if (!["16:9", "9:16"].includes(opts.aspect)) die(`--aspect must be 16:9 or 9:16, got ${opts.aspect}`);

    const blocks = Math.ceil(seconds / 30);
    const videoModels = [...new Set(String(opts.video).split(",").map((s) => s.trim()).filter(Boolean))];
    if (!videoModels.length) die("--video needs at least one model id");
    const editorId = String(opts.editor || "none").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const editor =
      editorId === "none"
        ? { id: "none" }
        : { id: editorId, mcp: Boolean(opts.editorMcp), computer_use: opts.computerUse !== false };
    const config = defaultConfig({ title, aspect: opts.aspect, seconds, provider: opts.provider, videoModels, editor });
    // Which MCP servers this story uses, with how to install each (docs/spec.md §10).
    config.mcp_servers = defaultServers(config);
    for (const name of String(opts.mcp || "").split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!KNOWN_SERVERS[name]) die(`unknown MCP server ${JSON.stringify(name)}; known: ${Object.keys(KNOWN_SERVERS).join(", ")}. Add others to config.json mcp_servers by hand.`);
      config.mcp_servers[name] ??= { used_for: ["other"], required: false, ...KNOWN_SERVERS[name] };
    }

    console.log(
      `\n${title} — ${seconds}s → ${blocks} block${blocks === 1 ? "" : "s"} ` +
        `≈ ${blocks * config.costs.block_30s} credits at 480p (a floor), ${opts.aspect}, ` +
        `${opts.provider}, for ${target.label}.`
    );
    if (!opts.yes && !(await confirm("Scaffold it?", true))) return;

    const written = scaffold(root, { title, target, config });
    const counts = installEngine(root, target);

    console.log(`\nengine installed into ${show(root)}`);
    console.log(`  ${counts.skills} pipeline skill files -> ${target.skillsDir}/`);
    console.log(`  ${counts.agents} specialists          -> ${target.agentsDir}/`);
    if (counts.commands) console.log(`  ${counts.commands} slash commands       -> ${target.commandsDir}/`);
    console.log(`  ${counts.schema} schemas, ${counts.docs} decision records`);
    console.log(`  ${counts.subs} path references rewritten for this folder (bin/ -> npx storyseam${target.commandsDir ? "" : ", .claude/ -> .storyseam/"})`);
    if (counts.dangling.length) {
      console.error("\nrefs this scaffold could not rehome — the story would point at files it does not have:");
      for (const d of counts.dangling) console.error(`  ${d}`);
      process.exit(1);
    }

    console.log(`\nresolving the skills config.json asks for (registry: ${IS_LOCAL ? "bundled" : REG})`);
    for (const url of await itemsForConfig(config)) {
      await install(url, { root, prefix: target.skillsPrefix, target });
    }

    console.log(`\nwrote ${written.join(", ")}`);
    console.log(
      editor.id === "none"
        ? `\nediting: none. /edit cuts the film itself with ffmpeg.`
        : `\nediting: ${editor.id} (MCP ${editor.mcp ? "installed" : "not installed"}, computer use ${editor.computer_use ? "allowed" : "off"}). /edit cuts it in that program.`
    );
    if (Object.keys(config.mcp_servers).length) {
      console.log(`\nMCP servers this story uses (install with \`npx storyseam mcp\`):`);
      for (const [n, s] of Object.entries(config.mcp_servers)) console.log(`  ${n}${s.required ? " (required)" : ""}: ${s.used_for.join(", ")}`);
    }
    if (videoModels.length > 1) {
      console.log(`\nconfig.json lists ${videoModels.length} video models (${videoModels.join(", ")}); a director is installed for each.`);
      console.log(`video.model is unset on purpose: your agent asks you which to use, then writes it.`);
    }
    console.log(`\nVideo is ${config.video.model || videoModels.join(" or ")} at 480p and stills are gpt_image_2 at 2k — engine rules, not defaults.`);
    console.log(`\nNext: open ${target.label} in ${show(root)} and run`);
    console.log(
      target.commandsDir
        ? "  /start-story      (it interviews you for the premise, then writes storyseam.md)"
        : `  read ${target.skillsDir}/start-story/SKILL.md and follow it`
    );
  });

program
  .command("add")
  .description("install a skill from the registry by model id or by name")
  .argument("[items...]", "model id (installs its default), skill name, or provider-<id>")
  .option("-C, --root <folder>", "story folder to install into")
  .option("--model <id>", "install skills compatible with this model id")
  .option("--all", "with --model: every skill for it, not just the default")
  .action(async (items, opts) => {
    const root = storyRoot(opts.root);
    const target = detectTarget(root);
    const models = (await fetchJson("models.json")).models;
    const index = Object.fromEntries((await fetchJson("index.json")).items.map((i) => [i.name, i]));
    if (opts.model) {
      const e = models[opts.model];
      if (!e) die(`unknown model ${JSON.stringify(opts.model)}. known: ${Object.keys(models).sort().join(", ")}`);
      for (const n of opts.all ? e.skills : [e.default]) {
        await install(e.routes[n], { root, prefix: target.skillsPrefix, target });
      }
      return;
    }
    if (!items.length) die("nothing to add — name a model id or a skill, or use --model <id>");
    for (const key of items) {
      if (models[key]) {
        console.log(`resolving model ${key} -> default ${models[key].default}`);
        await install(models[key].routes[models[key].default], { root, prefix: target.skillsPrefix, target });
      } else if (index[key]) {
        console.log(`resolving ${index[key].type} ${key}`);
        await install(index[key].url, { root, prefix: target.skillsPrefix, target });
      } else {
        die(
          `unknown model or skill ${JSON.stringify(key)}.\n  models: ${Object.keys(models).sort().join(", ")}\n` +
            `  items: ${Object.keys(index).sort().join(", ")}`
        );
      }
    }
  });

program
  .command("update")
  .description("reinstall the skills this story's config.json asks for, from the registry")
  .option("-C, --root <folder>", "story folder")
  .option("--all", "every item in the registry, not just what config.json names")
  .action(async (opts) => {
    const root = storyRoot(opts.root);
    const target = detectTarget(root);
    console.log(`registry: ${REG}${IS_LOCAL ? "  (bundled with this package)" : ""}`);
    console.log(`installing into ${root} (${target.label} layout)\n`);
    const urls = opts.all
      ? (await fetchJson("index.json")).items.map((i) => i.url)
      : await itemsForConfig(loadConfig(root));
    for (const url of urls) await install(url, { root, prefix: target.skillsPrefix, target });
  });

program
  .command("list")
  .description("the registry catalogue, grouped by model")
  .action(async () => {
    const idx = await fetchJson("index.json");
    const mods = (await fetchJson("models.json")).models;
    const provs = (await fetchJson("providers.json")).providers;
    console.log(`${idx.name} v${idx.version}  updated ${idx.updated}`);
    console.log(`  ${REG}${IS_LOCAL ? "  (bundled)" : ""}\n`);
    const byName = Object.fromEntries(idx.items.map((i) => [i.name, i]));
    for (const [model, e] of Object.entries(mods)) {
      console.log(`${model}  (served by ${(e.providers || []).join(", ") || "nobody"})`);
      for (const n of e.skills) {
        console.log(`  ${n === e.default ? "default " : "alt     "} ${n}`);
        console.log(`           ${byName[n].description}`);
      }
      console.log();
    }
    console.log("providers");
    for (const p of Object.values(provs)) {
      const models = (Array.isArray(p.models) ? p.models : Object.keys(p.models || {})).sort();
      console.log(`  ${p.name.padEnd(24)} ${p.title}  access=${p.access.join("/")}  serves=${models.join(", ")}`);
    }
  });

program
  .command("mcp")
  .description("the MCP servers this story uses, and the command that installs each")
  .argument("[folder]", "story folder")
  .option("-a, --agent <id>", "only the commands for one agent: claude | codex | cursor")
  .action((folder, opts) => printInstall(loadConfig(storyRoot(folder)), opts.agent));

program
  .command("assets")
  .description("write shotlist/assets.json: every sheet and plate the film needs, and how each is made")
  .argument("[folder]", "story folder")
  .option("--json", "print the sheet as JSON")
  .action((folder, opts) => process.exit(runAssets(storyRoot(folder), opts) ? 0 : 1));

program
  .command("preview")
  .description("write the HTML previewer for a block before it is sent: prompt, references, model, cost")
  .argument("[block]", "block id or number, or \"all\"", "all")
  .argument("[folder]", "story folder")
  .option("--open", "open the page in the browser")
  .option("--force", "write it even when config.json shot_preview.enabled is false")
  .action((block, folder, opts) => process.exit(runPreview(storyRoot(folder), block, opts) ? 0 : 1));

const preset = program.command("preset").description("prompt presets: shareable pre-prompts (camera, audio, ...) every video prompt carries");
preset
  .command("list")
  .description("the preset catalogue, by section")
  .argument("[section]", "only one section, e.g. camera")
  .option("--json", "print it as JSON")
  .action((section, opts) => process.exit(runPresetList(section, opts) ? 0 : 1));
preset
  .command("add")
  .description("install a preset into config.json presets.<section>: <section>/<id>, a URL, or a .json file")
  .argument("<preset>", "e.g. camera/s16-handheld or https://storyseam.app/spec/presets/camera/s16-handheld.json")
  .argument("[folder]", "story folder")
  .action(async (spec, folder) => process.exit((await runPresetAdd(storyRoot(folder), spec)) ? 0 : 1));
preset
  .command("page")
  .description("write shotlist/previews/presets.html: every preset, and the ones in use")
  .argument("[section]", "only one section")
  .argument("[folder]", "story folder")
  .option("--open", "open the page in the browser")
  .action((section, folder, opts) => process.exit(runPresetPage(storyRoot(folder), section, opts) ? 0 : 1));

program
  .command("camera")
  .description("the camera presets page (preset page camera); --set <id> installs one")
  .argument("[folder]", "story folder")
  .option("--set <id>", "install camera/<id>")
  .option("--open", "open the page in the browser")
  .action(async (folder, opts) => {
    const root = storyRoot(folder);
    if (opts.set) await runPresetAdd(root, `camera/${opts.set}`);
    process.exit(runPresetPage(root, "camera", opts) ? 0 : 1);
  });

program
  .command("recommend")
  .description("which video model each block should render on, from its length and reference count")
  .argument("[folder]", "story folder")
  .option("--all", "compare every video model in the registry, not just config.json video.models")
  .option("--json", "machine-readable output")
  .action(async (folder, opts) => process.exit((await runRecommend(storyRoot(folder), opts)) ? 0 : 1));

program
  .command("check")
  .description("validate the story's machine-read files against the schemas")
  .argument("[folder]", "story folder")
  .action((folder) => process.exit(checkStory(storyRoot(folder)) ? 0 : 1));

program
  .command("audit")
  .description("every reference the shot list cites, against what is on disk and uploaded — free, run before /render")
  .argument("[folder]", "story folder")
  .action((folder) => process.exit(auditAssets(storyRoot(folder)) ? 0 : 1));

program
  .command("providers")
  .description("is the backend named in config.json reachable?")
  .argument("[ids...]", "provider ids to check instead of the ones config.json names")
  .option("-C, --root <folder>", "story folder")
  .option("--all", "every provider in the registry")
  .action(async (ids, opts) => {
    const ok = await checkProviders(storyRoot(opts.root), { ids, all: opts.all });
    process.exit(ok ? 0 : 1);
  });

program
  .command("voice")
  .description("mux a cast voice take into the black-frame mp4 Seedance accepts")
  .argument("<slug>", "character slug, matching world/characters.md")
  .option("-C, --root <folder>", "story folder")
  .action((slug, opts) => voiceToBlackframe(slug, storyRoot(opts.root)));

program
  .command("last-frame")
  .description("extract a block's final frame — the anchor the next block chains from")
  .argument("<clip>", "path to renders/clips/block_NN.mp4")
  .argument("[out]", "output jpg (default: ../frames/block_NN_last.jpg)")
  .action((clip, out) => lastFrame(path.resolve(clip), out && path.resolve(out)));

program.parseAsync().catch((e) => die(e.stack || String(e)));
