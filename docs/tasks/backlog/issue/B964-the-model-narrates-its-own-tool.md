---
id: B964
title: The model narrates its own tool confusion to the person
type: ISSUE
priority: medium
complexity: low
area: helper, model
found: "2026-09-08T12:52:44Z"
---

# B964 — The model narrates its own tool confusion to the person

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

An answer began:

> "I called trip_costs for Danube Circuit but it returned Balkan Loop. The
> total for Danube Circuit is 240.476 CHF…"

The figure was right and the trips were correctly separated in the summary
afterwards, so there is no evidence of a data fault behind it. What reached the
person is the model narrating its own plumbing — a tool name, and a suspicion
about that tool's behaviour — in the middle of an answer about their holiday.

It is the same fault as B924, which was about the marker the *server* writes for
the model leaking into the person's view: two audiences, one channel. That one
was fixed by making a note a note. This is the model composing its own version
of the same thing, which is harder, and the reason it is filed at medium: it is
noise rather than a false claim.

Worth knowing before fixing: the journal had two trips with similar names,
because the tester made a scratch one while learning the flow. So the model may
have been reporting something real about `resolveTrip`'s matching — which
B940 narrowed and did not remove. Read that before assuming this is only
presentation.

## Work

Reproduce with two similarly named trips first. If the resolution really is
picking the wrong one, that is the ticket and this framing is wrong.

If it is only narration, the lever is the system prompt — say that tool names
and what a tool returned are never the person's business — and B829 says to
expect that to work poorly on its own. `withoutMarkers` is the precedent for
stripping rather than asking.

## Acceptance

A turn that had to resolve between two similar trip names says nothing about
tools to the person.
