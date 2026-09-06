---
id: B632
title: A day cannot be held back to guests or to the people who were there
type: FEATURE
priority: high
complexity: high
area: content model, day visibility
found: "2026-09-06T17:51:45Z"
started: "2026-09-06T19:29:15Z"
merged: "2026-09-06T20:04:24Z"
---

# B632 — A day cannot be held back to guests or to the people who were there

## Why

`visibility:` today exists on a trip and, since B596, on a single photograph. It
does not exist on a **day**. So an owner who wants one entry of a public trip
kept to guests, or to the people who were there, has no way to say it — the
only lever is `status: draft`, which is "not finished", not "not for everyone".

Two entries on one day is normal (AGENTS.md says so), and the case that
prompted this is exactly that: one entry for everybody, one for guests. A guest
should see both; a stranger should see the first.

The vocabulary and the machinery already exist and should be reused rather than
reinvented: `PHOTO_VISIBILITIES` and `maySeePhoto` in `lib/photos.ts` are the
narrowing rule, `readFor` in `lib/tripGate.ts` is the reader's level, and
`visible()` in `lib/entries.ts` is where the stripping happens.

## Work

- An entry may carry `visibility: guest | private`. It narrows and never widens
  against the trip's own value — the same sentence `lib/photos.ts` already
  makes about a photograph, and probably the same function.
- Three halves, and any one missing makes it a leak: the read paths in
  `lib/entries.ts`, the day's own route and `.md` source, and the feed, sitemap
  and search index (`isIndexable` in `lib/access.ts`).
- Document it: `/agent.md`'s entry field list and the request schemas in
  `lib/api/openapi.ts`. A field the API takes must be readable back.
- To the owner and the people on the trip, say on the day which value it
  carries — otherwise nobody can check their own work. That is the same need as
  B631 and should look like it.
- `/<user>/me` tells a reader what they can read. It lists trips; it should say
  when what they are being let into is the guest-only part rather than all of
  it.

## Acceptance

- On a `public` trip, an entry marked `guest` is absent for a signed-out reader
  — page, feed, sitemap, search index and `.md` source — and present for an
  approved guest.
- A day with a public entry and a guest entry shows one to a stranger and both
  to a guest.
- A `guest` entry inside a `private` trip stays private.
- `/openapi.json` documents the field and some documented `GET` reads it back.

## Findings

**The vocabulary is exactly `lib/photos.ts`'s, reused rather than duplicated.**
`Entry.visibility?: PhotoVisibility` (lib/types.ts), parsed in
`readAllEntries` with `parsePhotoVisibility` (fail-closed, same as a
photograph's own label), and dropped in `visible()` (lib/entries.ts) with the
same `maySeePhoto(entry.visibility, level)` call the gallery filter already
made — an entry below its level is now `.filter()`ed out entirely, before the
existing per-photograph `.map()` runs.

**Every read path enumerated before anything was changed**, by grepping
`getAllEntries`/`getEntryBySlug`/`getDays`/etc across `app/` and `lib/`:

| Path | Needed a change? |
| --- | --- |
| `lib/entries.ts` `visible()` | Yes — the filter itself |
| Day page (`app/[user]/(trip)/day/[slug]/page.tsx` and the `/trips/<trip>/day/<slug>` twin) | No — already calls `getEntryBySlug(ref, slug, read)` via `readFor`, which now filters for free |
| Trip/story pages, gallery, map, costs, weather, analytics (all via `buildStoryProps`/`getDays`/`getAllEntries` with `...read` spread) | No — same reason |
| `.md` twin (`lib/api/markdownTwin.ts`) | **Yes** — it only ever called `getEntryBySlug` with no `reader` (silently defaulting to `"public"`), so an approved guest asking for a `guest`-labelled day's markdown got a 404 too. Added `readerLevelFor(trip)` per lookup |
| Feed (`lib/feed.ts`) | No — `getAllEntries(trip.ref)` with no options already defaults to `reader: "public"`, which now excludes a labelled entry for free |
| Sitemap (`app/sitemap.ts`) | No — same default-reader argument |
| Search index (`lib/search.ts`) | No — same |
| `/api/v1/.../days` GET (list, `AS_AUTHOR`) and `/days/<slug>` GET | No filtering needed (owner/traveller reads everything), but the single-day GET needed `visibility` added to its response so a write is readable back |
| `/api/v1/.../days` POST, `/days/<slug>` PATCH | Yes — new field, `EDITABLE_DAY_FIELDS`, validator, splice |
| `entrySummary` (days list) | Yes — added `visibility` alongside `draft`/`test` |
| `DayStructuredData`/`BlogStructuredData` (JSON-LD) | Not touched — `BlogStructuredData`'s `getAllEntries(tripId)` call already has no `reader` option even for photo visibility (pre-existing gap from B631, not widened here); safe direction (defaults closed), just under-representative for an owner's own JSON-LD. Left consistent with precedent rather than fixed as a drive-by |
| `/<user>/me` (`lib/viewer.ts`) | Yes — new `partial` flag per bullet 5 |

**`isIndexable` in `lib/access.ts` was not touched.** It is a trip-level
predicate; the entry-level narrowing is a separate, additive filter that
already runs wherever `isIndexable`-gated code calls `getAllEntries`.

**Write side mirrors `photoVisibility` but is create-*and*-edit**, since it is
one scalar on the entry rather than a label keyed by a photograph's `src` that
does not exist until the upload call. `DraftInput.visibility?: PhotoVisibility`
on create; `EditInput.visibility?: PhotoVisibility | null` on edit, `null`
clearing it. `checkVisibility` in `lib/validate/entry.ts` refuses `"public"`
with the same sentence `checkPhotoVisibility` gives, and refuses anything not
in `PHOTO_VISIBILITIES` (except `null`/absent).

**A latent TypeScript quirk, noted but not chased**: `EditInput` inherits
`visibility` from `Partial<Omit<DraftInput, "idempotency_key">>` *and*
re-declares it more widely (`| null`) in the same intersection — the same
shape `weatherData` already has. A literal object typed directly as
`EditInput` with `visibility: null` fails to typecheck (TS checks the literal
against both halves of the intersection); passing an already-typed `EditInput`
value through, as the route handler does (`body as EditInput`), does not hit
this. Not fixed — `weatherData` already has the identical shape and nothing
exercises it as a literal either; changing the pattern for one field only
would leave the other inconsistent. `test/entry-visibility.test.ts` casts
around it with a comment explaining why.

**Example content**: `content/example/trips/usa-2026/entries/2026-08-24-oregon-coast-evening.md`
(the second update of a day that already had two, "Down the Oregon coast" /
"Later, from the same car park") is now `visibility: guest` — reachable at the
site's front door (`usa-2026` is the current trip), and exactly the "one entry
for everybody, one for guests, same day" case the ticket was written for.

**Tests** (`test/entry-visibility.test.ts`, 28 cases; `test/entry-visibility-marker.test.tsx`,
3 cases) cover, per acceptance line: the full viewer × trip-visibility table
(anonymous/stranger/guest/traveller/owner × public/guest/private trip, mirroring
`test/photo-visibility.test.ts`'s own table); the two-entry day shown as one
to a stranger and both to a guest; a `guest`-labelled entry inside a `private`
trip staying private; the feed, sitemap, search index and markdown twin each
excluding a held-back entry and the twin answering for an approved guest;
creation/validation refusing `"public"`; a PATCH writing and `null`-clearing
the label; and the `/me` `partial` flag for a stranger, an approved guest, and
an owner/traveller.

**Also fixed along the way, discovered by the content-model/contract tests**:
`FRONTMATTER_TO_API` (`lib/api/agentCopy.ts`) needed a `visibility` row,
`DAY_SAMPLES` (`test/contract-roundtrip.test.ts`) needed a sample value, and
`lib/contentModel/document.ts` needed the key declared for
`entries/YYYY-MM-DD-slug.md` — all three failed loudly rather than silently
before this was added, which is the whole point of those tests.

**`npm run verify`** (full, not `--quick`): build → tsc → eslint (0 errors, the
same 20 pre-existing warnings) → vitest, 306 files / 3978 passed / 3 skipped
(Postgres, no local server) — all green.

**Security review**: the `claude-security` orchestrator agent was dispatched
over the diff and could not run — its session had no `Workflow` tool
available (needed by `claude-security:scan`, which every scan and its
verification panel run through), and it correctly refused to reimplement the
pipeline by hand from `Read`/`Bash`/`Agent` rather than fake a scan. It named
the tool gap and stopped, per its own instructions, and suggested a
`Workflow`-enabled session run `scan-codebase` next, scoped to
`app,components,content,lib,site,test` at `medium` effort, over the on-disk
worktree (the changes are uncommitted, which a git-diff-based scan cannot
see). Recorded here as unavailable rather than skipped silently.

**In its place, a manual review of every read path found a fourth surface the
original enumeration missed: the day's own mail and WhatsApp announcements.**
`sendDayLetter`/`mailWouldCost` (`lib/digest/dayLetter.ts`) and
`sendDayWhatsapp`/`whatsappWouldCost` (`lib/digest/dayWhatsapp.ts`) each build
a recipient list from the *trip's* own mail permission (`mayMailTrip`) with no
regard for the entry actually being sent — so a `private`-labelled update on
an otherwise fully public, fully open trip would have mailed (or messaged)
every approved contact of the journal, the exact leak this feature exists to
close, delivered to an inbox instead of a URL. Fixed by filtering each
recipient list with `maySeePhoto(entry.visibility, recipient.reader)` — both
letter and WhatsApp recipients already carried, or were given, a `reader`
field for exactly this reason (B596 did it for the letter's own photograph
picker; WhatsApp's `WhatsappRecipient` did not have one before this).

That fix also uncovered a second problem: all four functions fetched the
entry with `getEntryBySlug(ref, slug, { includeDrafts: true })` — no
`reader`, so the closed default (`"public"`) applied — which means a
held-back day would answer `unknown_day` to the owner's own send/quote call,
because `visible()` now drops the whole entry at that level. Fixed by reading
with `AS_AUTHOR` in all four (the owner asking about their own send is
entitled to find the day regardless of its label). WhatsApp's header-photo
pick relied on that same public-level read to keep a labelled *photograph*
out of the one image a template sends to the whole list; switching the entry
read to `AS_AUTHOR` would have broken that silently, so `headerPhoto`
(`lib/digest/dayPhoto.ts`) now takes an explicit `level` parameter (still
`"public"` by default) instead of trusting how its caller happened to read
the entry.

Tested in `test/entry-visibility.test.ts`: `mailWouldCost` on the same open
trip quotes 1 recipient for an ordinary update and 0 for a `private` one
(the approved contact who is not a traveller is exactly the recipient the
label now excludes). The WhatsApp path was not given its own send-level test
(it needs a configured template and a phone number to exercise beyond what
`test/whatsapp.test.ts` already fixes) — verified instead by the identical
code shape, by `npx tsc --noEmit` passing with the new `reader` field wired
through, and by the existing 60-case `test/whatsapp.test.ts` /
`test/day-mail.test.ts` suites passing unchanged.

**Three more owner/agent-only read paths were widened from the closed
default to `reader: "person"`, having no business filtering by visibility at
all**: `lib/plan.ts`'s `mergeDraftStops` (only ever reached for an audience
already cleared to see drafts), `lib/api/tripGaps.ts`'s `tripGaps` (the
agent's own trip-gaps report), and `lib/statusReport.ts`'s per-journal
day/draft counts (an operator's own CLI report). None of these were a leak —
the closed default fails toward *undercounting*, not overexposing — but each
would have silently miscounted a published-and-labelled day as a draft, or
dropped a labelled draft from an owner's own planned route.
