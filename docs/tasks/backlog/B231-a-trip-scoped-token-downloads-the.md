---
id: B231
title: A trip-scoped token downloads the whole journal from export.zip
type: SECURITY
priority: high
complexity: low
area: api, export
found: "2026-09-04T07:59:28Z"
---

# B231 — A trip-scoped token downloads the whole journal from export.zip

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`app/[user]/export.zip/route.ts:33`:

```ts
const isOwner = auth.ok && ownsUser(auth.session, user);
const archive = createUserExportArchive(user, isOwner ? "all" : "open-to-link");
```

`ownsUser` asks one question — `session.owner === username` — and it is
deliberately narrow: it says *which journal a token belongs to*, not what it
may do inside it (`lib/api/auth.ts`). Every other route that grants
journal-wide authority pairs it with a second check, either
`session.scope !== SESSION_SCOPE.agent` (config PATCH, trip create, the two
DELETEs, publish) or a per-trip `mayWriteTrip`. This route has neither, and the
local variable is named `isOwner`, which is what makes it read as correct.

A **trip-scoped** token satisfies `ownsUser`. It is issued by
`/api/auth/verify` to somebody listed in a trip's `people:`, or to a buddy the
owner approved onto one trip (B33) — the lowest-trust credential the system
mints, and the one the guide tells owners to hand out. It therefore selects the
`"all"` scope, which `lib/exportZip.ts:36` defines as *every* trip on disk with
no draft filter:

```ts
return scope === "all" ? trips : trips.filter(isOpenToLink);
```

So a `GET /<user>/export.zip` with that bearer token returns a zip containing
every `private` and `guest` trip in the journal, every trip's `costs.md` and
`plan.md`, and every unpublished draft in all of them. It is one request, it is
not logged as anything unusual, and the token was issued for the express
purpose of writing days into one trip.

The module's own docstring says the `"all"` scope is for `scripts/export.ts`
and that "nothing here is exposed over HTTP" — which stopped being true when
the route learned to serve it.

The same defect does not exist on `app/api/v1/[user]/drafts/route.ts`, which
pairs `ownsUser` with `writableTrips` and so filters per trip.
`app/api/v1/[user]/config/route.ts` GET has the weaker version of it — a
trip-scoped token can read the journal's `features` block — which is worth
fixing in the same pass but is not the reason for this ticket.

Found by the B22 sweep; see `docs/security/2026-09-04-sweep.md`. Independent of
B230, and reachable without it.

## Work

- The route must distinguish the journal's owner from a token that merely
  belongs to the journal. Either `auth.session.scope === SESSION_SCOPE.agent`
  alongside `ownsUser`, matching the line `PATCH .../config` and `DELETE
  /api/v1/<user>` draw, or `isOwner(user, request)` if the address check is
  wanted. Pick one and say why in the route's comment, because the next reader
  will meet `ownsUser` again.
- Rename the local `isOwner` to something that says what it tested. The name is
  half the bug.
- Decide what a trip-scoped token *should* get. Falling through to
  `open-to-link` is defensible and is what an unauthenticated caller gets; a
  per-trip archive is a feature, not this fix.
- While in the file: `app/api/v1/[user]/config/route.ts` GET has the same
  missing scope check on a much smaller payload.

Not doing: `app/[user]/delete/[token]/export.zip`, which also serves `"all"`
and is correct to — that token is single-purpose, hour-lived, and mailed to
`owner.email`.

## Acceptance

- `test/scope-escalation.test.ts` — the `B231` case flips: a trip-scoped token
  gets an archive with no `trips/honeymoon-2026/` in it and no draft entry.
- An owner's token still gets the whole journal; an anonymous request still
  gets the `open-to-link` archive. Both are already asserted in
  `test/export.test.ts`.
- All four checks pass.
