---
id: B719
title: Two different edits of the same length collide on one idempotency key
type: ISSUE
priority: medium
complexity: low
area: agent, api
found: "2026-09-07T11:44:10Z"
started: "2026-09-08T19:51:05Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T19:51:05Z"
---

# B719 — Two different edits of the same length collide on one idempotency key

## Why

`components/AgentWizard.tsx` builds its idempotency key as
`${trip}/${slug}/${prose.length}`. Two different edits of the same draft that
happen to be the same number of characters produce the same key, so the second
one is answered `409` instead of being written up — and a person who rewrote a
sentence to the same length is told, wrongly, that they already asked this.

The fix is a key that is random per attempt and survives a re-render. It was
left because another session was in the same file at the time (B684 was built
beside B683).

## Acceptance

Two different edits of equal length both get a write-up. The key is not derived
from the content.
