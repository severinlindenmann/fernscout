---
id: B779
title: A valid token on a helper route is told the journal is not theirs
type: ISSUE
priority: low
complexity: low
area: agent, api
found: "2026-09-07T14:23:38Z"
---

# B779 — A valid token on a helper route is told the journal is not theirs

## Why

Sending a **valid** agent token for the right journal to a helper route —
`POST /api/helper/<user>/consent`, `/ask` — returns `404
{"error":"not_your_journal"}`.

The refusal is correct: helper routes are cookie-only by construction and never
read `Authorization`. The *message* is not. It tells the caller they do not own
a journal they demonstrably do own, and says nothing about the actual problem,
which is that this family of routes does not accept tokens at all.

The 404-rather-than-401 is deliberate and should stay — a helper URL must not
confirm whose journal it is. But the body can be honest without confirming
anything, because the caller has already proved who they are.

Found live on 2026-09-07 by a technical user who held a working token.

## Work

When a helper route is reached with an `Authorization` header, answer with a
body that names the real cause and the remedy — this family takes a signed-in
browser session only; use `/api/v1/<user>/…` with that token instead. Keep the
status as it is.

B712 is already open on documenting the helper family in `/agent.md`; this is
the same explanation, delivered at the moment somebody needs it.

## Acceptance

A bearer token on a helper route gets a message that sends the caller to the
right door.
