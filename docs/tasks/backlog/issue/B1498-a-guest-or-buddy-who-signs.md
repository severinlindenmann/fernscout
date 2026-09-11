---
id: B1498
title: A guest or buddy who signs up for their own journal is unverified territory
type: ISSUE
priority: high
complexity: medium
area: auth, accounts, signup
found: "2026-09-11T17:58:35Z"
---

# B1498 — A guest or buddy who signs up for their own journal is unverified territory

## Why

This is the growth path, and nobody has driven it. Somebody is invited as a
guest to a friend's journal, or as a buddy on their trip, reads it, thinks
*this is good*, and signs up for a journal of their own. That person must end
up holding three things at once, under one address:

- owner of `their-name`
- guest on `friends-journal`
- buddy (a `people:` row, or a buddy grant) on `friends-journal/some-trip`

Nothing in the model forbids it — an `fs_identity` cookie is bound to an
address and to no journal (the `NO_JOURNAL` sentinel), `resolveAccess()` asks
about each journal separately, and `isOwner` reads that journal's own
`config.json`. So the design says yes. What has never been checked is whether
the *code* says yes at every step, and where the seams are:

- Does signup refuse an address that already holds a guest or buddy grant
  somewhere? A uniqueness check meant to stop a second journal per address
  could plausibly be reading the contacts table rather than the owner table.
- Does the existing identity cookie carry through signup, or does signing up
  mint a session that replaces it and quietly drops the guest access?
- After signup, does the reader still see the friend's `guest` trips — in the
  journal switcher, in the feed, on `/<user>/trips`?
- Does the buddy write access survive? Can they still add a day to the
  friend's trip while holding their own journal's owner session?
- Whose journal does a naked `/` or the switcher land on, and is there
  anything on screen that says "you are a guest here" versus "this is yours"?
- The reverse order too: an existing owner who is *then* invited as a guest or
  buddy to somebody else's journal. Does the invite landing page accept an
  address that already owns a journal, or does it read as a collision?
- Signup takes a username; being a guest somewhere does not reserve one. A
  name clash with a reserved username or an existing journal has to fail with
  something a person can act on.

The cost of getting it wrong is the whole funnel: the people most likely to
sign up are exactly the ones already reading somebody's journal, and if signup
breaks or silently revokes their guest access, that is the worst possible
moment to lose them.

## Work

Drive it end to end rather than reasoning about it — this is a verification
ticket first and a fix ticket second.

1. On a local checkout (or the live instance with a throwaway journal), set up
   journal A with a `guest` trip and a `private` trip, issue a guest link and a
   buddy link for that trip, and take both as address X. Approve them.
2. As address X, sign up for journal B. Record what happens at every step —
   the signup form, the code mail, the session that comes back.
3. Check, in a browser: X can still read A's guest trips; X can still write a
   day to the buddy trip; X owns and can publish in B; the switcher shows
   both and distinguishes them; X cannot read A's `private` trip.
4. Repeat in the other order — sign up first, then take the invites.
5. File what breaks as its own ticket per fault; fix here only what is a
   one-line guard in a shared function. Anything that needs a UI answer
   (how a switcher shows "mine" versus "somebody else's") is a new capture,
   not scope absorbed here.

Not doing: any new grant kind, any cross-journal permission, any change to
what a guest or buddy may do. The claim under test is only that holding all
three at once works.

## Acceptance

One address demonstrably holds all three roles at the same time, shown in a
browser, in both setup orders — and every fault found is either fixed or
captured by id in this file.
