#!/usr/bin/env bash
# Create the Storyseam folder convention in the target directory (default: cwd).
# Idempotent: never deletes, never overwrites an existing file.
set -euo pipefail
ROOT="${1:-$PWD}"
mkdir -p "$ROOT"
cd "$ROOT"

DIRS=(
  script/drafts
  world
  prompts
  shotlist
  assets/images/characters
  assets/images/locations
  assets/images/props
  assets/audio/voices/blackframe
  assets/audio/music
  assets/video_refs
  renders/clips
  renders/frames
  renders/final
  .storyseam
)
for d in "${DIRS[@]}"; do
  mkdir -p "$d"
  [ -e "$d/.gitkeep" ] || touch "$d/.gitkeep"
done

seed() { [ -e "$1" ] || printf '%s\n' "$2" > "$1"; }

seed script/script.md   "# (untitled)"
seed script/outline.md  "# Beat outline"
seed script/reviews.json '{ "passes": [] }'
seed world/characters.md "# Characters"
seed world/locations.md  "# Locations"
seed world/props.md      "# Props"
seed prompts/image_style_prompt.txt "TODO: fill this in. Every image generation appends it."
seed prompts/video_style_prompt.txt "TODO: fill this in. Every video generation appends it. Must end with: Audio: diegetic only. No music."
seed .storyseam/state.json '{ "blocks": {}, "credits_spent": 0, "runs_used": 0 }'
seed .storyseam/media.json '{}'

echo "Storyseam convention created in: $ROOT"
find . -type d -not -path "*/.git/*" | sort | sed 's|^\./||'
