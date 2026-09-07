---
id: B860
title: The account page does not say what credits went on AI
type: FEATURE
priority: medium
complexity: low
area: account page
found: "2026-09-07T17:14:18Z"
merged: "2026-09-07T17:23:04Z"
---

# B860 — The account page does not say what credits went on AI

## Why

The account page shows a balance, what a send would cost, and what was
bought. It says nothing about where credits already went — and the two that
go on a model (`helper` write-ups, `transcription`) are the ones a person is
least able to guess at, because nothing on the page mentions that a model was
involved at all. `lib/credits.ts` has the rows; `ledgerFor` is used only by
the CLI.

## Work

Group the spend rows by reason and show them in the Payment card, each reason
labelled in words, the model-backed ones saying so. Read-only; no new route.

## Acceptance

The owner's `/[user]/account` shows "N credits — Agent write-ups" and the
other spend reasons, and nothing at all when the journal has never spent.
