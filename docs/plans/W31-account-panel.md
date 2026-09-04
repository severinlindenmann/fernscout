# W31 — "What can I see?"

## Why

A guest today has no way to find out what they have access to. They follow a
link from an email, and if they lose the email they are lost. Some of them are
not going to go looking through a menu — the audience for this includes
grandparents who use it once a month.

## What it is

One panel, reachable from the header, showing only what is true for the person
looking:

- **Not signed in** — one line and a link to `/join`. Nothing else.
- **A guest** — their name, the journals and trips they may read as a guest,
  and their own details: name, language, postal address. Editable, because
  their address is theirs. Nothing else on the site is editable, and the panel
  says so rather than hiding it.
- **A person on a trip** (W26) — the trips they are on, and a short block of
  text to hand to an agent to write a day or start a new trip. Copyable, like
  the landing page's handover card.
- **The journal's owner** — the above, plus the contacts admin already at
  `/<user>/contacts`.

## Deliberately not

No trip creation form. No entry editing. This stays true: writing happens
through an agent, and the panel's job is to tell you what to hand it.

## Work

1. `lib/viewer.ts` — one resolver: who is this request, and what may they see.
2. `/[user]/me`, plus a header entry that only appears when there is something
   to show.
3. Address editing reuses `/api/contacts/manage`, which already exists and
   already works without a login via the mail token.
4. Large type, high contrast, few controls. This is the one page whose users
   are not comfortable with software.

## Acceptance

- A stranger sees an invitation, not an empty page.
- A guest sees exactly the trips they may read, and can change their address.
- A person on a trip sees the agent handover text.
- Nothing on the panel can edit an entry.
