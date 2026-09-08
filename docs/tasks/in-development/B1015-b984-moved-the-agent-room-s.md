---
id: B1015
title: B984 moved the agent room's URL and left one test asserting the old one, so main is red
type: ISSUE
priority: high
complexity: low
area: Tests
superseded: "The session that made the change was already fixing it — their edit was in the checkout within the minute."
found: "2026-09-08T19:05:00Z"
started: "2026-09-08T19:05:42Z"
session: b8352d66-3105-4f5d-a703-f8809d0b08e6
claimed: "2026-09-08T19:05:42Z"
---

# B1015 — B984 moved the agent room's URL and left one test asserting the old one, so main is red

## Why

B984 ("`/agent` is the room") changed where the owner's day-page links go, and
said so in `components/OwnerTools.tsx:103`:

> B984 — one URL, and the day rides as `about`. The room no longer lives at a
> path carrying the journal's name.

`test/helper-ask-on-the-day.test.tsx:163` still expects the old one:

```
Expected: "/agent/alex/chat?trip=reise-2026&slug=bellinzona"
Received: "/agent?about=reise-2026%2Fbellinzona"
```

The component is right and the assertion is stale. Found running `npm run
verify` on `main` before a deploy, immediately after the B984 merge landed
(81d02ba3) — the second red `main` in an hour, both from merges that were green
on their own branch.

## What happened

Captured and immediately stood down: the B984 session had the corrected
assertion open in the shared checkout before this ticket was written. Left to
them rather than raced. The capture stays because the shape is worth the
record — two red `main`s in an hour, both from merges that were green on their
own branch, which is what a worktree cannot show you.

## Work

Update the assertion to the URL the component now builds, and let it assert the
*shape* B984 chose — one path, the day as `about` — rather than restating a
string, so the next move of that URL fails in one place with a readable
message.

## Acceptance

- `npx vitest run test/helper-ask-on-the-day.test.tsx` passes on `main`.
- `npm run verify` is green on `main`.
