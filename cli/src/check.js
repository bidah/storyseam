// Validate a story's machine-read files against schema/ — the Node port of bin/story-check.py.
//
// A small validator for the subset of JSON Schema the Storyseam schemas use (type, required,
// properties, additionalProperties, patternProperties, items, minItems, enum, minimum,
// maximum, minLength, pattern). It also runs the cross-file checks a schema cannot express:
// a `done` block must have its clip on disk, every path the media cache names must exist,
// and a block's `references` order must agree with the `@Image N` numbering in its prompt.
import fs from "node:fs";
import path from "node:path";
import { asset } from "./paths.js";
import { die } from "./util.js";
import { mcpProblems } from "./mcp.js";
import { assetSheetProblems } from "./assets.js";
import { beatProblems } from "./beats.js";
import { presetProblems } from "./presets.js";

const typeOf = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);

function isType(v, t) {
  if (t === "integer") return Number.isInteger(v) && typeof v !== "boolean";
  if (t === "number") return typeof v === "number" && !Number.isNaN(v);
  if (t === "object") return v !== null && typeof v === "object" && !Array.isArray(v);
  if (t === "array") return Array.isArray(v);
  if (t === "null") return v === null;
  return typeOf(v) === t;
}

/** Collect every violation as `path: message`. Returns the error list. */
export function validate(value, schema, at = "$", errors = []) {
  const t = schema.type;
  if (t !== undefined) {
    const allowed = Array.isArray(t) ? t : [t];
    if (!allowed.some((x) => isType(value, x))) {
      errors.push(`${at}: expected ${allowed.join("/")}, got ${typeOf(value)}`);
      return errors;
    }
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${at}: ${JSON.stringify(value)} not one of ${JSON.stringify(schema.enum)}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${at}: shorter than ${schema.minLength}`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${at}: ${JSON.stringify(value)} does not match /${schema.pattern}/`);
    }
  }
  if (typeof value === "number" && !Number.isNaN(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${at}: ${value} < minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${at}: ${value} > maximum ${schema.maximum}`);
    }
  }
  if (isType(value, "object")) {
    for (const k of schema.required || []) {
      if (!(k in value)) errors.push(`${at}: missing required '${k}'`);
    }
    const props = schema.properties || {};
    const pprops = schema.patternProperties || {};
    const extra = schema.additionalProperties === undefined ? true : schema.additionalProperties;
    for (const [k, v] of Object.entries(value)) {
      if (k in props) {
        validate(v, props[k], `${at}.${k}`, errors);
        continue;
      }
      const matched = Object.entries(pprops).filter(([pat]) => new RegExp(pat).test(k));
      if (matched.length) {
        for (const [, s] of matched) validate(v, s, `${at}.${k}`, errors);
      } else if (extra === false) {
        errors.push(`${at}: unexpected key '${k}'`);
      } else if (isType(extra, "object")) {
        validate(v, extra, `${at}.${k}`, errors);
      }
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${at}: fewer than ${schema.minItems} items`);
    }
    if (schema.items) value.forEach((v, i) => validate(v, schema.items, `${at}[${i}]`, errors));
  }
  return errors;
}

const loadJson = (p) => {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    die(`story-check: ${p} is not valid JSON (${e.message})`);
  }
};

// Prefer the story's own copy so a story stays checkable on its own terms; fall back to
// the schemas this CLI ships.
const schemaPath = (root, name) => {
  const local = path.join(root, "schema", name);
  return fs.existsSync(local) ? local : asset("schema", name);
};

function checkFile(root, rel, schemaName, required) {
  const data = loadJson(path.join(root, rel));
  if (data === null) {
    if (required) {
      console.log(`MISSING  ${rel}`);
      return false;
    }
    console.log(`absent   ${rel} (fine — not written yet)`);
    return true;
  }
  const schema = loadJson(schemaPath(root, schemaName));
  if (!schema) die(`story-check: schema ${schemaName} not found`);
  const errs = validate(data, schema);
  if (errs.length) {
    console.log(`INVALID  ${rel}`);
    for (const e of errs) console.log(`           ${e}`);
    return false;
  }
  console.log(`ok       ${rel}`);
  return true;
}

const IMAGE_KINDS = ["anchor", "character", "location", "prop"];

/** The prompt numbers @Image 1..K in the order of the block's image-kind references, the
 *  anchor frame first on a chained block. Only checked when a block carries `references`. */
function referenceContract(sl) {
  let ok = true;
  const blocks = sl.blocks || [];
  blocks.forEach((b, i) => {
    const refs = b.references;
    if (!Array.isArray(refs)) return;
    const bid = b.id || `#${i}`;
    const images = refs.filter((r) => IMAGE_KINDS.includes(r.kind));
    const chained = Boolean(b.start_from_previous_last_frame);
    const anchors = refs.map((r, j) => (r.kind === "anchor" ? j : -1)).filter((j) => j >= 0);
    if (chained) {
      const prev = i ? blocks[i - 1].id : null;
      const want = prev ? `renders/frames/${prev}_last.jpg` : null;
      if (anchors.length !== 1 || anchors[0] !== 0) {
        console.log(`BROKEN   ${bid}: chained, so references[0] must be the one anchor frame (found anchors at [${anchors}])`);
        ok = false;
      } else if (want && refs[0].path !== want) {
        console.log(`BROKEN   ${bid}: anchor path is ${refs[0].path}, expected ${want}`);
        ok = false;
      }
    } else if (anchors.length) {
      console.log(`BROKEN   ${bid}: not chained but carries an anchor reference`);
      ok = false;
    }
    const prompt = b.prompt || "";
    const mentioned = [...new Set([...prompt.matchAll(/@Image\s+(\d+)/g)].map((m) => Number(m[1])))].sort((a, z) => a - z);
    if (mentioned.length && mentioned[mentioned.length - 1] > images.length) {
      console.log(`BROKEN   ${bid}: prompt cites @Image ${mentioned[mentioned.length - 1]} but only ${images.length} image references are listed`);
      ok = false;
    }
    if (chained && images.length && !mentioned.includes(1)) {
      console.log(`BROKEN   ${bid}: chained but the prompt never declares @Image 1 (the anchor frame)`);
      ok = false;
    }
    const missing = [];
    for (let n = 1; n <= images.length; n++) if (!mentioned.includes(n)) missing.push(n);
    if (mentioned.length && missing.length) {
      console.log(`WARN     ${bid}: image references [${missing}] are listed but never cited in the prompt`);
    }
  });
  return ok;
}

/** What the schemas cannot say: the files the JSON points at must exist. */
function crossChecks(root) {
  let ok = true;
  const config = loadJson(path.join(root, "config.json")) || {};
  // mcp_servers: what the story needs connected, and how to install it (docs/spec.md §10).
  for (const p of mcpProblems(config)) {
    console.log(`BROKEN   ${p}`);
    ok = false;
  }
  // editor: where /edit cuts the film (docs/spec.md §8). Absent = none.
  if (config.editor !== undefined) {
    const e = config.editor;
    if (!e || typeof e !== "object" || typeof e.id !== "string" || !e.id) {
      console.log('BROKEN   config.json editor must be an object with an id ("none", "davinci_resolve", ...)');
      ok = false;
    } else if (e.id !== "none" && (typeof e.mcp !== "boolean" || typeof e.computer_use !== "boolean")) {
      console.log(`BROKEN   config.json editor ${e.id} needs mcp and computer_use set to true or false`);
      ok = false;
    }
  }
  // video.models is the candidate list, video.model the pick (docs/spec.md §7).
  const video = config.video || {};
  const candidates = Array.isArray(video.models) ? video.models : [];
  // A block's own `model` (docs/spec.md §9) must be a model the story offers.
  const allowed = candidates.length ? candidates : [video.model].filter(Boolean);
  for (const b of (loadJson(path.join(root, "shotlist/shotlist.json")) || {}).blocks || []) {
    if (b.model && !allowed.includes(b.model)) {
      console.log(`BROKEN   shotlist.json ${b.id} renders on ${b.model}, which is not in config.json video.models (${allowed.join(", ")})`);
      ok = false;
    }
  }
  if (!video.model && candidates.length > 1) {
    console.log(`UNCHOSEN config.json lists video models ${candidates.join(", ")} and video.model is unset — ask the author which to use`);
    ok = false;
  } else if (!video.model && !candidates.length) {
    console.log("BROKEN   config.json names no video model (video.model or video.models)");
    ok = false;
  } else if (video.model && candidates.length && !candidates.includes(video.model)) {
    console.log(`BROKEN   config.json video.model ${video.model} is not one of video.models (${candidates.join(", ")})`);
    ok = false;
  }
  const state = loadJson(path.join(root, ".storyseam/state.json")) || {};
  for (const [bid, b] of Object.entries(state.blocks || {})) {
    if (b.status === "done") {
      const clip = b.clip || `renders/clips/${bid}.mp4`;
      if (!fs.existsSync(path.join(root, clip))) {
        console.log(`BROKEN   state.json says ${bid} is done but ${clip} is not on disk`);
        ok = false;
      }
    }
  }
  const media = loadJson(path.join(root, ".storyseam/media.json")) || {};
  for (const p of Object.keys(media)) {
    if (!fs.existsSync(path.join(root, p))) {
      console.log(`BROKEN   media.json names ${p}, which is not on disk`);
      ok = false;
    }
  }
  const sl = loadJson(path.join(root, "shotlist/shotlist.json")) || {};
  const ids = (sl.blocks || []).map((b) => b.id);
  const expected = ids.map((_, i) => `block_${String(i + 1).padStart(2, "0")}`);
  if (ids.length && ids.join() !== expected.join()) {
    console.log(`BROKEN   shotlist block ids are [${ids}]; expected [${expected}] (contiguous, zero-padded, in order)`);
    ok = false;
  }
  for (const b of sl.blocks || []) {
    const extra = (b.voices || []).filter((v) => !(b.characters || []).includes(v));
    if (extra.length) {
      console.log(`BROKEN   ${b.id}: voices [${extra.sort()}] are not in the block's characters`);
      ok = false;
    }
  }
  return referenceContract(sl) && ok;
}

/** Returns true when the story is consistent. */
export function checkStory(root) {
  if (!fs.existsSync(path.join(root, "config.json"))) {
    die(`story-check: no config.json in ${root} — is this a story folder?`);
  }
  let ok = true;
  ok = checkFile(root, "shotlist/shotlist.json", "shotlist.schema.json", false) && ok;
  ok = checkFile(root, ".storyseam/state.json", "state.schema.json", true) && ok;
  // media.json exists only on upload-then-confirm providers (Higgsfield); URL providers have none
  ok = checkFile(root, ".storyseam/media.json", "media.schema.json", false) && ok;
  ok = checkFile(root, "script/reviews.json", "reviews.schema.json", false) && ok;
  ok = checkFile(root, "shotlist/assets.json", "assets.schema.json", false) && ok;
  const storyConfig = loadJson(path.join(root, "config.json")) || {};
  for (const p of presetProblems(storyConfig)) {
    console.log(`BROKEN   ${p}`);
    ok = false;
  }
  if (storyConfig.shot_preview != null && typeof storyConfig.shot_preview?.enabled !== "boolean") {
    console.log("BROKEN   config.json shot_preview must be { \"enabled\": true | false }");
    ok = false;
  }
  for (const p of beatProblems(root, (loadJson(path.join(root, "shotlist/shotlist.json")) || {}).blocks || [])) {
    console.log(`BROKEN   ${p}`);
    ok = false;
  }
  for (const p of assetSheetProblems(root)) {
    console.log(`BROKEN   ${p}`);
    ok = false;
  }
  ok = crossChecks(root) && ok;
  console.log(ok ? "story is consistent" : "story has problems — fix them before spending credits");
  return ok;
}
