---
id: B291
title: The day markdown twins are the one agent-facing route the request log does not cover
type: CHORE
priority: low
complexity: low
area: operations, logging
found: "2026-09-04T13:12:24Z"
started: "2026-09-07T11:06:10Z"
merged: "2026-09-07T11:21:24Z"
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

## Work done

Confirmed the twins were genuinely uncovered: `/<user>/day/<slug>.md` and
`/<user>/trips/<trip>/day/<slug>.md` are the actual browser-facing URLs
(rewritten to `/api/md/...` in `next.config.ts`, but `proxy()` runs on the
pre-rewrite pathname), and the general matcher's extension exclusion
(`.*\.(?:txt|json|xml|md|png|svg|ico)$`) strips anything ending `.md` before
any of the explicit doc entries get a chance — there was no other `/:user/...`
entry that would have caught them.

Added four explicit matcher entries to `proxy.ts`, mirroring the two-pattern
convention `next.config.ts`'s own rewrites already use for these paths (a bare
`:slug.md` param and a `:slug([^/]+)\.md` regex form, because a param stops at
the first `.` and a slug is not guaranteed not to contain one):

```
"/:user/day/:slug.md",
"/:user/day/:slug([^/]+)\\.md",
"/:user/trips/:trip/day/:slug.md",
"/:user/trips/:trip/day/:slug([^/]+)\\.md",
```

Checked the rest of AGENTS.md's network-doors table while there: every other
agent-facing document (`/documentation.txt`, `/<user>/documentation.txt`,
`/agent.md`, `/api/:path*`) was already in the matcher from B257's tombstone
work; every reader-facing page (`/<user>/postcards/<id>`, the two invite
pages) falls under the general catch-all pattern already, since none of them
end in an excluded extension. Nothing else needed covering.

Tests added to `test/request-log.test.ts`: one calls `proxy()` directly against
both twin URLs with logging on and asserts the log line contains the full
path; the other reads `proxyConfig.matcher` (compile-time, so it cannot be
exercised by invoking `proxy()` alone — same reasoning as the pre-existing
"still excludes build assets" test right below it) and asserts it contains all
four new patterns. `npm run verify` passed.
