---
id: B197
title: An unreadable content root switches every journal's mail off instead of warning
type: ISSUE
priority: high
complexity: low
area: mail, capabilities, tests
found: "2026-09-03T19:58:00Z"
started: "2026-09-04T05:58:31Z"
merged: "2026-09-04T06:14:50Z"
---

# B197 — An unreadable content root switches every journal's mail off instead of warning

## Half of it was already fixed. The other half is built here.

Captured from the B159 session at 19:58Z after `test/mail.test.ts > kept mail
expires > a sweep that cannot read the directory still sends the message`
failed on a branch based on `main`. The B60 session was diagnosing the same
failure at the same moment and merged **`2500704`** at 19:58:57Z, about a
minute later. Two sessions, one bug, one of them a minute slow.

That commit fixed the part that mattered most — the gate no longer reads
"cannot tell" as "the journal said no". This file previously said there was
nothing left and to close it. **That was wrong, and the title is what gives it
away**: "switches every journal's mail off *instead of warning*". The commit
removed the first clause and left the second. An unreadable content root was
still silent — no log line, and `/api/health` reporting `status: ok` with an
empty `journals` block, which is exactly what a healthy instance with no
journals looks like.

AGENTS.md asks for both halves: a disabled capability must be *absent* rather
than broken, and `/api/health` is where "why is this off" gets answered. So the
remaining work was to make the fault **sayable**, and it is done here.

## What the bug was

B60's new per-journal gate called `isEnabled("mail", username)`, which resolves
the journal through `getUsernames()` (`lib/users.ts`), whose `readdirSync`
catches its own failure and returns an empty list. No journals meant no such
user, which meant the capability read as off — so a content root that could not
be read silently suppressed **every** journal's mail, with nothing in the log.
The same failure mode B60's own commit message rules out, one layer down.

## What the gate fix did, and what was still missing

`2500704` narrowed the gate rather than widening the test's mock: `sendMail`
now asks `isEnabled("mail")` for whether the server can send, and a new
`hasSwitchedOff("mail", username)` for whether the journal said no — where a
stated `false` is a no, absence is not, and a journal that cannot be resolved
is not either. `resolveOne` was deliberately left alone, since changing it
would reach every capability. That is unchanged and still right.

What it did not do is give the fault a name. `getUsernames()`
(`lib/users.ts`) cannot throw — a directory listing that fails during a request
must not take every page down with it — so it catches and returns an empty
list. An empty list is indistinguishable from an instance nobody has created a
journal on, and everything downstream then draws the wrong conclusion politely:
`userExists` says no, `getUser` returns null, the site serves 404 for journals
sitting on disk intact, and `/api/health` says `ok`.

## Done

- `lib/users.ts` records the read failure in `rootProblem` and exposes it as
  `contentRootProblem()`. A warning is logged once per distinct fault rather
  than once per request — this is on the path of every page, and a line
  repeated a thousand times a minute is how the warnings that matter stop being
  read. `clearUserCache()` drops it too, so a test that mocked `readdirSync`
  into throwing cannot leave the next one reporting an unhealthy instance.
- `/api/health` reports `content: { ok: false, error }` and answers **503**,
  the same way a config that will not parse already did. The two are separate
  fields on purpose: the config file parsed and the directory around it did
  not, and conflating them sends the operator to the wrong file.
- The decision, written where somebody changing it will read it: a content root
  that cannot be read is **unhealthy**, not empty. It is not a reason to read
  it as "every journal switched something off" — that was this bug — and it is
  not a reason to keep quiet either.

## Verified

`npx vitest run test/mail.test.ts` — 32 passed, three consecutive runs. Full
suite on `main` at 22:04Z: 115 files, 1887 passed, 2 skipped.

The two failures the B159 session saw in one full run
(`a sweep that cannot read the directory…` and `a username that would escape
the content root is refused, not written`) do not reproduce. They were that
session's run observing `main` mid-merge while `2500704` was landing under it —
worth knowing as a hazard of running the suite in the main checkout while
another agent is merging into it, and not a flaky test.

### 2026-09-04, this branch

`npx vitest run test/mail-journal-switch.test.ts` — 26 passed. The three new
cases fail on the branch point and pass after:

- *a healthy instance says so about its content root*
- *a content root it cannot read is reported, not passed off as ok*
- *the fault is not remembered once the directory reads again*

The pre-existing *an unreadable content root does not silently suppress a
journal's mail* — the assertion `2500704` shipped — still passes beside them.
