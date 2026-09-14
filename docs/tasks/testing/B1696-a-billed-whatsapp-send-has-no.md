---
id: B1696
title: A billed WhatsApp send has no matching application log line
type: ISSUE
priority: low
complexity: low
area: whatsapp, logging, billing
found: "2026-09-14T06:17:43Z"
merged: "2026-09-14T06:41:07Z"
---

# B1696 — A billed WhatsApp send has no matching application log line

## Why

`lib/whatsapp/index.ts:154` logs `[whatsapp:cloud] <masked> — <template>/<lang>
-> <wamid>` right after `sendTemplate()` returns, and it is the only call site
of `sendTemplate` in the codebase — so every real outbound template send
should leave exactly one such line.

Meta's own `pricing_analytics` for WABA `1043886595223059` shows three
MARKETING-category charges: two on 2026-09-06 (€0.049 each — both accounted
for by two `[whatsapp:cloud]` lines at 18:55:37/39 that day) and one more,
€0.049, in the 2026-09-10 (00:00–24:00 CEST) daily bucket. `journalctl -u
fernscout` was searched end to end (it covers 2026-08-31 through today
continuously, no gap) for `whatsapp:cloud` and for `wamid` across all of
2026-09-10: nothing accounts for the third billed send.

The likely explanation is mundane: `journalctl -u fernscout | grep -c
"Started fernscout.service"` returns **630** restarts across two weeks
(~45/day), consistent with very frequent redeploys during active
development. A restart between "Meta accepted the send" and "the process
wrote its log line" would produce exactly this: money spent, no record.
That is a guess, not a finding — it was not chased further because it did
not seem to warrant more than this ticket. Worth two things regardless:

- **A billed WhatsApp send should not be losable to a restart.** Every other
  paid channel in this codebase (mail, credits, print orders) accounts for
  what it spent; this is the one channel where an hour of frequent deploys
  can spend real money with no trace anywhere.
- Or, if the log line is not what was lost and something else is sending a
  template message from a place this search did not find, that is worth
  knowing on its own.

## Work

Not prescribing a fix. Worth checking: whether `sendTemplate`'s log line
could be written *before* the network call (recording an attempt, not
success) with the wamid appended after, so a restart mid-flight leaves an
"attempted" line rather than nothing; or whether this is acceptable given
`pricing_analytics` already answers "what did this cost" reliably enough
that no separate record is worth building for it.

## Acceptance

Either a change that makes a billed send always leave a log trace, or a
decision that `pricing_analytics` is authoritative enough that this is not
worth building — recorded here either way.
