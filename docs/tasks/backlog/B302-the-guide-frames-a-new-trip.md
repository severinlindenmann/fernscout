---
id: B302
title: The guide frames a new trip as private-or-public, so an agent never offers guest and its user ends up with an approved reader who cannot read
type: ISSUE
priority: high
complexity: low
area: documentation, agents, api
found: "2026-09-04T14:40:00Z"
---

# B302 — The guide frames a new trip as private-or-public, so an agent never offers guest and its user ends up with an approved reader who cannot read

## Why

Asked by the owner on 2026-09-04, immediately after hitting B300: they had
issued a guest link, approved somebody, and the trip refused them because it
was `private`. The request was "update the documentation so an agent
understands the three options and can explain to its user which to use."

**Half of that already exists, and the half that is missing is precise.** What
is already true, and must not be rewritten as though it were absent:

- All three values are defined, in one shared sentence, in
  `VISIBILITY_MEANING` / the trip paragraph of `lib/api/agentCopy.ts`, and
  every agent-facing document carries it — `/agent.md:83`,
  `/documentation.txt:66`. `test/agent-interface.test.ts` asserts that.
- Both documents state that a new trip is `private`.
- Both distinguish the journal's `visibility` (two values, and only about
  whether the instance advertises the journal) from a trip's (three values,
  about who may read it). `VISIBILITY_NOT_A_LOCK` exists for exactly that
  misreading.

What is missing is at the **moment of choosing**, which is the only moment an
agent will act on:

**`guest` is never offered as a choice.** `/agent.md:521` says: *"A trip is
created **private** unless you say otherwise. Publishing somebody's journey is
their decision — ask before sending `"visibility": "public"`."* That is a
binary — the default, and the one to ask about. An agent reading it has no
prompt to raise the middle value at all, so the question it puts to its user is
"shall I make this public?", to which the honest answer for a family journal is
"no", which leaves a `private` trip. The value that actually matches "my family
should be able to read this" is never mentioned in the paragraph that decides.

**Nothing says what `private` costs you later.** The consequence the owner
walked into is that a journal guest — approved, mailed, listed as
`Freigegeben` — cannot read a `private` trip, and no amount of approving
changes it. `VISIBILITY_NOT_A_LOCK` warns that a private *journal* is not a
lock; nothing warns that a private *trip* shuts out the very people the owner
has just let in. B300 is the same gap on the two web pages; this is it in the
agent's copy.

**`openapi.json` has no description for `POST /api/v1/{user}/trips`** — only
the summary "Create a trip (owner only; private unless asked otherwise)". The
machine contract neither enumerates the three values nor explains them, so an
agent working from the schema alone has less than one working from the prose.

## Work

- **Rewrite the choose-a-visibility paragraph in `agentGuide()`** so it offers
  three options and says which fits which intention, in the order a person
  decides in: everyone, the people I have let into this journal, only the
  people who were there. Keep it short — it replaces two sentences, it is not a
  new chapter — and keep "ask before making somebody's journey public".
- **Say the consequence once, where it bites:** a `private` trip is closed to
  approved guests too, so if the plan is to share with family, `guest` is the
  value and approving people is the other half. This is the sentence whose
  absence produced the report.
- **Put the same three-way choice in `openapi.json`** as a `description` on
  `POST /api/v1/{user}/trips`, from the shared constant rather than a fourth
  hand-written copy — that is what `lib/api/agentCopy.ts` exists for, and
  AGENTS.md is explicit that a reference kept in two files disagrees with
  itself within a month.
- **Check `/<user>/documentation.txt` and the MCP `create_trip` tool
  description** carry it too. `lib/mcp/tools.ts` is a fifth door and an agent
  over MCP never reads the guide.

**The default is a separate decision and is NOT changed here.** The owner's
message can be read as asking for a new trip to default to `public`. That is a
reversal of a deliberate safety choice — today an omitted `visibility` gives
`private`, and `/agent.md` says publishing somebody's journey is their
decision — and it would mean an agent that omits the field puts a stranger's
trip on the public site and in the sitemap. It needs its own task and its own
answer; this one only makes the three options legible. Do not change
`lib/tripWrite.ts`'s default.

Not doing: any change to what the three values mean, or to the journal-level
two-value axis.

## Acceptance

- The paragraph in `/agent.md` that decides a new trip's visibility names all
  three values and what each is for, and still says to ask before `public`.
- Both `/agent.md` and `/documentation.txt` state that an approved journal
  guest cannot read a `private` trip.
- `POST /api/v1/{user}/trips` in `openapi.json` has a description enumerating
  the three, sourced from `lib/api/agentCopy.ts`.
- The MCP `create_trip` tool description says the same.
- `test/agent-interface.test.ts` still passes, and gains an assertion that the
  three-way choice reaches every door that offers trip creation.
- The four checks pass.
