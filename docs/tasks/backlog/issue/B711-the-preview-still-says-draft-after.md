---
id: B711
title: The preview still says draft after the day is published
type: ISSUE
priority: low
complexity: low
area: agent, ui
found: "2026-09-07T11:17:14Z"
---

# B711 — The preview still says draft after the day is published

## Why

In the wizard's last step, after the day is published, the preview card above
still carries the "Draft — not on the site yet" banner and its explanation,
while the panel below says "It is on the site." Two statements about the same
day, on one screen, contradicting each other.

Seen in a browser at 390px while verifying B682. Cosmetic, and exactly the kind
of cosmetic that makes somebody wonder whether the publish worked.

## Work

Re-read the day after a successful publish, or drop the preview once the
outcome panel appears.

## Acceptance

Nothing on the screen calls a published day a draft.
