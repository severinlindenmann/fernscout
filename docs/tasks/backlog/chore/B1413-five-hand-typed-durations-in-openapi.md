---
id: B1413
title: Five hand-typed durations in openapi.ts have no exported minutes constant to import
type: CHORE
priority: low
complexity: low
area: docs
found: "2026-09-11T04:48:45Z"
---

# B1413 — Five hand-typed durations in openapi.ts have no exported minutes constant to import

## Why

B1130 fixed one hand-typed duration in `lib/api/openapi.ts` (the sign-in
code's "ten minutes" vs. the real `CODE_TTL_MINUTES`, thirty) by importing
the constant that already exists for it. Auditing every other duration in
that file for the same ticket found five more — all **currently correct**,
so none is a bug today, but each is typed out by hand with nothing to import
against, which is exactly how B1130 happened in the first place:

- the signup link, 20 minutes
- the invite link, 15 minutes
- contact-confirm, 5 minutes
- GPS thinning (one fix per 5 min or 250 m)
- the handover credential, 20 minutes — stated twice

Four of the five have no exported `_MINUTES` (or equivalent) constant
anywhere for `openapi.ts` to import, unlike `CODE_TTL_MINUTES`.

## Work

For each of the four/five durations above: find (or add) the constant that
actually enforces the duration in the relevant `lib/` module, export it if it
is not already, and have `openapi.ts` (and `documentation.ts`, where it also
states the number) import and interpolate it rather than typing the number
out a second time. Low complexity per duration; bundle them into one ticket
since each fix is a one- or two-line diff in the same file.

## Acceptance

None of the five durations appear in `lib/api/openapi.ts` or
`lib/api/documentation.ts` as a bare number — each is interpolated from an
exported constant, and `npm run verify` still passes.
