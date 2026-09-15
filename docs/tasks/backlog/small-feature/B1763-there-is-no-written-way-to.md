---
id: B1763
title: There is no written way to test a prompt change here, so everyone invents a wrong one
type: FEATURE
priority: high
complexity: low
area: testing, helper
found: "2026-09-15T05:34:24Z"
---

# B1763 — There is no written way to test a prompt change here

## Why

In one week this repository made four changes to how the model is asked to
behave, measured each one, and reported three of them wrongly — two as
regressions and one as a rejection on evidence. All three were inside the
noise. It took running the *same code twice* (60% and 68% on identical cases)
for anybody to notice.

The tools exist now: `--against` compares case by case, and every rate prints
its margin. What does not exist is the procedure, so the next person will
invent one, and the obvious one — run it, read the number, decide — is exactly
the one that just failed four times.

## Work

A short reference, and a `helper-bench` skill so it is found at the moment
somebody is about to change a prompt. It has to say, plainly:

- **Save a baseline first.** A comparison needs the same cases run twice.
- **Read the margin, not the rate.** At 84 cases, ±10 points is ordinary.
- **Compare case by case.** The paired figure is the sensitive one; the
  averages are nearly useless at this size.
- **A change you cannot measure does not ship** — and "we measured it and it
  was worse" is a different sentence from "we could not tell". This repository
  has now confused those two in writing.
- What a run costs, so the decision to run one is informed.

## Acceptance

- Somebody who has never used the bench can follow it and reach a defensible
  answer.
- It names the 60/68 incident, because the rule without the story is one
  people talk themselves out of.
