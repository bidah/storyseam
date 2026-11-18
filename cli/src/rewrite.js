// Rehome a skill's prose for the folder it is being installed into.
//
// The skill sources are written for this repo: they say `bin/story-check.py` and
// `.claude/agents/`. A scaffolded story has neither — there is no `bin/` beside it, and on
// a non-Claude target the specialists are not under `.claude/`. A skill that names a path
// the reader cannot find is worse than one that names none, so every copied file goes
// through here on the way in.
//
// Ordered, longest-match-first: `--list` must be rewritten before the bare command it
// contains, or `storyseam add --list` is what comes out.

// True for every target: the story folder has no bin/, whoever wrote the film.
const CLI_MAP = [
  // the engine's own authoring loop, which is not a thing you do from a story folder
  [/bin\/registry-build\.py <BASE_URL>/g, "bin/registry-build.py <BASE_URL>   # in the Storyseam engine repo, not here"],
  [/bin\/registry-add\.py --list/g, "npx storyseam list"],
  [/bin\/registry-add\.py --all/g, "npx storyseam update --all"],
  [/bin\/registry-add\.py --model/g, "npx storyseam add --model"],
  [/bin\/registry-add\.py/g, "npx storyseam add"],
  [/bin\/provider-check\.py/g, "npx storyseam providers"],
  [/bin\/story-check\.py/g, "npx storyseam check"],
  [/bin\/asset-audit\.sh/g, "npx storyseam audit"],
  [/bin\/voice-to-blackmp4\.sh/g, "npx storyseam voice"],
  [/bin\/last-frame\.sh/g, "npx storyseam last-frame"],
  [/bin\/storyseam-init\.sh --title/g, "npx storyseam init --title"],
  [/bin\/storyseam-init\.sh/g, "npx storyseam init"],
];

/** Build the substitutions for one target. */
function rules(target) {
  const out = [
    // `$STORYSEAM_HOME/bin/x` and `bin/x` are the same reference; normalise, then map once.
    [/\$STORYSEAM_HOME\/bin\//g, "bin/"],
    ...CLI_MAP,
  ];
  if (target.skillsDir !== ".claude/skills") {
    out.push([/\.claude\/skills\//g, target.skillsDir + "/"]);
    out.push([/\.claude\/agents\//g, target.agentsDir + "/"]);
    out.push([/\.claude\/commands\//g, target.skillsDir + "/"]);
  }
  return out;
}

/** Rewrite one file's text for a target. Returns [text, substitutionCount]. */
export function rewrite(text, target) {
  let n = 0;
  for (const [pattern, replacement] of rules(target)) {
    text = text.replace(pattern, () => {
      n++;
      return replacement;
    });
  }
  return [text, n];
}

/** What a rewritten file must no longer contain. Used by the install to fail loudly rather
 *  than ship a story that points at files it does not have. */
export function danglingRefs(text, target) {
  const bad = [...text.matchAll(/(?<![\w/-])bin\/[a-z0-9._-]+\.(?:py|sh)/g)].map((m) => m[0]);
  if (target.skillsDir !== ".claude/skills") {
    bad.push(...[...text.matchAll(/\.claude\/(?:skills|agents|commands)\//g)].map((m) => m[0]));
  }
  // the engine-repo authoring note is deliberate and says so on the same line
  return bad.filter((b) => !(b === "bin/registry-build.py" && text.includes("in the Storyseam engine repo")));
}
