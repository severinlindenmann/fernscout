---
id: B1036
title: content/example's new trips can flicker as malformed during ship.sh's demo sync
type: OPS
priority: low
complexity: low
area: deploy
found: "2026-09-08T21:38:36Z"
---

# B1036 — content/example's new trips can flicker as malformed during ship.sh's demo sync

## Why

B828's investigation (see that file's "The `trips/` window, tested" section)
measured this directly. `.claude/skills/vps/ship.sh` rsyncs
`content/example/trips` into `$CONTENT_DIR/example/trips` on every deploy,
live, with `--delete`, while the server keeps serving requests. rsync `mkdir`s
a brand-new trip's destination directory before it transfers `trip.md` into
it; between those two steps the directory exists with none of its content. A
harness reproducing that exact rsync invocation against real GNU rsync
(200–300 rounds) observed **every single newly-created trip directory**
sitting in that empty state for 30–160 separate reads of a tight polling
loop — a real, sustained window, not a rare timing fluke.

`lib/trips.ts`'s `readTrip()` already handles this without crashing — a
folder with no `trip.md` is returned as a `MalformedTrip` (logged, excluded
from `getTrips()`) rather than throwing — so the practical effect today is:
for the length of one deploy's transfer of a *newly added* trip (which
includes that trip's `media/`, so potentially several seconds for a photo
gallery, not milliseconds), that one trip is briefly missing from
`fernscout.ch`'s public demo journal's trip list, then reappears once the
sync finishes. It self-heals and nothing crashes.

Two things keep this out of scope for a diff in this repository:

- It can only ever happen to `content/example`. `scripts/deploy.sh` — the
  tracked, shipped deploy script every instance runs — explicitly refuses to
  touch `$CONTENT_DIR` at all (`scripts/deploy.sh:74-79`). No real person's
  journal is ever rsynced by anything.
- `ship.sh` itself is gitignored (`.gitignore:72`, the whole `vps/`
  directory) — "this instance's own deploy path," not part of the shipped
  software, no tracked history, unreachable by a merge.

## Work

Not a code change to this repository — `ship.sh` isn't in it. If it's worth
doing at all, it's a hand-edit to the operator's own copy of `ship.sh`: sync
a newly-added trip's full content into a staging path first (e.g.
`content/example/.trips.new/<id>`), then `rename(2)` it into
`content/example/trips/<id>` in one step once the transfer completes, rather
than rsyncing straight into the live path. That's the same
temp-name-then-rename pattern that already makes `config.json` and an
existing trip's `trip.md` safe (B946, B828) — applied one level up, at the
whole-directory granularity, only for the create case.

Given the blast radius (one non-real demo journal, one rare event — adding a
brand-new trip — self-healing within the same deploy), this may not be worth
anyone's time at all. That call belongs to whoever maintains `ship.sh`.

## Acceptance

A person looks at this, decides whether the demo journal flickering for a
few seconds during rare deploys is worth a hand-edit to their own gitignored
script, and closes it `wontDo` or applies the staging-then-rename change
themselves.
