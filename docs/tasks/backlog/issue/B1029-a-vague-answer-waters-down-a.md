---
id: B1029
title: A vague answer waters down a fact the turn already read exactly
type: ISSUE
priority: low
complexity: low
area: helper, model
found: "2026-09-08T20:24:11Z"
---

# B1029 — A vague answer waters down a fact the turn already read exactly

## Why

Split off from B952. Asked how many credits were left, the helper said
*"you have credits remaining"* with no number, on a turn where the `account`
tool had actually returned `credits: 9` (the same figure `GET .../status`
holds). Not false — there really are credits remaining — but vaguer than the
turn's own knowledge, for no reason the person can see.

This is a different shape from B952's dropped question: here the tool
*was* called, and the exact fact it returned simply did not make it into the
sentence. `lib/helper/model.ts` already has the machinery for "a number about
money the tool did not produce" (`counted`/`moneyIn`, B963) — this is close to
its mirror: a number the tool *did* produce that the answer declined to use.

## Work

Not investigated yet. A plausible shape: when `account` is called this turn
and the person's message reads like it is asking for the balance (or, more
generally, whenever a `renders: "say"` tool returns a number and the answer
about it contains no digit at all), flag it and retry with the number named.
Needs the same discipline as every other check here: checked against what the
tool returned, not against phrasing of the question.

## Acceptance

Asked for a count the turn already read, the answer states it — or, if a
retry can't be made to state it, is honest that it has the figure and is
withholding it (not a vague brush-off).
