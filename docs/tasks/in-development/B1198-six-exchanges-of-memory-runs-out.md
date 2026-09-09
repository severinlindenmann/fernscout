---
id: B1198
title: Six exchanges of memory runs out mid-sitting and reads as malfunction
type: ISSUE
priority: medium
complexity: medium
area: helper
found: "2026-09-09T22:34:29Z"
started: "2026-09-09T22:44:19Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-09T22:44:19Z"
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

(As built, 2026-09-10:) MAX_TURNS 12 → 16 (eight exchanges clears a real
sitting) and the FORGOT note now tells the model to ask for a missing
detail in a word or two and never to announce a memory problem
unprompted. The structural half — winning the token budget back by
grouping tools — stays with B1053 and is deliberately not attempted here.

## Acceptance

A 10-exchange sitting on the live site does not hit the FORGOT note; the
prompt-budget test still passes.
