---
id: B1153
title: Handing your journal to your own agent means leaving the conversation to fetch the key
type: FEATURE
priority: high
complexity: low
area: components/HelperRoom.tsx, components/AgentHandover.tsx
found: "2026-09-09T18:49:30Z"
---

# B1153 — Handing your journal to your own agent means leaving the conversation to fetch the key

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`components/HelperRoom.tsx:541` draws "Eigenen Agenten anbinden" as an
underlined line under the composer, linking to `/<user>/me`. Its own comment
says why:

> own page, where the keys and the handover credential already live — this was
> always a second door onto a control that has a home.

That was a fair call when the room was one of three pages. It is the wrong one
now that `/agent` *is* the product: leaving the room to fetch a credential
loses the conversation you were having — and until B1109 lands, loses it
literally, since there is nothing to come back to.

`components/AgentHandover.tsx` already mints the credential, builds the prompt
and copies it. This is that component, in a sheet, without the navigation.

## Work

Open a sheet in the room holding the existing `AgentHandover`. `/<user>/me`
keeps its copy — this is a second door and it becomes the nearer one.

Three things that are not obvious and are the whole ticket:

- **Mint on press, never on open.** The credential lives twenty minutes
  (B283). Minting one when the sheet opens burns one every time somebody looks,
  and leaves a live secret in a page nobody meant to use.
- **Say when it dies as a clock time**, not a duration — "Läuft um 21:14 ab"
  survives the person walking away and coming back; "expires in 20 minutes"
  does not.
- **Keep `me.handoverWarning` verbatim.** It is the only thing between a
  person and pasting a write key into a chat somebody sent them.

Not doing: changing the credential's life, or printing the seven-day token.
Twenty minutes is not timidity — a guest cookie lasts a year, so the cookie
would have been the ceiling, and a week-long key printed into a page sits in a
clipboard, a screenshot and a scrollback.

## Acceptance

Press the line under the composer. A sheet opens over the conversation with a
copyable prompt and a clock time; the conversation is still behind it. No
credential is minted until the press — check the transactions or the log.
