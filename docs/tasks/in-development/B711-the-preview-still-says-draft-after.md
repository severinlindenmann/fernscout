---
id: B711
title: The preview still says draft after the day is published
type: ISSUE
priority: low
complexity: low
area: agent, ui
found: "2026-09-07T11:17:14Z"
started: "2026-09-07T11:40:38Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T11:40:38Z"
---

# B711 — The preview still says draft after the day is published

## Why

In the wizard's last step, after the day is published, the preview card above
still carries the "Draft — not on the site yet" banner and its explanation,
while the panel below says "It is on the site." Two statements about the same
day, on one screen, contradicting each other.

Seen in a browser at 390px while verifying B682. Cosmetic, and exactly the kind
of cosmetic that makes somebody wonder whether the publish worked.

## Work

Re-read the day after a successful publish, or drop the preview once the
outcome panel appears.

## Acceptance

Nothing on the screen calls a published day a draft.

## Resolution

`components/AgentWizard.tsx` — the preview `DayCard` (which draws
`DraftNotice` whenever every entry in `preview.day` is `draft`) is now only
rendered while `!publishedUrl`. `preview` is fetched once, before publishing,
and is never re-read afterwards; rather than adding a re-fetch just to redraw
a card the outcome panel immediately replaces, the card is dropped once
`publishedUrl` is set — the option AGENTS.md's own ticket text named as
acceptable ("drop the preview once the outcome panel appears").

Test: `test/agent-wizard.test.ts` — new "the preview card, once published"
block, asserting the render guard `preview && !publishedUrl` is present at
the source (this suite has no component-render harness — see
`test/agent-shell.test.ts` and `test/docs-shell.test.tsx` for the same
source-assertion style already used here). Confirmed it fails against the
pre-fix source and passes after.
