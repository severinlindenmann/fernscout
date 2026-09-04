---
id: B137
title: A refused URL tells the caller to retry a permanent failure and says nothing about a transient one
type: ISSUE
priority: low
complexity: low
area: media, docs
found: "2026-09-03"
started: "2026-09-04T05:58:33Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T05:58:33Z"
---

# B137 — The retry advice is attached to the wrong failures

## Why

Found while verifying B31, which passes. B31 gave the two refusals opposite
wordings so a caller can tell "pick another URL" from "try again", and that
distinction now works. These are the two edges it left.

**A permanently wrong name is told to retry.** `dns.lookup` throwing is caught
as `unresolvable` (`lib/api/fetchMedia.ts:207-211`), so an NXDOMAIN — a host
that does not exist and never will — gets:

> could not be looked up — the name did not resolve. This may be temporary;
> send the batch again. It is not a refusal for pointing somewhere private

Observed live for `xydhd-b31-nope.invalid`. An agent that believes the message
retries a typo forever. The code comment at `:212-215` reasons about this for
the zero-answer case and accepts the trade deliberately, so this is a request
to revisit a known decision rather than a defect: NXDOMAIN and SERVFAIL are
distinguishable, and telling them apart leaks nothing about a private network,
which is the property the caution exists to protect.

**A genuinely transient failure gets no retry advice.** A fetch that times out
answers `could not be reached`, with nothing about trying again — measured at
~11 s for `192.0.2.1`. That is every bit as temporary as a resolver timeout,
and it is the one transient case the new vocabulary does not cover.
`agent.md` names only two refusals as opposites, so an agent reading the guide
carefully learns the wrong lesson about this third one.

Small stakes either way: a wasted retry, or a photo host reported as blocked
when it was briefly slow. Worth fixing because the whole point of B31 was that
the caller can act on the reason.

## Work

- Separate NXDOMAIN from a resolver that did not answer. The first is
  permanent: say the name does not exist and do not invite a retry. The second
  keeps today's wording.
- Give the fetch timeout the retry-shaped wording, since it is transient.
- Update `agent.md` so the set of refusals it describes matches the set the
  code emits — it currently frames this as two opposites and there are more.

Not doing: exposing resolver error codes or addresses. B31's third acceptance
bullet — that no refusal reveals an address, a range or a resolver error —
still holds and must keep holding; "this name does not exist" says nothing
about the network.

## Acceptance

- A non-existent name is refused without being told the failure may be
  temporary.
- A resolver timeout and a fetch timeout both carry retry-shaped wording.
- No refusal reveals an address, a range or a resolver error — B31's rule,
  re-asserted.
- `agent.md` lists the refusals that actually occur.
