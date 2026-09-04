---
id: B264
title: A reader who may see nothing in a journal is told there are no trips yet
type: ISSUE
priority: high
complexity: medium
area: trips, access, i18n
found: "2026-09-04T11:26:21Z"
started: "2026-09-04T11:27:17Z"
session: 986bc24c-6a18-473f-a506-aa8c4efb475c
claimed: "2026-09-04T11:27:17Z"
---

# B264 — A reader who may see nothing in a journal is told there are no trips yet

## Why

Reported on 2026-09-04: opening `https://fernscout.ch/viki/trips` signed out
gives

> **No trips yet**
> There is nothing here yet. As soon as there is a trip, you will find it here.

For that journal it is true — it has no trips. But it is the same sentence a
reader gets when the journal is full of journeys none of which are theirs to
see, and it is the wrong thing to say in both cases, for different reasons.

`app/[user]/trips/page.tsx:84-93` decides the empty state from `all.length`,
the unfiltered list, and the comment above it explains why:

> *Asked of `all`, before the gate: a journal whose trips this reader may not
> see is a full journal behind a silent filter (B44), not an empty one, and
> telling a guest there are no trips would be a second lie on top of the four
> zeroes. Only genuine emptiness gets the empty state.*

That reasoning is right about the lie and leaves the reader with the four
zeroes and no sentence at all. So there are two states, neither of which tells
somebody what to do:

- **Trips exist, none visible** — headings, zeroes, no explanation.
- **No trips at all** — `trips.emptyBody`, which reads as "come back later"
  when what a reader may actually need is an invitation.

There is a "Sign in" link in the journal nav (B44's work), which is the way in
once you know you need it. Nothing on the page says you might.

**The two states must say the same thing.** If a filtered journal says "ask for
an invitation" and an empty one says "no trips yet", then an anonymous request
to any journal distinguishes "has hidden journeys" from "has none" — which is a
fact about somebody's private journal, readable by anyone who tries the
address. This project already refuses that trade in B117, where a closed trip
does not name itself at the sign-in gate. So the fix is one message for both,
and it has to be true for both.

## Work

- **One state, one sentence**: when the viewer is not the owner and the
  *visible* list is empty, say what to do rather than what is absent. It must
  read as true whether the journal holds nothing or holds nothing for them —
  something along the lines of *there is nothing here you can read; journeys in
  this journal may be private, ask whoever told you about it for an invite
  link, or sign in with the address they invited* — and it must be identical
  in both cases, including in the page title.
- Drive it from `trips.length` for the non-owner branch rather than
  `all.length`, so the filtered case gets the message too. Do not let the
  markup, the ordering or the presence of any element differ between the two
  cases; the point of the change is that they are indistinguishable.
- **The owner's branch is unchanged** — genuine emptiness plus the agent
  handover, which is B75 and B76's work and correct as it stands. `isOwner` is
  currently only consulted when `all.length === 0 || broken.length > 0`
  (`page.tsx:71`); that condition has to widen, and the comment there about
  avoiding a session lookup on ordinary pages explains the cost — a journal
  with visible trips must still not pay for it.
- **A reader who already has a guest session and still sees nothing** is a
  third case in substance: telling them to sign in is useless. If the page can
  cheaply tell, say instead that their invitation does not cover anything here
  yet. If it cannot, leave one message and capture the difference — do not
  guess at a session state you have not read.
- Both the zeroes and the sentence: consider whether the lifetime totals should
  render at all for a viewer with nothing to total. Four zeroes are not wrong,
  but they are the part that reads as a broken page.
- All three locales.

Not in scope: the journal home, map and costs pages, which have the same shape
of problem. Capture separately once the wording here is settled, so all four
say one thing.

## Acceptance

- Signed out, a journal with no trips and a journal whose every trip is
  private produce **byte-identical** page bodies at `/<user>/trips`.
- That page names both ways in: asking for an invite link, and signing in.
- The owner still gets the empty state with the agent handover, unchanged.
- A test asserts the two anonymous cases match, so the leak cannot come back.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
