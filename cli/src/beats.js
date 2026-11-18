// Blocks land on beats (docs/spec.md §12): each block covers whole, consecutive
// beats of script/outline.md and ends where its last beat ends; only a beat too
// long for one block is split, across consecutive blocks marked `beat_part`.
// Mirrored in bin/story-check.py `beat_problems`; the two must agree.
import fs from "node:fs";
import path from "node:path";

/** Beat numbers in the outline: lines like `**3. TEN — the idea.**` or `### 3. ...`. */
export function outlineBeats(root) {
  const p = path.join(root, "script/outline.md");
  if (!fs.existsSync(p)) return [];
  const nums = [];
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = /^(?:\*\*|#{2,4}\s+)(\d+)\.\s/.exec(line);
    if (m) nums.push(Number(m[1]));
  }
  return nums;
}

export function beatProblems(root, blocks) {
  const out = [];
  const tagged = blocks.filter((b) => Array.isArray(b.beats));
  if (!tagged.length) return out; // a shot list from before beats
  if (tagged.length !== blocks.length) {
    out.push(`shotlist.json: ${blocks.length - tagged.length} block(s) have no beats; every block must say which beats it lands on`);
    return out;
  }
  let prev = null;
  for (const b of blocks) {
    const beats = b.beats;
    for (let i = 1; i < beats.length; i++) {
      if (beats[i] !== beats[i - 1] + 1) out.push(`${b.id} covers beats ${beats.join(", ")}, which are not consecutive`);
    }
    if (b.beat_part && beats.length !== 1) out.push(`${b.id} is part of a split beat but covers ${beats.length} beats`);
    if (prev) {
      const last = prev.beats[prev.beats.length - 1];
      const first = beats[0];
      if (first === last) {
        // the same beat continues: only a declared split may do that
        const a = prev.beat_part;
        const c = b.beat_part;
        if (!a || !c || prev.beats.length !== 1 || c.n !== a.n + 1 || c.of !== a.of) {
          out.push(`${prev.id} ends in the middle of beat ${last} and ${b.id} picks it up: end ${prev.id} on the beat, or mark both blocks beat_part`);
        }
      } else if (first !== last + 1) {
        const gap = first - 1 === last + 1 ? `beat ${last + 1} is` : `beats ${last + 1}-${first - 1} are`;
        out.push(`${b.id} starts on beat ${first} but ${prev.id} ended on beat ${last}: ${gap} in no block`);
      } else if (prev.beat_part && prev.beat_part.n !== prev.beat_part.of) {
        out.push(`${prev.id} is part ${prev.beat_part.n} of ${prev.beat_part.of} of beat ${last}, but the next block moves on`);
      }
    }
    prev = b;
  }
  const outline = outlineBeats(root);
  if (outline.length) {
    const covered = new Set(blocks.flatMap((b) => b.beats));
    const missing = outline.filter((n) => !covered.has(n));
    const unknown = [...covered].filter((n) => !outline.includes(n));
    if (missing.length) out.push(`outline beats ${missing.join(", ")} land in no block`);
    if (unknown.length) out.push(`blocks cite beats ${unknown.join(", ")}, which script/outline.md does not have`);
  }
  return out;
}
