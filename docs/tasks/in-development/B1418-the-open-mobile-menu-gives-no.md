---
id: B1418
title: The open mobile menu gives no sign that it scrolls
type: ISSUE
priority: medium
complexity: low
area: components/PageHeader.tsx
found: "2026-09-11T07:26:44Z"
started: "2026-09-11T07:37:31Z"
session: ceb70967-b4b6-4f4d-ab22-ace3a9e5ee0d
claimed: "2026-09-11T07:37:31Z"
---

# B1418 — The open mobile menu gives no sign that it scrolls

## Validity

Valid — confirmed at `components/PageHeader.tsx:188`: the open panel is
`max-h-[70vh] overflow-y-auto` with no scroll indicator of any kind, and the
content beneath it (`TripSwitcher`, `CurrencySwitcher`, `LocaleSwitcher`, the
docs pill, the agent link, `SiteNav`) is easily tall enough to overflow on a
journal with several sections.

## Why

`components/PageHeader.tsx:188` gives the open hamburger panel
`max-h-[70vh] overflow-y-auto`. On a phone with a full nav — the chips row, the
docs pill, the agent link, the journal sections — the list is taller than that
and the bottom entries are simply off-panel. Nothing says so: the cut is a
clean edge at the rounded border, and on iOS the overlay scrollbar is invisible
until the finger is already moving. A reader who does not think to try looks at
what appears to be the whole menu and concludes the option they wanted is not
there.

## Work

Show, in the panel itself, that there is more below — a small chevron or a
fade at the bottom edge, hidden once the panel is scrolled to the end. Prefer
what the platform already gives: `overflow-y: auto` plus a CSS mask or a
sticky pseudo-element beats a scroll listener with state. Whatever it is must
be decorative only (`aria-hidden`), since the panel is already a labelled
`nav` and the entries are all reachable by keyboard.

Not doing: any change to the max height, the entry list, or the desktop nav.

## Acceptance

At 390px, on a journal with enough sections that the panel overflows, the open
menu shows the affordance at its bottom edge; scrolling to the end removes it;
a short menu that fits never shows it at all.
