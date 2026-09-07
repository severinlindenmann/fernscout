---
id: B799
title: Nothing on the page you just published offers to show it to anybody
type: FEATURE
priority: high
complexity: low
area: contacts, ui
found: "2026-09-07T14:58:57Z"
started: "2026-09-07T15:09:34Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-07T15:09:34Z"
---

# B799 — Nothing on the page you just published offers to show it to anybody

## Why

The traveller publishes a day. The response tells an *agent* to offer a guest
link, and `/agent.md` instructs it to. A person doing it in the browser is told
nothing.

To find the invite herself she must: notice the person icon in an icon-only nav
bar, open `/<user>/me`, scroll past journal settings, agent-key instructions,
storage and credit purchasing, and find "Manage who can read this" → 
`/<user>/contacts`. Three levels down, behind a wall of things she did not ask
about.

The contacts page itself is good — it names the two links plainly and warns
that the write link does not belong in a group chat. The problem is nobody
reaches it.

She has just done the thing that only makes sense if somebody reads it, and the
software says nothing about the reading.

## Work

Offer it where she is: on the day she just published, and on the trip page.
"Invite family to read" leading to the guest link.

Keep the two links apart — a guest link belongs in a family group chat and a
buddy link does not — and keep the wording contacts already uses.

The wizard's success screen is the other obvious home for it (B780 is
rebuilding that screen; coordinate rather than duplicating).

## Acceptance

From the day she just published, one tap reaches a link she can paste into
WhatsApp.
