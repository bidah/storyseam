---
name: render-clips
description: >-
  Render the shot list into video, ONE 30-second Seedance 2.5 block at a time,
  chaining the last frame of each clip into the start frame of the next. Use for
  "/render", "render the blocks", "generate the video", "render the next block".
  Always 480p. Always no music. Never parallel. Resumable from .storyseam/state.json.
  This is the only skill that spends real money — it re-audits before every call.
---

# /render — one block at a time, chained

This is the expensive skill. A 30-second block at 480p is **75 credits**. Everything
here is arranged so that no credit is spent on a call that was going to fail.

## The invariants

1. **`seedance_2_5`, `resolution: "480p"`.** Never 720p, never 1080p. If someone asks
   for higher, quote the multiplier and leave it at 480p.
2. **`generate_audio: true`, and the prompt says `No music.`** The clip should come
   back with dialogue, room tone and Foley — and nothing else.
3. **One call at a time.** Never `generate_video_batch`, never two blocks in flight.
   The chain is sequential by construction: block N+1 needs a frame that does not
   exist until block N has finished.
4. **Resume, never restart.** `.storyseam/state.json` records what is done. A
   re-run picks up at the first unrendered block.

## Step 0 — pre-flight (free, and not optional)

Before the first paid call:

1. Read `shotlist/shotlist.json`, `config.json`, `.storyseam/state.json`,
   `.storyseam/media.json`, and `prompts/video_style_prompt.txt`.
2. Re-run the `/cast` audit. If **any** reference a block cites is missing or
   unconfirmed, stop and say so. Do not render a block against a missing sheet — it
   will not error, it will produce something plausible and wrong at full price.
3. Print the plan: how many blocks remain, the cost each, the total, and the run
   budget. Then start.

## Step 1 — build the call for block N

```
generate_video {
  model: "seedance_2_5",
  mode: "omni_reference",
  duration: <block.dur>,          // 4-30
  resolution: "480p",
  aspect_ratio: <config.aspect_ratio>,
  generate_audio: true,
  prompt: <block.prompt> + "\n\n" + <video_style_prompt.txt>,
  medias: [ ...see below... ]
}
```

**The `medias` array, in this order:**

| Order | Role | Value |
| --- | --- | --- |
| 1 | `image_references` | `renders/frames/block_<N-1>_last.jpg` — the continuity anchor, **first in the list**, and declared in the prompt as `@Image 1 is the first frame` |
| 2 | `image_references` | each character sheet the block cites |
| 3 | `image_references` | the location plate |
| 4 | `image_references` | each prop plate |
| 5 | `video_references` | each speaking character's `assets/audio/voices/blackframe/<slug>.mp4` |

Every `value` is a `media_id` from `.storyseam/media.json` — never a path, never a
URL, never a previous `job_id`. A `job_id` in `medias` does not error; it hangs.

**Do not use the `start_image` role on `seedance_2_5`.** The API declares it and accepts
it; the model ignores it. A film has already been rendered where every block passed its
anchor as `start_image`, the job JSON recorded `"role":"start_image"`, and not one block
opened on that frame. On 2.5 the anchor is an ordinary `image_references` entry, placed
first, and the *prompt* is what makes it the first frame:

> `@Image 1 is the first frame. It defines the opening composition, subject position, pose,
> prop state, scene, and camera direction. Do not change the first-frame composition
> defined by @Image 1.`

And the prompt's **`Shot 1` must describe that frame**, not a new framing — a Shot 1 that
opens on a different shot size overrides the anchor and wastes it. If you need a
frame-exact splice rather than a matching opening composition, use
`mode: "video_extension"` with `extension_mode: "forward"` (see the `seedance-director`
skill).

When a voice reference is attached, the prompt must acknowledge it:
> Use the attached voice references; ignore the black frames. Output only the spoken
> dialogue and the scene's diegetic sound. No music.

## Step 2 — submit, wait, download

- Submit. If the response carries a `preset_recommendation`, resend the **identical**
  call with `declined_preset_id: "<id>"` so the prompt renders literally. Do not
  accept a preset — it overrides the block's blocking, and one of the presets on
  offer is literally called **DROWN IN MUSIC**, which breaks rule 1 outright.

  Three things about this that cost a turn each to learn:
  - **The recommendation costs nothing.** No job is submitted and no credit is spent,
    so it is a free round trip, not a failure. Do not treat it as an error.
  - **`declined_preset_id` declines exactly one preset, by id.** A different block —
    or the same block re-sent — can come back recommending a *different* preset, and
    the id from last time will not suppress it. Read the id out of *this* response.
  - **Never ask the author which preset they want.** The block prompt is the shot
    list's considered output; a preset is a style bundle that overrides it. Decline
    and move on.
- Poll `job_status` (a 30s block takes roughly 2–4 minutes). Respect
  `poll_after_seconds`.
- Download the result to `renders/clips/block_<NN>.mp4`.
- **Watch it before chaining.** Check: right characters, right location, right number
  of beats, dialogue audible, **no music**. A block with music in it is a failed
  block — re-prompt with a harder audio line rather than carrying it forward, because
  it cannot be un-mixed later.

## Step 3 — extract the last frame (the chain)

```bash
ffmpeg -y -sseof -1 -i renders/clips/block_NN.mp4 -update 1 -q:v 2 \
  renders/frames/block_NN_last.jpg
```

Upload it, confirm it, cache the `media_id` in `.storyseam/media.json`. It becomes block
N+1's **first `image_references` entry**, declared in prose as `@Image 1 is the first frame`.

**When to break the chain instead.** The chain is the default, not a law. Skip the anchor
(and the `@Image 1 is the first frame` sentence with it) when:

- the next block is a **new location** — chaining across a cut drags the old room
  into the new one;
- the last frame came back **blurred, dark, mid-motion or empty** — a bad anchor
  poisons the next block worse than no anchor. Re-render the block if the beat needs
  it, otherwise start the next block clean from its references;
- identity has visibly **drifted** — the sheets re-anchor identity on every block, so
  dropping the chain for one block is the cheapest available correction.

Say out loud when you break the chain and why. A silent break looks like a bug in the
finished film.

## Step 4 — record state after every block

Write `.storyseam/state.json` **after each block completes**, before starting the
next. An interrupted run must never re-render a block that is already on disk:

```json
{
  "blocks": {
    "block_01": { "status": "done", "job_id": "…", "clip": "renders/clips/block_01.mp4",
                  "last_frame": "renders/frames/block_01_last.jpg",
                  "credits": 75, "chained_from": null },
    "block_02": { "status": "pending" }
  },
  "credits_spent": 75,
  "runs_used": 1
}
```

## The run budget

Video runs are counted, not just credits. Read `runs_used` and any budget the author
set, and **stop when it is reached** — report what is done and what remains rather
than quietly spending the next one. A retry is a run. Voice casting in `/cast` is a
run. Announce the count as you go: "block 2 of 4 done, 2 runs used of 10."

## Failure handling

- **Rejected call** — read the error before retrying. Wrong `mode`, a URL in
  `medias[].value`, or an unconfirmed `media_id` are the three common ones, and all
  three are free to fix.
- **Bad render** (wrong blocking, drifted character, clipped dialogue) — fix the
  *prompt*, not the seed. Tighten the anchor, cut a beat, shorten the dialogue. A
  re-roll of the same prompt usually reproduces the same failure and costs the same
  75 credits.
- **Music in the output** — strengthen the audio line and re-render. Never carry it
  forward.
- Never retry the same failing call more than twice. Stop, report, and let the author
  decide — three identical failures are a prompt problem, not luck.

## Do NOT

- Do not render blocks in parallel or in a batch.
- Do not raise the resolution.
- Do not add music, or accept a clip that has it.
- Do not proceed past a failed block into the next one. The chain is ordered; a hole
  in the middle means every later block is anchored to the wrong frame.
