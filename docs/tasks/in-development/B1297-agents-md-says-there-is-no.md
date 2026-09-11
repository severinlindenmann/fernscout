---
id: B1297
title: AGENTS.md says there is no form that maps fields onto frontmatter, and Correct this day is one
type: DOCS
priority: medium
complexity: low
area: agents.md
found: "2026-09-10T11:06:25Z"
started: "2026-09-11T14:10:09Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T14:10:09Z"
---

# B1297 — AGENTS.md says there is no form that maps fields onto frontmatter, and Correct this day is one

## Why

AGENTS.md opens with this, as the frame for everything after it:

> **The content is markdown and photographs in a folder the author owns.** There
> is no CMS, and there will not be one (ROADMAP decision 24): **no form that maps
> fields onto frontmatter, no upload widget with its own idea of what a day is.**

Tap **Correct or take down** on a published day, signed in as the owner, and you
get a form with:

| field | frontmatter |
| --- | --- |
| Date | `date` |
| Who may read this trip | the trip's `visibility` |
| Advertise this trip | the trip's `listed` |
| Title | `title` |
| Time | `time` |
| Place | `location` |
| Text | the body |
| a caption and a visibility per picture | `gallery[].caption`, `gallery[].visibility` |
| **Choose files** | an upload widget |
| Who sees this update | the entry's `visibility` |

That is a form mapping fields onto frontmatter, and an upload widget, on the same
screen. It is clearly deliberate — B862 built part of it and cites
`components/EditDay.tsx` by name — and it is a good feature: correcting a typo in
your own day should not require a conversation.

The problem is the document. AGENTS.md is the first thing every agent working in
this repository reads, and it states as an absolute the thing the product has
stopped doing. An agent reading it will refuse work it should do, or "fix" the
edit form by deleting it, or write a ticket arguing the form violates the rule —
which is close to what this ticket is.

The distinction that seems to be true in the code is worth writing down: **an
agent is the only thing that *writes* a day; a person may *correct* one they
already have.** That is a coherent rule and it is not the one the file states.

## Work

- Say what the rule is now, in AGENTS.md, in the same place. Whatever the
  sentence is, it has to survive somebody finding `EditDay.tsx`.
- Check `/agent.md` and `docs/` for the same absolute, since the guide over the
  network makes the same promise to agents who will never see this form.
- Not in scope: changing the form. This ticket is words.

Built, 2026-09-11: reworded AGENTS.md's opening paragraph (was lines 14-15) to
say the distinction the ticket half-drafted — **an agent is the only thing
that writes a day; a person may correct one they already have** — naming
`components/EditDay.tsx` (B980) as that correction and stating it writes no
field the day did not already carry. Left AGENTS.md:38-40's separate claim
about the wizard alone; that one (the helper turns speech into a day through a
model rather than a direct field-set) is still true.

The same absolute turned out to be in three more places than the ticket
named: `docs/helper.md:4` (named in the brief), and also `README.md:9`, found
by grepping the repository for the phrase after fixing AGENTS.md. Both
reworded the same way. `docs/tasks/` and `components/EditDay.tsx`'s own
docstring quote or restate the old absolute as history rather than current
claim, so left alone.

## While you are there

The edit form renders the day's prose in **IBM Plex Mono at 14px** — about forty
characters a line at 390px, in a monospace face, for what is elsewhere set as
travel writing. Defensible for markdown, worth a deliberate answer rather than an
inherited one.

## Acceptance

- AGENTS.md describes what a person may edit directly and what only an agent may
  write, and an agent reading it does not conclude `EditDay.tsx` is a bug.
- No document in the repository still says there is no form that maps fields onto
  frontmatter.
