---
id: B472
title: The outcome mail opens with the same sentence twice
type: ISSUE
priority: low
complexity: low
area: backups
found: "2026-09-05T13:26:25Z"
started: "2026-09-05T13:26:41Z"
session: 7c3dd4ae-2d91-4172-8ea8-52deb35f9f42
claimed: "2026-09-05T13:26:41Z"
---

# B472 — The outcome mail opens with the same sentence twice

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

The mail delivered from fernscout.ch on 2026-09-05 opens:

```
fernscout-backup.service finished cleanly on this host at 2026-09-05T13:25:27.912Z.

fernscout-backup.service finished cleanly

Fernscout — 10 journals, 17 trips, 58 days published
```

Two writers, each correct on its own. `scripts/alert.mts` composes the first
line from the unit, the host and the time. `scripts/alert.sh` builds
`BODY="$SUMMARY\n\n$DETAIL"` and pipes it in, so its own `$SUMMARY` lands
underneath as a second, shorter version of the same sentence.

It predates B458 and was invisible while the body was a journal tail — the
summary read as a heading over the log. B464 made the body a formatted report,
and now it reads as a stutter at the top of the one mail an operator sees every
morning.

`$SUMMARY` is not simply redundant: on a failure it carries `(result=exit-code)
(exit 1)`, which the mailer's own line does not have. On a success it carries
nothing the first line has not already said.

## Work

Have `scripts/alert.sh` prepend `$SUMMARY` only when it adds something —
which is the failure path, where the result and exit status live. Not by
string-comparing the two sentences: they are composed in different files, in
different languages, and a comparison would silently start passing both through
the day either is reworded.

## Acceptance

A success mail opens with one sentence and then the report. A failure mail
still shows `result=` and the exit status above the journal tail.
