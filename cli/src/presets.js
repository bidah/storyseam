// Prompt presets — shareable pre-prompts, one per section. docs/spec.md §14.
//
// A shot's own prompt says what happens. A preset says how every shot is made:
// the camera it is shot on, what the audio track carries. Each preset is one
// JSON file (schema/preset.schema.json) with its own URL —
//   https://storyseam.app/spec/presets/<section>/<id>.json
// — and installs into config.json `presets.<section>`. /render puts every
// installed preset's prompt around the block's own, in SECTION_ORDER: a preset
// with `position: "before"` goes ahead of the block prompt (a look every shot
// opens with), the rest (`"after"`, the default) follow it. The shot previewer
// shows them in the same order. One preset per section is in use.
//
// The catalogue ships in this package (presets/); `add` also takes any URL, so
// a preset someone wrote and hosted installs the same way.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { PKG_ROOT } from "./paths.js";
import { die } from "./util.js";

export const SECTION_ORDER = ["look", "camera", "audio"];
export const POSITIONS = ["before", "after"];
export const DEFAULT_PRESETS = { audio: "silent" };
export const PRESETS_URL = "https://storyseam.app/spec/presets";
const ALLOWED_SETTINGS = new Set(["video.generate_audio"]);

export function catalogue() {
  const dir = path.join(PKG_ROOT, "presets");
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const section of fs.readdirSync(dir).sort()) {
    const sdir = path.join(dir, section);
    if (!fs.statSync(sdir).isDirectory()) continue;
    for (const f of fs.readdirSync(sdir).filter((f) => f.endsWith(".json")).sort()) {
      out.push(JSON.parse(fs.readFileSync(path.join(sdir, f), "utf8")));
    }
  }
  return out;
}

export const sectionsInOrder = (keys) => [
  ...SECTION_ORDER.filter((s) => keys.includes(s)),
  ...keys.filter((s) => !SECTION_ORDER.includes(s)).sort(),
];

/** The preset lines a block's video prompt carries, in order, on one side of it:
 *  "before" the block's own prompt, or "after" it (a preset with no position). */
export function presetLines(config, where = "after") {
  const p = config?.presets || {};
  return sectionsInOrder(Object.keys(p))
    .filter((s) => (p[s]?.position || "after") === where)
    .map((s) => p[s]?.prompt)
    .filter(Boolean);
}

function validPreset(p) {
  const bad = [];
  if (!p || typeof p !== "object") return ["not a JSON object"];
  for (const k of ["section", "id", "name", "prompt"]) if (!p[k] || typeof p[k] !== "string") bad.push(`no ${k}`);
  if (p.section && !/^[a-z][a-z0-9_-]*$/.test(p.section)) bad.push(`section "${p.section}" is not a plain name`);
  if (p.position != null && !POSITIONS.includes(p.position)) bad.push(`position "${p.position}" is not one of ${POSITIONS.join(", ")}`);
  for (const k of Object.keys(p.settings || {})) if (!ALLOWED_SETTINGS.has(k)) bad.push(`setting "${k}" is not one a preset may change`);
  return bad;
}

/** config.json `presets` problems. Mirrored in bin/story-check.py preset_problems. */
export function presetProblems(config) {
  const p = config?.presets;
  if (p == null) return [];
  if (typeof p !== "object" || Array.isArray(p)) return ["config.json presets must be an object keyed by section"];
  const out = [];
  for (const [section, v] of Object.entries(p)) {
    if (!v || typeof v !== "object") {
      out.push(`config.json presets.${section} must be an object`);
      continue;
    }
    if (v.section && v.section !== section) out.push(`config.json presets.${section} holds a "${v.section}" preset`);
    if (!v.id) out.push(`config.json presets.${section} has no id`);
    if (!v.prompt || typeof v.prompt !== "string") out.push(`config.json presets.${section} has no prompt line, so no block will carry it`);
    if (v.position != null && !POSITIONS.includes(v.position)) out.push(`config.json presets.${section} has position "${v.position}"; use ${POSITIONS.join(" or ")}`);
    for (const [k, val] of Object.entries(v.settings || {})) {
      if (!ALLOWED_SETTINGS.has(k)) out.push(`config.json presets.${section} sets "${k}", which a preset may not change`);
      else if (k === "video.generate_audio" && config.video?.generate_audio !== val) {
        out.push(`config.json presets.${section} (${v.id}) sets video.generate_audio to ${val} but video.generate_audio is ${config.video?.generate_audio}`);
      }
    }
  }
  return out;
}

async function resolve(spec) {
  if (/^https?:\/\//.test(spec)) {
    const r = await fetch(spec);
    if (!r.ok) die(`could not fetch ${spec}: ${r.status}`);
    let p;
    try {
      p = await r.json();
    } catch {
      die(`${spec} is not JSON`);
    }
    return { ...p, source: spec };
  }
  if (fs.existsSync(spec) && spec.endsWith(".json")) return { ...JSON.parse(fs.readFileSync(spec, "utf8")), source: path.resolve(spec) };
  const [a, b] = spec.split("/");
  const all = catalogue();
  const hit = b ? all.find((p) => p.section === a && p.id === b) : all.filter((p) => p.id === a);
  if (Array.isArray(hit)) {
    if (hit.length === 1) return { ...hit[0], source: `${PRESETS_URL}/${hit[0].section}/${hit[0].id}.json` };
    if (hit.length > 1) die(`"${spec}" is in several sections (${hit.map((p) => p.section).join(", ")}); say <section>/<id>`);
    die(`no preset "${spec}" in the catalogue (npx storyseam preset list)`);
  }
  if (!hit) die(`no preset "${spec}" in the catalogue (npx storyseam preset list)`);
  return { ...hit, source: `${PRESETS_URL}/${hit.section}/${hit.id}.json` };
}

/** Install a preset object into a config object (mutates and returns it). */
export function applyPreset(config, preset) {
  const bad = validPreset(preset);
  if (bad.length) die(`not a valid preset: ${bad.join("; ")}`);
  const { swatch, ...kept } = preset;
  config.presets = { ...(config.presets || {}), [preset.section]: kept };
  for (const [k, v] of Object.entries(preset.settings || {})) {
    const [head, key] = k.split(".");
    config[head] = { ...(config[head] || {}), [key]: v };
  }
  return config;
}

/** The scaffold's presets (audio: silent), from the bundled catalogue. */
export function defaultPresets(config) {
  const all = catalogue();
  for (const [section, id] of Object.entries(DEFAULT_PRESETS)) {
    const p = all.find((x) => x.section === section && x.id === id);
    if (p) applyPreset(config, { ...p, source: `${PRESETS_URL}/${section}/${id}.json` });
  }
  return config;
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function swatch(p) {
  const pal = p.swatch?.palette || ["#333", "#777", "#bbb", "#eee"];
  const stops = pal.map((c, i) => `${c} ${Math.round((i / (pal.length - 1)) * 100)}%`).join(",");
  const g = p.swatch?.grain || 0;
  const noise = g
    ? `<svg class="grain" style="opacity:${g * 0.5}" aria-hidden="true"><filter id="n-${esc(p.section)}-${esc(p.id)}"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2"/></filter><rect width="100%" height="100%" filter="url(#n-${esc(p.section)}-${esc(p.id)})"/></svg>`
    : "";
  return `<div class="sw" style="background:linear-gradient(135deg,${stops})">${noise}</div>`;
}

export function buildPresetsPage(root, only) {
  const config = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
  const ratio = (config.aspect_ratio || "16:9").replace(":", "/");
  const inUse = config.presets || {};
  const all = catalogue();
  const sections = sectionsInOrder([...new Set([...all.map((p) => p.section), ...Object.keys(inUse)])]).filter((s) => !only || s === only);
  const card = (p, current) => {
    const still = ["png", "jpg", "webp"].map((e) => `assets/presets/${p.section}/${p.id}.${e}`).find((f) => fs.existsSync(path.join(root, f)));
    const media = still ? `<img src="../../${esc(still)}" alt="${esc(p.name)} sample">` : swatch(p);
    const fields = Object.entries(p.fields || {}).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
    const settings = Object.entries(p.settings || {}).map(([k, v]) => `<dt>sets</dt><dd><code>${esc(k)} = ${esc(v)}</code></dd>`).join("");
    return `<article class="${current ? "on" : ""}"><div class="media" style="aspect-ratio:${ratio}">${media}${current ? '<span class="tag">in use</span>' : ""}</div>
<div class="body"><div class="id">${esc(p.section)}/${esc(p.id)}${p.position === "before" ? " · opens every prompt" : ""}</div><h3>${esc(p.name)}</h3>${p.description ? `<p class="desc">${esc(p.description)}</p>` : ""}
${fields || settings ? `<dl>${fields}${settings}</dl>` : ""}<p class="prompt">${esc(p.prompt)}</p>
<code class="install">npx storyseam preset add ${esc(p.section)}/${esc(p.id)}</code></div></article>`;
  };
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prompt presets · ${esc(config.title || "story")}</title><style>
:root{--bg:#f6f4ef;--card:#fff;--ink:#1c1b19;--mute:#6b675f;--line:#e2ddd2;--accent:#0f766e}
@media (prefers-color-scheme:dark){:root{--bg:#15140f;--card:#1f1d18;--ink:#ece8de;--mute:#a19b8e;--line:#34312a;--accent:#5eead4}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif}
main{max-width:1180px;margin:0 auto;padding:28px 16px 64px}.eyebrow{font:500 12px ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
h1{font-size:28px;margin:6px 0 4px}h2{font-size:20px;margin:34px 0 12px;text-transform:capitalize}.sub{color:var(--mute);margin:0 0 8px;max-width:70ch}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
article{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;min-width:0}article.on{outline:2px solid var(--accent)}
.media{position:relative;background:var(--bg)}.media img,.sw{display:block;width:100%;height:100%;object-fit:cover}.grain{position:absolute;inset:0;width:100%;height:100%;mix-blend-mode:overlay}
.tag{position:absolute;top:10px;left:10px;background:var(--accent);color:var(--bg);font:600 11px ui-monospace,monospace;padding:3px 8px;border-radius:99px;text-transform:uppercase}
.body{padding:14px 16px}.id{font:500 12px ui-monospace,monospace;color:var(--accent)}h3{font-size:18px;margin:2px 0 6px}.desc{margin:0 0 10px;color:var(--mute);font-size:14px}
dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0 0 10px;font-size:14px}dt{color:var(--mute);text-transform:capitalize}dd{margin:0;min-width:0;overflow-wrap:anywhere}
.prompt{margin:0 0 10px;font:13px/1.55 ui-monospace,Menlo,monospace;color:var(--mute);border-top:1px solid var(--line);padding-top:10px}
.install{display:block;font:12px ui-monospace,monospace;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:6px 8px;overflow-x:auto;white-space:nowrap}
</style></head><body><main><div class="eyebrow">Prompt presets</div><h1>How every shot is made</h1>
<p class="sub">Each block's own prompt says what happens; the preset in use for each section below is added to it on every block, ahead of it when the preset opens every prompt and after it otherwise. Tell the agent which to use, or install one from a URL: <code>npx storyseam preset add &lt;url&gt;</code>.</p>
${sections
  .map((s) => {
    const cur = inUse[s];
    const list = all.filter((p) => p.section === s);
    const custom = cur && !list.some((p) => p.id === cur.id) ? [{ ...cur, section: s }] : [];
    return `<h2>${esc(s)}</h2><div class="grid">${[...custom, ...list].map((p) => card(p, cur?.id === p.id)).join("")}</div>`;
  })
  .join("")}
</main></body></html>
`;
  const out = path.join(root, "shotlist/previews/presets.html");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  return out;
}

const openFile = (f) => execFile(process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open", [f], () => {});

export function runPresetList(section, opts = {}) {
  const all = catalogue().filter((p) => !section || p.section === section);
  if (opts.json) return console.log(JSON.stringify(all, null, 2)), true;
  let last = null;
  for (const p of all) {
    if (p.section !== last) console.log(`\n${p.section}`), (last = p.section);
    console.log(`  ${p.id.padEnd(22)} ${p.name}${p.section in DEFAULT_PRESETS && DEFAULT_PRESETS[p.section] === p.id ? "  (default)" : ""}`);
  }
  console.log(`\ninstall: npx storyseam preset add <section>/<id>   ·   any URL: npx storyseam preset add ${PRESETS_URL}/<section>/<id>.json`);
  return true;
}

export async function runPresetAdd(root, spec) {
  const cfgPath = path.join(root, "config.json");
  const config = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const preset = await resolve(spec);
  const before = config.presets?.[preset.section]?.id;
  applyPreset(config, preset);
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2) + "\n");
  console.log(`config.json presets.${preset.section} = ${preset.id}${before && before !== preset.id ? ` (was ${before})` : ""}`);
  for (const [k, v] of Object.entries(preset.settings || {})) console.log(`config.json ${k} = ${v}`);
  buildPresetsPage(root);
  return true;
}

export function runPresetPage(root, section, opts = {}) {
  const out = buildPresetsPage(root, section);
  const config = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
  const used = Object.entries(config.presets || {}).map(([s, p]) => `${s}=${p.id}`).join(", ") || "none";
  console.log(`${path.relative(root, out)}  (in use: ${used})`);
  const problems = presetProblems(config);
  for (const p of problems) console.log(`BROKEN   ${p}`);
  if (opts.open) openFile(out);
  return problems.length === 0;
}
