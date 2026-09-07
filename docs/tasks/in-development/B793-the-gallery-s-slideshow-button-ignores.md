---
id: B793
title: The gallery's slideshow button ignores the gallery's own filter and duplicates the map's
type: ISSUE
priority: medium
complexity: low
area: gallery, slideshow
found: "2026-09-07T17:00:00Z"
started: "2026-09-07T14:50:07Z"
session: ccdd5120-0eb0-4abf-b76e-a6fd8e5005d8
claimed: "2026-09-07T14:50:07Z"
---

# B793 — The gallery's slideshow button ignores the gallery's own filter and duplicates the map's

## Why

The owner asked whether the slideshow could come off the gallery to make it
less cluttered. Looking at what the button actually does, it should — and for
a better reason than clutter.

**It is not a slideshow of the gallery.** `SlideShow` takes `places` and
builds a narrated cut from `places.flatMap((p) => p.entries)`
(`components/SlideShow.tsx:90`) — it is the trip's journey, narrated across
its stops. `GalleryPageContent.tsx:110` hands it the `places` prop **straight
through, unfiltered**. So a reader who filters the gallery to one place and
presses it gets the whole trip anyway. The page offers a control that appears
scoped to what is on screen and is not.

**And it is the same control the map already has.** `MapPageContent.tsx`
renders the identical component with the identical props. There is one
slideshow in the product reachable from two pages, and the map — "Wo wir
waren", the page about the journey across places — is where a narrated journey
belongs. The gallery's own actions are about photographs: make a book of them,
post one.

Removing it therefore loses no capability. It removes a second door to a
feature that is still fully reachable, and removes a small lie about scope.

## Work

- Drop the button, `showing`/`setShowing`, and the `<SlideShow>` render from
  `app/[user]/(trip)/gallery/GalleryPageContent.tsx`.
- The `places` prop becomes unused there — remove it and its call site,
  rather than leaving a prop nothing reads. Run `npm run unused` (knip)
  afterwards, which is what catches the leftovers this kind of removal
  strands.
- Leave the map's button exactly as it is.

Not doing: a gallery-scoped slideshow of the filtered photographs. That is a
different feature, and if it is wanted it is a new capture rather than a
justification for keeping a button that does not do it.

## Acceptance

- The gallery header shows the photobook and postcard actions and no
  slideshow.
- The map's slideshow still opens and plays.
- `npm run unused` reports nothing new.
- Checked at 390px.
