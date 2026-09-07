---
id: B874
title: Captions read like an inventory of shapes rather than a caption
type: ISSUE
priority: low
complexity: low
area: agent, model
found: "2026-09-07T17:37:28Z"
---

# B874 — Captions read like an inventory of shapes rather than a caption

## Why

The captions are honest and unlovely. From the audit:

> `"Tall pointed structure against a light blue sky, with a red informational
> panel on the left and green shape at the bottom"`

Every honesty rule held — no place, no person, no mood, nothing invented, under
a picture built specifically to bait all three. The register is the problem: it
reads as a machine enumerating rectangles and their positions, not as something
a person would write under their own photograph.

The auditor traced it to one line of `PHOTO_SYSTEM_PROMPT`:

> A plain caption of what is actually in the frame — **the colours, the
> setting, the action** — beats a caption that reaches for any of that

That list is an invitation to inventory. Its proposed replacement:

> A plain caption of what is actually in the frame beats a caption that reaches
> for any of that. Write it as somebody would label their own photograph — a
> handful of words naming the subject, not an inventory of every shape and its
> position in the frame.

## Work

Change the register only. **Do not touch the honesty rules** — they were tested
hard and held, and they are the reason this feature can exist at all.

Then re-run the audit's own fixtures against the live model, because B829
established that rewording a prompt is not a change until it is measured.

## Acceptance

A caption reads like a label somebody wrote, and still names no place, no
person and no mood.
