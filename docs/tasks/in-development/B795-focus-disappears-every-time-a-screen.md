---
id: B795
title: Focus disappears every time a screen changes
type: ISSUE
priority: high
complexity: medium
area: agent, a11y
found: "2026-09-07T14:55:05Z"
started: "2026-09-07T15:09:32Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-07T15:09:32Z"
---

# B795 — Focus disappears every time a screen changes

## Why

At least six places swap a control for new content and leave focus on `<body>`:
the ask box opening (`HelperAsk.tsx:158-168`), every `ConfirmPanel` mounting
where its button was (`AgentWizard.tsx:980-988, 1066-1074, 1196-1205`,
`RecordButton.tsx:220-234`, `HelperAsk.tsx:220-230, 245-282`), the handover
prompt (`AgentHandover.tsx:107-124`), and **every wizard step advance** —
`create()`, `save()` and `publish()` all call `setStep()`, which replaces the
whole `<section>`.

For a screen-reader user the effect is that pressing a button appears to do
nothing: the button vanishes, focus falls to the top of the document, and
there is no announcement of what replaced it. They have to explore from the
beginning to discover whether anything happened.

This is not a small politeness. A wizard is a sequence of exactly these
transitions, so the fault is on every step of the main flow.

Found by a blind tester on the live site, 2026-09-07.

## Work

On each transition, move focus to the heading of what just appeared —
`tabIndex={-1}` on the `h2`/`h3` and a `ref.focus()` — so the screen reader
reads the new section. Do it on `setStep`, on a `ConfirmPanel` mounting, and on
the ask box opening.

`ConfirmPanel` is the one worth doing properly and once: it is the codebase's
answer to every question, so give it the focus move, and check whether it
should also be a dialog with a labelled heading and an escape.

## Acceptance

Pressing a control that replaces itself announces what replaced it, on every
wizard step and every confirm panel.
