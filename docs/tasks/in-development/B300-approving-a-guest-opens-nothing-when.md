---
id: B300
title: Approving a guest opens nothing when every trip is private, and neither the owner nor the guest is told
type: ISSUE
priority: high
complexity: low
area: contacts, access, tripGate, i18n
found: "2026-09-04T14:20:00Z"
started: "2026-09-04T14:16:22Z"
session: a3370c43-40d9-471c-a3d3-1a30c49b5302
claimed: "2026-09-04T14:16:22Z"
---

# B300 — Approving a guest opens nothing when every trip is private, and neither the owner nor the guest is told

## Why

Reported from the live site on 2026-09-04, and diagnosed there. **There is no
access bug.** The gate is behaving exactly as decision 12 and B41 specify. What
is broken is that nothing on either side of the transaction says so, and both
people are told something that is either wrong or useless.

What happened. The owner issued a guest link, somebody redeemed it, and the
owner approved them — the guest list shows `Freigegeben`, a `Zutritt entziehen`
button beside it, `Gekommen über invite:6d9b…`. The guest then opened the
journal's only trip and was refused:

> **Diese Reise ist nicht für dich freigegeben.** Du bist als … angemeldet, und
> diese Reise wurde nicht für diese Adresse freigegeben. Bitte wer dieses
> Tagebuch schreibt darum, dich hereinzulassen.

The trip is `visibility: private`. `mayReadTrip` (`lib/tripGate.ts:42`) returns
false for `private` **before it ever consults a grant** — deliberately, and the
comment above that line explains why: `private` is the people who were there,
and a journal guest is exactly who it does not admit. So the approval was
real, the grant is real, and it opens nothing, because there is no `guest` trip
in the journal for it to open.

Two failures follow, and one fix closes both because they are the same missing
sentence.

**The reader is sent to the wrong person with the wrong request.**
`gate.refusedBody` tells them to ask whoever writes the journal *to let them
in* — which they already have been. Nothing they or the owner can do in the
contacts flow will change this page. The only lever is one word in a file the
reader cannot see, and the message does not hint that a *trip* can be closed
independently of the journal.

**The owner is never told their approval is inert.** The contacts page approves
somebody, mails them "you're in", and says nothing about the fact that every
trip in the journal is `private` and the approval therefore admits them to
nothing. `sendApprovedMail` goes out regardless. From the owner's side this is
indistinguishable from having successfully shared their journal — which is the
worse half of the two, because they will believe the family can read it.

Related: **B117** is the precedent for how carefully a closed trip's gate is
worded, and any change here has to keep that — the gate must not name the trip
to somebody who was never invited. **B278** is the neighbouring page for a
reader who may see nothing. The reader in *this* report is signed in and
approved, which is a case neither covers.

## Work

Not the gate. `mayReadTrip` is right and must not learn a fourth answer.

- **Tell the owner, where they approve.** On `/<user>/contacts`, when the
  journal has no trip with `visibility: guest`, say so beside the approve
  control and in the approval result: approving somebody opens the trips marked
  `guest`, and there are none — so this lets them into the journal and no
  further. Ideally name the one word that changes it. `getTrips(username)` is
  already loaded on that page for B281's writing links, so the answer is in
  hand.
- **Say the true thing to an approved reader.** When the refusal is reached by
  somebody who *is* a journal guest, the honest sentence is that this
  particular journey is closed to everyone except the people who were on it —
  not "ask to be let in". `mayReadTrip` already knows which branch refused;
  `TripGate` needs to be told which, without leaking anything about the trip to
  a reader who is not a guest. Keep B117: for anybody else, the page says what
  it says today.
- **Consider the approval mail.** `sendApprovedMail` says they are in. If there
  is nothing to read, that mail is a promise the site does not keep. Either it
  says "there is nothing shared yet, you will be told when there is", or the
  owner is warned before it goes.

Not doing: a per-trip guest list (a guest is a guest of the journal — AGENTS.md
is explicit and B41 is why), and no change to what `private` means.

## Acceptance

- With a journal whose only trip is `private`, the contacts page says, before
  the owner approves anybody, that approving opens no trip yet and names what
  would change that.
- An approved journal guest opening a `private` trip is told the trip is closed
  to everyone but its travellers, and is **not** told to ask to be let in.
- A signed-in stranger who is *not* a guest sees exactly what they see today —
  `test/access-gate.test.ts`'s "a signed-in stranger" still passes unchanged,
  and the gate still does not name the trip (B117).
- A test covers the approved-guest-meets-private-trip case, which is the one
  nothing covered.
