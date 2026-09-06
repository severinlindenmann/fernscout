---
id: B616
title: The helper is silent about three things the instance refuses
type: ISSUE
priority: medium
complexity: low
area: fernscout-helper, validate-content, model.mjs
found: "2026-09-06T15:36:52Z"
---

# B616 — The helper is silent about three things the instance refuses

## Why

Found by the conformance test built in B608, and the mirror of B615. Three
places where `validate-content` says nothing and the instance refuses. Nobody
is misled into breaking good content — the cost is that a journal passes
locally and is refused on publish, which is the moment the tools exist to
prevent.

**Impossible dates.** The helper checks an entry's `date` for the shape
`YYYY-MM-DD` and stops. `checkDate`/`isRealCalendarDate` in
`lib/validate/entry.ts` also rejects `2026-13-40`. (`trip.md`'s `start`/`end`
are *not* affected — `DATE_RE` in `lib/tripWrite.ts` is exactly as shallow as
the helper, and the conformance test asserts that as agreement.)

**`features` member shape.** `parseFeatures` in `lib/config.ts` refuses a
member that is not `{ enabled: boolean }` and refuses an unknown capability
name. `model.mjs` says only `type: "object"`.

This one has history: B598 added exactly these checks to
`validate-content/validate.mjs` — but to the *validator*, not to `model.mjs`.
So the model this document was derived from never learned them, and the
published document inherited the gap. Worth reading as a small lesson about
where a rule belongs.

**`budget.total` / `budget.days`.** `validateCostsPut` refuses a non-positive
total or day count. No rule in the helper reaches inside `budget:` at all.

## Work

- Add the three rules where they belong. For `features`, reconcile with what
  B598 already put in `validate.mjs` rather than writing a second copy — one
  of the two has to become the source, and say which and why.
- `date`: a real calendar date, not just the shape. Reuse the server's own
  reasoning; do not re-derive leap years.
- Plant each in `luecken` and raise its floor.
- As with B615: if B609/B610 have landed, the fix belongs in
  `lib/contentModel/document.ts`. Say which source you edited.

## Acceptance

- `date: "2026-13-40"` on an entry is an error; `trip.md`'s `start`/`end`
  behaviour is unchanged.
- A `features` member that is not `{ enabled: boolean }`, and an unknown
  capability name, are errors — with no second implementation left behind.
- `budget: { total: 0 }` and `budget: { days: -1 }` are errors.
- `test/content-model.test.ts` asserts agreement for all three instead of
  disagreement.
- `selftest.mjs` passes; `npm run verify` green.
