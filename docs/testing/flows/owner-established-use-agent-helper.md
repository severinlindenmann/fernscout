# Flow: owner-established-use-agent-helper

**Persona:** `owner-established` (docs/testing/personas/owner-established.md)
**Interface:** `ui` — a real browser, owner cookie session, `/agent`. This
is the only door onto `/agent`: confirmed live (B1505, 2026-09-11) that
`app/api/helper/[user]/*` is cookie-only, bound to `journal.owner.email`,
and refuses every bearer token — including the owner's own. Both `helper`
and `transcription` can only be tested this way; there is no bearer-token
path onto either.
**Capabilities exercised:** `helper`, `transcription`.
**Device/locale:** run at every requested viewport (desktop, mobile, PWA) —
this is the flow that actually exercises the guided-helper UI, so it is the
one place viewport matters most.
**Check type:** technical (correct draft, correct publish gate, correct
transcript) and graphical (the conversation UI, the mic control, the
transcript, at each viewport).

## Setup

1. Local dev server running with `features.helper` and `features.transcription`
   on, `ANTHROPIC_API_KEY` set (real, small-cost calls — accepted per the
   design's Global Constraints), `transcription.backend: dry-run` (canned
   transcript, no real audio needed).
2. An owner **cookie session** for `example` (or a seeded `test-*` journal)
   — `POST /api/auth/request {"kind":"guest"}` + verify, not an agent token.
3. An existing trip with at least one published day, so this exercises real
   content rather than inventing a day for the test (AGENTS.md's B1090
   point).

## Steps

1. Sign in as the owner in a real browser, open `/agent`, and describe a
   day that actually happened on the seeded trip — only what the persona
   says, nothing invented.
2. Confirm the agent writes the day as a draft (`status: draft`, never
   published on create) scoped to the right trip.
3. Ask the agent to publish. Confirm it asks in words and waits — "it looks
   finished" from the agent's own judgement is not consent, and neither is
   silence (AGENTS.md). Answer yes; confirm the publish call actually fires
   and the agent's own words match what happened (the `lib/helper/model.ts`
   claim-vs-turn check).
4. If the browser and dry-run backend support it, use the mic control to
   record and transcribe one short note; confirm the canned dry-run
   transcript appears in the conversation and is metered once (a `usage`
   row, checked against `/admin` or the journal's own status).
5. Screenshot the conversation at each requested viewport.

## Done when

- The draft day exists, scoped to the right trip, containing only what was
  said (technical check).
- The agent asks before publishing and only publishes after an explicit yes
  (technical check).
- A transcription is metered exactly once and never written to disk as raw
  audio (technical check).
- The conversation, mic control and transcript render correctly at every
  requested viewport (graphical check).
