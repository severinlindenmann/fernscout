---
id: B240
title: Every owner-only gate is one scope string away from opening
type: SECURITY
priority: medium
complexity: medium
area: auth, api
found: "2026-09-04T08:24:24Z"
related: B241
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
