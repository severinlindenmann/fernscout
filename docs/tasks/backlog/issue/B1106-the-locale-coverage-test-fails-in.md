---
id: B1106
title: The locale coverage test fails in a full run and passes on its own, so a green tree can be reported red
type: ISSUE
priority: low
complexity: low
area: tests
found: "2026-09-09T16:38:24Z"
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
