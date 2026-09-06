---
id: B644
title: The helper ignores three things the published document now says
type: ISSUE
priority: high
complexity: low
area: fernscout-helper, content model, validate-content
found: "2026-09-06T18:25:15Z"
started: "2026-09-06T18:25:42Z"
merged: "2026-09-06T18:42:57Z"
---

# B644 — The helper ignores three things the published document now says

## Why

Found by testing the helper against the document B615/B616/B620 produce,
BEFORE deploying it — which is the check that was missing when B609 was merged
and had to be reverted.

The document gained three things. The helper reads none of them, so a change
that is correct on the server is inert or wrong on the client:

**1. `files[<file>].noTip` — a list of keys not to offer.** Introduced by B620
so the document can say what `model.mjs` says with `noTip: true`. The helper's
`shared/contentModel.mjs` contains no reference to it. Measured against the new
document: `test is not set` is still offered, twice, on a real journal — the
exact defect B620 exists to remove. `test:` means *content nobody lived*, and
the tips are read out to a person as choices available.

**2. `assert: "shape"` with a `members` map.** The document now carries one —
`features.*` must be `{ enabled: boolean }` — and it is the first `shape` rule
ever published. `grep members shared/contentModel.mjs` finds nothing, so the
rule is not applied. Note B616 also found and fixed a real bug in *fernscout's*
own interpreter here: it compared a wildcard member's value against
`rule.members` keyed by member name instead of checking each member's nested
fields. The helper's implementation should be read with that in mind rather
than trusted.

**3. Two new `named` checks** — `entry-date-is-a-real-calendar-date` and
`budget-total-and-days-are-positive`. These the helper handles **correctly**
already: it reports both by name, which is the mechanism working as designed —

    ! named check "entry-date-is-a-real-calendar-date" is declared but this
      client has not implemented it yet …

That is honest, and it is not the finished state: the helper's `validate.mjs`
already implements a calendar-date check of its own, so the work is to wire the
existing check to the declared id rather than to write a new one.

None of this breaks a journal — 0 errors, 0 warnings against the new document.
It is the client half of three tickets whose server half has merged.

## Work

- Read `files[<file>].noTip` and suppress those keys from the tip pass.
- Implement `shape`/`members` per the document's own semantics; check the
  helper's existing `shape` code for the same bug B616 fixed on the server.
- Map the two declared `named` ids onto the checks `validate.mjs` already
  performs, so they stop being reported as unimplemented. Leave the reporting
  mechanism intact — it is the thing that caught this.
- Then re-run the comparison this ticket came from: validating a real journal
  from the document and from `model.mjs` must give the same errors, warnings
  **and tips**. That is B620's acceptance line, unmet on the client until now.

Not doing: deleting `model.mjs` — B610, still blocked until this lands.

## Acceptance

- Against the new document, `test is not set` is offered by neither source.
- A `config.json` with `features: { postcards: true }` is an error from the
  document's `shape` rule alone, with `model.mjs` out of the picture.
- Neither named check is reported as unimplemented, and both actually fire on
  `luecken`.
- Validating `content/severin` from either source gives identical errors,
  warnings and tips.
- `selftest.mjs` passes against a live instance.
