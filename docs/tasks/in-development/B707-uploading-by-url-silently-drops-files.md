---
id: B707
title: Uploading by url silently drops files past the per-day limit
type: ISSUE
priority: medium
complexity: low
area: api, media
found: "2026-09-07T11:17:09Z"
started: "2026-09-07T11:40:33Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T11:40:33Z"
---

# B707 — Uploading by url silently drops files past the per-day limit

## Why

`app/api/v1/[user]/trips/[trip]/media/route.ts:290` — the `urls` form of `POST`
does `urls.slice(0, limits.itemsPerDay)` and answers `201` without a word about
what it dropped. The multipart form of the same route *refuses* the same
overage with a `400` and an explanation.

Two doors onto one endpoint with opposite behaviour, and the quiet one loses
photographs. An agent that posted thirty urls against a limit of twenty is told
it worked. AGENTS.md is explicit that "it was accepted" must not be a lie, and
this is the shape of lie hardest to notice: nothing fails.

Found while building B682.

## Work

Make the `urls` path refuse the overage the way the multipart path does, with
the same message. Check whether any other route slices a request to a limit
rather than refusing it.

## Acceptance

Posting more urls than `itemsPerDay` returns a refusal naming the limit and the
count, and writes nothing. A test covers both forms of the route.
