---
id: B1106
title: The locale coverage test fails in a full run and passes on its own, so a green tree can be reported red
type: ISSUE
priority: low
complexity: low
area: tests
found: "2026-09-09T16:38:24Z"
merged: "2026-09-14T05:38:28Z"
completed: "2026-09-14T16:31:23Z"
---

# B1106 — The locale coverage test fails in a full run and passes on its own, so a green tree can be reported red

## Why

`test/locales.test.ts > every maintained locale covers every key English has`
failed once during `npm run verify` on the B1097 branch, on a tree that
touched no locale file — only `.claude/skills/` and `docs/tasks/`. Run on its
own (`npx vitest run test/locales.test.ts`) it passed, 29 of 29, and a second
full `npm run verify -- --quick` on the same tree passed all four steps.

That is the expensive shape of flake, not the harmless one: `verify` stops at
the first failure, so the agent that meets it is told the tree is not ready
and either stops or goes looking for a cause in its own diff. B1040 records
the same behaviour in `analytics-visitors`, which suggests a shared cause —
one test leaking state another reads — rather than two coincidences.

Suspect first: anything that writes into `site/locales/` or reruns
`i18n:keys` during a test, and the ordering that `--sequence.shuffle` gives
it.

## Work

Reproduce by running the suite repeatedly with the same seed reporting until
it fails, then find the test that leaves the file or the module cache
different from how it found it. Fix the leak rather than the assertion.

Look at B1040 at the same time; if the cause is shared, one of the two is a
duplicate.

## Acceptance

- The cause is named: which test leaves what behind.
- The suite run twenty times in a row does not produce this failure.


## Fixed 2026-09-14 — not a state leak, a slow test losing a race

The ticket's suspicion was reasonable and wrong. Nothing writes into
`site/locales/` during a test and no ordering matters here.

`dictionaryFor(code)` was called **inside the filter**, so the whole dictionary
was reloaded once per key, per locale — roughly 1,400 keys times three. The
test took **4.4 seconds on an idle machine**, which clears a 30s timeout
comfortably and does not clear it at all when something else is running. That
is the entire flake: `verify` stops at the first failure, so an agent meeting
it is told the tree is not ready and goes looking in its own diff.

Hoisting the load out of the filter takes it to **0.205s**, a 21x reduction. A
test that fast cannot lose that race whatever else the machine is doing.

Confirmed in the field the same day: six concurrent verifies took the load
average past 180, and this exact test took 51 seconds and failed. That was the
reported symptom, reproduced, with the cause now removed.

**B1040 is listed here as a likely shared cause and is not.** That one was a
`vi.spyOn(crypto, "randomBytes")` that never bound — the test passed whether
the code was right or wrong — and it was re-pointed under B1610.
