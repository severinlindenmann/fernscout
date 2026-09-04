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
