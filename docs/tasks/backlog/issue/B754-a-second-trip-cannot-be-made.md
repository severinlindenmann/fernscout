---
id: B754
title: A second trip cannot be made from the wizard when the helper is off
type: ISSUE
priority: low
complexity: low
area: agent, trips
found: "2026-09-07T13:25:28Z"
---

# B754 — A second trip cannot be made from the wizard when the helper is off

## Why

`components/AgentWizard.tsx:703` — when a journal has no trips the wizard shows
`agent.noTrips` and stops. B688's signup wizard creates the first trip before
handing over, so a brand-new journal never meets this. Anybody wanting a
*second* trip does, and with the `helper` capability off there is no ask box
(B685) to make one either.

So on an instance running the helper without a model — which is the default,
and what every self-hoster has — the wizard can write days into trips that
already exist and can never make another one. The person is sent back to an
agent and the API for a thing the page is otherwise perfectly able to do.

Pre-existing, not introduced by B688, found while building it.

## Work

A "new trip" form in the wizard, using the same `POST /api/v1/<user>/trips`
call the signup wizard and the ask box already make. No model, no capability.
B731 wants the visibility question shown when a trip is made from the ask box;
whatever that panel ends up saying, this form should say the same thing.

## Acceptance

An owner with the `helper` capability off can make a second trip from `/agent`
and write a day into it, without leaving the page.
