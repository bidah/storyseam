// `storyseam preview <block>` — the HTML previewer for one shot before it is sent.
// docs/spec.md §13. It writes shotlist/previews/<block>.html: a self-contained
// page with exactly what the render call will carry — the full prompt (block
// prompt + style prompt), the reference images, voices and videos in the order
// they will be passed, the model and its settings, the beats it lands on, and
// the estimated cost — so the author approves what is sent, not a summary of it.
//
// On by default. `config.json` → "shot_preview": { "enabled": false } turns it
// off; /render then submits without stopping. The page is written whether or
// not it is opened, and it links its media by relative path, so it works from
// the folder, in storyseam-preview, or zipped and sent to someone.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { slug } from "./assets.js";
import { blockNeeds } from "./recommend.js";
import { die } from "./util.js";
import { presetLines } from "./presets.js";

export const previewEnabled = (config) => config?.shot_preview?.enabled !== false;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const firstExisting = (root, dir, name, exts) => {
  for (const e of exts) {
    const rel = `${dir}/${slug(name)}.${e}`;
    if (fs.existsSync(path.join(root, rel))) return rel;
  }
  return `${dir}/${slug(name)}.${exts[0]}`;
};

/** The ordered reference list /render will pass, with labels. */
export function referencesFor(root, block, blocks, config) {
  if (Array.isArray(block.references) && block.references.length) {
    return block.references.map((r) => ({ ...r, label: r.label || path.basename(r.path) }));
  }
  const out = [];
  const i = blocks.indexOf(block);
  if (block.start_from_previous_last_frame && i > 0) {
    out.push({ kind: "anchor", path: `renders/frames/${blocks[i - 1].id}_last.jpg`, label: `last frame of ${blocks[i - 1].id}` });
  }
  const img = ["png", "jpg", "jpeg", "webp"];
  for (const c of block.characters || []) out.push({ kind: "character", path: firstExisting(root, "assets/images/characters", c, img), label: c });
  if (block.location) out.push({ kind: "location", path: firstExisting(root, "assets/images/locations", block.location, img), label: block.location });
  for (const p of block.props || []) out.push({ kind: "prop", path: firstExisting(root, "assets/images/props", p, img), label: p });
  const blackframe = (config?.audio?.voice_ref_format || "blackframe_mp4") === "blackframe_mp4";
  for (const v of block.voices || []) {
    out.push(
      blackframe
        ? { kind: "voice", path: firstExisting(root, "assets/audio/voices/blackframe", v, ["mp4"]), label: `${v} (voice)` }
        : { kind: "audio", path: firstExisting(root, "assets/audio/voices", v, ["mp3", "wav", "m4a"]), label: `${v} (voice)` },
    );
  }
  for (const v of block.video_refs || []) out.push({ kind: "video", path: typeof v === "string" ? v : v.path, label: typeof v === "string" ? path.basename(v) : v.label || path.basename(v.path) });
  return out;
}

export function buildPreview(root, blockId) {
  const config = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
  const shotlist = JSON.parse(fs.readFileSync(path.join(root, "shotlist/shotlist.json"), "utf8"));
  const blocks = shotlist.blocks || [];
  const block = blocks.find((b) => b.id === blockId || String(blocks.indexOf(b) + 1) === String(blockId));
  if (!block) die(`no block "${blockId}" in shotlist/shotlist.json (have: ${blocks.map((b) => b.id).join(", ")})`);

  const stylePath = path.join(root, "prompts/video_style_prompt.txt");
  const style = fs.existsSync(stylePath) ? fs.readFileSync(stylePath, "utf8").trim() : "";
  // the order /render assembles it in: presets that open every prompt (look, ...), block prompt,
  // the other preset lines (camera, audio, ...), style prompt
  const prompt = [...presetLines(config, "before"), block.prompt || "", ...presetLines(config, "after"), style].filter(Boolean).join("\n\n");
  const refs = referencesFor(root, block, blocks, config);
  const model = block.model || config.video?.model || (config.video?.models || [])[0] || "(not chosen)";
  const needs = blockNeeds(block, config);
  const perBlock = Number(config.costs?.block_30s ?? 75);
  const cost = Math.round((perBlock * (Number(block.dur) || 0)) / 30 * 10) / 10;
  const missing = refs.filter((r) => !fs.existsSync(path.join(root, r.path)));
  const index = blocks.indexOf(block);

  const rel = (p) => path.relative(path.join(root, "shotlist/previews"), path.join(root, p)).split(path.sep).join("/");
  const media = (r) => {
    const src = esc(rel(r.path));
    if (!fs.existsSync(path.join(root, r.path))) return `<div class="ph">not made yet</div>`;
    if (/\.(mp4|mov|webm)$/i.test(r.path)) return `<video src="${src}" controls muted preload="metadata"></video>`;
    if (/\.(mp3|wav|m4a|ogg)$/i.test(r.path)) return `<audio src="${src}" controls preload="none"></audio>`;
    return `<img src="${src}" alt="${esc(r.label)}" loading="lazy">`;
  };
  const settings = [
    ["Model", model],
    ["Duration", `${block.dur}s`],
    ["Resolution", config.video?.resolution || "480p"],
    ["Aspect ratio", config.aspect_ratio || ""],
    ["Generate audio", String(config.video?.generate_audio !== false)],
    ["Provider", config.providers?.video?.id || ""],
    ...Object.entries(config.presets || {}).map(([s, v]) => [s[0].toUpperCase() + s.slice(1), v.name || v.id]),
    ...(config.presets?.camera ? [] : [["Camera", "not chosen (run /camera)"]]),
    ["Beats", (block.beats || []).join(", ") + (block.beat_part ? ` (part ${block.beat_part.n} of ${block.beat_part.of})` : "")],
    ["Location", block.location || ""],
    ["Chained", block.start_from_previous_last_frame ? `yes, opens on the last frame of ${blocks[index - 1]?.id}` : "no"],
    ["References", `${needs.images} image · ${needs.videos} video · ${needs.audio} audio`],
    ["Estimated cost", `${cost} credits`],
  ];

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(block.id)} · shot preview</title>
<style>
:root{--bg:#f6f4ef;--card:#fff;--ink:#1c1b19;--mute:#6b675f;--line:#e2ddd2;--accent:#0f766e;--warn:#b45309}
@media (prefers-color-scheme:dark){:root{--bg:#15140f;--card:#1f1d18;--ink:#ece8de;--mute:#a19b8e;--line:#34312a;--accent:#5eead4;--warn:#fbbf24}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1040px;margin:0 auto;padding:28px 16px 64px}
.eyebrow{font:500 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
h1{font-size:28px;margin:6px 0 4px;letter-spacing:-.01em}.sub{color:var(--mute);margin:0 0 22px}
.warn{border:1px solid var(--warn);color:var(--warn);border-radius:10px;padding:10px 14px;margin:0 0 18px}
.grid{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:18px}@media(max-width:760px){.grid{grid-template-columns:1fr}}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;min-width:0}
h2{font-size:13px;margin:0 0 12px;color:var(--mute);font-weight:600;text-transform:uppercase;letter-spacing:.06em}
pre{white-space:pre-wrap;word-break:break-word;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0}
dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:6px 14px}dt{color:var(--mute)}dd{margin:0;font-weight:500;overflow-wrap:anywhere}
.refs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
figure{margin:0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--bg)}
figure img,figure video{display:block;width:100%;aspect-ratio:1;object-fit:cover}figure audio{width:100%;margin:40px 0}
.ph{aspect-ratio:1;display:grid;place-items:center;color:var(--warn);font-size:13px}
figcaption{padding:8px 10px;font-size:13px}figcaption b{color:var(--accent);font:600 12px ui-monospace,monospace;margin-right:6px}
.shots{width:100%;border-collapse:collapse;font-size:14px}.shots th,.shots td{text-align:left;vertical-align:top;padding:8px;border-top:1px solid var(--line)}.shots th{color:var(--mute);font-weight:500}
.full{grid-column:1/-1}
</style></head><body><main>
<div class="eyebrow">Shot preview · block ${index + 1} of ${blocks.length}</div>
<h1>${esc(block.id)}${block.movement ? ` — ${esc(block.movement)}` : ""}</h1>
<p class="sub">This is what will be sent. Approve it in chat, or say what to change.</p>
${missing.length ? `<p class="warn">Not ready: ${missing.map((r) => esc(r.path)).join(", ")} ${missing.length === 1 ? "does" : "do"} not exist yet.</p>` : ""}
<div class="grid">
<section><h2>Prompt</h2><pre>${esc(prompt)}</pre></section>
<section><h2>Model &amp; settings</h2><dl>${settings.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></section>
<section class="full"><h2>References, in the order they are passed</h2><div class="refs">${refs
    .map((r, i) => `<figure>${media(r)}<figcaption><b>${i + 1}</b>${esc(r.kind)} · ${esc(r.label)}</figcaption></figure>`)
    .join("") || `<p class="sub">No references.</p>`}</div></section>
${(block.shots || []).length ? `<section class="full"><h2>Shots</h2><table class="shots"><thead><tr><th>Time</th><th>Camera</th><th>Action</th><th>Dialogue</th></tr></thead><tbody>${block.shots
    .map((s) => `<tr><td>${esc(s.t)}</td><td>${esc(s.camera)}</td><td>${esc(s.action)}</td><td>${esc(s.dialogue)}</td></tr>`)
    .join("")}</tbody></table></section>` : ""}
${block.final_frame ? `<section class="full"><h2>Final frame</h2><p style="margin:0">${esc(block.final_frame)}</p></section>` : ""}
</div></main></body></html>
`;
  const out = path.join(root, "shotlist/previews", `${block.id}.html`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  return { out, block, missing, model, cost };
}

export function runPreview(root, blockId, opts = {}) {
  const config = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
  if (!previewEnabled(config) && !opts.force) {
    console.log("shot previews are off (config.json shot_preview.enabled = false); pass --force to write one anyway");
    return true;
  }
  const ids = blockId === "all" || !blockId
    ? JSON.parse(fs.readFileSync(path.join(root, "shotlist/shotlist.json"), "utf8")).blocks.map((b) => b.id)
    : [blockId];
  let ready = true;
  for (const id of ids) {
    const { out, missing, model, cost } = buildPreview(root, id);
    console.log(`${path.relative(root, out)}  ${model}  ~${cost} credits${missing.length ? `  NOT READY: ${missing.length} reference(s) missing` : ""}`);
    if (missing.length) ready = false;
    if (opts.open && ids.length === 1) {
      const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
      execFile(cmd, [out], () => {});
    }
  }
  return ready;
}
