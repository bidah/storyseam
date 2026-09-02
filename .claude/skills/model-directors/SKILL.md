---
name: model-directors
description: >-
  Resolve the story's configured models to their director skills and install them from the
  Storyseam registry. Use for "/directors", "install the director", "which director am I
  using", "update the director skill", or whenever config.json names a model whose director
  is not in .claude/skills/. The director — not this skill — is what writes the shot list's
  prompts. Run at scaffold time and whenever a model in config.json changes.
---

# Model directors — one director skill per model, fetched from the registry

Prompting is **model-specific craft**, not pipeline logic. Seedance 2.0 honours a real
`start_image` role; Seedance 2.5 declares it and ignores it. Writing one skill that tries to
cover both produces a skill that is wrong for whichever model you are actually using.

So Storyseam keeps the pipeline in `.claude/skills/` and the per-model craft in a **registry**:
one installable director skill per model, one route each. The engine resolves
`config.json` → model id → director, and installs it into the project.

```
config.json                      registry                          project
─────────────                    ────────                          ───────
video.model  seedance_2_5   ──▶  /r/models.json                ──▶ .claude/skills/
image.model  gpt_image_2         /r/skills/<director>.json          seedance-2-5-director/
                                                                    gpt-image-2-director/
```

## Resolve and install

```bash
bin/registry-add.py --list                  # what the registry offers
bin/registry-add.py seedance_2_5            # install the director for a model id
bin/registry-add.py --all                   # install every director
STORYSEAM_ROOT=<story> bin/registry-add.py <model>   # install into a story folder
```

The model id is **the exact string in `config.json`** (`video.model`, `image.model`) — that
is the whole point of the indirection. Change the model, re-run, get the right craft.

Default registry: `https://pub-597aecbeb0f64dee8c8894e4da9a211c.r2.dev/r`.
Override with `STORYSEAM_REGISTRY` to point at a fork or a local build.

## When to run it

- **At `/start-story`**, right after `config.json` is written, so the story folder is
  self-contained and `/shotlist` has the right director from the first run.
- **Whenever a model in `config.json` changes.** A shot list written by the 2.0 director and
  rendered on 2.5 is exactly the bug this indirection exists to prevent — 2.0's director
  tells you to chain with `start_image`, which 2.5 silently ignores.
- **When the registry has a newer version.** Compare the installed skill against
  `/r/index.json`'s `sha256`. Re-running the install overwrites; that is intended.

## Which director is in charge

`/shotlist` writes every block prompt through **the director for `config.video.model`**, and
`/cast` writes every still through **the director for `config.image.model`**. Neither should
write prompts from its own memory — the director skill is where the model's craft lives, and
it is versioned in the registry precisely so it can be corrected after a bad render teaches
you something.

If the director for a configured model is missing, **stop and install it** rather than
falling back on general knowledge. Guessing at a model's reference semantics is how a film
gets rendered against a role the model ignores.

## Adding a model to the registry

```
registry/sources/<name>-director/
  meta.json     name, model, kind, provider, title, description, constraints
  SKILL.md      the director skill, with YAML frontmatter whose name matches meta.name
```

Then:

```bash
bin/registry-build.py <BASE_URL>     # validates and builds registry/r/
```

The build **fails loudly** on a missing field, a frontmatter/meta name mismatch, or two
directors claiming the same model — a registry that serves a broken item is worse than one
that refuses to build.

Publish `registry/r/` to any static host. The layout is the contract:

```
/r/index.json                    catalogue: every director, with sha256 and constraints
/r/models.json                   model id -> director route  (what the agent resolves against)
/r/skills/<name>.json            one route per director; carries the files to write
```

Each item is self-describing — it names its own destination paths — so the installer never
needs to know what a director is.
