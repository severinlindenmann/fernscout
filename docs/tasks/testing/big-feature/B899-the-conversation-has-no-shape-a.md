---
id: B899
title: The conversation has no shape a person can work in
type: FEATURE
priority: high
complexity: high
area: agent, ui
found: "2026-09-08T04:52:36Z"
started: "2026-09-08T04:54:28Z"
merged: "2026-09-08T05:27:16Z"
---

# B899 — The conversation has no shape a person can work in

## Why

`docs/plans/2026-09-08-the-chat-is-the-product.md`, round 2.

The helper answers in prose inside a box that still looks like a search field —
which is exactly the confusion a tester had when she reached for Search
expecting it to do something (B844). The owner has decided the conversation is
the only surface, so it has to be a surface: turns in order, a field that
stays, and blocks that render what B898's tools declare.

People know what a conversation looks like. Borrowing that shape is not
decoration; it is the difference between knowing you may say something else and
thinking you have used up your one question.

## Work

Checklist B in the plan is the acceptance. The shape:

- Turns stacked in order, kept as you scroll — the thread already exists
  server-side after B889; this shows it.
- A field that **stays** at the bottom and keeps focus after sending.
- Something honest while it thinks. Silence reads as broken.
- The seven block types from B898 rendered — start with `say`, `choose` and
  `preview`; `form` and `confirm` arrive with B900.
- A way to start over. `forget()` exists in `lib/helper/thread.ts` and nothing
  calls it, so a person who confuses the thread waits thirty minutes.

**What not to borrow:** avatars, a name, a personality, bubbles implying
somebody is there. This writes in a person's journal; it should read as a tool
that speaks plainly.

**Reach is built in, not filed after.** Checklist D: every block keyboard
operable, each message announced once, focus moving to a proposal and back to
the field, and the field reachable with the keyboard open at 390px — which is
the single thing chat interfaces most reliably get wrong. B795 and B796 are the
evidence that retrofitting this costs more.

## Acceptance

Somebody who has used a messaging app holds a conversation without being told
how, on a phone, and a screen-reader user can too.
