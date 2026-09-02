# Storyseam — a storytelling engine

Storyseam turns an idea into a finished film. It is **convention over configuration**:
one command scaffolds a story folder, and every later command finds what it needs by
looking in known places. There is no database, no server, no app. The filesystem is
the state.

```
idea ──▶ /start-story ──▶ /write-script ──▶ /shotlist ──▶ /cast ──▶ /render ──▶ /assemble ──▶ film.mp4
              scaffold        script          30s blocks    assets    clips        concat
```

## The five hard rules

These are not defaults. They are invariants. Every skill restates them because
every skill can break them.

1. **NEVER generate music.** Not a score, not a sting, not a "subtle ambient bed".
   Every video prompt ends with an audio line that says *no music*. Music is added
   by a human at the end, into `assets/audio/music/`. A render that comes back with
   music in it is a failed render.
2. **Video is Seedance 2.5 at 480p. Always 480p.** Never 720p, never 1080p.
   `seedance_2_5` is expensive and the resolution is the cost lever.
3. **Images are GPT Image 2 at 2k.** `gpt_image_2`, `resolution: "2k"`.
4. **Higgsfield MCP only.** `mcp__claude_ai_higgsfield__*`. Never the `higgsfield`
   CLI — it can only pass one reference image, which breaks every character-anchored
   shot. `ffmpeg` for local frame/audio work is fine and expected.
5. **One clip at a time, chained.** Blocks render sequentially. The last frame of
   block N becomes the `start_image` of block N+1. Never fan out video generation
   in parallel — the chain is the continuity.

## Resolution & model settings

Every story's `config.json` carries these, and `/start-story` writes them. They are
the single source of truth; a skill reads the config rather than hardcoding.

| What | Model | Resolution | Notes |
| --- | --- | --- | --- |
| Stills (characters, locations, props) | `gpt_image_2` | `2k` | `quality: "high"`, aspect from config |
| Video blocks | `seedance_2_5` | `480p` | **never higher**; 4–30s; `generate_audio: true` |
| Final assembly | ffmpeg concat | 854×480 | matches the block resolution; upscale is a separate, human decision |

Aspect ratio is one project-wide value (`16:9` cinematic, `9:16` vertical). Images and
video must use the same one or the stills will not match the frames they anchor.

## Where character voices live — and in what format

A character's voice is an **asset on disk**, cast once and reused by every block that
character speaks in. It is stored in two forms, and the second is the one Seedance
actually accepts:

```
assets/audio/voices/<character-slug>.mp3          the voice itself (source of truth)
assets/audio/voices/blackframe/<character-slug>.mp4   the black-frame encode Seedance takes
```

- **`<slug>.mp3`** — the clean voice take. Cast it with `seedance_2_0` (`mode: "fast"`,
  `duration: 10`, `resolution: "480p"`, ~15 credits) generating the character
  speaking a short paragraph, then strip the audio out of that clip. Seedance 2.0
  fast is used here *because* it is cheap — voice casting is a fixture cost, not a
  shot.
- **`blackframe/<slug>.mp4`** — the same audio muxed against a black video track by
  `bin/voice-to-blackmp4.sh`. **This file, passed as `video_references`, is how a
  voice reaches a render.** Not `audio_references`, which is a different, narrower
  path and rejects `mode: "fast"` outright.
- In the prompt that cites it, say so explicitly: *"use the attached voice; ignore
  the black frames; output only the spoken dialogue — no music."*
- One voice per character, named by the character's slug from `world/characters.md`.
  A slug mismatch means the wrong character speaks, and it is silent until you watch
  the clip.

`assets/audio/music/` is the one folder Storyseam never writes to. A human drops the
score there after `/assemble`.

## The Higgsfield facts that cost the most to relearn

- **Reference images go in `image_references`** (repeatable). Only the continuity
  anchor goes in `start_image`. Putting a character sheet in `start_image` silently
  makes the whole shot look like the sheet.
- **Voice references are black-frame `.mp4` files passed as `video_references`.**
  Not `audio_references`. Encode the voice with
  `bin/voice-to-blackmp4.sh`, pass it as `video_references`, keep
  `generate_audio: true`, and tell the model in the prompt: *"use the attached
  voice; ignore the black frames; output only the spoken dialogue — no music."*
- **`medias[].value` must be a `media_id`**, never an `https://` URL and never a
  prior `job_id`. Local file → `media_upload` → `curl -X PUT` → `media_confirm`.
  The `Content-Type` on the PUT must match the signed type or the upload fails
  silently and the render 404s later.
- **`.mov` is rejected.** Re-encode to `.mp4` (`libx264` + `aac`).
- If `generate_video` returns a `preset_recommendation`, resend the identical call
  with `declined_preset_id: "<id>"` to render the prompt literally.
- Preflight cost with `get_cost: true` before any run you are not sure about.
  30s @ 480p ≈ 75 credits. A 2-minute film ≈ 300 credits.

## Commands

| Command | What it does |
| --- | --- |
| `/start-story` | Scaffolds the convention in the current folder. Interviews for premise. |
| `/write-script` | Beat outline → screenplay, with the specialist room available. |
| `/script-agents` | The board: which doctors have read this draft, who to run next. |
| `/shotlist` | Signed script → ordered shots packed into ≤30s Seedance blocks. |
| `/cast` | Audits every reference the shotlist needs; generates what is missing. |
| `/render` | Renders blocks one at a time, chaining last frame → next start frame. |
| `/assemble` | ffmpeg-concats the clips into `renders/final/`. |

Each is a thin wrapper that loads the matching skill in `.claude/skills/`.

## Working on the engine itself

- Skills live in `.claude/skills/<name>/SKILL.md`. Subagents live in `.claude/agents/`.
- A skill is instructions for a model, not documentation for a human. Write the
  failure mode, not the happy path — the happy path is what the model already does.
- When you change a rule that appears in more than one skill (the five above are all
  like this), change it everywhere. A rule stated in one skill and contradicted in
  another is worse than a rule stated nowhere.
