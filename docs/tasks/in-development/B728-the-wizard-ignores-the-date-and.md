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

## Acceptance

"Write up yesterday on the Portugal trip" opens the wizard with that trip and
that date already chosen. A test covers the query string being read.
