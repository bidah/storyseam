---
name: story-engine
description: >-
  Storyseam's router and invariants. Load when the user asks what Storyseam is, what
  to do next, where they are in the pipeline, or asks for something spanning more
  than one stage ("make me a 2 minute film about X"). Holds the five hard rules, the
  folder convention, and the state-detection logic that decides which stage comes
  next. Individual stages have their own skills; this one decides which.
---

# Storyseam — the engine

```
idea ──▶ /start-story ──▶ /write-script ──▶ /shotlist ──▶ /cast ──▶ /render ──▶ /assemble
```

## The five hard rules

Restate these whenever a stage is about to break one.

1. **Never generate music.** Every video prompt's audio line ends `No music.` The
   human scores the film after `/assemble`, into `assets/audio/music/`.
2. **Video is `seedance_2_5` at `480p`.** Always. Resolution is the cost lever.
3. **Images are `gpt_image_2` at `2k`.** Voices are cast with `seedance_2_0` fast,
   10s, 480p, and stored as black-frame `.mp4` in `assets/audio/voices/blackframe/`.
4. **Higgsfield MCP only** (`mcp__claude_ai_higgsfield__*`), never the CLI. `ffmpeg`
   locally is expected.
5. **Blocks render one at a time, chained** — the last frame of block N is passed as the
   FIRST `image_references` entry of block N+1 and declared in prose as `@Image 1 is the
   first frame`. Never `start_image` (2.5 ignores it), and never in parallel.

## Where are we? — read the folder, don't ask

The filesystem is the state. Detect the stage and name the next command:

| On disk | Stage | Next |
| --- | --- | --- |
| no `STORY.md` | nothing yet | `/start-story` |
| `STORY.md`, no `script/script.md` (or it is empty) | scaffolded | `/write-script` |
| a script, no `shotlist/shotlist.json` | written | `/shotlist` (once the author is happy) |
| a shot list, missing assets | shot-listed | `/cast` |
| assets complete, no clips | cast | `/render` |
| some clips, not all | rendering | `/render` (it resumes) |
| all clips, no `renders/final/` | rendered | `/assemble` |
| a film | done | hand it over; music is the human's |

## Running the whole pipeline in one go

When the author asks for a finished film from a premise, you may run every stage —
but the two gates still hold, because they are the two places money and authorship
are decided:

- **After `/write-script`**, show the script and its runtime estimate. The script is
  the film; a bad one renders exactly as expensively as a good one.
- **Before `/render`**, state the block count, the cost, and the run budget.

Everything else can flow. Do not stop to ask which arc to use or what the character
sheets should look like — those are decisions this engine is built to make.

## Budgets are counted, not estimated

Two numbers matter and both live in `.storyseam/state.json`:

- **`credits_spent`** — 75 per 30s block, 15 per voice cast, ~2 per image.
- **`runs_used`** — every `generate_video` call, including voice casts and retries.

Announce them as you go. When the author sets a run budget, it is a hard stop, not a
target: report what is done and what remains rather than spending the next one.

## The convention

```
STORY.md  CLAUDE.md  config.json
script/{outline.md, script.md, drafts/, reviews.json}
world/{characters.md, locations.md, props.md}
prompts/{image_style_prompt.txt, video_style_prompt.txt}
shotlist/{shotlist.json, shotlist.md}
assets/images/{characters,locations,props}/   assets/audio/{voices,voices/blackframe,music}/
assets/video_refs/
renders/{clips,frames,final}/
.storyseam/{state.json, media.json}
```

Nothing outside this tree is state. If a stage needs a value, it is in `config.json`
or it is a decision, and decisions are the author's.
