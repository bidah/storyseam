---
description: Render the blocks one at a time, chaining last frame to next start frame
argument-hint: [all | next | block_NN]
---
Load the `render-clips` skill and follow it.

Scope: $ARGUMENTS  (empty means: render every block that is not yet done)

Pre-flight first — re-run the asset audit and print the plan (blocks remaining, cost
each, total, run budget). Then render sequentially: `seedance_2_5`, `mode:
"omni_reference"`, `resolution: "480p"`, `generate_audio: true`, prompt +
`prompts/video_style_prompt.txt`.

Character sheets are `image_references`. Only the previous block's last frame is ever
`start_image`. Voices are black-frame mp4 in `video_references`. No music.

Write `.storyseam/state.json` after every block. Announce credits and runs as you go,
and stop at the run budget.
