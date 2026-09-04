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
  three options **in this order**, each with what it actually does:
  1. `public` — anyone with the address, and listed in the feed and sitemap;
  2. `guest` — the people the owner has approved into this journal, and the
     people on the trip;
  3. `private` — only the people on the trip, and not approved guests.

  Say that **`public` or `guest` is the recommendation**, that the field
  defaults to `private` when omitted precisely so that forgetting it publishes
  nothing, and therefore not to omit it — ask. Keep "ask before making
  somebody's journey public": a recommendation is not permission.
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

**The default stays `private`, and the author has confirmed it — decided
2026-09-04.** The request was for the *presentation order* (public, then guest,
then private) and not for a change to what an omitted `visibility` produces.
Do not touch `lib/tripWrite.ts`'s default. The reasoning is worth keeping in
the guide rather than only here: a field an agent forgets must never publish
somebody's journey, so the fallback is the closed value — while the *advice* is
to pick deliberately, which is the next point.

**Recommend `public` or `guest`, and say so in as many words.** Also the
author's decision, and it is the sentence the whole task is for. `private` is
the right default and rarely the right *choice*: a journal being kept for
people is either open to everyone or open to the people the owner has let in.
`private` is the narrow tool for one journey held back from readers who are
otherwise welcome — worth having, worth explaining, and not what an agent
should steer somebody towards by inaction.

So the guide has to hold three things at once without contradicting itself:

- omit the field and you get `private`, because a forgotten field must not
  publish anything;
- but do not omit it — ask, and recommend `public` or `guest`;
- and `private` is for the specific case of holding one journey back from
  people who can read the rest.

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
