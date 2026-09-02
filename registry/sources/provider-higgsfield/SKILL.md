---
name: provider-higgsfield
description: >-
  Provider adapter for Higgsfield — access by MCP. Use when config.json names
  `providers.*.id = "higgsfield"`. Covers the upload/confirm media flow, the media_id rule,
  the preset gate, and what to do when the MCP server is not connected. Auth is the MCP
  connection itself; Storyseam never handles a key for this provider.
---

# Provider: Higgsfield (access `mcp`)

## Access check — before anything else

Higgsfield is reached through MCP tools prefixed `mcp__claude_ai_higgsfield__`. There is no
API key: **the MCP connection is the auth.**

Probe with `mcp__claude_ai_higgsfield__balance`. If the tools are absent:

> The Higgsfield MCP server is not connected. **Storyseam cannot install or connect it for
> you** — the user connects it in their client, then re-runs.

Say that and stop. Do not fall back to another provider silently: the shot list and the
render budget were written for the configured one.

## Media: upload → confirm → `media_id`

This is the part that differs most from the API-key providers, and the part that fails
silently. **Every `medias[].value` must be a `media_id`.** Never an `https://` URL, never a
prior `job_id` — a URL is rejected and a `job_id` hangs.

Local file:
1. `media_upload { files: [{ filename, content_type }] }` → `upload_url` + `media_id`
2. `curl -X PUT -H "Content-Type: <the signed type>" --data-binary @<file> '<upload_url>'`
   — **the header must match the signed type** or the PUT appears to succeed and the render
   404s later.
3. `media_confirm { type: "image"|"video"|"audio", media_ids: [...] }`

Already on the web: `media_import_url` → `media_id`. This is much cheaper than re-uploading
bytes when the file is already hosted (a previous generation's `result_url`, for example).

Cache every mapping in `.storyseam/media.json` so the expensive skill never blocks on an
upload.

## The preset gate

`generate_video` may return a `preset_recommendation` instead of a job. **No credit is spent
and nothing was submitted** — it is a free round trip, not a failure.

Resend the identical call with `declined_preset_id: "<id>"`. Three things about it:

- The id is **per preset**, and a different call can come back recommending a *different*
  preset. Read the id out of *this* response.
- One of the presets on offer is called **DROWN IN MUSIC**, which breaks the no-music rule
  outright.
- Never ask the author which preset they want — the block prompt is the shot list's
  considered output; a preset overrides it.

## Job flow

`generate_video` / `generate_image` → job id → `job_status` or `jobs_wait` → `result_url`.
A 30-second 480p block takes roughly 20-30 minutes; images take 10-20 seconds.

`generate_*_batch` exists for independent jobs, but **story blocks are never batched** — the
last-frame chain is sequential by construction.

## Cost

`balance` returns credits. Preflight an unfamiliar call with `get_cost: true`, but know that
the preflight lies low: a bare `t2v` 30s/480p preflights at 75 while a real
`omni_reference` block with references has billed 75 and 105 for the same duration and
resolution. Quote the ceiling and report actuals from `balance`.
