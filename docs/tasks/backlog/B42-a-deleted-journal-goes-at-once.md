---
id: B42
title: A deleted journal goes at once, with no grace period to change your mind
type: FEATURE
priority: medium
complexity: high
area: journals, jobs, deploy
found: "2026-09-01"
---

# B42 — A deleted journal goes at once, with no grace period to change your mind

## Why

B38 shipped deletion for a journal and for a trip. Both are gated behind a mail
to the owner and a button on a page, and both happen the moment that button is
pressed. There is no window in which a person who pressed it by mistake can
take it back.

B38 considered a seven-day grace period — marked for deletion, gone in a week,
any sign-in cancels it — and decided against it, for one reason that is worth
repeating here because it is the thing that has to change first: **nothing on
this stack runs scheduled work.** `deploy/fernscout-worker.service` says in its
own header "Nothing enqueues work yet", `npm run worker` is not a script in
`package.json`, and nothing drains the `jobs` table. A seven-day expiry that no
process reaches is worse than no grace period at all: the owner is told their
journal is gone, every URL answers `410`, and the content sits on disk for ever.

So this is blocked on a worker, and it is not only blocked on one — it also
wants a state (`marked for deletion`) that nothing else in the codebase has,
and every reading path has to agree on what that state means.

What B38 did instead, and what a grace period would still add on top:

- The full export (`"all"` scope — private trips and drafts included) is
  offered in the mail and above the button on the confirmation page. Somebody
  who takes it can be restored by hand.
- `content/.deleted/<username>.json` records the exact timestamp, so an
  operator restoring from `deploy/fernscout-backup.timer` knows where to
  restore to.

Neither helps the person who pressed the button, read the mail again an hour
later, and did not take the export.

## Work

Not designed. The shape to think about, once there is a worker:

- A marked-for-deletion state that every reading path honours — the journal
  answers `410` from the moment it is marked, not from the moment it is swept,
  or the window is one in which a stranger can still read what somebody asked
  to have removed.
- A cancel link in the same mail as the confirmation link, and cancellation on
  any successful owner sign-in.
- A sweep that actually runs, and a check in `/api/health` that says when it
  last did — a grace period nobody can see the expiry of is a promise with no
  evidence behind it.
- What happens to the tombstone and the reserved username in the window: the
  name must stay unavailable while the journal is only marked, or a cancelled
  deletion could find its own name taken.

## Acceptance

TODO — depends on the worker, which does not exist yet.
