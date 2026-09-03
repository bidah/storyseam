#!/usr/bin/env bash
# Create the Storyseam folder convention in the target directory (default: cwd).
# Idempotent: never deletes, never overwrites an existing file.
#
#   bin/storyseam-init.sh [--title "Working Title"] [story-root]
#
# With --title it also writes the story's CLAUDE.md from templates/story-CLAUDE.md
# (and the AGENTS.md symlink), recording this engine's path as STORYSEAM_HOME so the
# folder can be opened from anywhere and still find bin/.
# STORY.md and config.json are the /start-story skill's job: they need the interview.
set -euo pipefail

ENGINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TITLE=""
ROOT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --title) TITLE="${2:?--title needs a value}"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "storyseam-init: unknown flag $1" >&2; exit 2 ;;
    *) ROOT="$1"; shift ;;
  esac
done
ROOT="${ROOT:-${STORYSEAM_ROOT:-$PWD}}"

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

# script/script.md is deliberately NOT seeded: its absence is how the engine knows
# /write-script has not run yet. The filesystem is the state.
seed script/reviews.json '{ "passes": [] }'
seed world/characters.md "# Characters"
seed world/locations.md  "# Locations"
seed world/props.md      "# Props"
seed prompts/image_style_prompt.txt "TODO: fill this in. Every image generation appends it."
seed prompts/video_style_prompt.txt "TODO: fill this in. Every video generation appends it. Must end with: Audio: diegetic only. No music."
seed .storyseam/state.json '{ "blocks": {}, "voices": {}, "stills": {}, "credits_spent": 0, "runs_used": 0 }'
seed .storyseam/media.json '{}'

if [ -n "$TITLE" ] && [ ! -e CLAUDE.md ]; then
  TEMPLATE="$ENGINE/templates/story-CLAUDE.md"
  [ -f "$TEMPLATE" ] || { echo "storyseam-init: template not found at $TEMPLATE" >&2; exit 1; }
  # literal substitution; the title may contain characters sed would treat as syntax
  TITLE="$TITLE" ENGINE="$ENGINE" python3 -c 'import os,sys; sys.stdout.write(sys.stdin.read().replace("{{TITLE}}", os.environ["TITLE"]).replace("{{ENGINE}}", os.environ["ENGINE"]))' \
    < "$TEMPLATE" > CLAUDE.md
  echo "wrote CLAUDE.md for \"$TITLE\""
fi
[ -e AGENTS.md ] || { [ -e CLAUDE.md ] && ln -s CLAUDE.md AGENTS.md; } || true

echo "Storyseam convention created in: $ROOT"
find . -type d -not -path "*/.git/*" | sort | sed 's|^\./||'
