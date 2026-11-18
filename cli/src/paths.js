// Where the packaged engine lives. `cli/src/paths.js` -> the package root two levels up.
// Everything the CLI copies into a story (skills, commands, agents, templates, schema,
// the bundled registry) is read from here and never from the user's cwd.
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const asset = (...p) => path.join(PKG_ROOT, ...p);

export const pkgVersion = () => {
  try {
    return JSON.parse(fs.readFileSync(asset("package.json"), "utf8")).version;
  } catch {
    return "0.0.0";
  }
};

/** Resolve the story root a command acts on: an explicit argument, $STORYSEAM_ROOT, or cwd. */
export const storyRoot = (arg) =>
  path.resolve(arg || process.env.STORYSEAM_ROOT || process.cwd());
