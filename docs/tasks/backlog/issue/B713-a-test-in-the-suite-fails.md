---
id: B713
title: A test in the suite fails intermittently and verify does not name which
type: ISSUE
priority: medium
complexity: medium
area: Test suite
found: "2026-09-07T11:19:22Z"
---

# B713 — A test in the suite fails intermittently and verify does not name which

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Observed 2026-09-07 on branch `b310-agents-md`, whose only change is a prose
edit to `AGENTS.md`. `npm run verify` reported:

```
Tests  1 failed | 4300 passed | 3 skipped (4304)
```

An immediate `npx vitest run` on the same tree passed — 334 files, 4301 tests —
and a second full `npm run verify` passed all four stages. So the failure is
intermittent, and nothing in the change could have caused it.

Two problems, and the second is the expensive one:

1. **Something in the suite is order- or timing-dependent.** One run in three
   here failed. On CI that is a red build on a branch that is fine, and the
   habit it teaches is re-running until green — which is how a real failure
   gets waved through.

2. **`verify` did not say which test failed.** Its tail shows the count and the
   "stopping here" banner, and the failing test's name had already scrolled
   past. That turned a one-minute diagnosis into three full suite runs, and it
   is why this ticket cannot name the culprit.

## Work

- Make `scripts/verify.mjs` surface the failing test names on a vitest failure
  — print the reporter's failure list, or re-emit the last N lines that carry
  `FAIL`. Fixing this first is what makes the rest cheap.
- Then find it: `npx vitest run --sequence.shuffle` a few times, or run with
  `--reporter=verbose` and diff a passing against a failing run. Suspect
  anything touching wall-clock time, a shared fixture directory, or a port.
- The 3 skipped tests are the Postgres-only ones and are not this.

## Acceptance

- A vitest failure under `npm run verify` names the failing file and test in
  the output the agent actually reads.
- The intermittent test is identified and either fixed or, if it is genuinely
  environmental, made to skip loudly with a reason.
- Ten consecutive `npx vitest run` invocations pass.
