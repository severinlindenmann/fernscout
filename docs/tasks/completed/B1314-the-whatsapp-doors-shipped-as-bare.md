---
id: B1314
title: The WhatsApp doors shipped as bare text links instead of the chosen design
type: ISSUE
priority: high
complexity: low
area: whatsapp, landing, agent, design
found: "2026-09-10T15:33:42Z"
merged: "2026-09-10T15:50:42Z"
---

# B1314 — The WhatsApp doors shipped as bare text links instead of the chosen design

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

## Work

Added `OrDivider` and `WhatsAppButton` to `components/LandingSections.tsx`
(transparent bg, `border-green-700`/`text-green-700`, a small filled
`green-700` circle carrying `lucide-react`'s `MessageCircle`, both already
in use for the WhatsApp idiom elsewhere in this codebase) — shared rather
than drawn twice, since B1310's two copies were exactly what drifted apart
first.

`LandingHero` (`components/LandingSections.tsx`) now renders the divider and
button below "Start writing →" instead of the old underlined link.
`AgentDoor` (`components/AgentDoor.tsx`) drops the loose line entirely and
adds the divider + button as a third item inside the "Do you already have a
journal?" card's button stack, after "No, I am starting one" — only when
`has === null`, i.e. before either sign-in path is chosen.

Added `common.or` ("or"/"oder"/"vagy") to `site/locales/{en,de,hu}.json`,
reworded `landing.whatsappCta` and `agent.doorWhatsapp` to drop the old
"Or … →" phrasing the divider now carries, and regenerated
`lib/i18n.ts` with `npm run i18n:keys`. Updated `test/landing.test.tsx` and
`test/agent-door-whatsapp.test.tsx` for the new copy and the divider.

## Acceptance

Both pages match the chosen variants at 1280 and 390 (browser-checked,
captures beside this run's earlier ones), the divider word and button labels
are localized en/de/hu, everything still renders nothing when no number is
configured, and the old text-link styles are gone.
