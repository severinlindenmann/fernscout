---
id: B1631
title: "A section that already has a value can never be declined — T6 has no symmetric rule"
type: ISSUE
priority: high
complexity: medium
area: API v2
found: 2026-09-12T00:00:00Z
merged: "2026-09-13T01:43:47Z"
---

## Why

**T6 is only half a rule.** It says: a write supplying a section retracts that
section's stored decline. Its mirror was never built: *a write declining a
section removes that section's stored value.*

So a section that already has a value cannot be declined. `PATCH` with
`{declined: {translations: "only ever read in English"}}` onto a trip that
carries a `translations` block merges to a document holding **both**, and
`checkRequiredOrDeclined` refuses it — correctly, on its own terms:

> both provided and declined — remove one. A section cannot be there and
> consciously absent at once.

The caller cannot remove one. Omitting a key means "unchanged" under
merge-patch, and **sections have no clearing spelling**: D14 gave `null` to
exactly four plain scalars (`cover`, `accent`, `tagline`, `intro`) and
deliberately excluded sections, because `declined` is supposed to be their
mechanism. It is — but only in one direction.

This is the same shape as B1616 (a solo trip that could never gain a buddy, a
public trip that could never be closed) and the same shape as the half of
B1626 that D14 answered. Third time: **a stored answer that no patch can
retract.** It applies to every declinable section on a trip and on a day —
`rates`, `costs`, `plan`, `figures`, `translations`, `media`, `tags`,
`coordinates`, and the rest.

Found when `test/trip-details.test.ts`'s translations block was rewritten
against B1619's new completeness rule: `translations: {}` is now (rightly)
incomplete, and declining turned out to be no escape either.

## Work

Build T6's mirror in the shared write path (`lib/api/v2/write.ts`), beside
`retractDeclines`, so both doors inherit it:

**A patch that declines a section removes that section's stored value in the
same call.** Nothing else needs a new spelling; `declined` stays the one
mechanism for "this has none", and it starts working in both directions.

Check the interaction with D14 before building: a caller who sends *both*
`{accent: null}` and `{declined: {accent: …}}` is saying one thing twice and
must keep working (it does today — `checkPatchConflicts` stops reading `null`
as "brought"). The new rule must not make that a conflict again.

Not doing: giving sections a `null` spelling. That would be two ways to say
one thing, which is what D14 explicitly refused.

## Acceptance

- A trip with a `translations` block accepts `PATCH {declined: {translations:
  "…"}}`, and reads back with no `translations` and the decline recorded.
- The same for at least `rates`, `costs` and `figures`, and for a day's
  `media` and `coordinates`.
- T6's existing direction still works: supplying a section clears its decline.
- `{accent: null}` + `{declined: {accent: …}}` in one call still works (D14).
- `test/trip-details.test.ts`'s "an empty block is incomplete…" test has its
  second half flipped from asserting the refusal to asserting the decline
  succeeds.
