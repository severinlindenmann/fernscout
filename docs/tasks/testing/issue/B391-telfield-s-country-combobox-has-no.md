---
id: B391
title: TelField's country combobox has no jsdom test for keyboard/mouse interaction
type: ISSUE
priority: low
complexity: low
area: contacts, i18n
found: "2026-09-04T22:25:51Z"
started: "2026-09-07T11:40:41Z"
merged: "2026-09-07T12:37:28Z"
---

# B391 — TelField's country combobox has no jsdom test for keyboard/mouse interaction

## Why

B390 replaced `TelField`'s bare `<select>` of dial codes with a searchable
combobox (`components/TelField.tsx`) — a text box, an open/close listbox,
arrow keys, Enter, Escape, click-outside-to-close. None of that interaction is
exercised by a test: this checkout runs vitest in the `"node"` environment
(`vitest.config.mts`), with no `jsdom`/`happy-dom` and no
`@testing-library/react` installed, so `test/tel-field.test.ts` can only test
the pure functions pulled out of the component (`filterCountries`, `flagOf`,
`splitTel`/`joinTel`) and `test/contact-tel-hint.test.tsx` only proves the
component renders via `renderToStaticMarkup` — no click, no keydown, no focus.
The four things B390's Acceptance section actually asks for by name —
filtering as you type, arrow-key/Enter/Escape operation, and that picking a
country writes the right `cc` — are verified by hand only, not by a test
nobody runs but a person.

## Work

Either add a DOM testing environment (`jsdom` or `happy-dom` as a vitest
environment for this one file, plus `@testing-library/react` or a hand-rolled
DOM harness) and a `test/tel-field-combobox.test.tsx` that types into the
box, asserts the filtered listbox, and drives Enter/Escape/arrow keys — or, if
that dependency is judged not worth it for one component, write the case for
why manual verification is enough here and say so on this ticket rather than
leaving the gap silent. Not doing: converting the whole suite to `jsdom` —
that is a much bigger change than one component's interaction test needs.

## Acceptance

A test exists that renders `TelField`, types a filter string, and asserts the
listbox narrows to the matching countries; and a test that drives Enter (or
Escape) with a keyboard event and asserts the resulting `onChange` call — or
this ticket is closed as `superseded` with the reasoning for skipping it
written here, not just decided silently.

## Triage

The Why section is stale on one point: `jsdom` (and `@types/jsdom`) are
already devDependencies (`package.json`), and per-file `// @vitest-environment
jsdom` is already in use — `test/address-lookup-field-a11y.test.tsx` (B419)
runs a real DOM via `createRoot`/`act` with no `@testing-library/react`,
following on from what the AGENTS.md-referenced B507 harness apparently
established. So the dependency question this ticket raised is already
answered in the affirmative elsewhere in the tree; this ticket just needed
`TelField` to get its own file in that style.

## Done

Added `test/tel-field-combobox.test.tsx`, reusing the exact harness pattern
from `test/address-lookup-field-a11y.test.tsx` (`@vitest-environment jsdom`,
`createRoot` + `act`, no new dependency). Seven tests: focusing opens the
unfiltered list; typing "Switzerland" narrows the listbox to one option
showing "+41"; Enter on the highlighted (first) option picks it and closes the
list; ArrowDown then Enter picks the second filtered row rather than the
first; Escape closes without picking anything; clicking an option (via
`mousedown`, matching the component's own use of `mousedown` over `click`)
picks it; and clicking outside the field closes the list. All seven pass:
`npx vitest run test/tel-field-combobox.test.tsx` → 7/7.

Acceptance met without the `superseded` fallback — the filter-as-you-type and
Enter/Escape cases both landed.
