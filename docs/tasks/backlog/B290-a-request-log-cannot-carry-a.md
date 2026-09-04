---
id: B290
title: A request log cannot carry a status or a duration without replacing next start
type: FEATURE
priority: low
complexity: high
area: operations, logging
found: "2026-09-04T13:12:24Z"
---

# B290 — A request log cannot carry a status or a duration without replacing next start

## Why

B257 asked for method, path, status, duration, response size and user agent.
It shipped method, path and user agent, and the missing three are not an
oversight — they do not exist at the point the log is written.

`proxy.ts` is Next's middleware, and middleware runs **before** the request is
completed. B257's agent established this empirically rather than from the
documentation: `after()` called from inside the proxy resolved in 1–7ms while
the real response took 1.6–1.8s. So there is no status to read, no duration to
measure and no body size to count; the response has not happened yet.

Getting them means a hook inside every route handler — which is the "a call per
handler" B257's own Work section ruled out, and which would be wrong for the
same reason: a hundred call sites that must each remember to log, and a silent
gap wherever one does not.

The real alternative is a custom `server.js` in front of Next instead of
`next start`, wrapping the Node request/response so the log is written when the
response finishes. That is an architectural change to how this thing boots, it
changes what `scripts/deploy.sh` restarts, and it is a new failure surface in
the one process that serves every page.

**What was lost is worth stating precisely, because it is less than it sounds.**
The two diagnoses that motivated B257 are both still answerable: *did the
fetcher arrive* (B256 — method, path and user agent say so) and *what touched
these fifteen days* (B266 — a `POST .../publish` is now a line). What is gone
is *what did we answer* — a 404, a 403 or a 500 looks identical to a 200 in
this log.

## Work

Not decided, and the first task is to decide whether it is worth it at all.
Weigh a custom `server.js` against what status codes would actually have
bought in the failures this project has really had — so far, none of them.

If the answer is no, the outcome of this task is that sentence written into
`docs/runbook.md` beside the logging section, so the next person who notices
the gap finds the reasoning instead of rediscovering the constraint.

If the answer is yes, read `docs/runbook.md` on how the unit starts and what
`scripts/deploy.sh` restarts before touching anything, and keep the capability
switch: a server with `features.logging` off must still boot the same way.

## Acceptance

Either a request log line carries a status and a duration, or the reason it
does not is written where somebody reading the log will find it.
