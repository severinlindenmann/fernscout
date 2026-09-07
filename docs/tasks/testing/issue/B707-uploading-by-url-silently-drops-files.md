---
id: B707
title: Uploading by url silently drops files past the per-day limit
type: ISSUE
priority: medium
complexity: low
area: api, media
found: "2026-09-07T11:17:09Z"
started: "2026-09-07T11:40:33Z"
merged: "2026-09-07T12:17:53Z"
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

## Resolution

`app/api/v1/[user]/trips/[trip]/media/route.ts` — the `urls` branch now
refuses `urls.length > MAX_ITEMS_PER_DAY` before fetching anything, the same
shape of `invalid_media`/400 the multipart branch already answers with (it
checks `files.length > MAX_ITEMS_PER_DAY` a little further down in the same
file). `urls.slice(0, limits.itemsPerDay)` is gone; nothing is silently
trimmed any more.

One correction to the ticket's own reading: the refusal now compares against
`MAX_ITEMS_PER_DAY` (the request-level constant the multipart form uses,
currently 40), not `limits.itemsPerDay` (the day's own remaining room, which
`storeUploads`' day ceiling still enforces separately and refuses with a
different message once the files are actually written). That mirrors the
multipart form exactly — see the comment `lib/validate/media.ts:213-225`
(B209/B229) on why the per-request cap and the day-ceiling are deliberately
two different checks with two different messages, and why collapsing them
would resurrect a bug those tickets closed.

Checked for the same silent-slice shape elsewhere: `lib/ingest/index.ts:511`
also caps a day's cluster at `MAX_ITEMS_PER_DAY`, but it already names every
skipped file in `skipped` rather than dropping them quietly — not the same
bug, nothing to fix there.

Test: `test/media-url-upload.test.ts` — "a batch of urls bigger than the
per-day limit / is refused, not silently trimmed". Confirmed it fails before
the fix (answers `could_not_fetch` from an attempted real fetch instead of
`invalid_media`) and passes after.
