---
id: B770
title: The journal header takes four stacked rows on a phone before any content starts
type: FEATURE
priority: high
complexity: medium
area: header, mobile, a11y
found: "2026-09-07T16:15:00Z"
started: "2026-09-07T14:07:48Z"
merged: "2026-09-07T14:34:45Z"
---

# B770 — The journal header takes four stacked rows on a phone before any content starts

## Why

The owner, looking at a real journal on a phone: *"the header for the menu
feels a bit big and not so nice on mobile — rework the header to be more sleek
and UX/UI friendlier."*

This is **J9 in `docs/ROADMAP.md`**, which has been open since W17 and already
names the remedy: *"the top bar takes two rows on a phone… the fix is a mobile
menu behind one button, which is a design decision."* It has got worse than
that entry describes. On a 390px screen the header now stacks **four** rows
before a single word of the journal appears:

1. a back link — "Deine Reisetagebücher"
2. the journal title
3. three chips — the trip switcher, the currency, the language
4. seven navigation icons

J9 measured 121px of sticky header where 61px was intended; four rows is more
again. On a phone that is a quarter of the viewport spent on chrome, above
content this audience came to read — and the same page also carries a fixed
day-navigation bar at the bottom, so the actual reading window is smaller
still.

J9 also records the tap-target problem, which must not survive this rework:
the icons are 36×44. That clears WCAG 2.2's 24px floor and not the 44px this
audience wants — readers past sixty, on a phone, often outdoors.

## Work

**The shape.** One row on a phone: back, the journal's name, and a single menu
button. Everything else — the trip switcher, currency, language, and the seven
destinations — moves behind that button into a panel. The current arrangement
stays at `sm:` and up, where it fits and is good.

Two things to get right rather than assume:

- **Say where you are.** Collapsing seven icons into one button loses the
  current section, which the highlighted icon is carrying today. The row has
  space for it once the chips are gone — the section's name beside the
  journal's is the obvious answer, but decide it deliberately.
- **The bottom bar is taken.** A bottom tab bar is the phone-native answer and
  is not available: the day pages already carry a fixed bottom navigator
  ("Basel · 22 Jun · Tag 1 von 9 · Weiter →"). Two fixed bars would leave
  almost nothing. This is why the menu goes in the top row.

**The panel.** Not a `window.confirm`, not a browser dialog — B633 and B668
are emphatic and `test/no-browser-dialogs.test.ts` enforces it. A panel in the
flow, dismissible with Escape and by tapping outside, focus moved into it on
open and returned to the button on close, and every row in it at least 44px
tall.

**Keep the brand.** `apply-the-brand`: tokens only, six hues, `yellow-600` is
never text on cream, focus stays `blue-500`. The header currently marks the
active section with a `yellow-400` disc — whatever replaces it should still
read as the waymark rather than as a new idiom.

Not doing: the bottom day-navigator, the desktop header, or any change to what
the destinations are. This is the arrangement on a phone and nothing else.

## Acceptance

- At 390px the header is one row, and its height is at most half what it is
  today. State the before and after in pixels, measured.
- Every interactive thing in the header and the panel is ≥44px.
- The current section is identifiable without opening the panel.
- The panel opens and closes by keyboard alone, Escape closes it, and focus
  returns to the button.
- No browser dialog. `test/no-browser-dialogs.test.ts` still passes.
- Checked on a day page (which also has the bottom bar), the trips index, and
  the gallery — at 390px.
- `docs/ROADMAP.md` J9 is updated to say it is done, or why it is not.

## Result

Built in `.claude/worktrees/b770-mobile-header`, branch `b770-mobile-header`.

**The plan, decided before building.** Below `sm`, `PageHeader` renders a
second, simpler row instead of the four-row stack: back (icon-only), the
journal's title, a non-interactive badge carrying the current section's icon,
and a menu button. Everything the old chips-and-nav rows carried — the trip
switcher, currency, language, and the seven destinations — moves into a panel
that opens below the row when the button is pressed. `sm` and up render the
exact markup the header already had; nothing there changed.

**The current section.** Kept the existing idiom rather than inventing one:
the same `yellow-400` disc the tab bar already uses for "you are here", now
also drawn as a small standalone badge (`role="img"`, `aria-label` from the
same translated string) next to the title. It reads the same active-state
computation the tab bar does — `useNavEntries()`, pulled out of `SiteNav.tsx`
so both draw from one answer rather than two that could disagree. The badge
is not a link: tapping the current page's own icon to navigate to the page
you are already on had nothing to do, so it is excluded from the ≥44px
requirement by being non-interactive rather than by being undersized.

**The panel.** Built as `ConfirmPanel` argues a confirmation should be: in the
flow rather than over it (`aria-modal="false"`, no backdrop dimming the page),
closed by Escape or a tap outside — the same `ref` + `mousedown`/`keydown`
pattern `TripSwitcher`, `CurrencySwitcher` and `LocaleSwitcher` already use,
scaled from a small anchored dropdown to a full-width panel. Two things this
ticket asked for beyond what those three do: focus moves into the panel
(`panelRef.current.focus()`, `tabIndex={-1}` on the container) when it opens,
and returns to the menu button on every way it closes — Escape, an outside
tap, or a link tapped inside it. The outside-tap case needed
`e.preventDefault()` on the closing `mousedown`: without it the browser's own
default focus-change for that same click lands *after* the panel's effect has
already sent focus back to the button, and wins, leaving focus on whatever
page content happened to be under the tap. Caught by a Playwright script
before it reached the report — see below.

Deliberately did not animate the panel open/close. The ticket allowed either;
an entry/exit transition needs a two-phase mount (visible after the state
change, unmounted only after the transition ends) to animate the close, which
is real complexity for something the acceptance criteria do not ask for.
`prefers-reduced-motion` is therefore moot here — nothing animates to reduce.

**`SiteNav.tsx`.** Refactored rather than duplicated: `useNavEntries()` now
computes the seven destinations, their hrefs and their active state once, and
`SiteNav` draws them one of two ways — `variant="bar"` (default, unchanged
pixel-for-pixel from before this ticket, and what `sm` and up still mount) or
`variant="list"` (new: full-width 48px rows, label always visible, used only
inside the mobile panel). One array, two renderers, rather than a second copy
of the active-state logic living in `PageHeader.tsx`.

**Two new translation keys** — `nav.menu` ("Menu") and `nav.closeMenu`
("Close menu") — added to all three shipped locales and regenerated into
`lib/i18n.ts` with `npm run i18n:keys`.

**Measured**, 390×844, `/example` (Chromium via Playwright, reduced motion off
where it mattered — the panel does not animate, so it did not matter here):

| | Before (per J9's own numbers) | After, measured |
| --- | --- | --- |
| Header height, closed | 121px (four rows by the time this was filed) | 65px — a 46% cut, under the "at most half" bar |
| Menu button | — | 44×44 |
| Back link (icon-only) | — | 44×44 |
| Trip / currency / language chips (in panel) | 36–44 tall | 44 tall (60×44, 65×44, 56×44) |
| Nav rows (in panel, `list` variant) | 36×44 | 332×48 |

Keyboard/focus, scripted and confirmed: Tab to the menu button, Enter opens
the panel and moves focus into it; Escape closes it and returns focus to the
button; a tap outside the header closes it and returns focus to the button
(after the `preventDefault` fix above); tapping a nav link inside the panel
closes it and navigates. `test/no-browser-dialogs.test.ts` passes unchanged —
nothing here is a `window.confirm`/`alert`/`prompt`.

**Screenshots** taken and read back, closed and open, on a day page (with the
bottom day-navigator still in place and unaffected), `/example/trips`, and
`/example/gallery`. All read correctly: single row, badge showing the right
section per page, panel listing all six destinations plus the three
switchers, active row highlighted.

**Tests touched.** `test/page-header-title.test.tsx`'s `titleBoxClasses()`
matched the title box by DOM position, which broke once a second, simpler
title box exists ahead of it for the phone layout; changed it to match on the
`flex-[1_1_…]` basis instead, which is unique to the `sm`-and-up box the test
is actually about. `test/site-nav.test.tsx` needed no changes — the default
`bar` variant is byte-for-byte what `SiteNav` always rendered.

`npm run verify` — build, `tsc`, `eslint`, `vitest` — passed clean: 366 test
files, 4616 tests passed, 3 skipped (Postgres-only, unrelated). Only
pre-existing eslint warnings (unused vars elsewhere in the tree), zero errors.

`docs/ROADMAP.md` J9 updated to **Done — B770**, with the same before/after
numbers.

Nothing found while building that was not already this ticket's scope.

## Checked before merge

Measured independently at 390px on `/example`, rather than taken on report:

| | |
| --- | --- |
| header, closed | **65px** (was 121px) |
| header, panel open | 480px |
| Escape | closes, and focus returns to the menu button |
| `scrollWidth` | 390 — no sideways scroll |

**One acceptance line was not met and is now fixed.** The journal title in the
mobile row is a `<button>` (it calls `onHome`), and it measured 274×**28** —
interactive, and under the 44px floor this ticket set for itself. Everything
the rework *added* cleared 44; the title was inherited and kept its old text-
sized box. It now carries `min-h-11` and centres its text, which changes
nothing visually and gives it the hit area the rest of the row has.

After that, the only element in the header under 44px is the "Skip to content"
link at 1×1 — the standard visually-hidden skip target, which becomes full
size on focus. That is correct and is not a violation.
