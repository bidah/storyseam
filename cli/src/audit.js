// Audit every reference shotlist.json cites against what is on disk and what is uploaded.
// The Node port of bin/asset-audit.sh. Free. Run it before /render, always.
import fs from "node:fs";
import path from "node:path";
import { die } from "./util.js";

const slug = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const pad = (s, n) => String(s).padEnd(n);
const num = (n) => String(Number(n.toFixed(4)));

function load(root, rel, { required = false, fallback = null } = {}) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) {
    if (required) die(`asset-audit: ${rel} not found`);
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (e) {
    die(`asset-audit: ${rel} is not valid JSON (${e.message}) — fix it before spending anything`);
  }
}

/** Returns true when every reference is present, registered and fresh. */
export function auditAssets(root) {
  if (!fs.existsSync(path.join(root, "shotlist/shotlist.json"))) {
    die(`asset-audit: no shotlist/shotlist.json in ${root} — run /shotlist first`);
  }
  const sl = load(root, "shotlist/shotlist.json", { required: true });
  const cache = load(root, ".storyseam/media.json", { fallback: {} }) || {};
  const cfg = load(root, "config.json", { fallback: {} }) || {};
  const blockSeconds = Number.parseInt(cfg.block_seconds ?? 30, 10);
  const costs = cfg.costs || {};
  const PER_BLOCK = Number(costs.block_30s ?? 75);
  const PER_VOICE = Number(costs.voice ?? 15);
  const PER_STILL = Number(costs.still ?? 2.5);

  const blocks = sl.blocks;
  if (!Array.isArray(blocks) || !blocks.length) die("asset-audit: shotlist.json has no blocks");

  const need = new Map();
  const want = (p, kind, cost) => {
    if (!need.has(p)) need.set(p, [kind, cost]);
  };
  for (const b of blocks) {
    for (const c of b.characters || []) want(`assets/images/characters/${slug(c)}.png`, "character sheet", PER_STILL);
    for (const c of b.voices || []) want(`assets/audio/voices/blackframe/${slug(c)}.mp4`, "voice (blackframe)", PER_VOICE);
    if (b.location) want(`assets/images/locations/${slug(b.location)}.png`, "location plate", PER_STILL);
    for (const p of b.props || []) want(`assets/images/props/${slug(p)}.png`, "prop plate", PER_STILL);
    for (const v of b.video_refs || []) want(`assets/video_refs/${v}`, "video ref", 0);
    // an explicit ordered reference list names the exact files the prompt numbers
    for (const r of b.references || []) {
      if (r.kind === "anchor") continue;
      const kind = r.kind || "reference";
      const cost = kind === "voice" ? PER_VOICE : kind === "video" ? 0 : PER_STILL;
      want(r.path, kind, cost);
    }
  }

  // the anchor frame: a reference /render itself produces, cited by the next chained block
  const state = load(root, ".storyseam/state.json", { fallback: {} }) || {};
  const done = new Set(
    Object.entries(state.blocks || {}).filter(([, s]) => s.status === "done").map(([bid]) => bid)
  );
  for (let i = 0; i + 1 < blocks.length; i++) {
    const prev = blocks[i];
    if (blocks[i + 1].start_from_previous_last_frame && done.has(prev.id)) {
      need.set(`renders/frames/${prev.id}_last.jpg`, ["anchor frame", 0]);
    }
  }

  let missingCost = 0;
  let unuploaded = 0;
  let stale = 0;
  console.log(`${pad("ASSET", 52)} ${pad("KIND", 20)} ${pad("STATUS", 15)} REGISTERED AS`);
  console.log("-".repeat(100));
  for (const p of [...need.keys()].sort()) {
    const [kind, cost] = need.get(p);
    const full = path.join(root, p);
    const entry = cache[p] || {};
    const mid = entry.media_id || entry.url || "";
    const registered = (entry.media_id && entry.confirmed) || entry.url;
    let status;
    let tail;
    if (!fs.existsSync(full)) {
      status = "MISSING";
      tail = "—";
      missingCost += cost;
    } else if (!registered) {
      status = "NOT REGISTERED";
      tail = "—";
      unuploaded++;
    } else if (entry.mtime != null && fs.statSync(full).mtimeMs / 1000 > Number(entry.mtime) + 1) {
      status = "STALE";
      tail = mid.slice(0, 8) + "…";
      stale++;
    } else {
      status = "present";
      tail = mid.length > 9 ? mid.slice(0, 8) + "…" : mid;
    }
    console.log(`${pad(p, 52)} ${pad(kind, 20)} ${pad(status, 15)} ${tail}`);
  }

  const over = blocks
    .filter((b) => (b.dur || 0) > blockSeconds)
    .map((b) => `${b.id || "?"} is ${b.dur}s (max ${blockSeconds}s — Seedance clamps silently)`);
  const totalDur = blocks.reduce((n, b) => n + (b.dur || 0), 0);
  const renderCost = blocks.reduce((n, b) => n + PER_BLOCK * ((b.dur || 0) / 30), 0);

  console.log("-".repeat(100));
  console.log(`${blocks.length} blocks, ${totalDur}s total  ->  ~${num(renderCost)} credits, ${blocks.length} runs to render`);
  for (const o of over) console.log(`OVER LENGTH: ${o}`);
  if (missingCost) console.log(`MISSING assets cost ~${num(missingCost)} credits to make. Run /cast.`);
  if (unuploaded) console.log(`${unuploaded} asset(s) exist but are not registered with the provider. Run /cast.`);
  if (stale) console.log(`${stale} asset(s) changed on disk after upload — re-upload before rendering against them.`);
  if (!missingCost && !unuploaded && !stale && !over.length) {
    console.log("All references present and confirmed. Ready to /render.");
    return true;
  }
  return false;
}
