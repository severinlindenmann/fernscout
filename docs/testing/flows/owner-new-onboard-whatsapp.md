# Flow: owner-new-onboard-whatsapp

**Persona:** `owner-new` (docs/testing/personas/owner-new.md)
**Interface:** WhatsApp
**Capabilities exercised:** `whatsapp`, `whatsappInbound`
**Device/locale:** run once per requested viewport; WhatsApp has no viewport
of its own, so this flow's "device" parameter only matters if a later step
asks the persona to check the result in the journal UI.
**Check type:** technical (does the right thing land on disk) and graphical
(does the resulting draft day render correctly once checked in a browser).

## Setup

1. Local dev server running with `features.whatsapp.backend` and
   `features.whatsappInbound` on, `WHATSAPP_APP_SECRET` /
   `WHATSAPP_VERIFY_TOKEN` set to any non-empty test values (dry-run needs no
   real Meta credentials — see `lib/capabilities.ts:38-46`).
2. A `test-owner-new-whatsapp` journal provisioned via
   `.claude/skills/get-a-credential/get-token.sh` (throwaway-journal path).

## Steps

1. `npx tsx scripts/simulate-webhook.ts whatsapp inbound-text --base-url http://localhost:3013`
   — simulates the persona texting "We made it to the hut, freezing but
   happy!"
2. `npx tsx scripts/simulate-webhook.ts whatsapp inbound-photo --base-url http://localhost:3013`
   — simulates the persona following up with a photo.
3. Check `content/test-owner-new-whatsapp/whatsapp/` (or wherever
   `lib/whatsapp/dispatch.ts` actually files an inbound message — read that
   module if this path is wrong) for a record of both deliveries.
4. Check `GET /api/v1/test-owner-new-whatsapp/status` for a draft day that
   picked up the text and photo.

## Done when

- Both simulated messages are acknowledged with a `200` from the webhook
  route (technical check).
- A draft day exists carrying the persona's words as written — no invented
  weather, meals, or feelings (AGENTS.md's own rule) — and the photo attached
  (technical check).
- The draft renders correctly at `/<user>/day/<slug>` once published, checked
  in a browser at the requested viewport (graphical check).
