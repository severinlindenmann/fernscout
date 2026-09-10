---
id: B1264
title: The enrichment question never fires because a prompt line cannot see what a day lacks
type: ISSUE
priority: medium
complexity: low
area: whatsapp, helper
found: "2026-09-10T10:06:01Z"
merged: "2026-09-10T10:35:16Z"
---

# B1264 — The enrichment question never fires because a prompt line cannot see what a day lacks

## Why

B1244 added one line to `threadSystemPrompt` — "Day started: ask one gap —
place or cost, not weather" — asking the model to gently follow up on a
freshly-drafted day. scenario-dayflow.md's step 5 drove a full happy path
live and it never fired once: not right after `set_day_words` ("Der Text ist
gespeichert." and nothing else), not on a later turn, not before the
location pin was sent. A prompt line has no way to see what a day actually
lacks — it can only ask the model to guess or to remember, and B829's own
finding (repeated at the top of AGENTS.md) is that this class of thing needs
a guard, not a better sentence.

## Work

Replaced the prompt line with mechanics, in `lib/whatsapp/dispatch.ts`:
`handleProposalReply` now calls `enrichmentNudge` after a successful press of
`start_day` or `set_day_words` (the two tools that actually put words on a
day — `draft_words` writes nothing to disk, only returns prose for a later
`set_day_words` to keep). It reads the day straight back off disk
(`getAllEntries` + `factsOfEntry`, the same facts `publishDraft`'s
completeness check already uses) and appends **at most one** question to the
fixed confirmation: no coordinates first (`wa.enrichLocation`), else no costs
(`wa.enrichCosts`) — both only when the day has not explicitly declined the
track (`without:`), so an owner who already said "no costs on this trip"
never gets re-asked. Weather is never a question — it stays the server's own
lookup (AGENTS.md).

The now-dead prompt line is removed from `threadSystemPrompt` — it was never
doing anything a live run could observe, and removing it both frees a few
tokens against the ceiling `test/helper-thread.test.ts` guards and stops the
model duplicating a question the mechanism now asks reliably.

Not done: a web-room equivalent. The ticket and the scenario that found the
miss are both WhatsApp-specific (`answerOnWhatsapp`'s own flow never had a
press this closely tied to one fixed confirmation sentence the way the
WhatsApp channel does); the web room's own `HelperAsk` panel already lets
somebody see a day's full state after any write, which is a different
affordance than a fixed one-line confirmation.

## Acceptance

`test/helper-thread.test.ts`: the system prompt no longer contains "ask one
gap".

`test/whatsapp-proposal-press.test.ts`, "the enrichment question after a
day-writing press — B1264": pressing `start_day` on a day with no
coordinates appends a location-pin invitation; pressing `set_day_words` on a
day that has coordinates but no costs appends a spend question and never
mentions weather; pressing `set_day_words` on a day that already has both
appends nothing.
