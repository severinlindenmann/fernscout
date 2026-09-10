---
id: B1243
title: A pressed write is not known to the model, which asks for it again
type: ISSUE
priority: high
complexity: medium
area: whatsapp, helper, ux
found: "2026-09-10T08:48:07Z"
---

# B1243 — A pressed write is not known to the model, which asks for it again

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Owner's walkthrough: photos were attached to the day by a button press, and a
later model turn asked to add them again — the press's outcome is not
reaching the model's context, so it re-proposes work already done.

## Work

Investigate: the press path (lib/whatsapp/proposalExecution.ts) runs the
route under runAsCaller and the route calls wrote(); wrote() folds onto the
NEXT user message as a note. Find where that chain drops the fact (wrong
session? note written but not read? press path skipping wrote entirely?) and
fix so the model's next turn knows what was pressed and what it did.

## Acceptance

After an accepted press, the very next model turn's folded context contains
the written outcome, proven by a test reading what the model would be handed.
