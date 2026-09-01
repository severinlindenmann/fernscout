---
id: B79
title: The owner has no way to hand somebody an invite link from the site
type: FEATURE
priority: medium
complexity: low
area: me, access, ui, i18n
found: "2026-09-01"
---

# B79 — The owner has no way to hand somebody an invite link from the site

The frontend half of B33. B33 builds the guest and buddy links and the API that
issues them, and says in its own scope line that owner-facing management UI is
not its job. This is that UI, and it cannot ship before B33 does — there is
nothing to copy until the endpoint exists.

## Why

Somebody has just been shown their journal and wants to let their sister read
it. There is no control anywhere on the site that produces a link for her.

The access panel — `/{user}/me` — is where a person goes to answer "who can see
what", and for the owner it already has a block that does exactly this shape of
thing for a different audience: `app/[user]/me/MePageContent.tsx:142–186` hands
over the agent address and the owner's email with a `CopyLine` beside them
(`:154`), because the panel's job is to give you the string you are going to
paste somewhere else. What it hands over is the door for *agents*. The door for
*people* is missing from the same block.

The nearest thing that exists is the contacts admin at `/{user}/contacts`.
`ContactsAdmin.tsx:723` prints a freshly created contact invite as a bare
`<code>` element with no copy button — on a phone that is a select-and-drag
operation over a long token — and older links cannot be shown again at all,
because the token is stored hashed and returned once (`app/api/contacts/admin/route.ts:124`);
the list beneath offers only revoke. That page is also a different thing: those
are `lib/contacts/invites.ts` links, an invitation to join a *mailing list*,
which decision 19 is careful to distinguish from being let into the journal.

So today, inviting a person means either giving out a trip password that cannot
be revoked for one person (B39 removes it) or editing `people:` in `trip.md` by
hand. Neither is something the owner can do from their phone, which is where
they are standing when their sister asks.

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
so, so nobody closes the panel expecting to find it again. Whether the panel
also lists live links for revoking is a decision for this task: B33 builds
`GET` and `DELETE`, and revoking from a phone is half the reason for leaving
trip passwords behind, but it is also the point where this stops being a copy
button and becomes an admin screen. Lean small; the contacts page is where a
management list belongs if one is wanted.

Nothing here for a viewer who is not the owner. Copy goes in all three of
`content/locales/{en,de,hu}.json` plus the key union in `lib/i18n.ts`, and
`npm run i18n:keys` must pass.

Watch the interaction with **B74**, in development, which is changing what this
same owner block offers when a capability is switched off. The same rule
applies here: if the journal cannot issue invites, offer no button — a control
that leads to a form that cannot work is the bug recorded at
`MePageContent.tsx:76–84`.

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
