---
id: B1427
title: The draft banner's height at 390px needs its own cleanup pass
type: ISSUE
priority: low
complexity: low
area: components/DraftNotice.tsx
found: "2026-09-11T07:44:54Z"
---

# B1427 — The draft banner's height at 390px needs its own cleanup pass

## Why

Split out of the B1257 run's plan-a-run answers, which flagged a
390px-viewport height concern on `DraftNotice` (`components/DraftNotice.tsx`)
as worth its own ticket rather than riding along on B1257's `canPublish`
fix. No specific pixel measurement or screenshot is attached to this
capture — the brief that produced B1257 named the cleanup but not the
exact fault. Whoever picks this up should open `/docs/branding/day`
(the day-card workbench, which renders `DraftNotice` directly with no
journal needed) at 390px and look, per `check-a-drawing`, before
deciding what is actually wrong.

## Work

Unknown until somebody has looked. Candidates worth checking first: the
banner's `items-start` + `gap-3` layout with a long `draft.bodyShared`
string wrapping to several lines, and whether the icon's `mt-0.5`
alignment still reads right once it does.

## Acceptance

A decision, once looked at: either a concrete fix with a before/after at
390px, or this ticket closed as `wontDo` with the reason it turned out
fine.
