---
id: B812
title: Focus is lost when the handover prompt appears
type: ISSUE
priority: low
complexity: low
area: agent, a11y
found: "2026-09-07T15:23:19Z"
started: "2026-09-08T20:36:47Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T20:36:47Z"
---

# B812 — Focus is lost when the handover prompt appears

## Why

`components/AgentHandover.tsx:111-130` swaps the "Create a key" button for
`HandoverPrompt` the moment `mint()` succeeds. The button held focus; the new
block did not take it, so React unmounts the focused element and focus falls
back to `<body>`. B795 named this exact spot — `AgentHandover.tsx:107-124` —
as one of six places with the fault, but the fix that shipped for B795
(`f3e7791d`) touched `ConfirmPanel`, `AgentWizard`'s `setStep`, and the ask
box; it never reached this file. For a screen-reader user, pressing "Create a
key" reads as nothing happening — the twenty-minute credential is on screen,
read out to nobody, on the one page whose whole job is handing that credential
over correctly.

## Work

Gave `HandoverPrompt` the same treatment `ConfirmPanel` already has: a
`ref` on its wrapping `<div>`, `tabIndex={-1}`, and a `useEffect` that calls
`.focus()` once on mount. No new dependency, no focus-trap, no dialog role —
the block sits in the flow exactly as before, it simply now takes the focus
its predecessor held.

## Acceptance

- Pressing "Create a key" moves focus onto the block holding the minted
  prompt, not onto `<body>`. Verified in `test/helper-reach.test.tsx` (`B812 —
  the handover prompt takes focus when it replaces the button`): the test
  fails against the pre-fix component (focus stays on `<body>`) and passes
  after the `ref`/`tabIndex`/`useEffect` change.
- `npm run verify` is clean (build, tsc, eslint, vitest, knip).
- No `window.confirm`/`alert`/`prompt` introduced — `test/no-browser-dialogs.test.ts`
  is unaffected, since nothing here is a dialog.
- No new UI string, so no locale files touched.
