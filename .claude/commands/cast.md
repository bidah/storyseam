---
description: Audit and generate every reference the shot list needs (sheets, plates, voices)
---
Load the `asset-check` skill and follow it.

Run the free audit first and show the table of present / missing / cost. Then
generate the missing assets: stills with `gpt_image_2` at 2k appending
`prompts/image_style_prompt.txt`, voices with `seedance_2_0` fast at 10s/480p
converted to black-frame mp4 with `bin/voice-to-blackmp4.sh`.

Upload and confirm every media id into `.storyseam/media.json` so `/render` never
blocks on an upload. End with a single go/no-go verdict.
