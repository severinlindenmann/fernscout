---
id: B988
title: The visitor-hash test pins a salt that has already been drawn, so it fails about one run in three hundred
type: ISSUE
priority: low
complexity: low
superseded: "Fixed in the B982 merge, in the same tree that hit it twice — the one line the Work section asks for."
area: Tests
found: "2026-09-08T16:33:00Z"
---

# B988 — The visitor-hash test pins a salt that has already been drawn, so it fails about one run in three hundred

## Why

`test/analytics-visitors.test.ts`, "the code is not a reversible encoding of
anything it was made from", mocks `crypto.randomBytes` with
`mockImplementationOnce` and then calls `visitorHash(…, day1)`. B713's own
comment explains exactly why: an unpinned hash makes `not.toContain("203")` a
coin flip that comes up about one run in three hundred.

The pin does not take. `dailySalt` in `lib/analytics/visitor.ts:70` draws once
and memoises per day, and the test above this one has already drawn day1's
salt. So `randomBytes` is never called inside the mocked window, the mock
expires unused, and the assertion runs against the same random salt B713 was
trying to remove.

Seen twice while merging B982, both times only in a full `npm run verify` —
which is exactly the shape that reads as "the branch broke something" and costs
somebody a stashed diff and two suite runs to disprove.

## Work

`forgetSalt()` before the mock, so the next `visitorHash` actually draws.

## Acceptance

- The test fails deterministically if `visitorHash` is changed to return its
  input, and passes on every run otherwise.
