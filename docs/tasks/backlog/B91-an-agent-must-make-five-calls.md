---
id: B91
title: An agent must make five calls to learn what it may do here, and the guide does not say to make any of them first
type: FEATURE
priority: medium
complexity: medium
area: api, documentation, agents
found: "2026-09-03"
---

# B91 — An agent must make five calls to learn what it may do here, and the guide does not say to make any of them first

## Why

An agent that has just authenticated knows nothing about the journal it holds a
token for. To find out what is waiting and what it may do, it makes a
scattering of calls: `GET /api/v1/<user>/drafts` for the outstanding drafts
(`app/api/v1/<user>/drafts/route.ts`), `GET /api/v1/<user>/trips` for the trips,
`GET /api/health` for which capabilities this server has on, `GET
/api/v1/<user>/invites` for invites — and there is no single call for "what is
my balance and what does anything cost", because credits do not exist yet
(B89). The guide (`lib/api/documentation.ts`) walks through authenticate → read
→ write and never says: *first, get your bearings.*

Two costs. The obvious one is the round trips. The real one is that an agent
with no cheap way to orient will either skip the orientation — and write into a
journal without noticing three drafts already wait for approval, or try to send
a postcard on a server where `postcards` is off — or reconstruct it call by
call, differently each time. A single status call is the fix asked for:
*"status shows open drafts, available credits, pricing, enabled features on this
server, open trips, journal link, invite link — some basic information so it
does not have to do another call for each step."*

There is a sequencing rule wrapped around it, also asked for: an agent's *first*
call should establish whether it even has a live credential — "checks first if
it has a fresh passcode" — and only then ask for status. Today the guide's
opening move is `POST /api/auth/request`, which is right, but nothing frames the
whole entry as *check credential, then check status, then act*.

## Work

**Add `GET /api/v1/<user>/status`.** Owner token sees everything; a trip-scoped
token sees its own trip's slice and is told plainly that is what it is seeing —
the same scoping `writableTrips`/`writableTrips` already applies in the drafts
and trips routes, so reuse it, do not invent a second rule. One response,
assembled from what already exists:

- **journal**: the public URL, title, visibility, the journal's locale.
- **drafts**: the count and the list the drafts route already builds — each with
  its `publish` call — rather than a second shape of the same data. Factor the
  drafts route's body into something both endpoints call.
- **trips**: open/current/upcoming, day counts, each trip's `visibility` — the
  trip list route already computes this.
- **features**: which capabilities are on *for this journal*, from
  `resolveCapabilities()` (`lib/capabilities.ts`), the same source
  `/api/health` uses, filtered to what an agent can act on (postcards,
  photobook, push, mail…). When one is off, say so; an agent that knows
  `postcards` is off will not build a request that cannot be sent.
- **credits and pricing**: the balance and the price list **when B89 exists**.
  Until then this key is absent, not zero — an absent capability must read as
  absent, not broken (`lib/capabilities.ts`), and a hardcoded price list here
  would be a second source of truth for numbers B89 has not decided. Build the
  endpoint so the credits block slots in without reshaping the rest; do not
  invent the numbers.
- **invites**: the invite-management link, where `contacts` is on.
- **next**: what to do — publish a waiting draft, write a day, nothing.

**Frame the entry sequence in the guide.** Near the top of `agentGuide()`
(`lib/api/documentation.ts:229`), before "Authenticating": the first thing an
agent does is confirm it holds a live token — a `GET /status` that answers `401`
means go get a code; `200` means you are in. Then read status once and work from
it, rather than a call per question. Keep it short; the guide is already long,
and this is a signpost, not a new chapter.

Cache nothing that changes: status is `force-dynamic`, like every other
authenticated route here. It is a convenience view over live data, never a
snapshot.

Not doing: inventing the credit/pricing numbers (B89 owns those), a public
unauthenticated status (the journal's own `documentation.txt` is that), or
folding the drafts and trips routes away — they stay; status summarises them.

Depends on nothing, but the credits and pricing block is empty until B89 lands.
Note that in a closing line so whoever picks up B89 knows to fill it in.

## Acceptance

- `GET /api/v1/<user>/status` with an owner token returns journal, drafts (with
  publish links), trips, enabled features, invites and a `next` — in one call.
- The same call with a trip-scoped token returns only that trip's slice and says
  it is scoped.
- Without a token it answers `401`, and the guide names that as the "am I signed
  in" check.
- With a capability off, status says it is off rather than omitting it silently,
  and the credits block is absent (not zero) until B89 exists.
- The drafts shape in status and at `/drafts` come from one function, not two.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
