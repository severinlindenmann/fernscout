---
id: B766
title: The write-up keeps weather in the prose and says in its warnings that it removed it
type: ISSUE
priority: high
complexity: low
area: agent, model
found: "2026-09-07T14:03:49Z"
started: "2026-09-08T19:11:42Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T19:11:42Z"
---

# B766 — The write-up keeps weather in the prose and says in its warnings that it removed it

## Why

Found by calling the deployed instance with a real key on 2026-09-07, which is
the only way this was ever going to surface: every test stubs the model, so
every test asserts what we *asked* for rather than what comes back.

`STATEMENT`-style rules in `lib/helper/model.ts`'s write-day prompt say:

> Never write about the weather at all, even if the notes mention it in
> passing — this journal records weather from a measured archive, and a
> sentence of yours would compete with a measurement. If the notes are about
> the weather, say so in warnings and leave it out of the prose.

Sent `"boiling hot all day, about 35 degrees, we barely moved"`, the live model
returned:

```
prose:    "Boiling hot all day, about 35 degrees. We barely moved."
warnings: ["Weather is mentioned but not recorded in the measured archive;
           details about temperature were omitted from the prose."]
```

Two things are wrong, and the second is worse than the first.

**The weather stayed in the prose**, against an instruction that is about as
emphatic as prose can be. Arguable on its own: the person did say it, and
"write what you were told" pulls the other way. That tension is real and worth
settling deliberately rather than by whichever sentence the model weighs more.

**The warning asserts something untrue about its own output.** It says the
temperature was omitted, beside a paragraph containing the temperature. The
warnings card is the one part of this feature that exists to be trusted — it is
what tells a person what was left out, and a person who does not re-read the
prose against it has been told something false about their own journal. A
warning that lies is worse than no warning.

The same run got the harder case right: `"drove"` produced `"I drove."` with a
warning naming the missing context, and invented nothing. So the invention rule
holds; this is specifically the weather carve-out and the honesty of
`warnings[]`.

## Work

Settle the product question first, in one sentence in the file: **may a person's
own words about weather stay in their day?** Two defensible answers:

- *Yes* — it is what they said. Then delete the weather paragraph from the
  prompt, and let `weather: true` supply the measurement alongside. The archive
  and the person are not competing; they are two different claims.
- *No* — then the prompt is not enough on its own, because it has been tried.
  Strip it after the fact, or refuse and re-ask.

Either way, **`warnings[]` must never describe an edit that did not happen.**
Consider asserting it: a warning claiming an omission, against prose that still
contains the thing, is checkable in code for the weather case at least.

This wants an eval rather than a unit test — a handful of real notes, run
against the real model, checked by hand. There is no such harness yet and that
is the deeper gap: the prompt is the product and nothing measures it.

## Acceptance

The weather question is answered in one sentence in `lib/helper/model.ts`, the
behaviour matches it, and no `warnings[]` entry can claim an omission that did
not occur.

## Since, and what is actually left — 2026-09-08

Reproduced again, live, on other notes: *"rained most of the afternoon so we
ducked into the maritime museum"* came back with the rain in the prose and a
warning saying the weather had been omitted from it. The same two faults, a day
later, on a different sentence — so it is the instruction rather than a bad
draw.

**The second fault is fixed.** B945: nothing renders `warnings`, and it was
never something to hand on — it is a pressure valve pointed at the model, so
that leaving something out is an acceptable answer instead of a failure. The
route no longer returns it, so no untrue description of the prose reaches
anybody while the first question is open.

**The first is a person's decision and is the whole of what remains.** B950 was
filed for it without finding this ticket and is closed as superseded; its three
options are worth having here:

- **Keep the person's sentence.** The rule becomes AGENTS.md's own: never a
  temperature, a condition or a forecast the agent believes; always what the
  person said. Matches the one rule the product rests on, and a person's memory
  disagreeing with an archive is something a journal is allowed to contain.
- **Cut it, and make that followable.** The prompt stays and says what to do
  with a sentence whose sense depends on the weather — because "we ducked into
  the museum" without the rain is not a weather claim removed, it is a reason
  removed, and the model will not do it.
- **Ask.** The proposal already puts fields in front of somebody.

The live evidence says the current state is the one option not available: an
instruction the model does not follow, and then reports having followed.
