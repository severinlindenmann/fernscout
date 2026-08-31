# W17 — Tests, accessibility, performance

**Roadmap:** J1–J6, TEST-1, PERF-1, SCALE-1, OPS-1 · **Depends on:** W02 · **Wave C**

## Goal
Close the measured problems in `TODO.md` §2 and build the safety net that makes
every other package safe to merge.

## Scope

### Tests (TEST-1)
Unit tests over `lib/entries.ts`, `lib/costs.ts`, `lib/trips.ts` parsing — these
have real logic and **degrade silently on a typo**. Playwright pass walking the
pager plus axe on every route.

### SCALE-1 — the home page grows with the trip
`buildSteps(days)` serialises **every** day into one client tree.
**Measured: ~11.4 KB/day → ~2 MB at 180 days.** Invisible today, unavoidable
later, and migrating live data mid-trip is exactly what we're avoiding.
→ Pass a window of days around `stepIndex`, fetch neighbours on demand.
`/day/<slug>` already exists as the server-side source.

### PERF-1 — nothing is route-split
All routes ship the same ~294 KB. `lib/worldLand.json` (62 KB) is a static
import in three client components, so the world outline downloads on `/costs`
where no map is drawn. → dynamic `import()` for land data, `next/dynamic` for
`SlideShow` (it's behind a button).

### J2 — accessibility for the actual audience
60+ readers on phones. Body ≥16px, tap targets ≥44px, contrast ≥4.5:1.
**`navy-500` carries too many jobs** — 11px metadata, 12px body, icon strokes,
disabled states, across three grounds; that's why contrast failed in eight
places at once. Add `navy-600` for anything under 13px.

### Carried in from W05

The currency switcher was verified server-side only — the chip renders, base
values are correct — but nobody has clicked it in a browser and watched the
`≈` values repaint. `crossRate`, `formatMoney` and the provider's `money()` are
unit-tested; the React re-render on switch is not. One Playwright assertion
closes it.

### J4, J5, J6
Slow-network/offline behaviour (you will be on 3G on a bus); reader error states
(expired session, revoked access, wrong password, deleted trip — currently 404s
or worse); timezone correctness (entry dates are local to where you were).

## Acceptance
- [ ] Unit coverage on all frontmatter parsers, including malformed input
- [ ] Playwright walks the pager; axe passes on every route
- [x] Home page payload **constant** as day count grows (test with 200 days)
- [x] `/costs` does not download map data
- [x] Contrast audit passes at every size
- [x] Every reader error state has a real page

## What J2/J4/J5/J6 actually landed

Contrast and size (J2)
: `navy-600` added and used for all text; `navy-500` demoted to borders and
  decorative icons. Light accents (`sky-500`, `blue-500`, `yellow-600`) removed
  as text and focus rings — the accent moves to an underline or a fill, the
  words go dark. Tap targets raised to 44px tall across the header, pager, hero,
  gallery filters, map controls, reactions and the per-day cost chart, whose
  bars were 2px tall. `test/contrast.test.ts` locks the palette's guarantees to
  arithmetic and greps for regressions.

Reader error states (J5)
: `app/not-found.tsx`, `app/[user]/not-found.tsx`, `app/error.tsx`,
  `app/global-error.tsx`, `app/offline/page.tsx`, and a real page behind an
  expired contact link and a non-owner arriving at `/contacts`. The password
  gate now distinguishes "never let in" from "was let in, and the password
  changed". All in de/en/hu through `NoticeShell`.

Timezone (J6)
: `lib/tripTime.ts`. Two calendars, deliberately: content visibility asks "has
  this day begun anywhere" (UTC+14, never hides published work) and countdowns
  ask the reader's own device. Replaces three copies of
  `new Date().toISOString().slice(0, 10)`, which was nobody's calendar.

Slow network (J4)
: Service worker v2 — timeout on navigations, stale-while-revalidate for the
  pager's JSON, a fallback chain that ends at a real page, a bounded runtime
  cache. What was not cheap is written down in `TODO.md` §2 under J4.
