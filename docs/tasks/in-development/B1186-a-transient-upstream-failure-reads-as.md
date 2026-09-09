---
id: B1186
title: A transient upstream failure reads as 'That did not work: 502' with no words
type: ISSUE
priority: medium
complexity: low
area: helper
found: "2026-09-09T21:00:48Z"
started: "2026-09-09T21:01:13Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-09T21:01:13Z"
---

# B1186 — A transient upstream failure reads as 'That did not work: 502' with no words

## Why

During the 2026-09-09 persona round (Margrit, 71, German, live site), a
model turn came back with the status line "That did not work: 502" — the
bare upstream code, in English, inside an otherwise German conversation. A
retry succeeded. B948's rule is that every refusal a person can reach has a
sentence; a transient 5xx from the model call reaches people whenever the
API hiccups, and its sentence should say the honest, actionable thing:
nothing was lost, try once more.

## Work

A named failure (e.g. `upstream_unavailable`) mapped from 5xx model-call
failures in the ask route, with sentences in en/de/hu ("That did not go
through — nothing was lost. Try once more."), joining NAMED_FAILURES in
HelperAsk and test/helper-failure-sentences.test.ts.

## Acceptance

A scripted 502 from the model surfaces the localized retry sentence, never
the bare code.
