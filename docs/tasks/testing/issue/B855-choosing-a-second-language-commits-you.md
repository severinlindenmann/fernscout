---
id: B855
title: Choosing a second language commits you to writing everything twice and the API never says so
type: ISSUE
priority: high
complexity: low
area: api, journals, i18n
found: "2026-09-07T17:09:24Z"
started: "2026-09-07T18:41:34Z"
merged: "2026-09-07T19:07:22Z"
---

# B855 — Choosing a second language commits you to writing everything twice and the API never says so

## Why

B838 put the sentence on the signup form: choosing a second reader language is
a promise to write every day twice, and a day missing one is refused (B294).

`POST /api/v1/journals` says nothing. A 23-year-old tester driving the same
calls the wizard drives reported it exactly:

> "I said English and German, because German sounded like a normal extra
> option, not a leap. The server accepted `["en","de"]` with zero warning. No
> message said 'this means writing every single day twice.' I only found out
> the hard way — the very first day I tried to post got rejected until I
> supplied a full German translation too. **That's a landmine, not a
> question.**"

`/agent.md` tells an agent to warn about this. The API does not, and AGENTS.md
is explicit about what that costs: a weak agent omits whatever it is allowed to
omit. This is B277's failure with the numbers reversed — there, somebody asked
for three languages and got one; here somebody accepts two and discovers the
bill at their first refusal.

It is also the worst possible moment to discover it. His words: on a phone at
2am, posting before bed, this is a second-fail-and-I-am-out.

## Work

Say it in the response that accepts the choice. `POST /api/v1/journals`
already answers with an `asks`/`next` block; add what a second language commits
the owner to, and what the refusal will look like when a day is missing one.

Consider whether creating a journal with more than one locale should require an
explicit acknowledgement, the way anything with a lasting consequence does.
That is a bigger decision and belongs to a person; the sentence is the minimum.

This is now the **third** place the same promise must be true — the form,
`/agent.md`, and the API — so put the words in `lib/api/agentCopy.ts`, where a
sentence more than one document has to say already lives, rather than typing a
third copy that will disagree within a month.

## Acceptance

Nobody can choose two languages through any door without being told what it
costs them, in the same answer that accepts the choice.
