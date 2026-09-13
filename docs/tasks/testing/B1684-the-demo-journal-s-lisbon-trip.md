---
id: B1684
title: The demo journal's Lisbon trip names photographs that do not exist, and nothing checks that a media src resolves
type: ISSUE
priority: medium
complexity: low
area: content
found: "2026-09-13T14:43:44Z"
merged: "2026-09-13T18:32:50Z"
---

# B1684 — The demo journal's Lisbon trip names photographs that do not exist, and nothing checks that a media src resolves

## Why

`content/example/trips/lisbon-2025` has days that name photographs, and the
photographs do not exist:

```
$ ssh … 'cd /var/lib/fernscout/content/example/trips; for t in …; do …; done'
alps-2024              media files: 12
asia-2023              media files: 23
parks-2025             media files: 43
usa-2026               media files: 14
lisbon-2025            media files: 0
test-pipeline-2026     media files: 0
```

Live, for a reader who is allowed in:

```
/example/media/lisbon-2025/river/01.jpg      404
/example/media/lisbon-2025/river/02.jpg      404
/example/media/lisbon-2025/tram-28/01.jpg    404
```

The trip's hero and two photographs on the Belém day render as broken-image
placeholders in a real browser. `lisbon-2025` is a `guest` trip, so this is
what an approved family member sees — and the demo journal is the first thing
anybody evaluating this software looks at.

B1643 enriched the example with `lisbon-2025` to cover the contract's guest +
teaser case. It added the trip, the days and the media *references*, and not
the bytes.

**`test/example-content.test.ts` cannot catch it**, and that is the more
useful half of this ticket. It derives what it expects from the schemas and
validates every file through `buildTripDoc`, so a `src` that is a well-formed
string passes — the test never asks whether the string resolves to a file.
The acceptance fixture can therefore promise a photograph it does not have.

## Work

Either add real photographs for the Lisbon days — public-domain, the way
B211 sourced the others — or remove the media references from those days and
let the trip carry prose only.

Then extend `test/example-content.test.ts` so every `media[].src` and every
`cover` in the journal resolves to a file that exists. Photographs are not in
the repository, so the check has to run against `CONTENT_DIR` and skip
cleanly when the bytes are not there — which means it belongs beside the
deploy's own example sync as much as in the test suite. Say which, rather
than writing a test that silently passes on a fresh clone.

Not doing: `test-pipeline-2026` also has no media, and references none —
that one is consistent.

## Acceptance

- Every `media[].src` in `content/example` resolves on the live box, or the
  reference is gone.
- `/example/trips/lisbon-2025` and its day pages show no broken image in a
  browser.
- A check fails when a day names a photograph that is not there.
