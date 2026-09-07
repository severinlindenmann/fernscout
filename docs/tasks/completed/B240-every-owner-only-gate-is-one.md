---
id: B240
title: Every owner-only gate is one scope string away from opening
type: SECURITY
priority: medium
complexity: medium
area: auth, api
found: "2026-09-04T08:24:24Z"
related: B241
started: "2026-09-07T11:40:27Z"
merged: "2026-09-07T12:12:19Z"
completed: "2026-09-07T13:07:25Z"
---

# B240 — Every owner-only gate is one scope string away from opening

## Why

> **Stale reference, 2026-09-04.** B298 removed MCP: there is no `lib/mcp/`
> and no `/api/mcp`. Every mention of an MCP tool or endpoint below describes
> deleted code, and "the network door" now means the REST API alone. The
> reasoning is unchanged — the paths it names are one fewer than it says.

Every "owner only" check in the write API and in MCP is the same line:

```ts
if (auth.session.scope !== SESSION_SCOPE.agent) { … 403 … }
```

`app/api/v1/[user]/route.ts:56` (delete the journal), `.../trips/[trip]/route.ts:58`
(delete a trip), `.../trips/route.ts:75` (create one), `.../config/route.ts`
(both verbs), `.../days/[slug]/publish/route.ts:77`, and five places in
`lib/mcp/tools.ts`. It asks whether the session's scope string is the
unqualified `write:content` — which is a question about a value minted at
sign-in, not about who is asking.

B230 is what that costs when the minting is wrong. One defect in
`/api/auth/verify` — a scope widened instead of refused — opened *all* of the
gates above at once, to somebody the owner had let onto a single trip. The
blast radius was bounded by exactly one thing: the contacts admin surface and
the invite endpoints ask `isOwner()` (`lib/contacts/session.ts:32`), which
compares the session's address against the journal's `owner.email` and so was
untouched by a bad scope string.

That is the shape worth generalising: an **identity** check cannot be widened
by a minting bug, and a **scope** check can. This is defence in depth, not a
live vulnerability — B230 is fixed, and the fix is bound to the code rather
than to the request. It is filed because the sweep's own reasoning
(`docs/security/2026-09-04-sweep.md`, finding 1) says the bound on that
finding's impact was the one surface that asks a different question.

## Related

Both fall out of B230's scope model. B240 is that every owner-only gate
compares one scope string; B241 is the papercut B230 left behind, an agent
code issued for a trip that was never real. Deciding what an owner check
should ask answers both.

## Work

- Decide whether the owner-only gates should ask `isOwner()` — the address —
  rather than the scope string. It is a real trade, not an obvious win:
  `isOwner()` needs the journal's config on every call and couples the write
  API to the contacts module, and a scope check is the cheaper, more local
  thing to read.
- If they should, do it in one pass across the ten call sites above so the
  idiom is uniform. A codebase where seven gates ask one question and three ask
  another is worse than either.
- Consider a narrower version instead: one `mayActAsOwner(session, username)`
  helper in `lib/api/auth.ts` that asks both, so the check has a name and one
  definition and the next route cannot invent a third spelling.

Not doing: anything to `ownsUser`, whose narrowness is correct and documented —
see B231 for the route that misread it.

## Acceptance

- One helper, one question, at every owner-only gate in REST and MCP.
- A test that a trip-scoped session is refused at each of them, and that a
  session whose scope was somehow widened is *still* refused because the
  address does not match.
- All four checks pass.

## Found and fixed (2026-09-07)

The stale-reference note at the top was right: there is no `lib/mcp/`. The
scope check `session.scope !== SESSION_SCOPE.agent` (or its inverse) existed
at these fourteen locations, all in the write API, all following the same
`ownsUser(...)` → `... scope check ...` shape:

- `app/api/v1/[user]/route.ts` (DELETE the journal)
- `app/api/v1/[user]/config/route.ts` (GET, PATCH — two)
- `app/api/v1/[user]/inbox/route.ts` (GET, POST — two)
- `app/api/v1/[user]/inbox/[id]/route.ts` (DELETE)
- `app/api/v1/[user]/import/route.ts` (GET, POST — two)
- `app/api/v1/[user]/trips/route.ts` (POST, plus a second, non-refusal use at
  line 29 gating whether `getMalformedTrips` is disclosed at all)
- `app/api/v1/[user]/trips/[trip]/route.ts` (DELETE, PATCH — two)
- `app/api/v1/[user]/trips/[trip]/rates/route.ts` (PUT)
- `app/api/v1/[user]/trips/[trip]/visibility/route.ts` (PUT)
- `app/api/v1/[user]/trips/[trip]/track/route.ts` (POST)
- `app/api/v1/[user]/trips/[trip]/days/[slug]/publish/route.ts` (POST)
- `app/api/v1/[user]/trips/[trip]/days/[slug]/send-mail/route.ts` (POST)
- `app/api/v1/[user]/trips/[trip]/days/[slug]/send-whatsapp/route.ts` (POST)
- `lib/api/tripParty.ts` (`resolveTripOwner`, the shared resolver behind the
  `people`, `travellers` and `tracks` routes — three more call sites for one
  code location)

Two more turned up during the sweep that also disclose owner-only
information on a scope compare, outside `app/api/`:

- `lib/api/status.ts:149` (`journalStatus`) — gates the malformed-trips list
  and the credit balance shown by `GET /api/v1/<user>/status`.
- `app/[user]/export.zip/route.ts:62` — gates whether the *whole* archive or
  only the public one is streamed. Its own long comment explicitly argued for
  keeping the scope-only check "for consistency" rather than reaching for
  `isOwner()`; that argument is why this ticket exists, so it was folded in
  rather than left as the fifteenth exception.

**Chose the narrower option the ticket floated**: `mayActAsOwner(session,
username)` in `lib/api/auth.ts`, rather than switching every gate to
`isOwner()` from `lib/contacts/session.ts`. It asks both things `isOwner` asks
for a browser credential — `ownsUser` (which journal) and `session.scope ===
SESSION_SCOPE.agent` (not a trip-scoped token) — plus a third, independent
check: `session.email` against `getUser(username)?.owner.email` (or the
instance admin). That third check is what a scope-minting bug like B230 could
not also falsify, since it reads a fact from the journal's own `config.json`
rather than from the token's own metadata a second time. Every one of the
fourteen-plus-two sites above now calls it in place of the raw comparison; the
messages at each refusal are unchanged.

`test/owner-gate.test.ts` is the acceptance test: a unit-test half
(`mayActAsOwner` itself, including the defense-in-depth case — a session
scoped as the unqualified owner token but whose address does not match the
journal's `owner.email` is still refused) and an enumeration half — a source
scan asserting no file outside `lib/api/auth.ts` still contains the literal
comparison `session.scope !== SESSION_SCOPE.agent` (or `===`). Verified by
hand that re-introducing the raw compare at one call site makes the scan fail.

`npm run verify` passes. No OpenAPI change: no refusal's status code or `error`
value changed, only how it is computed.
