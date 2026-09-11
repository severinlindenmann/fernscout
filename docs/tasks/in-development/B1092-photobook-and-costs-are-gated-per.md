---
id: B1092
title: Budget is gated per journal when it is the instance's decision
type: FEATURE
priority: high
complexity: medium
area: capabilities, config
found: "2026-09-09T15:59:11Z"
started: "2026-09-11T11:57:58Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T11:57:58Z"
---

# B1092 — Budget is gated per journal when it is the instance's decision

## Why

Reported as "budget and photobook should not be enabled per journal, instead per
instance". Half of it is already true and the other half is not, and the half
that is true is why the report was made: the two behave differently for no
reason a person can see.

`photobook` has been operator-only since B611 — it is in
`OPERATOR_ONLY_FEATURES` (lib/config.ts:62), and `resolveOne`
(lib/capabilities.ts:405) skips the per-journal check for everything on that
list. A journal that has never written the word `photobook` still gets the
button. That is right: it spends the operator's printer account, so the journal
has nothing to consent to.

`costs` is not on the list, so a journal gets a budget only if its own
`config.json` says so — absence means off, because `USER_DEFAULT_FEATURES`
(lib/config.ts:484) turns on `mail` and `whatsapp` and nothing else. But a
budget spends nothing, reaches no supplier and reveals nothing to anybody the
trip does not already admit. There is no operator cost to consent to and no
journal-level question to ask, so the flag is a switch nobody has a reason to
set either way — and the failure is silent: a journal with trip costs written
in `costs.md` renders no budget and says nothing about why.

The cost of getting this wrong in the other direction is on record (B60), so
this is a judgement about `costs` specifically, not an argument for emptying
the per-journal table.

## Work

- Add `costs` to `OPERATOR_ONLY_FEATURES`. That is the whole mechanism: the
  server's `features.costs.enabled` stays the ceiling, and the journal loses a
  vote it had no reason to cast. `setJournalFeatures` (lib/journals.ts:675)
  already refuses to write anything on that list, so the settings UI drops it
  without a change there.
- Leave any `features.costs` already written in a journal's `config.json`
  alone. It stops being read; nothing rewrites somebody's file.
- Check `/api/health`: `app/api/health/route.ts:229` skips operator-only
  features in the per-journal section, so `costs` moves from the per-journal
  block to the instance block on its own.
- Not doing: touching `photobook`, which is already correct, or the four other
  names on the list.

## Acceptance

- A journal whose `config.json` has no `features` block at all shows its budget
  when the instance has `costs` enabled, and shows none when it does not.
- `POST /api/v1/<user>/settings` (or whatever `setJournalFeatures` fronts)
  refuses `costs` the way it already refuses `photobook`.
- `npm run verify`.
