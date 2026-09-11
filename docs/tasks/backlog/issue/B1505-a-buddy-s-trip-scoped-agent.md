---
id: B1505
title: A buddy's trip-scoped agent token cannot drive /agent at all
type: ISSUE
priority: high
complexity: low
area: helper
found: "2026-09-11T18:55:28Z"
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

Decide which side is wrong, then fix the wrong one:
- If a buddy (or anyone with a scoped token) is meant to be able to drive
  `/agent` programmatically, `isHelperOwner`/`resolveCookieCaller` needs a
  bearer-token path that checks trip scope the way `/api/v1/**` routes do.
- If `/agent` is deliberately browser-only (a design choice, not an
  oversight — plausible, since B681/B682's guided web helper is explicitly a
  face on an agent for people with none of their own), then AGENTS.md and
  `docs/testing/personas/buddy-established.md` are overclaiming and need
  correcting, and the two testing flows above need rewriting to drive
  `/agent` via a real cookie session instead of a token.

Not doing: guessing which answer is right — this is a product decision.

## Acceptance

Either `/agent` accepts a correctly-scoped bearer token from a buddy (and a
live test proves it), or AGENTS.md + the buddy persona/flow docs are
corrected to say plainly that `/agent` needs a cookie session and a
bearer-token buddy cannot reach it at all.
