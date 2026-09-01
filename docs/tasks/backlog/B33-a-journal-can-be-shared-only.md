---
id: B33
title: A journal can be shared only by password or by hand-edited frontmatter, so an agent cannot invite anybody
type: FEATURE
priority: medium
complexity: high
area: auth, api, contacts, trips, docs
found: "2026-09-01"
---

# B33 — A journal can be shared only by password or by hand-edited frontmatter, so an agent cannot invite anybody

## Why

There are two kinds of person a journal wants to let in, and neither can be
handed a link.

**A guest** — the family this thing is written for. A trip with
`visibility: guest` is opened by a shared password: `verifyTripPassword` in
`app/api/trip-access/route.ts:42`, checked against the `passwordHash` in the
trip's own frontmatter. So sharing means composing a message that says *go
here, and the word is `pinecone`*, and everyone who ever received it holds the
same secret forever. Changing the password is the only revocation there is
(`lib/tripGate.ts:75`, in prose), and it cuts off everybody at once.

**A travel companion** — somebody who was actually on the bus. They get in by
being in `people:`, which `isPersonOn` reads out of the trip's frontmatter
(`lib/tripPeople.ts:30`). The only way into that list is a person opening
`trip.md` in an editor and typing a name and an address. That same list decides
who may *write* to the trip and who may hold a trip-scoped agent token
(`tripWriteScope`, `lib/tripPeople.ts:43`), so it is not a list to append to
lightly.

**Half of this is already built, and is not wired up.** That is the finding
that should shape the work, so it is written out in full:

- `access_grants` (`lib/db/schema.ts:149`) already holds a per-contact read
  grant whose `trip_id` may be `*`, meaning every trip. Journal-wide guest
  access is already the model.
- `approveContact` (`lib/contacts/index.ts:511`) is the only thing that writes
  one, and it always writes `*`. So a contact the owner has approved is
  already, in the database, a guest of the whole journal.
- `resolveViewer` (`lib/viewer.ts:94`) reads it and tells such a person they
  may open every `visibility: guest` trip.
- **`mayReadTrip` never asks.** `lib/tripGate.ts:28` checks `isOpenToLink`,
  then `isTravellerOn`, then the password cookie — and nothing else.
  `isGuestOf` says so outright: *"Identified per-person access lands with the
  contacts work; until then the only way to be a guest is to hold the trip's
  password."*

The consequence is a live inconsistency, not just an absence: an approved
contact is shown a trip in their own viewer panel, clicks it, and is asked for
a password they were never given. Anything built here has to close that first.

The word "invite" is also already taken, and the difference matters.
`lib/contacts/invites.ts` has personal (`/{user}/i/<token>`) and open
(`/{user}/join`) links, and its own header says what they are: *an invitation
to request, not a grant*. They prefill a subscription form. That is decision 19
and it is right for a mailing list. It is not what somebody means when they say
"send my sister the link to the Vietnam trip".

The occasion for all of this is journal creation. `POST /api/v1/journals`
returns a `url` and a `documentation` address
(`app/api/v1/journals/route.ts:147`) and nothing else, so an agent that has
just built somebody a journal has nothing to hand over but a stranger's view.
B27 puts a sign-in link in the welcome mail for the *owner*; B29 asks whether
an agent may relay it. This is the other half — the links the owner sends to
**other people** — and it should follow B27, because the owner's own way in is
the prerequisite for anything they send onward.

## Work

Two link kinds, at two distinguishable URLs, because they grant different
things and a recipient must be able to tell which one they were sent.

- **Guest** — `/{user}/invite/guest/<token>`. Grants reading, **journal-wide**.
- **Buddy** — `/{user}/invite/buddy/<token>`. Grants being on a trip: able to
  write to it and to hold a trip-scoped agent token.

Put the kind in the path so it is legible in the link itself, and keep it off
`/{user}/i/…`, which already means something else.

### The decisions, settled

**A guest is a guest of the journal, not of a trip.** Somebody let in sees
every trip in the journal they would see as an approved contact — which is
what `access_grants` with `trip_id: "*"` already means, and what
`resolveViewer` already reports. There is no per-trip guest link and none
should be added; if a trip needs to be held back from people who are otherwise
let in, that is what `visibility: private` is for.

This does **not** widen `private`. A journal guest sees `public` and `guest`
trips. A `private` trip stays what `AGENTS.md` says it is — the people on it
and the owner — and `mayReadTrip` must keep returning false for a journal
guest. A test should assert exactly that, because it is the one place where
"guests are journal-wide" could quietly become "guests see everything".

**Both link kinds are shareable.** Multi-use, not single-use. A guest link goes
in a family group chat; a buddy link goes to the two people you travelled with.
Holding the link is not what grants anything — proving an address is (below) —
so forwarding it widens who may *ask*, which is the same property the existing
open invite already has. Both still need an expiry and a revoke.

**Grants live in the database, not in `trip.md`.** A redeemed buddy link writes
an `access_grants`-style row rather than editing frontmatter. The argument
against is real and should be recorded: `lib/tripPeople.ts` says the trip's own
frontmatter is the record, and a grant in a database splits that in two, so
`peopleOf` now has to merge two sources and a trip file no longer answers "who
was on this" by itself. It loses anyway, because a stranger's click must not
rewrite a file the owner owns, and because a database row can be revoked,
expired and listed — which is the whole reason for moving off a shared
password. Keep hand-written `people:` working exactly as it does; the merge is
additive.

**Redeeming proves an address.** The code flow already exists (`issueCode`,
`verifyCode` in `lib/auth`). A buddy link that granted write access on a click
alone would be a link that grants write access to whoever the group chat was
forwarded to.

The redemption form must handle **somebody who is already a user here** — a
buddy with their own journal on the same instance is the expected case, not the
edge case. Their address may already be known while a name, phone or postal
address is not, and the form must not ask them to re-enter what the instance
already holds, nor create a second contact record shadowing the first. Decide
what a redemption actually needs (an address, proved; a display name for
`people:`) and ask for nothing else — postal details belong to postcards, not
to being let into a journal. Signed in already? Then redemption should be one
confirmation, not a form.

### To build

- `POST /api/v1/{user}/invites` — owner-authenticated; buddy links may also be
  createable by somebody already on the trip (decide, and say why in this
  file). Returns the URL, the kind, the scope (the journal, or a trip ref),
  the expiry and the id. The token is returned once and stored hashed, as
  `createInvite` already does.
- `GET` and `DELETE` alongside it, to list and revoke — the point of leaving
  the shared password behind is cutting one person off without cutting off
  everyone.
- **Wire `mayReadTrip` to the grant**, closing the inconsistency in *Why*.
  This is the load-bearing change; the endpoints are scaffolding around it.
  `isGuestOf` and the `costsVisibility: guests` path go the same way.
- Redemption routes for both kinds, landing somewhere that explains what just
  happened.

Documentation, in the same change rather than after it: `agent.md` and both
`documentation.txt` surfaces come from `agentGuide()` in
`lib/api/documentation.ts`; then `openapi.json`
(`app/openapi.json/route.ts`), the MCP tool list (`lib/mcp/tools.ts`), and the
network-doors table in `AGENTS.md`. Say plainly that a buddy link grants write
access and is not the one to paste into a group chat.

Not doing: trip passwords, which stay as a second door for people who will
never prove an address. The contacts invites in `lib/contacts/invites.ts`.
Owner-facing management UI beyond what a redemption needs. Showing a shared
trip inside the buddy's *own* journal — that is B34.

## Acceptance

- `POST /api/v1/{user}/invites` returns a guest link and a buddy link; each
  token appears in the response exactly once and is stored only hashed.
- An approved contact opens a `visibility: guest` trip with no password —
  the case that fails today — and a test covers it.
- A journal guest is refused a `visibility: private` trip, asserted by a test.
- Redeeming a guest link, from a cold browser, ends with that address able to
  read every `guest` trip in the journal.
- Redeeming a buddy link ends with that address able to write to that trip and
  refused against another trip in the same journal, both asserted.
- Redeeming either link as somebody who already owns a journal on this instance
  does not create a duplicate contact and does not re-ask for what is known.
- Both links still work on a second use, from a second browser.
- A revoked link stops working while everyone already let in stays in.
- Presenting an invite token as `Authorization: Bearer` is refused.
- `curl localhost:3000/agent.md` describes both kinds; `openapi.json` lists
  the endpoints.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
