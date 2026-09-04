---
id: B257
title: Nothing logs HTTP requests, so a client reporting failed to fetch cannot be diagnosed
type: CHORE
priority: medium
complexity: low
area: operations
found: "2026-09-04T10:35:21Z"
---

# B257 — Nothing logs HTTP requests, so a client reporting failed to fetch cannot be diagnosed

## Why

B256 turned on a question that could not be answered from this server: when an
agent's fetcher reports `Failed to fetch: https://fernscout.ch/agent.md`, did
the request arrive?

Neither log has it. Caddy writes no access log — `/var/log/caddy/` is empty and
`journalctl -u caddy` carried two lines for the whole window — and the Next
process logs boot and database lines only. So the two readings available are
"the fetcher never reached us" and "we refused it", and nothing on the machine
distinguishes them. B256 was diagnosed by elimination instead: replaying every
plausible user agent by hand and comparing byte sizes.

The cost is every future report of this shape, and they will keep coming: the
whole write side of this software is automated clients on networks nobody here
controls.

## Work

Not decided — that is the point of the capture. The cheap end is a Caddy
`log` directive with a rolling file and a short retention, which answers
method, path, status, size and user agent and nothing about a person. Consider
what it retains before turning it on: this server holds private journals, and
an access log of `/<user>/day/<slug>` is a reading history. A log that records
status and path for the documented agent-facing routes only may be the whole
of what is wanted.

## Acceptance

A request to `/agent.md` from outside can be confirmed or ruled out from the
server afterwards, and whatever is retained is written down — where it lives,
how long it is kept, and what it deliberately does not record.
