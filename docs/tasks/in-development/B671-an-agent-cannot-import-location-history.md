---
id: B671
title: An agent cannot import location history, because the only way in is a shell on the server
type: FEATURE
priority: high
complexity: high
area: api, gps, importers, agent-guide
found: "2026-09-07T08:46:35Z"
started: "2026-09-07T08:47:05Z"
session: 1d31e523-3a22-4905-82fd-39e3d55289f5
claimed: "2026-09-07T08:47:05Z"
---

# B671 — An agent cannot import location history, because the only way in is a shell on the server

## Why

TODO — the problem, not the fix.

## Work

TODO

## What changed while building

**Four doors for the bytes, not three.** `inbox` (the normal path), multipart
`file`, and `text` for a few lines pasted inline. The inline door needed a
correction found by driving it: the placeholder filename was `inline.jsonl`,
and `fixes.detect` recognises a `.jsonl` **by name**, so a pasted CSV came back
saying JSON Lines held no positions rather than that nothing recognised it. The
placeholder now carries no extension, which forces detection to read the
contents — the only honest thing to go on there. The refusal also says "the
text you sent" rather than naming a file nobody sent.

**A refusal an importer's own filtering hides.** Every importer here drops a
row that is not on Earth, so a file with latitude and longitude the wrong way
round reaches the contract check as an *empty parse*, not as bad rows. The
"parse returned nothing" message therefore had to name that cause too, or it
sends somebody hunting a format problem they do not have.

**`storageRefusal` is async and answers with a message, not a Response.** Taken
for a synchronous `Response | null`, the route returned a promise, Next
resolved it to `null`, and every owner call answered with nothing at all. Found
by the route test, which is the argument for having written it.

**Three error codes reach a caller through a variable**, so `lib/gps/api.ts`
joins `SPEAKS_TO_CALLERS` in `test/openapi-contract.test.ts` — the mechanism
that list already existed for.

## Acceptance

TODO

## Why

B665 built the store, the importers and the derivation, and put the only door
to all three in `scripts/gps.mts`. That is a shell on the machine the site runs
on — which the owner of a hosted journal does not have, and which an agent
never has.

So the feature is unreachable by the people it was built for. An agent can
already put a `Timeline.json` into `inbox/files/` (B663 accepts `.json` and
`.gpx`) and can do nothing with it afterwards. The one rule this project has is
that **the agent is the editor**; a capability with no network door is a
capability that does not exist.

**The CLI goes away entirely** rather than being kept beside the routes. Two
doors to a write path is two sets of rules for what an import may do, and the
one nobody exercises is the one that rots — `scripts/gps.mts` would be the
unexercised one the day the route lands.

## Work

**One import door, keyed by kind and format**, so the second kind of data
(costs, from a bank export) is the same call with different words rather than a
second route:

```
GET  /api/v1/<user>/import              what can be imported, and how
POST /api/v1/<user>/import              { kind, format?, inbox | multipart, dryRun? }
POST /api/v1/<user>/trips/<trip>/track  derive this trip's line from the store
```

- `kind` is `gps` today — the folder under `importers/`. `format` is
  `google-timeline`, `google-records`, `gpx`, `fixes`; **absent means detect**,
  which is what `detect(head, filename)` is for.
- The bytes arrive either as `{"inbox": "<id>"}` — the file B663 already holds,
  which is the normal path — or as multipart for a one-shot.
- `dryRun: true` parses, runs the kind's own contract check, reports what it
  found and writes nothing. This is what `--dry-run` was, and it is how
  somebody tests an importer they wrote.
- The response says what happened in the store's own terms: fixes read, the
  span they cover, how many the store holds for those months before and after.

**Owner only, and never a trip-scoped token.** The store is the *journal's* —
a person's whole life of positions, not one trip's — so somebody who came on
one trip must not be able to write into it or to cause a track to be derived
from it. Same refusal the inbox route already makes, same wording.

**No `GET` that returns a position, ever.** `GET /import` describes formats,
not data. B665's rule stands: the store is read by nothing over HTTP, and this
ticket must not become the exception. `test/gps-store.test.ts` asserts the
import graph and has to keep passing — which means the route imports a
`lib/gps/import.ts` that owns the writing, and the assertion widens to name
what a route may and may not reach.

**The registry has to become static.** `scripts/gps.mts` discovered importers
with `fs.readdirSync` plus a dynamic `import()`, and a Next server bundle
cannot trace that — the files would simply be absent in a standalone build.
So each kind gets an `index.ts` listing its importers, and a test asserts the
list and the folder agree, naming the missing line. Dropping a file in is
still the whole installation; it is now a file and one line, and the test is
what says so.

**Delete**: `scripts/gps.mts`, the `gps` script in `package.json`, and the
knip entry that existed for the dynamic import.

Contract, per `keep-the-contract`: three operations in `lib/api/openapi.ts`
with their refusals, the kinds and formats as *imported* enums rather than
retyped lists, and `/agent.md` gaining the workflow end to end — upload to the
inbox, import, derive, and what never to do with what comes back.

## What changed while building

**Four doors for the bytes, not three.** `inbox` (the normal path), multipart
`file`, and `text` for a few lines pasted inline. The inline door needed a
correction found by driving it: the placeholder filename was `inline.jsonl`,
and `fixes.detect` recognises a `.jsonl` **by name**, so a pasted CSV came back
saying JSON Lines held no positions rather than that nothing recognised it. The
placeholder now carries no extension, which forces detection to read the
contents — the only honest thing to go on there. The refusal also says "the
text you sent" rather than naming a file nobody sent.

**A refusal an importer's own filtering hides.** Every importer here drops a
row that is not on Earth, so a file with latitude and longitude the wrong way
round reaches the contract check as an *empty parse*, not as bad rows. The
"parse returned nothing" message therefore had to name that cause too, or it
sends somebody hunting a format problem they do not have.

**`storageRefusal` is async and answers with a message, not a Response.** Taken
for a synchronous `Response | null`, the route returned a promise, Next
resolved it to `null`, and every owner call answered with nothing at all. Found
by the route test, which is the argument for having written it.

**Three error codes reach a caller through a variable**, so `lib/gps/api.ts`
joins `SPEAKS_TO_CALLERS` in `test/openapi-contract.test.ts` — the mechanism
that list already existed for.

## Acceptance

- An agent token can `POST` a `Timeline.json` (by inbox id and by multipart)
  and see the store's count change; a trip-scoped token is refused on all
  three routes.
- `format` omitted detects the format; a wrong `format` is refused with what
  the choices are.
- `dryRun: true` writes nothing and reports the same counts.
- `POST …/trips/<trip>/track` writes `track.json` and the trip's map draws it.
- No route returns a fix. The import-graph test passes with the new routes.
- An import that would take the journal past its ceiling is refused (B661).
- `npm run gps` no longer exists, and nothing references it.
- `/openapi.json` documents all three, and `/agent.md` explains the workflow.
- `npm run verify` and `npm run unused` pass.

## What was verified

Against a running dev server with a real ten-month Google Timeline export
(3.3 MB), driven over HTTP with a token obtained the way an agent obtains one:

| | |
| --- | --- |
| Staged in the inbox, imported by id | detected `google-timeline`, 22,659 read → 16,315 stored across 11 months |
| The same call again | `before 16315, after 16315` — a re-import is a no-op |
| `dryRun` | same counts, `stored` absent, nothing on disk |
| A trip made over the API, then `POST …/track` | 21 segments, 471 points; the flight out is a gap |
| The same again | identical, and it rewrites one file |
| A trip with nothing stored for its dates | `written: false`, and no file replaced |
| A private zone, then redraw | `zones: 1`, and the points inside gone |
| GPX by multipart, format named | `detected: false`, 3 fixes |
| The same GPX, format omitted | `detected: true` |
| Inline JSON Lines | `fixes`, 2 rows |

And the refusals, each answering in words: `unknown_format` (named, and
detected), `unknown_kind`, `contract` (swapped coordinates, seconds as
milliseconds), `no_file`, `unknown_inbox_file`, `missing_token`, 404 on an
unknown trip. No response anywhere carried a coordinate, and there is no route
that reads the store.
