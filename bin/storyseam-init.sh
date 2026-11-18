#!/usr/bin/env bash
# Create the Storyseam folder convention in the target directory (default: cwd).
# Idempotent: never deletes, never overwrites an existing file.
#
#   bin/storyseam-init.sh [--title "Working Title"] [story-root]
#
# With --title it also writes the story's CLAUDE.md from templates/story-CLAUDE.md
# (and the AGENTS.md symlink), recording this engine's path as STORYSEAM_HOME so the
# folder can be opened from anywhere and still find bin/.
# storyseam.md and config.json are the /start-story skill's job: they need the interview.
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
  # The template carries one placeholder per thing that differs between a git checkout and
  # an `npx storyseam init` folder. This is the checkout's answer to each; cli/src/targets.js
  # is the package's. Keep them in step — a raw {{PLACEHOLDER}} in a story is a broken scaffold.
  TITLE="$TITLE" ENGINE="$ENGINE" python3 - "$TEMPLATE" > CLAUDE.md <<'PY'
import os, sys
runtime = """```
STORYSEAM_HOME=%s
```

That is the Storyseam engine this story was scaffolded from. Its `bin/` holds the
scripts named below and its `.claude/` holds the pipeline skills and the specialist
room. Run every script as `$STORYSEAM_HOME/bin/<script> [this folder]`, or export
`STORYSEAM_ROOT` to this folder first; each script takes the story root either way.""" % os.environ["ENGINE"]
stages = ("Each `/command` is a thin wrapper that loads `$STORYSEAM_HOME/.claude/skills/<name>/SKILL.md`, "
          "and the\nspecialist room is `$STORYSEAM_HOME/.claude/agents/` — 21 subagents, dispatched in stage order.")
text = open(sys.argv[1]).read()
for k, v in (("{{TITLE}}", os.environ["TITLE"]), ("{{ENGINE}}", os.environ["ENGINE"]),
             ("{{RUNTIME}}", runtime), ("{{STAGES}}", stages),
             ("{{VOICE_TOOL}}", "$STORYSEAM_HOME/bin/voice-to-blackmp4.sh")):
    text = text.replace(k, v)
sys.stdout.write(text)
PY
  echo "wrote CLAUDE.md for \"$TITLE\""
fi
# AGENTS.md is the cross-tool name for the same instructions: a symlink where the
# filesystem allows it, a copy where it does not (Windows without symlink support).
if [ ! -e AGENTS.md ] && [ -e CLAUDE.md ]; then
  ln -s CLAUDE.md AGENTS.md 2>/dev/null || cp CLAUDE.md AGENTS.md
fi

echo "Storyseam convention created in: $ROOT"
find . -type d -not -path "*/.git/*" | sort | sed 's|^\./||'
