---
id: B689
title: A bank statement or a timeline export cannot be handed over on the web
type: FEATURE
priority: low
complexity: high
area: agent, importers, costs
found: "2026-09-07T09:53:02Z"
started: "2026-09-07T13:26:08Z"
merged: "2026-09-07T13:57:50Z"
completed: "2026-09-09T16:44:40Z"
---

# B689 — A bank statement or a timeline export cannot be handed over on the web

## Why

Plan §11. The two files people actually have are a bank statement and a
location export, and both are worth more to a journal than anything they can
type: costs that are real, and a route that was actually driven. `importers/`
already parses Google Timeline, Takeout, GPX and JSON Lines on a checkout, and
`lib/inbox.ts` already holds a file that belongs to no day yet — so after B683
the file is on disk and unread. This closes the last gap: reading it over the
web.

## Work

- A screen for what is sitting in the inbox, and what each file could become.
- GPS exports go through the existing `importers/gps/` parsers — no model.
- A bank statement is the case that needs one, and the pattern is the cheap
  one: **the model returns a column mapping, code applies it to every row.**
  One call for a 2000-line statement, not two thousand. The mapping is shown
  for confirmation before any cost is written.
- A `importers/costs/` with its own `schema.ts`, per `importers/README.md` —
  never a file beside `gpx.ts`.

Not doing: bulk import of a whole past trip. That is its own task.

## Acceptance

A Revolut CSV and a Google Timeline JSON both reach the right place from a
phone: costs land in `costs.md` after the owner confirms the mapping, fixes
land in `gps/` and nowhere a route can read them.
