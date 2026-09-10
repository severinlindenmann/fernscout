---
id: B1239
title: The retired wizard's code still ships: AgentWizard, its queue and its suites await deletion
type: CHORE
priority: medium
complexity: medium
area: helper
found: "2026-09-10T06:31:38Z"
---

# B1239 — The retired wizard's code still ships: AgentWizard, its queue and its suites await deletion

## Why

B1220 (D52) retired the wizard the user-visible way: /agent/<user>
redirects to /agent and add_photos answers with a sentence about the
room's own pane. The code still ships — components/AgentWizard.tsx (~2200
lines), components/uploadQueue.ts's wizard-only halves, and the suites
that exercise them (agent-express-day, agent-picker-language,
agent-wizard-new-trip-visibility, agent-wizard-upload,
upload-queue-day-label at least). Dead weight in every bundle and every
test run, and a second implementation of flows the room now owns.

## Work

Delete AgentWizard and everything only it reaches, letting knip name the
orphans; keep /agent/<user>/inbox (still the only full inbox listing) and
whatever it genuinely imports; keep the route-guard census in
agent-wizard.test.ts (rename it to helper-routes.test.ts while there).
One quiet session, nothing else in flight — the deletion touches files
every open branch also touches.

## Acceptance

npm run verify green with AgentWizard.tsx gone; /agent/<user> still
redirects; the inbox page still renders; knip reports no new orphans.
