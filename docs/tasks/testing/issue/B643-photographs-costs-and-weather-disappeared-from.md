---
id: B643
title: Photographs, costs and weather disappeared from a published day and nothing recorded why
type: ISSUE
priority: high
complexity: medium
area: api, days, media, data loss
found: "2026-09-06T17:59:11Z"
started: "2026-09-06T17:59:52Z"
merged: "2026-09-06T18:25:05Z"
---

# B643 — Photographs, costs and weather disappeared from a published day and nothing recorded why

## Why

**Observed on the live instance, on a real journal, on 2026-09-06.** Not a
fixture and not a test trip: `severin/algarve-2026`, fourteen days of somebody's
holiday, published earlier the same day and verified complete at the time.

Some hours later, four days were short. The journal on disk was untouched and
complete throughout, which is the only reason this is recoverable at all.

| day | photographs | costs | weather |
| --- | --- | --- | --- |
| `vom-ersten-ins-zweite-hotel` | −3 | — | — |
| `windig-an-der-praia-da-rocha` | −3 | **−5** | **gone** |
| `pool-und-steakhouse` | −2 | **−3** | **gone** |
| `roadtrip-an-die-costa-vicentina` | −3 | **−2** | **gone** |

Totals: 75 photographs → 64, seven days carrying costs → four, fourteen days
carrying a weather reading → eleven. The missing pictures were not a truncated
tail — `09`, `11` and `12` were gone from a day that still had `01`–`08`, `10`,
`13`, `14`.

The ten cost lines were read off a bank statement. Nobody could have retyped
them from memory, and on a day whose costs are gone the site says *not counted*
rather than *missing* — so a reader is told something false and nothing looks
wrong.

Recovery was a re-publish from the folder, which restored all of it, plus a
re-request of the weather. That worked, and it is not a defence: the folder is
the only copy, this happened to a journal whose owner had a complete local
source, and it would not be recoverable for somebody who had published from a
laptop they since wiped.

## What is known, and what is not

**Not known: the cause.** This ticket exists to find it, and should not be
closed by restoring anything.

Facts worth keeping:

- The four affected days are **exactly the four that a `publish` run had
  uploaded files to** earlier that day (7, 3, 2 and 3 files respectively). The
  ten days it did not upload to were untouched. That correlation is the single
  strongest lead.
- Three of the four lost costs **and** weather together, and those are the
  three that had both. Whatever happened dropped several unrelated frontmatter
  fields from a day at once, which reads more like a file being rewritten from
  a partial view than like a delete.
- The instance was deployed twice that day, by two different sessions
  (`fd4a3329`, then `23ba0ae7`).
- Work was in flight on `photoVisibility` — "a photograph cannot be held back"
  — which touches exactly the gallery this lost entries from. That is a
  neighbour, not an accusation; it may be unrelated.
- No `DELETE` was issued against the trip, any day, or any media by the session
  that found this.

## Work

- **Reproduce before changing anything.** The lead is the upload path: publish
  a day, POST media to it, then look at what the day's frontmatter holds
  immediately afterwards. `attachGallery` and `spliceEntryFields` in
  `lib/api/entries.ts` are where a day's file is rewritten; a rewrite built
  from a stale or partial read of the file would lose exactly the unrelated
  fields seen here.
- Consider concurrency directly: two writes to one day's markdown file, or a
  media POST landing while another call holds an older copy of the file in
  memory. `clearMatterCache` in `lib/entries.ts` exists because that cache has
  bitten before — check whether the media path invalidates it.
- Whatever the cause, **the fix has to make the failure loud.** Every call
  involved returned success. A day losing five recorded cost lines while the
  API answers `200` is the shape of thing this project treats as worse than an
  error.
- Add a test that writes a day with costs, weather and a gallery, uploads media
  to it, and asserts every one of those survives.

Not doing: restoring content. Already done, by re-publishing from the folder.

## Acceptance

- The loss is reproduced in a test that fails before the fix.
- A day carrying costs, weather, translations and a gallery keeps all of them
  across a media upload and a subsequent PATCH.
- If the cause turns out to be concurrent writes, there is a test that runs
  them concurrently.
- `npm run verify` green.
