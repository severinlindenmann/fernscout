---
id: B1629
title: B560's zero-spend day reads as unrecorded, overstating the costs average
type: ISSUE
priority: high
complexity: low
area: API v2
found: "2026-09-12T21:34:59Z"
merged: "2026-09-12T21:49:35Z"
---

# B1629 — B560's zero-spend day reads as unrecorded, overstating the costs average

## Why

B560 gave `costs` two distinct declines — `without: [costs]` ("there was no
money on this day", a real zero) and `unrecorded: [costs]` ("money was spent
and the figures are gone", no data point at all) — and `lib/costs.ts`'s
averaging depends on telling them apart: a real zero belongs in the
denominator and pulls the average down; a lost figure is excluded rather than
charged a fabricated zero.

`lib/costs.ts`'s per-day loop (`byDay`, around the `unrecorded:` field)
computed that flag as `day.entries.some((e) => e.unrecorded?.includes("costs"))`
— true whenever *any* entry that day carried the `unrecorded` marker, with no
regard for whether that same day also carried a real, non-zero recorded
figure (a day is `entries: Entry[]`, several updates in one day is normal).
Two updates on one day — one recording a real figure, one still carrying a
stale `unrecorded` marker from before the figure was found — was misread as
excluded from the average, understating `recordedDays` and overstating
`perDay`. `test/costs-projection.test.tsx`'s "real recorded spend outranks a
stale decline marker for the same day" test reproduced this against the
pre-fix code (`unrecordedDays` came back 1 instead of 0).

## Work

Fixed in `lib/costs.ts`: `unrecorded` on `byDay` is now
`amount === 0 && day.entries.some(...)` — a day with a real, non-zero total is
never `unrecorded`, regardless of a lingering decline marker. Added
`test/api-v2-documents.test.ts`'s round-trip test pinning `costs: []` (a real
zero) and an absent `costs` key (declined) as distinct bytes on disk — the one
real implementation risk, since `JSON.stringify`/`JSON.parse` keeping them
apart is what the whole distinction rests on once v2's on-disk day is JSON.
Added three tests to `test/costs-projection.test.tsx` (`describe("B1629 —
zero-spend vs figures-lost")`) covering: a genuine zero-spend day pulling the
average down, a figures-lost day excluded from it, and the multi-entry case
above.

**Not done here, and needed before the phase-3 replay migrates `content/example`:**
the replay must map v1's two decline spellings onto v2's one `declined`
mechanism as follows, so the mapping is not left to whoever writes the
migrator to reconstruct from scratch:

- `without: [costs]` (nothing was spent — a real zero) → **`costs: []`** on
  the v2 day. Not a decline at all: the day has an answer, and the answer is
  an empty list. `dayWrite` has no `.min(1)`, so this parses as *brought*.
- `unrecorded: [costs]` (money was spent, figures lost) → **`declined.costs`**
  with the standard migration sentence from `docs/v2-migration/00-decisions.md`:
  *"not recorded when this was written (migrated from v1)"*.

Getting this backwards — mapping `without` to a decline, or `unrecorded` to
`costs: []` — would silently flip which days pull the average down and which
are excluded, and `content/example`'s costs page would come out of the replay
with different numbers than it has today, with nothing in a schema or a type
to catch it.

## Acceptance

- `lib/costs.ts` branches a day's `unrecorded` flag on whether it carries a
  recorded figure, never on which decline (`without` vs `unrecorded`) is
  present — done, see `test/costs-projection.test.tsx`.
- `test/api-v2-documents.test.ts` asserts `costs: []` and an absent `costs`
  key (with `declined.costs`) round-trip as distinguishable bytes — done.
- The costs-average test asserts both branches (zero-spend pulls the average
  down; figures-lost is excluded) in one place — done,
  `test/costs-projection.test.tsx`.
- Whoever builds the phase-3 replay migrator maps `without: [costs]` →
  `costs: []` and `unrecorded: [costs]` → `declined.costs` with the standard
  migration sentence, per the Work section above — **still open**, this
  ticket only documents the mapping, it does not implement the migrator.
