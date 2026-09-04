---
id: B348
title: The agent-code mail tells a buddy the token writes to "your journal", when it writes one trip in somebody else's
type: ISSUE
priority: high
complexity: low
area: mail
found: "2026-09-04T19:57:10Z"
started: "2026-09-04T20:02:31Z"
merged: "2026-09-04T20:17:06Z"
---

# B348 — The agent-code mail tells a buddy the token writes to "your journal", when it writes one trip in somebody else's

## Why

The agent-code mail sent to a buddy says the code becomes "a token that can
write to **your journal** for seven days".

Both halves are wrong for a buddy. It is not their journal — it belongs to
somebody who let them onto one trip — and the token does not write to the
journal: its scope is `write:trip:<id>`, and every other trip in the journal
answers `unknown_trip`.

Observed 2026-09-04 on fernscout.ch: `buddy@severin.io`, holding a place on
`balkans-2026` in a journal owned by somebody else, received that sentence
verbatim.

The mail is the one place this person is told what they are about to hand an
agent, so telling them it is theirs and journal-wide is the opposite of what
the scoping is for.

## Work

The code request already carries the trip (`POST /api/auth/request` with
`trip`), so the mail can say "one trip in {title}" and name it, against the
journal-wide sentence the owner still gets.

## Acceptance

Request an agent code as somebody on a trip rather than the owner. The mail
names the trip and does not call the journal theirs. The owner's own code mail
is unchanged.
