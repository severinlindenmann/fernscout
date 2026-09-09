---
id: B1084
title: Nothing refreshes the ECB rates on a deployed instance, so a costs page converts at whatever rate the last deploy happened to carry
type: ISSUE
priority: medium
complexity: low
area: currency, ops
found: "2026-09-09T15:47:48Z"
started: "2026-09-09T15:48:41Z"
session: f88144a1-6520-4fc1-94bd-496a694b98c8
claimed: "2026-09-09T15:48:41Z"
---

# B1084 — Nothing refreshes the ECB rates on a deployed instance, so a costs page converts at whatever rate the last deploy happened to carry

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Found while driving fernscout.ch from outside for B110. The figures a costs
page shows are *correct* — four cost lines were recomputed by hand against the
reference table and matched to full float precision — but the table they are
computed from only moves when a person happens to run a command.

`npm run rates:update` says so itself: *"This is a refresh script, never a
build step ... Run this occasionally, commit the result."* The only scheduled
unit on the server is `deploy/fernscout-backup.timer`. There is no rates timer,
no cron entry, and `scripts/deploy.sh` does not run it — it only ships whatever
a human already committed.

On 2026-09-09 the live instance was serving `"date": "2026-08-28"` — twelve
days old, and ageing for as long as nobody deploys.

A stale rate is the failure mode this project cares most about, because **it
looks exactly like a working one**: a converted figure appears, it is
plausible, and nothing about it says it was computed from a fortnight-old
table. The page does disclose the date in `currency.approxNote`, so it is
visible to a reader who looks, which is why this is an ISSUE and not a
SECURITY ticket.

## Work

**Do not write `site/rates/ecb.json` on the server.** `scripts/update-rates.mjs`
writes `path.join(ROOT, "site", "rates", "ecb.json")`, which is a tracked file
in the checkout — refreshing it in place would leave `/srv/fernscout` dirty and
`git pull` in `scripts/deploy.sh` would fail on the next deploy. That is the
trap in this ticket and the reason it is not a one-line cron entry.

`lib/rates.ts:ecbCachePath()` already prefers `<CONTENT_DIR>/rates/ecb.json`
over the shipped copy and falls back to it. So the refresh belongs there:
give the script an output override (an env var, defaulting to today's path so
nothing local changes) and have the scheduled run write into `CONTENT_DIR`,
where it is instance state rather than checkout state — and where it is already
inside the backup.

Hang it off the nightly backup run rather than adding a second timer: the
machinery for "a thing that happens each night, and says so when it fails"
already exists and has been debugged twice (B64, B138). A rates fetch that
fails must **not** fail the backup — the backup is the important half.

Leave the shipped `site/rates/ecb.json` as the committed fallback for a fresh
clone with no network.

## Acceptance

- A deployed instance's rates advance without anybody deploying.
- `/srv/fernscout` is still clean after a scheduled run, and `git pull`
  succeeds on the next deploy.
- A failed rates fetch leaves the previous table in place and does not fail the
  backup.

