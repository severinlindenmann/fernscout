---
id: B1288
title: Nothing on the live instance ever fills in a day that asked for weather
type: OPS
priority: medium
complexity: low
area: weather, ops
found: "2026-09-10T10:55:42Z"
started: "2026-09-11T08:42:22Z"
merged: "2026-09-11T10:01:16Z"
---

# B1288 — Nothing on the live instance ever fills in a day that asked for weather

## Why

`weather: true` is the promise that the *server* looks the weather up — AGENTS.md
puts it strongly, because it is what makes the "never invent a fact" rule
survivable:

> Since B325 a day may carry `weather: true`, and the **server** looks it up …
> `npm run weather:update` fills in every day that asked and has none yet.

On fernscout.ch nothing runs it.

`systemctl list-timers` on the box shows exactly one Fernscout unit —
`fernscout-backup.timer`. `scripts/backup.sh` chains two jobs off the back of it,
and weather is not among them:

| step | job |
| --- | --- |
| 0 | `npm run rates:update` — currency reference rates (B1084) |
| — | `npm run reminders:send` — evening reminders |
| — | *(nothing for weather)* |

The effect, measured on the instance today:

- A day written through `/agent` this morning carries `weather: true` and no
  `weatherData`.
- The owner's own journal has a day dated today in the same state: asks for
  weather, has none.
- Older days on the same journal do have readings, so it has clearly been run by
  hand at some point — which is the shape of a job nobody owns.

The owner cannot fix this: they have no shell on the server, and `weather:update`
is a `npm run` script with no route in front of it. So a field the product offers,
and which the helper sets by default on days it creates, silently does nothing
for as long as nobody remembers.

## Work

- Chain `weather:update` off the backup timer beside `rates:update` and
  `reminders:send`, with the same "never fatal" treatment — it needs the open
  internet and a backup does not.
- Check what it does with a day the archive cannot answer for yet: AGENTS.md says
  it leaves it for the next run rather than filling it with something plausible,
  which is the right behaviour for a job that will now run nightly against days
  written hours earlier.
- Backfill once after it is wired up, and confirm the day dated today gets a
  reading.

## Acceptance

- `systemctl list-timers` or `scripts/backup.sh` shows weather being refreshed on
  a schedule.
- A day published with `weather: true` shows a reading within a day, without
  anybody logging in.
