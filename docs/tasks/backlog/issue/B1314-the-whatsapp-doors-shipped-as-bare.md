---
id: B1314
title: The WhatsApp doors shipped as bare text links instead of the chosen design
type: ISSUE
priority: high
complexity: low
area: whatsapp, landing, agent, design
found: "2026-09-10T15:33:42Z"
---

# B1314 — The WhatsApp doors shipped as bare text links instead of the chosen design

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

B1310 shipped both doors as underlined text lines stacked between other
links — no hierarchy, no WhatsApp green, no affordance. The owner reviewed
drafts on 2026-09-10 and chose:

- Landing (fernscout.ch/): variant B — the yellow "Start writing →" button,
  then an "oder"-divider line, then a WhatsApp button (transparent
  background, green border and text, small green round glyph) reading
  "Per WhatsApp loslegen" — the TEXT, not the number.
- Agent door (/agent): variant A — the loose WhatsApp line disappears;
  inside the "Do you already have a journal?" card, after the two existing
  buttons, an "oder"-divider and a third full-width action, green style,
  "Auf WhatsApp schreiben".

The drafts are .claude/runs/2026-09-09-whatsapp-agent/door-drafts.html.

## Acceptance

Both pages match the chosen variants at 1280 and 390 (browser-checked,
captures beside this run's earlier ones), the divider word and button labels
are localized en/de/hu, everything still renders nothing when no number is
configured, and the old text-link styles are gone.
