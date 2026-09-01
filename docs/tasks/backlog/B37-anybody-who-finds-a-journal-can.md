---
id: B37
title: Anybody who finds a journal can put themselves on its guest list uninvited
type: FEATURE
priority: medium
complexity: low
area: contacts, ui, i18n
found: "2026-09-01"
---

# B37 — Anybody who finds a journal can put themselves on its guest list uninvited

## Why

`/{user}/join` (`app/[user]/join/page.tsx`) is an open form. No token, no
secret, reachable by anyone who knows the username, and advertised on the
journal's own `me` page as *"Neu hier? Ins Gästebuch eintragen"*
(`app/[user]/me/MePageContent.tsx:104`, and as the only button at
`:85` when sign-in is off). Filling it in writes a `pending` contact row and
sends a six-digit code.

That was decision 19 and the reasoning holds up on its own terms: the form
grants nothing, everybody who fills it in waits for the owner, so pasting the
link into a group chat is safe. `lib/contacts/invites.ts` says so in its header
table — *an invitation to request, not a grant*.

The objection is not that it grants too much. It is that **the journal
advertises a way in that its owner never offered.** A stranger who finds the
address is shown a form asking for a name, an email and a postal address, and
the owner then has a decision to make about somebody who was never invited —
one they have to make correctly every time, for as long as the journal exists.
The queue is the leak: not access, but the standing invitation and the junk
that follows a public form asking for postal addresses (which is why C15's rate
limit is there at all).

The intended model is narrower and is what the owner already thinks is
happening: **the owner hands out a link, the guest fills in their details, and
the owner still accepts them by hand.** Two of those three steps already exist
and work — the personal link `/{user}/i/<token>` (`resolveInvite`), and the
approval step, since `requestContact` only ever writes `pending` and
`approveContact` (`lib/contacts/index.ts:511`) is the only thing that grants.
Approval stays exactly as it is; nothing in this task makes anybody a guest
automatically.

What has to go is the open door beside them. The copy for the world afterwards
is already written and already shipping: `me.askOwner` — *"Hier gibt es nichts
auszufüllen — dieses Tagebuch führt kein Gästebuch. Der Link, den du bekommst,
lässt dich hinein."* Today it only appears when the contacts capability is off
(`:93`). It becomes the normal case.

## Work

- Remove the open link from the `me` page: both the "Neu hier?" line at
  `MePageContent.tsx:104` and the button form at `:85`. A signed-out stranger
  gets `me.askOwner`, which already says the right thing in every locale.
- Remove `/{user}/join` and `openInviteUrl` (`lib/contacts/invites.ts:50`),
  with its two callers — `app/[user]/contacts/page.tsx:80` and the `openLink`
  field at `app/api/contacts/admin/route.ts:84`. The owner's contacts page
  should offer only the personal link, which it already issues.
- **Close the endpoint, not just the signpost.** `POST /api/contacts/request`
  treats the invite token as optional (`route.ts:94`) and records
  `createdVia: "open"` when there is none (`:110`). Removing the page while
  leaving the endpoint open means the door is still there for anyone who has
  seen the request once. Require a live invite token, and keep the uniform
  `202` for a bad one — a request with a revoked token must not be
  distinguishable from a request with a good one, or the endpoint becomes a way
  to test whether a token is still live.
- `createdVia: "open"` becomes unreachable for new rows. Leave existing rows
  alone: they are the record of how somebody actually arrived, and rewriting
  them to say "invite" would be false.
- Update decision 19 where it is written down — the header table in
  `lib/contacts/invites.ts` and anywhere `docs/` repeats it. This reverses a
  recorded decision, and a decision that quietly stops being true is worse than
  one that was never recorded. Say what changed and why: the open link was safe
  in what it granted and wrong in what it advertised.
- `agent.md` and `documentation.txt` (`lib/api/documentation.ts`) if either
  mentions the open link, so an agent does not hand somebody a dead URL.

Two details that will otherwise be got wrong:

- **An open link already pasted somewhere must not 404.** People have sent
  `/{user}/join` to family. Redirect it to `/{user}/me`, which shows
  `me.askOwner` and tells them to ask the person who sent them — rather than a
  dead end that reads as "the journal is gone". This is the same reasoning
  `app/[user]/s/[token]/route.ts` gives for never landing an expired link on a
  404.
- **`canJoin` stops meaning what it says.** It is `isEnabled("contacts", user)`
  (`app/[user]/me/page.tsx:50`) — the whole contacts capability, not the open
  form. After this, contacts can be on while no open form exists, so the prop
  is either removed or renamed. Leaving a boolean called `canJoin` that no
  longer gates joining is how the next reader reintroduces the form.

Not doing: the approval step, which stays manual and unchanged. The personal
invite link, which is the door that remains. Anything about what a guest may
read once approved — that is B33.

## Acceptance

- `/{user}/join` no longer serves a form; an existing link lands on `/{user}/me`
  with `me.askOwner`, not on a 404.
- A signed-out stranger on `/{user}/me` is offered sign-in and nothing else.
- `POST /api/contacts/request` with no invite token, or a revoked or expired
  one, creates no contact row — asserted by a test — and answers the same as a
  good one.
- The same request with a live invite token still creates a `pending` row, and
  that contact still requires `approveContact` before it can read anything.
- `grep -rn "openInviteUrl\|/join" app lib` returns only the redirect.
- The header table in `lib/contacts/invites.ts` describes one link kind, and
  says why the other was removed.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
