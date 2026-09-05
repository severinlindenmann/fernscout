---
id: B307
title: Onboarding is prose, so an agent asks a different set of questions in a different order every time
type: ISSUE
priority: high
complexity: medium
area: agent docs, onboarding
found: "2026-09-04T15:33:58Z"
started: "2026-09-04T16:10:28Z"
merged: "2026-09-04T16:29:36Z"
completed: "2026-09-05T09:28:03Z"
---

# B307 — Onboarding is prose, so an agent asks a different set of questions in a different order every time

## Why

Reported by the owner on 2026-09-04, watching a capable agent create a journal:
*"right now it always jumps steps or is inconsistent … he does not ask."*

The transcript bears it out. The agent fetched `/documentation.txt` and
`/agent.md`, asked three questions, then asked two more, then asked three
more — in three separate rounds, interleaved with **three fetches of the 56KB
guide**, and it never asked for the owner's name or nickname at all (it
inferred them from conversation and offered them for correction, which the
guide forbids in as many words).

Nothing it did was unreasonable. The questions exist and are correct — B256
put them in both documents, B267 and B277 added two more, and the count is now
six. But they are **prose in a table inside a 56KB document**, and prose does
not tell an agent *these, all of them, once, before the first call, and here is
exactly what each answer may be*. So each agent reconstructs an order, and a
weaker one drops the questions its own summary lost.

Three flows have this shape and none of them has a script: creating a journal,
creating a trip, writing a day. The journal one is worst because it is the
only one an owner does exactly once, with no chance to learn the shape.

## Work

Give each of the three flows an explicit, ordered script in both documents —
the questions as a numbered list, each with its **allowed answers** and the
**field it becomes**, and an instruction to ask them all before the first call
and not to proceed on a guess. `lib/api/agentCopy.ts` already holds
`firstQuestions()` as structured data rendered into both documents, so the
material exists; what is missing is that it does not read as a procedure and
does not name the accepted values beside each question.

- **Creating a journal.** Six questions today. Name the permitted values
  inline — `visibility` is two words and `defaultLocale`/`locales` are three
  codes, so an agent has no reason to offer a value the API will refuse
  (which is exactly what happened: `guest` was offered and refused twice —
  B306). Say that `ownerName` and `ownerNickname` are **asked, never
  inferred**, in the script and not only in the prose below it.
- **Creating a trip.** Budget and coordinates (B267), visibility, dates, id.
  Same treatment.
- **Writing a day.** Which fields are required, which the journal's languages
  make required (B294), and that photographs are a second call.
- **One sentence at the top of each script saying it is a script**: ask all of
  it, in order, once, and do not start until every answer is in hand.

Read what `firstQuestions()` renders into each document before adding a third
representation of the same material. If the right answer is that the existing
table becomes the script, that is a better outcome than a new section beside
it — two lists of questions that can drift apart is the failure mode this
project has hit repeatedly.

Related and deliberately separate: B308, that these documents have grown to
the point where an agent re-fetches them. A script an agent can follow from one
read is part of the answer to that, but the size problem is its own task.

## Acceptance

- Both documents carry a numbered question script for each of the three flows,
  each question naming its allowed values and the field it becomes.
- No question in a script can be answered with a value the API refuses.
- A test asserts every value named in the journal script is one
  `POST /api/v1/journals` accepts — so the script cannot drift from the
  validator.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.

## Ordering

**B306 first, then this, then B308** — the owner asked for this one first, and
it has a dependency they could not see from the question: B306 renames the
journal's visibility values, which this ticket's script has to name. Written
first, the script would say `public | private` and be wrong within the hour.

B308 follows this rather than preceding it: writing the scripts is what shows
which prose has become redundant, so the trimming has evidence behind it
instead of being a guess about what an agent still needs.
