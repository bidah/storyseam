---
description: Break the script into <=30s Seedance blocks with prompts and references
argument-hint: [all | next block]
---
Load the `shotlist` skill and follow it. Every prompt is written through the director
skill for `config.video.model` (`seedance_2_5` → `seedance-2-5-director`); if it is not
installed, `bin/registry-add.py <model>` first. Do not write Seedance prompts from memory.

Scope: $ARGUMENTS  (empty means the whole script)

State the block count and the credit cost (75 per 30s block at 480p) before writing
the first prompt. Write both `shotlist/shotlist.json` and `shotlist/shotlist.md`.
Generate no media.
