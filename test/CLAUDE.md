# Nothing To Do — a Storyseam story

This folder is a film. The filesystem is the state: there is no database and no app.
Any agent that opens this folder can pick up where the last one left off by reading
the tree below.

## Where everything is

| Path | What |
| --- | --- |
| `STORY.md` | premise, logline, decisions, status |
| `config.json` | models, **resolution**, aspect ratio, block length |
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
  video track by `bin/voice-to-blackmp4.sh`. **This is the file that goes into a
  render**, passed as `video_references`. Not `audio_references`.
- The prompt citing it must say: *"use the attached voice; ignore the black frames;
  output only the spoken dialogue — no music."*
- The `<slug>` matches the character's slug in `world/characters.md`. A mismatch means
  the wrong character speaks and nothing errors.

## The invariants

1. **No music, ever.** Every video prompt's audio line ends `No music.` A human scores
   the film after `/assemble`.
2. **Video is `seedance_2_5` at `480p`.** Never higher — resolution is the cost lever.
3. **Images are `gpt_image_2` at `2k`.**
4. **Higgsfield MCP only** (`mcp__claude_ai_higgsfield__*`), never the CLI. `ffmpeg`
   locally is expected.
5. **Blocks render one at a time, chained**: the last frame of block N is the
   `start_image` of block N+1. Character sheets are `image_references` — putting one
   in `start_image` makes the whole block look like the sheet.

## What to run next

```
/start-story ──▶ /write-script ──▶ /shotlist ──▶ /cast ──▶ /render ──▶ /assemble
```

Read the tree to find the stage: a script but no shot list means `/shotlist`; a shot
list with missing assets means `/cast`; clips but no `renders/final/` means
`/assemble`. `/render` resumes from `.storyseam/state.json` — it never re-renders a
block that is already on disk.

## Money

`75` credits and 1 run per 30-second block. `15` credits and 1 run per voice cast.
`~2.5` credits per still. Both counters live in `.storyseam/state.json`. Announce them
as you go; when the author sets a run budget it is a hard stop, not a target.
