---
id: B1784
title: The credits-spent list shows a raw translation key and overflows the phone
type: ISSUE
priority: high
complexity: low
area: account page, credits
found: "2026-09-15T06:54:59Z"
merged: "2026-09-15T07:02:11Z"
---

# B1784 — The credits-spent list shows a raw translation key and overflows the phone

## Why

"Wofür Credits ausgegeben wurden" on /[user]/account renders one line per ledger
reason with `t("me.spentReason.<reason>")`. Four spend reasons added after B860
never got a string: `ask_thread`, `find_in_journal`, `travellers_from_photo`,
`photobook_print`. A journal that used the conversation shows the literal
`me.spentReason.ask_thread`, which is also an unbreakable token, so on a phone
the row runs off the side and the amount is cut in half.

The ledger's vocabulary is the operator's audit trail — one line per supplier,
per door. The owner does not need that: she wants to see roughly where her
credits went. Four AI doors as four lines she cannot tell apart is worse than
one line that says AI.

## Work

Group the reasons into the handful of buckets an owner understands — AI,
emails and messages, photobooks, postcards, storage, refunded — and sum them.
Anything unknown falls into "other" rather than rendering its raw key, so the
next reason added to the ledger cannot put a key on somebody's account page
again. The ledger itself and `/api/v2` keep the exact reasons.

## Acceptance

- No `me.spentReason.` key text can appear on the page for any ledger reason.
- A journal that spent on `ask_thread` and `helper` shows one AI line with
  their sum.
- The section reads without horizontal overflow at phone width.
