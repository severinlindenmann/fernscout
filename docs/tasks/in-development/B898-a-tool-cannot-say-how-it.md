---
id: B898
title: A tool cannot say how it should look in the conversation
type: FEATURE
priority: high
complexity: high
area: agent
found: "2026-09-08T04:52:36Z"
started: "2026-09-08T04:54:27Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-08T04:54:27Z"
---

# B898 — A tool cannot say how it should look in the conversation

## Why

`docs/plans/2026-09-08-the-chat-is-the-product.md`, round 1.

B889 gave the helper a thread and seven read tools, and every answer comes back
as prose. That is enough to answer a question and not enough to *do* anything:
a trip cannot be offered as a list to pick from, a day cannot be shown, a write
cannot be checked before it happens.

The owner's decision is that the conversation is the only surface. So the
conversation has to be able to render more than a paragraph — and the thing
that decides what it renders must not be the model.

**A tool declares how its result looks. The model chooses tools and never
chooses a shape.** That is the safety argument in one sentence: the model
cannot ask for a component nobody built, a new capability is one tool with one
declared shape, and every shape is testable before a person sees it.

## Work

A `Tool` type carrying: name, an arguments schema, `kind: "read" | "write" |
"link"`, and `renders` — one of `say`, `choose`, `form`, `preview`, `files`,
`confirm`, `link`.

One registry. **The model's tool list is generated from it**, the way
`intentList()` already generates the intent list, so the two can never
disagree.

Three kinds, three behaviours, and the difference is the whole design:

- **read** — executes immediately and returns its rendered block. There is
  nothing to confirm about a question.
- **write** — **never writes.** It returns a proposal: the tool, the arguments
  filled in, and a sentence saying what will happen. Accepting it is B900.
- **link** — returns a sentence and a URL and touches nothing. This is how
  postcard sending and journal deletion stay where they are.

Port the seven read tools from B889 onto the contract unchanged, so this
refactors rather than rewrites.

Checklist A in the plan is the acceptance; work to it.

## Acceptance

Every tool declares a shape the client can render, no write tool can reach disk
without an accepted proposal, and adding a tool needs no client change.
