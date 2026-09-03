---
name: shotlist
description: >-
  Turn the finished script into an ordered shot list packed into <=30s Seedance 2.5
  blocks, each with its Seedance prompt and its required references. Use for
  "/shotlist", "make the shot list", "break the script into shots", "generate the
  next block". Writes shotlist/shotlist.json (canonical) and shotlist/shotlist.md.
  Delegates every prompt to the director skill for config.video.model. Generates NO media — that
  is /cast and /render. Run ONLY when the author asks; never off the back of writing
  the script in the same turn.
---

# /shotlist — script → 30-second blocks

The shot list is the contract between the script and the renders. It is the last
place a mistake is cheap: a wrong reference here is a text edit, the same mistake in
`/render` is 75 credits.

## Preconditions

- `script/script.md` exists and the author has said they are happy with it. "The
  script is done, so shots are next" is the pipeline order, not permission.
- Read `config.json` (`aspect_ratio`, `target_seconds`, `block_seconds`) and
  `world/characters.md`, `world/locations.md`, `world/props.md`.
- If `shotlist/shotlist.json` already has blocks, do **not** silently overwrite.
  Say how many blocks exist and confirm — regenerating replaces every prompt, and
  any block already rendered would need re-rendering to match.

## The unit is the block, not the shot

Seedance 2.5 renders **one block per call, up to 30 seconds**. A block is:

- **One location.** A location change is always a block boundary. No exceptions —
  this is what makes the last-frame chain coherent.
- **One set of character sheets**, cited once and binding for the whole block.
- **2–4 timed shots** inside it, each with its own framing and one clear action.
- **≤ 30 seconds.** Prefer a full 30s block to two short ones: blocks are billed per
  call, so two 15s blocks cost twice what one 30s block costs and add a seam.

`blocks = ceil(target_seconds / 30)`. A 2-minute film is 4 blocks. **Say the block
count and the credit cost out loud before you write the first prompt** (75 credits
per 30s block at 480p) — the author is entitled to know what they are about to spend.

## Steps

1. **Read the script.** Split on `## SCENE n — SLUGLINE`. Note every character who
   speaks, every location, every prop that has to stay consistent.
2. **Map scenes onto blocks.** Walk the script in order, accumulating estimated
   seconds (~145 words per minute of dialogue and acted action) until you hit 30s or
   the location changes. That is one block. A scene longer than 30s splits into
   consecutive blocks in the same location; several short scenes in one location can
   share a block.
3. **Plan the internal shots.** Inside each block, cut 2–4 shots the way a
   storyboard would — wide to establish, mediums for the exchange, a close-up on the
   turn. Give each a start and end second.
4. **Collect the references each block needs.** For every block list:
   - `characters` — exact names from `world/characters.md`. Verbatim. No short forms.
   - `location` — a stable slug reused across blocks (`noah-living-room`).
   - `props` — slugs for objects that must stay consistent.
   - `voices` — which characters speak in this block (drives the black-frame refs).
   - `video_refs` — only if a real motion or camera reference exists.
5. **Write the prompt — via the director skill for `config.video.model`** (for
   `seedance_2_5` that is `seedance-2-5-director`; install it with
   `bin/registry-add.py <model>` if it is missing). Load it and follow it. Do not write
   Seedance prompts from memory of this file; the director skill is where the craft
   lives and it is the reason blocks hold their blocking.
   The prompt must:
   - carry the block's spatial map, character identity locks, state locks and contact
     points once, up front;
   - number its timed shots with their seconds;
   - end with `Audio: … No music.`;
   - end with a **final frame** description that the next block can open from — a
     stable, lit, legible composition, never a blur or a whip-pan;
   - on any chained block, open `Shot 1` **on the anchor frame itself**: same shot size,
     same composition, same character positions as the previous block's final frame, and
     only then move. A `Shot 1` that introduces a new framing silently overrides the
     anchor — this is the single most common way the continuity chain fails, and it fails
     invisibly, because the room and the wardrobe still match;
   - contain **no art-style clauses**. The style comes from
     `prompts/video_style_prompt.txt`, appended at render time. A style baked into the
     block prompt fights the style file and the film stops matching itself.
6. **Write both files.** `shotlist/shotlist.json` is canonical and is what `/cast`
   and `/render` read. `shotlist/shotlist.md` is the same content for a human.

## shotlist.json shape

```json
{
  "title": "<title from config.json>",
  "aspect_ratio": "16:9",
  "block_seconds": 30,
  "blocks": [
    {
      "id": "block_01",
      "scene": 1,
      "location": "noah-living-room",
      "dur": 30,
      "characters": ["Noah", "Maya"],
      "props": ["board-game-pile"],
      "voices": ["Noah", "Maya"],
      "video_refs": [],
      "shots": [
        { "t": "0-10", "camera": "Wide, locked off", "action": "...", "dialogue": "..." },
        { "t": "10-22", "camera": "Medium two-shot, slow push-in", "action": "...", "dialogue": "..." },
        { "t": "22-30", "camera": "Close-up on Noah", "action": "...", "dialogue": "(none)" }
      ],
      "prompt": "Duration: 30 seconds. Aspect ratio: 16:9. Three timed shots ...",
      "final_frame": "Noah centre frame, eyes lifting toward Maya, both hands still on the rug.",
      "start_from_previous_last_frame": true,
      "anchor_prose": "@Image 1 is the first frame. It defines the opening composition, subject position, pose, prop state, scene, and camera direction."
    }
  ]
}
```

`start_from_previous_last_frame` is `false` on `block_01` (there is no previous
frame) and on any block that opens a **new location** where a hard cut is wanted.
It is `true` everywhere else. Continuity is the default; a cut is a decision.

## Chunked runs

"Generate the next block" writes **one** block, appends it, and stops. Record where
you stopped in `shotlist/shotlist.json` under `progress`:

```json
"progress": { "through_scene": 2, "through_block": "block_02",
              "note": "Maya has just had the idea; next block is the transformation.",
              "complete": false }
```

The whole point of a chunked run is that it comes back fast and the author reads it
before asking for more. Do not roll on into the next block.

## Do NOT

- Do not generate any image or video here. `/cast` makes references, `/render` makes
  clips.
- Do not pack a block over 30s. Seedance 2.5 caps at 30 and a 31-second block is
  silently clamped, which truncates the beat you wrote for the end.
- Do not cross a location inside a block.
- Do not write resolution into a prompt. It is a call parameter and it is 480p.
- Do not invent a character who is not in `world/characters.md`. If the script has
  one, add them to the world file first and say you did — an uncast character has no
  sheet and no voice, and `/cast` will stop.
