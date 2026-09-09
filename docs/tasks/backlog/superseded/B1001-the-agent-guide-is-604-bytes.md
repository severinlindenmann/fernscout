---
id: B1001
title: The agent guide is 604 bytes over its own ceiling, so verify fails on main
type: ISSUE
priority: medium
complexity: low
superseded: "B990 — the same red main, captured by four sessions that afternoon and fixed there."
area: Agent guide
found: "2026-09-08T17:15:45Z"
---

# B1001 — The agent guide is 604 bytes over its own ceiling, so verify fails on main

## Why

`test/agent-interface.test.ts:358` asserts `agentGuide()` stays under 136 KiB
and it is 139,868 bytes — 604 over. So `npm run verify` fails on `main` itself,
for everybody, on a change that touched nothing near it.

Measured at 03866976 (the b987-credits merge) with an unrelated branch's
changes both applied and reverted: the same 139,868 either way, so the guide
crossed the line under one of the merges landing that afternoon rather than
under any one edit.

The ceiling is deliberate and is meant to be argued past rather than raised on
sight — the guide is what an agent over the network has instead of the source,
and every kilobyte is one it has to read before it can do anything. Which is
also why a failing gate here is worse than it looks: the next session's honest
reading is that their own branch broke something.

## Work

Read what has been added since the ceiling last held and decide between the two
honest answers: cut 604 bytes of guide that is not earning its place, or raise
the number and say in the test why the guide is worth more than it was. Do not
raise it silently.

## Acceptance

- `npx vitest run test/agent-interface.test.ts` passes on `main`.
- If the ceiling moved, the test says what bought the extra kilobyte.
