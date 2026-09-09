---
id: B967
title: An ordinary German request is answered with the money refusal
type: ISSUE
priority: high
complexity: low
area: helper, honesty, i18n
found: "2026-09-08T13:31:19Z"
started: "2026-09-08T13:32:17Z"
merged: "2026-09-08T13:38:47Z"
completed: "2026-09-09T16:46:40Z"
---

# B967 — An ordinary German request is answered with the money refusal

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Asked, in German, to mention a castle in a day's entry:

> "Ich habe auch am 12. Juni ein Foto von der Burg gemacht, könntest du das im
> Tagebucheintrag erwähnen, dass wir auch die Burg besucht haben?"

The answer was:

> "I would rather not give you a figure I have not added up properly — a wrong
> number about your own money is worse than none. Ask me again and I will read
> the costs first."

Nothing about money was asked. That is `agent.notCounted`, B955's plain
sentence, reached because `claimsATotal` matched the model's own answer on a
turn with no `trip_costs` call. The same intent in English and in Hungarian
behaved normally, so it is the German half of the matcher.

**This is the failure mode I wrote into `AGENTS.md` this morning**: *a guard
that fires on an honest turn is a bug, and as serious as one that misses.* It
is worse than a missed claim here, because a person who asked about a castle
and was told something about money has no reading of that except "the software
is broken". The tester said exactly that.

The German patterns B955 and B962 added are the suspects — `gesamt\w*` in
particular, which is inside the perfectly ordinary `insgesamt`, and
`ausgegeben`, which means "spent" and also "issued" and "given out". Both were
written without a German sentence beside them; B956's table covers what each
matcher *should* catch and has no examples of what it must not.

## Work

Reproduce first, against the real matcher, with ordinary German prose — the
answer text is not in the report, so find which pattern fires and on what. Then
narrow it, and add the negative half to B956's table: every matcher needs
sentences it must **not** match, in all three languages, and only the English
ones have them today.

Consider whether `A_TOTAL` should require the figure and the totalling word in
that order, or nearer each other than "anywhere in the sentence".

Not doing: removing the German patterns. B955 is real and the German half of it
is what a German owner needs.

## Acceptance

Ordinary German prose that mentions a day, a photograph or a place — with and
without a number in it — is not a total. B955's own German cases still are.
