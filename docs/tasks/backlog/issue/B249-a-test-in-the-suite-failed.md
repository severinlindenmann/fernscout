---
id: B249
title: A test in the suite failed once in six runs and left no name behind
type: ISSUE
priority: low
complexity: medium
area: Test suite
found: "2026-09-04T09:23:12Z"
---

# B249 — A test in the suite failed once in six runs and left no name behind

## Why

On 2026-09-04, verifying a markdown-only change on the `lsp-note` branch,
`npx vitest run` reported `1 failed | 2233 passed`. Five further runs of the
same suite on the same tree — one immediately after, then three in a row —
all reported `2234 passed`. The change under test touched `AGENTS.md` and
nothing else, so the suite was failing on itself.

The name was not captured. The failing run was piped through `tail -5`, which
kept the summary and discarded the reporter's line naming the file, and the
run could not be reproduced afterwards to recover it. That is the second
problem here and the more annoying one.

One circumstance distinguishes the failing run from the five clean ones: it was
chained onto `npm run build` in a single shell invocation, so vitest started
while the machine was still busy. That points at something timing-sensitive —
`test/contacts-request-timing.test.ts` measures elapsed time by name, and
several suites are dated — but pointing is not knowing.

What it costs: `npx vitest run` is the gate every task passes through before it
merges, and CI runs it on both dialects. A suite that fails one run in six
teaches the next agent that a red run means "run it again", which is the
posture that lets a real regression through.

## Work

- Reproduce it. `npx vitest run --reporter=verbose` in a loop with the output
  kept per run, under load if that is what it takes, until a red run names the
  file. Nothing else can start before this does.
- Then decide whether the test is wrong or the code is. A wall-clock assertion
  that fails under CPU contention is a test bug; anything order-dependent
  between suites is not.
- While reproducing, note that `vitest run` prints failures before the summary:
  a `tail` narrow enough to lose the name is how this got captured without one.
  Worth a line in `work-on-a-task` if the habit is general.
- Not doing: retries. `vitest --retry` would make this invisible rather than
  fixed, and an invisible flake in the gate is worse than a visible one.

## Acceptance

- The failing test is named, with a captured red run as evidence.
- Its cause is stated: timing, ordering, shared state, or a real defect.
- After the fix, twenty consecutive `npx vitest run` — at least some under
  concurrent load — are green.
