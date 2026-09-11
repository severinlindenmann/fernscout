---
id: B1095
title: Personas run in parallel share one browser tab and interleave, invalidating the round
type: CHORE
priority: high
complexity: low
area: .claude/skills/test-with-personas
found: "2026-09-09T16:05:35Z"
started: "2026-09-11T12:40:02Z"
merged: "2026-09-11T12:51:36Z"
completed: "2026-09-11T13:18:32Z"
---

# B1095 — Personas run in parallel share one browser tab and interleave, invalidating the round

## Why

`test-with-personas` says "dispatch one subagent per persona", and four
dispatched at once on 2026-09-09 all drove **the same Playwright MCP browser
tab**. They interleaved: the Hungarian persona filled in her own address, and
the next snapshot showed a signup form pre-filled with `techperson@severin.io`,
an address she never typed. The mail spool showed codes issued for
`oldperson`, `techperson` twice and `toolcheck` inside her one-minute window
and none for her.

She stopped and said so, which is the only reason this is a ticket rather than
a report full of confident nonsense. That is the precise failure the skill was
written to prevent — a round that produces polished prose and no truth — and
the skill's own instruction to fan out is what caused it.

The cost is the whole round: four personas, four sign-ins, and the model calls
behind them, all unusable.

## Work

Two things, and the second is the one that matters.

- The skill says to dispatch one subagent per persona and does not say they
  cannot share a browser. Say it: personas run **one at a time**, or each in
  its own browser context.
- Find out whether an isolated context is actually available to a subagent.
  If the MCP browser cannot give one per agent, then serial is the only honest
  instruction and the skill should say that plainly rather than implying a
  parallelism that corrupts the result.

Not doing: building a harness. A sentence in the skill that stops a wasted
round is worth more than tooling nobody maintains.

## Acceptance

Two personas dispatched at once, each signing in with its own address, and
neither one's screen ever showing the other's email. Or a skill that says not
to, in which case the acceptance is that the sentence is there.

## Built, 2026-09-11

Took the second half of the "or": no concrete per-subagent browser-context
isolation mechanism was found available to this skill's tools, and a skill
claiming isolation it had not verified would be worse than one that says to
go slower. `.claude/skills/test-with-personas/SKILL.md`'s "Running a round"
now opens by naming the 2026-09-09 interleaving directly, states personas
run one at a time rather than dispatched together, and says explicitly that
this skill found no isolation mechanism to rely on instead.
