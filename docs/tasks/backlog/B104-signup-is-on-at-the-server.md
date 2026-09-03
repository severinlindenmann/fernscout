---
id: B104
title: Signup is on at the server and off in every journal, so no account has ever been created on the live site
type: CHORE
priority: medium
complexity: medium
area: signup, ops, capabilities
found: "2026-09-03"
---

# B104 — Signup is on at the server and off in every journal, so no account has ever been created on the live site

## Why

`/api/health` reports `signup` enabled at the server and disabled in every
single journal — `not enabled by example`, `by sevi`, `by sevi2`, `by test1`.
The route that turns a stranger into the owner of a journal
(`app/api/auth/signup/request`, `/verify`, `POST /api/v1/journals`) has
therefore never run on the live site, and it is the one path where the person
on the other end has no context, no folder, and nobody to ask.

Four filed tasks are what a first real signup walks straight into: B32 (a
taken username answers 409 with no route onward for somebody who already owns
it), B92 (one address may own three journals, and deleting one does not give
the name back), B55 (the signup token is documented single-use and is not),
and B75/B76 (a brand-new owner with no trips is told to ask whoever sent them
here for an invitation, and shown four zeroes). Every one of those is invisible
until somebody who is not already an owner tries it.

## Work

Enable signup for the journal level the flow needs — check `lib/capabilities.ts`
and the per-user config for which switch actually gates it — then go through it
as a stranger, with an address that owns nothing here:

- sign up, pick a username, land in the new journal, and look hard at what an
  empty journal shows a person who has just arrived (B75, B76);
- try a username that is already taken (B32);
- try the same address a second time (B92);
- try re-using the signup token after it has been redeemed (B55).

Then clean up through the documented path rather than by hand:
`DELETE /api/v1/<user>` answers `202` and mails a single-use link to a page
with a button, and only the button deletes (`lib/deletions.ts`). That exercises
B38 and the tombstone at the same time — check afterwards that the old URLs
answer `410` and the name stays reserved.

Standing rules for this run: any secret goes in `/etc/fernscout/env` and
nowhere else — never `content/config.json`, never a commit, never echoed back
into a chat. Work in a journal created for this, with days carrying
`test: true`, and do not write into a journal somebody is actually using.
Leave the instance as you found it, or say in this task what you left switched
on. Every defect becomes its own backlog task referencing this id — do not fix
anything here, so the finding and the fix stay separate records. B101 is the
same shape: an engagement whose output is other tasks.

## Acceptance

- A signup completed on fernscout.ch by an address that was not already an
  owner, with what each step showed recorded.
- B32, B55, B75, B76 and B92 each confirmed or contradicted.
- One backlog task per new defect, referencing B104.
- The test journal deleted through the mail-gated flow, its URLs answering
  `410`, and its name shown still reserved.
