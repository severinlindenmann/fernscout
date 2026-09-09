---
id: B1033
title: AgentDoor.tsx still imports the per-journal card B984 deleted
type: CHORE
priority: low
complexity: low
area: agent, ui
found: "2026-09-08T21:17:49Z"
started: "2026-09-09T06:10:01Z"
session: f88144a1-6520-4fc1-94bd-496a694b98c8
claimed: "2026-09-09T06:10:01Z"
---

# B1033 — AgentDoor.tsx still imports the per-journal card B984 deleted

## Why

Found while validating B784. B984 ("/agent is the room",
`git show a68b5b5d -- components/AgentDoor.tsx`) deleted the whole
`{signedIn && journals.length > 0 && (...)}` block from `components/AgentDoor.tsx`
— the per-journal card, its yellow "resume/start a day" button, and the
`journals` prop itself — but left the imports and one constant that block was
the only user of:

```
npx eslint components/AgentDoor.tsx
  4:8   'Link' is defined but never used
  6:8   'AgentHandover' is defined but never used
  7:8   'AgentRow' is defined but never used
  8:8   'HelperAsk' is defined but never used
  46:7  'LOW_CREDITS' is assigned a value but never used
  81:3  'siteUrl' is defined but never used
  105:14 'tn' is assigned a value but never used
  105:26 'formatLongDate' is assigned a value but never used
```

The file also still exports `type AgentJournal`, which nothing outside the
file uses any more — the `journals` prop that consumed it is gone from
`app/agent/page.tsx` too. None of this fails `npm run verify` today (these are
warnings, not errors, and `knip` did not flag the exported type in a spot
check), but it is dead weight in a file whose doc comments also still describe
the deleted per-journal card as if it were current — misleading to the next
reader.

## Work

- Drop the unused imports (`Link`, `AgentHandover`, `AgentRow`, `HelperAsk`),
  the unused `LOW_CREDITS` constant, and the unused `siteUrl` param (or wire
  it back in if it should be used — check whether `AgentBlock` needs it).
- Drop `tn`/`formatLongDate` from the `useI18n()` destructure if nothing below
  uses them.
- Decide whether `export type AgentJournal` should still be exported at all,
  or moved/deleted, now nothing outside the file consumes it.
- Update the stale doc comments in `AgentDoor.tsx` that still describe
  "each journal's own AgentHandover above" and "the journal card it used to
  draw" as current behaviour rather than history — B984 already deleted the
  card; the file's own comment block should say so once, not still narrate it
  as though it's there.

## Acceptance

`npx eslint components/AgentDoor.tsx` reports zero `no-unused-vars` warnings,
and the component's doc comment accurately describes what the file renders
today (no journal-card branch).
