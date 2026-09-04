---
id: B216
title: Nothing helps an author find the rate to freeze into a trip
type: CHORE
priority: low
complexity: low
area: currency, tooling
found: "2026-09-04T06:33:41Z"
---

# B216 — Nothing helps an author find the rate to freeze into a trip

## Why

Split out of B17, which documented the gap and stopped there. B17's fourth
work item was written as "consider", was not in its acceptance, and is a
feature rather than a correction — so it is captured here rather than absorbed.

A trip's `rates:` block is typed by hand. `npm run rates:update` refreshes
`content/rates/ecb.json`, which is layer three — the reader's display currency
— and writes nothing a trip can use. `docs/currencies.md` and
`.claude/skills/add-a-trip/SKILL.md` now say where the number comes from (a
card statement, or an ECB rate for a date in the middle of the trip,
cross-divided when the base currency is not the euro), but saying it is not the
same as handing over a figure to paste, and the cross-division is exactly the
step where somebody inverts the ratio.

## Work

- A read-only mode on `scripts/update-rates.mjs` — something like
  `npm run rates:update -- --pair THB --base CHF --on 2026-03-14` — that prints
  the cross-rate in the **trip** convention (base per one unit of the keyed
  currency), labelled as such, with the date it is for. The ECB publishes a
  history file at `eurofxref-hist.zip` alongside the daily one.
- Print it as a pasteable `rates:` line.

**Not doing, and this is the constraint rather than a shortcut: it must not
write into `trip.md`.** A frozen per-trip rate is a judgement about what a trip
actually cost — usually the spread the author really paid, which no reference
rate knows — and a command that fills the field in would replace that judgement
with a lookup while looking authoritative. Print it; let a person decide.

## Acceptance

- The command prints a number in the trip convention, and says which
  convention that is.
- Nothing under `content/` is modified by it.
- The four checks.
