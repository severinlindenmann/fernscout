---
id: B1769
title: Every day build.mjs writes carries both time and declined.time, which the instance refuses
type: ISSUE
priority: high
complexity: low
area: fernscout-helper icloud-export, build.mjs
found: "2026-09-15T06:24:22Z"
started: "2026-09-15T06:39:48Z"
merged: "2026-09-15T07:09:12Z"
---

# B1769 — Every day build.mjs writes carries both time and declined.time, which the instance refuses

## Why

`build.mjs` sets `declined.time` unconditionally — "the time of day was not
recorded beyond the photographs' own" — and in the same document also sets
`time: first.time`. The instance refuses exactly that shape:
`lib/api/v2/schemas/shared.ts:61` answers "both provided and declined — remove
one. A section cannot be there and consciously absent at once."

So every day this script writes is refused on the wire. In one run that was 145
of 196 entries, and it is not visible locally at all — the folder is written
successfully and the refusal only appears when `publish` or `validate-content`
asks the instance.

The other declines in that block are guarded by whether the value exists
(`location`, `country`, `coordinates`, `media`); `time` is not, and neither is
the sentence that goes with it.

## Work

Decline `time` only when no photograph gave one. Then check the rest of the
block the same way: a decline emitted beside a value is a refusal, so the two
should be written from one place rather than as two independent lines.

A regression test in `icloud-export/build.test.mjs` asserting no key appears in
both the document and its `declined` map is what keeps the next field from
doing this again.

## Acceptance

`node build.mjs` on the fixture produces documents where no key is both set and
declined, and `validate-content --offline` plus a live `?dryRun=true` accept
every day it wrote.

## Built, 2026-09-15 — fernscout-helper `aa69dbd`

**Valid when taken**: `declined.time` was set unconditionally while
`time: first.time` was also set, and `lib/api/v2/schemas/shared.ts:61` refuses
exactly that.

`time` is declined only when no photograph carried one, and is written only
when one did. The rule itself is now checked rather than remembered: after each
document is assembled, any key that appears in both the document and its
`declined` map stops the build with the day named — so the next field to make
this mistake fails locally instead of on the wire.

Keeper: two checks in `build.metadata.test.mjs`, one of them the general
invariant.
