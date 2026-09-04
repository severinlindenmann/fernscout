---
id: B256
title: An agent that cannot read agent.md is left with the five questions and no calls
type: ISSUE
priority: high
complexity: medium
area: agent onboarding docs
found: "2026-09-04T10:35:21Z"
started: "2026-09-04T10:36:11Z"
merged: "2026-09-04T10:49:24Z"
---

# B256 — An agent that cannot read agent.md is left with the five questions and no calls

## Why

Observed on 2026-09-04, driving a Haiku-class agent through signup against
fernscout.ch from the landing page's copied instruction. The agent read
`/documentation.txt`, asked the five questions correctly and in order — and
then stopped, because it could not fetch `/agent.md`:

```
Failed to fetch: https://fernscout.ch/agent.md
Failed to fetch: https://fernscout.ch/agent.md
Failed to fetch: https://fernscout.ch/openapi.json
> I have your account details and know the process should be to create a
> journal, get a code, and exchange it for a token — but without the exact API
> specification, I can't safely make those calls.
```

It then offered the owner two workarounds, one of which was *"I can create an
interactive artifact … that you can then manually upload to Fernscout
yourself"* — an instruction to use an upload interface that does not exist and
never will (ROADMAP decision 24). A weak agent denied the guide does not stop;
it invents.

**`/documentation.txt` is the entry point and it carries no calls at all.**
`lib/api/documentation.ts` — its "Then" section is three prose steps ending in
*"signup is in the guide, under Starting from nothing"*. Everything executable
is one hop away in a 45KB document. So the entry point has a single point of
failure and no fallback, and the copied instruction on `/` (B254) points
straight at it.

Verified about the server, so these are not the cause: `robots.txt` allows
everything, all three documents answer `200` to every user agent tried
(including `Claude-User/1.0`, `ClaudeBot/1.0`), content types are right, and
`WebFetch` from Claude Code reads `agent.md` in full. Two differences remain
between what worked and what failed, and both are cheap to remove:

- **`X-Robots-Tag: noindex`** on `/agent.md` (`app/agent.md/route.ts:9`) and
  `/openapi.json` (`app/openapi.json/route.ts:1111`). A well-behaved automated
  fetcher may read that as "do not use this content" — on the two documents
  whose entire audience is automated fetchers. Keeping the agent guide out of
  a search index is worth strictly less than being readable by the readers it
  was written for.
- **Size.** `documentation.txt` is 3.7KB and got through; `agent.md` is 45KB
  and `openapi.json` 36KB, and both failed.

Two further defects in the questions themselves, found in the same run.

**The username question invites an agent to invent one.** The guide says
plainly *"Ask them for the username … picking one for them is the sort of
thing they will live with for years"* — and the agent still offered
*"(Something like asia-2025, travels, your name, etc.)"*. `asia-2025` is
trip-shaped, not journal-shaped; an owner who takes the suggestion gets a
permanent address that will be wrong the moment they travel somewhere else.
The guide never says the plain thing that would have stopped it: **the username
*is* the journal's name**, the one thing on this server that cannot be changed.

**One language question is asked where the journal has two decisions.**
`lib/api/documentation.ts` asks "which language the journal is in" and maps it
to `defaultLocale`. But `POST /api/v1/journals` also accepts `locales`
(`app/api/v1/journals/route.ts:170`) — which languages a *reader* may switch
to — and no document mentions it at signup. The owner's own language and the
languages their audience is offered are different questions with different
answers, and the second is silently defaulted. The three are also named as
bare codes (`en, de, hu`) rather than in their own language, which is what a
person recognises.

## Work

All in `lib/api/documentation.ts` (both documents are generated from it) plus
two header lines. One pass, one file, to keep this out of conflict with other
onboarding work.

1. **`/documentation.txt` becomes self-sufficient for signup.** Inline the
   three calls — `POST /api/auth/request`, `POST /api/auth/verify`,
   `POST /api/v1/journals` — with a minimal worked payload each, so an agent
   that reads only this document can create a journal without the guide. Keep
   pointing at `/agent.md` for everything beyond that; the goal is that a
   failed hop costs the agent the *rest* of the API, not the whole of it.
2. **Say what a username is.** In both documents: the username is the
   journal's name and its permanent address, lowercase letters, digits and
   dashes. Add the instruction not to *illustrate* it either — an example name
   in an agent's question is a suggestion, and `asia-2025` is a trip name
   somebody will be stuck with. Name that failure the way the guide already
   names `alex-2`.
3. **Two language questions, not one.** `defaultLocale` — the owner's own
   language, the site chrome and the welcome mail — and `locales`, the
   languages a reader may switch the journal into. Name the three in their own
   language: Deutsch, English, Magyar, with their codes beside them. Say what
   happens when `locales` is omitted. The five questions become six; renumber,
   and keep the count right in both documents.
4. **Drop `X-Robots-Tag: noindex`** from `/agent.md` and `/openapi.json`. Leave
   it everywhere else — the markdown twins and `documentation.txt` are a
   different argument, and `documentation.txt` demonstrably fetches fine with
   it. Note in the route comment why these two differ.

Not in scope: shrinking `agent.md`, and any request logging that would have
made this diagnosable — that is B257.

## Acceptance

- `curl -s https://<host>/documentation.txt` contains the three signup calls
  and a complete `POST /api/v1/journals` body; an agent handed only that text
  has everything it needs to create a journal.
- `curl -sI https://<host>/agent.md | grep -i x-robots-tag` returns nothing.
- Both documents name the username as the journal's name, forbid inventing
  *and* illustrating one, and ask both language questions with the locales in
  their own language.
- A test in `test/` asserts the documentation text carries the signup
  endpoints, so the two documents cannot drift back apart.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
