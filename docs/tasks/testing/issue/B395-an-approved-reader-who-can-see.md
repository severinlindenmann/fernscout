---
id: B395
title: An approved reader who can see nothing is told on one page to ask for an invitation they already have
type: ISSUE
priority: medium
complexity: low
area: contacts
found: "2026-09-04T22:44:09Z"
started: "2026-09-05T07:11:50Z"
merged: "2026-09-05T07:28:03Z"
---

# B395 — An approved reader who can see nothing is told on one page to ask for an invitation they already have

## Why

Built the case B264 describes and could not reach before: a journal whose only
trip is `private`, a guest invited, pre-approved and confirmed. Two pages then
tell that reader different things, and one of them is false.

`/<user>/trips` gets it right:

> **Nothing here you can read** -- You are signed in, but nothing here is
> shared with your address yet. Ask Dara to widen it.

`/<user>/me` does not:

> **What you can read** -- Nothing yet. Ask whoever sent you here to invite you.

He *was* invited, by name, to that address, and the owner approved him -- the
same page says "Signed in as Tomas Iversen-Adeyemi" three lines above. Asking
him to seek an invitation he already holds sends him back to an owner who has
already done their part, and hides the actual state: he is in, and there is
nothing shared.

It also names nobody, where the trips page names Dara. B20/B278 fixed exactly
that for the *stranger's* me page ("This journal is kept by Robin ... ask Robin
to invite you"); the approved-but-sees-nothing case kept the un-invited
wording.

Observed on fernscout.ch (f5561fe).

## Work

Give the me page the state the trips page already distinguishes: approved with
nothing shared is not the same as not invited. Reuse the trips page's sentence
and its "ask <owner>" naming rather than writing a third variant.

## Acceptance

An approved reader of a journal whose trips are all private is not told to ask
for an invitation, and is told who to ask to widen access.
