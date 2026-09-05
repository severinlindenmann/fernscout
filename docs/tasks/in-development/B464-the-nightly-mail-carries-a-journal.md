---
id: B464
title: The nightly mail carries a journal tail nobody reads, when what an operator wants is the state of the instance
type: FEATURE
priority: medium
complexity: medium
area: ops
found: "2026-09-05T13:06:52Z"
started: "2026-09-05T13:07:10Z"
session: 7c3dd4ae-2d91-4172-8ea8-52deb35f9f42
claimed: "2026-09-05T13:07:10Z"
---

# B464 — The nightly mail carries a journal tail nobody reads, when what an operator wants is the state of the instance

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

B458 made the backup mail its success as well as its failure, and the body it
sends is the last 25 lines of `journalctl` — right for a failure, useless for a
success. Asked for directly: *"less log files we dont care, more like a status
update that you see on view what happens on the service, users, guests, trips,
days etc."*

The operator's question, once a night, is **what is on this instance and is it
running out of anything** — not what restic printed. Everything needed is
already in the codebase and nothing aggregates it: `getUsernames`, `getTrips`,
`getDays`, `listContacts`, `contactsWithReadGrant`, `balanceOf`. `/api/health`
answers liveness, not inventory, and `/documentation.txt` is written for an
agent rather than an operator.

## Work

`scripts/status.mts`, printing a plain-text digest, run as `npm run status`.
`scripts/alert.sh` pipes it as the mail body **on success only** — a failure
still carries the journal tail, because that is the moment the log is the
answer.

What it reports, instance totals and then a line per journal: journals (and how
many are listed), trips by visibility, days published and in draft, contacts
and how many hold a live read grant, credits where they are switched on, bytes
on disk per journal, and the free space on the filesystem the content sits on.

Two constraints that decide the shape:

- **It must not be able to fail the backup.** The mail is a report about a run
  that already finished; a status block that throws must degrade to a line
  saying so, never to a non-zero exit or a missing mail. Every section is
  independently guarded.
- **No new source of truth.** Counts come from the existing readers, so a
  number in the mail is the number the site would render. Disk is walked
  rather than tracked, for the reason `lib/api/media.ts` already gives: a
  counter drifts the first time somebody deletes a file by hand.

Not doing: history or trend ("3 more days than yesterday"), a web page, or
per-trip detail. One screen, one night, no state to keep.

## Acceptance

`npm run status` prints the digest on a laptop with no database and no credits,
naming what is off rather than crashing. A successful backup on the VPS mails a
body whose first line is the instance summary and which contains no journal
tail; a failed one still carries the tail.
