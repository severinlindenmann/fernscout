---
id: B951
title: Taking down a day that was never up is proposed as though it were live
type: ISSUE
priority: medium
complexity: low
area: helper, tools
found: "2026-09-08T11:09:17Z"
started: "2026-09-08T11:09:24Z"
merged: "2026-09-08T11:13:47Z"
completed: "2026-09-09T16:46:35Z"
---

# B951 — Taking down a day that was never up is proposed as though it were live

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`unpublish_day`'s `propose` does not look at whether the day is published. Ask
to take down a day that is still a draft and a proposal arrives saying:

> …comes off the site and goes back to being a draft. Nothing is deleted…

The day was never on the site. Nothing is written — `POST .../day/unpublish`
answers `already_draft`, and since B948 that has a sentence of its own — but
the person has been told, in the card they are reading before pressing, that
their day is currently live. It is not.

`publish_day` has the matching check and refuses at propose time; this is its
mirror and was not given one. B944 is the same fault one step later: a sentence
about a state nobody verified.

## Work

`propose` reads the day it resolved — `resolveDay` already returns the entry —
and proposes nothing when it is already a draft, which reaches `runTool`'s
"nothing was proposed" path with a reason the model can say.

Not doing: changing what the route answers. `already_draft` is right and stays.

## Acceptance

A test proposing `unpublish_day` for a draft day, failing if a proposal comes
back. The published case must still propose.
