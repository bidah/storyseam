// `storyseam recommend` — which video model each block of the shot list should
// render on, from what the block needs (its length and how many reference
// images, videos and audio files it cites) against what each model accepts
// (the registry's `constraints.duration_seconds` and `reference_ceiling`).
// The rule is written down in docs/spec.md §9; this is its only implementation.
//
// It recommends. It never writes: the author decides, and the agent records the
// decision as the block's `model` in shotlist.json.
import fs from "node:fs";
import path from "node:path";
import { fetchJson } from "./registry.js";
import { die } from "./util.js";

const IMAGE_KINDS = new Set(["anchor", "character", "location", "prop"]);
const VIDEO_KINDS = new Set(["voice", "video"]);

/** What one block asks of a model. */
export function blockNeeds(block, config) {
  let images, videos, audio;
  if (Array.isArray(block.references) && block.references.length) {
    images = block.references.filter((r) => IMAGE_KINDS.has(r.kind)).length;
    videos = block.references.filter((r) => VIDEO_KINDS.has(r.kind)).length;
    audio = block.references.filter((r) => r.kind === "audio").length;
  } else {
    // A shot list from before `references`: count what it cites.
    images =
      (block.start_from_previous_last_frame ? 1 : 0) +
      (block.characters || []).length +
      (block.location ? 1 : 0) +
      (block.props || []).length;
    // On a black-frame provider a voice is a video reference; on Atlas it is audio.
    const voicesAsAudio = config?.audio?.voice_ref_format && config.audio.voice_ref_format !== "blackframe_mp4";
    const voices = (block.voices || []).length;
    videos = (voicesAsAudio ? 0 : voices) + (block.video_refs || []).length;
    audio = voicesAsAudio ? voices : 0;
  }
  return { dur: Number(block.dur) || 0, images, videos, audio, chained: Boolean(block.start_from_previous_last_frame) };
}

/** Does a model accept the block? Returns the reasons it does not. */
export function misfits(needs, c = {}) {
  const out = [];
  const [lo, hi] = c.duration_seconds || [0, Infinity];
  if (needs.dur < lo || needs.dur > hi) out.push(`${needs.dur}s is outside ${lo}-${hi}s`);
  const ceil = c.reference_ceiling || {};
  if (ceil.images != null && needs.images > ceil.images) out.push(`${needs.images} images > ${ceil.images}`);
  if (ceil.videos != null && needs.videos > ceil.videos) out.push(`${needs.videos} videos > ${ceil.videos}`);
  if (ceil.audio != null && needs.audio > ceil.audio) out.push(`${needs.audio} audio > ${ceil.audio}`);
  return out;
}

/**
 * The rule (docs/spec.md §9), in order:
 *  1. only models that accept the block's length and reference counts;
 *  2. a chained block prefers a model with a real `start_image` role, because
 *     its seam is then frame-exact rather than declared in prose;
 *  3. otherwise the story's chosen `video.model`;
 *  4. otherwise the candidate with the most headroom (the longest clip, then the
 *     most image references), so the block is furthest from a refusal.
 */
export function recommend(needs, candidates, chosen) {
  const fit = candidates.filter((m) => !misfits(needs, m.constraints).length);
  if (!fit.length) return { model: null, reason: "no candidate accepts it: split the block or drop references" };
  if (fit.length === 1) {
    const only = fit[0].id;
    return { model: only, reason: candidates.length > 1 ? "the only candidate that fits" : "fits" };
  }
  if (needs.chained) {
    const exact = fit.find((m) => m.constraints?.start_image_supported);
    if (exact) return { model: exact.id, reason: "short and chained: a real start_image makes the seam frame-exact" };
  }
  if (chosen && fit.some((m) => m.id === chosen)) return { model: chosen, reason: "fits; the story's video.model" };
  const room = (m) => [(m.constraints?.duration_seconds || [0, 0])[1], m.constraints?.reference_ceiling?.images ?? 0];
  const best = [...fit].sort((a, b) => {
    const [ad, ai] = room(a);
    const [bd, bi] = room(b);
    return bd - ad || bi - ai;
  })[0];
  return { model: best.id, reason: "fits with the most headroom" };
}

/** The video models the registry describes, with their constraints. */
async function videoModels() {
  const index = (await fetchJson("index.json")).items;
  const models = (await fetchJson("models.json")).models;
  const out = {};
  for (const [id, m] of Object.entries(models)) {
    const item = index.find((i) => i.name === m.default);
    if (item?.kind === "video") out[id] = { id, constraints: item.constraints || {} };
  }
  return out;
}

export async function runRecommend(root, { all = false, json = false } = {}) {
  const cfgPath = path.join(root, "config.json");
  const slPath = path.join(root, "shotlist", "shotlist.json");
  if (!fs.existsSync(cfgPath)) die(`no config.json in ${root}: is this a story folder?`);
  if (!fs.existsSync(slPath)) die("no shotlist/shotlist.json yet: run /shotlist first");
  const config = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const shotlist = JSON.parse(fs.readFileSync(slPath, "utf8"));

  const known = await videoModels();
  const listed = Array.isArray(config.video?.models) && config.video.models.length
    ? config.video.models
    : [config.video?.model].filter(Boolean);
  const ids = all ? Object.keys(known) : listed;
  const candidates = ids.map((id) => known[id] || die(`the registry does not know video model ${JSON.stringify(id)}`));

  const rows = shotlist.blocks.map((b) => {
    const needs = blockNeeds(b, config);
    const rec = recommend(needs, candidates, config.video?.model);
    const why = Object.fromEntries(candidates.map((m) => [m.id, misfits(needs, m.constraints)]));
    return { id: b.id, ...needs, current: b.model || config.video?.model || null, ...rec, misfits: why };
  });

  if (json) {
    console.log(JSON.stringify({ candidates: ids, blocks: rows }, null, 2));
  } else {
    console.log(`candidates: ${ids.join(", ")}${all ? " (every video model in the registry)" : ""}\n`);
    for (const r of rows) {
      const counts = `${r.dur}s, ${r.images} img / ${r.videos} vid / ${r.audio} aud`;
      const change = r.model && r.current && r.model !== r.current ? `  (now ${r.current})` : "";
      console.log(`${r.id}  ${counts.padEnd(30)} -> ${r.model || "NONE"}${change}: ${r.reason}`);
      for (const [id, why] of Object.entries(r.misfits)) if (why.length) console.log(`           ${id} refuses it: ${why.join("; ")}`);
    }
    const models = new Set(rows.map((r) => r.model).filter(Boolean));
    if (models.size > 1) {
      console.log("\nThe blocks want different models. One model for the whole film keeps the look consistent;");
      console.log("mix only where a block does not fit the story's model, and ask the author first.");
    }
  }
  return rows.every((r) => r.model);
}
