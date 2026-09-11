---
id: B431
title: The landing page could be widened past the phone by one URL
type: ISSUE
priority: medium
complexity: low
area: app/layout.tsx, components/LandingSections.tsx
found: "2026-09-05T11:46:20Z"
merged: "2026-09-05T11:46:20Z"
completed: "2026-09-11T00:00:00Z"
---

# B431 — The landing page could be widened past the phone by one URL

## Why

This file was never committed alongside the work it should have described.
Commits `26e40562` ("B431: the landing page could be widened past the phone
by one URL", merged in `ec8e1c7f`) fixed a real bug and cite `B431` in four
places that survive today — `app/layout.tsx:124`, `app/docs/api/page.tsx:77`,
`components/LandingSections.tsx:497` and `test/mobile-overflow.test.ts:6` —
but no task file was ever committed. Found during the B1052 sweep for
orphaned task-id citations.

`body` is a column flex container, so `main` is a flex item with the default
`min-width: auto`, which refuses to shrink below its min-content width. The
agent instruction carries two unbreakable strings — the documentation and
`/agent.md` URLs — so min-content was roughly 365px of monospace against
roughly 277px of usable width on a 375px phone, and that became a floor under
the width of the whole document. Every paragraph was clipped on the right and
the page scrolled sideways; it showed on some phones and not others because
it depends on the viewport and on how long the sentence is in the reader's
language.

`break-words` (`overflow-wrap: break-word`) wraps the rendered line and
leaves min-content width alone, so it looked like the right class and fixed
nothing. `overflow-wrap: anywhere` wraps identically and does lower
min-content.

## Work

- `app/layout.tsx` — `min-w-0` added to `body`, which protects every page
  from the next long unbreakable string rather than only this one.
- The three other long-string sites (including in `LandingSections.tsx`) use
  `break-all`, which already contributes to min-content sizing, so they were
  never affected and needed no change.
- `test/mobile-overflow.test.ts` — added, asserting the page cannot grow
  wider than the phone.

Not doing: renumbering. The id was allocated correctly; the file was simply
never committed.

## Acceptance

`test/mobile-overflow.test.ts` passes.
