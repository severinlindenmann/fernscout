---
id: B526
title: "\"Two fields\" lists three, and the journal script never asks for the required title"
type: DOCS
priority: medium
complexity: low
area: agent.md
found: "2026-09-05T21:30:00Z"
started: "2026-09-05T21:20:43Z"
merged: "2026-09-05T21:32:12Z"
completed: "2026-09-07T13:11:39Z"
---

# B526 — "Two fields" lists three, and the journal script never asks for the required title

## Why

Two inconsistencies from a real run, both in the agent-facing copy:

1. **"Two fields can only be set here, because nothing edits a `trip.md` after
   creation for either of them"** (`lib/api/documentation.ts:1073`) is followed
   by a table of **three** rows: `people`, `translations`, `travellers`. The
   count was right before `travellers` was added and nobody moved the number.
   Once B524 lands the sentence is wrong in the other direction too — two of
   the three get a door.
2. **The journal's `title` is required and never asked.** `firstQuestions()`
   (`lib/api/agentCopy.ts:391`) covers email, username, visibility,
   name/nickname, `defaultLocale`, `locales` — six questions — and `title`
   appears only later, among the required fields. An agent following the
   script hits a refusal, or invents a title, which is the worse outcome.

## Work

- Render the count from the table rather than typing it, so it cannot drift
  again — the same reason `scriptIntro` takes `questions.length`.
- Add the journal's title to `firstQuestions()`. It is correctable through
  `PATCH .../config`, so it is a question, not a permanence warning.
- Re-read the surrounding paragraph after B524 merges: the sentence's claim is
  "nothing edits a trip.md", and that stops being true.

## Acceptance

- No hard-coded count in front of a generated table anywhere in
  `lib/api/documentation.ts`.
- The journal script asks for a title, and `scriptIntro`'s number follows.
- `npm run verify` green.
