---
id: B323
title: Somebody on a trip cannot see or revoke the writing keys they have handed out
type: ISSUE
priority: medium
complexity: medium
area: auth, keys, api
found: "2026-09-04T17:16:04Z"
started: "2026-09-07T11:40:39Z"
merged: "2026-09-07T12:18:35Z"
---

# B323 — Somebody on a trip cannot see or revoke the writing keys they have handed out

## Why

Found while building B320, which is what makes it reachable: until B320 a buddy
had no practical way to *get* a token, so having no way to revoke one was a gap
nobody could walk into.

`GET` and `DELETE` on `/api/v1/{user}/keys` are owner-only —
`app/api/v1/[user]/keys/route.ts:35` is `if (!(await isOwner(user, request)))`
— and `components/AgentKeys.tsx`, the list with a Revoke button beside each
row, is rendered only inside `{viewer.owner && …}` on `/{user}/me`.

So a buddy who pastes B320's prompt into an agent creates a seven-day
trip-scoped key, and from that moment:

- they cannot see that it exists, or when it was last used;
- they cannot stop it — not if the agent misbehaves, not if they pasted the
  instructions somewhere they should not have, not if they simply finish early;
- the only person who can is the journal's owner, who has no way to tell which
  row is the buddy's and which is their own. `AgentKeys` renders `kind`,
  dates and last-seen, and no address.

B283 made this argument for the owner and it holds identically here: handing an
agent a seven-day write key is a two-second act, so taking one back has to be a
two-second act too — otherwise the honest advice is "only do this if you are
sure", which is not advice anybody can act on. B320 currently ships exactly
that advice, because it was the only true sentence available: *to stop a key
before its seven days are up, ask whoever keeps this journal.*

The cost is bounded by the scope of the key — one trip, drafts only, seven
days — which is why this is not a SECURITY ticket. It is still the one control
the person holding the risk does not have.

## Work

Let a signed-in reader see and revoke the keys **issued to their own address**,
and nothing else.

The shape that does not widen anything: keep the owner's view as it is, and
have a non-owner session get the same route filtered to rows whose address is
the session's own. The filter must be the server's, from the session, never a
parameter — a `?email=` on this route would be an enumeration door and would
undo the point.

Three things to get right, and each is a way this goes wrong quietly:

- **`isOwner` is a bearer-or-cookie check and this is not.** The reader here
  holds a guest cookie, and what they are asking about is `agent` rows. The two
  kinds are deliberately not interchangeable (`resolveSession`), so this is a
  new pairing rather than a loosened gate — write it as one.
- **Revoking must be scoped twice**, to the journal *and* to the address. The
  route already scopes to the journal for the reason its own comment gives —
  an owner of one journal must not revoke a session in another on the same
  instance.
- **An owner is not a special case of a buddy.** They see every row and should
  keep doing so; do not implement the owner's view as "filtered by their own
  address" and quietly stop showing them a key they issued from a second
  address.

Consider whether the row should say which trip a key is scoped to. The scope is
on the session (`sessions.scope`, `tripWriteScope`), the owner currently cannot
see it, and it is the fact that makes a list of keys legible once more than one
person is issuing them. Probably yes, and it is the owner's gain as much as the
buddy's.

Not doing: any change to what a buddy's token may *do*. This is about seeing
and stopping one.

When this lands, B320's warning string (`me.buddyKeyWarning`) has to change —
it currently tells the buddy to ask the owner, which will have stopped being
true.

## Acceptance

- Signed in as somebody on a trip who has issued a key, `/{user}/me` lists that
  key and revokes it.
- The same reader sees no key belonging to any other address, including the
  owner's.
- Revoking one stops it: a write with that token afterwards is refused.
- The owner's own list is unchanged — every key in the journal, theirs and
  other people's.
- No request parameter can widen what a caller sees; a test covers a non-owner
  asking for somebody else's rows and getting their own.

## Triage / what was built

`guard()` in `app/api/v1/[user]/keys/route.ts` used to be `isOwner` or `403`.
It is now: owner (sees/revokes everything, unchanged) **or** a caller who has
proved an address — a `resolveAccess` cookie (guest/identity) or, since a
buddy typically drives an agent rather than a browser, a trip-scoped
**bearer** `agent` token (`callerEmail()`, mirroring `isOwner`'s own admin
bearer fallback) — who sees/revokes only rows whose `email` matches theirs.
Only a caller who has proved no address at all still gets the owner's
`forbidden`. The filter is entirely server-side, from the resolved address;
`GET` takes no query parameters at all, so there is nothing to widen it with.

`lib/auth/index.ts`'s `listSessions()` now also selects `sessions.scope` (it
already selected `email`, which was simply never read by the route before).
`GET`'s response carries `scope` on every row (in `tripWriteScope`'s
vocabulary, so a trip-bound key can be told apart from a journal-wide one) and
`email` **only for the owner's view** — a non-owner's rows are already
implicitly theirs, so repeating the address back says nothing new and would
be one more thing to accidentally leak later.

`components/AgentKeys.tsx` (unchanged) is now also rendered inside the
buddy's own section of `/{user}/me` (`app/[user]/me/MePageContent.tsx`,
beside `BuddyHandover`), since it already fetches/revokes through this same
route and a non-owner viewer now gets a legitimate (filtered) answer from it.

`me.buddyKeyWarning` (B320) changed in all three locales from "ask whoever
keeps this journal" to "revoke it below yourself" — it is rendered directly
above the list.

### What this now tells a caller who is not entitled

- No proven address at all (no cookie, no bearer token for this journal):
  `403 forbidden`, the same shape whether the journal exists or not (B340
  still holds for the owner path specifically).
- A proven address, but a `revoke` id that is not theirs (including the
  owner's, or the journal not existing): `404 unknown_key` — indistinguishable
  from an id that never existed, so a guess learns nothing either way.
- Sign-in switched off on the journal: `409 auth_disabled`, same as before.

### Contract

`/api/v1/{user}/keys` GET and POST both rewritten in `lib/api/openapi.ts` to
describe the owner/non-owner split, the new `403`/`404` semantics, and the
`scope`/`email` fields. `test/openapi-contract.test.ts` passes.

### Tests

`test/handover.test.ts`: the old single "nobody but the owner may look, or
revoke" assertion (which encoded the *previous*, now-intentionally-changed
behaviour) was split into "a caller with no credential at all may not look,
or revoke" plus a new `describe("a buddy's own keys", …)` block covering: a
buddy's token lists only their own row; `?email=<owner>` on the query string
changes nothing; a buddy can revoke their own key and it stops writing
immediately; a buddy revoking the owner's (or another buddy's) id gets `404`
and the target key is unaffected; the owner's own list still shows every
address in the journal. 30/30 pass.

Not done: no UI surfacing of `scope`/`email` beyond what `AgentKeys.tsx`
already rendered (kind, expiry, last-seen) — the Work section only said
"probably yes, consider it"; the API carries both fields already so a future
UI pass is additive, not another route change.
