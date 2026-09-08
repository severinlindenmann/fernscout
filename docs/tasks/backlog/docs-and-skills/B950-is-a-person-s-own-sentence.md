---
id: B950
title: Is a person's own sentence about the rain theirs to keep
type: DOCS
priority: high
complexity: low
area: helper, content policy
found: "2026-09-08T11:05:47Z"
---

# B950 — Is a person's own sentence about the rain theirs to keep

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why — and this one is a decision, not a defect

`SYSTEM_PROMPT` in `lib/helper/model.ts:64` tells the model:

> Never write about the weather at all, even if the notes mention it in
> passing — this journal records weather from a measured archive, and a
> sentence of yours would compete with a measurement. If the notes are about
> the weather, say so in warnings and leave it out of the prose.

AGENTS.md says something narrower: what is forbidden is *"an agent writing a
temperature, a condition or a wet afternoon **from its own belief**"*, and a
reading a person hands over goes in `weatherData` with its source named.

Those are not the same rule. The prompt deletes the person's own sentence about
their own day; AGENTS.md forbids the agent inventing one.

The live evidence is that the model will not obey it, and lies about obeying.
Given *"rained most of the afternoon so we ducked into the maritime museum"* it
wrote exactly that — and warned that it had left the weather out. B945 stopped
that warning being delivered; it did not answer why the model disobeyed. The
likely reason is that the instruction is not followable: "we ducked into the
museum" is unintelligible without the rain. Cutting it does not remove a
weather claim, it removes a *reason*, and what is left is a person's day with
the sense taken out of it.

The counter-argument is real and is why this is a decision: a day carrying
`weather: true` gets a measured reading rendered on it, and a sentence saying
"it rained" beside an archive saying otherwise is the journal contradicting
itself in public.

## The question, plainly

When somebody says the weather in their own notes, does their sentence survive?

- **Keep it.** The rule becomes AGENTS.md's own: never a temperature, a
  condition or a forecast the agent believes; always what the person said.
  Cheapest, matches the one rule the whole product rests on, and the
  contradiction with the archive is a person's own memory against a
  measurement, which is a thing a journal is allowed to contain.
- **Cut it, and mean it.** Keep the prompt as it is and make it followable —
  say what to do with a sentence whose sense depends on the weather, because
  "leave it out" currently produces either a broken sentence or disobedience.
- **Ask.** The proposal already puts fields in front of somebody. A day whose
  notes mention weather could ask.

## Work

A person decides, and then the prompt says one thing and the tests assert it.
Whichever way, the current state — an instruction the model does not follow —
is the one option that is not available.

## Acceptance

`SYSTEM_PROMPT` and AGENTS.md say the same thing, and a test drives notes
mentioning rain and asserts the decided behaviour.
