---
id: B993
title: The agent guide is over its own byte ceiling on main
type: ISSUE
priority: medium
complexity: low
area: agent guide, tests
superseded: "B990 — the same finding, filed by three sessions within the hour"
found: "2026-09-08T16:45:14Z"
---

# B993 — The agent guide is over its own byte ceiling on main

## Why

`test/agent-interface.test.ts` — "the agent guide stays within a ceiling that
has to be argued past" — fails on `main`: `agentGuide()` renders 139,868 bytes
against a 136 KB ceiling. It fails with the working tree clean, so it is not
any one branch's doing; whichever change last grew the guide crossed the line
and merged anyway, and every session since has met a red suite it did not
cause.

The ceiling exists to make growth a decision rather than a drift, which is
exactly the conversation nobody has had here.

## Work

Find what grew (`git log -p lib/api/documentation.ts lib/api/agentCopy.ts`),
then either cut the guide back under the line or raise the ceiling with the
argument written beside it. Do not simply bump the number.

## Acceptance

`npx vitest run test/agent-interface.test.ts` green on a clean `main`.

## Superseded by B990

Three sessions hit the same red `main` and each filed a ticket for it: B990
first, then B993, then this one. None of them fixed it, which is the more
interesting half — a tripwire that only blocks, and that every session reads
as somebody else's problem, is a tripwire that stops everybody in turn.

Fixed under B990: the ceiling is 144 KiB with the argument written beside it,
and nothing was cut.
