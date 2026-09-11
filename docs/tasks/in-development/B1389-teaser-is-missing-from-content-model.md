---
id: B1389
title: "`teaser` is missing from /content-model.json, so the helper's validator calls it not a field"
type: ISSUE
priority: medium
complexity: low
area: content model, API contract
found: "2026-09-10T19:25:24Z"
started: "2026-09-11T04:33:23Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T04:33:23Z"
---

# B1389 — `teaser` is missing from /content-model.json, so the helper's validator calls it not a field

## Why

`teaser: true` (B587) is a real key on `trip.md`: it puts a locked card on
`/<user>/trips` for a `guest` or `private` trip, carrying the title and dates
and nothing else. It is written by hand into `trip.md`, accepted at
`POST /api/v1/<user>/trips` (`app/api/v1/[user]/trips/route.ts:156`) and
amendable at `PUT …/trips/<trip>/visibility` (`lib/api/tripVisibility.ts:120`).
It is parsed at `lib/trips.ts:666`, rendered at
`app/[user]/trips/page.tsx:104` and `TripsIndexContent.tsx:421`, and it feeds
the lifetime map at country resolution (B600).

Three of the four places that describe it agree. `/openapi.json` documents it
three times (`lib/api/openapi.ts:211`, `:1442`, `:2590`), `/agent.md` carries
it (`lib/api/agentCopy.ts:575`), and `lib/api/errorCodes.ts:68` explains
`invalid_teaser`.

**`/content-model.json` has never heard of it.** The `trip.md` block in
`lib/contentModel/document.ts:137-185` lists `listed` (line 150) and its
neighbours and stops; `teaser` is in neither the known-key list nor the
`apiOnly`/`fileOnly` declarations.

What that costs, in the other repository: `fernscout-helper`'s
`validate-content` skill reads this document as the file shape's only source
(`.claude/skills/shared/contentModel.mjs`), and an unrecognised key is not a
tip or a warning — `validate.mjs:154-157` raises an **error** reading

> `teaser is not a field` — *nothing reads it — it will be dropped*

Both halves of that sentence are false, and the advice it implies is
destructive: an agent validating a journal is told, in the validator's own
voice, to delete the line that is advertising the trip. The offline snapshot
(`content-model.snapshot.json`, taken 2026-09-06 from fernscout.ch) carries the
same absence, so a clone that never reaches the instance says it too.

**Why nothing caught it.** `test/content-model.test.ts` crosschecks the
document against `/openapi.json` in *both* directions for
`entries/YYYY-MM-DD-slug.md` (`:149`) and for `config.json` (`:160`, `:169`) —
"every key the API takes is either in the file list or declared apiOnly", and
"every offered key is actually taken". For `trip.md` only the second direction
exists (`:178`, "every offered key is taken by POST …/trips"). A key the API
takes and the document omits is exactly what that missing test would have
found, and `teaser` is not necessarily the only one.

## Work

- Add `teaser` to the `trip.md` block in `lib/contentModel/document.ts`, beside
  `listed`: `type: "boolean"`, with a `because` saying it names a closed trip
  on the trips page without opening it and is refused on a public one. It is a
  plain shared key — the file carries `teaser: true` literally and the API
  takes the same name — so neither `apiOnly` nor `fileOnly`, the same call
  `test` gets at `:184`.
- Add the missing crosscheck direction for `trip.md` in
  `test/content-model.test.ts`, mirroring the `entries` test at `:149`: every
  property of `POST /api/v1/{user}/trips`'s request body must be either in
  `fileKnownKeys("trip.md")` or in `apiOnlyKeys("trip.md")`. Fix whatever else
  it turns up in the same change, or capture it if it is not small.
- Consider whether `PUT …/trips/<trip>/visibility`'s body should feed that
  crosscheck too — `visibility`, `listed` and `teaser` are amendable there and
  a key that only ever arrives on that route would still be invisible to the
  new test. A note in the test is enough if the answer is no.

**Not in this ticket.** No change to `/openapi.json` or `/agent.md` — both
already tell the truth. No change in the `fernscout-helper` repository beyond
what falls out of the document: the point of B609/B610 is that the client reads
the server's document, so fixing the document is the fix. Its snapshot
(`content-model.snapshot.json`) is regenerated from a deployed instance by its
own `snapshot.mjs`, so it corrects itself after this ships and is deployed —
worth saying so in the run report, since `selftest.mjs`'s `snapshotDrift()`
will fail loudly there until somebody reruns it.

## Acceptance

- `curl -s localhost:3000/content-model.json | jq '.rules[] | select(.where == "trip.md" and .path == "teaser")'` returns a rule.
- `npx vitest run test/content-model.test.ts` passes, and the new `trip.md`
  crosscheck fails when `teaser` is removed from `document.ts` again.
- In a `fernscout-helper` clone pointed at the instance, a `trip.md` carrying
  `visibility: guest` and `teaser: true` validates with no error about
  `teaser`.
