---
id: B922
title: A credit is spent on a write that failed
type: ISSUE
priority: high
complexity: low
area: agent, credits
found: "2026-09-08T07:08:54Z"
---

# B922 — A credit is spent on a write that failed

## Why

A 71-year-old's balance went from **10 to 8** for a day that was never written.

The model handed back a wrong trip id twice; the write failed silently
underneath the prose; the credit had already been spent. She was charged for
the model's own mistake, and nothing on screen said a credit had gone.

B891 recorded the owner's decision plainly: **a refused or abandoned proposal
charges nothing, including one edited three times before accepting. The credit
belongs to the write, not to the asking.** A write that returns `422` is not a
write.

On this instance credits are free, so it cost her nothing real. On a paying
instance it is somebody's money, spent on a failure.

## Work

Charge on success. Where the spend must happen before the call — the model has
to be paid for whether or not the day is written — refund on failure, which
`lib/credits.ts` already has (`refund`) and which `write-day` already does for
a model error. The gap is the writes that fail *after* the model succeeded.

Then say it in the ledger: a refunded credit should be legible as one, so
"where did my credits go" has an answer.

## Acceptance

A failed write leaves the balance where it was, and a test proves it for each
write tool.
