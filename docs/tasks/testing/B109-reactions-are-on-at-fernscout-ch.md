---
id: B109
title: Reactions are on at fernscout.ch and nothing has confirmed one is recorded and survives a restart
type: OPS
priority: low
complexity: low
area: reactions, ops, capabilities
found: "2026-09-03"
related: B102, B103, B104, B105, B106, B107, B108, B110
merged: "2026-09-11T18:01:24Z"
---

# B109 — Reactions are on at fernscout.ch and nothing has confirmed one is recorded and survives a restart

## Why

`/api/health` reports `reactions` enabled, with no environment variable and no
database behind it (`lib/capabilities.ts:17` — `env: []`, `db: false`). It is
stored in `DATA_DIR`, through `lib/store.ts` and `lib/reactions.ts`.

That is the detail worth checking on a real server rather than a laptop.
`.env.example` is explicit that `DATA_DIR` must live outside the repository,
because `scripts/deploy.sh` runs `git pull` and a rebuild — and nothing has
confirmed that a reaction left on fernscout.ch is still there after a deploy
has pulled, rebuilt and restarted. This is a small feature with a failure mode
that is silent, permanent, and only visible to the person whose reaction
vanished.

It is also an unauthenticated write from the open internet, which is the class
B01 and B04 are about.

## Related

One campaign, not nine tasks: every capability this instance can switch on,
driven once against fernscout.ch by somebody who can read the answer. They
share the standing rules, the test journal and the rule that every defect
becomes its own capture. The order is forced — B102 first (everything else
arrives by mail), then B103, and the rest in any order. B101 is the same
shape pointed at the gate rather than the feature.

## Work

- Leave a reaction on a public day on fernscout.ch, from a browser.
- Confirm it is counted, and that it is still counted from a different device.
- **Then deploy, or restart the service, and look again.** That is the point of
  the task; everything else here is secondary.
- Find out where on the server it was written, and whether that path is inside
  `$DATA_DIR` or inside the repository working tree.
- Check what an anonymous reader may do versus a signed-in one, and whether
  the same reader can inflate a count by reloading.
- Check whether reactions are offered at all on a draft or a `test: true` day,
  where they should not be.

Standing rules for this run: any secret goes in `/etc/fernscout/env` and
nowhere else — never `content/config.json`, never a commit, never echoed back
into a chat. Work in a journal created for this, with days carrying
`test: true`, and do not write into a journal somebody is actually using.
Leave the instance as you found it, or say in this task what you left switched
on. Every defect becomes its own backlog task referencing this id — do not fix
anything here, so the finding and the fix stay separate records. B101 is the
same shape: an engagement whose output is other tasks.

## Acceptance

- A reaction shown to survive a restart of the live service — before and after.
- The storage path on the server recorded, and whether it sits under
  `$DATA_DIR`.
- An answer on whether the count can be inflated by one reader, and whether the
  write is rate limited.
- One backlog task per defect, referencing B109.


## Engagement run, 2026-09-11
Run 2026-09-11 against fernscout.ch. **Answered: yes, it survives.**

## The check

```
17:06:30  POST /api/reactions  → {"counts":{"❤️":1},"mine":"❤️"}
          row in Postgres: reactions, owner_id "owner",
          trip_id "example/parks-2025", day_slug "monument-valley-after-dark"
19:11:18  service restarted (ActiveEnterTimestamp, by an ordinary deploy)
19:11:2x  GET  /api/reactions  → {"counts":{…:{"❤️":1}},"mine":{}}
```

The count is there after the restart. That is the whole of what this ticket
asked.

## What it corrected about the ticket's premise

The ticket says reactions are stored in `DATA_DIR` through the file repository,
citing `lib/capabilities.ts:32` — `reactions: { env: [], db: false }`. On this
instance they are **in Postgres**: `find /var/lib/fernscout -name 'reactions*'`
returns nothing and the row is in the `reactions` table.

So `db: false` means *this capability does not require a database to be
configured*, not *this capability does not use one*. `lib/reactions.ts` picks
`reactionsDb.ts` or `reactionsFile.ts` from what the instance has, the way
AGENTS.md describes for everything else — "local dev is SQLite, production is
Postgres, and nothing outside `lib/db/` knows which".

That is worth knowing before anybody reads `db: false` as "kept in a file" and
goes looking for the wrong thing, which is what I did first.

## Two things noticed in passing, neither filed

- **The same emoji twice is a toggle.** My second POST, identical to the first,
  removed the reaction and answered `{"counts":{},"mine":null}`. Correct
  behaviour, and it is how the instance was returned to the state I found it in
  — no probe rows remain.
- **`counts` has two shapes.** `GET` answers keyed by `trip:day`
  (`{"example/parks-2025:monument-valley-after-dark":{"❤️":1}}`) while `POST`
  answers flat (`{"❤️":1}`). Both are consistent within themselves and a caller
  reading the documented shape will not be surprised — but a caller who assumes
  one from the other will be. Not filed, because it may well be deliberate;
  worth a look by somebody who knows which was intended.


Full record: `.claude/runs/2026-09-11-open-queue/B109/findings.md`
