---
id: B715
title: A trip inside one city draws on a baked world outline, because there are no real map tiles
type: FEATURE
priority: low
complexity: high
area: map, tiles, hosting
found: "2026-09-07T00:00:00Z"
---

# B715 — A trip inside one city draws on a baked world outline, because there are no real map tiles

## Why

The last live piece of W20, split out when B06 was superseded — B665 and B671
built everything else in that plan, and this is the part neither of them could
touch because it is not a code decision.

Every map this software draws sits on `lib/worldLand.json`, a baked coastline.
It is the right answer for a trip that crosses continents and the wrong one for
a trip that never leaves one city: at that zoom there is nothing under the line
but empty ground. `docs/plans/W20-tracking.md` flagged it as its own roadmap
item for exactly this reason, and B46 is the same absence seen from the other
end — a city trip drawing as a single dot on a map thousands of kilometres
wide.

## Work

This is a hosting decision before it is a diff, and the decision is the
deliverable:

- **Self-hosted Protomaps** — one `.pmtiles` file, served off the same box, no
  metered third party and no key in the environment. Costs disk and a build
  step, and the file is large enough that `scripts/backup.sh` has an opinion
  about it.
- **A metered provider** — smaller, and puts a key and a bill on the operator
  of every self-hosted instance, which is the thing this project has otherwise
  avoided. If it is chosen it is a capability, off by default, absent rather
  than broken when off (`lib/capabilities.ts`).

Whichever it is, the baked outline stays as the fallback: an instance with no
tiles configured must render what it renders today, not an empty box.

Not doing: changing what is *drawn on* the map. The track, the legs and the
day markers are B665's and are correct; this is only what sits underneath them.

## Acceptance

- A trip whose whole track fits inside one city renders on something a reader
  recognises as that city.
- An instance with nothing configured renders exactly as it does today.
- Whichever route is chosen, the reasoning is written down in `docs/plans/`
  before the first tile is served.
