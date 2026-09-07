---
id: B851
title: A photograph cannot be removed from a day
type: FEATURE
priority: high
complexity: low
area: agent, media
found: "2026-09-07T17:02:26Z"
started: "2026-09-07T17:03:02Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-07T17:03:02Z"
---

# B851 — A photograph cannot be removed from a day

## Why

`DELETE /api/v1/<user>/trips/<trip>/media` exists and works. Nothing in the
browser calls it, so a photograph, once uploaded, cannot be taken out of a day
by the person who owns it.

B816 gave a published day a takedown for exactly one reason — a friend in a
photograph asked to come out of it — and answered it by taking the **whole day**
off the site. That is the right emergency lever and the wrong everyday one: the
day is usually fine and one picture is not.

It is also the request most likely to arrive from somebody who is not the
owner, about a face, with an expectation of promptness.

## Work

A remove control on each photograph in the wizard's photo step, behind a
`ConfirmPanel` that says what happens: the picture goes from the day, and the
original goes too if nothing else uses it. Say plainly whether it is
recoverable — `DELETE` removes derivatives and the original, so the honest
answer is probably no, and that is exactly the sentence a person needs before
pressing.

Check what happens to a caption and to the day's own `gallery` order.

Consider whether per-photograph `visibility` (B596 — `guest`/`private` on a
single item, which narrows and never widens) is the gentler answer for the same
request, and offer both: hide it, or remove it.

## Acceptance

An owner can take one photograph out of a day from the browser, and is told
before pressing whether it can come back.
