# Storyseam

A storytelling engine. An idea goes in; a finished film comes out.

```
idea ──▶ /start-story ──▶ /write-script ──▶ /shotlist ──▶ /cast ──▶ /render ──▶ /assemble ──▶ film.mp4
              scaffold        script          30s blocks    assets    clips        concat
```

Storyseam is **convention over configuration**. One command lays down a folder tree;
every later command finds what it needs by looking in known places. There is no
database, no server, no app — the filesystem is the state, so a story folder is
portable and any agent can pick it up mid-flight.

## Install

Clone it and point Claude Code at it, or copy `.claude/` into an existing project.
Requires the Higgsfield MCP server and `ffmpeg`.

## Use

```bash
mkdir my-film && cd my-film
```

Then, in Claude Code:

```
/start-story    A kid lands on his friend's house to play. For one second
                neither knows what to do. Then one of them has an idea.
                2 minutes, Pixar-style 3D, 16:9.
/write-script
/shotlist
/cast
/render
/assemble
```

`/script-agents` at any point shows which of the twenty-one specialists have read the
current draft and who to run next.

## What it makes

```
STORY.md  CLAUDE.md  config.json
script/{outline.md, script.md, drafts/, reviews.json}
world/{characters.md, locations.md, props.md}
prompts/{image_style_prompt.txt, video_style_prompt.txt}
shotlist/{shotlist.json, shotlist.md}
assets/images/{characters,locations,props}/
assets/audio/voices/  assets/audio/voices/blackframe/  assets/audio/music/
assets/video_refs/
renders/{clips,frames,final}/
.storyseam/{state.json, media.json}
```

## The rules it will not break

1. **No music.** Every video prompt says so. A human scores the film at the end, into
   `assets/audio/music/`.
2. **Video is Seedance 2.5 at 480p.** Always. Resolution is the cost lever.
3. **Images are GPT Image 2 at 2k.** Voices are cast with Seedance 2.0 fast (10s,
   480p) and stored as black-frame `.mp4` — the only form Seedance accepts as a voice
   reference.
4. **Higgsfield MCP only.** Never the CLI: it can pass one reference image, which
   breaks every character-anchored shot.
5. **One block at a time, chained.** The last frame of each clip becomes the first
   frame of the next. Never parallel — the chain *is* the continuity.

## Cost

| | Credits | Runs |
| --- | --- | --- |
| 30-second video block | 75 | 1 |
| Voice cast | 15 | 1 |
| Still (sheet / plate) | ~2.5 | 0 |

A 2-minute film with two speaking characters and one location: 4 blocks + 2 voices +
~5 stills ≈ **345 credits, 6 runs**.

## The model registry

Prompting is **model-specific craft**, not pipeline logic. Seedance 2.0 honours a real
`start_image` role; Seedance 2.5 declares it and ignores it. One skill covering both is wrong
for whichever model you are actually using — and we learned that by rendering a whole film
whose continuity chain silently did nothing.

So the pipeline lives in `.claude/skills/`, and the per-model craft lives in a **registry**:
one installable director skill per model, one route each. The agent resolves it from
`config.json`.

```bash
bin/registry-add.py --list                 # what the registry offers
bin/registry-add.py seedance_2_5           # install the director for that model id
bin/registry-add.py --all                  # install every director
```

```
/r/index.json              catalogue: every director, with sha256 and constraints
/r/models.json             model id -> director route (what the agent resolves against)
/r/skills/<name>.json      one route per director; carries the files to write
```

Each item is self-describing — it names its own destination paths — so the installer never
needs to know what a director is. Registry items are *copied into* your project, so you can
edit them; re-running the install overwrites with the published version.

| Model | Director | Notes |
| --- | --- | --- |
| `seedance_2_5` | `seedance-2-5-director` | 30s blocks, `omni_reference`, first frame declared in prose |
| `seedance_2_0` | `seedance-2-0-director` | 4-15s, real `start_image`/`end_image`, `fast` rejects audio refs |
| `gpt_image_2` | `gpt-image-2-director` | reference stills at 2k/high |

Adding a model is a directory under `registry/sources/` (a `meta.json` and a `SKILL.md`) and
`bin/registry-build.py <BASE_URL>`. The build fails loudly on a missing field, a
frontmatter/meta name mismatch, or two directors claiming the same model.

Published at `https://pub-597aecbeb0f64dee8c8894e4da9a211c.r2.dev/r`; override with
`STORYSEAM_REGISTRY`.

## The specialist room

Twenty-one subagents in `.claude/agents/`, run in stage order:

- **outline** — `story-architect` (and the arc experts: Hero's Journey, Story Circle,
  Three-Act, Save the Cat, Kishōtenketsu)
- **draft** — `scene-doctor`, `motivation-doctor`, `plot-doctor`, `character-doctor`,
  `theme-doctor`
- **polish** — `tension-doctor`, `dialogue-doctor`, `world-continuity`
- **lock** — `producer`, `performance-doctor`
- **on demand** — `voice-designer`, `punch-up`, `table-read`, `first-reader`

Sequence is load-bearing: polishing lines before the structure settles polishes lines
that are about to be cut.

## Credits

The script room and the shot-list discipline are distilled from
[shot-studio](https://github.com/) . The delegation and question-asking patterns
follow [obra/superpowers](https://github.com/obra/superpowers). The Seedance
directing craft is adapted from the Seedance 2.0 Pro Director skill.
