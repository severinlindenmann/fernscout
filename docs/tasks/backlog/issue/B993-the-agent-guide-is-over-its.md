---
id: B993
title: The agent guide is over its own byte ceiling on main
type: ISSUE
priority: medium
complexity: low
area: agent guide, tests
found: "2026-09-08T16:45:14Z"
---

# B993 — The agent guide is over its own byte ceiling on main

## Why

`main` is red, and has been since before this ticket was written.
`test/agent-interface.test.ts:358` caps `/agent.md` at 136 KiB; it is now
139,868 bytes — 604 over. Confirmed pre-existing: the same byte count fails on
a clean `git stash` of an unrelated docs branch cut from `03866976`.

The ceiling is deliberate and the test says so — it is "a ceiling that has to
be argued past", because `/agent.md` is the whole of what an agent over the
network gets and a guide nobody finishes reading is a guide that does not work.
So the fix is a decision about the document, not a bigger number: either
something in it has earned its place and the ceiling moves with a reason
written beside it, or the guide has accumulated 604 bytes that a network agent
does not need.

Whoever merged past this did not run `npm run verify`, which is the actual
finding underneath.

## Work

Read `agentGuide()` and decide. Then either trim, or raise the constant with
the argument in the test's own comment.

Not doing: nothing about the ceiling's existence. It is doing its job.

## Acceptance

`npx vitest run test/agent-interface.test.ts` passes on `main`.
