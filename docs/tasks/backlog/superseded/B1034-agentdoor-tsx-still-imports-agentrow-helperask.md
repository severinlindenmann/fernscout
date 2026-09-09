---
id: B1034
title: AgentDoor.tsx still imports AgentRow, HelperAsk, AgentHandover and LOW_CREDITS from the journal card B984 removed
type: CHORE
priority: low
complexity: low
area: components/AgentDoor.tsx
superseded: "B1033"
found: "2026-09-08T21:20:27Z"
---

# B1034 — AgentDoor.tsx still imports AgentRow, HelperAsk, AgentHandover and LOW_CREDITS from the journal card B984 removed

## Why

Found while validating B1009. B984 (`Merge B984: /agent is the room, and it
opens by saying what is there`) rewrote `app/agent/page.tsx` so a signed-in
owner whose journal has `helper` on renders `HelperRoom` directly and never
reaches `AgentDoor` at all. `AgentDoor.tsx` is now only the signed-out /
no-journal door, but it still imports `AgentRow`, `HelperAsk` and
`AgentHandover`, still declares the `LOW_CREDITS` constant, and its own
docstring (lines 58-69) still describes the per-journal card ("each owned
journal gets its own card: a heading naming it, one bright button... then the
ask box, quietly, then whatever else is unfinished... `AgentHandover`") that
no longer exists in the code beneath it.

`npx eslint components/AgentDoor.tsx` confirms 8 unused-var warnings (0
errors): `Link`, `AgentHandover`, `AgentRow`, `HelperAsk`, `LOW_CREDITS`,
`siteUrl`, `tn`, `formatLongDate` are all dead. It costs nothing today —
`no-unused-vars` is a warning, not an error, so `npm run verify` stays green
— but the docstring actively describes behaviour that has been gone since
B984, which is exactly the kind of doc drift AGENTS.md warns against, and the
dead imports are noise for the next person trying to understand what
`AgentDoor` actually draws.

## Work

Trim `AgentDoor.tsx` to what it now does: drop the unused imports
(`AgentRow`, `HelperAsk`, `AgentHandover`, `Link` if unused, `LOW_CREDITS`),
drop unused destructured props/values (`siteUrl`, `tn`, `formatLongDate`) or
wire them up if they were meant to be used, and rewrite the docstring's
"Signed in" paragraph to describe the current no-journal-card behaviour
instead of the one B984 removed. Also check whether `AgentJournal` (exported
from this file, still referenced by `test/agent-short-consent.test.tsx`) is
still an accurate shape for anything, or is itself a leftover.

## Acceptance

`npx eslint components/AgentDoor.tsx` reports no unused-var warnings, and the
component's doc comment matches what the JSX actually renders.
