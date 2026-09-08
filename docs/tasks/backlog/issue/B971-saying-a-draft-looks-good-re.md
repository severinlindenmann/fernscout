---
id: B971
title: Saying a draft looks good re-offers the same card instead of the next one
type: ISSUE
priority: medium
complexity: low
area: helper, model
found: "2026-09-08T13:59:02Z"
---

# B971 — Saying a draft looks good re-offers the same card instead of the next one

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

The drafting chain is two presses on purpose: `draft_words` returns prose to
read, and keeping it is `set_day_words`. B969 made the person's own notes ride
into the first card. What happens after they read what came back is where it
stalls.

Having pressed and read the prose, the tester said the most ordinary sentence
in the flow:

> "That looks good, save it."

The conversation re-issued **the same `draft_words` proposal** — an offer to
write it up again, and to spend another credit — rather than the
`set_day_words` card that keeps what they had just read. Nothing was lost and
nothing was charged, because they did not press it. They built the next
proposal by calling `POST /api/helper/<user>/proposal` themselves, which is the
browser's own chaining call and not something a person has.

The mechanism is right and already exists: `Proposal.next` opens
`set_day_words` when the first card is pressed *in the browser*. What has no
answer is the person saying yes **in words** on the next turn, which is what
somebody does when they have just read something and liked it.

## Work

The model needs to know that prose was drafted and not yet kept, and B939's
notes are the place: `write-day` already leaves *"drafted: words for
<trip>/<date>, kept nowhere yet"*. So the fact is in the conversation and the
model is answering as though it were not — worth reading whether the note
reaches it before changing anything else.

Then the honest fix is probably that "save it", after such a note, means
`set_day_words` with the drafted prose — which the model cannot supply, because
it does not hold the prose. That may mean the note has to carry it, or that
this turn should re-propose from what the route returned rather than from the
model.

Not doing: making "looks good" press anything. The press stays a press.

## Acceptance

After a real `draft_words` press, "that looks good, save it" produces a
`set_day_words` proposal carrying the prose that came back — not a second offer
to write it.
