// `storyseam assets` — the asset sheet: shotlist/assets.json, every still the
// film needs (character sheets, location plates, prop plates), which blocks need
// each, and how each will be made: from the author's reference images, or
// generated from the World's description alone (docs/spec.md §11).
//
// Derived from shotlist.json, so it is rebuilt rather than edited by hand — but
// the author's answers (`source`) and the reference files they dropped in
// assets/refs/ are carried across every rebuild, never reset.
import fs from "node:fs";
import path from "node:path";
import { die } from "./util.js";

export const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// kind -> [where the sheet lands, where the author's refs go]
const KINDS = {
  character: ["assets/images/characters", "assets/refs/characters"],
  location: ["assets/images/locations", "assets/refs/locations"],
  prop: ["assets/images/props", "assets/refs/props"],
};
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

const readJson = (p, fallback) => {
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    die(`${p} is not valid JSON (${e.message})`);
  }
};

/** The author's reference images for one asset, as story-relative paths. */
function refsOn(root, kind, s) {
  const dir = path.join(KINDS[kind][1], s);
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((f) => IMAGE_EXT.test(f))
    .sort()
    .map((f) => path.posix.join(dir.split(path.sep).join("/"), f));
}

/** Build the sheet from the shot list, keeping every answer already given. */
export function buildAssetSheet(root) {
  const sl = readJson(path.join(root, "shotlist/shotlist.json"), null);
  if (!sl) die("no shotlist/shotlist.json yet: run /shotlist first");
  const prev = readJson(path.join(root, "shotlist/assets.json"), { assets: [] });
  const before = new Map((prev.assets || []).map((a) => [`${a.kind}:${a.slug}`, a]));

  const found = new Map();
  const need = (kind, name, blockId) => {
    const s = slug(name);
    const key = `${kind}:${s}`;
    if (!found.has(key)) found.set(key, { kind, slug: s, name: String(name), needed_by: [] });
    const a = found.get(key);
    if (!a.needed_by.includes(blockId)) a.needed_by.push(blockId);
  };
  for (const b of sl.blocks || []) {
    for (const c of b.characters || []) need("character", c, b.id);
    if (b.location) need("location", b.location, b.id);
    for (const p of b.props || []) need("prop", p, b.id);
  }

  const order = { character: 0, location: 1, prop: 2 };
  const assets = [...found.values()]
    .sort((a, b) => order[a.kind] - order[b.kind] || a.slug.localeCompare(b.slug))
    .map((a) => {
      const old = before.get(`${a.kind}:${a.slug}`) || {};
      const refs = refsOn(root, a.kind, a.slug);
      // Files dropped in assets/refs/ ARE the author's answer, unless they said
      // "generate" for this one in so many words.
      let source = old.source || "ask";
      if (refs.length && source === "ask") source = "refs";
      return {
        kind: a.kind,
        slug: a.slug,
        name: a.name,
        path: `${KINDS[a.kind][0]}/${a.slug}.png`,
        refs_dir: `${KINDS[a.kind][1]}/${a.slug}/`,
        needed_by: a.needed_by,
        source,
        refs,
        ...(old.notes ? { notes: old.notes } : {}),
      };
    });
  return { title: sl.title, assets };
}

export function runAssets(root, { json = false } = {}) {
  const sheet = buildAssetSheet(root);
  fs.writeFileSync(path.join(root, "shotlist/assets.json"), JSON.stringify(sheet, null, 2) + "\n");
  if (json) {
    console.log(JSON.stringify(sheet, null, 2));
    return true;
  }
  console.log(`wrote shotlist/assets.json: ${sheet.assets.length} stills\n`);
  for (const a of sheet.assets) {
    const made = fs.existsSync(path.join(root, a.path)) ? "made" : "to make";
    const how = a.source === "refs" ? `from ${a.refs.length} ref${a.refs.length === 1 ? "" : "s"}` : a.source;
    console.log(`${a.kind.padEnd(10)} ${a.slug.padEnd(28)} ${String(a.needed_by.length).padStart(2)} block(s)  ${made.padEnd(8)} ${how}`);
  }
  const open = sheet.assets.filter((a) => a.source === "ask");
  if (open.length) {
    console.log(`\n${open.length} still(s) have no answer yet. Ask the author once, for all of them:`);
    console.log("reference images for any of these (drop them in each refs_dir, or attach them),");
    console.log('or generate them from the World\'s description? Record each as source "refs" or "generate".');
  }
  return !open.length;
}

/** Problems with shotlist/assets.json beyond its schema, as BROKEN lines. Mirrored in bin/story-check.py. */
export function assetSheetProblems(root) {
  const sheet = readJson(path.join(root, "shotlist/assets.json"), null);
  if (!sheet) return [];
  const out = [];
  for (const a of sheet.assets || []) {
    if (a.source === "refs" && !(a.refs || []).length) out.push(`assets.json ${a.kind} ${a.slug} is source "refs" with no reference images`);
    for (const r of a.refs || []) {
      if (!fs.existsSync(path.join(root, r))) out.push(`assets.json ${a.kind} ${a.slug} cites ${r}, which is not on disk`);
    }
  }
  return out;
}
