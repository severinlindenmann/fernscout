---
id: B33
title: A journal can be shared only by password or by hand-edited frontmatter, so an agent cannot invite anybody
type: FEATURE
priority: medium
complexity: medium
area: auth, api, contacts, trips, docs
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-03"
---

# B33 — A journal can be shared only by password or by hand-edited frontmatter, so an agent cannot invite anybody

Split: the gate half of this task is B41, which makes an approved contact
actually able to open a trip. This half is the links that get somebody to that
point. B41 first — invite links are worth nothing while approval opens nothing.

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

*Corrected while building this: B39 has since removed the trip password
outright, and B41 made an approved contact the only way into a `guest` trip. So
the password half of this paragraph describes code that is gone. It does not
change what this task is for — it sharpens it. Before B39 there was a bad way
to share a journal; now there is **no** way at all, short of the owner adding a
contact by hand and typing somebody's address into the admin form. The guest
link is not an improvement on the password, it is the only door there is.*

**A travel companion** — somebody who was actually on the bus. They get in by
being in `people:`, which `isPersonOn` reads out of the trip's frontmatter
(`lib/tripPeople.ts:30`). The only way into that list is a person opening
`trip.md` in an editor and typing a name and an address. That same list decides
who may *write* to the trip and who may hold a trip-scoped agent token
(`tripWriteScope`, `lib/tripPeople.ts:43`), so it is not a list to append to
lightly.

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
**other people**. (That is a thematic relationship, not a technical one: B27
touches none of this code and need not gate it.)

## Work

Two link kinds, at two distinguishable URLs, because they grant different
things and a recipient must be able to tell which one they were sent.

- **Guest** — `/{user}/invite/guest/<token>`. Leads to becoming a guest of the
  journal, which B41 defines and enforces. Journal-wide; there is no per-trip
  guest link and none should be added.
- **Buddy** — `/{user}/invite/buddy/<token>`. Leads to being on a trip: able to
  write to it and to hold a trip-scoped agent token.

Put the kind in the path so it is legible in the link itself, and keep it off
`/{user}/i/…`, which already means something else.

### The decisions, settled

**Both link kinds are shareable.** Multi-use, not single-use. A guest link goes
in a family group chat; a buddy link goes to the two people you travelled with.
Holding the link is not what grants anything — proving an address is, and then
the owner approving — so forwarding it widens who may *ask*, which is the same
property the existing open invite already has. Both still need an expiry and a
revoke.

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

**Redeeming proves an address, and then waits for the owner.** The code flow
already exists (`issueCode`, `verifyCode` in `lib/auth`). A buddy link that
granted write access on a click alone would be a link that grants write access
to whoever the group chat was forwarded to.

Redemption does **not** grant. It writes a `pending` contact, exactly as
`requestContact` does today, and `approveContact` remains the only thing that
creates a grant — the owner accepts each person by hand, on the page that
already exists for it. This is what keeps a shareable link safe to share: the
link decides who may *ask*, the owner decides who gets in. It is also decision
19's own reasoning, which survives this task intact even though B37 removes the
open link that decision was written about.

The redemption form must handle **somebody who is already a user here** — a
buddy with their own journal on the same instance is the expected case, not the
edge case. Their address may already be known while a name, phone or postal
address is not, and the form must not ask them to re-enter what the instance
already holds, nor create a second contact record shadowing the first. Decide
what a redemption actually needs (an address, proved; a display name for
`people:`) and ask for nothing else — postal details belong to postcards, not
to being let into a journal. Signed in already? Then redemption should be one
confirmation, not a form.

### The two that were left open, and how they were answered

**A buddy link may be created by the owner and by nobody else.** Not by
somebody already on the trip, which is the alternative the task left open.
Three reasons, and the first is the one that decides it. The queue a redemption
lands in is the *owner's*: B37 removed the open guestbook precisely because a
journal should not put decisions about strangers in front of the person who
owns it, and letting a companion issue links would put them back — the owner
would be approving people they had never heard of, sent by somebody else, with
no way to tell which. Second, approving a buddy also lets that person read the
journal's `guest` trips (see the next paragraph but one), and that is not a
companion's to offer. Third, the codebase already draws this line in the same
place and says why: `POST /api/v1/{user}/trips` refuses a trip-scoped token
with "a guest writing in the book is not a guest starting a new book". Handing
out invitations is the same shape of thing. If this turns out to be wrong the
symptom will be specific and easy to hear — somebody saying "I was on the trip
and I still had to ask you to invite Sam" — and widening it later is a one-line
change to `ownerOnly`; narrowing it afterwards would not be.

**A redemption asks for exactly two things: an address it can prove, and a name
to put beside it.** Nothing else. No postal address, no phone number, no digest
tick — those belong to postcards and the mailing list, they have their own page
at `/{user}/c/<token>`, and a redemption that touched them would be a form
silently rewriting choices somebody made elsewhere. `requestContact` gained a
third meaning for its `address` field to make that possible: an object is "this
is their address now", `null` is "they were asked and gave nothing", and
`undefined` is "they were not asked" and leaves the stored address and the
postcard consent exactly as they are. That is the same distinction
`updateContactSelf` already drew, for the same reason.

Each of the two is then skipped when it is already known:

- **Signed in to this journal already?** The address is proved — the cookie was
  minted by `verifyCode` against a code mailed to it — so there is no email box,
  no second code and no mail. One button. `confirmContactFromSession` is that
  path, and it takes the address off the session and never out of a request
  body, which is the whole of the double opt-in.
- **Known here already?** The name on the existing record stands, prefilled and
  correctable; an empty submission never overwrites it. And there is no second
  record, because `requestContact` is keyed on the address — so somebody who
  already owns a journal on this instance updates the one row this journal has
  for them, and their own journal gets nothing at all.

A session for a **different** journal on this instance is deliberately *not*
treated as proof. Sessions belong to one journal — that is what the
`session.owner` check guards everywhere — and accepting one here would be
inventing an instance-wide identity that nothing else in this codebase has, to
save one email. Such a visitor gets the ordinary form and one code, which is
not a re-registration.

### One consequence, stated rather than buried

**Approving somebody who came through a buddy link also lets them read the
journal's `guest` trips.** There is one approval, not two: the owner is
deciding about a person, and a second button they could forget would leave
somebody who followed a buddy link approved as a reader and silently still not
on the trip. The cost is that a buddy link is the stronger of the two by more
than it looks, so every document that mentions it says so and says it is not
the one to paste into a group chat. Holding a trip back from everyone who is
otherwise let in is still `visibility: private`, and still the only mechanism.

**A redeemed place grants write access, not credit.** `travellersOf`
(`lib/site.ts`) still reads `people:` alone, so a buddy who joined by link
writes to the trip and does not appear in its byline. That is deliberate:
credit is the owner's editorial statement about whose trip it was, made by
typing a name into their own file, and it renders on every page straight from
disk with no database in the path. Write access and credit were one list before
this task and are now two — worth knowing rather than papering over. An owner
who wants a buddy in the byline types them into `people:`, which is exactly the
act the credit is supposed to represent.

### To build

- `POST /api/v1/{user}/invites` — owner-authenticated. Returns the URL, the
  kind, the scope (the journal, or a trip ref), the expiry and the id. The
  token is returned once and stored hashed, as `createInvite` already does.
- `GET` and `DELETE` alongside it, to list and revoke — the point of leaving
  the shared password behind is cutting one person off without cutting off
  everyone.
- Redemption routes for both kinds, landing somewhere that explains what just
  happened — including for somebody who redeems and is then waiting on the
  owner, who otherwise sees a form that appeared to do nothing.
- The buddy path has to make `peopleOf` (`lib/tripPeople.ts:18`) merge the
  frontmatter list with redeemed rows, which is the one place this task reaches
  into code B41 does not touch.

Documentation, in the same change rather than after it: `agent.md` and both
`documentation.txt` surfaces come from `agentGuide()` in
`lib/api/documentation.ts`; then `openapi.json`
(`app/openapi.json/route.ts`), the MCP tool list (`lib/mcp/tools.ts`), and the
network-doors table in `AGENTS.md`. Say plainly that a buddy link grants write
access and is not the one to paste into a group chat.

Depends on B41 (the gate) and B37, which removes the open guestbook form and
makes an owner-issued link the only way to reach the request form at all. This
task's guest link is that owner-issued link, so the two describe the same door
from two ends and should not invent two mechanisms for it.

Not doing: trip passwords, untouched here and removed by B39. The `guest` /
`private` semantics and the gate itself, which are B41. The contacts invites in
`lib/contacts/invites.ts`. Owner-facing management UI beyond what a redemption
needs. Showing a shared trip inside the buddy's *own* journal — that is B34.

## What was built

- `010-invite-links`: `contact_invites.trip_id` comes back — deliberately, and
  the migration argues with 007, which dropped it. 007 was right about the
  column it removed (a per-trip *read* grant, a dimension nothing wrote and
  B41 settled the other way); this one says which trip a **buddy** link joins,
  and there is nowhere else to put it, because the token is the only thing the
  recipient holds. `access_grants` is left journal-wide, untouched.
- `trip_people`: the second source `peopleOf()` merges. `granted_at` null is a
  *request*, which reads as no access at all; `approveContact` fills it in.
- `lib/tripPeople.ts` is now async, and the sync half is exported separately as
  `peopleNamedIn` — the file's own list, documented as **not** the access
  check. `isPersonOn` reads the file first and only queries when the file says
  no, so the owner's own pages cost nothing. Two list renderers (`resolveViewer`,
  `listableTrips`) use `redeemedTripsFor` instead, one query for a whole page.
- `POST/GET /api/v1/{user}/invites` and `DELETE …/{id}`, guarded by `isOwner`,
  which takes the owner's bearer token **or** their session cookie — the two
  credentials decision 24 gives them. The cookie is what B79's copy-a-link
  control will use, and `SameSite=lax` is what makes it safe to accept.
- `POST /api/contacts/redeem`, and the two landing pages. `/api/contacts/confirm`
  is reused for the six digits, so there is one code mechanism on the site.
- A buddy token is refused at `/{user}/i/<token>` and at
  `/api/contacts/request`. That door records nothing about a trip, so accepting
  one there would have quietly turned "come along on the bus" into "add me to
  the mailing list" — approved, still unable to write, and nothing to say why.
- `create_invite`, `list_invites` and `revoke_invite` over MCP; the two
  endpoints in `openapi.json`; a section in `agentGuide()`; the network-doors
  table and the `people:` note in `AGENTS.md`. The guide's old sentence — *"a
  person adds themselves there, you cannot"* — was true and is not any more,
  and has been corrected rather than left.

Found on the way and **not** absorbed: **B87**, revoking somebody's access
leaves every agent token already issued to them working until it expires.
`mayWriteTrip` reads a scope string frozen into the session at issue time and
never asks the database again, so a revoked buddy keeps writing for up to seven
days. Not caused by this task — a name removed from `people:` by hand has
always had the same effect — but this task is what makes it matter, because
revoking is now one click and an owner will expect it to have happened.

## Acceptance

- `POST /api/v1/{user}/invites` returns a guest link and a buddy link; each
  token appears in the response exactly once and is stored only hashed.
- Redeeming a guest link, from a cold browser, creates a `pending` contact and
  grants nothing; after the owner approves, that address reads every `guest`
  trip in the journal.
- A redeemed but unapproved guest reads no more than an anonymous visitor,
  asserted by a test.
- Redeeming a buddy link, once approved, ends with that address able to write to
  that trip and refused against another trip in the same journal, both asserted.
- Redeeming either link as somebody who already owns a journal on this instance
  does not create a duplicate contact and does not re-ask for what is known.
- Both links still work on a second use, from a second browser.
- A revoked link stops working while everyone already let in stays in.
- Presenting an invite token as `Authorization: Bearer` is refused.
- `curl localhost:3000/agent.md` describes both kinds; `openapi.json` lists
  the endpoints.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
