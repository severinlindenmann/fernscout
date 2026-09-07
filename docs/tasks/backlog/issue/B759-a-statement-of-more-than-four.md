---
id: B759
title: A statement of more than four hundred payments is silently cut short
type: ISSUE
priority: low
complexity: low
area: agent, costs
found: "2026-09-07T13:57:56Z"
---

# B759 — A statement of more than four hundred payments is silently cut short

## Why

`app/api/helper/[user]/statement/apply/route.ts:132` caps the row list at 400
and reports `truncated` in its answer — and the screen never renders that
number. So a trip with six hundred payments shows four hundred, with nothing
saying the other two hundred exist.

The cap itself is reasonable on a phone. Being silent about it is the part that
is not: somebody reconciling a statement against their own bank app finds a
shortfall and no explanation for it.

Found while building B689.

## Acceptance

A statement with more rows than the cap says so on the screen, with the count.
