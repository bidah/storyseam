// The registry client — the Node port of bin/storyseam_registry.py.
//
// One place knows: where the registry is, how to reach it, what an item looks like, and the
// rules for writing an item's files into a project.
//
// Env:
//   STORYSEAM_REGISTRY   registry base url, or a local directory holding a built registry
//                        (default: the registry bundled in this package, else the published one)
//   STORYSEAM_ROOT       project to install into / read config.json from (default: cwd)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { asset } from "./paths.js";
import { die } from "./util.js";
import { rewrite } from "./rewrite.js";

export const PUBLISHED_REGISTRY = "https://pub-597aecbeb0f64dee8c8894e4da9a211c.r2.dev/r";
const BUNDLED_REGISTRY = asset("registry", "r");

const defaultRegistry = () =>
  fs.existsSync(path.join(BUNDLED_REGISTRY, "index.json")) ? BUNDLED_REGISTRY : PUBLISHED_REGISTRY;

export const REG = (process.env.STORYSEAM_REGISTRY || defaultRegistry()).replace(/\/+$/, "");
export const IS_LOCAL = !REG.includes("://");

// Cloudflare's bot protection 403s a bare fetch User-Agent, so the registry is unreachable
// without a real one. This is not optional.
const UA = "storyseam-registry/1";

// The only prefix a registry item may write under. Which one depends on the agent target:
// Claude Code reads .claude/skills/, every other target reads .storyseam/skills/.
export const CLAUDE_PREFIX = ".claude/skills/";
export const PORTABLE_PREFIX = ".storyseam/skills/";

/** Map a catalogue route to a file under the local registry directory. Routes are absolute
 *  URLs built for wherever the registry was published, so resolve them by their tail:
 *  `.../skills/<name>.json` -> <dir>/skills/<name>.json */
function localPath(pathOrUrl) {
  const parts = pathOrUrl.split("://").pop().split("/").filter(Boolean);
  const tail =
    parts.length >= 2 && ["skills", "providers"].includes(parts[parts.length - 2])
      ? parts.slice(-2)
      : parts.slice(-1);
  return path.join(REG, ...tail);
}

/** GET a JSON document. `pathOrUrl` is absolute, or relative to the registry base.
 *  With a local registry directory it is read from disk instead. */
export async function fetchJson(pathOrUrl) {
  if (IS_LOCAL) {
    const f = localPath(pathOrUrl);
    let text;
    try {
      text = fs.readFileSync(f, "utf8");
    } catch {
      die(`registry: ${f} not found — set STORYSEAM_REGISTRY to a URL, or reinstall the package`);
    }
    try {
      return JSON.parse(text);
    } catch {
      die(`registry: ${f} is not valid JSON`);
    }
  }
  const url = pathOrUrl.includes("://") ? pathOrUrl : `${REG}/${pathOrUrl.replace(/^\/+/, "")}`;
  let res;
  try {
    res = await fetch(url, { headers: { "User-Agent": UA } });
  } catch (e) {
    die(`registry: cannot reach ${url} (${e.message})`);
  }
  if (!res.ok) die(`registry: ${res.status} fetching ${url}`);
  try {
    return await res.json();
  } catch {
    die(`registry: ${url} did not return JSON`);
  }
}

/** Fetch one item and write its files into `root`. Verifies the item's sha256 against its
 *  skill content and refuses any destination outside the target's skills prefix. */
export async function install(url, { root, prefix = CLAUDE_PREFIX, target = null, quiet = false } = {}) {
  const item = await fetchJson(url);
  const files = item.files || [];
  if (!files.length) die(`registry: ${item.name || url} carries no files`);

  const skill = files.find((f) => f.type === "skill") || files[0];
  const digest = crypto.createHash("sha256").update(skill.content).digest("hex").slice(0, 16);
  if (item.sha256 && digest !== item.sha256) {
    die(
      `registry: ${item.name} content hash ${digest} != published ${item.sha256} — ` +
        "the item was altered in transit or the registry is inconsistent; not installing"
    );
  }

  const resolvedRoot = path.resolve(root);
  for (const f of files) {
    // Items are published against .claude/skills/; a non-Claude target rehomes them.
    const rel = f.path.startsWith(CLAUDE_PREFIX)
      ? prefix + f.path.slice(CLAUDE_PREFIX.length)
      : f.path;
    if (!rel.startsWith(prefix) || rel.split("/").includes("..")) {
      die(`registry: ${item.name} wants to write ${JSON.stringify(rel)} — only ${prefix} is allowed`);
    }
    const dest = path.resolve(resolvedRoot, rel);
    if (!dest.startsWith(resolvedRoot + path.sep)) {
      die(`registry: ${item.name} wants to write outside ${resolvedRoot}`);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // A director's prose names the same tools the pipeline skills do; rehome it identically.
    const content = target && /\.(md|json)$/.test(rel) ? rewrite(f.content, target)[0] : f.content;
    fs.writeFileSync(dest, content);
    if (!quiet) console.log("  wrote " + rel);
  }

  const models = Array.isArray(item.models) ? item.models : Object.keys(item.models || {});
  if (!quiet) {
    console.log(
      `installed ${item.name} (models ${models.join("/") || "—"}, updated ${item.updated || "?"}, sha ${item.sha256 || "?"})`
    );
  }
  return item;
}

/** Read the story's config.json, or exit with a message that says what to do. */
export function loadConfig(root) {
  const cfg = path.join(root, "config.json");
  if (!fs.existsSync(cfg)) {
    die(`no config.json at ${root} — run from a story folder, or pass one: storyseam check <folder>`);
  }
  try {
    return JSON.parse(fs.readFileSync(cfg, "utf8"));
  } catch (e) {
    die(`${cfg} is not valid JSON (${e.message})`);
  }
}

/** Every item the story's config.json implies: the two model directors and the providers. */
export async function itemsForConfig(config) {
  const models = (await fetchJson("models.json")).models;
  const index = Object.fromEntries((await fetchJson("index.json")).items.map((i) => [i.name, i]));
  const urls = [];
  const videoIds = [...(Array.isArray(config?.video?.models) ? config.video.models : []), config?.video?.model];
  for (const id of [...new Set([...videoIds, config?.image?.model].filter(Boolean))]) {
    if (!models[id]) die(`config.json names model ${JSON.stringify(id)}, which the registry does not know`);
    urls.push(models[id].routes[models[id].default]);
  }
  for (const p of Object.values(config?.providers || {})) {
    const name = `provider-${p.id}`;
    if (!index[name]) die(`config.json names provider ${JSON.stringify(p.id)}, which the registry does not know`);
    urls.push(index[name].url);
  }
  return [...new Set(urls)];
}
