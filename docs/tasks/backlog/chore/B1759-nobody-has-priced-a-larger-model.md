---
id: B1759
title: Nobody has priced a larger model on the turns the helper is worst at
type: CHORE
priority: medium
complexity: low
area: helper
found: "2026-09-15T05:34:22Z"
---

# B1759 — Nobody has priced a larger model on the turns the helper is worst at

## Why

`HELPER_MODEL` is `claude-haiku-4-5`, chosen for cost, and the cost model in
`site/config.json` is built around it. The published work on tool-calling is
consistent that model choice moves accuracy more than any prompt, schema or
routing change — and this repository has now failed to move the number with
three of those in a row.

Nobody has actually measured what a larger model does here, so the trade is
being made on price alone with no idea what it buys.

## Work

- Make the model overridable for a bench run — an environment variable read in
  one place, not a config change and not a code edit somebody has to remember
  to revert.
- Measure only the scenarios that are weak today. The strong ones are at or
  near 100% and have nothing to reveal.
- Report cost per turn beside accuracy. The answer worth having is a rate, not
  a verdict: "a day written up correctly costs N rappen more".

## Acceptance

- A number for both models on the weak scenarios, with the price of each.
- A recommendation that names what the difference costs per journal per month,
  not only per turn — that is the figure an operator decides on.
