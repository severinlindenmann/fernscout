---
id: B1505
title: A buddy's trip-scoped agent token cannot drive /agent at all
type: ISSUE
priority: high
complexity: low
area: helper
found: "2026-09-11T18:55:28Z"
merged: "2026-09-11T19:24:12Z"
---

# B1505 — A buddy's trip-scoped agent token cannot drive /agent at all

## Why

Found running the managed-instance testing framework's `buddy-established-add-day-agent`
and `buddy-established-voice-note-transcription` flows against a local dev server.
Every route under `app/api/helper/[user]/*` — `ask`, `transcribe`, `photobook`,
and presumably the rest — authenticates via `isHelperOwner()`
(`lib/helper/server.ts:14-41`), which calls `resolveCookieCaller()` only and
never inspects an `Authorization` header. A bearer token — journal-wide owner
scope or trip-scoped buddy scope, doesn't matter — gets `404 not_your_journal`
before any capability, scope, or persona check even runs.

That contradicts what's documented in two places: AGENTS.md says "everyone
listed [in `people:`] may write to the whole trip, and may hold an agent
token scoped to it and to nothing else in the journal" without carving out
`/agent` as an exception, and `docs/testing/personas/buddy-established.md`
explicitly asserts a buddy "may hold a trip-scoped agent token" to drive
`/agent`. Confirmed live: `GET /api/helper/example/ask` with a real, valid
owner-scoped bearer token still 404s with the route's own message
*"reads a signed-in session cookie only... a valid token gets this same
answer."*

## Work

**Ruled (owner, 2026-09-11): not building bearer-token access to `/agent` for
a buddy right now — this may be revisited later, but the current cookie-only
behavior is intentional, not a bug.** AGENTS.md's own claim about `people:`
tokens is about `/api/v1/**` write access, not `/agent`, and did not need
correcting. What did:

- `docs/testing/personas/buddy-established.md` — dropped the "may hold a
  trip-scoped agent token [to drive `/agent`]" claim; states plainly that
  `/agent` is unreachable by any buddy credential today and that a buddy
  writes through `/api/v1/**` instead.
- `docs/testing/flows/buddy-established-add-day-agent.md` — rewritten to
  drive `/api/v1/**` with the buddy's bearer token (the door that actually
  exists for this persona), with the `/agent` refusal kept as one explicit
  boundary-check step rather than the flow's premise.
- `docs/testing/flows/buddy-established-voice-note-transcription.md` —
  removed; transcription is `/agent`-only, so there is no buddy-reachable
  version of this flow. Replaced by
  `docs/testing/flows/owner-established-use-agent-helper.md`, a new flow
  that exercises both `helper` and `transcription` via a real owner cookie
  session — the only door either capability has.
- `docs/testing/flows/owner-established-order-photobook.md` — same
  correction: its helper-proposal step is cookie-only too (same route
  family), not bearer, and the flow said otherwise.
- `docs/testing/coverage.ts` — `helper`/`transcription` now point at
  `owner-established-use-agent-helper` with `interfaces: ["ui"]`; every
  entry that had said `interfaces: ["agent"]` while actually driving
  `/api/v1/**` with a bearer token (`costs`, `weather`, `photobook`,
  `credits`, `auth`'s buddy flow) was relabeled `"api"` — `"agent"` is now
  reserved for flows that actually drive `/agent`.

## Acceptance

`docs/testing/personas/buddy-established.md`, the flow files, and
`docs/testing/coverage.ts` agree with the live behavior: a buddy's token
reaches `/api/v1/**` and is refused at `/agent`; `helper`/`transcription`
are covered by a real cookie-session flow instead. `npm run verify` green,
including `test/coverage-contract.test.ts`'s flow-file-exists check.
