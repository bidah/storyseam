---
name: asset-check
description: >-
  Audit every reference the shot list needs — character sheets, location plates, prop
  plates, voice references, video references — report what is missing, and generate
  it. Use for "/cast", "check the assets", "do we have everything", "make the
  character sheets", "cast the voices". Images are gpt_image_2 at 2k; voices are cast
  with seedance_2_0 fast at 10s/480p and converted to black-frame mp4. Runs BEFORE
  /render and is what stops a 75-credit block from rendering against a missing sheet.
---

# /cast — every reference the film needs, on disk

`/render` is expensive and `/cast` is cheap. Everything that can be got wrong for
2 credits instead of 75 gets got wrong here.

## Step 1 — the audit (free, do it first, always)

Read `shotlist/shotlist.json` and build the union of everything it cites:

- every name in any block's `characters` → needs `assets/images/characters/<slug>.png`
- every name in any block's `voices` → needs `assets/audio/voices/blackframe/<slug>.mp4`
- every `location` → needs `assets/images/locations/<slug>.png`
- every slug in any block's `props` → needs `assets/images/props/<slug>.png`
- every entry in `video_refs` → needs the file to exist in `assets/video_refs/`

`bin/asset-audit.sh` does exactly this and prints a table. Run it rather than
eyeballing the JSON.

Report the audit as a table — **present, missing, and what each missing item will
cost** — before generating anything:

| Asset | Kind | Status | Cost to make |
| --- | --- | --- | --- |
| `noah` | character sheet | missing | ~2.5 credits |
| `maya` | voice | missing | 15 credits |
| `noah-living-room` | location plate | present | — |

Then generate the missing ones. If the total is more than a handful of credits, say
the total first.

## Step 2 — character sheets (`gpt_image_2`, 2k)

Write every still through the director for `config.image.model` (`gpt_image_2` ->
`gpt-image-2-director`). Install it with `bin/registry-add.py gpt_image_2` if missing.


One image per character, at `assets/images/characters/<slug>.png`. This single image
is the identity every block cites, so it is worth the care:

- **Full figure plus a clear face.** A tight portrait cannot anchor a wide shot; a
  full-body-only sheet cannot anchor a close-up. Ask for a neutral standing pose,
  full body, with the face unobstructed and well lit.
- **Plain neutral background.** A sheet with a location in it drags that location
  into every block that cites the character.
- **Costume locked.** Whatever they wear in the sheet is what they wear in the film.
  If the script has a costume change, that is a *second* sheet (`<slug>-2.png`) and
  the shotlist has to say which blocks use which.
- **Append `prompts/image_style_prompt.txt`** verbatim to the end of the prompt. This
  is what makes the characters and the locations look like the same film.

```
generate_image {
  model: "gpt_image_2",
  resolution: "2k",
  quality: "high",
  aspect_ratio: "3:4",              // sheets are portrait — the director's call, not config's
  prompt: "<character description, full figure, neutral pose, plain background>\n\n<image_style_prompt.txt>"
}
```

Then download the result to the conventional path. **The file on disk is the asset**;
a job id in the chat is not.

## Step 3 — location plates and prop plates

Same call, same model, same 2k, same style-prompt append — but `aspect_ratio` is
`<config.aspect_ratio>` here: a plate is a frame the film will match, where a sheet is a
figure the film will cite.

- **Locations** — an empty establishing view of the place, no characters in it.
  Characters in a location plate confuse the model about who is in the block.
- **Props** — only for objects that must stay consistent across blocks (a specific
  toy, a specific book). A generic couch does not need a plate.

## Step 4 — casting voices

A voice is cast once and reused by every block that character speaks in.

**Why it works this way:** Seedance takes a voice as a **black-frame `.mp4` in
`video_references`**. The cheapest way to *get* a character voice at all is to have
Seedance 2.0 generate the character speaking, then keep the audio and throw the
picture away.

1. **Generate the take** — `seedance_2_0`, `mode: "fast"`, `duration: 10`,
   `resolution: "480p"` (**15 credits**; this is why it is 2.0 and not 2.5):

   ```
   generate_video {
     model: "seedance_2_0", mode: "fast", duration: 10, resolution: "480p",
     aspect_ratio: <config.aspect_ratio>, generate_audio: true,
     medias: [{ role: "image_references", value: <character sheet media_id> }],
     prompt: "<Character> speaks directly to camera, medium close-up, locked-off
              camera, neutral room. They say: \"<a short paragraph in this
              character's voice — 2-3 sentences, ~25 words>\".
              Audio: clean spoken dialogue only, quiet room tone. No music."
   }
   ```

   Cite the character sheet as `image_references` so the voice matches the face.
   Write the paragraph **in the character's actual voice** from
   `world/characters.md` — an 8-year-old delivering a corporate sentence gives you a
   corporate 8-year-old for the rest of the film.

2. **Extract the audio** to `assets/audio/voices/<slug>.mp3`.
3. **Make the black-frame encode** — `bin/voice-to-blackmp4.sh <slug>` writes
   `assets/audio/voices/blackframe/<slug>.mp4`.
4. Record both paths in `world/characters.md` under that character.

**This costs a video run.** Voice casting comes out of the same run budget as the
film itself, so cast only characters who actually speak (`voices` in the shot list,
not `characters`), and cast each exactly once.

## Step 5 — upload and cache the media ids

Every file `/render` will cite has to be a Higgsfield `media_id`. Do that here, not
in `/render`, so the expensive skill never blocks on an upload:

1. `media_upload { files: [{ filename, content_type }] }` → `upload_url` + `media_id`
2. `curl -X PUT -H "Content-Type: <the signed type>" --data-binary @<file> '<upload_url>'`
   — **the header must match the signed type** or the PUT succeeds locally and the
   render 404s an hour later.
3. `media_confirm { type: "image"|"video"|"audio", media_ids: [...] }`

Write the mapping into `.storyseam/media.json`:

```json
{ "assets/images/characters/noah.png":
    { "media_id": "…", "confirmed": true, "mtime": 1756830000, "sha256": "…" } }
```

`mtime` is the file's modification time (`stat -f %m <file>` on macOS, `stat -c %Y` on
Linux) and `sha256` its content hash at upload time. `/render` reads this cache. A cache
miss there means an upload happened at the worst possible moment; a stale cache means a
render against the wrong file. `bin/asset-audit.sh` reports **STALE** when the file on
disk is newer than its entry — re-upload it and refresh the entry.

## Step 6 — the go/no-go

End with a single verdict:

- **Ready** — every block's references exist, are uploaded and are confirmed. Say the
  block count and the total render cost, and name `/render` as next.
- **Not ready** — list exactly what is missing and why it could not be made.
  **Do not tell the author to run `/render` against a partial cast.** A block that
  cites a missing sheet does not fail — it renders something plausible and wrong, and
  you pay full price to find out.

## Do NOT

- Do not generate music or anything into `assets/audio/music/`. That folder is the
  human's.
- Do not render story blocks here. That is `/render`.
- Do not skip the style-prompt append. It is the whole reason the film is coherent.
- Do not generate a sheet for a character the shot list never names, or a plate for a
  prop no block cites. Every generation is real money.
