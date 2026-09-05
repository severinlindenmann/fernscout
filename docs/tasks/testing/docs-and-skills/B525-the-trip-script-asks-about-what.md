---
id: B525
title: The trip script asks about what is repairable and stays quiet about what is permanent
type: DOCS
priority: high
complexity: low
area: agent.md
found: "2026-09-05T21:30:00Z"
started: "2026-09-05T21:20:42Z"
merged: "2026-09-05T21:32:12Z"
---

# B525 — The trip script asks about what is repairable and stays quiet about what is permanent

## Why

`tripQuestions()` (`lib/api/agentCopy.ts:471`) is five questions: id, title,
start/end, visibility, money. It does not ask about `people` or `travellers` —
the only two fields on that call that could never be set again (B524). Both
`visibility` and `rates`, which *are* correctable, are in the script.

The list asks about what is repairable and stays quiet about what is not, and
`scriptIntro` says "This is a script, not a menu: ask all five … Do not start
on a guess." An agent that follows it exactly creates a trip that cannot carry
its travellers. That is what happened in the reporting run — it is the root
cause of B524, and the cheaper half of it.

## Work

- Add both to `tripQuestions()`, flagged permanent the way `id` already is —
  and once B524 ships, say accurately what can be corrected and where.
- `travellers` reuses the existing "ask, never infer" sentence rather than
  restating it; `people` says out loud that it is write access and the byline,
  so an agent knows it is asking a question with consequences.
- Both documents render this list already
  (`lib/api/documentation.ts:240` and `:1035`), so there is one edit, not two.

## Acceptance

- `/agent.md` and `/documentation.txt` both ask about `people` and
  `travellers` before a trip is created, and `scriptIntro` counts them.
- `test/agent-interface.test.ts` asserts both appear.
- `npm run verify` green.
