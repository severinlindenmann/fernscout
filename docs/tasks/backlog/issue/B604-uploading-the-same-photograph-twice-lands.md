---
id: B604
title: Uploading the same photograph twice lands it twice, and nothing can tell
type: ISSUE
priority: medium
complexity: medium
area: media, api
found: "2026-09-06T15:00:58Z"
---

# B604 — Uploading the same photograph twice lands it twice, and nothing can tell

## Why

`storeUploads` appends. `nextIndex(dir)` in lib/api/media.ts:138 counts what is
already on disk and the new file takes the next number, so a photograph sent a
second time becomes a second file, a second `gallery:` line and a second tile in
the gallery. Nothing on the write path compares the arriving image to what the
day already holds.

Byte comparison would not have helped, which is the part worth writing down:
every upload is re-encoded, so the two copies differ. Found on
`severin/algarve-2026`, where **eleven pairs** across four days are the same
photograph twice — dHash distance 0 or 1, identical dimensions, file sizes
within 0.3% of each other, and eleven distinct md5s:

| Day | Pairs |
| --- | --- |
| `vom-ersten-ins-zweite-hotel` | 02↔09, 03↔11, 04↔12 |
| `windig-an-der-praia-da-rocha` | 02↔11, 07↔09, 08↔10 |
| `roadtrip-an-die-costa-vicentina` | 07↔10, 08↔11, 09↔12 |
| `pool-und-steakhouse` | 03↔06, 04↔05 |

The offsets say what happened: one batch was uploaded, then a second batch
overlapping it, and the run appended after the first. The owner sees it as a
gallery that repeats itself and has no way to find out why — the CLI ingest
keeps `.ingest.json` and dedupes by source path, and an API upload goes nowhere
near it.

What it costs: the gallery, the day's `mediaCount`, `getTripStats().totalMedia`
and any photobook plan drawn from the same list all count a photograph twice,
and the quota in the `media` block is spent twice for one picture.

## Work

- Hash each arriving image **before** re-encoding, or perceptually after, and
  compare against what the day already holds.
- On a match: skip the file and say so in the response rather than refusing the
  batch — a caller resending a batch after a network failure is the common case
  and it should be idempotent, not an error.
- Decide whether the comparison is per-day or per-trip. Per-day is the smaller
  change and covers every instance found here; the same photograph on two
  different days is arguably deliberate.
- Not doing: retroactive detection of duplicates already on disk. That is a
  one-off script, and B605 is the endpoint that would let an agent act on it.

## Acceptance

Posting the same image twice to `POST /api/v1/<user>/trips/<trip>/media` leaves
the day with one copy, and the second response says which items were skipped.
A test that posts one file twice and asserts `gallery.length === 1`.
