---
id: B556
title: Re-running the demo builder deletes fields the committed demo journal carries
type: ISSUE
priority: medium
complexity: low
area: demo content, tooling
found: "2026-09-06T09:22:09Z"
started: "2026-09-07T11:06:12Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T11:06:12Z"
---

# B556 — Re-running the demo builder deletes fields the committed demo journal carries

## Why

`scripts/build-demo-content.mjs` says of itself that it is "the only place
every field is exercised at once, which is the point: a field nothing in
`content/example/` uses is a field nobody notices has broken". It is now
behind the journal it claims to build.

Running it on a clean checkout on 2026-09-06 rewrote 42 files, **161 deletions
against 30 insertions**, and what it deleted was live content:

- `weatherData:` on every day that had one — the readings B325's own sweep
  filled in, replaced by nothing;
- `transportMode:`, `transportFrom:`, `transportTo:` on the days that carry
  them;
- 22 lines from `usa-2026/trip.md`.

Nothing warns. The script prints "Wrote 5 trips, 38 entries" and exits 0, and
the loss is only visible in `git diff` — which is to say, only to somebody who
happened to run it inside a clean checkout and thought to look. The demo is
also what `scripts/deploy.sh` syncs to the live instance, so a regeneration
committed without reading the diff would take the weather off fernscout.ch.

Found while checking whether the demo journal was up to date, which is
exactly the question the script is supposed to answer and currently cannot.

## Work

Decide which direction the file is authoritative in, and make the script hold
that:

- if the script is the source, it has to write every field the demo now
  carries — `weatherData` cannot be one of them, since it is a measurement
  nobody may invent, so it would have to preserve what is on disk;
- if the file is the source, the script is a one-off seeder and should say so
  and refuse to overwrite a journal that already exists without `--force`.

The second is smaller and probably right. Either way it must not be possible
to silently drop a day's weather by running a script whose output is committed.

Related: B238 (`npm run seed:example`).

## Acceptance

- Running the builder on a clean checkout either changes nothing, or refuses,
  or preserves every field the committed demo carries.
- `git diff --stat content/example` after a run is empty, or the run said in
  words what it was about to replace.
