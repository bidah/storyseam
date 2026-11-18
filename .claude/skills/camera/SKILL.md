---
name: camera
description: >-
  Prompt presets: the camera a film is shot on, what its audio track carries, and any other
  pre-prompt every shot shares. Use for "/camera", "what camera", "make it look like 16mm",
  "anamorphic", "no sound", "add dialogue audio", "install this preset <url>", and before the
  first block's prompt when config.json has no presets.camera. Opens the presets page
  (`npx storyseam preset page --open`), recommends two or three, installs the pick with
  `npx storyseam preset add <section>/<id>` or `add <url>` for a shared one. Audio defaults
  to `silent` (generate_audio false). /render appends presets to every video prompt: never
  paste a preset line into block.prompt, never let one raise resolution or change the model.
  Sample stills cost credits: offer, never render unasked.
---

# Prompt presets (camera, audio, ...)

A shot's own prompt says what happens. A **preset** says how every shot is made: the camera
it is shot on, what the audio track carries. Each preset is one JSON file with its own URL,
and it installs into `config.json` `presets.<section>` (`docs/spec.md` §14):

```json
"presets": {
  "camera": { "id": "s16-handheld", "name": "Super 16 handheld", "prompt": "Shot handheld on Super 16mm film: ...",
              "fields": { "body": "Super 16mm film camera", "lens": "12–120mm zoom", "movement": "handheld" },
              "source": "https://storyseam.app/spec/presets/camera/s16-handheld.json" },
  "audio":  { "id": "silent", "prompt": "Audio: none. Silent picture: ...", "settings": { "video.generate_audio": false } }
}
```

`/render` builds each video prompt as the block's prompt, then every installed preset's line
(camera, audio, then other sections alphabetically), then `prompts/video_style_prompt.txt`.
The shot preview shows the result exactly.

## Sections

- **camera**: the look. A video model has no camera; it has a sentence about one, so the
  "camera" is a body, a lens, a format and the way it moves, in one line.
- **audio**: what the track carries. **`silent` is the default**: picture only,
  `video.generate_audio: false`, and `/cast` casts no voices. `dialogue-foley` speaks the
  lines in the cast voices with room tone and Foley. `ambience-only` has sound but no
  speech. None of them is ever music.
- Any other section a shared preset names (`lighting`, `lens-fx`, ...) installs the same way.

## Step 1 — show them

`npx storyseam preset page --open` writes `shotlist/previews/presets.html` (every preset by
section as a card: what it is for, the exact prompt line, the install command, a badge on
the ones in use) and opens it. In storyseam-preview it opens in the HTML previewer.
`npx storyseam camera --open` shows only the camera section. Then recommend **two or three**
camera looks for this story in one line each, from `storyseam.md`'s look, genre and shape,
and say what the audio is set to.

## Step 2 — optional sample stills

The cards show a swatch, not the story. If the author wants to SEE their film through a
look, offer one still per shortlisted look: the story's main location with its lead,
through the look's prompt line, on `config.image`, saved as
`assets/presets/<section>/<id>.png`. Say the cost (`config.costs.still` each), wait for a
yes, then re-run the page and the cards show the stills.

## Step 3 — install

- From the catalogue: `npx storyseam preset add camera/s16-handheld`.
- A shared one: `npx storyseam preset add https://…/<section>/<id>.json`. Read the file
  first and say what it will add to every prompt; a URL is someone else's words in every
  shot.
- The author's own ("an ARRI with Cooke primes, always on sticks"): write a preset JSON in
  `presets/` style (`schema/preset.schema.json`: section, id, name, prompt, optional
  fields) into the story, e.g. `prompts/presets/camera-arri-cooke.json`, and
  `npx storyseam preset add prompts/presets/camera-arri-cooke.json`. One or two
  sentences: what it is shot on, the texture, how it moves.

`add` replaces the section's preset and applies its `settings` (only
`video.generate_audio` is allowed). Record the choice and the reason under `## Decisions` in
`storyseam.md`, then `npx storyseam check`.

## Changing one mid-film

A change re-looks every block rendered after it. On a story with rendered blocks, say which
blocks were made with the old preset and ask before changing. Switching audio from `silent`
to `dialogue-foley` means `/cast` now casts voices: say what that costs.

## Do NOT

- Do not paste a preset line into `block.prompt`. `/render` appends it, so it would be there
  twice, and a later change would miss those blocks.
- Do not let a preset raise the resolution or change the model. A preset is words.
- Do not let a block contradict the camera: a shot's `camera` field is framing and moves
  ("close-up, slow push-in"), and a handheld look does not get tripod lock-offs unless the
  story turns on that.
