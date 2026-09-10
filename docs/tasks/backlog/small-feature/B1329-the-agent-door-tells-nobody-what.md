---
id: B1329
title: The agent door tells nobody what the product is
type: FEATURE
priority: high
complexity: medium
area: agent, onboarding, design
found: "2026-09-10T16:03:25Z"
---

# B1329 — The agent door tells nobody what the product is

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

/agent's door is a title, three scattered underlined links and a card —
functional, but nothing shows what the product is. The owner reviewed three
concepts on 2026-09-10 and chose concept 2 ("the conversation as hero"),
refined with photo thumbnails, and asked for a staggered entrance animation.
The approved high-fidelity draft is
.claude/runs/2026-09-09-whatsapp-agent/onboarding-drafts.html — it is the
spec: bubble colours (own = yellow-300 on brand, agent = cream-50/navy-200),
the photo-message bubble with three thumbnails, the agent reply naming the
photos, the draft-first promise bubble, desktop split (chat left, card
right), mobile stacked, scattered links becoming one quiet line under the
card, WhatsApp as the card's third action behind the ODER divider (as B1314
built it).

## Decided

- Entrance animation on open: bubbles appear one after another (fade +
  small rise, ~500-700ms stagger), typing dots briefly preceding each agent
  bubble; runs once; prefers-reduced-motion shows everything immediately.
- Thumbnails are real demo photographs from content/example (small, width
  ~74px, already-shipped derivatives — never new binaries in the repo).
- Copy in en/de/hu, real language.

## Acceptance

/agent matches the approved draft at 390 and 1280 (browser-checked), the
animation plays once on load and is absent under reduced motion, and the
page carries no scattered underlined links above the card any more.
