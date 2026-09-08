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

Not investigated further here — out of scope for B713, which only needed to
name and fix its one reported symptom. Whoever picks this up should:

- Re-run `--sequence.shuffle` a few times and diff the failure sets to find
  which are consistent vs. incidental.
- For each consistently-failing file, check for a hardcoded path/port/dir
  name shared with another file, or a module-level singleton
  (`vi.mock`/cache) not reset between files.
- Consider whether CI should run shuffled at all, or whether this is purely a
  local-development finding — vitest's default scheduling may already be
  what CI uses.

## Acceptance

`npx vitest run --sequence.shuffle`, run three times, passes clean every time
— or the specific shared-state causes are identified and each has its own
narrower ticket.
