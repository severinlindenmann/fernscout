---
id: B351
title: The pre-approved invite page still speaks the queue's language and contradicts itself
type: ISSUE
priority: medium
complexity: low
area: contacts
found: "2026-09-04T19:57:18Z"
started: "2026-09-04T20:17:23Z"
merged: "2026-09-04T20:35:15Z"
---

# B351 — The pre-approved invite page still speaks the queue's language and contradicts itself

## Why

The landing page for a **pre-approved** invite (one the owner mailed to a named
address) prefills the name and address and correctly explains the rule:

> This invitation was sent to guest@severin.io. Type a different address and
> you'll wait in the queue instead of skipping it.

Two other strings on that same form contradict it:

- "Say who you are and {title} will wave you in. You'll get an email the moment
  they do." — nobody has to wave them in.
- "This doesn't let you in on its own — somebody has to say yes first." — for
  this address, somebody already did.
- The submit button says "Ask to join". They are not asking; they are accepting.

Observed 2026-09-04 on fernscout.ch. The page tells the reader both that they
skip the queue and that they are waiting in it.

## Work

The page already knows it is the pre-approved case — that is what renders the
prefill and the notice. Branch the three strings on the same condition. The
un-addressed link keeps every word it has now.

## Acceptance

Open a mailed, pre-approved invite: no sentence on the page says anybody has to
approve them, and the button reads as accepting. Open a bare link: unchanged.
