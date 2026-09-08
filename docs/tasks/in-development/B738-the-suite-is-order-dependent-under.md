---
id: B738
title: The suite is order-dependent under --sequence.shuffle, well beyond B713's single flake
type: ISSUE
priority: low
complexity: high
area: Test suite
found: "2026-09-07T12:32:19Z"
started: "2026-09-08T21:22:10Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T21:22:10Z"
---

# B738 — The suite is order-dependent under --sequence.shuffle, well beyond B713's single flake

## Why

While hunting B713's flake, `npx vitest run --sequence.shuffle` was run twice
against an otherwise-clean tree. It failed 7 tests the first time and 27 the
second, in entirely different files each run — `db-migrations`, `invite-links`,
`inbox-route`, `gps-import-route`, `sweep-b22-disclosure`, `home`,
`day-notify-route`, `owner-self-details`, `media-url-upload`,
`contact-notify-mail-failure`, `photo-visibility`, `backup-script`, and more.
None of these overlapped with B713's actual culprit
(`test/analytics-visitors.test.ts`, fixed there).

This is a real, much larger problem than B713's single flake: under vitest's
default (non-shuffled) file/worker scheduling the suite is stable — ten
consecutive plain `npx vitest run` invocations all passed clean after B713's
fix — but the moment file order is randomised, a substantial fraction of the
suite starts failing. That points at shared state some files assume a
particular run order keeps apart: a fixed content directory name, a port, a
module-level cache one file relies on another having already populated (or
not yet touched).

## Work

**Reproduction.** `npx vitest run --sequence.shuffle --sequence.seed=42`
against the clean tree failed 31 tests across 14 files:
`contact-notify-mail-failure`, `home`, `owner-self-details`, `backup-script`,
`sweep-b22-disclosure`, `viewer`, `photo-visibility`, `helper-ask`,
`gps-import-route`, `invite-links`, `edit-the-day`, `media-url-upload`,
`db-migrations`, `day-notify-route` — the same cluster B837 had already found
and correctly attributed here rather than to itself.

**Diagnosis.** B837's own finding was right that `process.env` and
Vite-module-graph singletons (like `lib/db`'s `getDatabase()` cache) cannot
leak between test *files* — `pool: forks` + `isolate: true` (both Vitest's
own defaults; `vitest.config.ts` sets neither explicitly) genuinely gives
each file its own process and a fresh module registry. But it stopped one
level short of the actual mechanism: **`sequence.shuffle` is not a
files-only flag.** Per Vitest's own `SequenceOptions` type
(`node_modules/vitest/dist/chunks/reporters.d.*.d.ts`), it is
`boolean | { files?: boolean; tests?: boolean }`, and the CLI shorthand
`--sequence.shuffle` sets the boolean form, which is "both". Confirmed by
reading `@vitest/runner`'s suite-running code
(`node_modules/@vitest/runner/dist/chunk-artifact.js`): each suite's
direct children (tests, and sibling `describe` blocks) are reshuffled if
`suite.shuffle` is true, and that flag is computed per-suite as
`this.shuffle ?? options.shuffle ?? currentSuite?.options?.shuffle ?? runner.config.sequence.shuffle`
— i.e. it defaults from the global flag but an explicit `{ shuffle: false }`
passed as a `describe(name, options, fn)` argument overrides it, and cascades
to that suite's own children unless they set their own.

So the actual shared "state" was never a leftover env var, a fixed port or a
singleton cache — it was **execution order itself**, inside single test
files written as narratives: a `beforeAll` builds one shared fixture (a temp
`dir`, a database `handle`, a signed-in session) and later tests in the same
`describe` — or, in several files, in *sibling* `describe` blocks sharing the
same file-level fixture — read state an earlier test left behind. That is a
completely ordinary and, until now, safe way to write a Vitest suite: Vitest
runs tests within a suite in declaration order by default, and a large
fraction of this codebase's tests are written that way (a code review
in `test/db-migrations.test.ts` literally: create the schema, then insert a
row, then a *later* test asserts a duplicate of that exact row is rejected).
`--sequence.shuffle` breaks every one of them, because it also reorders
tests *and sibling describes* within a file, not just which file runs first.

Two concrete examples, to make the mechanism unambiguous:
- `test/db-migrations.test.ts`: "round-trips a row in every table" inserts a
  `reactions` row `(owner, trip, day, v1)`; "enforces the unique indexes the
  repositories rely on" (originally later, so it could rely on that row
  already being there) asserts a *second* insert of the same tuple is
  rejected. Under shuffle, the second test can run first, so there's nothing
  to collide with — actually, in the other direction, the reversed order
  makes the round-trip test itself throw `UNIQUE constraint failed` inserting
  `r1`, because a *different* test's earlier duplicate-tuple insert (`row("ag-2", ...)`,
  from an unrelated fixture, but same table) had already landed.
- `test/sweep-b22-disclosure.test.ts` (three **sibling** describes, B232,
  B239, B233, sharing one file-level `dir`/trip fixture): B239's second test
  posts a reaction to `open-2026:the-first-day`; B232's "a public trip is
  unchanged for anybody at all" asserts that same trip's counts are still
  `{}`. Marking B232's own describe `{ shuffle: false }` didn't fix this on
  its own, because the three describes are also siblings whose *relative*
  order is decided by the file's own top-level suite — which cannot be
  overridden from inside one of its children.

**Fix.** For every file above (and several more found while re-running with
random seeds — final list: `contact-notify-mail-failure`, `home`,
`owner-self-details`, `backup-script`, `sweep-b22-disclosure`, `viewer`,
`photo-visibility`, `helper-ask`, `gps-import-route`, `invite-links`,
`edit-the-day`, `media-url-upload`, `db-migrations`, `day-notify-route`,
`inbox-route`, `costs-import-route`, `redeem-rate-limit`,
`journal-title-tagline`, `contacts-admin-invite`, `invite-preapproval`,
`invite-one-click`, `signup-credit-grant`, `storage-quota`):

- Where exactly one `describe` block's own tests were order-dependent, that
  block now takes `{ shuffle: false }` as its second argument
  (`describe(name, { shuffle: false }, fn)`), which Vitest itself honours
  regardless of the global `--sequence.shuffle` flag.
- Where multiple **sibling** top-level `describe` blocks in one file shared
  file-level fixture state (the more common shape), the whole remainder of
  the file — every top-level `describe` and `test` after the shared
  `beforeAll`/`beforeEach` setup — is now wrapped in one outer
  `describe("the whole file, kept in written order", { shuffle: false }, () => { ... })`,
  so the file has exactly one top-level child (immune to top-level
  reordering) and `shuffle: false` cascades down through every nested
  `describe` that doesn't set its own.
- `test/db-migrations.test.ts` used `describe.each(dialectCases())`, whose
  `.each`/`.for` implementation only forwards `options.timeout` to the suite
  it creates — silently dropping a `shuffle` key. Rewrote it as
  `for (const { name, target } of dialectCases()) { describe(\`schema on ${name}\`, { shuffle: false }, () => { ... }) }`,
  which calls the plain `describe(name, options, fn)` form (which *does*
  forward `shuffle`) once per dialect, with the same test names as before.
- Nothing was reordered, no seed was pinned, and no assertion was weakened —
  every fix makes an existing, already-true assumption (these tests run in
  the order they're written) an explicit, Vitest-enforced property of the
  file, instead of an implicit one that happened to hold under the default
  scheduler.

**What is deliberately not fixed here.** `test/analytics-visitors.test.ts`'s
"the code is not a reversible encoding of anything it was made from" failed
twice across roughly a dozen full-suite `--sequence.shuffle` runs during this
work, with the exact symptom its own B713/B988 comments already describe (a
pinned `crypto.randomBytes` mock not taking, so the assertion runs against
real randomness). This is **not** the fixture-order class of bug above: the
same seed that failed reproduced clean on a re-run, the file passed 15/15
standalone, and it passed 20/20 with even its *own* tests shuffled
standalone — so it isn't an in-file order problem, and B738's own fixes
don't touch it. It looks like it may cross a file boundary that `pool: forks`
+ `isolate: true` should make impossible (only `test/analytics-visitors.test.ts`
spies on `crypto.randomBytes` anywhere in the suite, so it isn't "another
file's leftover spy"), which needs its own investigation rather than a guess
folded into this ticket. Captured separately as **B1040**, with the
reproduction attempts recorded so the next session doesn't repeat them.

## Acceptance

- [x] Reproduced: `npx vitest run --sequence.shuffle --sequence.seed=42`
  failed 31 tests / 14 files before any change (log kept in the session;
  the failing list is in Why/Work above).
- [x] Root cause identified and explained: `--sequence.shuffle` reorders
  tests *and sibling describes within a file*, not just file order, breaking
  narrative-style test files that build shared fixture state across ordered
  tests — a legitimate, common pattern in this suite until now.
- [x] Fixed at the source: 22 files now mark their order-dependent scope
  `{ shuffle: false }`, either on the one affected `describe` or (where
  siblings shared state) the whole file. Nothing reordered, no seed pinned,
  no assertion weakened, no test deleted.
- [x] `npx vitest run --sequence.shuffle --sequence.seed=42` — clean,
  before-and-after pair confirmed (31 failures → 0).
- [x] `npx vitest run --sequence.shuffle --sequence.seed=1` — clean (this was
  B837's other reported seed).
- [x] `npx vitest run --sequence.shuffle` (random seed), run repeatedly —
  clean roughly 11 of 13 times; the 2 exceptions were both the *same*,
  already-known, separately-captured B1040 flake (`analytics-visitors`),
  never a recurrence of this ticket's cluster.
- [x] `npm run verify` — clean (build, tsc, eslint, 450/450 test files /
  5807 passing + 4 skipped, knip).
- [x] Whatever could not be proven fixed here is captured narrowly rather
  than left as a half-claim: **B1040**.
