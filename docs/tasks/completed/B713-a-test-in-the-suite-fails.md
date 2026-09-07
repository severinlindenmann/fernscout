---
id: B713
title: A test in the suite fails intermittently and verify does not name which
type: ISSUE
priority: medium
complexity: medium
area: Test suite
found: "2026-09-07T11:19:22Z"
started: "2026-09-07T11:40:41Z"
merged: "2026-09-07T12:37:27Z"
completed: "2026-09-07T13:14:16Z"
---

# B713 — A test in the suite fails intermittently and verify does not name which

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

## Found and fixed

**(a) `scripts/verify.mjs` now names the failure.** It ran each step through
`spawn` with piped (not just inherited) stdout/stderr, echoing live exactly as
before while also keeping every line. On a `tests` step failure it filters the
captured output for lines matching `FAIL|✗|✕` and reprints them right above
the "stopping here" banner — the section a `tail` actually reaches without
scrolling back through the whole run. Verified by deliberately breaking a test
and running `node scripts/verify.mjs --quick`: the reprinted block named
`test/__tmp-verify-check.test.ts > intentional failure for B713 smoke check`
exactly.

**(b) The flaky test, found and fixed.** `test/analytics-visitors.test.ts` >
"the code is not a reversible encoding of anything it was made from"
(`test/analytics-visitors.test.ts:68`). `visitorHash()`
(`lib/analytics/visitor.ts:83`) is salted with a genuine
`crypto.randomBytes(32)` draw (`dailySalt`, by design — the salt must be
unguessable), and the test asserted `expect(hash).not.toContain("203")` — a
16-hex-character digest built from real randomness contains any given
3-character hex substring roughly 0.34% of the time (14 possible offsets ×
(1/16)³). Reproduced directly: `npx vitest run` failed on run 3 of 3 attempts
with `AssertionError: expected '9352c49f0ea2036e' not to contain '203'` —
proof the assertion was checking luck, not behaviour.

Fix: pin the daily salt for that one assertion via
`vi.spyOn(crypto, "randomBytes").mockReturnValueOnce(...)` so the hash is
deterministic (computed offline first to confirm it doesn't happen to contain
`"203"` or `"alice"` either), restoring the mock immediately after. Every
other test in that file is unaffected — they compare hashes to each other or
assert the regex shape, neither of which depends on a specific value. Ran
`test/analytics-visitors.test.ts` alone 5 times after the fix: 16/16 passing
every time.

**Ten consecutive full `npx vitest run` invocations, actually run: 10/10
passed** (341–342 files depending on whether a given run included files added
for B391/B541 in this same session; test/tests counts were stable at
4364/4371 respectively across repeats). No other flake surfaced across the ten
runs, nor across the earlier `--sequence.shuffle` exploration (which does
surface a different, much larger set of order-dependent failures — noted
below, not chased further, since it wasn't the reported symptom).

**What was tried on the shuffle front, for the record:** `npx vitest run
--sequence.shuffle` was run twice and failed 7 and then 27 different tests
each time, in files sharing content directories / ports / global state
(`db-migrations`, `invite-links`, `inbox-route`, `gps-import-route`, etc.) —
a real but much bigger problem than this ticket's reported symptom (a single
test failing 1 run in 3), and none of the shuffle failures were
`analytics-visitors`. Filed separately as B738 rather than folded in here,
since it is a different-shaped problem (order-dependence across many files)
from this ticket's actual reported symptom (one test, genuinely random by
design, failing on its own regardless of order).
