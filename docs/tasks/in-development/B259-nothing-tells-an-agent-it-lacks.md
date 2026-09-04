---
id: B259
title: Nothing tells an agent it lacks the tools to write here, so it invents workarounds instead
type: ISSUE
priority: high
complexity: medium
area: agent onboarding docs
found: "2026-09-04T10:59:16Z"
started: "2026-09-04T11:00:01Z"
session: 986bc24c-6a18-473f-a506-aa8c4efb475c
claimed: "2026-09-04T11:00:01Z"
---

# B259 — Nothing tells an agent it lacks the tools to write here, so it invents workarounds instead

## Why

Observed on 2026-09-04, second run, driving a claude.ai chat client (Haiku)
through signup from the landing page's copied instruction. It fetched
`/documentation.txt`, asked the questions well, collected every answer — and
then could not make a single call. Its own account of why:

> *"My permissions require that I find the URL in a search result first, and
> fernscout.ch's endpoints aren't indexed in a way I can use."*

Two client-side facts, and neither is ours to fix:

1. **URL provenance.** That client fetches only URLs from the user's own
   message or a search result. `/documentation.txt` worked because the owner
   pasted it; `/agent.md` and `/openapi.json` were discovered *inside* a
   fetched document and were refused. This is an injection defence — a fetched
   page must not be able to send the fetcher wherever it likes — so it is
   correct behaviour that will not be relaxed. B256 removed `X-Robots-Tag`
   from both documents on the other hypothesis; that was worth doing anyway
   and did not fix this.
2. **The fetch tool is GET-only.** This is the fact that decides it. Signup is
   `POST /api/auth/signup/request`. An agent whose only tools are web search
   and web fetch cannot write to this server *at all*, however completely it
   has been documented. B256 put the whole signup flow inline in
   `/documentation.txt` and this run still could not have used it.

So the failure is not missing documentation. It is that **nothing on the way in
states the one capability an agent must have**, and an agent that cannot do the
job does not stop — it improvises. Across two runs it offered to build an
artifact the owner could *"manually upload to Fernscout"* (an interface that
does not exist and never will, ROADMAP decision 24), and offered to have the
owner *"create the journal yourself by following the agent guide"* — which is
this software's entire premise handed back to the person it was meant to spare.
Every minute of that was spent after the point where the honest answer was
available.

A second, smaller thing the same run exposed: `/documentation.txt` is
self-sufficient for signup since B256, but the **minimum write path** — create
a trip, create a day, publish it — is still only in `/agent.md`, behind exactly
the hop that provenance refuses. An agent that gets a token from the small
document then has a journal and no way to put anything in it.

## Work

`lib/api/documentation.ts`, and the entry document specifically.

1. **Open `/documentation.txt` with the capability it requires**, before the
   questions — because an agent that cannot meet it should stop before asking
   somebody for their email address. Say it concretely: writing here means
   HTTP `POST` and `PATCH` with an `Authorization: Bearer` header, so a tool
   that only fetches pages cannot do it, and neither can one that only fetches
   URLs a person pasted.
2. **Say what to do instead, in one sentence, and make it true.** The two real
   doors are a harness that can make arbitrary HTTP calls, and the MCP endpoint
   at `/api/mcp` added as a connector — note that the connector needs a token
   the owner supplies today (B260). Name them; do not imply anything else
   exists.
3. **Forbid the improvisation explicitly**, the way the guide already forbids
   inventing a username. There is no upload interface, no web form, and no CMS;
   an agent that cannot write must say so and stop, not hand the work back to
   the owner as a manual procedure. Both observed workarounds are worth naming
   as the failure — they are what an agent reaches for.
4. **Inline the minimum write path** in `/documentation.txt`: create a trip,
   create a day, publish it, with one worked payload each, verified against the
   route handlers. Keep `/agent.md` as the reference for everything else. The
   goal is unchanged from B256 — a refused hop costs an agent the rest of the
   API, not the whole of it.
5. **Tell an agent that cannot fetch the guide to ask its owner to paste it.**
   This run worked that out for itself after several turns of failure; it
   should not have had to.

Not in scope: making MCP self-authorising, which is B260.

## Acceptance

- `/documentation.txt` states the POST-with-bearer requirement above the
  questions, and an agent reading only that text can create a journal, a trip
  and a day, and publish it.
- The document names both real doors and forbids offering an upload interface
  or handing the procedure back to the owner.
- A test asserts the capability statement and the four inlined write calls, so
  the entry document cannot drift back to being a pointer.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
