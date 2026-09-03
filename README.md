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

```bash
git clone <this repo> storyseam && cd storyseam
bin/registry-add.py --all        # the per-model director and provider skills
bin/provider-check.py --all      # what each backend needs from you
```

Requires `python3` (3.9+), `ffmpeg`/`ffprobe`, and a backend: the Higgsfield MCP server
connected in your client (the default), or an API key exported for Atlas Cloud or fal.ai.

The director and provider skills under `.claude/skills/` are **build output**, installed
from the registry and git-ignored. A fresh clone has the pipeline skills only; run the
install line above before the first story.

## Use

Stories are folders. Open Claude Code in the engine checkout and scaffold each story into
its own subfolder, so `bin/` stays reachable and the story stays portable:

```bash
mkdir my-film && cd my-film
```

Then, in Claude Code:

```
/start-story    <one or two sentences: who wants what, and what is in the way.
                 Add a runtime, a look, and 16:9 or 9:16 if you already know them>
/write-script
/shotlist
/cast
/render
/assemble
```

Anything you leave out of the first line, `/start-story` asks for in one message.

Not on Claude Code? `AGENTS.md` (the cross-tool convention) is a symlink to `CLAUDE.md`
at the root and in every story, and its first sections say how the slash commands, the
specialist room and the MCP tool names translate to any other agent.

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

### Checking a story

```bash
bin/asset-audit.sh <story>     # every reference the shot list cites: present, uploaded, stale
bin/story-check.py <story>     # the state files against schema/, plus the cross-file checks
bin/provider-check.py          # is the configured backend reachable, without printing a key
bin/rules-check.py             # engine only: the five rules have one owner and no contradiction
```

All four are free and dependency-free. The first three check a story; the last checks the
engine itself and is what to run before committing a change to a skill. `schema/` holds the JSON schemas for the files the
skills hand each other: `shotlist.json`, `state.json`, `media.json`. They are the contract
between `/shotlist`, `/cast` and `/render`; a skill that changes a field changes the schema.

## The rules it will not break

<!-- rules: generated from CLAUDE.md, do not edit here -->
1. **Never generate music.** Every video prompt ends with the canonical audio line, and a render that comes back with music is a failed render.
2. **Video is Seedance 2.5 at 480p.** A story may not raise the video resolution, because resolution is the cost lever.
3. **Images are GPT Image 2 at 2k.** Every still — character sheet, location plate, prop plate — is `gpt_image_2` at `resolution: "2k"`, `quality: "high"`, because a soft reference poisons every block that cites it.
4. **The backend is configuration.** `config.json` names a provider per capability: `higgsfield` (the default, reached through `mcp__claude_ai_higgsfield__*`), `atlas` or `fal` (reached with an API key the author exports; Storyseam never handles the value).
5. **One block at a time, chained.** Blocks render sequentially, and the last frame of block N is the first `image_references` entry of block N+1, declared in the prompt as `@Image 1 is the first frame`.
<!-- /rules -->

## Cost

The prices live in each story's `config.json` under `costs`, and every script and skill
reads them from there. These are the defaults `/start-story` ships with:

| | Credits | Runs |
| --- | --- | --- |
| 30-second video block | 75 | 1 |
| Voice cast | 15 | 1 |
| Still (sheet / plate) | ~2.5 | 0 |

A 2-minute film with two speaking characters and one location: 4 blocks + 2 voices +
~5 stills ≈ **345 credits, 6 runs**. That is a floor: a block can bill above the default
(the reference film's first block billed 105), and a block that comes back wrong is
re-rendered at full price. Preflight with `get_cost: true` when unsure.

## Providers — the backend is configuration

Storyseam is provider-agnostic. The script, the shot list, the block structure and the
continuity chain do not change when the backend does; what changes is how a job is submitted,
how media is passed, and how access is proven. That lives in a **provider adapter**,
installed from the registry like any other skill.

```json
"providers": {
  "video": { "id": "higgsfield", "access": "mcp" },
  "image": { "id": "atlas", "access": "api_key", "key_env": "ATLAS_KEY" }
}
```

A provider is named **per capability**, so a story can render video on one backend and stills
on another. Two access types:

- **`mcp`** — the user connects the MCP server in their client. Storyseam cannot install it.
- **`api_key`** — the user exports the named env var. **`key_env` names a variable, never a
  value**; `config.json` is committed, and a key in it is a leaked key.

```bash
bin/provider-check.py            # is access satisfied for this story?
bin/registry-add.py provider-atlas
```

`provider-check.py` reports whether a variable is **set** and its **length** — never its
value, so a truncated paste is diagnosable without the secret being displayed. Storyseam
never asks for a key in chat and never writes one to disk.

| | Higgsfield | Atlas Cloud | fal.ai |
| --- | --- | --- | --- |
| Access | `mcp` | `api_key` (`ATLAS_KEY`) | `api_key` (`FAL_KEY`) |
| Job shape | MCP tools | one prediction API, model in the body | a queue per endpoint, model in the path |
| Reference media | upload → confirm → `media_id` | plain public URLs | plain public URLs |
| Voice reference | black-frame `.mp4` | **`reference_audios`, native lip-sync** | no Seed Audio equivalent |
| Billing | credits | credits | **dollars, token-based** |
| Seedance 2.5 | ✅ to 1080p | ✅ | ✅ to 720p |
| `gpt_image_2` | ✅ | ✗ (use `nano_banana_2`) | ✗ |

Two consequences worth knowing before switching: on the API-key providers the reference
stills must be **publicly reachable URLs**, so they have to be published before a render; and
the **black-frame voice trick is a Higgsfield workaround**, not a Seedance requirement — on
Atlas you pass the `.mp3` straight into `reference_audios`.

## The model registry

Prompting is **model-specific craft**, not pipeline logic. Seedance 2.0 honours a real
`start_image` role; Seedance 2.5 declares it and ignores it. One skill covering both is wrong
for whichever model you are actually using — and we learned that by rendering a whole film
whose continuity chain silently did nothing.

So the pipeline lives in `.claude/skills/`, and the per-model craft lives in a **registry**:
one installable director skill per model, one route each. The agent resolves it from
`config.json`.

```bash
bin/registry-add.py --list                            # catalogue, grouped by model
bin/registry-add.py seedance_2_5                      # the DEFAULT for that model id
bin/registry-add.py seedance-2-5-extension-director   # an alternate, by name
bin/registry-add.py --model seedance_2_5 --all        # everything compatible with a model
```

```
/r/index.json           catalogue: every skill, with models[], default_for[], sha256, constraints
/r/models.json          model id -> { default, skills[], routes{} }
/r/skills/<name>.json   one route per skill; carries the files to write
```

**A model can carry several skills.** Each declares `models` (what it is compatible with —
an array, because `seedance-voice-casting` works identically on 2.0 and 2.5) and
`default_for` (the subset it owns). A bare model id installs the default; an alternate is
asked for by name. Exactly one default per model, enforced by the build.

Each item is self-describing — it names its own destination paths — so the installer never
needs to know what a director is. Registry items are *copied into* your project, so you can
edit them; re-running the install overwrites with the published version.

| Model | Skill | | Notes |
| --- | --- | --- | --- |
| `seedance_2_5` | `seedance-2-5-director` | default | 30s blocks, `omni_reference`, first frame declared in prose |
| `seedance_2_5` | `seedance-2-5-extension-director` | alt | frame-exact seams via `video_extension` |
| `seedance_2_0` | `seedance-2-0-director` | default | 4-15s, real `start_image`/`end_image`, `fast` rejects audio refs |
| `seedance_2_0` `seedance_2_5` | `seedance-voice-casting` | alt | black-frame `.mp4` voice references |
| `gpt_image_2` | `gpt-image-2-director` | default | reference stills at 2k/high |

Adding a model is a directory under `registry/sources/` (a `meta.json` and a `SKILL.md`) and
`bin/registry-build.py <BASE_URL>`. The build fails loudly on a missing field, a
frontmatter/meta name mismatch, two directors claiming the same model, or a model no
provider serves. The installer verifies each item's `sha256` before writing it and refuses
any path outside `.claude/skills/`.

The built registry is checked in at `registry/r/`, and the installer reads it from there by
default, so a fresh clone installs with no network. Set `STORYSEAM_REGISTRY` to a URL (the
published copy lives at `https://pub-597aecbeb0f64dee8c8894e4da9a211c.r2.dev/r`) or to
another local directory to install from somewhere else.

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

The script room and the shot-list discipline are distilled from an earlier internal
project, shot-studio. The delegation and question-asking patterns follow
[obra/superpowers](https://github.com/obra/superpowers). The Seedance directing craft is
adapted from the Seedance 2.0 Pro Director skill and the sources listed in
`docs/seedance-2.5-research.md`.
