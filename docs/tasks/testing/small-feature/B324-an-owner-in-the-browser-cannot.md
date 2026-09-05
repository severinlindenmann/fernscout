---
id: B324
title: An owner in the browser cannot send an invitation by mail, only an agent can
type: FEATURE
priority: medium
complexity: low
area: contacts, ui
found: "2026-09-04T17:26:38Z"
merged: "2026-09-05T17:13:16Z"
---

# B324 — An owner in the browser cannot send an invitation by mail, only an agent can

## Why

> **Built by B384, 2026-09-05 — moved to `testing/` rather than closed.**
> The owner's own form at `/<user>/contacts` posts `action: "create"` with a
> name and an address; the route mints a guest invite, dates it, mails it with
> `sendInviteMail`, and records `createdVia: invite:<id>` so the address is
> pre-approved when it confirms. A `resend` button covers a mail that did not
> arrive, and the guest list still shows the link itself (B280).
>
> Two of this task's three acceptance clauses are readable in the code. The
> middle one — that the **owner** is told the address is pre-approved — is a
> question about what the page says, and nobody has looked. That is why this
> is in `testing/` and not `completed/`.

B319 built mailing an invitation and pre-approving the address: an owner tells
an agent to invite somebody, and the letter goes out in that person's language
with a grant waiting for whoever proves the address.

It built the capability and the REST door. The owner's own page did not get it.
`components/ContactsAdmin.tsx`'s "new link" form still offers only kind, trip,
name, locale and days — no address, no "send it". So an owner sitting at
`/<user>/contacts` can create a link and copy it by hand, exactly as before,
while the same owner talking to an agent gets the letter sent for them.

That is a defensible place to stop — this project's premise is that the agent
is the editor, and B319's acceptance was written about the agent path. But the
contacts page is one of the few genuinely interactive surfaces here, and it is
where an owner goes when they are *not* mid-conversation with an agent. The
asymmetry will read as a missing feature rather than as a decision.

## Work

Add the address field and a "send it" control to the invite form in
`components/ContactsAdmin.tsx`, posting to the door B319 already built —
`POST /api/v1/<user>/invites` with `email`. Nothing new server-side.

Two things to get right rather than assume:

- **Say what sending does.** The address is pre-approved, so whoever proves it
  is admitted without appearing in the queue below. An owner clicking "send"
  should know that, in the form, before they click it — it is the one place
  the consequence is invisible.
- **A send failure still leaves a usable link.** B319's response carries
  `sent: false` and the link either way; the form must show the link rather
  than reporting a failure and swallowing it.

All three locales, and check the register the rest of that component uses.

## Acceptance

An owner at `/<user>/contacts` can invite somebody by address without an
agent, is told that the address is pre-approved, and still gets a copyable
link if the mail did not go.
