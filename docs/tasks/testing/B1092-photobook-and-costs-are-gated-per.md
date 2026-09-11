---
id: B1092
title: Budget is gated per journal when it is the instance's decision
type: FEATURE
priority: high
complexity: medium
area: capabilities, config
found: "2026-09-09T15:59:11Z"
started: "2026-09-11T11:57:58Z"
merged: "2026-09-11T12:08:25Z"
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

- Added `costs` to `OPERATOR_ONLY_FEATURES` (lib/config.ts). That is the whole
  mechanism: `resolveOne`'s skip (lib/capabilities.ts:405, now further down
  after the addition), `journalFeatures()` and `setJournalFeatures()`
  (lib/journals.ts) and `/api/health`'s per-journal narrowing
  (app/api/health/route.ts:229) all key off this one constant, so nothing else
  needed a code change. `photobook` was already on the list before this
  ticket, from B611 — confirmed by reading it rather than trusting the
  read-only pass, and left untouched.
- Left `features.costs` already written in a journal's `config.json` alone
  (including the one `createJournal` in lib/journals.ts:389 still writes into
  every new journal — it is now dead, same as `photobook`/`postcards` were
  never written there in the first place; noted for a separate ticket rather
  than touched here, since neither the Work nor the Acceptance below called
  for it).
- Checked every read of `costs` as a capability
  (`grep -rn '"costs"' lib app components`, plus a read of every line
  `OPERATOR_ONLY_FEATURES` appears on) and found no second path — every
  gate (`lib/tripGate.ts`, `lib/costs.ts`, `lib/analytics.ts`,
  `lib/api/tripRates.ts`, `lib/digest/dayLetter.ts`, `lib/photobook/source.ts`,
  the costs pages under `app/[user]/…`) calls `isEnabled("costs", …)`, which
  is the one function `resolveOne` sits behind.
- Updated the tests that assumed a journal's own `features.costs: false`
  narrowed anything: `test/costs-off.test.ts` ("one journal's no is not
  another journal's" now asserts the opposite — a journal's `false` no longer
  narrows, and both trips show costs), `test/costs-availability.test.ts` (the
  "off" journal's off-ness now comes from the server config, not its own
  file), and `test/rates-fill.test.ts` ("the capability is off" now flips the
  server's switch). Extended `test/server-only-capabilities.test.ts` — the
  B611 test file already shaped exactly for this — to run its three
  `describe` blocks over `costs` alongside `photobook`/`postcards`/`whatsapp`,
  which is the test that fails if `costs` is ever removed from the array
  again.
- `/api/health` needed no change: the server-level `capabilities` block
  already read `resolveCapabilities()` for every `FEATURE_NAME` including
  `costs`, and the per-journal `journals[username]` block already skips
  everything in `OPERATOR_ONLY_FEATURES` — so `costs` moved from the
  per-journal section to the instance section with no line touched there.
- Not doing: touching `photobook`, `postcards`, `logging`, `credits`,
  `helper`, `transcription`, `sms`, `smsInbound`, `fulfilmentRelay` or
  `fulfilmentAccept` — all already correct.

## Acceptance

- A journal whose `config.json` has no `features` block at all shows its budget
  when the instance has `costs` enabled, and shows none when it does not.
- `POST /api/v1/<user>/settings` (or whatever `setJournalFeatures` fronts)
  refuses `costs` the way it already refuses `photobook`.
- `npm run verify`.
