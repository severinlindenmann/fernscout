---
id: B930
title: The prompt budget has one token of headroom and does not say what to do
type: CHORE
priority: medium
complexity: low
area: agent, tests
found: "2026-09-08T08:25:31Z"
started: "2026-09-08T15:56:42Z"
session: 41335894-5435-4167-8cb6-898e370cd6a9
claimed: "2026-09-08T15:56:42Z"
---

# B930 — The prompt budget has one token of headroom and does not say what to do

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## What happened on 2026-09-08

The ceiling was hit **five times in one day** and was not raised. Each time the
answer was to find the space, and four of those five cost description quality —
a phrase trimmed here, an example dropped there, because the alternative was
raising a number a person had set.

The fifth found the actual fat, and it is worth writing down because it will
keep growing back: **the prompt argues each rule at length, and each retry
argues the same rule again at the moment it is needed.** By then the honesty
net had seven retries, several of them almost word for word a paragraph of the
prompt.

So the split is now: **the prompt states the rule, the retry makes the case.**
Four paragraphs came down to four sentences and the ceiling stopped binding,
with nothing the model needs upfront removed — the argument still reaches it,
later and at the only moment it matters.

That is a rule for whoever picks this up rather than a closure: the ticket is
still about whether 4,100 is the right number. What today says is that it has
not yet been the *wrong* one, and that the room found each time was real.
