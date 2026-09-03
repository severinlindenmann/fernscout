---
id: B116
title: A test day inside a real trip is unmarked in the day list and in MCP's readable summary
type: ISSUE
priority: medium
complexity: low
area: api, mcp, test-content
found: "2026-09-03"
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

## Acceptance

- `GET /api/v1/<user>/trips/<trip>/days` marks a test day, including one that
  inherits the flag from its trip, and omits the field otherwise.
- MCP `list_trips`'s text output says a trip is test content, in the same words
  `get_day` uses.
- Tests cover the inherited case on both surfaces.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
