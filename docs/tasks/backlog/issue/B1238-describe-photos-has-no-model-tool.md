---
id: B1238
title: describe_photos has no model tool, so WhatsApp can never reach it
type: ISSUE
priority: low
complexity: medium
area: whatsapp, helper
found: "2026-09-10T06:21:32Z"
---

# B1238 — describe_photos has no model tool, so WhatsApp can never reach it

## Why

Found while working B1235 (widen the WhatsApp proposal allowlist). That
ticket's brief named `describe_photos` alongside `draft_words` as one of
"the model-spending pair" that should be pressable from WhatsApp — but
`describe_photos` (`app/api/helper/[user]/day/describe-photos/route.ts`)
is not in `lib/helper/tools/registry.ts` at all. It is invoked directly by
a browser button in the gallery pane (`components/HelperRoom.tsx`,
presumably) rather than by the model calling a tool, so `answerInThread`
can never produce a `Proposal` whose `tool` is `"describe_photos"`. There
is therefore nothing for `lib/whatsapp/proposalExecution.ts`'s
`ROUTE_BY_TOOL` to ever press: a WhatsApp conversation cannot ask for
photo captions today, on the web's own core flow or WhatsApp's.

## Work

Not built here — this is a capture, not a fix. Reaching this from
WhatsApp needs a real `Tool` wrapper (a `describe_photos` or similarly
named entry in `lib/helper/tools/areas/files.ts`) that the model can call
— asking which day, resolving its photographs, proposing the spend the
way `draft_words` already does — before `ROUTE_BY_TOOL` has anything to
point at. That is a small-to-medium feature in its own right, not a line
in an allowlist.

## Acceptance

A decision: build the tool wrapper (then widen `ROUTE_BY_TOOL` to match),
or leave captioning as a web-only feature and say so in `/agent.md` and
the tool's own web-side description.
