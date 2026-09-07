---
id: B673
title: Nobody is reminded to write while the trip is happening
type: FEATURE
priority: medium
complexity: medium
area: notifications, trips
found: "2026-09-07T08:56:14Z"
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
