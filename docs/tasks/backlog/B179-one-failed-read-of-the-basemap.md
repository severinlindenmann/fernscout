---
id: B179
title: One failed read of the basemap bundle turns every map on the instance blank until restart
type: ISSUE
priority: medium
complexity: low
area: maps, reliability, tests
found: "2026-09-03T19:40:00Z"
---

# B179 — One failed read of the basemap bundle turns every map on the instance blank until restart

## Why

`bundle()` in `lib/basemap.ts` reads `lib/mapdata/basemap.json.gz` once and
holds the result for the life of the process:

```ts
try {
  cached = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")) as Bundle;
} catch {
  cached = null;
}
```

`cached = null` is a *supported* state — a checkout that never ran
`npm run build:mapdata` serves maps without a basemap, which is documented and
right. But the same branch also swallows a **transient** failure, and then
caches it forever: one `ENOMEM`, one interrupted read, one `RangeError` on a
25 MB parse, and every map on that instance draws with no borders, no water and
no labels until somebody restarts the process. Nothing logs, and `/api/health`
does not ask.

The file is 6,709,600 bytes gzipped and **25,420,120 bytes** parsed, so this is
not a hypothetical: it is the largest single allocation the server makes.

Found on 2026-09-03 while building B85, from the symptom rather than the code.
Three consecutive `npx vitest run` on an unchanged tree gave 1790/2 skipped,
**1787/5 skipped**, 1790/2 skipped. The three that vanished were the
`skipIf(!built)` ones in `test/basemap-payload.test.tsx`, where `built` is
`basemapFor(...) !== null` — the bundle had failed to load in that worker, been
cached as null, and taken the assertions with it silently. The seven in
`test/basemap.test.ts` are guarded the same way and can vanish the same way.

So the cost is two-sided: a live instance degrades silently, and the tests that
would notice degrade silently with it.

## Work

Not decided; the two halves can be taken separately.

**The server.** Distinguish "never built" from "failed to read". The first is
absent-and-fine and should stay silent; the second should log, and should not
be cached as a permanent answer — a retry on the next request, or a bounded
number of them, costs nothing when the file is simply missing. `/api/health`
already explains why a capability is off and could say this too.

**The tests.** `lib/mapdata/basemap.json.gz` is committed, so in a checkout it
is never legitimately absent. Either assert it loaded once, in one place, and
drop the per-file `skipIf` — or keep the skip and make it *loud*, so a run that
skipped seven map assertions says so rather than reporting green.

Not in scope: the size of the bundle, or what a frame clips out of it — that is
B177.

## Acceptance

- A read that fails is not cached as "no basemap": a second call retries.
- A failed read is visible — in the log, and in `/api/health`.
- A test run where the bundle did not load cannot report green with the map
  assertions quietly skipped.
