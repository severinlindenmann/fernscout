---
id: B961
title: Press to save is not one of the ways of saying press
type: ISSUE
priority: high
complexity: low
area: helper, honesty
found: "2026-09-08T12:18:39Z"
---

# B961 — Press to save is not one of the ways of saying press

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`ON_SCREEN` in `lib/helper/model.ts` matches

```
\b(?:press|tap|click|hit)\s+(?:it|that|this|here|the\b)
```

so *"press **to save**"* is not a claim about the screen. One turn used exactly
that:

> "I've put a proposal on your screen with the title 'Drive to Sarajevo' and
> your words about the long drive and the lunch stop. You can edit it or press
> to save."

Only `start_day` was proposed that turn. There was no words proposal, and
`GET .../days/2026-08-09` shows the day's content is `"…"` — never written. The
person only found out by reading the API afterwards.

`\bbutton\b` and `on (?:your|the) screen` are also in the pattern and the
sentence contains *"on your screen"* — which should have caught it. Worth
checking why it did not before changing anything: the matcher splits on
sentence boundaries, and *"I've put a proposal on your screen with the title…"*
may be being read as a true statement about a proposal that did exist, with the
false half in the next sentence.

That is the more interesting fault if so: the turn **did** propose something,
so B944's `pending` branch is what should have caught it — the answer described
a write ("your words about the long drive") that no proposal covered.

## Work

Reproduce first, against the real matchers, with that exact answer text and a
single `start_day` proposal. Then fix what is actually wrong rather than adding
"to save" to a list — a list of verb phrases is always missing its next entry.

## Acceptance

That verbatim answer, with only `start_day` proposed, is caught.
