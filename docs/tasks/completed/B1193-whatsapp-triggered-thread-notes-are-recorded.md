---
id: B1193
title: WhatsApp-triggered thread notes are recorded with origin web, not whatsapp
type: ISSUE
priority: medium
complexity: low
area: whatsapp
found: "2026-09-09T22:20:22Z"
merged: "2026-09-09T22:33:13Z"
completed: "2026-09-10T15:12:31Z"
---

# B1193 — WhatsApp-triggered thread notes are recorded with origin web, not whatsapp

## Why

Found during end-to-end simulation of the WhatsApp channel (run
`2026-09-09-whatsapp-agent`, scenario 17/12). `lib/helper/thread.ts:392-394`:

```ts
export function wrote(username: string, tool: string, facts: Record<string, unknown>): void {
  note(username, `[written: ${tool} ${JSON.stringify(facts)}]`);
  ...
```

and `proposed()` right above it (`thread.ts:370-372`) both call
`note(username, text)` with no `channel` argument, so `note()`'s default
(`channel: Channel = "web"`, `thread.ts:339`) applies every time — regardless
of which door actually triggered the write. `lib/whatsapp/dispatch.ts`'s
`handleLocationPin` (B1074) calls `wrote(username, "start_day", {...})` after
a WhatsApp location pin creates a draft day, and `answerOnWhatsapp` calls
`proposed(username, proposal.tool, proposal.arguments)` for every tool the
model proposes on a WhatsApp turn. Both land in the thread with
`origin: "web"` (absent, defaulting to web) rather than `"whatsapp"`.

Reproduced directly: a signed WhatsApp location-pin webhook created a draft
day and called `wrote()`; the resulting `helper_threads` row in the dev DB
shows `"channel":"web"` and the note's turn carries no `whatsapp` origin,
even though the entire round trip was a WhatsApp webhook with no browser
involved.

This undercuts B1054's own stated guarantee that "every turn carries its
origin" — a person who opens `/agent` after texting a pin over WhatsApp would
see that turn rendered (or reasoned about) as if it happened on the web.

## Work

Give `wrote()` and `proposed()` an optional `channel: Channel = "web"`
parameter (matching `note()`'s own signature) and thread it through from
`lib/whatsapp/dispatch.ts`'s call sites (`handleLocationPin`,
`answerOnWhatsapp`) as `"whatsapp"`.

## Acceptance

A location pin sent over a simulated WhatsApp webhook produces a
`helper_threads` turn whose `origin` is `"whatsapp"`, not absent/`"web"`.
