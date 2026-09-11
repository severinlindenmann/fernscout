---
id: B1116
title: plan-a-run re-opens questions a ticket has already decided unless the dispatch says not to
type: DOCS
priority: medium
complexity: low
area: skills
found: "2026-09-09T17:13:56Z"
started: "2026-09-11T14:52:00Z"
merged: "2026-09-11T15:11:41Z"
---

# B1116 — plan-a-run re-opens questions a ticket has already decided unless the dispatch says not to

## Why

Several tickets here carry more decision than description. B1065 is 305 lines
of which about 200 are five rounds of the owner answering questions — SMS over
inbound WhatsApp, signup only, the ceilings, Twilio Verify over seven.io, fork
A over fork B, the two-call seam. A planner that meets that file and dutifully
generates "two or three options, each a different stance" is re-opening
questions that are closed, and the person answering the artifact has to close
them a second time.

On 2026-09-09 this was avoided only because the dispatch said so by hand:
*"the owner has already chosen … do not re-open a decided question."* That
worked — B1065 came back with zero options and a one-sentence note saying why
— but it worked because one person remembered to write it, which is exactly
the kind of guarantee this repository keeps turning into machinery.

## Work

Add to `plan-a-run`'s step 2 dispatch, as a standing instruction rather than a
per-ticket one: read the ticket's decision sections first — a `## Decided`
heading, or any section dated after the ticket was filed — and treat what they
settle as settled. Options are only for what is genuinely still open. A
planner that believes a decision is wrong says so as a QUESTION with the
reasoning, which is a different and much cheaper thing than an option set.

State the failure it prevents: a decided question re-asked is not neutral. It
costs the person the same minute twice, and it invites a different answer from
the one the code was already written toward.

**Done.** `plan-a-run` step 2's dispatch block now opens with a standing
instruction, before the numbered VALIDITY/CONFLICT/BEFORE-STATE/OPTIONS/
QUESTIONS steps: look for a decision section already in the ticket — named as
a shape (a section, later than the ticket's own filing, that settles a fork
rather than describing one) rather than one exact heading string, since the
recorded tickets use `## Decided`, `## Decision`, `## Decided, <date>` and
others interchangeably. What it settles is treated as settled — no option set
for it, no re-asking it as a QUESTION — and disagreement with a recorded
decision becomes a QUESTION with reasoning, never a fresh option set.

## Acceptance

- The dispatch block in `plan-a-run` carries the instruction.
- A planner given a ticket with a `## Decided` section returns zero options
  for anything that section settled, and any disagreement arrives as a
  question.
