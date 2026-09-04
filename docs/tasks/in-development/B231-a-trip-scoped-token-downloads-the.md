---
id: B231
title: A trip-scoped token downloads the whole journal from export.zip
type: SECURITY
priority: high
complexity: low
area: api, export
found: "2026-09-04T07:59:28Z"
started: "2026-09-04T08:08:58Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T08:08:58Z"
---

# B231 — A trip-scoped token downloads the whole journal from export.zip

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

## What was built

Branch `g16-token-scope-escalation`.

`app/[user]/export.zip/route.ts` now asks both questions: `ownsUser` (which
journal this token belongs to) **and** `auth.session.scope ===
SESSION_SCOPE.agent` (that it is the owner's unqualified `write:content`,
rather than a `write:trip:<id>` one). The local is renamed `isOwner` →
`wholeJournal`, which is what it actually tests and was half the bug; the
`Cache-Control` line reads the same variable, so a trip-scoped token's archive
is now the cacheable public one rather than being marked `private, no-store`
for content it no longer contains.

The scope check rather than `isOwner()` from `lib/contacts/session.ts`: it is
the line `PATCH /api/v1/<user>/config`, `DELETE /api/v1/<user>` and `publish`
already draw, and one idiom across every journal-wide route is worth more here
than the marginally stronger address test. The reasoning is in the route, since
the next reader will meet `ownsUser` again. Whether *all* of them should ask
the address instead is captured as **B240** rather than decided here.

A trip-scoped token falls through to `open-to-link`, exactly as an anonymous
caller does — refusing outright would say something about the journal it need
not say, and the public archive is content that token could already fetch. A
per-trip archive is a feature, not this fix.

Folded in as the ticket asked: `GET /api/v1/<user>/config` had the same gap on
a smaller payload and now carries the same check as its own `PATCH`.
`lib/exportZip.ts`'s docstring said the `"all"` scope was "not exposed over
HTTP", which stopped being true when this route learned to serve it; it now
names both routes that serve it and states that anything reaching for it must
establish ownership, not mere membership.

`app/[user]/delete/[token]/export.zip` is untouched and still serves `"all"` —
that token is single-use, hour-lived and mailed to `owner.email`.

## Evidence

`test/scope-escalation.test.ts`, B231 cases. The trip-scoped token is minted
directly through `verifyCode` with an explicit scope, so this case stands on
its own and does not depend on B230's fix.

Before: the archive contained `trips/honeymoon-2026/trip.md` and
`2026-08-25-the-quiet-week.md`, an unpublished draft in a private trip the
holder was never on. After: it contains neither, nor `trips/alps-2026/`; the
owner's token still gets all three; an anonymous request is unchanged; and a
trip-scoped token gets `403 out_of_scope` from `GET .../config`.
`test/export.test.ts` passes unchanged. Full run: 137 files / 2161 tests green.

**Audit of every other `ownsUser` call site** (13 in all, asked for in the
ticket's spirit): the eleven in `app/api/v1/` each pair it with something —
`mayWriteTrip` on the four trip-scoped write routes plus media and publish,
`writableTrips` on `/trips` and `/drafts`, and `scope !== SESSION_SCOPE.agent`
on trip create, both DELETEs and config PATCH. Only this route and config GET
were unpaired, and both are fixed here. No further instance found, so there is
nothing new to file for it.
