---
id: B48
title: Nothing says what ownerNickname should be when the agent and the owner are the same person
type: CHORE
priority: low
complexity: low
area: docs, journals
found: "2026-09-01"
started: "2026-09-04T06:22:41Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T06:22:41Z"
---

# B48 — Nothing says what ownerNickname should be when the agent and the owner are the same person

## Why

Reported by an agent creating a journal:

> `POST /journals` requires `ownerNickname` but the docs never say what happens
> if the journal owner and the agent are the same person.

The documentation is emphatic that `ownerNickname` is never derived from
`ownerName` — a first-word split mangles any name whose given name is not
first — and that the agent must ask. Good rule, and it is stated in three
places. What none of them cover is the case where there is nobody to ask in the
way the guide imagines: the person typing at the agent *is* the owner, and has
already given their name in the same breath.

The agent is then in an awkward spot. It has been told twice, firmly, never to
guess a nickname; it has one name and one human in front of it; and the guide
has no sentence for that situation. The likely outcomes are a needless
clarifying question, or the guess the guide forbids.

Small, but it is on the first call an agent makes and it is the field the guide
spends the most words on. A sentence closes it.

## Work

- One line in the `firstQuestions` entry for the name (in
  `lib/api/agentCopy.ts`, which both documents render from) saying that when
  the person you are talking to is the owner, this is still a question to ask
  them — "what should the site call you?" — and not a thing to infer from the
  name they gave. Asking a person about themselves is cheap; the rule exists
  because *deriving* is what breaks.
- The same sentence in the `ownerNickname` description in `openapi.json`, which
  is where the rule is currently stated most starkly and where an agent reading
  only the contract will meet it.

Not doing: relaxing the requirement, or adding a default. The reason it has no
default is sound and unchanged.

## Acceptance

- `/agent.md`, `/documentation.txt` and `openapi.json` all answer the question
  "the owner is right here, what do I put?" without an agent having to infer.
- The existing test that the guide never derives a nickname still passes.
