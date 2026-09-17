---
id: B1832
title: A day cannot be moved, split or merged without an agent
type: FEATURE
priority: medium
complexity: medium
area: studio, days
found: "2026-09-17T05:11:56Z"
---

# B1832 — A day cannot be moved, split or merged without an agent

## Why

Days come out wrong. Two days get written as one because the traveller was
tired; one day turns out to span a border and wants splitting; a day gets filed
against the wrong trip, or the wrong date, because the photographs were taken
after midnight.

None of that can be done from the website. It is agent-only work today, which
makes the structural edits — the ones people most need when something has gone
wrong — the ones most likely to go wrong again.

The rarest of the studio flows (B1829), and the most painful when it is needed.

Plan: `docs/plans/2026-09-17-the-studio.md`.

## Work

A *Move, split or merge* flow. Three operations sharing a preview:

- **Move** — change a day's date, or move it to another trip. The slug and the
  media folder follow it.
- **Split** — one day becomes two, with the photographs divided between them.
- **Merge** — two days become one, galleries concatenated in time order.

These touch on-disk layout (`trips/<trip>/entries/`, `trips/<trip>/media/<slug>/`)
and so need care that nothing is orphaned: check what else references a slug —
covers, photobook layouts, postcard orders, published permalinks.

**A published day that moves changes a public URL.** Decide and state what
happens: leave a redirect, refuse to move published days, or require
unpublishing first. Do not let it silently break a link somebody has shared.

The preview must show both the before and the after. This is the flow where an
unclear preview loses somebody's content.

Not doing: bulk reorganisation of a whole trip. One structural edit at a time.

## Acceptance

- A day can be moved to another date and to another trip, with its media.
- A day can be split in two and two days merged, with photographs ending up
  where the preview said they would.
- Nothing that referenced the old slug is left pointing at nothing.
- The published-URL question is answered explicitly in the flow's behaviour.
- Verified in a real browser, on a copy of real content — not only on a fixture
  authored for the change.
- `npm run verify` passes.
