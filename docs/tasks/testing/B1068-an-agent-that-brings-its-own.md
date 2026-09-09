---
id: B1068
title: An agent that brings its own model cannot write a day from notes, caption a photograph, or hear a voice note
type: DOCS
priority: medium
complexity: high
area: api, helper, byoa
found: "2026-09-09T07:11:57Z"
started: "2026-09-09T20:27:41Z"
merged: "2026-09-09T20:46:24Z"
---

# B1068 — An agent that brings its own model cannot write a day from notes, caption a photograph, or hear a voice note

## Why

`lib/api/documentation.ts:1064-1083` states the contract: *"Whatever the wizard
can do, some call above already does."* I checked it tool by tool against
`lib/helper/tools/areas/*` and it is very nearly true — days, trips, invites,
costs, tracks, keys, channels, storage, credits, postcards, photobooks all map
one-to-one onto `/api/v1`.

**Five capabilities are the exception, and four of them are the same
exception.** They are the ones that call a model:

| helper | route | what it does |
| --- | --- | --- |
| `draft_words` | `.../day/write-day` | notes in, drafted prose out |
| `describe_photos` | `.../day/describe-photos` | captions for a day's photographs |
| — | `.../transcribe` | audio in, text out, audio discarded |
| statement mapping | `.../statement` | which column of an unknown CSV is the date, the amount, the label |
| `find_day` | `.../search` | *"the day we got lost near the border"* |

The fifth is `past_conversations` — the owner's own helper history, which has
no `/api/v1` representation at all.

Whether these are *gaps* depends on which agent you mean, and the brief names
two:

- **An agent with its own model** does not want three of them. It writes the
  prose, it captions the photograph, it does its own fuzzy matching. `/agent.md`
  already says as much, and that is the honest design: the API takes finished
  content and the model that made it is the caller's business.
- **Transcription is different.** An agent driving a browser or a phone has
  audio and no ear, and the instance already holds a Deepgram key, meters it by
  the second, and refunds a failure. There is a real argument for a v1 door
  and it is the only one of the five where "do it yourself" is expensive rather
  than merely different.
- **Statement column-mapping is the second-best argument**, and it may not need
  a model at all: `/api/v1/<user>/import` already accepts *named* formats from
  `importers/costs/`, and the model exists to cope with an unnamed one. Another
  importer is cheaper than another model call.

So the ticket is not "close the gap" — it is "decide which of the five are
gaps", and the default answer for three of them is *no*.

## Work

- A person decides, per capability, whether it gets a `/api/v1` door. The
  question book carries it. Do not build the ones that lose.
- For anything that wins: it spends the journal's credits, so it must refuse
  with a balance error an agent can read, and it must be documented with its
  price. `/api/health` is where a limit belongs before a caller hits it.
- `past_conversations` is a separate question and probably a *no*: a third
  party reading the owner's conversations with a different agent is a privacy
  decision, not an API gap.
- Whatever is decided, `keep-the-contract` applies: `lib/api/openapi.ts` and
  `/agent.md` change in the same commit as the route.

Not doing: an npm SDK. OpenAPI generators exist and a hand-kept client is a
second implementation that disagrees with the first.

## Acceptance

Each of the five is marked build or won't-build in this file with a reason,
and anything built is in `/openapi.json` with its price and its refusal.

## Decided — 2026-09-09

Answered by the owner, and the answer is **none of the five**.

The principle, in the owner's own framing: **anything that spends this
instance's model or transcription budget stays inside this instance's own
surfaces** — the helper at `/agent`, and the WhatsApp channel. Not `/api/v1`.

That is a cleaner rule than the per-capability judgement this ticket was
written to make, and it holds for a reason that will not change: a `/api/v1`
door onto `writeDay` or `transcribeAudio` is selling Anthropic and Deepgram
access with the operator's own key, metered in a currency (credits) the caller
did not buy for that purpose. Transcription was the one row with a real
argument and it loses to this.

So the work is no longer five decisions. It is one paragraph, in the right
places:

- Say it in `/agent.md` and in `/openapi.json`'s prose, so an agent bringing
  its own model learns the rule from the document rather than discovering it
  as a missing route. It already half-says this; make it explicit and give the
  reason.
- Leave the five helper routes exactly where they are.
- `past_conversations` stays helper-only too, and for a different reason: it is
  a privacy decision, not an API gap.

This ticket is now a DOCS-shaped deliverable and its `type:` should probably
change before anybody starts. Whoever does that runs `npm run tasks -- tidy`.
