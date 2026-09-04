---
id: B212
title: A journal's title is truncated to five characters in the trip header on a 1440px desktop
type: ISSUE
priority: low
complexity: low
area: frontend, header
found: "2026-09-04T06:15:57Z"
---

# B212 — A journal's title is truncated to five characters in the trip header on a 1440px desktop

## Why

On the trip pages — `/example/trips/parks-2025` and every `/day`, `/gallery`,
`/map`, `/costs` under it — the journal title in the top-left of the header
renders as **"Ferns…"** and the tagline beneath it as "Las Vegas …". The
journal is called "Fernscout Demo" and there is a screen's worth of empty space
to the right of it.

Measured at a 1440 × 900 viewport, which is an ordinary laptop, not a narrow
one. It is not a responsive breakpoint doing its job: the same header on
`/example/trips/parks-2025/map` and `/gallery`, which have a shorter middle
section, shows "Fernscout Demo" and the full tagline in the same space. So the
truncation is the trip-story header's own layout squeezing the title to make
room for the day counter and the progress bar, and it squeezes it past the
point of usefulness — five characters and an ellipsis identify nothing.

The cost is small but it lands in the worst place: the header is the only thing
on the page that says whose journal this is, and it is on every trip page. It
is also now in the README — `docs/screenshots/trip-story.jpg` and
`day-entry.jpg` both show "Ferns…" — which is how it was noticed.

Found while capturing the README screenshots for B154. Not absorbed into it:
that task was images only, and the screenshots deliberately show what the site
actually does rather than a doctored version of it.

## Work

Find the header component under `app/[user]/(trip)/` or `components/` and work
out why the title box is given so little room when the day counter and progress
bar are present. Likely candidates: a flex child with no `min-width: 0` escape,
or a fixed basis that does not grow.

Consider what should give first when the space genuinely is tight — the
tagline, then the day counter's label, then the title. The title should be the
last thing truncated, not the first.

Not doing: a redesign of the header, or hiding the progress bar.

## Acceptance

- At 1440 × 900 the journal title renders in full on `/example/trips/parks-2025`
  and on a day page under it.
- At a genuinely narrow viewport something still truncates, and it is not the
  title first.
- The README screenshots are recaptured if the header changes shape — see
  `docs/screenshots/README.md` for how, and for the 339 KB budget.

## B170 carries the fix

This is the same defect as **B170** — "the journal's title is clipped in the
header at exactly the width where the nav labels appear" — measured there at
1280 and 1440 before the README screenshots were taken. B170 was in flight when
this was captured, and its evidence now includes the 1440 × 900 reading above.

Fixed in `components/PageHeader.tsx` under B170: the title box had `flex-1`,
whose `0%` basis meant the title counted for nothing when the browser decided
whether the header row fitted on one line — so the row never wrapped and the
title absorbed the whole shortfall, 71px of box for 140px of "Fernscout Demo".
It now carries a real basis and the nav takes a second line instead.

The reading in **Why** above was close: the day counter is 144px of the
difference between this page and `/map`, which is why the truncation shows here
first. But the mechanism is in the shared header, not in the trip-story
header — `/map` was one wide chip away from the same thing.

**What is left in this ticket is the third acceptance line only**: the README
screenshots still show "Ferns…", and the header is now two rows at desktop on
trip pages, so `docs/screenshots/trip-story.jpg` and `day-entry.jpg` need
recapturing inside the 339 KB budget. See `docs/screenshots/README.md`, and B154
for how they were made.
