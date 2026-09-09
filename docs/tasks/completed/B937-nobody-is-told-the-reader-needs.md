---
id: B937
title: Nobody is told the reader needs a second sign-in after approval
type: ISSUE
priority: high
complexity: low
area: contacts, agent
found: "2026-09-08T09:12:39Z"
started: "2026-09-08T09:12:40Z"
merged: "2026-09-08T09:29:08Z"
completed: "2026-09-09T16:46:19Z"
---

# B937 — Nobody is told the reader needs a second sign-in after approval

## Why

The invitation now works, and the reader's path has a step nobody is told about.

After the owner sends a guest link, the reader: opens it, gives her name, proves
her address with a mailed code — and lands at `status: "pending"`. The owner
then approves her on the contacts page. **And she still cannot read anything**,
because confirming a contact who was not pre-approved sets no session cookie
(`app/api/contacts/confirm/route.ts` — only a pre-approved, owner-mailed invite
does). She has to run the ordinary sign-in separately: request a code, fetch it,
verify it.

Four steps outside the conversation, and the last one is invisible. From the
tester, in character:

> "Nothing told me my daughter would need to open a second, ordinary sign-in
> email after I approved her. If she'd given up after the 'warte auf Freigabe'
> screen — reasonable, most people would — she'd never have gotten in, and the
> chat would never have told either of us that a step was missing."

The mechanism is correct: a pending contact should not hold a session. What is
missing is that anybody says so.

## Work

Say it in both directions.

- **To the owner**, when the link is handed over: after you approve her she gets
  one more mail with a sign-in code, and she needs that too.
- **To the reader**, on the "you are in the queue" screen: when you are let in,
  you will get a mail with a code — that is the one that opens it.
- Ideally, **approving somebody sends that mail**, so the last step arrives
  instead of having to be sought. Check whether `approveContact` already mails
  and what it says; B798's one-click confirmation is the mechanism to reuse.

## Acceptance

A reader who follows every instruction reaches the journal without anybody
guessing that a step exists.
