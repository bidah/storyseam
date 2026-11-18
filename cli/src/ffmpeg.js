// The two ffmpeg wrappers, ported from bin/*.sh. ffmpeg is a hard requirement on every
// provider — Storyseam does frame and audio work locally whatever the backend is.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { die } from "./util.js";

const need = (tool) => {
  const r = spawnSync(tool, ["-version"], { stdio: "ignore" });
  if (r.error) die(`${tool} is required (brew install ffmpeg)`);
};

const run = (tool, args) => {
  const r = spawnSync(tool, args, { encoding: "utf8" });
  if (r.status !== 0) die(`${tool} failed: ${(r.stderr || "").trim().split("\n").pop() || r.status}`);
  return (r.stdout || "").trim();
};

/** Mux a voice take against a black video track — the only form Seedance accepts as a
 *  voice, passed as `video_references`. Not `audio_references` (ADR-0002). */
export function voiceToBlackframe(slug, root) {
  need("ffmpeg");
  need("ffprobe");
  const src = path.join(root, "assets/audio/voices", `${slug}.mp3`);
  const out = path.join(root, "assets/audio/voices/blackframe", `${slug}.mp4`);
  if (!fs.existsSync(src)) die(`no voice take at ${src}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const dur = run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src]);
  if (!dur) die(`ffprobe could not read a duration from ${src}`);

  run("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", `color=c=black:s=640x360:r=25:d=${dur}`,
    "-i", src,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-tune", "stillimage",
    "-c:a", "aac", "-b:a", "192k", "-shortest", out,
  ]);
  console.log(`${out}  (${Number(dur).toFixed(1)}s)`);
  return out;
}

/** Extract a block's final frame — the anchor the next block cites first and declares in
 *  prose as its first frame (ADR-0001). */
export function lastFrame(clip, outArg) {
  need("ffmpeg");
  if (!fs.existsSync(clip)) die(`no clip at ${clip}`);
  const out =
    outArg ||
    path.join(path.dirname(path.dirname(clip)), "frames", `${path.basename(clip, path.extname(clip))}_last.jpg`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  run("ffmpeg", ["-y", "-loglevel", "error", "-sseof", "-1", "-i", clip, "-update", "1", "-q:v", "2", out]);
  if (!fs.existsSync(out) || fs.statSync(out).size === 0) {
    die(`ffmpeg wrote nothing for ${clip} — is the clip shorter than 1s or corrupt?`);
  }
  console.log(out);
  return out;
}
