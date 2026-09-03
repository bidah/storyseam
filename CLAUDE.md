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
4. **The backend is configuration, not code.** `config.json` names a provider per
   capability: `higgsfield` (the default, reached through `mcp__claude_ai_higgsfield__*`),
   `atlas` or `fal` (reached with an API key the user exports; Storyseam never handles
   the value). Verify access with `bin/provider-check.py` before spending, and never
   fall back to another provider silently. Never the `higgsfield` CLI — it can only
   pass one reference image, which breaks every character-anchored shot. `ffmpeg` for
   local frame/audio work is fine and expected.
5. **One clip at a time, chained.** Blocks render sequentially. The last frame of
   block N is the **first `image_references` entry** of block N+1, declared in the
   prompt as `@Image 1 is the first frame`. Never `start_image` — Seedance 2.5
   accepts the role and ignores it (see `docs/seedance-2.5-research.md`). Never fan
   out video generation in parallel — the chain is the continuity.

## Resolution & model settings

Every story's `config.json` carries these, and `/start-story` writes them. They are
the single source of truth; a skill reads the config rather than hardcoding.

| What | Model | Resolution | Notes |
| --- | --- | --- | --- |
| Stills (characters, locations, props) | `gpt_image_2` | `2k` | `quality: "high"`, aspect from config |
| Video blocks | `seedance_2_5` | `480p` | **never higher**; 4–30s; `generate_audio: true` |
| Final assembly | ffmpeg concat | 854×480 | matches the block resolution; upscale is a separate, human decision |

Aspect ratio is one project-wide value (`16:9` cinematic, `9:16` vertical). Video,
location plates and prop plates use it. Character sheets are portrait (`3:4`) whatever
the film is: a sheet is a figure the film cites, not a frame it matches. The image
director owns that call.

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

- **Every reference image goes in `image_references`** (repeatable), the continuity
  anchor **first**, and the prompt says which is which (`@Image 1 is the first frame`,
  `@Image 2 defines <character>'s face and wardrobe only`). `start_image` is a
  Seedance 2.0 role; on 2.5 it is accepted, recorded on the job, and ignored.
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

## Per-model craft and per-backend plumbing live in the registry

`.claude/skills/` holds the pipeline. The **director** skills (how to prompt one model)
and the **provider** skills (how to submit a job to one backend) are installed from the
registry and git-ignored:

```bash
bin/registry-add.py --list          # the catalogue
bin/registry-add.py --all           # everything (do this on a fresh clone)
bin/registry-add.py seedance_2_5    # the default director for a model id in config.json
bin/registry-add.py provider-atlas  # a provider adapter, by name
```

`/shotlist` writes every block prompt through the director for `config.video.model`;
`/cast` writes every still through the director for `config.image.model`. If the
director for a configured model is not installed, install it — never prompt from memory.
See the `model-directors` and `providers` skills.

## The files the stages hand each other

`shotlist/shotlist.json`, `.storyseam/state.json` and `.storyseam/media.json` are the
seams between `/shotlist`, `/cast` and `/render`. Their shapes are fixed in `schema/` and
checked by `bin/story-check.py`. A skill that adds or renames a field updates the schema
in the same change. `CONTEXT.md` is the glossary; `docs/adr/` records the decisions that
look wrong until you know why.

## Working on the engine itself

- Skills live in `.claude/skills/<name>/SKILL.md`. Subagents live in `.claude/agents/`.
- Director and provider skills are edited in `registry/sources/<name>/`, then
  `bin/registry-build.py <BASE_URL>` and `bin/registry-add.py --all` to reinstall. Editing
  the installed copy under `.claude/skills/` is lost on the next install.
- Stories used for testing live under `test/`. Nothing in the engine may name a test
  story's title, characters or premise — examples use placeholder names.
- A skill is instructions for a model, not documentation for a human. Write the
  failure mode, not the happy path — the happy path is what the model already does.
- When you change a rule that appears in more than one skill (the five above are all
  like this), change it everywhere. A rule stated in one skill and contradicted in
  another is worse than a rule stated nowhere.
