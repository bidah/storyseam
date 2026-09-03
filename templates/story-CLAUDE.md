# {{TITLE}} — a Storyseam story

This folder is a film. The filesystem is the state: there is no database and no app.
Any agent that opens this folder can pick up where the last one left off by reading
the tree below.

```
STORYSEAM_HOME={{ENGINE}}
```

That is the Storyseam engine this story was scaffolded from. Its `bin/` holds the
scripts named below and its `.claude/` holds the pipeline skills and the specialist
room. Run every script as `$STORYSEAM_HOME/bin/<script> [this folder]`, or export
`STORYSEAM_ROOT` to this folder first; each script takes the story root either way.

## Where everything is

| Path | What |
| --- | --- |
| `STORY.md` | premise, logline, decisions, status |
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
  video track by `$STORYSEAM_HOME/bin/voice-to-blackmp4.sh`. **This is the file that goes into a
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
4. **The backend is configuration.** `config.json` names a provider per capability.
   `higgsfield` is reached by MCP; `atlas` and `fal` by an API key the user exports
   (`ATLAS_KEY` / `FAL_KEY`) — **never stored in this folder**. Verify with
   `$STORYSEAM_HOME/bin/provider-check.py` before spending.
5. **Blocks render one at a time, chained**: the last frame of block N is the first
   `image_references` entry of block N+1, declared in the prompt as `@Image 1 is the
   first frame`. Never `start_image` — Seedance 2.5 accepts it and ignores it. The
   character sheets follow it in the same list, each labelled in prose.

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
