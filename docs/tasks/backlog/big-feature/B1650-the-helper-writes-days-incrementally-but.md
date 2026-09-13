---
id: B1650
title: "The helper writes days incrementally, but a v2 write demands all 14 declinables at once"
type: FEATURE
priority: medium
complexity: high
area: Helper / API v2
found: 2026-09-13T10:30:00Z
---

## Why

Step 5 of the v2 migration says to repoint the helper's tools at the v2
handlers and delete each v1 helper route as it goes. For **day and trip** that
cannot be done as a refactor, and the reason is a real conflict rather than a
missing afternoon's work.

**The storage argument for step 5 has already been won.** B1598 made
`lib/api/v2/documents.ts` the one serializer, and every path already goes
through it — `lib/entries.ts:11`, `lib/trips.ts:10`, and `lib/api/entries.ts`
(`createDraft`/`editEntry`/`publishDraft`/`unpublishEntry`, which is what every
`day/*` helper route calls). The helper and the v2 route are not writing two
formats. They write the same file, in the same shape, through the same codec.

**What still differs is the completeness contract**, and that is a product
question:

- A v2 write validates the **whole merged document**, not the patch.
  `app/api/v2/[user]/trips/[trip]/days/[slug]/route.ts:275` is
  `dayWrite.safeParse(merged)`, and the comment at :214 says so outright.
- `DAY_DECLINABLES` has **14** entries; `TRIP_DECLINABLES` has **10**.
- So a PATCH that corrects a typo in the prose must also carry an answer or a
  decline for `time`, `timezone`, `tags`, `transportMode`, `translations`,
  `visibility` and the rest.

The helper writes as the conversation goes, so the person can see the day
appear. Routing that through a v2 route leaves two outcomes, and both are
forbidden by rules this project already holds:

1. **Refuse the turn** with `incomplete_day` naming ten fields nobody was
   asked about — *"a guard that fires on an honest turn is a bug, and as
   serious as one that misses"* (AGENTS.md).
2. **Synthesise the declines** so the write passes — inventing answers to
   questions the person was never asked, which is the one thing an agent may
   never do.

A third fact worth keeping: `unpublishEntry`
(`lib/api/entries.ts`) does a compare-and-swap (`fileUnchangedSince`) before
writing, refusing a takedown if the day moved under it. `writeDayFile` in
`lib/api/v2/store.ts` has no such check — the v2 *route* gets its safety from
`If-Match`/ETag, which a cookie-driven helper turn does not send. Swapping the
helper onto the bare store call would **lose a race guard**, not consolidate
one.

## Work

A decision first, then the build. The options, with what each costs:

- **(a) Teach the wizard v2's full question set.** Honest, and it is what
  "everything asked-or-declined" means. It is a real UX change — the
  conversation grows, and batching ("I don't track any of that") has to feel
  like one answer rather than fourteen.
- **(b) Give v2 an incremental write mode** that validates the patch without
  demanding whole-document completeness, with completeness enforced at
  publish instead of at every write. This is a contract change and wants a D
  row. It has a real attraction: publish is already the moment a day becomes
  something a reader sees, which is the moment completeness actually matters.
- **(c) Leave day/trip on the shared domain functions.** They already target
  the unified storage through the one serializer, and they carry guards the
  v2 store does not. Costs nothing and loses nothing today; the price is that
  "one door" stays aspirational for these two areas.

**Taken for now: (c)**, on the ground that B1598 already collected the value
step 5 was chasing here, and neither (a) nor (b) is a refactor. Nothing was
deleted and nothing was repointed.

Not doing: touching `media`, `inbox`, `contacts`, `invites`, `money` or
`storage` — those are separate merges, and **each should be checked for this
same conflict before it starts** rather than assumed to be a clean repoint.

## Acceptance

The owner picks (a), (b) or (c) as the permanent answer. If (b), it lands with
a D row in `06-contract-deltas.md` saying what completeness now means and when
it is enforced.

A test pins whichever is chosen: for (c), that the helper's day writes and a
v2 route write produce byte-identical documents for the same input, so the two
doors cannot drift apart while both exist.
