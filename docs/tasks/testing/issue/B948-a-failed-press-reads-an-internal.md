---
id: B948
title: A failed press reads an internal code aloud
type: ISSUE
priority: high
complexity: low
area: helper, ui, a11y
found: "2026-09-08T10:46:42Z"
started: "2026-09-08T10:57:15Z"
merged: "2026-09-08T11:02:57Z"
---

# B948 — A failed press reads an internal code aloud

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`failureSentence()` in `components/HelperAsk.tsx` maps a route's error code to a
sentence a person can read. `NAMED_FAILURES` holds five — `incomplete_day`,
`consent_required`, `no_credits`, `already_published`, `no_day_on_date` — and
anything else falls through to `t("agent.failed", { error: message })`, which
renders the code itself.

`invalid_trip` is not in the list. Clear the title on a trip proposal, press,
and the screen says:

> That did not work: invalid_trip.

It lands in a focused `role="alert"`, so a screen-reader user hears it
immediately and at full volume — an internal identifier, in English word order,
spoken as though it were a sentence. Found by exactly that reader, who noted
that the surrounding comments describe this being fixed for the other five.

The general fault is that the fallback is silent about its own gap: a route can
add a refusal and nothing fails until somebody presses it.

## Work

`invalid_trip` first, and then the audit the reader asked for: every error code
a helper write route can return, checked against the list. A test that walks the
routes' refusals and fails on one with no sentence is what stops the next one.

The fallback stays — a code is better than nothing — but it should be
unreachable.

## Acceptance

A test that enumerates the refusals the helper write routes can produce and
fails if any has no sentence of its own.
