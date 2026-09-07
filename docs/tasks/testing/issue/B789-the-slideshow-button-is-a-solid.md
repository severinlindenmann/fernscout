---
id: B789
title: The slideshow button is a solid navy blob that outranks the actions beside it, and the pills beside it are white on a cream page
type: ISSUE
priority: medium
complexity: low
area: gallery, map, brand
found: "2026-09-07T16:45:00Z"
started: "2026-09-07T14:38:51Z"
merged: "2026-09-07T14:46:52Z"
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

~~**And the pills are white.**~~ **This half of the capture was wrong — see
below.** It read `bg-white` as left over from before B733's cream panels. It
is not: these pages sit on a `cream-50` panel, and white is what lifts a
control off it.

## Work

- **One weight for the three actions**: the same white outline pill they
  already use. They are three alternatives of equal standing and should look
  it. `min-h-11` is already right on all three and stays.
- **The solid navy goes** from both the gallery and the map.
- **Yellow stays reserved for state, not for rank.** It already means "you are
  here" on this page — the active filter chip — and "picking a photograph" on
  the postcard button. Promoting the slideshow to yellow would collide with
  both, which is the reason not to simply swap one strong colour for another.

Not doing: the filter chips, the lightbox's own controls, or anything about
what the buttons do. This is weight and colour only.

## Acceptance

- The three gallery actions are visually the same weight as each other.
- No `bg-navy-900` action button remains on the gallery or the map.
- The active filter chip and the postcard "picking" state still read as the
  only yellow things on the page.
- Checked at 390px on both pages, in German — the labels are longest there.

## What changed while building

**The colour half of this ticket was wrong, and measuring caught it.** I wrote
it believing `bg-white` was a leftover that B733's cream panels had made
foreign, and changed the pills to `cream-50`. Measured in the browser
afterwards:

| | fill | sits on |
| --- | --- | --- |
| Slideshow, after that change | `rgb(255,250,240)` | `rgb(255,250,240)` |
| filter chip | `rgb(255,255,255)` | `rgb(255,250,240)` |

The action pill's fill had become identical to the panel behind it, so only its
border remained — while the *filter* chips still lifted. The actions receded
behind the filters, which is the same hierarchy fault this ticket was opened
about, inverted. B733 put a `cream-100` ground under `cream-50` panels on `/`
and `/agent`; these trip pages are the panel, and white is the lift on it.

So `bg-white` stays and only the weight changed: the solid `bg-navy-900`
slideshow button became the same white outline pill as the actions beside it,
on both pages. That was the real fault — the heaviest treatment sitting on the
lightest act.

**Left alone deliberately:** two other `bg-white` uses on the map page — a
dashed state chip (line ~175) and the places list container (~196). Neither is
an action pill, and the list's white is doing the same lift job.
