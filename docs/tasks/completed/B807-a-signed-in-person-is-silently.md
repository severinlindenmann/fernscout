---
id: B807
title: A signed-in person is silently signed out mid-task and told the journal is not theirs
type: ISSUE
priority: high
complexity: medium
area: agent, auth
found: "2026-09-07T15:16:56Z"
started: "2026-09-07T15:37:35Z"
merged: "2026-09-07T15:54:35Z"
completed: "2026-09-09T16:47:39Z"
---

# B807 — A signed-in person is silently signed out mid-task and told the journal is not theirs

## Why

A 23-year-old tester, mid-task on the live site on 2026-09-07, found his signed-in
session stop being recognised **twice**: the ask box began answering
`{"error":"not_your_journal"}` (a 404) a couple of minutes after working fine,
with nothing on screen saying he had been signed out.

> "I tap the ask box, it does nothing useful, I close the tab. I would not have
> thought to re-request a sign-in code — I'd have assumed the thing was broken,
> or that I broke it, and gone back to TikTok."

He named this the single worst moment in his test, and he is right about the
consequence: a person who believes they broke something does not come back.

**Two candidate causes, and this needs verifying before it is fixed:**

1. A real session problem — `isHelperOwner` calls `resolveAccess`, which reads
   the two cookies and re-checks the address against `owner.email` on every
   request. Something in that chain returned no email.
2. **I deployed twice during his run.** A restart should not invalidate a
   session — rows are in the database — but it is the obvious coincidence and
   has to be ruled out first rather than assumed innocent.

Whatever the cause, the *symptom* is a ticket on its own: `not_your_journal` is
the answer B779 already improved for a bearer token, and it is equally wrong
here. A person whose session has lapsed should be told their session lapsed.

## Work

Reproduce first: hold a helper session, restart the service, and see whether it
survives. If it does, look for an expiry or a race in `resolveAccess`.

Then, regardless: when a helper route refuses a request that carries no valid
session at all, the screen must say so and offer the way back in. Silence is
the part that lost this person, not the refusal.

## Acceptance

A lapsed session says it has lapsed and offers to sign in again. A service
restart does not sign anybody out.
