---
id: B933
title: Nothing tells you who can actually read what you just published
type: FEATURE
priority: medium
complexity: low
area: agent, ui
found: "2026-09-08T08:36:53Z"
---

# B933 — Nothing tells you who can actually read what you just published

## Why

Her third suggestion, and it is the one that would have caught B931 herself:

> "A person-facing summary at the end of a session — here is exactly who can
> read what you just published — so a claim like this is falsifiable by the
> reader in one look, not only by an agent calling the API."

She could only discover that her daughter had no access by reading `people: []`
and `invites: []` out of the API. Nobody else can do that.

Every persona in this project has asked some version of "can my mother read
this", and the answer has always required either trusting a sentence or calling
a route.

## Work

After publishing — and available on demand — a plain statement of who can read
this trip, by name where there are names: the owner, the people on the trip,
the guests approved into the journal, or anybody at all. Not the vocabulary
(`guest`, `private`), the **people**.

`who_can_read` is already in the inventory's read tools and half-built. This is
its rendered form, and it belongs on the day the person just published as much
as in the conversation.

## Acceptance

After publishing, a person can see in one look who can read it, without asking.
