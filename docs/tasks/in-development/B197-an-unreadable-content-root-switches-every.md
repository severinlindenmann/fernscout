---
id: B197
title: An unreadable content root switches every journal's mail off instead of warning
type: ISSUE
priority: high
complexity: low
area: mail, capabilities, tests
found: "2026-09-03T19:58:00Z"
started: "2026-09-04T05:58:31Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T05:58:31Z"
---

# B197 — An unreadable content root switches every journal's mail off instead of warning

## Already fixed — do not build this

Captured from the B159 session at 19:58Z after `test/mail.test.ts > kept mail
expires > a sweep that cannot read the directory still sends the message`
failed on a branch based on `main`. The B60 session was diagnosing the same
failure at the same moment and merged the fix in **`2500704`** at 19:58:57Z,
about a minute later. Two sessions, one bug, one of them a minute slow.

Kept rather than deleted because an id has to mean one thing forever. There is
nothing to build here; close it.

## What the bug was, and what was done

B60's new per-journal gate called `isEnabled("mail", username)`, which resolves
the journal through `getUsernames()` (`lib/users.ts:112`), whose `readdirSync`
catches its own failure and returns an empty list. No journals meant no such
user, which meant the capability read as off — so a content root that could not
be read silently suppressed **every** journal's mail, with nothing in the log.
The same failure mode B60's own commit message rules out, one layer down.

`2500704` narrowed the gate rather than widening the test's mock: it now asks
`isEnabled("mail")` for whether the server can send, and a new
`hasSwitchedOff("mail", username)` for whether the journal said no — where a
stated `false` is a no, absence is not, and a journal that cannot be resolved
is not either. `resolveOne` was deliberately left alone, since changing it
would reach every capability.

## Verified

`npx vitest run test/mail.test.ts` — 32 passed, three consecutive runs. Full
suite on `main` at 22:04Z: 115 files, 1887 passed, 2 skipped.

The two failures the B159 session saw in one full run
(`a sweep that cannot read the directory…` and `a username that would escape
the content root is refused, not written`) do not reproduce. They were that
session's run observing `main` mid-merge while `2500704` was landing under it —
worth knowing as a hazard of running the suite in the main checkout while
another agent is merging into it, and not a flaky test.
