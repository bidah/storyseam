# Storyseam

**A folder convention for describing a film to coding agents.** Storyseam gives an agent a
persistent, structured understanding of a story in production — what it is about, what has
been decided, what has been made, and what comes next.

```
idea ──▶ /start-story ──▶ /write-script ──▶ /shotlist ──▶ /cast ──▶ /render ──▶ /edit ──▶ film.mp4
              scaffold        script          30s blocks    assets    clips        concat
```

> Status: **alpha.** The seam schemas and the CLI surface may still change.

## The Format

A Storyseam story is a **folder**, and the folder is the whole format. There is no database,
no server and no app: the filesystem is the state, so a story is portable, diffable, and any
agent can pick it up mid-flight.

The format has two layers, and both matter:

- **Machine-readable state** — `config.json`, `shotlist/shotlist.json`,
  `.storyseam/state.json`, `.storyseam/media.json`. These are the seams the stages hand each
  other. Their shapes are fixed in `schema/` and checked by `storyseam check`.
- **Human-readable rationale** — `storyseam.md`, `script/`, `world/`, `prompts/`, and the skills
  themselves. Prose carries the *why*: which arc was chosen and what it would wreck to
  change, why this location is one location, what a character sounds like.

Tokens without rationale produce a film that is internally consistent and lifeless. Rationale
without tokens produces one that cannot be rendered twice the same way. Storyseam keeps both
in known places, which is what lets every later command run **convention over configuration** —
`/cast` finds character sheets in `assets/images/characters/` without being told, and
`/render` resumes from `state.json` without being told what is already done.

**Absence is meaningful.** `script/script.md` is deliberately not created by the scaffold,
because its absence is how the engine knows the script is unwritten. Read the tree and you
know the stage: a script but no shot list means `/shotlist`; clips but no `renders/final/`
means `/assemble`.

## The `storyseam.md` file

Every story has one `storyseam.md` at its root, the way a design system has one
`design.md`: YAML front matter holding the tokens (`title`, `logline`, `look`, `arc`,
`language`, `audience`), then prose holding the rationale (`## Premise`, `## Shape`,
`## Decisions`, `## Budget`, `## Status`). It is the first file an agent reads and the
index into everything else. It never copies a value another file owns, so render
settings stay in `config.json` and names stay in `world/`. The full specification is
[`docs/spec.md`](docs/spec.md), and a rendered example is [`test/storyseam.md`](test/storyseam.md).

```markdown
---
storyseam: 0.1
title: Nothing To Do
logline: Milo comes over to play. For one long second, neither boy can think of a single thing to do.
look: Pixar-style 3D animation, warm late-afternoon light
arc: kishotenketsu
---
# Nothing To Do

## Premise
...
## Decisions
- **One physical location** for all four blocks. The point is that the *same* room becomes extraordinary.
```

## Getting Started

```bash
npx storyseam init my-film
```

It asks two things — a working title, and which agent you write with — then installs the
whole engine into that folder: the pipeline skills, the 21 specialists, the schemas, the
decision records, and the per-model director and provider skills its `config.json` asks for.
The folder is self-contained afterwards; there is no engine to keep beside it.

Requires `node` 18.17+, `ffmpeg`/`ffprobe`, and a backend: the Higgsfield MCP server
connected in your client (the default), or an API key exported for Atlas Cloud or fal.ai.

Then open your agent in that folder and work the pipeline:

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
`/script-agents` at any point shows which of the twenty-one specialists have read the
current draft and who to run next.

## The Specification

```
storyseam.md                 premise, logline, decisions, status
CLAUDE.md / AGENTS.md        how an agent works in THIS story
config.json                  providers, models, resolution, aspect, block length
script/
  outline.md                 the beat outline, approved before any pages exist
  script.md                  the pinned draft — the one true script
  drafts/                    script.v1.md, ... immutable snapshots
  reviews.json               the specialist ledger
world/
  characters.md              the roster; names here are canonical and used verbatim
  locations.md  props.md     what must stay consistent
prompts/
  image_style_prompt.txt     appended to EVERY image generation
  video_style_prompt.txt     appended to EVERY video generation
shotlist/
  shotlist.json              canonical, machine-read by /cast and /render
  shotlist.md                the same list, readable
assets/
  images/{characters,locations,props}/   reference stills, <slug>.png
  refs/{characters,locations,props}/<slug>/   HUMAN-FILLED: your own photos to build sheets from
  audio/voices/<slug>.mp3                the voice take
  audio/voices/blackframe/<slug>.mp4     the form Seedance actually accepts
  audio/music/                           HUMAN-FILLED. Storyseam never writes here.
  video_refs/
renders/
  clips/block_NN.mp4         one clip per run
  frames/block_NN_last.jpg   the continuity chain
  final/                     the assembled film
.storyseam/
  state.json                 render progress, job ids, credits and runs spent
  media.json                 local path -> provider media_id cache
```

`config.json` is the single source of truth for models, resolution and price. Two of its
fields are engine rules rather than preferences:

```json
{
  "aspect_ratio": "16:9",
  "target_seconds": 120,
  "block_seconds": 30,
  "image": { "model": "gpt_image_2", "resolution": "2k", "quality": "high" },
  "video": { "model": "seedance_2_5", "resolution": "480p", "generate_audio": true },
  "costs": { "block_30s": 75, "voice": 15, "still": 2.5 }
}
```

Video is `480p` because resolution is the cost lever; stills are `2k` because a soft
reference poisons every block that cites it.

### The rules it will not break

Five invariants, written in exactly one file and generated into every copy. A build check
fails if a copy drifts, or if any skill anywhere contradicts one.

<!-- rules: generated from CLAUDE.md, do not edit here -->
1. **Never generate music.** Every video prompt ends with the canonical audio line, and a render that comes back with music is a failed render.
2. **Video is rendered at 480p.** A story may not raise the video resolution, because resolution is the cost lever, whichever model renders it.
3. **Images are GPT Image 2 at 2k.** Every still — character sheet, location plate, prop plate — is `gpt_image_2` at `resolution: "2k"`, `quality: "high"`, because a soft reference poisons every block that cites it.
4. **The backend is configuration.** `config.json` names a provider per capability: `higgsfield` (the default, reached through `mcp__claude_ai_higgsfield__*`), `atlas` or `fal` (reached with an API key the author exports; Storyseam never handles the value).
5. **One block at a time, chained.** Blocks render sequentially, and the last frame of block N is the first `image_references` entry of block N+1, declared in the prompt as `@Image 1 is the first frame`.
<!-- /rules -->

### Character voices are stored in two forms

A voice is cast once and reused by every block that character speaks in.

- `assets/audio/voices/<slug>.mp3` — the take, cast with `seedance_2_0` fast (~15 credits).
- `assets/audio/voices/blackframe/<slug>.mp4` — the same audio muxed against a black video
  track. **This is the file a render takes**, passed as `video_references`, not
  `audio_references`. Build it with `npx storyseam voice <slug>`.

The `<slug>` matches the character's slug in `world/characters.md`. A mismatch means the
wrong character speaks, and nothing errors — you find out by watching the clip.

## CLI Reference

| Command | What |
| --- | --- |
| `npx storyseam init [folder]` | scaffold a story and install the skills for your agent |
| `npx storyseam list` | the registry catalogue, grouped by model |
| `npx storyseam add <model\|skill>` | install one more skill — an alternate director, another provider |
| `npx storyseam update` | reinstall what `config.json` names, from the registry |
| `npx storyseam assets` | write `shotlist/assets.json`: every sheet and plate needed, and whether each is made from your references or generated |
| `npx storyseam preview <block>` | the HTML previewer for a block before it is sent: the exact prompt, references in order, model, settings, cost (`--open`) |
| `npx storyseam preset list` / `add <section/id or url>` / `page` | prompt presets (look, camera, audio): shareable pre-prompts every video prompt carries; see [storyseam.app/presets](https://storyseam.app/presets) |
| `npx storyseam camera` | the camera presets page; `--set <id>` installs one |
| `npx storyseam recommend` | the video model each block should use, from its length and reference count |
| `npx storyseam check` | validate the machine-read files against `schema/` |
| `npx storyseam audit` | every reference the shot list cites, vs. what is on disk and uploaded |
| `npx storyseam providers` | is the backend reachable? (never reads a key's value) |
| `npx storyseam voice <slug>` | mux a cast voice into the black-frame mp4 Seedance takes |
| `npx storyseam last-frame <clip>` | pull a block's final frame for chaining |

`check` and `audit` are free and are meant to be run before anything is spent. `audit` prices
what is missing, so you see the bill before you agree to it.

## Agent Interoperability

The format is tool-agnostic. `init` asks which agent you use, and the answer changes only
**where the same files land** — because that is all that actually differs between tools.

| Target | Skills | Specialists | Entry file |
| --- | --- | --- | --- |
| Claude Code | `.claude/skills/` | `.claude/agents/` | `CLAUDE.md` (+ `AGENTS.md` symlink) and `.claude/commands/` |
| Codex / generic | `.storyseam/skills/` | `.storyseam/agents/` | `AGENTS.md`, with a table mapping each `/command` to its skill file |
| Cursor | `.storyseam/skills/` | `.storyseam/agents/` | `AGENTS.md` + `.cursor/rules/storyseam.mdc` |

Paths *inside* the skills are rewritten to match on the way in, and the install fails rather
than ship a story that points at a file it does not have. On Claude Code a `/command` is a
thin wrapper that loads one skill; everywhere else the entry file says which skill file to
read for each stage. `AGENTS.md` is the cross-tool convention, and it is the same document as
`CLAUDE.md`.

## Model & Provider Registry

Prompting is **model-specific craft**, not pipeline logic. Seedance 2.0 honours a real
`start_image` role; Seedance 2.5 declares it and ignores it. One skill covering both is wrong
for whichever model you are actually using — and we learned that by rendering a whole film
whose continuity chain silently did nothing.

So the pipeline lives in the skills, and the per-model craft lives in a **registry**: one
installable director skill per model, resolved from `config.json`.

```bash
npx storyseam list                              # catalogue, grouped by model
npx storyseam add seedance_2_5                  # the DEFAULT for that model id
npx storyseam add seedance-2-5-extension-director  # an alternate, by name
npx storyseam add --model seedance_2_5 --all    # everything compatible with a model
```

| Model | Skill | | Notes |
| --- | --- | --- | --- |
| `seedance_2_5` | `seedance-2-5-director` | default | 30s blocks, `omni_reference`, first frame declared in prose |
| `seedance_2_5` | `seedance-2-5-extension-director` | alt | frame-exact seams via `video_extension` |
| `seedance_2_0` | `seedance-2-0-director` | default | 4-15s, real `start_image`/`end_image`, `fast` rejects audio refs |
| `seedance_2_0` `seedance_2_5` | `seedance-voice-casting` | alt | black-frame `.mp4` voice references |
| `gpt_image_2` | `gpt-image-2-director` | default | reference stills at 2k/high |

**A model can carry several skills.** Each declares `models` (what it is compatible with —
an array, because `seedance-voice-casting` works identically on 2.0 and 2.5) and `default_for`
(the subset it owns). Exactly one default per model, enforced by the build. Items are
*copied into* your project, so you can edit them; re-running the install overwrites with the
published version. Each item's `sha256` is verified before writing, and an item may only
write under the skills directory.

The built registry ships **inside the package**, so `init` works offline and is pinned to the
release; `update` pulls newer ones. Set `STORYSEAM_REGISTRY` to a URL (the published copy is
at `https://pub-597aecbeb0f64dee8c8894e4da9a211c.r2.dev/r`) or to a local directory to
install from somewhere else.

### The backend is configuration

The script, the shot list, the block structure and the continuity chain do not change when
the backend does. What changes is how a job is submitted, how media is passed, and how access
is proven — and that lives in a **provider adapter**, installed like any other skill.

```json
"providers": {
  "video": { "id": "higgsfield", "access": "mcp" },
  "image": { "id": "atlas", "access": "api_key", "key_env": "ATLAS_KEY" }
}
```

A provider is named **per capability**, so a story can render video on one backend and stills
on another. Two access types: `mcp` (you connect the MCP server in your client; Storyseam
cannot install it) and `api_key` (you export the named env var). **`key_env` names a
variable, never a value** — `config.json` is committed, and a key in it is a leaked key.
`storyseam providers` reports whether a variable is *set* and its *length*, never its value,
so a truncated paste is diagnosable without the secret being displayed.

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

## The Specialist Room

Twenty-one subagents, run in stage order:

- **outline** — `story-architect` (and the arc experts: Hero's Journey, Story Circle,
  Three-Act, Save the Cat, Kishōtenketsu)
- **draft** — `scene-doctor`, `motivation-doctor`, `plot-doctor`, `character-doctor`,
  `theme-doctor`
- **polish** — `tension-doctor`, `dialogue-doctor`, `world-continuity`
- **lock** — `producer`, `performance-doctor`
- **on demand** — `voice-designer`, `punch-up`, `table-read`, `first-reader`

Sequence is load-bearing: polishing lines before the structure settles polishes lines that
are about to be cut. Each specialist returns a fixed three-line envelope — `VERDICT`,
`FINDINGS`, `SUMMARY` — and the root agent records the pass in `script/reviews.json`. The
contract is in `docs/specialist-contract.md`.

## Cost

Prices live in each story's `config.json` under `costs`, and every script and skill reads
them from there. The defaults:

| | Credits | Runs |
| --- | --- | --- |
| 30-second video block | 75 | 1 |
| Voice cast | 15 | 1 |
| Still (sheet / plate) | ~2.5 | 0 |

A 2-minute film with two speaking characters and one location: 4 blocks + 2 voices +
~5 stills ≈ **345 credits, 6 runs**. That is a floor: a block can bill above the default (the
reference film's first block billed 105), and a block that comes back wrong is re-rendered at
full price. Preflight with `get_cost: true` when unsure.

## Status

**Alpha.** The pipeline has produced a complete two-minute film end to end, but the seam
schemas, the registry shape and the CLI surface may still change between versions. Pin a
version if you are depending on it.

## Credits

The script room and the shot-list discipline are distilled from an earlier internal project,
shot-studio. The delegation and question-asking patterns follow
[obra/superpowers](https://github.com/obra/superpowers). The Seedance directing craft is
adapted from the Seedance 2.0 Pro Director skill and the sources listed in
`docs/seedance-2.5-research.md`. The README format takes its shape from
[google-labs-code/design.md](https://github.com/google-labs-code/design.md), which makes the
same two-layer argument about design systems that this makes about films.

## Working on the engine itself

```bash
git clone https://github.com/bidah/storyseam.git && cd storyseam
npm install
bin/registry-add.py --all        # install the directors into this checkout
bin/rules-check.py               # the five rules: one owner, copies in sync, no contradiction
bin/story-check.py test          # the schemas still accept a real story
node cli/bin/storyseam.js --help # the CLI, unpacked
```

The `bin/*.py` scripts are the development tools; `cli/` is their Node port, and the two must
agree — `story-check.py` and `storyseam check` validate the same story against the same
`schema/`. `templates/story-CLAUDE.md` carries a placeholder per thing that differs between a
git checkout and an `npx` folder; `bin/storyseam-init.sh` and `cli/src/targets.js` each answer
all of them, and a raw `{{PLACEHOLDER}}` in a scaffolded story means one of the two fell
behind.

`site/` is the landing page (Vite, vanilla). Its look comes from a `design.md` spec —
`npx designdotmd add architect-blueprint` — kept at `site/design.md`.

## Disclaimer

Storyseam orchestrates paid third-party generation APIs. It shows you the price before it
spends and never spends without being asked, but the bill is yours. It is not an official
product of Anthropic, ByteDance, Higgsfield, Atlas Cloud or fal.ai.

## Browse a story

[storyseam-preview](https://github.com/bidah/storyseam-preview) opens a story folder as a
desktop. It has explorer windows, an editable markdown viewer, a visual `config.json`
viewer with a raw `.json` toggle, and the HTML previewer for shot previews:

```bash
npx -y github:bidah/storyseam-preview ./my-film
```
