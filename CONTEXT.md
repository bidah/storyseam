# Storyseam

A storytelling engine that turns a premise into a finished short film through a fixed
pipeline of commands. A story is a folder; the filesystem is the only state. This file is
the glossary: the words the skills, agents, scripts and file names agree on.

## Language

### The work

**Story**:
One film's folder: premise, script, world, shot list, references, renders and state, laid
out in the convention `/start-story` creates.
_Avoid_: project, episode, production

**Film**:
The finished output of a story, assembled from its clips into `renders/final/`. Always
without music.
_Avoid_: video, movie, episode

**Author**:
The human whose story it is. Decides the premise, approves the outline, sets the run
budget, and adds the music at the end.
_Avoid_: user, human, client

**Premise**:
The one- or two-sentence answer to "who wants what, and what is in the way", recorded in
`STORY.md`. Everything downstream is derived from it.
_Avoid_: idea, pitch, prompt

**Look**:
The visual world in a phrase, recorded in `STORY.md` and expanded into the two style
prompts. Free text, not an enum.
_Avoid_: style (that is the prompt file), production type

**Style prompt**:
One of two text files appended verbatim to every generation of its kind, so the
references and the clips look like one film. Never contains subject matter.

### The script

**Outline**:
The ordered list of beats the author approves before any pages exist.
_Avoid_: treatment, synopsis

**Beat**:
One line of the outline: who is in it and what turns.

**Script**:
The current screenplay, `script/script.md`. There is exactly one; it is the thing the
shot list is cut from.
_Avoid_: screenplay (in file names and fields), pages

**Draft**:
An immutable snapshot of the script at a point in time, numbered (`v1`, `v2`), kept in
`script/drafts/`. Never edited.
_Avoid_: version, backup, revision

**Scene**:
A section of the script under a `## SCENE n — SLUGLINE` heading: one place, one
continuous stretch of time.

**World**:
The three canonical rosters, `world/characters.md`, `world/locations.md`,
`world/props.md`. A name here is the only spelling that exists.
_Avoid_: bible, canon file

**Slug**:
The lowercase, hyphenated identifier derived from a name, used for every file that
belongs to that character, location or prop. One name, one slug, everywhere.

### The specialist room

**Specialist**:
A subagent that reads the script and returns findings on one craft question. The doctors
are the specialists whose names end in `-doctor`; the arc experts are the ones the
story-architect consults.
_Avoid_: agent (ambiguous with the root agent), reviewer

**Pass**:
One specialist's read of one draft, recorded by the root agent in `script/reviews.json`.
A pass is `fresh` if the script has not changed since, `stale` if it has, and a specialist
with no pass is `pending`.
_Avoid_: review, run (a run is a paid video call)

**Review stage**:
The earliest point at which a specialist's pass is worth spending: `outline`, `draft`,
`polish`, `lock`, or on demand. Sequence is load-bearing. Distinct from the pipeline
stage below, and distinct from a draft snapshot, even though the words collide.

**Ledger**:
`script/reviews.json`: the record of every pass. Nothing that is not in it happened.

**Envelope**:
The three fixed lines (`VERDICT`, `FINDINGS`, `SUMMARY`) every root-called specialist
ends its message with, copied verbatim into the ledger. The body above it is the
specialist's own format; the envelope is the only part the root parses.
_Avoid_: footer, summary block

### The shot list

**Shot list**:
The script broken into blocks, `shotlist/shotlist.json`. The contract between the script
and the renders, and the last place a mistake is cheap.

**Block**:
The unit of rendering: one location, one set of references, two to four shots, at most
thirty seconds, one paid call. Blocks are numbered `block_01`, `block_02`, in order.
_Avoid_: segment, chunk, clip (the clip is what the block renders to)

**Shot**:
A timed camera unit inside a block: a framing and one clear action, with start and end
seconds. Shots are prose inside the block's prompt; they are never rendered separately.

**Reference list**:
A block's ordered list of the references its prompt numbers (`@Image 1 …`), the anchor
frame first on a chained block. The shot list writes it, the director numbers against it,
`/render` passes it in that order, and `story-check` verifies the three agree.
_Avoid_: media list, inputs

**Final frame**:
The stable, legible composition a block is written to end on, so that the next block can
open from it.

### References and casting

**Reference**:
Any file passed to a generation to lock identity or continuity: a character sheet, a
location plate, a prop plate, a voice reference, a video reference, or the anchor frame.
Lives under `assets/` and is made once by `/cast`.
_Avoid_: asset (the folder name, not the concept), input

**Character sheet**:
The single still that is a character's identity in every block: full figure, clear face,
neutral pose, plain background, costume locked.
_Avoid_: portrait, model sheet, character anchor

**Location plate**:
An empty establishing still of a place, no characters in it.

**Prop plate**:
A still of an object that must stay consistent across blocks.

**Voice take**:
A character's clean voice recording, `assets/audio/voices/<slug>.mp3`, cast once. The
source of truth for how that character sounds.

**Voice reference**:
The form of a voice take that a render accepts. On Higgsfield that is the black-frame
encode, `assets/audio/voices/blackframe/<slug>.mp4`; on Atlas it is the take itself.

**Cast** (verb):
To generate and upload every reference the shot list cites. Free to audit, cheap to do,
and what stops a full-price block rendering against a missing sheet.

### Rendering and continuity

**Clip**:
The rendered video of one block, `renders/clips/block_NN.mp4`.
_Avoid_: block (the plan), video, output

**Anchor frame**:
The last frame of the previous clip, passed first among the references of the next block
and declared in prose as the first frame. The mechanism of continuity.
_Avoid_: start image, start frame, character anchor

**Chain**:
The relation of each block opening on the previous block's anchor frame. Sequential by
construction: block N+1 cannot start until block N is done.
_Avoid_: pipeline (that is the command sequence)

**Cut**:
A block boundary where the chain is deliberately broken: a new location, a bad anchor,
or drifted identity. A cut is a decision and is said out loud.

**Seam**:
The join between two consecutive clips in the film. A good seam is where the anchor
frame did its job.

**Drift**:
A character or place gradually stopping looking like its reference over consecutive
blocks. Corrected by re-anchoring from the sheets, not by prompting harder.

**Preset**:
A style bundle a provider recommends in place of the prompt. Always declined; the block
prompt is the shot list's considered output.

### Money

**Credit**:
The provider's unit of spend. Recorded per job in `.storyseam/state.json` and summed in
`credits_spent`.

**Run**:
One paid video call, whether a block, a voice cast or a retry. Counted in `runs_used`.
_Avoid_: job (the provider's id for a run), attempt

**Run budget**:
The author's hard stop on runs. Reaching it ends the render; it is never a target.

**Cost floor**:
The credit tally a shot list implies if nothing needs re-rendering. Quoted as a floor,
never as an estimate.

### Backends

**Provider**:
A service that renders models: Higgsfield, Atlas Cloud, fal.ai. Named per capability in
`config.json`; the pipeline does not change when it does.
_Avoid_: backend, vendor, platform

**Provider adapter**:
The installable skill that says how one provider takes a job: access, job shape, media
handling, voice handling.

**Capability**:
One of `image`, `video`, `audio`: the axis along which a provider is chosen.

**Access**:
How a provider is reached: `mcp` (the client connects the server) or `api_key` (the author
exports a named environment variable; Storyseam never sees the value).

**Model**:
A canonical model id in `config.json` (`seedance_2_5`, `gpt_image_2`), independent of
which provider serves it.

**Director**:
The installable skill that carries one model's prompting craft. The shot list is written
through the video model's director; stills through the image model's.
_Avoid_: prompt guide, template

**Registry**:
The catalogue of directors and provider adapters, built from `registry/sources/` and
installed into a project by name or by model id. A model has exactly one default director
and any number of alternates.

**Registered reference**:
A reference the configured provider can fetch: a confirmed `media_id` on Higgsfield, a
public `url` on Atlas or fal. Recorded per file in `.storyseam/media.json`; an entry
older than the file on disk is stale.
_Avoid_: uploaded (only true on one provider), media id (the Higgsfield form of it)

### The pipeline

**Stage** (pipeline):
Where a story is, read from the folder: scaffolded, written, shot-listed, cast,
rendering, rendered, done. Decides which command comes next.

**Convention**:
The fixed folder tree every command reads and writes. Nothing outside it is state.
