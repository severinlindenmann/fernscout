---
id: B1717
title: The landing page describes the chat, the postcard and the book instead of showing them
type: FEATURE
priority: high
complexity: medium
area: landing
found: "2026-09-14T10:10:00Z"
---

# B1717 — The landing page describes the chat, the postcard and the book instead of showing them

## Why

B1711 put the right claims on the signed-out root and then made all three of
them out of prose. The exchange that produces a day is three static bubbles;
the postcard and the photobook are paragraphs. Nobody believes a paragraph
about a printed object.

Two of the three are already drawn elsewhere in this repository:

- `components/ChatVignette.tsx` is the animated version of the same
  conversation, on `/agent` — four bubbles arriving in turn with a typing
  indicator under each reply, pure CSS (`fs-assemble-in`, `fs-chat-dots`),
  already handling `prefers-reduced-motion`, already translated. The landing
  page has a worse copy of it.
- `app/[user]/postcards/[id]/PostcardBack.tsx` draws a real card for a real
  order, so the proportions a landing visual must match already exist.

**ChatVignette is also not truthful today, and that is not this branch's
doing.** Its photographs are three real published images from the demo
journal's `usa-2026/oregon-coast` day; its words are invented — "the kids went
looking for amber", "September 10" — while the day those photographs belong to
is *Down the Oregon coast*, 24 August, Cannon Beach. On the landing that would
sit directly under a caption saying the exchange is real.

The caption is also a dead end: it is the one line admitting a real journal
exists, and it links nowhere.

## Work

Decided with the owner on 2026-09-14, from
https://claude.ai/code/artifact/77b0901d-e870-4014-9042-dd25f2f11154

1. **Use `ChatVignette` in the hero** and delete `LandingThread` and its seven
   `landing.thread*` keys. Smaller diff than what is live now.
2. **Retune ChatVignette's four strings** (`agent.chatOwn1`, `chatAgent1`,
   `chatOwn2`, `chatAgent2`) to the day its photographs actually come from, in
   all three languages. Fixes `/agent` at the same time.
3. **Link the caption** to that day — resolved from the trip and day ids, not
   a hand-typed path, so a rename cannot leave a 404 on the front page.
4. **Draw the postcard** inside the postcards card, matching
   `PostcardBack.tsx`'s proportions, using a photograph from the demo journal
   through the ordinary media gate.
5. **Draw the photobook** inside the photobook card — an open spread, same
   treatment, same source.

Bubbles keep their brand yellow (B1329: the same conversation on every
channel), not WhatsApp green. Both drawings stay inside the capability gate
their card already has.

## Acceptance

- The hero's exchange animates, and `LandingThread` no longer exists.
- With `prefers-reduced-motion: reduce`, every bubble is visible at rest and
  the typing indicators are gone, not frozen.
- The caption links to the demo day, and the link resolves on a real build.
- The postcard and photobook cards each carry a drawing, absent when their
  capability is off.
- The chat's words and its photographs describe the same day.
- Captured at 1280 and 390, capabilities on and off. `npm run verify` passes.
