---
id: B935
title: A proposal carries a trip title where the endpoint needs an id
type: ISSUE
priority: high
complexity: low
area: agent
found: "2026-09-08T09:12:38Z"
started: "2026-09-08T09:12:39Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-08T09:12:39Z"
---

# B935 — A proposal carries a trip title where the endpoint needs an id

## Why

A proposal carries two representations of the same call and they disagree.

`proposal.arguments` for `start_day` and `draft_words` carried the trip's
**title** — "Spaziergang am See" — where the endpoint needs its **id**,
`spaziergang-am-see-2026`. Only the display `fields` array held the right
value. Pressing the proposal exactly as `arguments` describes it returns
`unknown_trip`.

The browser survives it by accident: `HelperAsk` posts `arguments` merged with
the *fields* and the person's edits, so the resolved id wins. **Anything that
reads `arguments` — which is what `arguments` is for — breaks.**

A tester found it by pressing the proposal the way its own data says to. Her
warning is the right one: *"If a real 'press this button' UI wires the button to
`proposal.arguments`, publishing a day would break the same way 'the button
isn't there' broke the second time."*

B927 made the model stop inventing ids by having tools resolve names. This is
the other half of the same problem: the resolution happens, and then the
unresolved name is handed back out.

## Work

One representation. `arguments` should be what the press sends — resolved,
correct, complete — and `fields` should be the same values shown for
correction, not a second source of truth.

Assert it: for every write tool, a proposal's `arguments` merged with nothing
must be a body the endpoint accepts. That is a test over the registry, like the
tracks one B929 added.

## Acceptance

Pressing a proposal using only `arguments` performs the write.
