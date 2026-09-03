---
id: B103
title: Sign-in is switched on at fernscout.ch and no one has been through the code flow there end to end
type: CHORE
priority: high
complexity: medium
area: auth, ops, capabilities
found: "2026-09-03"
---

# B103 — Sign-in is switched on at fernscout.ch and no one has been through the code flow there end to end

## Why

`/api/health` reports `auth` enabled on the server. Auth is the gate in front
of everything an agent may write, and nothing records that a person has been
through the flow on the deployed instance: `POST /api/auth/request` → a
six-digit code by mail → `/api/auth/verify` → a 7-day token that arrives in
`Authorization: Bearer` and nowhere else. Guest sessions are cookies and the
two must never be interchangeable — that is decision 24, enforced in
`resolveSession()`, and reading the site on a phone must not put a write
credential in your pocket.

Five merged tasks are sitting in `testing/` on exactly this surface, waiting
for somebody to try them: B40 (a six-digit code expires in ten minutes, which
is shorter than people take to find the mail), B55 (a signup token documented
as single-use and is not), B69 (the one-tap link loses the page you were
trying to read), B29 (an agent handing its owner a working sign-in link), and
B98 (revoking access leaves tokens already issued still working). Merged is
not verified. This task is where that is found out, on the machine that
serves.

Depends on B102 — the code arrives by mail, so mail has to reach you first.

## Work

From outside, against fernscout.ch:

- request a code for an address you control, verify it, and get a token; use
  that token for a read and a write through `/api/v1/…` **and** through
  `/api/mcp`, since the same boundaries have to hold on both doors;
- check the token's lifetime is the 7 days claimed, and what happens on the
  other side of it;
- check a wrong code burns a guess and that five burn the code; check the
  ten-minute expiry against how long the mail actually took to arrive (B40);
- check a trip-scoped token cannot touch another trip, and cannot publish;
- check a guest cookie is refused as a bearer token, and a bearer token is
  refused as a session cookie;
- check logout, and the one-tap sign-in link's landing page (B69).

Not doing: attacking it. Probing for a way past the gate is B101, a separate
engagement against a local instance. This task establishes that the front door
works for somebody holding the key.

Standing rules for this run: any secret goes in `/etc/fernscout/env` and
nowhere else — never `content/config.json`, never a commit, never echoed back
into a chat. Work in a journal created for this, with days carrying
`test: true`, and do not write into a journal somebody is actually using.
Leave the instance as you found it, or say in this task what you left switched
on. Every defect becomes its own backlog task referencing this id — do not fix
anything here, so the finding and the fix stay separate records. B101 is the
same shape: an engagement whose output is other tasks.

## Acceptance

- Each check above recorded with the request made and the response seen.
- An explicit line for each of B29, B40, B55, B69 and B98 saying whether this
  run confirms or contradicts it — those five are in `testing/` and this is
  the evidence they are waiting for.
- One backlog task per new defect, referencing B103.
