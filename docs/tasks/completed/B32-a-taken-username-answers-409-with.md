---
id: B32
title: A taken username answers 409 with no route onward for somebody who already owns it
type: ISSUE
priority: medium
complexity: low
area: journals, api, signup
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-01"
completed: "2026-09-04T06:38:46Z"
---

# B32 — A taken username answers 409 with no route onward for somebody who already owns it

## Why

What happens today when an agent tries to create a journal that already exists,
for an address that already owns journals:

| | |
| --- | --- |
| `POST /api/auth/signup/request` | `202`, always — even for an address that owns three journals already. Deliberate: a different answer would make this a way to ask who is on the server. |
| `POST /api/auth/signup/verify` | a signup token, which can create a journal and nothing else |
| `POST /api/v1/journals`, name taken | `409 username_taken` — `"sevi" already exists on this server.` (`lib/journals.ts:117`) |
| `POST /api/v1/journals`, fourth journal | `403 too_many_journals`, naming the three it owns |

The refusals are correct and the statuses are right. The problem is that the
409 is a dead end for the case that will actually happen most: **the person
already has this journal and wants to write to it.** "Set up my travel journal"
from somebody who set one up last month is the same sentence, and the agent
following the guide's "Starting from nothing" path lands on `409` holding a
signup token — a credential that by design can only create journals, so there
is nothing it can do next. The message tells it the name is taken and stops.

The route onward exists and is two lines away: `POST /api/auth/request` with
`{user, email, kind: "agent"}` gets a write token for a journal you own. The
409 does not mention it. Neither does `agent.md`, which frames signup as the
path for "no journal yet" and never covers "a journal, but not this session's".

Note what must *not* change: the 409 says a name is taken, which is public
information — anyone can fetch `/<username>`. It must not start saying *who*
owns it, or whether the requesting address is the owner. That would turn journal
creation into a way to test whether an address owns a name.

Related to B29 and B27, which are about the same "the person already exists"
moment from the mail side.

## Work

- Give `username_taken` a `next` line pointing at `POST /api/auth/request`, in
  the same shape the successful responses already use — the `next` field is the
  single best thing in this API and this is the one refusal that needs it.
  Phrase it conditionally ("if this journal is yours…"), because the server does
  not know and must not check.
- The same for `too_many_journals`: it already names the journals the address
  owns, so it can say how to get a write token for one.
- A short paragraph in `agent.md` under **Starting from nothing**: what to do
  when the person turns out to have a journal already. Right now the guide's
  two paths — signup, and authenticate — never meet, and an agent that guessed
  wrong at the start has to work out on its own that it should have taken the
  other one.

## What was found while building it

The Why held. One thing worth recording about the shape of the fix: the
identical-refusal property is not something the wording is careful about, it is
something the code makes structural. `createJournal` builds the taken-name
refusal from the requested username alone — it never reads `ownerEmail` on that
path — so there is no branch that *could* differ for the owner. The test
asserts the two results are `toEqual`, which is stronger than comparing strings
and will fail if anybody later adds a field that depends on the caller.

Also added, beyond the task's Work section: a **"do not pick a different
name"** line in the guide. It is the obvious wrong move — `alex-2` costs
somebody a second-choice address forever — and an agent holding a signup token
that cannot do anything else is exactly the agent that would reach for it.

## Acceptance

- A `409 username_taken` body names the endpoint that gets a write token, and
  says nothing about who owns the name or whether the caller does.
- A `403 too_many_journals` does the same.
- `agent.md` tells an agent what to do when the journal already exists.
- A test asserts the 409 body is identical whether or not the requesting
  address is the owner of the taken name.
