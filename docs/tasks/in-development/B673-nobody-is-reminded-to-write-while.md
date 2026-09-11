---
id: B673
title: Nobody is reminded to write while the trip is happening
type: FEATURE
priority: medium
complexity: medium
area: notifications, trips
found: "2026-09-07T08:56:14Z"
started: "2026-09-11T17:27:02Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T17:27:02Z"
superseded: B1219
---

# B673 — Nobody is reminded to write while the trip is happening

## Why

The instance knows a trip is happening. `lib/currentTrip.ts` and
`currentTripRef()` in `lib/trips.ts` answer which trip is current; `plan.md`
says one was planned; the dates are in `trip.md`. Push already exists and
already works — `scripts/notify.mts`, `lib/push.ts`, VAPID keys, subscriptions
in the database or in `$DATA_DIR`.

All of it points one way: at *readers*, telling them a day was published. The
person who has to write the day is told nothing at all. So a trip goes quiet
for four days, and it goes quiet silently — no reminder, no digest, and the
first anybody notices is when the traveller gets home and cannot remember
Tuesday.

Nothing invents content, and this must not either. The nudge is "you have not
written since Sunday", never a draft.

## Work

The smallest thing that works: a scheduled check the instance already has a
place for (`scripts/`, a systemd unit like the nightly ones in
`scripts/install-units.sh`), which for each journal with a current trip and no
entry in the last N days sends the owner one push — reusing `lib/push.ts`
rather than a second delivery path. Mail is the fallback where push is off,
through `lib/mail`.

Decisions this task has to make and should not assume:

- **N.** Two days is the obvious guess and is a guess. It belongs in the user's
  own `config.json`, off unless set — every optional capability is off by
  default.
- **Who.** The owner, or everybody in `people:`? Everyone on the trip can
  write, so probably everyone who opted in — but a reminder is nagging, and a
  person on somebody else's trip did not sign up for it. Default to the owner.
- **How often.** Once, not daily. A reminder that repeats is a reminder people
  turn off.

Not doing: writing a draft, suggesting prose, or nudging about a trip that is
merely planned and has not started.

## Acceptance

On an instance with a current trip whose newest entry is older than the
threshold, the command sends exactly one push to the owner and none to
readers; run again the same day it sends nothing. With the setting absent it
sends nothing at all and says why. A trip with an entry today is untouched.
`--dry-run` prints who would be told, like `notify.mts` does.


## Decision, 2026-09-11 — mail now, push as its own ticket

**The ticket's own Work section cannot be followed as written.** It says to reuse
`lib/push.ts` "rather than a second delivery path". Research found that is not a
reuse but a schema change:

- `POST /api/push/subscribe` sets `contactId` only from
  `findActiveContactId(username, email)`, which reads the **contacts** table.
- An owner is never a row in their own contacts table, so **the owner's own
  subscribed browser stores `contactId: null`** — indistinguishable from an
  anonymous stranger who subscribed to a public journal.
- `StoredSubscription` (`lib/repos/types.ts:32-48`) carries no owner flag at all,
  and `subscribersFor` (`lib/push.ts:173-210`) is built entirely around *reader*
  visibility — private, guest, public — never around identifying the owner.

A builder who takes "reuse `lib/push.ts`" at face value either wires the
reminder to `subscribersFor`, which pushes to every reader of a public trip —
the exact opposite of the intent — or discovers the gap mid-build and improvises
a marker without noticing it is a schema change.

**So: mail only, owner only, in this pass**, which the ticket already sanctions
as its fallback. One per-journal config field (absent = off), a script beside
`scripts/notify.mts`, a daily timer of its own.

**A dedicated timer, not the backup's.** The ticket floats reusing the backup
timer; `deploy/fernscout-backup.timer` runs at **03:20**, which is the wrong
hour to be told to write up today.

**Idempotent by a stamp**, so a second run in the same day is a no-op.

The owner-marker work is a follow-up ticket, captured separately so push can
arrive later without holding up a reminder that already works.

## Already built — B1219 supersedes this, 2026-09-11

**Do not build the mail-only/N-days scheme above.** It already shipped, a day
before this decision section was written, as B1219 (`docs/tasks/completed/
B1219-room-decisions-an-evening-reminder-during.md`, merged
2026-09-10T06:27:07Z). Its own body says outright: *"Supersedes B673 — note
it there."* That note never got made, and this ticket kept living in
`in-development/` with a decision section written the next day that did not
find it.

What is actually on `main` right now:

- `lib/digest/reminder.ts` — `sweepReminders()`. Its own top comment: *"B1219,
  D46, and B673's open question answered."* Per-trip opt-in
  (`trip.reminder.channel`, set conversationally in the helper room via
  `set_reminder` — see `lib/api/tripReminder.ts`), checked against `isRunning`
  and `hasWrittenToday` (draft counts). Idempotent by
  `content/<user>/.reminder-sent.json` (`markerFile`/`alreadySentToday`/
  `markSentToday`) — a marker file beside the journal, the same shape choice
  this ticket's own decision section made independently.
- `scripts/reminders.mts` — the CLI door, `--dry-run` prints who would be
  told exactly like `notify.mts` does; its own header again: *"B1219, D46,
  and B673 with a decision finally made."*
- Wired into `scripts/backup.sh` step 0b, nightly, off the same timer this
  ticket's decision section argued against reusing (`fernscout-backup.timer`,
  03:20) — a real design choice made with both tickets in view, not an
  oversight: the reminder is an evening nudge and the backup already runs
  nightly infrastructure nothing else does.
- Channel is mail **or** WhatsApp, not push — `sendReminder()` in the same
  file. Mail path uses `sendMail`/`renderMail`, gated by the journal's own
  `features.mail`, same as this ticket asked for as its fallback.
- `test/reminders.test.ts` covers the dry-run/idempotency/no-entry-vs-entry
  cases this ticket's own Acceptance section describes.

The one real difference from this ticket's original Work: B1219 is
**per-trip opt-in with a daily "wrote nothing today" check**, not a
**per-journal "N quiet days" threshold**. That was a decision (D46), not an
oversight — see `docs/plans/2026-09-10-room-decisions.md`. If the N-day
version is still wanted on top of the daily one, that is a new, narrower
ticket against `lib/digest/reminder.ts`'s existing machinery, not a second
delivery path built from scratch beside it.

No code changed on this branch. Filing `superseded: B1219` in this file's own
frontmatter rather than moving it, since a builder was told not to move this
ticket's lane; a person can run `npm run tasks -- tidy` to re-file it into
`superseded/`.
