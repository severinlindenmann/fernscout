---
id: B965
title: A name that fits two trips picks the newer one and says nothing
type: ISSUE
priority: medium
complexity: low
area: helper, tools
found: "2026-09-08T13:06:39Z"
started: "2026-09-08T13:11:46Z"
merged: "2026-09-08T13:15:47Z"
completed: "2026-09-09T16:47:29Z"
---

# B965 — A name that fits two trips picks the newer one and says nothing

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

B940 stopped a name that matches **nothing** from resolving to the newest trip.
A name that matches **several** still does, silently.

Driven against two trips named `balkan-loop-2026` ("Balkan Loop") and
`balkan-loop-check` ("Danube Circuit") — the shape a person actually produces,
one scratch trip made while learning and one real one:

| said | resolved to |
| --- | --- |
| `Danube Circuit` | `balkan-loop-check` ✓ |
| `Balkan Loop` | `balkan-loop-2026` ✓ |
| either exact id | itself ✓ |
| `Danube` | `balkan-loop-check` ✓ |
| **`Balkan`** | **`balkan-loop-check`** — the newer, with nothing said |

`Balkan` is a prefix of both ids. `resolveTrip` takes the first match with
trips sorted newest first, so the older one is unreachable by that word and the
person is never told there was a choice.

Five of six right is not the point: the sixth is the one where somebody writes
a day into the wrong trip, and it is the case where they were least specific
and so least likely to check.

The same reasoning B940 settled applies — *"a name that means nothing here is
exactly the name that must not resolve"* — with **ambiguous** in place of
*absent*.

## Work

When more than one trip matches at the same step, resolve to none and say which
they might have meant. The tools already have the machinery: an empty `trip`
reaches `runTool`'s "nothing was proposed" path, and B951's `refuse` carries a
sentence of the tool's own.

Only within a step: an exact id still wins over a title that also matches, and
a title match still beats a substring. It is a tie at one level that is
ambiguous, not a match at a better level.

Not doing: asking when the person named a trip exactly. `Danube Circuit` is not
ambiguous because `Danube` also matches something else.

## Acceptance

Two trips whose ids share a prefix, that prefix said alone: no proposal, and a
sentence naming both. Every unambiguous form still resolves.
