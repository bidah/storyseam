# {{TITLE}} — a Storyseam story

This folder is a film. The filesystem is the state: there is no database and no app.
Any agent that opens this folder can pick up where the last one left off by reading
the tree below.

{{RUNTIME}}

## Where everything is

| Path | What |
| --- | --- |
| `storyseam.md` | premise, logline, decisions, status |
| `config.json` | **providers**, models, **resolution**, aspect ratio, block length |
| `script/script.md` | **the script** — the current draft, the one true version |
| `script/drafts/` | immutable snapshots (`script.v1.md`, …). Never edit these. |
| `script/outline.md` | the beat outline the script was written from |
| `script/reviews.json` | which specialists read which draft, and what they found |
| `world/characters.md` | the roster — names here are canonical and used verbatim |
| `world/locations.md` · `world/props.md` | places and objects that must stay consistent |
| `prompts/image_style_prompt.txt` | appended to **every** image generation |
| `prompts/video_style_prompt.txt` | appended to **every** video generation |
| `shotlist/shotlist.json` | canonical shot list, packed into ≤30s blocks |
| `assets/images/{characters,locations,props}/` | the reference stills, `<slug>.png` |
| `assets/audio/voices/<slug>.mp3` | each character's voice take |
| `assets/audio/voices/blackframe/<slug>.mp4` | **the form Seedance accepts** — see below |
| `assets/audio/music/` | **human-filled, at the end.** Storyseam never writes here. |
| `assets/video_refs/` | motion / camera reference clips, if any |
| `renders/clips/block_NN.mp4` | one clip per Seedance run |
| `renders/frames/block_NN_last.jpg` | the continuity chain |
| `renders/final/` | the assembled film |
| `.storyseam/state.json` | render progress, job ids, credits and runs spent |
| `.storyseam/media.json` | local path → Higgsfield `media_id` cache |

## Character voices are stored in two forms

A voice is cast once and reused by every block that character speaks in.

- `assets/audio/voices/<slug>.mp3` — the take. Cast with `seedance_2_0`
  (`mode: "fast"`, `duration: 10`, `resolution: "480p"`, ~15 credits): generate the
  character speaking a short paragraph in their own voice, then keep the audio.
- `assets/audio/voices/blackframe/<slug>.mp4` — the same audio muxed against a black
  video track by `{{VOICE_TOOL}}`. **This is the file that goes into a
  render**, passed as `video_references`. Not `audio_references`.
- The prompt citing it must say: *"use the attached voice; ignore the black frames;
  output only the spoken dialogue — no music."*
- The `<slug>` matches the character's slug in `world/characters.md`. A mismatch means
  the wrong character speaks and nothing errors.

## The invariants

<!-- rules: generated from CLAUDE.md, do not edit here -->
1. **Never generate music.** Every video prompt ends with the canonical audio line, and a render that comes back with music is a failed render.
2. **Video is rendered at 480p.** A story may not raise the video resolution, because resolution is the cost lever, whichever model renders it.
3. **Images are GPT Image 2 at 2k.** Every still — character sheet, location plate, prop plate — is `gpt_image_2` at `resolution: "2k"`, `quality: "high"`, because a soft reference poisons every block that cites it.
4. **The backend is configuration.** `config.json` names a provider per capability: `higgsfield` (the default, reached through `mcp__claude_ai_higgsfield__*`), `atlas` or `fal` (reached with an API key the author exports; Storyseam never handles the value).
5. **One block at a time, chained.** Blocks render sequentially, and the last frame of block N is the first `image_references` entry of block N+1, declared in the prompt as `@Image1 is the first frame`.
<!-- /rules -->

## What to run next

```
/start-story ──▶ /write-script ──▶ /shotlist ──▶ /cast ──▶ /render ──▶ /edit
```

{{STAGES}}

Read the tree to find the stage: a script but no shot list means `/shotlist`; a shot
list with missing assets means `/cast`; clips but no `renders/final/` means
`/edit`, which cuts the film in the program `config.json` `editor` names (or alone with
ffmpeg when it is `none`). `/render` resumes from `.storyseam/state.json` — it never re-renders a
block that is already on disk.

## Money

One run per video call (a block, a voice cast, a retry). Credits per unit are in
`config.json` under `costs`; a block can bill above `costs.block_30s`, so every tally is
a floor. Both counters live in `.storyseam/state.json`. Announce them as you go; when
the author sets a run budget it is a hard stop, not a target.
