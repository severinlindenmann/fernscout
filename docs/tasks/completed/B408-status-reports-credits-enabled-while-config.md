---
id: B408
title: status reports credits enabled while config reports it off, on the same journal
type: ISSUE
priority: medium
complexity: low
area: api
found: "2026-09-05T07:49:39Z"
started: "2026-09-05T08:49:35Z"
merged: "2026-09-05T09:08:35Z"
completed: "2026-09-05T09:37:22Z"
---

# B408 — status reports credits enabled while config reports it off, on the same journal

## Why

Two live surfaces disagree about the same journal, at the same moment:

```
GET /api/v1/xydhd-lifecycle/status  -> "features": {"credits": {"enabled": true}}
GET /api/v1/xydhd-lifecycle/config  -> "credits": false
GET /api/health                     -> credits off ("not enabled on this server")
```

Found 2026-09-05 during a documentation sweep. `/status` is the call the guide
tells an agent to make first, to learn what it may do here — so the one surface
built for that purpose is the one giving the wrong answer, and it is wrong in
the dangerous direction: it reports a capability as available that the server
does not provide.

An agent trusting `/status` would offer the owner something that cannot happen,
and would only find out at the call.

## Work

Resolve `/status`'s feature block through the same check `/config` and
`/api/health` use, so the three agree. Whichever is authoritative, one of them
is currently computing this differently.

## Acceptance

For any journal, `/status`, `/config` and `/api/health` agree about whether
`credits` is enabled.
