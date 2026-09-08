---
id: B990
title: The agent guide is over its own ceiling on main, so every branch fails verify at the same test
type: CHORE
priority: medium
complexity: low
area: agent guide
found: "2026-09-08T16:44:44Z"
started: "2026-09-08T19:11:44Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T19:11:44Z"
---

# B990 — The agent guide is over its own ceiling on main, so every branch fails verify at the same test

## Why

`npm run verify` fails on `main` as it stands:

```
FAIL test/agent-interface.test.ts > the agent guide stays within a ceiling
     that has to be argued past
AssertionError: expected 139868 to be less than 139264
```

`/agent.md` is 136.6 KiB against a 136 KiB ceiling — 604 bytes over. The test's
own name says what to do about it: the ceiling is there to be *argued* past,
not raised by whoever trips over it. Somebody grew the guide by a paragraph
and the number is now everybody's problem: a branch that has not touched the
guide fails at the same line, which is exactly the round-trip the ceiling was
meant to prevent.

Confirmed pre-existing: `git stash` on an unrelated branch gives the identical
139868.

## Work

Whoever last grew the guide decides which:

- The new prose earns its place — raise the ceiling in
  `test/agent-interface.test.ts` and say in the same commit what was added and
  why the guide is worth more bytes to the agent reading it.
- It does not — cut the paragraph rather than the ceiling.

Not a job for the next passer-by, which is why this is a ticket and not a
one-line fix on somebody else's branch.

## Acceptance

- `npm run verify` exits 0 on `main` with nothing else changed.

## Fixed — and what the fix does not answer

Raised to 144 KiB, with the argument in the test beside the number, which is
what its own comment asks of anybody who crosses it. Nothing was cut: nothing
in the guide is yet known to be spare, and trimming a document to fit a number
is how it stops saying the thing it was grown to say.

B993 and B998 are the same finding and are closed into this one. That three
sessions filed it within an hour and none fixed it is the part worth keeping:
a tripwire that only blocks is one every session reads as somebody else's
problem, and it stopped all three in turn.

**What is still true**: a ceiling raised by eight kilobytes whenever it is hit
is a budget, just a slower one. B311 is the structural answer, and its shape is
that what an agent needs on arrival and what it needs at the point of use are
two documents, only one of which has to be read in full.
