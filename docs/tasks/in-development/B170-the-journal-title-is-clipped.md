---
id: B170
title: The journal's title is clipped in the header at exactly the width where the nav labels appear
type: ISSUE
priority: low
complexity: low
area: header, nav, ui
found: "2026-09-03"
started: "2026-09-04T06:22:43Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T06:22:43Z"
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

## The same thing, seen from outside: B212

**B212 is this bug** — captured independently while screenshotting the README,
on `/example/trips/parks-2025` at 1440 × 900, where the journal title renders as
"Ferns…" and the tagline as "Las Vegas …" with a screen's worth of empty space
to the right. It is in the README as `docs/screenshots/trip-story.jpg` and
`day-entry.jpg`. B170 carries the fix; B212 keeps the screenshot recapture,
which is its own acceptance line and needs the capture tooling.

Its evidence sharpens this ticket in one way the table above missed: B212
noticed that `/map` and `/gallery` show the title *in full* in the same space,
and concluded the trip-story header squeezes it. That reading is close but not
quite right, and the measurement below says why — the story page's day counter
is 144px of the difference, but the mechanism is the same on every page and
only shows up on the widest ones when the chips are wide enough to trigger it.

## Measured, in a real browser

`next start` on this branch's build, Chromium, `/example` (title "Fernscout
Demo", 140px at `sm:text-xl`), anonymous reader. `scrollWidth > clientWidth` on
the title element:

| page, viewport | title box, before | clipped? | title box, after |
| --- | --- | --- | --- |
| `/trips/parks-2025`, 1440 | **71px** for 140px | **yes** | 743px |
| `/trips/parks-2025`, 1280 | 23px (derived) | **yes** | 695px |
| `/`, 1440 | — | no | 792px |
| `/costs`, 1440 | — | no | 234px |

Swept after the change: widths 320, 375, 768, 1024, 1280, 1440, 1600 × locales
`en`, `de`, `hu` × pages `/`, `/costs`, `/trips/parks-2025`,
`/trips/parks-2025/map` — 84 measurements, **no title clipped, no nav clipped,
no page scrolling sideways** in any of them.

## Why it was 71px — the Why above is right about where and wrong about how

The ticket says the title "is squeezed to whatever is left". True, but the
reason it was left with 71px rather than the row wrapping is one property:
`flex-1` is `flex: 1 1 0%`, and that **zero is the flex base size** — the number
the browser sums to decide whether a row fits on one line. The title
contributed *nothing* to that sum, so the row always "fitted": 525px of chips
plus 660px of nav plus 24px of gaps is 1209 into a 1280px row, and the title was
handed the 71px remainder rather than the nav being moved to the second line it
has had since B44.

So this is not really "the `max-w-7xl` ceiling meets the `xl` labels". It is a
row that could never report itself as too narrow, whatever was in it.

## Work — what was built

`components/PageHeader.tsx`, two class changes:

- the title box is `flex-[1_1_12rem]` rather than `flex-1` — a real 192px base
  size, so the row is measured as 192 + 525 + 660 and does not fit;
- the nav's box gains `grow`, so when it takes the second line it fills that
  line and its own `justify-end` still puts the pills on the right.

`min-w-0` and `truncate` stay: a title longer than its box must still truncate
rather than push the nav off the row.

Of the three options in the original Work, this is the second — a floor on the
title, and the nav wraps. The other two were measured and rejected:

- **Letting the row grow past `max-w-7xl`** fixes 1440 and does nothing at 1280,
  where the viewport is already narrower than the cap. It also only ever buys
  enough room for *this* journal's title: at 1440 uncapped the title box comes
  out at 183px, so a journal named a little longer is clipped again.
- **Moving the labels to another breakpoint** moves the collision rather than
  removing it, which is what happened last time — the comment in `SiteNav.tsx`
  describes fixing this at 1024–1279 by moving them from `lg` to `xl`.

**The trade, stated plainly.** On the story page at desktop widths the header is
now two rows rather than one: 121px instead of 69px of sticky chrome. That is
the cost of the title never being clipped, and it is the direction B212 asks
for — the tagline gives first, the nav's line second, the journal's name last.
Pages without the day counter keep a single row wherever it fits (`/costs` at
1440 is one row, 69px).

## Evidence

- The sweep above, and a screenshot at 1440 × 900 of `/example/trips/parks-2025`
  showing "Fernscout Demo" and the full tagline with the nav on its own line.
- `test/page-header-title.test.tsx` — new. jsdom has no layout engine, so it
  cannot assert "not overflowing"; it holds the mechanism instead: the title box
  carries a real basis and not `flex-1`, keeps `min-w-0` and `truncate`, and the
  nav's box grows. That is the one line whose reversal brings the bug back.
