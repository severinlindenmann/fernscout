---
id: B998
title: The agent guide crossed its ceiling and main went red for everybody
type: ISSUE
priority: medium
complexity: low
area: docs, agent guide
found: "2026-09-08T17:13:17Z"
---

# B998 — The agent guide crossed its ceiling and main went red for everybody

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`test/agent-interface.test.ts` holds the guide under 136 KiB and says in its
own comment that it is *"a tripwire, not a budget"* — the point is that growth
has to be noticed and argued for, not that it is forbidden.

It tripped: 139,868 bytes against 139,264. `main` was red for every session
until somebody looked, which is the cost of a tripwire nobody is watching.

Several tickets share the overage, mine among them — B905 added the unpublish
route to the guide in both the short and the long form. None of them was
wrong to; the guide grows because the product does.

## What was done

Raised to 144 KiB, with the argument in the test beside the number, which is
what the comment asks for. Nothing was cut, for the same reason the last
person did not cut anything: nothing in there is yet known to be spare, and
trimming a guide to fit a number is how a document stops saying the thing it
was grown to say.

## What is actually wrong, and is not fixed

B311 is the structural answer — the guide is one document that every agent
reads in full, and it grows by a paragraph every time a route is added. A
ceiling raised by eight kilobytes each time it is hit is a budget after all,
just a slower one.

Worth knowing before the next raise: what an agent needs *on arrival* and what
it needs *at the point of use* are different documents, and the second could be
fetched per route rather than read up front.

## Acceptance

Whoever raises it next writes down why here, or splits the document.
