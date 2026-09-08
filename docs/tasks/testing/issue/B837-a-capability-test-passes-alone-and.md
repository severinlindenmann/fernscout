---
id: B837
title: A capability test passes alone and fails in the full suite
type: ISSUE
priority: medium
complexity: low
area: tests
found: "2026-09-07T16:05:57Z"
started: "2026-09-08T19:14:17Z"
merged: "2026-09-08T19:55:09Z"
---

# B837 — A capability test passes alone and fails in the full suite

## Why

The ticket was captured as a bare title with no investigation recorded. This
session did the investigation.

`test/capabilities.test.ts` is the file every other capability test's `TOUCHED`
pattern is copied from: a list of env vars a test sets, cleared in both
`beforeEach` and `afterEach` so no test can see what an earlier one left
behind. The "photobook has no live switch, so a configured provider carries no
note" test (added by B435, commit `e8c935b0`) sets
`process.env.LULU_CLIENT_KEY` and `LULU_CLIENT_SECRET` directly — but neither
name was added to `TOUCHED`. That is a genuine leak: the file's own hygiene
contract (every env var a test touches is in `TOUCHED`) was broken the moment
those two lines were added, in exactly the shape this ticket describes — a
capability test setting global state (`process.env`) and not cleaning it up.

**What this session could not do is reproduce a live failure from it**, despite
substantial effort:

- `npm run verify` / plain `npx vitest run`, repeated, is clean.
- `npx vitest run --sequence.shuffle` with several fixed seeds (1, 42) does
  fail a real, order-dependent cluster of tests — but every failing file
  (`sweep-b22-disclosure`, `media-url-upload`, `owner-self-details`, `home`,
  `contact-notify-mail-failure`, `photo-visibility`, `gps-import-route`,
  `backup-script`, `invite-links`, `edit-the-day`, `db-migrations`,
  `day-notify-route`, plus `locales`/`helper-ask`/`task-ids`) is **already**
  B738's territory, not a capability test.
- Every capability-named test file (`capabilities`, `access-panel-capability`,
  `capability-owner-refusal`, `costs-capability`, `server-only-capabilities`,
  `auth-journal-switch`, `journal-features`), run together under 8+ different
  `--sequence.shuffle` seeds, and again mixed in with the entire known B738
  failure cluster under shuffle, passed clean every single time.
- Directly probing the mechanism the leak would need — one file setting
  `process.env.FOO`, a second file (or `--no-file-parallelism`, which is the
  closest local approximation to a CI run with `POSTGRES_TEST_URL` forcing
  serial scheduling) asserting `FOO` is unset — shows Vitest's actual
  configuration here (`pool: forks`, default `isolate: true`) gives every test
  *file* a genuinely separate process. `process.env` mutations from one file
  are provably invisible to the next, with or without `--no-file-parallelism`.
  So the specific mechanism this file was vulnerable to (an unlisted env var
  in `TOUCHED`) cannot currently cross a file boundary in this suite, which is
  presumably why it was never *observed* failing a second time.

## Work

- Added `LULU_CLIENT_KEY` and `LULU_CLIENT_SECRET` to `TOUCHED` in
  `test/capabilities.test.ts` so they're cleared in both `beforeEach` and
  `afterEach`, matching every other env var the file touches. This is the
  root-cause fix for the one concrete gap found: it closes the leak at its
  source (the test that sets the vars) rather than reordering anything.
- Did **not** touch B738 — that ticket already owns the broader
  order-dependent cluster this session's shuffle runs reproduced, and none of
  it is capability-related.
- Did **not** invent a synthetic capability test to force a reproduction; per
  AGENTS.md's rule against a plausible fiction standing in for what actually
  happened, "a test that would fail if X" is not evidence that X occurred.

## Acceptance

- [x] The one identified leak (`LULU_CLIENT_KEY`/`LULU_CLIENT_SECRET` absent
  from `TOUCHED`) is fixed. `git diff test/capabilities.test.ts` — two lines
  added to `TOUCHED`.
- [x] `npx vitest run test/capabilities.test.ts` — 25/25 passing, unchanged.
- [x] The capability test files, run together under `--sequence.shuffle` with
  seeds 2/3/7/8/9/10/11/12 — 15 files, 215 tests, clean every time (before and
  after the fix; the fix has no observable effect under this suite's process
  model, which is itself the finding).
- [x] The same files mixed with the full B738 failure cluster under
  `--sequence.shuffle --sequence.seed=42` — 22 files, capability tests among
  the 8 that passed; the 14 failures are entirely B738's existing files.
- [ ] **Not met, and said plainly rather than papered over:** a reproducible
  before/after pair for a live cross-file failure. None was found. If this
  ticket is reopened, the next step is not another shuffle run (several were
  tried) but instrumenting an actual CI run with `POSTGRES_TEST_URL` set,
  since that is the one configuration this session could not reproduce
  locally and the one place `fileParallelism` actually goes `false`.
