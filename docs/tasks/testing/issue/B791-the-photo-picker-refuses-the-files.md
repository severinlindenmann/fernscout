---
id: B791
title: The photo picker refuses the files the import screen was built to read
type: ISSUE
priority: high
complexity: low
area: agent, media, importers
found: "2026-09-07T14:43:12Z"
started: "2026-09-07T14:46:58Z"
merged: "2026-09-07T15:04:27Z"
---

# B791 — The photo picker refuses the files the import screen was built to read

## Why

Both file inputs in `components/AgentWizard.tsx` carry
`accept="image/*,video/*"`. The helper's media route already files anything
that is not media into the inbox — `storeInboxFile(user, "files", …)` at
`app/api/helper/[user]/day/media/route.ts:101` — and the inbox screen
(`components/AgentInbox.tsx`) reads GPS exports, maps bank statements and draws
a trip's line.

**None of that is reachable, because the picker will not let a person choose
the file.** B689 shipped a whole feature — the statement column-mapper, the
Google Timeline import, the trip line — that nobody without an API token can
start.

Two independent reviews disagreed about this and both were half right: one said
the server could not take the file, the other that it could. The server can;
the picker cannot.

This is the smallest change in the backlog with the largest effect.

## Work

Widen `accept` on the picker so a statement or an export can be chosen, and say
on the screen what may be dropped there — photographs and videos for the day, a
bank statement or a location export for the inbox. The route already sorts
them; the label has to stop lying about what is welcome.

Consider whether the inbox screen wants a picker of its own (the plan's
`stage_file` row assumes one), or whether the wizard's picker is the only door.
One door is probably right.

Not doing: any change to how the files are read once staged — that all works.

## Acceptance

A person can choose a `.csv` on a phone, see it arrive in the inbox, and reach
the column mapping — without an API token.
