---
id: B291
title: The day markdown twins are the one agent-facing route the request log does not cover
type: CHORE
priority: low
complexity: low
area: operations, logging
found: "2026-09-04T13:12:24Z"
---

# B291 — The day markdown twins are the one agent-facing route the request log does not cover

## Why

Found by B257's agent while widening the proxy matcher, and left alone rather
than folded in.

The point of B257's matcher choices was that every door an agent uses gets
logged: `/api/:path*`, `/agent.md`, `/documentation.txt`, and — already there
from a pre-existing tombstone entry — `/<user>/documentation.txt`. The one
shape missed is the markdown twins:

- `/<user>/day/<slug>.md`
- `/<user>/trips/<trip>/day/<slug>.md`

They are `lib/api/markdownTwin.ts`, they are in the network-doors table in
AGENTS.md, and they are exactly what an agent reads to check its own work.
So the single most likely question — *did the agent read the day back before it
told somebody it was ready?* — is the one the log cannot answer.

Small, and worth doing while the reasoning is fresh rather than in six months
when somebody wonders why one route type is missing.

## Work

Add the two shapes to the matcher in `proxy.ts`, and check the same widening
argument B257 made for `/api/`: a path that now runs the proxy for the first
time must not start paying for tombstone or locale work it does not need.
The twins sit under `/<user>/`, which the matcher may already cover for
tombstone purposes — establish that first, because if they are already matched
then they are already logged and this task is only a test.

Check the same question for any other route in AGENTS.md's network-doors table
while you are there, and either cover it or say why not.

## Acceptance

A `GET /<user>/day/<slug>.md` appears in the log with logging on, and a test
asserts the matcher covers both twin shapes.
