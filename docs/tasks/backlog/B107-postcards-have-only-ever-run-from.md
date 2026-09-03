---
id: B107
title: Postcards have only ever run from a laptop CLI, never as a capability of the deployed site
type: CHORE
priority: medium
complexity: medium
area: postcards, ops, capabilities
found: "2026-09-03"
---

# B107 — Postcards have only ever run from a laptop CLI, never as a capability of the deployed site

## Why

`/api/health` reports `postcards` as `not enabled on this server`.

B14 ran the pipeline end to end and it worked — but that was
`npm run postcard` from a laptop against the demo journal. The *capability* is
a different thing: it is database-backed (`lib/capabilities.ts:27`),
provider-specific, and it stops at a built request. B89 records that nothing
posts that request, and that `lib/api/documentation.ts:682–685` tells every
agent otherwise. So three things have never been established: whether the
switch works on the deployed site at all, what an agent is told it may do once
it is on, and whether any of the geometry survives a photograph the live
instance actually holds rather than one committed to the repository.

B86 is a live defect on this path — a recipient whose name has no ASCII
characters gets an empty filename, and each such card overwrites the last.

## Work

Enable postcards with the **`dry-run` provider**, deliberately. No money moves
in this task and no real provider is configured. Confirm `/api/health` flips.

Then drive it against a test journal on fernscout.ch:

- a photo the journal itself holds, one message, and two or three recipients —
  including one whose name has no ASCII characters at all (B86) and one
  address outside Switzerland;
- check what lands in `content/<user>/postcards/`, the filenames included;
- check the DPI warning against a real derivative — B13 found the same class of
  problem in the photobook, and the answer may be the same one;
- open the PDFs and look at the geometry, the bleed and the address block;
- read the built provider request and check it contains what a provider would
  actually need;
- then read what `/agent.md` and MCP tell an agent about this capability now
  that it is switched on, and check the promise against what happens (B89).

Standing rules for this run: any secret goes in `/etc/fernscout/env` and
nowhere else — never `content/config.json`, never a commit, never echoed back
into a chat. Work in a journal created for this, with days carrying
`test: true`, and do not write into a journal somebody is actually using.
Leave the instance as you found it, or say in this task what you left switched
on. Every defect becomes its own backlog task referencing this id — do not fix
anything here, so the finding and the fix stay separate records. B101 is the
same shape: an engagement whose output is other tasks.

## Acceptance

- Postcards enabled on fernscout.ch with the dry-run backend, and
  `/api/health` saying so.
- A set of cards generated from a live journal's own photograph, downloaded and
  looked at by a person.
- B86 reproduced or shown fixed, with the filenames as evidence.
- The agent-facing claims about ordering checked against what actually happens.
- One backlog task per defect, referencing B107, and the capability left in a
  stated state.
