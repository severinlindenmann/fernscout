---
id: B179
title: One failed read of the basemap bundle turns every map on the instance blank until restart
type: ISSUE
priority: medium
complexity: low
area: maps, reliability, tests
found: "2026-09-03T19:40:00Z"
started: "2026-09-04T06:43:31Z"
merged: "2026-09-04T07:30:27Z"
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

**The server — done.** `bundle()` in `lib/basemap.ts` no longer answers a
failed read the way it answers an absent file.

- `cached = null` is now reserved for **ENOENT**: never built, permanent,
  silent. That is the documented state a checkout which skipped
  `npm run build:mapdata` is in, and it stays exactly as cheap as it was.
- Any other failure is recorded in `readProblem` — message, time, attempts —
  and *not* cached as an answer. The next call reads again.
- The retry is bounded rather than unbounded: three eager attempts, then a
  30-second backoff. A transient fault gets the next request; a corrupt file
  does not get a 6.7 MB read and a 25 MB parse on every page render for the
  life of the process.
- One `console.warn` per **distinct** fault, following `rootProblem` in
  `lib/users.ts` (B197) exactly: this is on the path of every map, and a trip
  page builds two of them, so a line per render is how the warnings that
  matter stop being read. Repeated when the message changes.
- `basemapProblem()` is exported and `/api/health` reports
  `basemap: { ok: false, error }`.
- `clearBasemapCache()` drops the recorded fault as well as the bundle, so a
  test that mocked `readFileSync` into throwing cannot leave the next one
  reporting a broken instance.

**Health reports it as a field, not as `status`.** A basemap that will not read
means maps draw without borders; the site is otherwise fine. That is the call
`backup` already makes in the same route — "not a reason to take an instance
out of a load balancer, and very much a reason to page somebody" — and it is
the difference from B197's `content`, where nothing resolves at all. Nothing on
that route forces a read of the bundle, so an instance that has drawn no map
since booting says `ok`; the note in the route says so.

**The tests — done, the loud way.** `lib/mapdata/basemap.json.gz` is committed,
so in a checkout it is never legitimately absent, and the `skipIf(!built)`
guards could only ever fire for the reason this task is about. They are gone:
`test/basemap.test.ts` and `test/basemap-payload.test.tsx` now assert the
bundle loaded, once each, in a named test. A run that cannot read it fails
there instead of reporting green with seven assertions missing.

## Acceptance

- ✅ *A read that fails is not cached as "no basemap": a second call retries.* —
  `test/basemap-bundle.test.ts`, "is not cached as 'no basemap': the next call
  reads again": the spy counts two reads where it used to count one forever.
- ✅ *A failed read is visible — in the log, and in /api/health.* — "says so
  once per distinct fault, not once per map", and "reports a bundle it could
  not read, without failing the instance".
- ✅ *A test run where the bundle did not load cannot report green with the map
  assertions quietly skipped.* — no `skipIf` left in either map test file;
  both assert the load.
- Plus: a transient fault clears itself once the file reads again, a permanent
  one stops being retried, and ENOENT stays silent and free.

## Verified

`npx vitest run test/basemap-bundle.test.ts` — 7 passed. All seven fail on the
branch point (`git stash` of `lib/basemap.ts` and `app/api/health/route.ts`:
7 failed).

Full suite in the worktree, three consecutive runs on an unchanged tree:
**122 files, 1995 passed, 2 skipped** each time. The two skips are the
Postgres ones (`POSTGRES_TEST_URL` unset), which announce themselves in the
output. The map skips this task was found through are gone — there is nothing
left in either map file that can vanish quietly.

`npm run build`, `npx tsc --noEmit`, `npx eslint .` all clean.
