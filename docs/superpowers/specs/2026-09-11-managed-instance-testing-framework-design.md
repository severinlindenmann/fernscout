# Managed-instance testing framework

Status: approved design, not yet built.

## Problem

Fernscout on fernscout.ch (the managed instance) has features that are
expensive or impossible to exercise safely in an ordinary test run: a
printed postcard (Stannp) or photobook (Gelato) costs real money per order, a
WhatsApp/Meta round trip needs a real phone number and a live webhook
subscription, an SMS passcode needs a real Twilio number, and a Stripe charge
is real money on `sk_live_`. There is currently no framework for testing a
feature end to end — across interfaces (`/agent`, WhatsApp, bring-your-own
agent over the API, the journal UI), across personas (owner, buddy, guest,
each new or established), across device/locale — without either touching
production-adjacent cost or hand-driving it every time. And there is no
mechanism that notices when a new feature ships with no test coverage at all.

## Scope

In scope: simulating every external provider close to its real edge (webhook
shape in, response shape out) cheaply or for free; a persona/flow catalog
that describes who is testing what and why; a harness that assembles
persona + flow + interface + device + locale into a run; a coverage
mechanism tied to `lib/capabilities.ts` that fails the build when a shipped
capability has no flow exercising it.

Out of scope: testing the free self-hosted path (not the managed instance's
problem), running any of this against the live fernscout.ch instance (stays
`test-the-live-site`'s job), replacing `npm run verify`'s existing unit/
integration coverage.

## Design

### 1. Provider simulation — extend the existing dry-run seam, don't invent one

Fernscout already has this pattern for mail, WhatsApp, Twilio SMS, and
Deepgram transcription: an env-selected backend, `dry-run` by default, that
writes what would have been sent to disk instead of calling out. This design
adds no new mechanism — it fills the two gaps and adds the missing inbound
half:

| Provider | Today | Add |
| --- | --- | --- |
| Mail | dry-run backend exists | — |
| WhatsApp outbound | dry-run backend exists (`lib/whatsapp/index.ts`) | — |
| WhatsApp inbound | webhook route exists | a `scripts/simulate-webhook.ts whatsapp <fixture>` that POSTs a fixture payload at the local dev server, so a flow can simulate "user texted a photo" |
| Twilio SMS | dry-run backend exists (`lib/phoneVerify/dryRun.ts`) | — |
| Deepgram | dry-run backend (canned transcript) exists; real API usable via env flag | — |
| Anthropic | no dry-run; always real | leave as-is — real calls, small volume, accepted cost per the user's own instruction |
| Stripe | sandbox is `sk_test_` key, by design, no second flag | use `sk_test_` in this framework's env; simulate the webhook the same way as WhatsApp (`simulate-webhook.ts stripe <fixture>`) rather than relying on Stripe's CLI forwarding, so a run needs no network |
| Gelato (photobook) | requests built, never sent | add a `dry-run` backend in `lib/photobook/gelato.ts` (same shape as the others): writes the built order to `content/<user>/photobooks/dry-run/`, returns a fake order id; `simulate-webhook.ts gelato <fixture>` drives the existing webhook route for the "printed"/"shipped" callback |
| Stannp (postcard) | requests built, never sent; no inbound webhook route at all | same dry-run backend addition in `lib/postcard/stannp.ts`; **new** webhook route `app/api/webhooks/stannp/route.ts` (does not exist today) plus its simulator fixture |

Each dry-run backend is asserted against directly in vitest, same as the
existing mail tests — this is the "technical" half of testing: did the right
row/file/status get written.

### 2. Personas — three orthogonal axes, not a persona file per combination

- **Role-lifecycle** (who, and how far into the relationship): owner-new,
  owner-established, buddy-invited, buddy-established, guest-invited,
  guest-established. Six markdown files under `docs/testing/personas/`,
  extending the shape `test-with-personas` already uses.
- **Human attribute** (how they behave): reused from the personas already
  proven in `test-with-personas` (elder-phone, power-desktop,
  voice-preferring, hu-reader, screen-reader) rather than reinvented.
- **Device/locale**: a flow parameter, not a persona — viewport (desktop/
  mobile/PWA) and language (en/de/hu) are named when a flow is invoked, so
  they don't multiply the persona file count.

A **flow** is the unit that ties one role-lifecycle persona (optionally
crossed with one attribute persona) to a scenario: `owner-new` +
`onboard-whatsapp`, `buddy-established` + `add-day-via-agent`,
`guest-invited` + `sign-up-see-latest-update`. Flow files live under
`docs/testing/flows/`, each naming: persona(s), interface, capability(ies)
touched, what "done" looks like, and whether it's a technical check (data
written correctly), a graphical check (screenshot against a workbench or a
real page), or both.

### 3. Coverage matrix — the growth mechanism

`lib/capabilities.ts`'s `FEATURE_NAMES` (20 flags today) is the feature
inventory, for free — every capability that exists already has a name there.
`docs/testing/coverage.ts` maps each flag to: which interfaces touch it,
which provider simulator(s) it exercises, which flows cover it.
`test/coverage-contract.test.ts` (same shape as `test/openapi-contract.test.ts`
and `test/locales.test.ts`, both of which already fail the build on a similar
kind of drift) fails when a capability has zero flows. Shipping a feature
with no way to test it becomes a build failure, not a hope — this is what
"automatically grows" means here: the mechanism is a failing test, not a
person remembering to update a doc.

### 4. Harness

A script (`scripts/test-a-feature.ts`, invoked by a new skill
`.claude/skills/test-a-feature/SKILL.md`) takes a capability name plus
optional device/locale/interface filters, reads `coverage.ts` for which
flows apply, and for each: sets the capability flag + provider dry-run env,
provisions or reuses a `test-*` journal (`get-a-credential`'s existing
throwaway-journal path), drives the flow's interface (an agent turn against
`/agent` or WhatsApp-via-simulated-webhook, or a browser session via
chrome-devtools for UI/journal flows), and reports pass/fail with screenshots
for the graphical checks. This is orchestration over existing pieces
(`get-a-credential`, `test-in-a-browser`'s browser-session approach,
`test-with-personas`'s agent-driving approach) — no new credential or
capability-toggling mechanism.

Usage matches what was asked for: "test this new feature on desktop and
mobile" → `test-a-feature <capability> --device desktop,mobile`, which reads
coverage.ts, finds the relevant flows, and runs them across both viewports
without a person hand-assembling personas each time.

### 5. What this does not do

It does not touch fernscout.ch. It does not spend real money — Stripe stays
in `sk_test_` mode, Gelato/Stannp never leave dry-run within this framework.
Anthropic and Deepgram real-API calls are opt-in per the accepted small cost,
never the default for a routine run.

## Open items for implementation planning

- Exact fixture format for `simulate-webhook.ts` payloads (one JSON file per
  provider+event under `scripts/fixtures/webhooks/`, most likely).
- Whether `test-a-feature`'s browser-driving reuses `test-in-a-browser`'s
  chrome-devtools session directly or spawns its own — a detail for the
  implementation plan, not the design.
