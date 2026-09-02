---
name: provider-fal
description: >-
  Provider adapter for fal.ai — access by API key (FAL_KEY). Use when config.json names
  `providers.*.id = "fal"`. Per-endpoint queue API: submit to the model's own path, then poll
  status and fetch the result. Reference media are plain public URLs. Storyseam never reads,
  stores or prints the key — it only checks that the env var is set.
---

# Provider: fal.ai (access `api_key`)

## Access check — before anything else

```
Queue base  https://queue.fal.run
Header      Authorization: Key $FAL_KEY
Env var     FAL_KEY
```

Check with `bin/provider-check.py fal`. It tests only whether the variable is **set and
non-empty**; it never prints, logs or stores the value.

If it is missing, tell the user and **stop**:

> fal.ai needs an API key. Get one at https://fal.ai/dashboard/keys, then:
> `export FAL_KEY=...` in the shell you run Storyseam from.

**Never ask the user to paste the key into the chat, and never write it into any file in the
story folder.** `config.json` names the *variable*, not the value.

## The shape: a queue per endpoint

Unlike Atlas's single prediction API, on fal **the model IS the path**.

```
POST https://queue.fal.run/{endpoint_id}                      { ...input }
  -> { "request_id": "..." }

GET  https://queue.fal.run/{base}/requests/{request_id}/status
  -> { "status": "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED", "queue_position": n }

GET  https://queue.fal.run/{base}/requests/{request_id}
  -> the model output — video.url / images[].url / audio.url on fal.media
```

`{base}` is the endpoint id with any trailing path segments trimmed to the app root. Keep the
`(endpoint, request_id)` pair together — polling needs both, and a request id alone is not
enough to find the job.

Poll roughly every 5s for images and 15s for video.

## Model routes

| Storyseam id | shape | endpoint id |
| --- | --- | --- |
| `seedance_2_5` | text→video | `bytedance/seedance-2.5/text-to-video` |
| `seedance_2_5` | start frame | `bytedance/seedance-2.5/image-to-video` |
| `seedance_2_5` | references | `bytedance/seedance-2.5/reference-to-video` |
| `seedance_2_0` | text→video | `bytedance/seedance-2.0/text-to-video` |

Pick the route the same way as on Atlas: references → `reference-to-video`, else a start
frame → `image-to-video`, else `text-to-video`.

**fal caps Seedance 2.5 at 720p**, where Higgsfield offers 1080p. Storyseam renders 480p
regardless, so this changes nothing for the engine — but do not promise the author a tier
this provider does not have.

## References are plain URLs — no upload step

Reference arrays take absolute, publicly fetchable URLs. No upload, no confirm, no media id
cache. The stills must be reachable by fal, so publish them rather than pointing at local
paths.

## Billing

Token-based rather than credit-based: around **$0.22 per second of 480p** output and
**$0.47 per second at 720p** for Seedance 2.5. A 30-second 480p block is therefore roughly
**$6.60**, and a four-block film about **$26**.

That is a different unit from Higgsfield credits, so **the `producer` skill's credit
arithmetic does not transfer**. When fal is the video provider, price in dollars and say so
— reporting "300 credits" for a fal render is meaningless to the author.

## Capability gaps against the Higgsfield default

- **`gpt_image_2` is not offered.** A story switching to fal must change `image.model`, and
  the `gpt-image-2-director` skill no longer applies.
- **No Seed Audio equivalent.** fal has single sound-effect endpoints, not multi-voice
  dialogue scenes. Storyseam does not depend on this today, but a story that starts to will
  need Atlas or Higgsfield for audio.
