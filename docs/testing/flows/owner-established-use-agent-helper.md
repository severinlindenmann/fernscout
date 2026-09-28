# Flow: owner-established-use-agent-helper

**Persona:** `owner-established` (docs/testing/personas/owner-established.md)
**Interface:** `ui` — a real browser, owner cookie session, the studio. The
old web agent room (`/agent`) is retired; the assistant now lives inline in
the studio itself (`app/at/[user]/studio/day/new`'s "Polish my text" and
`app/api/helper/[user]/day/describe-photos`), reached only by a cookie
session — `app/api/helper/[user]/*` is bound to `journal.owner.email` and
refuses every bearer token, including the owner's own.
**Capabilities exercised:** `helper`, `transcription`.
**Device/locale:** run at every requested viewport (desktop, mobile, PWA) —
this is the flow that actually exercises the assistant UI, so it is the one
place viewport matters most.
**Check type:** technical (correct draft, correct publish gate, correct
transcript, nothing charged on a refused polish) and graphical (the polish
button and its before/after panel, the mic control, the transcript, at each
viewport).

## Setup

1. Local dev server running with `features.helper` and `features.transcription`
   on, `ANTHROPIC_API_KEY` set (real, small-cost calls), `transcription`
   backend set to dry-run (canned transcript, no real audio needed).
2. Consent granted for `words` (and `speech` if testing dictation) via
   `/[user]/studio/agent` — "Permissions & keys" — the page the assistant's
   consent switches actually live on now.
3. An owner **cookie session** for `example` (or a seeded `test-*` journal)
   — `POST /api/auth/codes` then `POST /api/auth/codes/redeem`, both with
   `"for": "read"`, not an agent token.
4. An existing trip with at least one published day, so this exercises real
   content rather than inventing a day for the test.

## Steps

1. Sign in as the owner, open `/[user]/studio/day/new`, and type rough notes
   about a day that actually happened on the seeded trip.
2. Tap "Polish my text". Confirm it shows "Your words" beside "Polished" for
   comparison, and that "Use this" / "Keep mine" both leave the day in draft.
3. Type a note the model cannot honestly polish without inventing something
   (a claim with no basis in the notes). Confirm the polish is refused and
   nothing is charged — the added-facts guard in `lib/helper/model.ts`.
4. Save the day. Confirm it is a draft (`status: draft`, never published on
   save) scoped to the right trip.
5. Publish it from the studio. Confirm this is a separate, explicit action —
   nothing about finishing a polish publishes on its own.
6. If the browser and dry-run backend support it, use the mic control to
   record and transcribe one short note; confirm the canned dry-run
   transcript appears and is metered once (a `usage` row, checked against
   `/admin` or the journal's own status).
7. On a day with unwritten photos, try "describe photos" (`app/api/helper/
   [user]/day/describe-photos`). Confirm descriptions only ever describe
   what the model can see, never add facts the photo cannot show.
8. Screenshot the polish panel and the mic control at each requested
   viewport.

## Done when

- The draft day exists, scoped to the right trip, containing only text the
  owner approved (technical check).
- A polish that would add invented facts is refused, and nothing is charged
  for it (technical check).
- Publishing stays a separate, explicit action from polishing or saving
  (technical check).
- A transcription is metered exactly once and never written to disk as raw
  audio (technical check).
- The polish panel, mic control and transcript render correctly at every
  requested viewport (graphical check).
