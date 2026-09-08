---
id: B946
title: The owner's session stops being recognised partway through a sitting
type: ISSUE
priority: medium
complexity: medium
area: auth, session
found: "2026-09-08T10:45:26Z"
started: "2026-09-08T20:19:13Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T20:19:13Z"
---

# B946 — The owner's session stops being recognised partway through a sitting

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Reported from outside, driving the live site: a cookie session that had been
answering as the owner for several calls began returning `not_your_journal`
partway through the sitting, twice, with nothing done to it in between. The
tester fell back to the six-digit code flow both times and could not pin the
cause down from where they stood.

Not reproduced from inside, and it may be several things — a rotated cookie
whose new value is not on every response, an expiry, a race between two tabs,
or the tester's own client dropping a `set-cookie`. That is what makes it worth
a ticket rather than a fix: an owner who is quietly signed out mid-sentence
reads it as the software being broken, which is what B807 already found once
and answered for a different cause.

## Work

Reproduce it first, and do not fix anything until it is reproduced. `journalctl
-u fernscout` for the sitting, `resolveSession`, and whether any response on the
owner path can carry a rotated `fs_session` that a client would not pick up.

If it turns out to be the client, close it as superseded and say so — that is a
real answer.

## Acceptance

Either a reproduction with the sequence that causes it, or the finding that
there is nothing here.
