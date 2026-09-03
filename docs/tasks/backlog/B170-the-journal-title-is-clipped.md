---
id: B170
title: The journal's title is clipped in the header at exactly the width where the nav labels appear
type: ISSUE
priority: low
complexity: low
area: header, nav, ui
found: "2026-09-03"
---

# B170 — The journal's title is clipped in the header at exactly the width where the nav labels appear

## Why

Measured while building B44, in a real browser against `next start`, on
`/example` with an anonymous reader:

| viewport | journal title box | overflowing its own box? |
| --- | --- | --- |
| 1024–1279 (en) | 140px | no |
| **1280 (en)** | **99px** | **yes** |
| 1440 (en) | 140px | no |
| **1280 (de)** | **64px** | **yes** |
| **1440 (de)** | **112px** | **yes** |

`components/PageHeader.tsx` gives the title `min-w-0 flex-1` and `truncate`, so
it never breaks the layout — it just quietly loses characters. At 1280 the
header's row hits its `max-w-7xl` ceiling at the same moment `SiteNav`'s labels
turn on at `xl`, and the two together take the row's whole width; the title is
squeezed to whatever is left and truncates. On a German journal at 1280 that is
64px, roughly four characters of somebody's name.

This is pre-existing and independent of B44 — the same measurement run against
the pre-B44 drawing of the nav gives a *wider* nav in all three locales (en
660px vs 633, de 687 vs 682, hu 755 vs 700), so the change made the squeeze
slightly less bad rather than causing it. The comment at
`components/SiteNav.tsx` describes fighting exactly this at 1024–1279 and
moving the labels from `lg` to `xl` to fix it; the same collision simply moved
up to 1280 and was not re-measured there.

## Work

Measure first — the numbers above are one journal at one title length, and the
threshold depends on both. Then decide between: letting the header row grow
past `max-w-7xl`, giving the title a `min-w` floor and letting the nav wrap (it
now wraps, since B44), or moving the labels to a width where both fit.

**Not doing:** anything about the phone layout, which is fine — the title has
its own line there.

## Acceptance

- At 1280 and at 1440, in all three maintained locales, the journal's title
  element is not overflowing its box (`scrollWidth <= clientWidth`), on a
  journal whose title is at least as long as the demo's.
- The nav is not clipped at any width from 320 up, in all three locales.
