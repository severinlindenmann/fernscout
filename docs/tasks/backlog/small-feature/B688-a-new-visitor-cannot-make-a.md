---
id: B688
title: A new visitor cannot make a journal inside the helper
type: FEATURE
priority: low
complexity: medium
area: agent, signup
found: "2026-09-07T09:53:01Z"
---

# B688 — A new visitor cannot make a journal inside the helper

## Why

Plan §6 and the decision that the helper runs the whole signup itself. A person
who has never had a journal is the least forgiving moment in the product to
bounce somebody to a different page — and today they would meet `/welcome`,
which was written for somebody who already knows what this is.

## Work

- Email + code, journal name, username, and the first trip, inside the same
  wizard, wrapping the existing `signup` capability and its routes.
- The free credit grant on a new journal (plan §6), so the first trip costs
  nothing.
- Refuse reserved usernames with the reason, not a validation error.
- If `signup` is off — the default — say so plainly rather than showing a form
  that cannot work.

## Acceptance

A visitor with no journal reaches a published first day without leaving
`/agent`, and without being asked for a card.
