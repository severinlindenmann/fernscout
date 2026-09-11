---
id: B1291
title: A journal with no usable cover renders half a card of flat colour on the landing page
type: ISSUE
priority: low
complexity: low
area: landing
found: "2026-09-10T10:59:24Z"
started: "2026-09-11T15:12:41Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T15:12:41Z"
---

# B1291 — A journal with no usable cover renders half a card of flat colour on the landing page
## Why

On the landing page at 390px, each journal is a card with a ~180px image band
above its title. When the journal has no usable cover, the band is drawn anyway:

- **Test Elena** — 180px of flat cream, entirely blank.
- **Test Jonas** — 180px of flat mustard.

So half the card is a coloured rectangle that says nothing, on a phone, in the
list that is meant to make somebody want to open a journal. The blank one in
particular reads as an image that failed to load.

The demo's card, which has a photograph, shows what the layout is for.

## Work

- Decide what a coverless journal's card looks like. Dropping the band and
  letting the card be title-and-line is the smallest answer and probably the
  right one; anything drawn there has to earn 180px of a phone screen.
- The mustard block is presumably a deliberate fallback tint. Whether a solid
  brand colour is better than no band is a judgement — look at both at 390px
  rather than reasoning about it.

**Re-measured before building, per instruction — the reported figures do not
reproduce.** Checked `https://fernscout.ch/` signed out at 390×844 with
`chrome-devtools` (`evaluate_script` reading `getBoundingClientRect()`/
`getComputedStyle` on every card image, not a screenshot guess):

- The band is **112px** (`h-28`), not ~180px, and the code
  (`components/LandingSections.tsx`) matches: `h-28` is Tailwind's 7rem = 112px.
  180px does not appear anywhere in this component or its class list.
- There is exactly **one public journal card on the live landing page right
  now** — the demo journal `/example`, and it has a real cover photograph
  (`/example/media/usa-2026/denver-and-a-truck/01.jpg`, rendered at 435×112px
  — width is a hair over 390 because the viewport carries a scrollbar gutter).
  No mustard band, no blank cream band, because no coverless *public* journal
  is currently listed. "Test Elena" and "Test Jonas" from the ticket are not
  on the live landing page as of this session (2026-09-11) — removed, made
  non-public, or excluded as `test:` content sometime since the ticket was
  captured on 2026-09-10.
- Grepped the whole worktree for a per-journal tint (mustard or otherwise) on
  this card: none exists. The only fallback was `bg-cream-100`, unconditional,
  at 112px — confirms the ticket's "cream" report and the code both say 112px,
  not 180px; the "mustard" report could not be reproduced anywhere in source
  or on the live page as it stands today.

So: the height figure in the ticket (~180px) does not match the code (112px)
or what is live today, and the mustard case could not be found at all. Given
the code plainly shows the same unconditional flat-colour band the ticket is
about — just at a different, smaller height — I built the fix rather than
stopping, on the reasoning that the underlying fault (a band that says nothing
when there is no cover) is confirmed in the code even though I could not
reproduce the exact pixel figures.

**Built**, per the ticket's own recommendation: dropped the band entirely for
a coverless journal.

- `components/LandingSections.tsx`, `PublicJournals`: the `<div className="h-28
  w-full bg-cream-100" />` fallback is gone. A coverless journal's card is now
  title-and-line only — the `<img>` renders when `journal.cover` exists and
  nothing takes its place when it does not. A journal with a cover is
  byte-for-byte unchanged.
- No new locale strings, no new colour — this is a deletion.
- No test covered the fallback band before or after; none of `npm run verify`'s
  suite touched `PublicJournals`.

**Not reproduced visually with a real coverless card**, live or local — none
exists in either place right now (the local `content/example` journal also
carries a cover). The change itself is a one-line conditional removal I read
carefully rather than screenshotted; if a coverless journal shows up again,
worth a quick look at `/` at 390px to confirm the card reads cleanly as
title-and-line.

## Acceptance

- A journal with no cover photograph renders a card with no empty image band.
- A journal with one is unchanged.
