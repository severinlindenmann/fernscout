---
id: B33
title: A journal can be shared only by password or by hand-edited frontmatter, so an agent cannot invite anybody
type: FEATURE
priority: medium
complexity: high
area: auth, api, trips, journals, docs
found: "2026-09-01"
---

# B33 — A journal can be shared only by password or by hand-edited frontmatter, so an agent cannot invite anybody

## Why

There are two kinds of person a journal wants to let in, and neither can be
handed a link.

**A guest** — the family this thing is written for. A trip with
`visibility: guest` is opened by a shared password: `verifyTripPassword` in
`app/api/trip-access/route.ts:42`, checked against the `passwordHash` in the
trip's own frontmatter. So sharing a trip means composing a message that says
*go here, and the word is `pinecone`*, and everyone who ever received it holds
the same secret forever. Changing the password is the only revocation there is
(`lib/tripGate.ts:75`, in prose), and it cuts off everybody at once.

**A travel companion** — somebody who was actually on the bus. They get in by
being in `people:`, which `isPersonOn` reads straight out of the trip's
frontmatter (`lib/tripPeople.ts:30`). That is a good design and should stay:
the trip file is the record, there is no second membership store. But the only
way into that list is a person opening `trip.md` in an editor and typing a name
and an address. The same list also decides who may *write* to the trip and who
may hold a trip-scoped agent token (`tripWriteScope`, `lib/tripPeople.ts:43`),
so it is not a list an agent should be appending to unasked.

The word "invite" is already taken by something else, and the difference
matters. `lib/contacts/invites.ts` has personal (`/{user}/i/<token>`) and open
(`/{user}/join`) links, and its own header says what they are: *an invitation
to request, not a grant*. They prefill a subscription form and grant nothing.
That is decision 19 and it is right for a mailing list. It is not what
somebody means when they say "send my sister the link to the Vietnam trip".

The occasion for this is journal creation. `POST /api/v1/journals` returns a
`url` and a `documentation` address (`app/api/v1/journals/route.ts:147`) and
that is all — so an agent that has just built somebody a journal, in a
conversation with them, has nothing to hand over except a public address that
shows a stranger's view. B27 fixes that for the *owner* by putting a sign-in
link in the welcome mail, and B29 asks whether an agent may relay that link.
This task is the other half: the links the owner sends to **other people**.
It should be built after B27 lands, because the owner's own way in is the
prerequisite for anything they send onward.

## Work

Two link kinds, at two distinguishable URLs, because they grant different
things and a reader must be able to tell which one they were sent.

- **Guest** — grants reading. Redeeming it gives a guest session (or a trip
  cookie) that opens `visibility: guest` trips without a password.
- **Buddy** — grants being on the trip: named in `people:`, therefore able to
  write to it and to hold a trip-scoped agent token.

Put the kind in the path so it is legible in the link itself, and keep it out
of `/{user}/i/…`, which already means something. Something like
`/{user}/invite/guest/<token>` and `/{user}/invite/buddy/<token>`; settle the
exact shape in this file before writing routes.

Endpoints to create a link, authenticated as the owner (or, for a buddy link,
as somebody already on the trip — decide which and say why):

- `POST /api/v1/{user}/invites` returning the URL, its kind, its scope (whole
  journal, or one trip ref), and its expiry. The token is returned once and
  stored hashed, exactly as `createInvite` does today.
- A way to list and revoke, since the whole point of moving off a shared
  password is that one person can be cut off without cutting off the rest.

Decisions to make and record here before any code:

- **Does a buddy link write to `trip.md`?** Adding somebody to `people:` means
  editing a file the owner owns, from a stranger's click. The alternative is a
  redemption record in the database that `peopleOf` merges in — which
  contradicts "the trip's own frontmatter is the record". Neither is obviously
  right; pick one and write down the losing argument.
- **What does a buddy link ask for?** `people:` entries carry a name and an
  email. A link cannot know either, so redeeming one is a form, and that form
  is a stranger typing an address into somebody else's trip. It probably needs
  the address proved (the code flow already exists) and possibly the owner's
  confirmation before the entry is written.
- **Single-use or shareable?** A guest link for a family group chat wants many
  uses; a buddy link that grants write access wants one, and probably a short
  life. Defaults should differ by kind.
- **Does a guest link touch trips it was not scoped to?** A link to one trip
  must not open the rest of the journal. Scope belongs in the token record and
  must be checked at `mayReadTrip`, not at the redemption route.
- **Where the gate stays.** Nothing here may widen `visibility: private`, and
  nothing here issues an agent token to a browser — decision 24. A redeemed
  invite lands on the guest side of `resolveSession` in both cases.

Documentation, in the same change rather than after it:

- `agent.md` — generated by `agentGuide()` in `lib/api/documentation.ts`, so
  the endpoints and the guide are one diff. Say what the two links are, that
  neither publishes anything, and that a buddy link grants write access and is
  therefore not the one to paste into a group chat.
- `/documentation.txt` and `/{user}/documentation.txt`, same file.
- `openapi.json` (`app/openapi.json/route.ts`) and the MCP tool list
  (`lib/mcp/tools.ts`), so both doors describe the same feature.
- `AGENTS.md`'s "The network doors" table.

Not doing: any change to what a guest session may read once it has one, any
change to the contacts invites in `lib/contacts/invites.ts`, and any UI beyond
the redemption page a link needs to land on. Owner-facing management screens
are a separate task if they are wanted.

## Acceptance

- `POST /api/v1/{user}/invites` returns a guest link and a buddy link, and the
  token appears in the response exactly once and nowhere in the database in
  plaintext.
- Redeeming a guest link scoped to one trip opens that trip without its
  password, and a test asserts that a second `visibility: guest` trip in the
  same journal is still closed.
- Redeeming a buddy link results in that address being able to write to the
  trip, by whatever mechanism the decision above settles on, and a test
  asserts the resulting write is scoped to that trip and refused against
  another.
- Presenting either invite token as `Authorization: Bearer` is refused, and a
  test asserts it.
- A revoked link stops working while every other link to the same trip keeps
  working.
- `curl localhost:3000/agent.md` describes both link kinds, and
  `openapi.json` lists the endpoint.
- The four checks pass: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`,
  `npm run build`.
