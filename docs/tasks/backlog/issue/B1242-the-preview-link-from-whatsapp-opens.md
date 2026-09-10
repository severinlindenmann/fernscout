---
id: B1242
title: The preview link from WhatsApp opens the room but shows no preview
type: ISSUE
priority: high
complexity: medium
area: whatsapp, helper, ux
found: "2026-09-10T08:48:07Z"
---

# B1242 — The preview link from WhatsApp opens the room but shows no preview

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Owner's walkthrough: a preview turn's link opened /agent (the room) but the
room showed no preview — the person lands in the conversation with nothing
summoned. The link must show the thing it promises.

## Work

Investigate what the preview block links to from WhatsApp and what the room
needs to actually show a preview (the rail is summoned — B1170). Either link
with whatever query the room needs to open the preview pane on arrival, or
link the drafted day's own page if an owner can see it. Fix the source of the
link, and make the room honour it.

## Acceptance

Tapping the preview link from a WhatsApp turn lands on something that
visibly shows the drafted content, signed-in owner assumed.
