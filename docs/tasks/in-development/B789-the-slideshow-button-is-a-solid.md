---
id: B789
title: The slideshow button is a solid navy blob that outranks the actions beside it, and the pills beside it are white on a cream page
type: ISSUE
priority: medium
complexity: low
area: gallery, map, brand
found: "2026-09-07T16:45:00Z"
started: "2026-09-07T14:38:51Z"
session: ccdd5120-0eb0-4abf-b76e-a6fd8e5005d8
claimed: "2026-09-07T14:38:51Z"
---

# B789 — The slideshow button is a solid navy blob that outranks the actions beside it, and the pills beside it are white on a cream page

## Why

The owner, on the gallery and the map: *"make the button on Galerie look
cleaner, and same for the map Diashow."*

Two faults, and the first is a hierarchy mistake rather than a matter of taste.

**The gallery offers three actions at three different weights.** In
`app/[user]/(trip)/gallery/GalleryPageContent.tsx`:

| action | today |
| --- | --- |
| Fotobuch erstellen | outline pill, `border-navy-200 bg-white` |
| Postkarte senden | the same outline pill (yellow while picking) |
| Diashow | **solid `bg-navy-900` with white text** |

The solid one reads as the page's primary action. It is the opposite: making a
photobook and sending a postcard both spend the owner's credits and print
something real, while the slideshow just looks at pictures already on the
screen. The heaviest treatment is on the lightest act, and on a warm page it
lands as a dark blob. The map has the same button alone
(`MapPageContent.tsx:81`), where being solid navy is not signalling rank
against anything — it is simply heavy.

**And the pills are white.** `bg-white` predates B733, which put a `cream-100`
paper ground under `cream-50` panels. A white pill on that page is now the
only white surface in view and reads as foreign rather than as bright.

## Work

- **One weight for the three actions**: the quiet outline pill, on `cream-50`
  rather than white. They are three alternatives of equal standing and should
  look it. `min-h-11` is already right on all three and stays.
- **The solid navy goes** from both the gallery and the map.
- **Yellow stays reserved for state, not for rank.** It already means "you are
  here" on this page — the active filter chip — and "picking a photograph" on
  the postcard button. Promoting the slideshow to yellow would collide with
  both, which is the reason not to simply swap one strong colour for another.
- `bg-white` → `bg-cream-50` for these pills on both pages.

Not doing: the filter chips, the lightbox's own controls, or anything about
what the buttons do. This is weight and colour only.

## Acceptance

- The three gallery actions are visually the same weight as each other.
- No `bg-navy-900` action button remains on the gallery or the map.
- No `bg-white` remains on those pills.
- The active filter chip and the postcard "picking" state still read as the
  only yellow things on the page.
- Checked at 390px on both pages, in German — the labels are longest there.
