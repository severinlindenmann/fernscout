---
id: B1341
title: Asked for a new journal, the helper proposes renaming the existing one
type: FEATURE
priority: high
complexity: medium
area: helper
found: "2026-09-10T17:04:26Z"
started: "2026-09-10T17:04:39Z"
merged: "2026-09-10T17:23:49Z"
---

# B1341 — Asked for a new journal, the helper proposes renaming the existing one

## Why

Asked "erstelle neuen Trip und Journal", the model proposed the
journal-rename form; the owner read it as a second journal appearing when it
only renamed the existing one (E03 A, 2026-09-10). One account holds exactly
one journal and nothing said so to the model.

## Work

`journal_settings`' describe now carries the rule: one account, one
journal — asked for a new one, say so and offer a new trip or a rename, and
never propose the form unasked. Paid for inside the 8000-token ceiling by
trimming four fat describes (trip_costs, account, set_day_words, start_day)
without touching any test-pinned phrase.

## Acceptance

`npx vitest run test/helper-thread.test.ts` (the ceiling and the pinned
phrases) is green; a live conversation asking for a new journal should answer
in words and propose nothing — worth one manual probe on fernscout.ch.
