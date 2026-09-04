---
id: B320
title: A buddy on a trip is told the journal is not theirs to write, and never learns they hold write access
type: ISSUE
priority: high
complexity: medium
area: me-page, access, auth, mail
found: "2026-09-04T17:01:48Z"
started: "2026-09-04T17:04:22Z"
merged: "2026-09-04T17:16:05Z"
---

# B320 — A buddy on a trip is told the journal is not theirs to write, and never learns they hold write access

## Why

Found from the live instance. Kevin was issued a buddy link for `viki`'s
`asien-2025`, opened it, confirmed his address, and was approved. He therefore
holds a place on that trip: `peopleOf()` merges his row with the `people:`
block, and `AGENTS.md` states the consequence plainly — *"Everyone listed may
write to the whole trip, and may hold an agent token scoped to it and to
nothing else in the journal."* `lib/auth/index.ts:764` says the same from the
other side: *"a buddy holds a trip-scoped token and gets it the way they got it
before."*

Nothing he can reach says any of that, and one thing he can reach contradicts
it.

**His own access page tells him he is a reader.** `/viki/me` renders
`me.detailsBody` — *"Name, Sprache und Postadresse gehören dir und kannst du
ändern. Sonst lässt sich hier nichts bearbeiten — das Tagebuch schreibt ein
Agent."* For a guest that is true. For a buddy it is false in the one direction
that matters: he **is** one of the people that agent writes for, and the
sentence reads as a closed door. Beside it the trip list says only *"Asien
2025 — du warst auf dieser Reise dabei"*, past tense, no link to anything he
could act on.

**The panel that would tell him is gated on ownership.**
`app/[user]/me/MePageContent.tsx:253` is `{viewer.owner && (…)}`, and inside it
is everything about writing: `me.ownerTitle`, `AgentHandover`,
`me.tokenTitle` / `me.tokenBody` / `me.tokenWarning`, and `AgentKeys` for
revocation. A buddy is not `viewer.owner`, so he sees none of it — not the
explanation of what an agent token is, not a way to get one, not a way to take
one back.

The page already knows he is a buddy and does not use the fact.
`resolveViewer` (`lib/viewer.ts`) distinguishes `through: "traveller"` from
`"guest"` — that distinction was the whole point of B80 — and the only thing
downstream does with it is choose a sentence in the reason map at
`MePageContent.tsx:96`.

**No mail carries it either.** `approveContact`
(`lib/contacts/index.ts:678`) calls `approveTripPlaces`, writes the grant, and
sends nothing. So the moment a buddy's write access begins is the moment that
is communicated least.

What it costs: the one rule of this project is that the agent is the editor,
and there is no form to fall back on. A buddy who is not told how to reach an
agent has, in practice, no write access at all — the grant exists in the
database and nowhere in his experience. He has to be told out of band by the
owner, who is not told either (B244), and the trip-scoped token — built,
tested in B230 and B231, and the reason `people:` grants what it grants — has
no path to the person it was built for.

Related: B244 is the owner's half of the same silence (approving never says
which trips it opened). B283 built the owner's handover credential and
deliberately excluded buddies from it, for reasons that still hold — see below.

## Work

Give a buddy, on `/{user}/me`, the same three things the owner gets, scoped to
their trip: what they can do, how to hand it to an agent, and how to take it
back.

- Branch the page on `viewer.trips.some((t) => t.through === "traveller")`
  rather than adding a new field — the fact is already resolved.
- Fix `me.detailsBody` first, and separately: as written it is a false
  statement to a buddy. It needs a traveller variant, or a sentence beside it
  that names what they may write.
- Say what a buddy's token is and is not: it writes days into **this trip** and
  cannot publish them, and cannot touch the rest of the journal. That is the
  interesting half of `tripWriteScope` and it is currently written down only in
  `AGENTS.md`, which a buddy never reads. Publishing stays owner-only — B28.
- Give them the address of the trip and of `/agent.md` in a form they can paste
  into an agent, since the guide is the thing that actually teaches the agent
  what to call.

**Corrected while building: "how to take it back" cannot be delivered here.**
The Work above asked for the same three things the owner gets, revocation
included. `GET`/`DELETE` on `/api/v1/{user}/keys` are owner-only
(`app/api/v1/[user]/keys/route.ts:35`), and `AgentKeys` is rendered inside
`{viewer.owner && …}` — so a buddy has no route to the list at all, and giving
them one is a new pairing of a guest cookie against `agent` rows rather than a
UI change. That is **B323**, captured rather than absorbed. What ships here
says the true thing instead: the key stops by itself after seven days, and to
stop it sooner, ask whoever keeps the journal. When B323 lands, that sentence
(`me.buddyKeyWarning`) changes.

**Two decisions this task must make rather than assume.**

*How the buddy gets the token.* Today it is the six-digit code flow —
`POST /api/auth/request` with a trip scope, then `/verify`. That works and
needs no new endpoint; the page could simply explain it. The alternative is
extending B283's handover credential to a buddy, which is the nicer experience
and is what `issueHandover` currently refuses on purpose (`lib/auth/index.ts:764`,
*"Never a guest, and never somebody on a trip"*). Extending it is a security
change, not a UI one: it would need `issueHandover` to carry a scope, and
`exchangeHandover` to mint a scoped agent session rather than a full one, and
it must not become a way for a buddy to obtain a journal-wide token. **Do the
explaining version first**; if the handover is wanted, that is its own task and
its own review.

*Whether a mail goes out on approval.* Attractive — it is the moment the access
begins — but it is the same event B244 is about, and two tasks writing two
mails for one click is how a person gets two mails. Prefer: this task does the
page, and the mail is settled once, in B244 or in a task that supersedes both.
Not doing it here unless B244 is taken at the same time.

Not doing: any change to who may publish, any narrowing of a grant to one trip
(there is deliberately no such mechanism — `lib/grants.ts`), and no editing UI.

## Acceptance

- Signed in as a contact who holds a place on a trip but does not own the
  journal, `/{user}/me` explains that they may write days into that trip and
  how to hand that to an agent, with the trip named. **Revocation is B323's**
  — see the correction above; what this must do is say truthfully how a key
  ends.
- The same page signed in as a guest with no trip place is unchanged: no token
  copy, no agent block.
- `me.detailsBody`, or whatever replaces it for a traveller, no longer asserts
  that nothing here can be edited to somebody who may write to a trip.
- A test in `test/` covers the three viewers — owner, traveller, guest — and
  fails on `main` for the traveller.
- The buddy's route to a token is exercised end to end at least once by hand
  against a running instance, and the resulting token is confirmed to write a
  draft into its trip and to be refused on a second trip in the same journal
  (B231 already covers the refusal; this is the buddy reaching it).
