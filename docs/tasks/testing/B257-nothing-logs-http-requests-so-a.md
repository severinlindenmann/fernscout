---
id: B257
title: Nothing logs HTTP requests, so a client reporting failed to fetch cannot be diagnosed
type: CHORE
priority: medium
complexity: low
area: operations
found: "2026-09-04T10:35:21Z"
started: "2026-09-04T12:46:31Z"
merged: "2026-09-04T13:12:55Z"
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

**Decided by the owner on 2026-09-04: build it, behind a per-server toggle.**
Off by default, switchable per server, in the shape every other optional
capability here already has.

- **A capability, not an env flag on its own.** `lib/capabilities.ts` is the
  registry and `content/config.json`'s `features` block is where a server turns
  it on — the same as `reactions`, `costs` and the rest. Name it `logging`
  rather than `enable_logging`: the key is read as `features.logging.enabled`,
  so the verb is already in the shape. `/api/health` must report it and say
  why it is off when it is, which is the rule that makes a disabled capability
  *absent* rather than broken.
- **Log to stdout, one line per request, and stop there.** systemd already
  collects, rotates and expires this journal — `journalctl -u fernscout` is how
  every other problem here gets read, and it is where the trace that diagnosed
  B272 was found. A file logger would mean a path, a rotation policy, a size
  cap and a retention sweep, all to reimplement what the unit already does.
  Nothing goes under `contentRoot()`: a request log is the operator's, not any
  journal's, and it must not land inside somebody's content or their backup.
- **`proxy.ts` is the choke point.** Every request passes through the
  middleware, which already sets the response headers, so one place answers for
  every route rather than a call per handler.
- **What a line carries, and what it deliberately does not.** Method, path,
  status, duration, response size, and user agent — that set answers the
  question this task exists for ("did the fetcher arrive, and what did we tell
  it?") and answered nothing else in the two cases that motivated it. **No IP
  address by default**, and no query string: this server holds private
  journals, so a log of `/<user>/day/<slug>` is already a reading history and
  an address beside it makes it an identified one. If an operator needs client
  addresses for abuse work, that is a second, separately-named switch and a
  separate decision — do not fold it into this one.
- **Say what is retained, where, and for how long**, in `docs/runbook.md`,
  because a log nobody documented is a log nobody can answer for. The honest
  sentence is that the journal is systemd's and expires on the unit's terms.
- Check `scripts/deploy.sh` prints the state of this the way it already prints
  backup and Caddy state, so an operator learns from a deploy whether their
  server is logging.

Not in scope: parsing, shipping or aggregating the log anywhere, and any
per-journal switch. One server-level toggle, one line per request.
## Acceptance

A request to `/agent.md` from outside can be confirmed or ruled out from the
server afterwards, and whatever is retained is written down — where it lives,
how long it is kept, and what it deliberately does not record.
