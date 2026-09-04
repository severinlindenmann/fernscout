---
id: B137
title: A refused URL tells the caller to retry a permanent failure and says nothing about a transient one
type: ISSUE
priority: low
complexity: low
area: media, docs
found: "2026-09-03"
started: "2026-09-04T05:58:33Z"
merged: "2026-09-04T06:30:05Z"
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

## What was built

The Why was accurate on both counts.

**NXDOMAIN is now its own verdict.** `HostVerdict` in `lib/api/fetchMedia.ts`
gains `nonexistent`, and `checkHost` reaches it two ways: `dns.lookup` throwing
`ENOTFOUND` or `EAI_NONAME` — the resolver answered and there is no such name —
and a lookup that returns zero addresses, which is the case the old comment
reasoned about and accepted. Every other `dns.lookup` failure, `EAI_AGAIN`
above all, stays `unresolvable` and keeps B31's wording exactly.

The new refusal:

> could not be looked up — there is no such name. That is permanent, so check
> the spelling rather than resending. It is not a refusal for pointing
> somewhere private

No form of "again", deliberately: a message a regex or a skim-reading agent
could mistake for the transient one is the whole failure mode being fixed.

**The response timeout now says to retry.** The `catch` around `fetch()`
answered `could not be reached` for both a refused connection and a 15-second
timeout. A `timedOut` flag set by the abort timer separates them; the timeout
gets the same shape of sentence the body timeout already had, and a connection
that fails some other way keeps the neutral answer. `fetchImage` gained a
fourth optional parameter, `responseTimeoutMs`, for the same reason the third
one exists — so a test can assert the clock without waiting on it. Nothing in
the application passes either.

**The guide lists what actually occurs.** The "two of those refusals mean
opposite things" paragraph in `lib/api/documentation.ts` is now a table of six,
each saying whether resending will help. It was describing two when the code
emitted nine.

B31's third acceptance bullet is re-asserted in the test rather than assumed:
the new refusal is checked against `/\d+\.\d+\.\d+\.\d+|ENOTFOUND|EAI_|resolver/`.

## Evidence

- `test/fetch-media.test.ts` — three new tests, all three failing against the
  code as it was:
  - `a name that does not exist is not told the failure may be temporary`
  - `a name that resolves to nothing is permanent too`
  - `a host that never answers is told to try again, not that it is unreachable`
  plus two regression guards that passed before and must keep passing:
  `a resolver that does not answer still says to retry` and `a connection that
  simply fails is not told to try again`.
- 92 tests in that file, green.
