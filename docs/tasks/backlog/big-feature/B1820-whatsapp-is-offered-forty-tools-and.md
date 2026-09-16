---
id: B1820
title: WhatsApp is offered forty tools and cannot reliably pick one
type: FEATURE
priority: high
complexity: high
area: whatsapp, helper, days, credits
found: "2026-09-16T19:34:41Z"
---

# B1820 — WhatsApp is offered forty tools and cannot reliably pick one

## Why

`answerInThread()` offers roughly forty tools across seven areas on every
inbound WhatsApp message, plus a `switch_area` tool that can widen back to all
of them. Forty ways to be wrong and one chance per message to pick right. The
result is a chat that does many things badly instead of one thing well, and the
project's earlier "no UI, just agents" promise has not survived contact with it.

The direction changes: **WhatsApp captures and publishes a single day of a
trip, and nothing else.** Everything else is recognised by name and redirected
to a page (B1821, B1824, and the table in the plan).

Three things make this more than a preference:

- **Meta's AI policy, in force since 15 January 2026**, prohibits
  general-purpose AI chatbots on the Business Platform. AI is allowed only where
  it is "ancillary to a legitimate business service, not the centerpiece", and a
  handoff path to another channel is required. The current agent is on the wrong
  side of that line; the redirects are the required handoff.
- **The 24-hour customer service window** means a nudge lands at +20h or not at
  all. Marketing templates cannot rescue a missed window.
- **From 1 October 2026 service messages are billable** after 1,000 delivered
  messages per business phone number per month. At this instance's scale that is
  roughly 200–250 captured days a month before any cost, so it does not threaten
  the product — but it makes "one ask per turn, two at most" an economic rule as
  well as a courteous one.

Most of the funnel needs no model at all. Day resolution, folder opening, the
mechanical draft, the redirects and the nudge are all deterministic.

Full design, state machine, transcripts in English and German, and sources:
`docs/plans/2026-09-16-whatsapp-day-funnel.md` (styled version alongside it as
`.html`).

## Work

**Complexity is high on purpose: this needs breaking into sub-tasks before
anybody starts.** The plan is the design pass; the split is not done yet.

Four pieces, roughly:

1. **Restrict the tool set per channel.** `answerInThread()` already takes
   `channel: "web" | "whatsapp"` but does not read it near `activeAreas`.
   Narrow the candidate areas before `pickArea()`, narrow `SWITCH_AREA_TOOL`'s
   enum to match, and — the only line that actually holds — **refuse in
   `runTool()` on caller kind**. A tool list offered to a model is advisory.
2. **The day folder becomes the session.** Three fields on the existing
   `day.json` through the existing merge-patch writer in `lib/dayReadiness.ts`:
   `stage`, `asked`/`asksSent`/`nudgedAt`, and `draftWords`. Today `draft_words`
   writes nothing, so a draft dies with the thread and the credits were spent
   for nothing.
3. **The funnel states** — day resolution from EXIF and message timestamp, the
   mechanical free draft, at most one gap question per turn and two in total,
   the priced polish offer, the draft link always, the single +20h nudge.
4. **The redirects** — the table in
   `docs/plans/2026-09-16-capability-split.md`.

`getCurrentTrip()` needs no work: `deriveStatus()` already derives `current`
from the date range and falls back to the most recently ended trip.

**Publishing needs no work either.** It already resolves through
`isHelperOwner()` on the v1 helper route. The v2 publish route is unreachable
from chat, and making it reachable would mean changing `mayActAsOwner`, a safety
shape. Explicitly out of scope.

Watch the prompt cache: a six-tool list will likely fall under Haiku's
4,096-token floor and silently lose the saving. `test/helper-tool-areas.test.ts`
measures this; re-run it.

Related: B1233 (the trusted-caller seam has had no full security sweep — the
`runTool` refusal belongs in its review scope), B1595 (inbox day-assembly, same
folder mechanism), B1238 and B1043 (no model tool for describing photographs or
notifying readers).

## Acceptance

- A WhatsApp-channel turn never receives tool schemas for `printed`, `journal`
  or `readers`.
- `runTool()` refuses a disallowed tool under a WhatsApp caller even when the
  name is forced.
- A day survives a simulated 24-hour thread expiry: the next message resolves to
  the same date, reads the same `day.json`, and does not re-ask an answered
  question.
- A day captured with no credits spent is publishable.
- Every WhatsApp button locale key is 20 characters or fewer in en, de and hu.
- At most one gap question per turn, and never a third.
- `test/publish-day-whatsapp-idempotency.test.ts` stays green and unweakened.
- Driven as a real conversation, not by curl — `test-a-feature` persona flows or
  dispatch directly.
- `npm run verify` passes.
