# Seedance 2.5 — research notes (Sep 2026)

Why this file exists: Storyseam's director skill was written against the **Seedance 2.0**
Pro Director guide. A 2-minute film rendered on **2.5** exposed a gap that cost the whole
continuity chain. These are the findings that corrected it, with sources.

## The finding that mattered

**Seedance 2.5 has no working `start_image` media role in `omni_reference`.**

- The Higgsfield API *declares* `start_image` for `seedance_2_5` (`models_explore` lists it
  among the roles — the schema is shared with 2.0), *accepts* it, and *records* it on the
  job.
- The raw job payload for a real render came back with `{"role":"start_image"}` preserved.
- The model still treated it as one reference among many. **Not one block opened on that
  frame.**
- 2.5's documented routes are: image-to-video (a single `image_url`), first-and-last-frame
  (exactly two URLs, `[first, last]`), and omni_reference (a flat `images_list` of up to 30).
  There is no start slot inside the omni pool.

**The fix:** pass the anchor as the first `image_references` entry and declare its role in
prose —

> `@Image 1 is the first frame. It defines the opening composition, subject position, pose,
> prop state, scene, and camera direction.`
> `Do not change the first-frame composition defined by @Image 1.`

**The other half of the failure was ours.** Every block's `Shot 1` specified a different
framing than the anchor ("Medium two-shot" against a wide anchor; "inside the fort" against
an exterior anchor). The shot list is a later, more specific instruction, so it wins. **A
chained block's `Shot 1` must re-state the anchor frame and only then move.**

## The official prompt structure (Higgsfield, tested across generations)

One continuous block of text, labelled sections, in this order. *"Skip a section and the
output tends to fail in a specific, predictable way."*

| Section | What it fixes |
| --- | --- |
| `GLOBAL STYLE` | genre, grade, film stock/digital look, shutter, and what must not appear. Everything below matches it. |
| `SCENE` | a one-line logline. |
| `CHARACTERS` | face, hair, build, wardrobe. If a reference covers it, say which reference is which character. |
| `LOCATION` | the space and its props, separate from the people. *A vague LOCATION is the most common reason a multi-shot sequence drifts between cuts.* |
| `FIRST FRAME AND BLOCKING` | exact starting positions right as the clip begins — *"something fixed before any motion starts."* |
| `Shot 1 / Shot 2 / …` | shot type + action, ending in `Hard cut` where a cut belongs. Pacing is built here. |
| `OPTICS and CAMERA` | focal length, camera height, handheld/dolly/crane per shot. |
| `PHYSICS` | fabric, smoke, hair, liquid. |
| `LIGHTING` | motivation, direction, falloff. |
| `AUDIO` | last. Ambience, SFX, and what must not be there. |

*"Most working Seedance 2.5 prompts follow the same shape: one visual rule at the top, one
sound rule at the bottom, and everything in between broken into shots."*

`FIRST FRAME AND BLOCKING` is the section the 2.0 template did not have, and it is the one
this engine most depends on.

## No-music phrasing is documented, not just our house rule

The guide's own convention for the AUDIO section is literally
`No music, no discernible dialogue` — drop the dialogue clause when the block has lines.
Our rule 1 matches published practice.

## Reference discipline

2.5 accepts 50 references (30 images, 10 videos, 10 audio). **Do not fill it.** ByteDance's
own evaluation found that past a point extra material makes results *worse* — key features
get diluted and noise increases. One reference per element that must stay consistent.

Label narrowly, and say what to **use** rather than what to ignore:

> `@Image 1 defines the woman's face and green jacket only.`

**Never merge anchors.** `@Images 1 and 2 are the first and last frames` is the documented
wrong form — one role sentence per image.

## Frame-exact continuity: `video_extension`

Prose anchoring produces a clip that *begins on that composition*. It is not a seamless
splice. For an invisible cut:

- `mode: "video_extension"`, `extension_mode: "forward"` (required), previous clip as the
  reference video. Forward extension continues from the source's **last frame**.
- `aspect_ratio` inherited from source; `duration` settable 4–30s and is what you are billed
  for. (`video_edit` is billed by the *source's* duration and ignores duration/aspect.)
- **The rule that decides success: align the boundary frame before describing new content.**
- **Documented failure phrasing: "Then connect to the source video."** It leaks later
  elements in early and lets the image drift after it arrives.
- Boundary frames *"connect naturally, not identically"* — review both sides of the seam.
- Past ~60s of chained extensions, re-anchor from the original references; drift compounds
  because an extension inherits identity from the previous clip instead of the sheets.

## Sources

- [Seedance 2.5: Complete Prompting Guide (Higgsfield, official)](https://higgsfield.ai/blog/seedance-2-5-prompting-guide)
- [OSideMedia/higgsfield-ai-prompt-skill — seedance-2-5 SKILL.md](https://github.com/OSideMedia/higgsfield-ai-prompt-skill/blob/main/skills/higgsfield-seedance-2-5/SKILL.md)
- [Anil-matcha/awesome-seedance-2.5-api-prompts](https://github.com/Anil-matcha/awesome-seedance-2.5-api-prompts)
- [Seedance 2.5 on Higgsfield in 2026](https://higgsfield.ai/blog/seedance-2-5-on-higgsfield-2026)
- Primary evidence: our own job `a330b8bc-24a7-43e4-808f-92ae3373fb57` raw payload.
