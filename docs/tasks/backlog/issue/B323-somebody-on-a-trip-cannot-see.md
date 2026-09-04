---
id: B323
title: Somebody on a trip cannot see or revoke the writing keys they have handed out
type: ISSUE
priority: medium
complexity: medium
area: auth, keys, api
found: "2026-09-04T17:16:04Z"
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
