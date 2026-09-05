---
id: B249
title: A test in the suite failed once in six runs and left no name behind
type: ISSUE
priority: low
complexity: medium
area: Test suite
found: "2026-09-04T09:23:12Z"
started: "2026-09-05T15:45:03Z"
session: e5747799-fd3e-4d40-a335-82fa4e24333e
claimed: "2026-09-05T15:45:03Z"
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

## 2026-09-05 — one named flake found and fixed, which may or may not be this one

While verifying B379/B380, `npx vitest run` reported `1 failed | 2781 passed`
and this time the name survived: `test/contacts.test.ts > postal addresses > a
tampered ciphertext does not decrypt to something plausible`. Five reruns of
that file passed, which is the same shape this ticket describes.

The cause is real and is now fixed in that test. It tampered with the
ciphertext by overwriting the last two base64url characters with `"AA"` — a
no-op on the runs where they already were `"AA"`, leaving the value
byte-identical, decrypting perfectly, and failing the assertion for the one
reason the test was never about. The IV is random per run, so it was a coin
flip: **measured at 9 in 20,000 runs (0.045%)** by re-encrypting that fixture
in a loop. It now flips a character to one the value demonstrably is not, and
asserts that the substitution actually changed something.

**This ticket stays open**, for two reasons. The rate does not match: 0.045%
is one run in roughly 2,200, and this ticket describes one in six, so the
original failure was very probably a different test. And the second problem it
names — that the failing run was piped through `tail -5`, which discarded the
reporter line naming the file — is untouched by any of this and is the half
that made the first one unfindable.

## 2026-09-05: the flake now has a name

Seen again while merging B449, and this time the failing test was recorded
rather than lost: `test/generator-output.test.ts > npm run postcard`. It failed
once inside a full `npm run verify`, passed 12/12 when run alone immediately
afterwards, and the re-run of the whole gate was clean.

It is a subprocess test with a **5-second timeout** that shells out to `npm run
postcard`, run concurrently with the rest of the suite. That is the shape of a
load-dependent timeout rather than a defect in the generator: the machine was
building and running 241 test files at the time, and the same command finishes
comfortably when it is the only thing running.

So the answer this ticket was waiting for is probably "the timeout is too tight
for a subprocess test under a loaded suite", not "something is wrong with the
postcard generator". The cheap fix is to raise that one timeout or take the
subprocess test out of the concurrent pool; the honest check is to run the
suite under load a few times and see whether anything else with a subprocess
and a short timeout joins it.
