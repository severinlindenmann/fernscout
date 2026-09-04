---
id: B133
title: Nothing tests the URL upload branch end to end, so the kept-original promise rests on one shared writer
type: CHORE
priority: low
complexity: low
area: media, test
found: "2026-09-03"
started: "2026-09-04T05:58:33Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T05:58:33Z"
---

# B133 — The URL upload branch has no end-to-end test

## Why

Found while verifying B30, which passes: both doors report a `kept` block with
the source dimensions, distinct from the served copy's, and the originals are
on disk on the live server at full size — 3000×2000 for both the multipart and
the URL upload, byte counts matching the two `201`s exactly.

The gap is in what guards it. B30's new test
(`test/media-upload.test.ts:426`, "the original really is on disk at full
size — the claim being doubted") calls `storeUploads()` directly with byte
candidates, which is indistinguishable from the multipart path. Nothing
exercises the JSON `urls` branch of
`app/api/v1/[user]/trips/[trip]/media/route.ts:126-162` end to end;
`test/fetch-media.test.ts` covers only the SSRF rules and never touches
`originals/`.

B30's own scope note argued this was acceptable because `kept` comes out of
`storeUploads`, the single writer both doors go through, so "the asymmetry the
task worried about could not be reintroduced without deleting the field". That
reasoning is sound today and I confirmed it holds on the live instance. It is
an argument about the current shape of the code, though, not a test — a change
that made the URL branch resize or store *before* calling `storeUploads` would
reintroduce exactly the bug B30 was raised for, and no test would fail.

That matters more than a routine coverage gap because of what the promise is.
`agent.md` tells agents the original is what a photobook prints from and that a
small source cannot be recovered later. B30 exists because an agent watched
3000px go in and 2000px come back and concluded the promise did not hold. The
next such regression would be silent.

## Work

One route-level test that drives the `urls` branch: a stubbed fetch returning a
known oversized image, through the real route handler, asserting the `201`
carries `kept` with the source dimensions and that the file under
`originals/<day>/` reads back at that size.

The existing `fetchImage` stubbing in `test/fetch-media.test.ts` is the obvious
starting point; what is missing is joining it to the storage assertion rather
than stopping at the SSRF decision.

While in there, one cosmetic thing observed on the live site and not worth its
own task: `kept.filename` for a URL upload is the last path segment of the URL,
so `https://picsum.photos/seed/x/3000/2000` reports `filename: "2000.jpg"`.
The stored file is `01.jpg` regardless, so nothing is wrong — but the field an
agent would use to correlate "which of the files I sent is this" can be
meaningless on the URL door. Either derive something better or say in the guide
that it is advisory.

## Acceptance

- A test drives the URL branch of the media route end to end and asserts the
  original's dimensions off disk, not `storeUploads` in isolation.
- Changing the URL branch to resize before storing makes that test fail.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.

## What was built

`test/media-url-upload.test.ts`. The real route handler
(`app/api/v1/[user]/trips/[trip]/media/route.ts`), a real owner token from
`verifyCode`, a stubbed remote host, and the assertion taken **off the disk**:

- `201` carrying `kept: [{ width: 3000, height: 2000 }]` while `items` is the
  2000px derivative;
- `originals/<day>/01.jpg` read back with `sharp` at 3000×2000, and its byte
  count equal to the `bytes` the response reported;
- the served file asserted separately at 2000px, so the two are demonstrably
  different files rather than one path checked twice.

DNS is stubbed alongside `fetch`. `test/fetch-media.test.ts` leaves it real
because resolution is what it is testing; here it is scaffolding, and a build
that needs `example.com` to resolve is a build that fails on a machine with no
resolver.

Two more tests came with it: the all-or-nothing rule through the route (a URL
pointing at loopback answers `400 could_not_fetch` and writes nothing), and
`kept.filename`.

**On `kept.filename`, the scope note's second half:** documented as advisory
rather than derived from something better. There is nothing better to derive —
the URL is all this door is given, and inventing a name would be a third name
for a file that already has two. The guide now says so, and says what to
correlate by instead: `kept[n]` is `items[n]` is the n-th URL sent. The test
pins the observed behaviour (`…/seed/x/3000/2000` → `"2000.jpg"`) so it is a
documented fact rather than an accident.

## Evidence

- `npx vitest run test/media-url-upload.test.ts` → 3 passed.
- The second acceptance line, demonstrated rather than asserted: with a
  temporary `sharp(...).resize({ width: 2000 })` inserted into the route's
  `urls` branch immediately before `storeUploads`, the test fails with
  `expected { filename: '2000.jpg', … } to match object { width: 3000, height:
  2000 }`. The sabotage was reverted; `git diff` on the route is empty.
