---
id: B333
title: The invitation can be mailed and pre-approved, and nothing anywhere says so
type: ISSUE
priority: high
complexity: low
area: agent docs, invites
found: "2026-09-04T19:11:03Z"
started: "2026-09-04T19:11:30Z"
session: 986bc24c-6a18-473f-a506-aa8c4efb475c
claimed: "2026-09-04T19:11:30Z"
---

# B333 — The invitation can be mailed and pre-approved, and nothing anywhere says so

## Why

The owner asked an agent to invite `peter@severin.io`. The agent found the
endpoint this time (B331's problem), called it, and produced a bare link —
then told the owner to wait for Peter to open it, prove his address, appear in
a queue, and be approved by hand. Four steps, when B319 built it so there were
none:

> **Peter öffnet diesen Link → Er beweist seine E-Mail-Adresse → Er erscheint
> in deinen Contacts → Du genehmigst ihn mit einem Klick**

B319 added an `email` argument to `POST /api/v1/<user>/invites`. Given one, the
server mails the invitation in the recipient's language and pre-approves the
address, so whoever proves it is admitted without ever entering the owner's
queue. The agent sent `{"kind": "guest"}` because that is the only shape it
had ever been shown.

**Nothing documents the argument.** Verified against the running site:

- `/openapi.json` — the schema for `POST /api/v1/{user}/invites` lists
  `kind, trip, name, locale, days`. **No `email`.**
- `/agent.md` — the worked example is `{"kind": "guest"}`, and the words
  "pre-approve", "sent" and "invitation by mail" appear nowhere.
- `/documentation.txt` — B317's `GUEST_LINK_OFFER` ends *"Ask whether they want
  one sent"*, which promises the capability and never says how to use it.

So the agent behaved correctly on the information available, and the
information was wrong by omission.

**This is a process failure, and worth writing down as one.** B319's scope was
deliberately split to "server side only" so it would not collide with B316 and
B317, which held the document files at the time. Its own report ended with a
handover note: *"What B317 needs to know: `POST .../invites` now accepts an
optional `email` … B317's docs should expose the same argument."* B317 had
already been built and merged by then. The seam was identified, written down,
and never closed — and the capability shipped invisible.

## Work

Say it in all three places, from one source.

1. **`/openapi.json`** (`lib/api/openapi.ts`) — add `email` to the request
   schema for `POST /api/v1/{user}/invites`, with a description saying what it
   does: the invitation is mailed to that address in the recipient's language,
   and the address is pre-approved. Add `sent` to the response shape, which
   B319 returns and nothing documents.
2. **`/agent.md`** — the worked example gains the argument, and the prose says
   what changes: no queue, no second decision, and whoever proves the address
   is admitted. Say plainly that a wrong address grants nothing to anybody —
   the proof still happens, which is the guarantee B319 deliberately kept.
3. **`GUEST_LINK_OFFER`** (`lib/api/agentCopy.ts`) — it already ends "Ask
   whether they want one sent". Make it name the argument, so the offer and the
   call are in the same sentence.

Also worth one line wherever it fits best: **a send failure still returns a
usable link.** B319 answers `sent: false` and the `url` either way, and an
agent that treats a failed send as a failed invitation would hand the owner
nothing.

Keep it tight — B308 is open and these documents have grown all day. This is
mostly correcting an existing example rather than adding new prose.

## Acceptance

- `/openapi.json` names `email` and `sent`.
- An agent reading either document knows it can mail an invitation and what
  pre-approval means for the person receiving it.
- A test asserts the invites example in the guide carries the `email`
  argument, so the schema and the worked example cannot drift apart again.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
