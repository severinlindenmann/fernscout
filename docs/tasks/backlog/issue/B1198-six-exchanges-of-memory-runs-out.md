---
id: B1198
title: Six exchanges of memory runs out mid-sitting and reads as malfunction
type: ISSUE
priority: medium
complexity: medium
area: helper
found: "2026-09-09T22:34:29Z"
---

# B1198 — Six exchanges of memory runs out mid-sitting and reads as malfunction

## Why

Persona round (Elena): seven exchanges into one sitting, the model said
"I don't have the earlier turns in front of me" about a suggestion it had
itself made two turns earlier — technically honest (MAX_TURNS is 12, six
exchanges, and the FORGOT note fired) but reading as malfunction minutes
into an ordinary conversation. The window is a cost decision (every
remembered turn is re-paid each turn), yet six exchanges is below one
real sitting's length; B1053 (tool-list grouping) is the token budget this
trades against.

## Work

Decide the budget together with B1053 rather than nudging the constant
alone: grouping tools frees the tokens a longer window costs. Until then,
consider raising MAX_TURNS moderately (e.g. 20) and softening the FORGOT
sentence to invite re-asking rather than announcing loss.

## Acceptance

A 10-exchange sitting on the live site does not hit the FORGOT note; the
prompt-budget test still passes.
