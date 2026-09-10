---
id: B1203
title: Every entry in the operator's attention band is unanswerable: it can be read but not acknowledged, so a thing you have decided to live with is on the list for ever
type: FEATURE
priority: medium
complexity: medium
area: app/admin, lib/adminConsole.ts, lib/db
found: "2026-09-10T04:06:11Z"
started: "2026-09-10T04:06:39Z"
merged: "2026-09-10T04:34:50Z"
---

# B1203 — Every entry in the operator's attention band is unanswerable: it can be read but not acknowledged, so a thing you have decided to live with is on the list for ever

## Why

B1181 put every kind of waiting into one band above the tabs and made it the
only red on the page. That works while the list is short and fails the first
time something on it is a decision rather than a job.

The off-site copy on this instance has been stale for nine days because the
secondary destination is not configured, which is a deliberate state. There is
no way to say so. It sits in the band, red, above the money, on every load —
and the cost of an alarm you cannot answer is that you stop reading the band,
which is the whole thing the band was for. B1085 is the same lesson from the
other side: the nightly success mail was stopped because a message nobody acts
on trains somebody not to act.

The second half is what makes the first half safe. "Never show me this again"
against a *live measurement* is a muzzle: a backup acknowledged at nine days
stale would stay silent at ninety, and this deployment has already spent two
days believing silence was health (B138, and B458 which added the success mail
because of it).

## Work

**An acknowledgement lives exactly as long as the thing it acknowledges.**

1. `lib/db/migrations/030-admin-acks.ts` — one table. `id` (the entry's stable
   identity), `level` (how bad it was when acknowledged), `acked_at`,
   `acked_by`, `ended_at`, `ended_why`. A row with no `ended_at` is a live
   suppression; every row is the history, so history costs no second table.
2. `lib/adminConsole.ts` — `Attend` gains `id` (stable, carrying no number, so
   it survives the hours ticking up in its own title) and `level` (comparable
   within one id: days stale, percent full, journals under the floor, the
   newest purchase's timestamp). `Wrong` gains an `id` for the same reason the
   `backup` mark exists — matching a title is a list that is always missing its
   next entry.
3. `lib/adminAcks.ts` — `applyAcks(items, rows)` decides what is hidden: a live
   ack hides its entry, and stops hiding it the moment `level` rises above what
   was acknowledged. `sweepAcks` ends the rows whose id is no longer present,
   so a fault that clears and returns is shown again without anybody
   remembering to un-hide it.
4. `POST /api/admin/acks` — acknowledge one id, or end one early ("unhide").
   Cookie only, 404 to everybody who is not the operator, the shape
   `/api/admin/grants` already has.
5. `app/admin/` — an Acknowledge button on each entry, and a disclosure beneath
   the band that opens the history: what was acknowledged, when, whether it is
   still hidden, and an Unhide beside each one that is.
6. The empty band must say how many are hidden. "Nothing needs you" with three
   things acknowledged behind it is the ambiguity this whole ticket is about.

Not doing: per-operator acknowledgements (there is one operator address), a
snooze-until-a-date, or acknowledging from anywhere but this page.

## Acceptance

- `test/admin-acks.test.ts`: an acknowledged entry is hidden; the same entry at
  a higher level is not; an ack whose id has gone is ended rather than kept;
  an entry that returns after being ended is shown.
- The band, with everything acknowledged, says so rather than only saying
  nothing needs you.
- `npm run verify` green, and the page seen in a browser at 390px with an
  entry acknowledged and then unhidden.
