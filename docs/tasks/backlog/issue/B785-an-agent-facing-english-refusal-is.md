---
id: B785
title: An agent-facing English refusal is shown to a person on a German screen
type: ISSUE
priority: medium
complexity: low
area: agent, i18n
found: "2026-09-07T14:29:54Z"
---

# B785 — An agent-facing English refusal is shown to a person on a German screen

## Why

Going back to the first step and pressing "Diesen Tag beginnen" again for the
same trip and date surfaces the raw refusal from `lib/api/entries.ts:499` —
`"an entry already exists at 2026-05-04-…"` — through `agent.failed`, in
English, on a German screen.

The behaviour is right: it refuses rather than duplicating the day. The
sentence was written for an agent reading an API, and B769's back control made
it reachable by a person.

There will be more of these: every refusal `lib/api/*` writes is written for a
machine, and the helper now shows some of them to people.

## Work

Map the refusals the helper can actually surface to translated sentences, and
say what to do next — this day already exists, carry on with it. Start with the
ones reachable from the wizard rather than translating everything.

## Acceptance

No English API sentence appears on a German helper screen for a refusal a
person can reach by ordinary use.
