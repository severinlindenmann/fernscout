---
id: B1700
title: content-model.json still describes v1 content — md filenames, frontmatter prose, start/end, no declined
type: ISSUE
priority: high
complexity: high
area: api, content model
found: "2026-09-14T09:05:00Z"
started: "2026-09-14T10:36:22Z"
session: 3309c078-d934-4ee7-ad04-6cd719fc543a
claimed: "2026-09-14T10:36:22Z"
---

# B1700 — content-model.json still describes v1 content

## Why

`/content-model.json` is the document a client fetches to learn the *shape* of
a journal on disk — the helper in `fernscout-helper` interprets it to inspect a
private journal on somebody's laptop. B1676 found its `doors` section naming
dead v1 routes and that is fixed (D22). The rest of the document was not, and
it is the larger half.

Compare what it declares against a real journal on this instance today:

| `content-model.json` says | `content/example` has |
| --- | --- |
| `trip.md`, `costs.md`, `plan.md`, `entries/YYYY-MM-DD-slug.md` | `trip.json` — `costs` and `plan` are sections of it |
| trip: `start`, `end` | `dates` |
| `intro` — "the prose under the frontmatter" | `intro`, a key in JSON; there is no frontmatter |
| config: `startLocation`, `defaultLocale`, `features`, `media`, `travellers` | none of them; `figures` instead |
| nothing about `declined` | every trip and day carries it — it is the contract |

`FileName` in `lib/contentModel/types.ts` is a union of the five v1 filenames,
so the staleness is in the type as well as the data, and `rules`, `named` and
`doors` are all keyed by it.

**Why this is worse than an out-of-date document.** A client that interprets it
literally — which is what it is published for — will look for files that are
not there, miss the one key (`declined`) that v2's whole contract is built on,
and report a correct journal as malformed. `test/content-model.test.ts` passes
throughout, because it checks the document against `lib/validate/*`, and those
validators are v1's too.

## Work

A decision first, because the two answers lead to different work:

1. **Regenerate from the v2 Zod schemas.** `lib/api/v2/schemas/` already
   describes every file's real shape; the document becomes a projection of it
   in the closed `assert` vocabulary. Keeps B1577's two-way gate — the reason
   `doors` survived (D22) — and keeps one address for the fact.
2. **Retire the route.** `/api/v2/openapi.json` is generated from the same
   schemas and answers "which call writes this field". This is what
   `docs/v2-migration/02-plan.md` implies. It costs B1577's gate, which is
   about a client in another repository and has no v2 replacement — so
   whatever replaces it has to be named before this is chosen.

Either way `FileName`, the `rules`, the `named` checks (`day-answers-tracked-
fields` still needs `tracks:`, retired) and `lib/contentModel/types.ts`'s prose
move together.

## Acceptance

Every filename and key the document declares exists in a real v2 journal, and
every key a real v2 journal carries is declared — or the route is gone and the
thing that replaces B1577's gate is named and built.

---

## Decided, 2026-09-14

**Option 2 — retire the route**, the owner's call, after a real migration
(B1715) was misled by this document a second time: its `files` section still
names `trip.md`, `costs.md`, `plan.md` and `entries/*.md`, and its `api` lines
advertise `POST /api/v2/{user}/trips` and `POST .../days`, neither of which
exists — both are `PUT` with a client-chosen id (verified against
`/api/v2/openapi.json` live). So the doors D22 repaired are wrong again, which
is the argument against keeping a second hand-maintained contract at all.

That leaves B1577's two-way gate to replace before the route goes, exactly as
the Work section says — it is the one thing this document does that
`/api/v2/openapi.json` does not, and it is about a client in another
repository. B1715 is that client's rewrite and is where the replacement belongs.

B1699 is the same finding captured twice; it is marked superseded by this one.

## Done, 2026-09-14

Option 2, as decided. Deleted: `app/content-model.json/route.ts`'s document,
`lib/contentModel/` (document, doors, interpret, types — 931 lines),
`test/content-model.test.ts` and `test/content-model-doors.test.ts`.

Two things fell out with it, and both were load-bearing for nothing else:

- `lib/api/tripFields.ts` — `TRIP_DETAIL_FIELDS`, "the fields
  `PATCH /api/v1/{user}/trips/{trip}` writes". That route is gone; the only
  readers left were `doors.ts` and its test.
- `validateCostsPut` in `lib/validate/costs.ts` — `PUT .../costs`, also a v1
  door that no longer exists, kept alive solely by the deleted test.
  `validateCostsPatch` beside it is still called by the helper's budget route
  and stays.

`JOURNAL_PROFILE_FIELDS` and `JOURNAL_FIELD_REFUSALS` lost their last outside
reader and are no longer exported; `lib/journals.ts` still uses both.

**What the address answers now: `410`, with the replacement named.** Not a
404, and not nothing — a client fetching this is a program, and the whole
lesson of this ticket is what happens when a document tells a program
something untrue. The body says what the document used to describe, why none
of it is how a journal is stored any more, and points at
`/api/v2/openapi.json` and `/skill/`.

### On B1577's gate, which retiring this costs

The gate was: add a key to a file's model without saying which call writes it,
and a test goes red. Its replacement is not another test — it is that the
v2 contract is **generated**. `/api/v2/openapi.json` comes from the same Zod
schemas `PUT`/`PATCH` parse with, so a field that exists is in the document by
construction and a field in the document that no route accepts cannot be
written down. The drift B1577 guarded against needed two hand-kept lists to
exist; v2 has one machine-kept one.

What that does not cover is the *client's* half — the helper keeping its own
copy of the field lists — and that is B1715, which is the rewrite of that
client against v2 and names this document as something it must stop trusting.

`npm run verify` — all 5 passed.
