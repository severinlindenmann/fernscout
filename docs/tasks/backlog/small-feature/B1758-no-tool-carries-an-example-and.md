---
id: B1758
title: No tool carries an example, and few-shot is the one prompt-side lever with evidence behind it
type: FEATURE
priority: medium
complexity: low
area: helper
found: "2026-09-15T05:34:21Z"
---

# B1758 — No tool carries an example

## Why

Every tool in `lib/helper/tools/areas/` describes itself in prose and none
shows a call. Few-shot prompting is the one prompt-side lever with real
evidence behind it for tool selection, and it is the only one this repository
has not tried — the three it has tried (a router line, a rule about answering
one's own question, a wider tool list) all came back inside the noise.

The scenarios that fail are the ones where choosing is hard: a phone-typed
sentence like "3.6 eger burg den ganzen tag sehr heiss" that should reach
`start_day` with its `notes` filled in, and instead reaches nothing. That is
exactly the shape an example teaches and prose does not.

## Work

- One or two examples on the tools the bench says are weakest — `start_day`
  first, since `notes` exists precisely for the all-at-once case (B969) and
  is the argument most often left empty.
- Examples cost tokens against `test/helper-thread.test.ts`'s ceiling. A
  raise needs its paragraph, and this time the paragraph can cite a
  measurement rather than an intention.

## Acceptance

- Measured with `--against` on a saved baseline, **case by case**, not rate
  against rate — B1752 is the record of what rate-against-rate at this corpus
  size is worth.
- If it cannot be shown to help, it does not ship, and the result is written
  into the ticket so the next person does not repeat it.
