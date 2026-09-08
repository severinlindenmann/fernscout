---
id: B728
title: The wizard ignores the date and trip the ask box sends it
type: ISSUE
priority: medium
complexity: low
area: agent, ui
found: "2026-09-07T12:16:35Z"
started: "2026-09-08T20:47:27Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T20:47:27Z"
superseded: "B818"
---

# B728 — The wizard ignores the date and trip the ask box sends it

## Why

`lib/helper/intents.ts:97` — the `write_day` intent sends the person to
`/agent/<user>?date=…&trip=…`, having worked out both from their sentence. But
`app/agent/[user]/page.tsx` reads no `searchParams`, so the wizard opens on
step one with nothing filled in and the person types again what they just said.

Nothing breaks. It is simply that "add yesterday to Portugal" is answered by a
blank first screen, which is the difference between the ask box feeling like an
agent and feeling like a menu.

Found while building B685.

## Stale — superseded by B818

Read as of 2026-09-08, before writing any code. The fault this ticket names no
longer exists, on two independent counts:

1. **`app/agent/[user]/page.tsx` now reads `searchParams` in full.** Since
   B818 (merged 2026-09-07T16:05:51Z, days after this ticket was found but
   before it was picked up), the page reads `asked.date`, `asked.trip` and
   `asked.slug` and passes them to `<AgentWizard open={{ date, trip, slug }} />`.
   `components/AgentWizard.tsx` honours all three: `openingDate(open, ...)`
   seeds the date state and `open?.trip ?? tripOn(...)` seeds the trip state
   (lines ~308-317). `test/agent-opening-date.test.tsx` covers exactly the
   scenario this ticket's Acceptance line asks for — a link naming a date and
   a trip ("Finish Wednesday, 19 August" / trip `alps`) renders the wizard
   with that date and that trip already chosen, not today's date.

2. **The routing mechanism the ticket names is gone.** `lib/helper/intents.ts`
   no longer has a `write_day` row at all — B900 retired the whole
   pre-model intent registry (see the file's own header comment,
   "What used to be here"). What sends someone to `/agent/<user>?...` today is
   the `add_photos` tool in `lib/helper/tools.ts` (`link:` callback, ~line
   1278), which builds the same `trip`/`slug`/`date` query string and is read
   by the now-fixed page. Starting a day itself (`start_day` in
   `lib/helper/tools.ts`) no longer redirects to the wizard at all — it
   proposes a card inline in the conversation, with its own date default
   (first unwritten day of the trip, also from B818's Work section).

No code changed. Filing as superseded by B818, which is the ticket that
actually built this and carries the passing test.

## Acceptance

"Write up yesterday on the Portugal trip" opens the wizard with that trip and
that date already chosen. A test covers the query string being read.
