---
name: test-a-feature
description: Look up which persona flows exercise a capability, across which interfaces, and drive them locally with simulated providers. Use when the user says "test this new feature on desktop and mobile", "does X have test coverage", or after adding a capability to lib/capabilities.ts.
---

# Test a feature

`docs/testing/coverage.ts` maps every capability in `lib/capabilities.ts`'s
`FEATURE_NAMES` to the flow files under `docs/testing/flows/` that exercise
it, or to a `todo` saying why it has none yet. This skill is the lookup and
the drive-it procedure.

## 1. Look up what covers the capability

```bash
npx tsx --conditions=react-server scripts/test-a-feature.ts <capability> --device desktop,mobile --locale en,de
```

(`--conditions=react-server` because `lib/config.ts` pulls in `lib/auth`,
which imports `server-only` — the same reason every other script that
touches this module tree, e.g. `scripts/status.mts`, runs with that flag.)

If it prints "No flows cover ... yet", stop here and either write a new flow
(follow the shape in `docs/testing/flows/`, add an entry to
`docs/testing/coverage.ts`, and see `test/coverage-contract.test.ts` pass) or
report the gap — do not invent a check that was not asked for.

## 2. Set up the environment the flow's own Setup section names

Every flow's Setup section names which capabilities must be on and which
credentials it needs. None of them need a real provider account:
`lib/capabilities.ts` already documents which backend needs nothing
(`dry-run` for whatsapp/sms/transcription; `provider: "dry-run"` or an unset
`live` for postcards/photobook; `sk_test_...` for Stripe).

Get credentials with `.claude/skills/get-a-credential/get-token.sh` — an
agent token for API/agent-driven steps, a cookie for owner/browser-only
pages, a throwaway `test-*` journal for a fresh persona.

## 3. Drive the interface the flow names

- **WhatsApp interface:** `npx tsx scripts/simulate-webhook.ts <provider> <fixture>`
  against the running local server, per the flow's own Steps section. It signs
  best-effort, from its own environment, the same way each real route
  verifies: an HMAC over the body for WhatsApp (`WHATSAPP_APP_SECRET`), the
  shared header Gelato sends verbatim (`GELATO_WEBHOOK_SECRET`), and a
  `stripe-signature` header Stripe's SDK will accept (`STRIPE_WEBHOOK_SECRET`).
  **Set the matching secret in this process's own environment and the request
  gets a real `200`** — that is what the `whatsapp`/`whatsappInbound` flow's
  "Done when" actually needs. Leave the secret unset and it sends the same
  bare, unsigned POST as always, which only gets past a route with the
  matching capability *off* (a 404, not a 200 — do not mistake that for the
  flow working) and never past a route requiring a credential. Add a new
  fixture under `scripts/fixtures/webhooks/<provider>/` if the flow needs a
  payload shape that does not exist yet.
- **`/agent` interface:** open `http://localhost:3013/agent` (the *local*
  server, unlike `.claude/skills/test-with-personas/SKILL.md`, which points
  at the live site on purpose — this skill's whole point is never touching
  fernscout.ch) and play the persona named in the flow, following
  `.claude/skills/test-with-personas/SKILL.md`'s own rule of running personas
  one at a time.
- **Journal UI interface:** follow `.claude/skills/test-in-a-browser/SKILL.md`
  for the credential and viewport setup, then the flow's own Steps.
- **Bring-your-own-agent (API) interface:** drive `/api/v1/**` directly with
  the agent token from step 2, per `/documentation.txt` and the relevant
  `/skill/<task>.md` guide — no browser involved.

## 4. Check against the flow's "Done when" section

Each item there is either a technical check (read a file, call a `GET`,
compare against what was written) or a graphical check (a screenshot at the
requested viewport, compared against the workbench or the real page per
`.claude/skills/check-a-drawing/SKILL.md` where the flow says so).

## Growing this catalog

Adding a capability to `lib/capabilities.ts` without adding a
`docs/testing/coverage.ts` entry fails `test/coverage-contract.test.ts` —
that is the mechanism, not a reminder. A `todo` entry is a legitimate way to
ship a capability before its flow exists; leaving the capability out of the
matrix entirely is not.
