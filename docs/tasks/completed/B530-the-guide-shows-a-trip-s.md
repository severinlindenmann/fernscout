---
id: B530
title: The guide shows a trip's minimum and calls it an example, so nothing tells an agent what a trip can carry
type: DOCS
priority: high
complexity: low
area: agent.md
found: "2026-09-06T00:00:00Z"
started: "2026-09-06T07:43:06Z"
merged: "2026-09-06T07:50:48Z"
completed: "2026-09-07T13:11:42Z"
---

# B530 — The guide shows a trip's minimum and calls it an example, so nothing tells an agent what a trip can carry

## Why

B335 found this for a **day** and fixed it there: the published example was
`title`, `date`, `content` — the minimum a day is *refused* for lacking — and
an agent that copied it wrote a day with no place on the map, no money and no
leg on the story pager, each one a second call to fix later. The answer was
`PERFECT_DAY_EXAMPLE` and `PERFECT_DAY_INTRO` (`lib/api/agentCopy.ts:221`):
one day with every field filled in, and a sentence saying it is the shape to
aim at rather than the minimum.

**The trip never got the same treatment.** Both documents still show

```json
{"id": "japan-2027", "title": "Japan", "start": "2027-04-01", "end": "2027-05-15"}
```

(`lib/api/documentation.ts:252` and `:1053`), which is exactly the four fields
`createTrip` refuses a trip for lacking. `NewTrip` (`lib/tripWrite.ts`) accepts
fourteen: `tagline`, `status`, `accent`, `visibility`, `listed`,
`costsVisibility`, `intro`, `people`, `travellers`, `rates`, `translations`
and `test` are all invisible at the moment an agent is writing the call. Some
are discussed in prose paragraphs further down the guide; none is in the shape
the agent is copying, and the one place the fields are enumerated together —
`openapi.json` — is a different document that an agent reading the guide has
no reason to fetch.

What it costs is the same thing B335 cost: a trip created without its tagline,
its intro, its accent or its money settings, each one either a later call or —
for `translations` — a field with no door at all (B524 opened two of the
three).

## Work

- `PERFECT_TRIP_EXAMPLE` and `PERFECT_TRIP_INTRO` in `lib/api/agentCopy.ts`,
  mirroring the day pair exactly: one trip with every field a caller may send,
  rendered by both documents so the two cannot drift.
- A short **required / optional** list under it, generated beside the example
  so a field added to one is added to the other. Required is `id`, `title`,
  `start`, `end`; everything else is a question.
- The intro says what the day's already says, and it is the sentence that
  matters most here: **this is a form to fill in from what the person told
  you, and the way to fill it is to ask.** Not a set of plausible values to
  copy. An empty field still beats an invented one — asking is the third
  option that makes both true, and the day's intro already words it that way.
- Two fields must not be copied blindly and the intro says so by name:
  `test` (content nobody lived — only when that is what was asked for) and
  `status: "current"` (only for the trip the bare `/<user>` URLs should
  serve).
- `cover` is deliberately absent from the create call — say so, since an agent
  reading a complete-looking example will otherwise look for it.

Not doing: a second copy in `openapi.json`, which already carries the schema;
this is about the guide an agent actually reads first.

## Acceptance

- `/agent.md` and `/documentation.txt` both show a trip example carrying every
  field `NewTrip` accepts, and both say which four are required.
- A test asserts every key of the example is a field `createTrip` accepts, and
  that every optional field of `NewTrip` appears in the example — so the two
  cannot drift the way the day's example did.
- `npm run verify` green.
