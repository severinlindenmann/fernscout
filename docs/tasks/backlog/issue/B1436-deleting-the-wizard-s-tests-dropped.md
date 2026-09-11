---
id: B1436
title: deleting the wizard's tests dropped the only coverage for PhotoPicker's localized label and sr-only clip
type: ISSUE
priority: low
complexity: low
area: helper
found: "2026-09-11T09:48:19Z"
---

# B1436 — deleting the wizard's tests dropped the only coverage for PhotoPicker's localized label and sr-only clip

## Why

Found while working B1239 (deleting the retired step-wizard's code).
`components/PhotoPicker.tsx` is **live** — `components/EditDay.tsx` and
`components/HelperRoom.tsx` both render it — but three of its tests only
ever rendered it *through* the now-deleted `AgentWizard`, and B1239 deleted
those test files along with the component because they imported it directly
and could not survive the deletion:

- `test/agent-picker-language.test.tsx` (B768) — asserted the picker draws
  its own `<label>` text in place of the browser's ("Dateien wählen" /
  "Keine Fotos gewählt" rather than English), and that the real `<input>` is
  `sr-only`-clipped rather than `hidden` or `display: none` (so it stays
  keyboard-reachable).
- `test/agent-express-day.test.tsx` (B780/B791) — asserted a first render's
  screen choice, which is wizard-only UI logic with no live equivalent
  (the express-day tap reduction was a property of the step-wizard's own
  state machine, not of `PhotoPicker` itself) — **not** a coverage gap, just
  noted here for completeness.

`test/agent-picker-kinds.test.ts` still covers `PhotoPicker`'s file-kind
counting and labelling directly (imports the component's own exports, not
through a wrapper), so that half of B768/B845 survived. The `sr-only`
clip and the localized "no files chosen" label specifically did not —
`grep -rn "sr-only\|Dateien wählen\|Keine Fotos gewählt" test/` after this
ticket finds nothing.

## Work

A test against `PhotoPicker` directly (the way `agent-picker-kinds.test.ts`
already does, not through a wrapping component) asserting:

- the input carries `sr-only` and not `hidden`/`display: none`
- the label text is drawn from `t()` rather than left to the browser's own
  "No file chosen"

## Acceptance

A test file (new, or added to `test/agent-picker-kinds.test.ts`) that fails
if `PhotoPicker` regresses to the browser's own English picker chrome, with
no dependency on any wizard component.
