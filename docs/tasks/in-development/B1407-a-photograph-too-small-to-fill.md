---
id: B1407
title: "A photograph too small to fill its slot sits at the foot of the page instead of in the space it has"
type: ISSUE
priority: medium
complexity: medium
area: photobook, page layout
found: "2026-09-10T22:15:00Z"
started: "2026-09-11T04:23:03Z"
session: 96a5b964-fad1-4616-9124-a01eabbd8a46
claimed: "2026-09-11T04:23:03Z"
---

# B1407 — A photograph too small to fill its slot sits at the foot of the page instead of in the space it has

## Why

A day page — *Roadtrip an die Costa Vicentina*, page 33 — draws the date, the
title, the place, the transport line and three lines of prose at the top, then
**a hand's width of nothing**, then a portrait photograph pushed down against
the bottom of the page: its lower edge runs into the running foot (*33 · Tag 8
· Roadtrip an die Costa Vicentina*), and there is no margin under it at all.

The picture is smaller than the page's column, which is likely deliberate —
this is probably `containWithinResolution` (`lib/photobook/plan.ts:658`), the
B641 behaviour that shows a whole picture at the size its pixels actually
support rather than blowing it up until it goes soft. That part is right and
should stay. The trip is also the one carrying the *"47 Fotos haben zu wenig
Pixel"* warning, which fits.

**What is wrong is where the smaller rectangle ends up.** It should sit in the
middle of the space it has, with air above and below it, and it must never
touch the running foot.

The fitting functions all centre within the slot —
`containWithinResolution:665-667` and `scaledRect`'s contain branch at `:612`
both split the remainder evenly — so the suspicion is the **slot rectangle**
for this page shape rather than the fit inside it: a slot that starts well
below the text block and runs to the page edge would produce exactly this.
Whoever picks this up should confirm which before changing anything; the fit
maths is not obviously at fault.

Composition, not a crash, so no test can see it: `/docs/branding/print` is the
bench (bleed, trim, safe area, gutter, from the constants the renderers use)
and `check-a-drawing` is the procedure.

## Work

- Find where the photo slot is computed for a day page with text and one
  photograph, and check the rectangle against the text block above and the
  running foot below.
- The picture belongs in the optical middle of the space between them. Optical
  rather than arithmetic if the page's other furniture makes a difference —
  look at it, do not only compute it.
- **Nothing may overlap the running foot.** If the slot genuinely extends into
  that band, that is the bug and it will affect every page of this shape, not
  only the shrunk ones — check a page whose photograph does fill its slot
  before concluding it is only about small ones.
- Keep B641's behaviour intact: a photograph without the pixels is shown
  smaller, never scaled up. This ticket moves it, it does not resize it.
- Check the mirrored page (verso/recto) too — a gutter-relative slot can be
  right on one side and wrong on the other.

## Acceptance

- The page above, rebuilt: air above and below the photograph, nothing touching
  the running foot. Seen at `/docs/branding/print` and in a built PDF, not
  inferred from the code.
- A page whose photograph does fill its slot is unchanged.
- A page with a caption is still correct — `placement`'s `captionHeight`
  reserves that band and must keep doing so.
- `npm run verify` clean.
