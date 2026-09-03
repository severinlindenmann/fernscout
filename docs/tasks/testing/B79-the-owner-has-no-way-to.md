---
id: B79
title: The owner has no way to hand somebody an invite link from the site
type: FEATURE
priority: medium
complexity: low
area: me, access, ui, i18n
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-03"
---

# B79 — The owner has no way to hand somebody an invite link from the site

The frontend half of B33. B33 built the guest and buddy links and the API that
issues them, and said in its own scope line that owner-facing management UI is
not its job. This is that UI.

**B33 has since merged, so the tense of what follows has changed.** Everything
this file described as missing at the API level exists:
`POST /api/v1/{user}/invites` answers with `{id, kind, scope, trip, url,
expiresAt}` and the token exactly once; `GET` lists what has been issued and
never a token; `DELETE …/invites/{id}` revokes. `isOwner` was deliberately
written to accept the owner's **session cookie** as well as a bearer token
(`lib/contacts/session.ts`), precisely so a control on a page the owner is
reading in a browser can call it — which is the whole mechanism this task
depends on and is now asserted directly in `test/invite-links.test.ts`.

What was missing was never the endpoint, then. It was that the site never
mentioned it: an owner reading their own journal on a phone had no way to learn
those links exist, let alone produce one.

## Why

Somebody has just been shown their journal and wants to let their sister read
it. There is no control anywhere on the site that produces a link for her.

The access panel — `/{user}/me` — is where a person goes to answer "who can see
what", and for the owner it already has a block that does exactly this shape of
thing for a different audience: the owner block hands over the agent address
and the owner's email with a `CopyLine` beside them — since B75 that is
`components/AgentHandover.tsx`, drawn from `MePageContent.tsx` — because the
panel's job is to give you the string you are going to paste somewhere else.
What it hands over is the door for *agents*. The door for *people* is missing
from the same block.

The nearest thing that exists is the contacts admin at `/{user}/contacts`.
`ContactsAdmin.tsx:724` prints a freshly created contact invite as a bare
`<code>` element with no copy button — on a phone that is a select-and-drag
operation over a long token — and older links cannot be shown again at all,
because the token is stored hashed and returned once; the list beneath offers
only revoke. That page is also a different thing: those are decision 19's
*personal* links, an invitation to join a mailing list, which is deliberately
distinguished from being let into the journal.

So without this, inviting a person from the site means either giving out a trip
password that cannot be revoked for one person (B39 removes it) or editing
`people:` in `trip.md` by hand. Neither is something the owner can do from
their phone, which is where they are standing when their sister asks. The third
way now exists — ask an agent to call the endpoint — and it is not an answer
either: it needs an agent to hand, and the person this is for is the one who
has never seen the folder.

## Work

Extend the owner block in `MePageContent.tsx` — the one already gated on
`viewer.owner` — with the two link kinds B33 defines, each created on demand
and each copied with the existing `CopyLine`.

- **Guest link** — journal-wide, one control, no scope to choose.
- **Buddy link** — trip-scoped, so it needs a trip to be chosen. The trips are
  already on the page: `viewer.trips` is rendered right above under
  *"What you can read"*. Reuse that list rather than fetching a second one.

The two must not read as the same button with a different word. The panel is
written for the reader least comfortable with software (the docblock at
`:13–25`), and the sentence that matters is the one B33 asks for in the docs:
a buddy link lets somebody **write** to the trip, a guest link only lets them
**ask to read**. Say that next to the buttons, in words, not in a tooltip.

Say the same thing the API guarantees and no more: the link does not let
anybody in — it lets them ask, and the owner still approves each person. An
owner who believes a forwarded guest link granted access will hand it out
differently than one who knows it did not.

Show the link once, when it is created, exactly as the token allows — and say
so, so nobody closes the panel expecting to find it again.

### Decided: issue and copy, and no list of live links

The open question was whether the panel should also list live links so they can
be revoked from it. It does not, and the reasoning is worth keeping because the
argument against is real: revoking from a phone is half of what leaving the
shared password behind is *for*, and `DELETE …/invites/{id}` was built.

Three things settled it.

**There is already a list, and it is one tap below the new buttons.**
`/{user}/contacts` renders `listInvites()`, which returns every kind, each row
with a revoke button — B33's guest and buddy links included, without anything
being added. The panel links straight to it, under the same capability gate.
A second list on `/{user}/me` would be a second view of one table, and the two
would disagree the first time either changed.

**A list here would have to be honest about the same thing twice.** A live link
cannot be shown again, so a list can only offer a row and a revoke button — it
cannot do the thing an owner opening the panel would expect of it, which is to
get the link back. Showing rows that cannot answer the question they invite is
how the access panel already misleads people; the docblock at
`MePageContent.tsx:14–26` is a promise of *few controls*.

**The panel is written for the reader least comfortable with software.** Two
buttons and two sentences is a page she can finish. The same block with a table
of tokens, dates and use-counts underneath is an admin screen, and B41's lesson
is that this page suffers most when it starts computing things of its own.

That leaves the case the argument for a list rests on: the owner who sent a
writing link to the wrong person and wants it dead. They can, from the guest
list, today — but they cannot currently tell **which row is which**, because
the admin list drops `kind` and `tripId` and renders both new kinds as
`— · — · used 0 times`. That is a real defect and it is in a different file, so
it is captured rather than absorbed: **B97**. Until it is fixed the escape
hatch is legible only to somebody who counts rows, which is an argument for
fixing B97 and not for growing a second list here.

Nothing here for a viewer who is not the owner. Copy goes in all three of
`content/locales/{en,de,hu}.json` plus the key union in `lib/i18n.ts`, and
`npm run i18n:keys` must pass.

Watch the interaction with **B74**, since merged, which changed what this same
owner block offers when a capability is switched off. The same rule applies
here: if the journal cannot issue invites, offer no button.

**Which capability, checked rather than guessed:** the invite endpoints are
gated on `isEnabled("contacts", user)` and answer 404 otherwise — because a
redemption writes a `pending` contact and a journal with contacts off has no
queue for one to land in (`app/api/v1/[user]/invites/route.ts`, `guard()`).
There is no separate invite switch. So this reuses the `contactsEnabled` prop
B74 already resolves on the server in `app/[user]/me/page.tsx`, and adds no
second flag.

### What was built

- `components/InviteLinks.tsx` — new. Two blocks, two sentences, two buttons,
  one `CopyLine`; the trip select is fed from `viewer.trips`. Extracted rather
  than inlined, following `AgentHandover` (B75).
- `app/[user]/me/MePageContent.tsx` — renders it inside `viewer.owner &&`,
  gated on `contactsEnabled`, above the guest-list link it refers to.
- `content/locales/{en,de,hu}.json` — sixteen keys under `me.invite*`, plus the
  regenerated union in `lib/i18n.ts`.
- `test/access-panel.test.tsx` — what the panel says, and who sees it.
- `test/invite-links.test.ts` — the cookie-only call the panel makes.

Not doing: B33's endpoints, tokens or redemption pages. The contacts admin page
and its mailing-list invites. Anything that sends mail — the owner copies a
link and sends it themselves.

## Acceptance

- An owner, on a 390px-wide viewport, can get a guest link and a buddy link for
  a named trip out of `/{user}/me` and onto the clipboard, each in one press.
- The panel states in plain language that a buddy link grants write access and
  that a guest link grants nothing until the owner approves.
- A signed-in guest, a traveller and an anonymous reader see none of it,
  asserted by a test.
- A journal that cannot issue invites shows no control rather than a failing
  one.
- `npm run i18n:keys`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`,
  `npm run build`.
