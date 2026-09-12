---
id: B1040
title: analytics-visitors' pinned-salt test still fails intermittently under --sequence.shuffle, unlike standalone runs
type: ISSUE
priority: low
complexity: medium
area: Test suite
found: "2026-09-08T22:24:07Z"
---

# B1040 — analytics-visitors' pinned-salt test still fails intermittently under --sequence.shuffle, unlike standalone runs

## Why

Found while working B738 (the suite's order-dependence under
`--sequence.shuffle`). `test/analytics-visitors.test.ts:69` — "the code is
not a reversible encoding of anything it was made from" — pins
`crypto.randomBytes` with `vi.spyOn(...).mockImplementationOnce(...)` right
after `forgetSalt()`, specifically so `dailySalt()` in
`lib/analytics/visitor.ts:67` draws the mocked, fixed salt rather than a real
one (B713, then B988 hardened it against a preceding test in the same file
having already drawn day1's real salt).

Under `npx vitest run --sequence.shuffle` (no fixed seed) this test failed
twice in roughly nine full-suite runs during B738's work, both times with the
same symptom described in the code's own comment: the mock apparently did not
take, and the assertion ran against real randomness instead. But:

- Standalone, `npx vitest run test/analytics-visitors.test.ts` 15/15 clean.
- Standalone with the file's own tests shuffled too,
  `npx vitest run test/analytics-visitors.test.ts --sequence.shuffle`,
  20/20 clean across 20 different seeds.
- The *same* full-suite seed that failed on one run (`1788905269439`) passed
  clean on a re-run — so it is not a deterministic function of that seed
  either.

That rules out an in-file test-order cause (B738's actual territory, and the
rest of its cluster was exactly that — fixed by wrapping the affected
describes in `{ shuffle: false }`). It only reproduces as part of a large,
shuffled, multi-file run, which points at something that crosses a *file*
boundary despite `pool: forks` + `isolate: true` — that combination resets
each file's own Vite-managed module graph (which is why `lib/db`'s
`globalCache`-style singletons and `process.env` mutations can't leak between
files, per B837), but **`node:crypto` is a native Node builtin, not part of
that graph** — worth checking whether it (or the mock/spy registry
`vi.spyOn` attaches to it) survives across files scheduled onto the same
forked worker process, and whether shuffling file order changes which files
land on the same worker.

Grepping the suite, `test/analytics-visitors.test.ts` is the *only* file that
spies on `crypto.randomBytes`, so this isn't "another file's leftover spy is
interfering" in any way visible from a text search — the cause, if it is
cross-file, is subtler than that.

## Work

Not investigated further here — B738 stayed within its own, already-proven
cluster and captured this as a narrower, separate finding rather than
guessing at a fix. Whoever picks this up should:

- Try to get a *reliable* full-suite reproduction (a fixed seed that fails
  more than once) before changing anything — right now neither the seed nor
  the file's own order is enough on its own, which suggests worker-process
  scheduling (which files a given forked worker handles, and in what order)
  is part of the trigger, and that isn't controlled by `--sequence.seed`.
- If a repro is found, check whether `node:crypto`'s own state (or Vitest's
  spy bookkeeping) actually persists across files handled by the same forked
  worker, and if so, whether `test/analytics-visitors.test.ts` needs to stop
  relying on `vi.spyOn(crypto, "randomBytes")` at all — e.g. take a
  dependency-injectable salt source in `lib/analytics/visitor.ts` instead of
  spying on a Node builtin.
- This is **not** B738's fixture-sharing/narrative-order class of bug — that
  cluster (`sweep-b22-disclosure`, `home`, `invite-links`, `db-migrations`,
  and a dozen more) was fixed by making each order-dependent describe block
  (or, where sibling describes at one file's top level shared state, the
  whole file) `{ shuffle: false }`. This ticket is about something that
  reaches across a file boundary that ought to be airtight.

## Acceptance

- A reproduction more reliable than "sometimes, in a large shuffled run" — a
  seed, a worker count, or a file subset that fails more than once.
- Or, if the cross-file leak is confirmed structurally (e.g. by instrumenting
  which worker handles which file), `lib/analytics/visitor.ts` no longer
  depends on spying a Node builtin to be tested deterministically, and
  `test/analytics-visitors.test.ts`'s pinned-salt test passes every time
  under `--sequence.shuffle`, run at least 20 times.

## Related

Probably the same root cause as B1106 — a test that passes standalone and
fails only inside a large shuffled full run, on a tree that touched nothing
related. Investigate the two together rather than separately; a state leak
between forked workers would explain both, and finding it twice is waste.
