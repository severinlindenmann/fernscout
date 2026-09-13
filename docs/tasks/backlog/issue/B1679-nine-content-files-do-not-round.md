---
id: B1679
title: Nine content files do not round-trip byte-identically through the serializers
type: ISSUE
priority: low
complexity: low
area: content
found: "2026-09-13T14:28:34Z"
---

# B1679 — Nine content files do not round-trip byte-identically through the serializers

## Why

`lib/api/v2/documents.ts:89-93` states the invariant this migration rests on:

> Key order is fixed so that serialising the same document twice matches
> byte-for-byte: a diff in git is then always a change in content, never a
> change in this function's mood.

That is not true of nine files in `content/example` today. Running the real
`dayFromJson`/`dayToJson` and `tripFromJson`/`tripToJson` over all 57 day and
trip files:

```
Checked 57 files (days + trips).
Mismatches: 9
```

`asia-2023/entries/2023-01-08-leaving-zurich.json`,
`asia-2023/entries/2023-01-09-bangkok-boat-to-thonburi.json`, four
`lisbon-2025` days, `lisbon-2025/trip.json`,
`test-pipeline-2026/entries/2026-02-01-a-day-nobody-lived.json`,
`test-pipeline-2026/trip.json`.

All nine are **semantically identical** — no data is lost. Two causes: key
order on disk differs from `dayToJson`'s fixed order (`costs` written last
rather than after `media`; `accent`/`cover` after `intro`), and
`"windMax": 31.0` on disk which `JSON.stringify` emits as `31`.

The cost is a future diff: the next real edit to one of these days through the
API produces a whole-file reordering alongside the one-line change, which is
precisely what the invariant was written to prevent. The demo journal is also
the acceptance fixture, so the files that prove the format are the ones that
do not hold it.

## Work

Re-serialise the nine files through `dayToJson`/`tripToJson` and commit the
result.

Then add the round-trip check to `test/example-content.test.ts`, which already
validates every example file through `buildTripDoc` — one more assertion that
`toJson(fromJson(bytes)) === bytes` for every file under `content/`. Without
it this drifts back the first time a file is hand-edited.

## Acceptance

- A test over all of `content/` asserts byte-identical round-trip, and passes.
- `npm run verify` green.
