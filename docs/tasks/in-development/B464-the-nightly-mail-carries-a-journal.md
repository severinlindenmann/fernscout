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

## What was built

`scripts/status.mts` (`npm run status`, and `--json`), piped into the mail by
`scripts/alert.sh` on the success path only. Sample from this laptop:

```
Fernscout — 1 journal, 5 trips, 32 days published

  1 of 1 journals listed
  2 days still in draft
  17 MB of content, 34.9 GB free of 460.4 GB on disk

  journal    trips    days   draft    size
  example        5      32       2   17 MB
            on the road: Across and back

  no database on this instance — contacts, guests and credits are not counted
```

Four decisions worth keeping:

- **`section()` wraps every block**, and a block that throws becomes a named
  line in the report rather than an exception out of it. The process cannot
  exit non-zero. A status report that could fail the mail would have made the
  alarm less reliable than it was before this task.
- **A journal whose `config.json` will not parse is named, not counted as
  empty.** Every reader below it would have answered zero, and "0 trips, 0
  days" reads as an empty journal rather than an unopenable one.
- **No database is a sentence, not a column of zeroes.** The prototype tier has
  none, and printing `0 guests` there is a claim — "nobody is reading this
  journal" — that happens to be false. The guests and credits columns are left
  out entirely instead.
- **The two mail bodies diverged, deliberately.** A failure keeps the journal
  tail *and* the `systemctl`/`journalctl` footer, because its reader is asking
  why. A success gets the report and the health link and neither command;
  pointing somebody at `journalctl` to confirm nothing is wrong is the
  log-reading this task removed.

## Evidence

- `test/status-script.test.ts` — counts against a real content folder on disk
  (2 journals, 3 trips, 3 published days, 2 drafts, one unlisted), the
  no-database sentence, a malformed journal named while the rest still report,
  and `--json` carrying the same numbers.
- `test/backup-script.test.ts` — alert.sh with a stubbed `systemctl` and a
  stubbed `npm`: the success body carries the status report, the failure body
  carries the journal and not the report.
- `test/alert-script.test.ts` — one assertion inverted, since a success mail
  now deliberately omits the two commands it used to carry.
- `npm run verify` — all four, green.
