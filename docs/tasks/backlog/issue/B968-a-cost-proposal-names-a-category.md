---
id: B968
title: A cost proposal names a category the endpoint refuses
type: ISSUE
priority: high
complexity: low
area: helper, tools, costs
found: "2026-09-08T13:31:19Z"
---

# B968 — A cost proposal names a category the endpoint refuses

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`add_cost`'s proposal fills its `category` field with whatever the model said —
`"Food"`, `"Attractions"` — and `POST /api/helper/<user>/day/costs` accepts
only the lowercase members of `COST_CATEGORIES`: `preparation, flights,
accommodation, food, transport, activities, other`.

So pressing a cost proposal exactly as it is given comes back `invalid_cost`.
The tester hit it on both of the costs they logged. Since B948 the refusal at
least has a sentence, which is how it was noticed rather than being a bare
code — but the proposal should not be makeable in the first place.

This is the shape B935 and B936 fixed for the trip id: **a proposal a press
cannot accept.** `proposalFor` already refuses to build one when a required
field is empty (B925) and now when a tool declines itself (B951). A field
carrying a value the route will reject is the same fault with the check
missing.

`create_trip`'s `visibility` shows the answer: it is a closed list with
`options`, an unrecognised word is dropped rather than guessed at, and the
field opens on a real value. `category` is a closed list too and is a free text
box.

## Work

Make `category` what `visibility` already is: matched against `COST_CATEGORIES`
case-insensitively, dropped when it is not one of them, and drawn as the closed
list it is so a person can correct it.

While there: audit every proposal field against what its route will accept.
`test/helper-proposal-arguments.test.ts` presses each write tool with its own
`arguments` and would have caught this if it had used a category the model
might really produce, rather than a valid one.

Not doing: teaching the route to accept `"Food"`. The list is lowercase
everywhere else and a second spelling is a second source of truth.

## Acceptance

A proposal built from `category: "Food"` presses successfully, and the field is
drawn as a closed list. The press test uses a value the model would actually
send.
