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

**Decided: (a).** The owner's own words are the spec: *"one of the main goals
of this update to v2 for B1650 is that there is less incremental updates, sure
the agent still can update it step by step by going through the 'declined'
steps, but the goal is that on the first entry it should be already
completed, the agent should ask the user for all the information and not
create the day before all is defined."* (c) was the provisional answer above
and is superseded — not because the storage argument was wrong (B1598 still
stands), but because the owner wants fewer half-written days on disk, not
merely a working write path.

**What "teach the wizard v2's full question set" turned out to mean, once
built, is narrower than the name suggests — and deliberately so.** A
follow-up correction from the owner ruled out a client-side completeness
list: *"the agent sends the api request and if data is missing he is
reminded ... and just when the user actively declines then we set the
declined setting."* So the mechanism is the existing refusal loop
(`missingFrom` → `incomplete_day`, naming the fields), not a new upfront
questionnaire the helper runs before every write. Concretely, for the day
side:

- `lib/tracks.ts` gained four rows — `time`, `transportMode`, `tags`,
  `visibility` — using the exact registry `costs`/`coordinates`/`photos`
  already had. `POST /api/helper/[user]/day` and
  `POST /api/helper/[user]/assemble-day` both already ran `missingFrom`
  before writing; they now refuse `incomplete_day` naming these four too,
  for free, because the registry grew rather than the routes' own logic.
- **Neither card pre-fills a default for the four new rows**
  (`CARD_PREFILL_TRACKS` in `lib/tracks.ts` names the three that still do,
  unchanged from before this ticket). A person pressing through a card that
  already says "unknown" is not the same as being asked, so the new rows are
  never shown that way — only ever answered because the model supplied a
  real value or an actual decline, read directly off the press body
  (`start_day`/`assemble_day` each declare the four as string tool
  arguments, with the two decline spellings — `"none"`/`"unknown"` —
  documented in each one's description).
- `lib/api/entries.ts` and `lib/entries.ts` already carried everything else:
  `DraftInput` already accepted `time`/`transportMode`/`tags`/`visibility` as
  real values (this widens each to also accept a decline, the same shape
  `costs` already had), and `createDraft`/`editEntry` already wrote through
  `lib/api/v2/documents.ts` — B1598's own point, that the storage argument
  was never in question.
- Not built this round: `location`/`country`/`countryCode`/`timezone` (tied
  to `coordinates` rather than independent questions — no card change needed,
  and a real per-field ask for them is a separate, smaller ticket) and
  `translations` (needs the journal's own locale count, which `lib/tracks.ts`
  deliberately cannot read, and the helper has no tool that writes per-language
  content at all yet). The **trip** side (`TRIP_DECLINABLES`: `rates`,
  `costs`, `plan`, `translations`, `accent`, `figures`, `tagline`, `intro`,
  `listed`/`teaser`) is untouched — `create_trip`/`edit_trip` still only ask
  title/dates/visibility, and the same gap this ticket found on days exists
  there too. Both are worth their own tickets rather than folded into this
  one's build.

Not doing: touching `media`, `inbox`, `contacts`, `invites`, `money` or
`storage` — those are separate merges, and **each should be checked for this
same conflict before it starts** rather than assumed to be a clean repoint.

## Acceptance

Decided and built: **(a)**, scoped to the day side as described above.

- `POST /api/helper/[user]/day` and `POST /api/helper/[user]/assemble-day`
  refuse `incomplete_day` naming `time`/`transportMode`/`tags`/`visibility`
  when a create attempt is silent on any of them, the same shape they already
  used for `costs`/`coordinates`.
- Neither route's own proposal card pre-fills a default for those four —
  `test/helper-start-day-press.test.ts`'s `"a trip's own trip.json carries no
  track opt-out any more"` pins the card's field list unchanged
  (`trip, date, costs, coordinates`).
- A real value or an actual decline for the four new rows, supplied directly
  by the caller (never invented by the route), is what a write actually
  stores — `test/day-missing.test.ts`, `test/assemble-day-route.test.ts` and
  `test/helper-start-day-press.test.ts` cover both.
- Follow-up tickets, not this one: the trip side (`create_trip`/`edit_trip`
  never asking `TRIP_DECLINABLES`), and the day-side fields left out above
  (`location`/`country`/`countryCode`/`timezone` cascade, `translations`).
