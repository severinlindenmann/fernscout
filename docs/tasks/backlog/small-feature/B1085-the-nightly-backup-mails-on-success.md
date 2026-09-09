---
id: B1085
title: The nightly backup mails on success, so the operator's answer to did it work is a mailbox rather than a page
type: FEATURE
priority: medium
complexity: low
area: ops, backup, admin
found: "2026-09-09T15:47:49Z"
---

# B1085 — The nightly backup mails on success, so the operator's answer to did it work is a mailbox rather than a page

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`deploy/fernscout-backup.service` carries both `OnFailure=` and `OnSuccess=`,
so every night that works sends the operator a mail saying so. Asked for by
the operator: the good-night mail should stop, the answer should live on
`/admin`, and mail should be what a *failure* does.

**B458 added `OnSuccess=` for a real reason and it must not simply be deleted.**
Its argument is written into the unit file: *"A quiet mailbox is otherwise
indistinguishable from a broken alarm — which this deployment has already been
once: `fernscout-alert@.service` was never copied to the server and nobody
noticed for two days, because an alarm that works and an alarm that is absent
send the same number of messages (B138)."*

That argument is answered by a page, not by more mail: if `/admin` shows *when
the last backup succeeded*, then silence stops being ambiguous — the operator
has somewhere to look that distinguishes "nothing to report" from "nothing is
running". The success mail is only the *cheapest* way to prove liveness, not
the only one, and it costs a mail a night forever.

But the replacement has to actually carry that weight, which means the page
must make **staleness** loud rather than merely printing a timestamp. A page
that says "last success 2026-08-14" in the same grey as everything else has
re-created the broken alarm with extra steps.

Today `/admin` shows only ` · backed up 4h ago` appended to a line
(`app/admin/page.tsx:794`), and `lib/adminConsole.ts` already assembles a
backup row with a detail string. The parts are there; the prominence is not.

## Work

- Drop `OnSuccess=` from `deploy/fernscout-backup.service`, keeping
  `OnFailure=`. Rewrite the comment block so it records *why* the success mail
  went and what replaced it — do not delete B458's reasoning, answer it.
- `scripts/alert.sh` keeps writing both stamps. The success stamp is what
  `/admin` reads, and it is written by `scripts/backup.sh` — check whether
  removing the success *handler* removes anything that writes
  `.backup-last-success`, because if it does, the page goes blank and this
  change is worse than useless.
- Give `/admin` a real backup panel: when the last success was, how old that
  is against `maxAgeHours`, the last failure if there is one, and the off-site
  state. It must read visibly wrong when the backup is stale — a state, not a
  sentence.
- `npm run alert` keeps its success path so `scripts/alert.sh` can still be
  rehearsed by hand; only the automatic nightly trigger goes.

## Acceptance

- A successful nightly run sends no mail and updates `/admin`.
- A failed run still mails, unchanged.
- `/admin` shows a stale backup as visibly wrong, not as a grey timestamp.
- The rehearsal in `deploy/fernscout-alert@.service`'s comment still works.

