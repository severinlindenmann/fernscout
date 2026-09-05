---
id: B116
title: A test day inside a real trip is unmarked in the day list and in MCP's readable summary
type: ISSUE
priority: medium
complexity: low
area: api, mcp, test-content
found: "2026-09-03"
started: "2026-09-03"
merged: "2026-09-03"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-05T07:38:39Z"
---

# B116 — A test day inside a real trip is unmarked in two places

## Why

Found while verifying B47 against the live instance. B47's own acceptance
passes in full — the flag is written, echoed, inherited by days from their
trip, and stated in the markdown twin above the prose. Two doors it did not
name still do not carry it, and they are both doors an agent looks through.

**The day list.** `GET /api/v1/<user>/trips/<trip>/days` returns
`slug`, `title`, `date`, `location`, `lat`, `lng`, `photos` — and no `test`.
For a wholly test-flagged trip this costs nothing, because the trips list
carries the flag and the trip is the thing that is fake. It matters for **one
invented day inside an otherwise real trip**, which is a case the software
allows and the day list is exactly where an agent would go looking for it.

**MCP's human-readable text.** `list_trips` puts `test: true` in
`structuredContent`, but its text rendering says:

```
b47-flagged — B47 flagged testreise (past, 2026-08-20 → 2026-08-22) · 2 entries, 0 drafts
```

`get_day` gets this right — it says *"**Test content — this day did not
happen.** It exists to check the software"* in the text block **and** sets the
field. `list_trips` says it in one channel only. An agent that reads the text
summary, which is the channel the format exists to be read through, sees a
trip that looks lived.

Why this is worth fixing rather than filing as a nicety: `AGENTS.md` makes
`test: true` the single exception to "write only what you were told", and the
guarantee it offers is that the next reader can always tell. B47 was raised
precisely because the flag "can be written but never read back". These are the
two remaining places where that sentence is still true, and the second one is a
summary an agent will trust because the format's whole purpose is to be read.

Neither is a data-loss bug: the flag is on disk and correct, and the rendered
pages carry the banner. This is about the readable surfaces disagreeing with
each other, which is how a convention quietly stops being one.

## Work

- Add `test` to each item in `GET /api/v1/<user>/trips/<trip>/days`, present
  only when true, matching how the trips list already does it. Inherited from
  the trip exactly as `GET .../days/<slug>` already resolves it — the two must
  not disagree about the same day.
- Say it in `list_trips`'s text rendering. Match `get_day`'s wording rather
  than inventing a second phrasing; one sentence about test content that
  appears in two forms is the thing that drifts.
- One test per surface, asserting the inherited case (flag on the trip, absent
  from the entry file), because that is the case that was silent in both.

Not doing: a `test: false` on unflagged items. Absent-means-real is the
existing convention and the trips list already follows it.

## What was built

The Why held up on re-reading: `entrySummary` (`lib/api/entries.ts:367`) built
the day list's items from the entry alone, and `list_trips` rendered its text
without consulting `t.test`. Two things about the fix are decisions rather than
transcription.

**The flag is resolved in `entrySummary`, and the trip is a required
argument.** Putting it in the route would have worked, but `entrySummary` has a
second caller — MCP's `get_day`, which was computing `isTestContent` a second
time beside it — and "the two must not disagree about the same day" is easier
to guarantee by construction than by two correct copies. Required rather than
optional so that a caller who has not answered the question does not compile:
an optional trip would have made the silent case — inheritance — the default
again. `get_day` now passes its trip and has dropped its own copy.

**One sentence, one place.** `testContentNotice("day" | "trip")` in
`lib/mcp/tools.ts` renders it; `get_day`'s string is unchanged byte for byte
and `list_trips` gets the same sentence with the noun swapped. It is appended
to the trip's own line rather than put on a line of its own, so the format
stays one line per trip.

Checked and left alone: `lib/api/documentation.ts` mentions `list_trips` only
as a row in the tool table ("every trip in the journal, including private
ones") and says nothing about either text rendering, and the OpenAPI document
gives `GET .../days` a bare `{ description: "Days" }` with no response schema.
Neither describes the shape this changes.

Found while here and **not** absorbed: `listDrafts` carries no flag either, so
`GET /api/v1/<user>/drafts` and MCP `list_drafts` — the list an agent reads
back to a person when asking what to publish — cannot say a draft is content
nobody lived. Same class, third surface, and the one read at the moment of the
decision. Captured as **B134**.

## Acceptance

- `GET /api/v1/<user>/trips/<trip>/days` marks a test day, including one that
  inherits the flag from its trip, and omits the field otherwise.
- MCP `list_trips`'s text output says a trip is test content, in the same words
  `get_day` uses.
- Tests cover the inherited case on both surfaces.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
