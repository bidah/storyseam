// Reference tags — docs/spec.md §16.
//
// A block's prompt names its references the way a coding harness names files:
//   @assets/images/characters/theo.png walks in from @assets/images/locations/hall.png
//   @anchor                    the previous block's last frame (a chained block)
// Readable, unambiguous, and checkable against the disk. A video model wants
// something else: Seedance numbers each kind from 1 in the order the files are
// passed (@Image1, @Video1, @Audio1); MiniMax H3 says "Image 1". So the prompt
// is COMPILED before it is sent: every path tag becomes the model's tag, the
// reference list is ordered to match, and a reference legend ("@Image1 is
// Theo's identity and costume reference.") opens the prompt so every tag has
// a role. The shot preview and /render both use this, so what the author
// approves is what is sent.
//
// A prompt with no path tags (a shot list written before this) passes through
// untouched, with its own hand-numbered @Image N mentions.
import fs from "node:fs";
import path from "node:path";

const IMG = /\.(png|jpe?g|webp)$/i;
const VID = /\.(mp4|mov|webm)$/i;
const AUD = /\.(mp3|wav|m4a|ogg)$/i;
// `@assets/...` or `@renders/...` up to whitespace or closing punctuation, or `@anchor`.
export const TAG_RE = /@((?:assets|renders)\/[^\s,;:)\]"'`]+\.(?:png|jpe?g|webp|mp4|mov|webm|mp3|wav|m4a|ogg))|@anchor\b/gi;

/** How each model cites references. `config.video.reference_tags` overrides it. */
export const MODEL_TAGS = {
  seedance_2_5: { image: "@Image{n}", video: "@Video{n}", audio: "@Audio{n}", numbering: "per_kind" },
  seedance_2_0: { image: "@Image{n}", video: "@Video{n}", audio: "@Audio{n}", numbering: "per_kind" },
  minimax_h3: { image: "Image {n}", video: "Video {n}", audio: "Audio {n}", numbering: "per_kind" },
};
const FALLBACK = MODEL_TAGS.seedance_2_5;

export function tagFormat(config, model) {
  return { legend: true, ...(MODEL_TAGS[model] || FALLBACK), ...(config?.video?.reference_tags || {}) };
}

/** What a model sees a file as: an image, a video (a black-frame voice is a video), or audio. */
export function mediaKind(p) {
  if (IMG.test(p)) return "image";
  if (VID.test(p)) return "video";
  if (AUD.test(p)) return "audio";
  return "image";
}

function refKind(p) {
  if (/^renders\/frames\//.test(p)) return "anchor";
  if (/^assets\/images\/characters\//.test(p)) return "character";
  if (/^assets\/images\/locations\//.test(p)) return "location";
  if (/^assets\/images\/props\//.test(p)) return "prop";
  if (/^assets\/audio\/voices\//.test(p)) return VID.test(p) ? "voice" : "audio";
  if (/^assets\/video_refs\//.test(p)) return "video";
  return mediaKind(p);
}

const titleCase = (s) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const labelOf = (p) => titleCase(path.basename(p).replace(/\.[^.]+$/, ""));

/** The tags a prompt uses, in order of first appearance (`anchor` for @anchor). */
export function pathTags(prompt) {
  const seen = [];
  for (const m of String(prompt || "").matchAll(TAG_RE)) {
    const key = m[1] || "anchor";
    if (!seen.includes(key)) seen.push(key);
  }
  return seen;
}

function role(ref, tag) {
  const l = ref.label || labelOf(ref.path);
  switch (ref.kind) {
    case "anchor":
      return `${tag} is the first frame: the last frame of the previous block. Open on it exactly and continue from it.`;
    case "character":
      return `${tag} is ${l}'s identity and costume reference.`;
    case "location":
      return `${tag} is the ${l} environment reference.`;
    case "prop":
      return `${tag} is the ${l} prop reference.`;
    case "voice":
    case "audio":
      return `${tag} defines ${l.replace(/ \(voice\)$/i, "")}'s voice: timbre, accent and delivery only.`;
    case "video":
      return `${tag} is a motion and camera reference only.`;
    default:
      return `${tag} is a reference for ${l}.`;
  }
}

/**
 * Compile one block's prompt. Returns { prompt, refs, tagged, problems }:
 * `refs` is the ordered list to pass (each with its `tag`), `tagged` whether the
 * prompt used path tags at all.
 */
export function compileBlock(block, blocks, config) {
  const raw = String(block.prompt || "");
  const tags = pathTags(raw);
  const problems = [];
  const model = block.model || config?.video?.model || (config?.video?.models || [])[0];
  const fmt = tagFormat(config, model);
  const i = blocks.indexOf(block);
  const anchorPath = i > 0 ? `renders/frames/${blocks[i - 1].id}_last.jpg` : null;

  if (!tags.length) return { prompt: raw, refs: null, tagged: false, problems, format: fmt };

  // The order: the block's `references` when it has them (every tag must be in
  // it), else first appearance in the prompt, anchor always first.
  let refs;
  if (Array.isArray(block.references) && block.references.length) {
    refs = block.references.map((r) => ({ ...r }));
    for (const t of tags) {
      const p = t === "anchor" ? anchorPath : t;
      if (t === "anchor" && !block.start_from_previous_last_frame) problems.push(`${block.id}: prompt cites @anchor but the block is not chained`);
      else if (!refs.some((r) => r.path === p || (t === "anchor" && r.kind === "anchor"))) problems.push(`${block.id}: prompt tags @${t} but references does not list it`);
    }
  } else {
    const ordered = [...tags.filter((t) => t === "anchor"), ...tags.filter((t) => t !== "anchor")];
    refs = ordered.map((t) =>
      t === "anchor"
        ? { kind: "anchor", path: anchorPath || "renders/frames/(no previous block)", label: `last frame of ${blocks[i - 1]?.id || "?"}` }
        : { kind: refKind(t), path: t, label: labelOf(t) },
    );
    if (tags.includes("anchor") && !block.start_from_previous_last_frame) problems.push(`${block.id}: prompt cites @anchor but the block is not chained`);
  }
  if (block.start_from_previous_last_frame && !refs.some((r) => r.kind === "anchor")) {
    problems.push(`${block.id}: chained but the prompt never tags @anchor (the previous block's last frame)`);
  }
  for (const r of refs) {
    if (!/^(assets|renders)\//.test(r.path)) problems.push(`${block.id}: reference ${r.path} is outside assets/ and renders/`);
  }

  // Number them the model's way.
  const counters = { image: 0, video: 0, audio: 0 };
  let global = 0;
  for (const r of refs) {
    const k = r.kind === "anchor" ? "image" : r.kind === "voice" ? "video" : r.kind === "audio" ? "audio" : mediaKind(r.path);
    const n = fmt.numbering === "global" ? ++global : ++counters[k];
    r.media = k;
    r.tag = (fmt[k] || FALLBACK[k]).replace("{n}", String(n));
  }

  const byPath = new Map(refs.map((r) => [r.path, r.tag]));
  const anchorTag = refs.find((r) => r.kind === "anchor")?.tag;
  let prompt = raw.replace(TAG_RE, (m, p) => (p ? byPath.get(p) || m : anchorTag || m));
  if (fmt.legend !== false && !/^\s*reference plan:/im.test(prompt)) {
    prompt = `Reference plan: ${refs.map((r) => role(r, r.tag)).join(" ")}\n\n${prompt}`;
  }
  return { prompt, refs, tagged: true, problems, format: fmt };
}

/** Problems across the shot list. Mirrored in bin/story-check.py reftag_problems. */
export function reftagProblems(root, shotlist, config) {
  const blocks = shotlist?.blocks || [];
  const out = [];
  const rt = config?.video?.reference_tags;
  if (rt != null) {
    if (typeof rt !== "object") out.push("config.json video.reference_tags must be an object");
    else {
      for (const k of ["image", "video", "audio"]) if (rt[k] != null && !String(rt[k]).includes("{n}")) out.push(`config.json video.reference_tags.${k} must contain {n}`);
      if (rt.numbering != null && !["per_kind", "global"].includes(rt.numbering)) out.push('config.json video.reference_tags.numbering must be "per_kind" or "global"');
    }
  }
  for (const b of blocks) {
    const { problems, tagged } = compileBlock(b, blocks, config);
    if (!tagged) continue;
    out.push(...problems);
    if (/@(Image|Video|Audio)\s*\d+/.test(b.prompt || "")) out.push(`${b.id}: prompt mixes @path tags with hand-numbered @Image/@Video/@Audio; use one`);
  }
  return out;
}

export function runCompile(root, blockId, opts = {}) {
  const config = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
  const shotlist = JSON.parse(fs.readFileSync(path.join(root, "shotlist/shotlist.json"), "utf8"));
  const blocks = shotlist.blocks || [];
  const block = blocks.find((b) => b.id === blockId || String(blocks.indexOf(b) + 1) === String(blockId));
  if (!block) {
    console.error(`no block "${blockId}"`);
    return false;
  }
  const c = compileBlock(block, blocks, config);
  if (opts.json) console.log(JSON.stringify({ block: block.id, prompt: c.prompt, references: c.refs, problems: c.problems }, null, 2));
  else {
    if (c.refs) for (const r of c.refs) console.log(`${r.tag.padEnd(10)} ${r.kind.padEnd(10)} ${r.path}`);
    console.log(`\n${c.prompt}`);
    for (const p of c.problems) console.log(`BROKEN   ${p}`);
  }
  return c.problems.length === 0;
}
