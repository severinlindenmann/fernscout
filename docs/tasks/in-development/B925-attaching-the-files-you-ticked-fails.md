---
id: B925
title: Attaching the files you ticked fails with unknown day
type: ISSUE
priority: high
complexity: low
area: agent, media
found: "2026-09-08T07:12:20Z"
started: "2026-09-08T07:26:33Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-08T07:26:33Z"
---

# B925 — Attaching the files you ticked fails with unknown day

## Why

The one sentence the files pane exists for does not work.

A designer ticked two staged photographs and typed "put these on yesterday" —
the sentence the pane's own hint suggests. The proposal read *"Those two
photographs are ready to go on yesterday. Press to attach them."* The press
answered *"They are on the day."* and, underneath, **`That did not work:
unknown_day`**. `GET /api/v1/designer/inbox` showed both files still staged.

He then filed them himself with `POST …/trips/georgia-2026/media` using the same
ids the UI had, and that call succeeded immediately.

So the pane, the selection and the model's grasp of "these" are all right, and
the tool call underneath is wrong.

A second fault in the same flow: in another run the model **asked him for the
files' ids**, which appear nowhere in the interface — the "2 selected" line
carries no id. He had to read them out of the API.

Found live on 2026-09-08, the day B915 shipped.

## Work

Find why `attach_files` resolves a day the day route does not recognise —
`unknown_day` suggests the slug it sends is not the slug the day has, which is
the same class as B927 (an id derived rather than remembered).

Then make the selection resolvable **server-side**. The browser already sends
`selected`; the tool should not need the person to know an id, and a person
should never be asked to read one out.

## Acceptance

Ticking two photographs and saying "put these on yesterday" puts them on the
day, and nobody is ever asked for an id.
