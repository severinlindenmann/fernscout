---
id: B105
title: Contacts is on at the server and off in every journal, so no invitation has ever been carried through on the live site
type: OPS
priority: medium
complexity: medium
area: contacts, invites, ops, capabilities
found: "2026-09-03"
related: B102, B103, B104, B106, B107, B108, B109, B110
---

# B105 — Contacts is on at the server and off in every journal, so no invitation has ever been carried through on the live site

## Why

`/api/health` reports `contacts` enabled at the server — so
`CONTACTS_ENCRYPTION_KEY` is set and the database is there — and disabled in
every journal. The guest list, the two invite links and the approval queue
have never carried anybody on the live site.

AGENTS.md makes two firm claims about this surface. That a guest link and a
buddy link are different things to hand over, one of them safe to forward into
a family group chat and one of them write access to a trip. And that
`approveContact` is the only thing in the codebase that creates a grant, so an
invite is an invitation to *ask*, never access itself. Neither claim has been
tested against the running site.

Nine tasks on this path are in `testing/`, merged and unverified: B33, B37,
B41, B44, B45, B74, B79, B80, B97. B98 is in backlog and is the ugly one —
revoking somebody's access leaves every agent token already issued to them
working until it expires.

## Related

One campaign, not nine tasks: every capability this instance can switch on,
driven once against fernscout.ch by somebody who can read the answer. They
share the standing rules, the test journal and the rule that every defect
becomes its own capture. The order is forced — B102 first (everything else
arrives by mail), then B103, and the rest in any order. B101 is the same
shape pointed at the gate rather than the feature.

## Work

Enable contacts for a test journal that has both a `guest` trip and a
`private` trip in it — the distinction between them is the thing most worth
proving, because it is what a person gets wrong at the moment they create a
trip.

- issue a guest link and a buddy link, both from the site (B79) and over
  `POST /api/v1/<user>/invites`;
- open each from a different browser and a different address, prove your
  address, and go through the owner's approval queue;
- check the approved guest sees exactly the `guest` trips and never the
  `private` one (B45), that they are not then asked for a password nobody gave
  them (B41), and that somebody arriving without their link has a way to say
  who they are (B44);
- check the access panel tells the owner the truth about who is on what (B74,
  B80) and distinguishes a reading link from a writing link (B97);
- on the buddy side: confirm the person can write to the named trip, cannot
  publish, cannot touch any other trip, and does not appear in the byline —
  credit is the file and is rendered from disk;
- revoke, and then check carefully what still works (B98).

Standing rules for this run: any secret goes in `/etc/fernscout/env` and
nowhere else — never `content/config.json`, never a commit, never echoed back
into a chat. Work in a journal created for this, with days carrying
`test: true`, and do not write into a journal somebody is actually using.
Leave the instance as you found it, or say in this task what you left switched
on. Every defect becomes its own backlog task referencing this id — do not fix
anything here, so the finding and the fix stay separate records. B101 is the
same shape: an engagement whose output is other tasks.

## Acceptance

- Both link types issued, opened, and approved on fernscout.ch, with a second
  identity that is genuinely not the owner.
- The `guest`/`private` boundary demonstrated, not assumed — a request from the
  approved guest for the private trip, and what came back.
- B33, B37, B41, B44, B45, B74, B79, B80 and B98 each confirmed or contradicted.
- One backlog task per new defect, referencing B105.
- Every grant revoked and the test journal deleted at the end.
