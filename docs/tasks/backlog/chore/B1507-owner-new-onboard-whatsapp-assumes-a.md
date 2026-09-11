---
id: B1507
title: owner-new-onboard-whatsapp assumes a draft appears without completing WhatsApp onboarding
type: CHORE
priority: medium
complexity: low
area: docs-and-skills
found: "2026-09-11T18:56:42Z"
---

# B1507 — owner-new-onboard-whatsapp assumes a draft appears without completing WhatsApp onboarding

## Why

Ran `docs/testing/flows/owner-new-onboard-whatsapp.md` live: created a fresh
journal, then POSTed both `inbound-text` and `inbound-photo` fixtures via
`scripts/simulate-webhook.ts whatsapp <fixture>`. Both returned `200
{"ok":true,"received":1}` — the webhook itself works — but no draft day was
ever created. `GET .../status` showed `drafts: {count: 0}` and no bound
trip. The reply log under `content/.whatsapp/whatsapp-replies/` showed a
language-picker prompt sent for both messages: the fixture's phone number
(`41760000000`) had never been bound to any journal, so every inbound
message from it hits the new-number onboarding path
(`lib/whatsapp/dispatch.ts`, B1363) rather than "an existing owner's chat",
which is what the flow's own Setup step assumed — "an owner-scoped agent
token... on a fresh `test-*` journal" was treated as enough, and it isn't.

## Work

Rewrite the flow's Setup/Steps to either: (a) complete the onboarding
dialog first — send the language-picker's expected button-reply payload
(check `lib/whatsapp/dispatch.ts` for the exact button ids it accepts)
before sending the real content messages, or (b) bind the fixture's phone
number to the test journal directly via whatever mechanism actually does
that (check if there's an API/DB path, since the current flow has no way to
skip onboarding). Either way the flow needs a working end state a session
can actually reach — right now following it exactly produces no draft.

Not doing: the fix itself — this ticket is the capture, the flow file
(`docs/testing/flows/owner-new-onboard-whatsapp.md`) is what to edit.

## Acceptance

Following the corrected flow's Setup/Steps against a fresh `test-*` journal
and the two existing fixtures produces a real draft day, and `GET
.../status` shows it.
