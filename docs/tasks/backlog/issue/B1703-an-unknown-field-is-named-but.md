---
id: B1703
title: An unknown field is named but not suggested, so a near-miss like transport_mode gets no did-you-mean
type: ISSUE
priority: low
complexity: low
area: api
found: "2026-09-14T09:10:00Z"
---

# B1703 — An unknown field is named but not suggested

## Why

B535 built `lib/validate/body.ts` for one failure: a write route reads the keys
it knows and ignores the rest, so a body carrying `transport_mode` where
`transportMode` was meant is accepted, answered `201`, and the field is gone —
the caller told it worked. Its answer was to check the body against the
published schema *and* to suggest the near miss (`suggestField`).

v2 keeps the first half by construction and dropped the second. Every v2 schema
is a `z.strictObject`, so an unknown key is refused rather than swallowed, and
`problemsFrom` (`lib/api/v2/incomplete.ts`) reports every issue in one round
trip with the field named — `Unrecognized key: "transport_mode"`. Nothing says
*did you mean `transportMode`*.

B1677 deleted `lib/validate/body.ts` and its test, which is what surfaced this:
the module was imported by nothing but its own test, so its protection had
already been replaced — except for the suggestion, which was not.

**This is a nicety, not a correctness hole, and the priority says so.** The
caller is refused and told which key was wrong; they are not told the right
one. The cost is a round trip for a human-written near miss, which is exactly
the case B535 was written about.

## Work

If it is worth building: a Levenshtein-1 (or similar) comparison of the
unrecognised key against the schema's own `shape` keys, appended to the problem
row's `problem` sentence. Zod carries the offending key in the issue, and the
schema's shape is already in hand at the `splitIssues` call site.

Not doing: reinstating `lib/validate/body.ts`. It ran a hand-maintained
OpenAPI schema that no longer exists, and the v2 schemas do the checking.

## Acceptance

`POST /api/v2/{user}/trips/{trip}/days` with `transport_mode` names
`transportMode` in the refusal, and a key that resembles nothing offers no
suggestion rather than a bad one.
