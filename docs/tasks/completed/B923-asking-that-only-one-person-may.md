---
id: B923
title: Asking that only one person may read it proposed shutting her out
type: ISSUE
priority: high
complexity: low
area: agent, model
found: "2026-09-08T07:08:54Z"
started: "2026-09-08T08:05:58Z"
merged: "2026-09-08T08:25:25Z"
completed: "2026-09-09T16:47:14Z"
---

# B923 — Asking that only one person may read it proposed shutting her out

## Why

She said, in German: *"nur meine Tochter soll das lesen können"* — only my
daughter should be able to read this.

The proposal came back with **`privat — nur die Leute, die dabei waren`**.

Her daughter was not at the lake. `private` means the people on the trip, so
the proposed setting would have shut out the one person she named. She caught
it only because the field's label was legible, and said so.

AGENTS.md warns about exactly this pair, in these words: *"the line between the
two closed values is what a person gets wrong at the moment they create a trip
— `guest` means the people I let into this journal; `private` means only the
people who were there."* The model has now made that mistake on somebody's
behalf, in the direction that excludes.

The proposal mechanism worked — she could see it and correct it. But a person
who trusts the answer publishes a trip that hides it from their family.

## Work

Teach the distinction where the choice is made. The `create_trip` tool's
description and the visibility field's own words must carry the sentence
AGENTS.md uses, and "only X should read it" where X is a person must land on
`guest`, not `private`.

A person named is a guest. `private` is for a trip whose readers are its
travellers, and nothing else.

Consider whether the field should be a `choose` block with both meanings
spelled out rather than a text field with a value in it — this is the one
setting where reading the label is the whole safety.

## Acceptance

"Only my daughter should read this" proposes `guest`, and the words on the
screen say who each value lets in.
