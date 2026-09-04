---
id: B391
title: TelField's country combobox has no jsdom test for keyboard/mouse interaction
type: ISSUE
priority: low
complexity: low
area: contacts, i18n
found: "2026-09-04T22:25:51Z"
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
