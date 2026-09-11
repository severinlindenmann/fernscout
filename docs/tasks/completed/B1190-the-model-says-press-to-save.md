---
id: B1190
title: The model says 'press to save' on a turn that drew no button
type: ISSUE
priority: medium
complexity: medium
area: helper
found: "2026-09-09T21:26:16Z"
started: "2026-09-09T21:26:48Z"
merged: "2026-09-09T21:33:49Z"
---

# B1190 — The model says 'press to save' on a turn that drew no button

## Why

Persona round (Jonas): after a second sentence merged into the draft, the
model answered "It's still a draft. Press to save, or tell me if you want
to change anything" — and the turn carried no proposal, so there was
nothing to press. The existing net caught the *next* turn's false "saved"
honestly, but the instruction to press a nonexistent button is itself a
claim about the turn that the server can check: whether a proposal was
drawn is known exactly.

## Work

A check in lib/helper/model.ts's net, in its four-part shape: matcher for
press/button/save-this instructions, condition "this turn proposed
nothing", one retry telling the model no card is on the screen, and a plain
fallback sentence. Careful per AGENTS.md: it must not fire on honest turns
that reference an earlier, still-pressable card — scope the matcher to
imperative press-instructions about *this* turn.

## Acceptance

A scripted turn whose text says "press to save" while proposing no tool is
retried, and the fallback never instructs a press; existing honest
proposal turns pass unchanged (vitest beside the other net checks).
