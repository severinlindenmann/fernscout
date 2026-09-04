---
id: B211
title: The demo journal's photographs have nothing to do with the places they are captioned with
type: ISSUE
priority: low
complexity: low
area: readme, demo content
found: "2026-09-04T06:15:57Z"
---

# B211 — The demo journal's photographs have nothing to do with the places they are captioned with

## Why

`scripts/build-demo-content.mjs:18` fetches every demo photograph from Lorem
Picsum, which serves random Unsplash images, and the comment above it says why:
"no second download, and nothing to license". That was the right call for a
repository that must clone and run with no accounts and no licence questions.

It has a cost that only became visible in W-nothing and shows up now that B154
has put the demo journal in the README. `/example/trips/parks-2025/gallery`
labels a seascape "Wind Cave National Park", an ocean wave and a red front door
"Badlands National Park", and a frog "Laramie". The day entry captioned
"Arches, once the coaches leave" — whose prose is about Delicate Arch at six in
the evening — shows a neoclassical building facade, a slot canyon and a sand
dune.

Two costs, and the second is the real one:

- **The README now shows this.** For a self-hostable project the first ten
  seconds decide whether somebody clones it, and the pictures are the ten
  seconds. Photographs that visibly contradict their own captions read as a
  toy.
- **`content/example/` is what an agent reads to learn the content model.**
  A geotagged entry whose gallery has nothing to do with its coordinates
  teaches, quietly, that the two are unrelated.

Noticed while capturing the README screenshots for B154. Not absorbed into it:
that task was images only.

## Work

Not decided — the trade-off is real and the current answer is defensible. What
a decision needs:

- Whether Picsum can be asked for something less arbitrary, or whether a small
  set of permissively-licensed, actually-relevant photographs should be
  committed for the handful of days the README photographs.
- If committed: the weight, and where it sits against the 339 KB budget
  `docs/screenshots/README.md` sets for the screenshots themselves.
- Whether it is enough to fix only the days the README shows, and leave the
  rest random. Cheap, and honest if the demo says so somewhere.

Not doing: fetching at build time from anywhere that needs a key, or shipping
anything whose licence has to be explained.

## Acceptance

- The trip and day the README screenshots show have photographs that do not
  contradict their captions.
- `npm run demo:build` still works with no account and no key.
- Whatever is decided about the other four trips is written down, so the next
  person does not re-derive it.

## Held deliberately (2026-09-04)

Raised with the owner during the backlog-issue campaign and **left in
`backlog/` on purpose**: choosing photographs is a matter of taste, and this
one waits for a session where a person picks them. Not stale, not blocked —
held.

One correction to the Work section above, which the decision does not depend
on but the next reader should not have to re-derive. It weighs committed
photographs against "the 339 KB budget `docs/screenshots/README.md` sets for
the screenshots themselves". That budget governs the four README screenshots
only. The demo journal's photographs are **already committed** —

```
$ git ls-files content/example | grep -cE '\.(jpg|jpeg|png|mp4|webp)$'
92
$ … | xargs stat -f '%z' | awk '{s+=$1} END {print s}'
17635849        # 16.8 MB
```

— so replacing them changes the repository's weight hardly at all, and the
"where it sits against the budget" question does not arise. What the decision
actually costs is sourcing and licence-checking, which is the thing to weigh.

The three ends considered, so they do not have to be reconstructed:

1. Replace only the photographs the README screenshots show (`parks-2025`),
   leave the rest random, and say so in the demo. The ticket's own
   "cheap, and honest if the demo says so somewhere".
2. Replace all 92, which also fixes the second cost — `content/example/` is
   what an agent reads to learn the content model, and a geotagged entry whose
   gallery contradicts its coordinates teaches that the two are unrelated.
3. Keep Picsum and name it as a placeholder in the README and the demo. Costs
   nothing and removes the surprise, but the screenshots still show a seascape
   captioned as a national park.
