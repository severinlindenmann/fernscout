---
id: B442
title: A postcard order closed in a tab cannot be found again
type: FEATURE
priority: low
complexity: low
area: postcards
found: "2026-09-05T10:52:10Z"
---

# B442 — A postcard order closed in a tab cannot be found again

## Why

An order is reachable only at `/<user>/postcards/<id>`, by the link an agent
handed over or the redirect B441 lands on. There is no page that lists them.

Close the tab before pressing Send and the order still exists, still holds the
photograph and the people, and is findable only through
`GET /api/v1/<user>/postcards/<id>` — which needs the id that was in the tab
that was closed. It expires quietly a week later. Nobody is charged for it, so
this is a lost intention rather than lost money, but "I did that already, where
did it go" has no answer today.

The rows are there and already indexed: `print_orders` has
`(owner_id, status)` from `001-initial`.

## Work

A list of this journal's postcard orders that are still waiting, wherever the
owner already looks — `/<user>/me` is the likely home, beside the credit
balance the preview page sends them to when they are short. Each row: the day,
how many cards, the cost, when it expires, and a link into the preview.

Sent orders can be in it too, but the waiting ones are the reason it exists;
do not let a long history of sent cards push them off the screen.

## Acceptance

An order created and abandoned is findable again without its id, by the owner
and by nobody else.
