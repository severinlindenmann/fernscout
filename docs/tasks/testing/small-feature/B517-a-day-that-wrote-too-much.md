---
id: B517
title: A day that wrote too much is silently truncated
type: FEATURE
priority: medium
complexity: medium
area: photobook, print
found: "2026-09-05T20:42:58Z"
started: "2026-09-05T21:52:32Z"
merged: "2026-09-05T22:38:13Z"
---

# B517 — A day that wrote too much is silently truncated

## Why

`materialise` measures how much of a day's prose fits the column left beside
its photograph, prints what fits, and warns: *"13 lines written, 11 fit on the
page."* The rest is dropped, with "(continued on the website)" underneath.

That is honest, and it is the wrong outcome for the day somebody wrote most
about. The days with the most to say are the ones worth reading, and they are
the ones this truncates. A book of somebody's journey that cuts their longest
entry mid-thought — in favour of a photograph that could have moved one page
later — has its priorities the wrong way round.

There is no control for it: `includeText` is all days or none.

## Work

Let a day's words run on. The shape most likely right: when the prose does not
fit, the day gets a second page and the photograph that would have shared the
first moves to it, or the text continues alone.

That interacts with things this codebase already decided, and the ticket has to
respect them. Page counts move, so the price moves. `expandToMinimum` and the
binder's maximum both count pages. And B496 made a day's page carry a
photograph precisely so it would not be a wall of text — a continuation page
that is only text is the thing that was removed, so it needs an argument.

Offer it per day rather than globally: most days do not need it, and a book
where every day has a second half-empty page is worse than one that truncates.

**Not doing:** shrinking the type to fit. A book that changes size day to day
reads as a fault, and the type scale is already the smallest that prints well.

## Acceptance

- A day whose prose does not fit can be given the room, and the warning stops.
- A day nobody has asked about still truncates and still says so.
- The page count and the price both follow.
