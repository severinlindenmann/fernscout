# Managed-instance testing framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the coverage-matrix mechanism, persona/flow catalog, and webhook-simulator harness that let a future session test any managed-instance feature (across `/agent`, WhatsApp, bring-your-own-agent, and the journal UI, on any device/locale) without touching fernscout.ch or spending real provider money — and make skipping test coverage for a new feature a build failure.

**Architecture:** Everything rides Fernscout's existing dry-run/capability discipline. No new sandbox mechanism is introduced. Three additions: (1) a webhook-fixture simulator script for the three inbound webhooks that already exist (WhatsApp, Stripe, Gelato), (2) a coverage matrix mapping every `FEATURE_NAMES` entry to markdown flow files or an explicit `todo`, enforced by a vitest contract test, (3) a `test-a-feature` skill/script that reads the matrix and drives a flow's interface locally.

**Tech Stack:** TypeScript (tsx-run scripts, matching `scripts/postcard.ts`'s shape), vitest, markdown (personas/flows), existing skills (`get-a-credential`, `test-in-a-browser`, `test-with-personas`).

**Spec:** `docs/superpowers/specs/2026-09-11-managed-instance-testing-framework-design.md`

## Global Constraints

- Local dev only. Nothing in this plan touches fernscout.ch or spends real Stripe/Gelato/Stannp money — Stripe stays `sk_test_`, Gelato/Stannp stay `provider: "dry-run"` or `live` absent (per `dryRunNote()` in `lib/capabilities.ts`).
- No new provider-mode flag. Photobook and postcard already have exactly the sandbox mechanism the design asked for (`features.photobook.live` / `features.postcards.live`, absent = test/draft, per `lib/photobook/gelato.ts:57-60` and `lib/postcard/stannp.ts:34-37`) — this plan does not touch either file.
- **Correction found during planning:** the design doc's table said Gelato/Stannp "build but never send." That is only true with `provider: "dry-run"`. With a real key and `live` unset, both *do* call the real network in test/draft mode. Both cases already exist; this plan adds no dry-run backend to either provider file.
- **Correction found during planning:** Stannp has no inbound webhook route in production at all (confirmed: `app/api/webhooks/` contains only `gelato/`, `stripe/`, `twilio/`, `whatsapp/`). Building one is a real production feature (order tracking, reconciliation, receipt mail — the shape `app/api/webhooks/gelato/route.ts` has), not testing-framework scope. This plan files it as a backlog ticket instead of building it (Task 6) and scopes postcard-webhook flows out of v1's flow catalog.
- Every markdown persona/flow file follows AGENTS.md's own test-content rule: nothing in a flow's own runtime state is `test: true`-exempt from that rule — a flow that provisions a journal uses `test-*` naming (per `get-a-credential`'s throwaway-journal path), never a name that reads like a person's.
- `npm run tasks -- new` mints task ids; never hand-assign one (AGENTS.md).

---

## Task 1: Coverage matrix and its contract test

**Files:**
- Create: `docs/testing/coverage.ts`
- Create: `test/coverage-contract.test.ts`

**Interfaces:**
- Produces: `COVERAGE: Record<FeatureName, CoverageEntry>`, `type CoverageEntry = { flows: readonly string[] } | { todo: string }`, `type Interface = "agent" | "whatsapp" | "api" | "ui" | "admin"` — all exported from `docs/testing/coverage.ts`. Task 4's flow files are referenced here by filename (no import — the test only checks the matrix names a non-empty `flows` list or a `todo` string, it does not open the files).

- [ ] **Step 1: Write the failing test**

Create `test/coverage-contract.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { FEATURE_NAMES } from "@/lib/config";
import { COVERAGE } from "@/docs/testing/coverage";

/**
 * B-todo: mirrors test/openapi-contract.test.ts's own shape — a constant the
 * document imports rather than retypes, checked against the real enum, so a
 * capability that ships with no way to test it is a build failure rather
 * than a hope. See docs/testing/coverage.ts for what an entry may say.
 */
describe("coverage matrix", () => {
  test("every capability has a coverage entry", () => {
    const missing = FEATURE_NAMES.filter((name) => !(name in COVERAGE));
    expect(missing).toEqual([]);
  });

  test("every entry either names flows or says why it has none yet", () => {
    const bad = FEATURE_NAMES.filter((name) => {
      const entry = COVERAGE[name];
      if (!entry) return true;
      if ("todo" in entry) return typeof entry.todo !== "string" || entry.todo.trim() === "";
      return !Array.isArray(entry.flows) || entry.flows.length === 0;
    });
    expect(bad).toEqual([]);
  });

  test("the matrix names no capability that no longer exists", () => {
    const stale = Object.keys(COVERAGE).filter(
      (name) => !(FEATURE_NAMES as readonly string[]).includes(name),
    );
    expect(stale).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/coverage-contract.test.ts`
Expected: FAIL — `Cannot find module '@/docs/testing/coverage'`

- [ ] **Step 3: Write the coverage matrix**

Create `docs/testing/coverage.ts`:

```ts
import type { FeatureName } from "@/lib/config";

/**
 * Which door a flow drives through — see AGENTS.md's own table of "You are /
 * Use". `admin` is the operator's own page, kept separate from `ui` because
 * it authenticates differently (identity cookie vs. owner cookie) and no
 * persona in docs/testing/personas/ plays the operator.
 */
export type Interface = "agent" | "whatsapp" | "api" | "ui" | "admin";

/**
 * One capability's coverage: either the flows that exercise it, or an
 * explicit reason it has none yet. Never both, never neither —
 * test/coverage-contract.test.ts fails on the third case. `todo` exists so
 * that adding a capability with no test yet is a visible, searchable
 * decision rather than a silently missing row (see docs/superpowers/specs/
 * 2026-09-11-managed-instance-testing-framework-design.md, "no silent caps").
 */
export type CoverageEntry =
  | { flows: readonly string[]; interfaces: readonly Interface[] }
  | { todo: string };

/**
 * Filenames under docs/testing/flows/, without the .md extension. Kept as
 * plain strings rather than imported: a flow file has no exported symbol,
 * it is prose a persona-driving session reads.
 */
export const COVERAGE: Record<FeatureName, CoverageEntry> = {
  whatsapp: {
    flows: ["owner-new-onboard-whatsapp"],
    interfaces: ["whatsapp"],
  },
  whatsappInbound: {
    flows: ["owner-new-onboard-whatsapp"],
    interfaces: ["whatsapp"],
  },
  helper: {
    flows: ["buddy-established-add-day-agent"],
    interfaces: ["agent"],
  },
  signup: {
    flows: ["guest-invited-signup-see-update"],
    interfaces: ["ui"],
  },
  contacts: {
    flows: ["guest-invited-signup-see-update"],
    interfaces: ["ui"],
  },
  auth: {
    flows: ["guest-invited-signup-see-update", "buddy-established-add-day-agent"],
    interfaces: ["ui", "agent"],
  },
  reactions: { todo: "no flow yet — B: add when a persona flow needs a reader reaction" },
  costs: { todo: "no flow yet — B: add when a persona flow needs a cost line" },
  push: { todo: "no flow yet — B: add when a persona flow needs a push notification" },
  mail: { todo: "no flow yet — exercised incidentally by every flow that signs in, no dedicated flow" },
  sms: { todo: "no flow yet — B: add when a persona flow signs up by SMS" },
  smsInbound: { todo: "no flow yet — B: add alongside sms above" },
  postcards: { todo: "no flow yet — Stannp has no inbound webhook in production yet, see the backlog ticket this plan filed" },
  photobook: { todo: "no flow yet — B: add a flow once a dry-run photobook order round-trips a fixture" },
  logging: { todo: "operator-only capability, no persona plays the operator yet" },
  credits: { todo: "no flow yet — B: add once a flow needs to spend a credit and check the ledger" },
  addressLookup: { todo: "no flow yet — B: add alongside a postcard-address flow" },
  weather: { todo: "no flow yet — B: add alongside a day-with-weather flow" },
  analytics: { todo: "operator-only capability, no persona plays the operator yet" },
  transcription: { todo: "no flow yet — B: add a voice-note flow once WhatsApp/agent voice input is exercised" },
  fulfilmentRelay: { todo: "operator-only capability, no persona plays the operator yet" },
  fulfilmentAccept: { todo: "operator-only capability, no persona plays the operator yet" },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/coverage-contract.test.ts`
Expected: PASS (3 tests) — note some `FEATURE_NAMES` entries above are guesses at spelling; if the test fails on "every capability has a coverage entry", read the failure's `missing` array and add the exact missing names from `lib/config.ts:19-49` with a `todo` entry.

- [ ] **Step 5: Commit**

```bash
git add docs/testing/coverage.ts test/coverage-contract.test.ts
git commit -m "Add capability coverage matrix and its contract test"
```

---

## Task 2: Webhook fixture simulator

**Files:**
- Create: `scripts/simulate-webhook.ts`
- Create: `scripts/fixtures/webhooks/whatsapp/inbound-photo.json`
- Create: `scripts/fixtures/webhooks/whatsapp/inbound-text.json`
- Create: `scripts/fixtures/webhooks/gelato/order-shipped.json`
- Create: `scripts/fixtures/webhooks/stripe/checkout-completed.json`
- Test: `test/simulate-webhook.test.ts`

**Interfaces:**
- Produces: a CLI, `npx tsx scripts/simulate-webhook.ts <provider> <fixture> [--base-url <url>]`, where `<provider>` is `whatsapp | gelato | stripe` and `<fixture>` is a filename under `scripts/fixtures/webhooks/<provider>/` without `.json`. Exits 0 on a 2xx response, 1 otherwise, and prints the response body.
- Consumes: nothing from Task 1.

- [ ] **Step 1: Write the failing test**

Create `test/simulate-webhook.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildWebhookRequest } from "@/scripts/simulate-webhook";

describe("simulate-webhook fixture loading", () => {
  test("builds a POST request for a known provider+fixture", () => {
    const req = buildWebhookRequest("whatsapp", "inbound-text", "http://localhost:3013");
    expect(req.url).toBe("http://localhost:3013/api/webhooks/whatsapp");
    expect(req.method).toBe("POST");
    expect(JSON.parse(req.body as string)).toHaveProperty("entry");
  });

  test("refuses an unknown provider", () => {
    expect(() => buildWebhookRequest("acme" as never, "x", "http://localhost:3013")).toThrow(
      /unknown provider/i,
    );
  });

  test("refuses a fixture file that does not exist", () => {
    expect(() => buildWebhookRequest("whatsapp", "does-not-exist", "http://localhost:3013")).toThrow(
      /no such fixture/i,
    );
  });

  test("every fixture file referenced by a provider actually exists on disk", () => {
    const dir = path.join(process.cwd(), "scripts/fixtures/webhooks");
    for (const provider of fs.readdirSync(dir)) {
      const files = fs.readdirSync(path.join(dir, provider));
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) expect(file.endsWith(".json")).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/simulate-webhook.test.ts`
Expected: FAIL — `Cannot find module '@/scripts/simulate-webhook'`

- [ ] **Step 3: Write the fixtures**

Create `scripts/fixtures/webhooks/whatsapp/inbound-text.json` (shape matches Meta's Cloud API webhook envelope, consumed by `app/api/webhooks/whatsapp/route.ts`):

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "TEST_WABA_ID",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": { "display_phone_number": "15550001111", "phone_number_id": "TEST_PHONE_NUMBER_ID" },
            "contacts": [{ "profile": { "name": "Test Persona" }, "wa_id": "15550002222" }],
            "messages": [
              {
                "from": "15550002222",
                "id": "wamid.TEST_TEXT_MESSAGE",
                "timestamp": "1700000000",
                "type": "text",
                "text": { "body": "We made it to the hut, freezing but happy!" }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

Create `scripts/fixtures/webhooks/whatsapp/inbound-photo.json`:

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "TEST_WABA_ID",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": { "display_phone_number": "15550001111", "phone_number_id": "TEST_PHONE_NUMBER_ID" },
            "contacts": [{ "profile": { "name": "Test Persona" }, "wa_id": "15550002222" }],
            "messages": [
              {
                "from": "15550002222",
                "id": "wamid.TEST_PHOTO_MESSAGE",
                "timestamp": "1700000100",
                "type": "image",
                "image": { "id": "TEST_MEDIA_ID", "mime_type": "image/jpeg", "caption": "the view from the pass" }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

Create `scripts/fixtures/webhooks/gelato/order-shipped.json` (shape matches `Body` in `app/api/webhooks/gelato/route.ts:78-90`):

```json
{
  "event": "order_status_updated",
  "orderReferenceId": "REPLACE_WITH_REAL_ORDER_ID",
  "fulfillmentStatus": "shipped",
  "items": [
    {
      "fulfillments": [
        {
          "trackingCode": "TEST-TRACKING-CODE",
          "trackingUrl": "https://example.test/track/TEST-TRACKING-CODE",
          "shipmentMethodName": "Standard"
        }
      ]
    }
  ]
}
```

Create `scripts/fixtures/webhooks/stripe/checkout-completed.json` (a minimal envelope — the route verifies Stripe's signature over the *raw* body, so this fixture only exercises the JSON shape by calling `buildWebhookRequest` in tests; sending it live requires `--unsigned` and a test-mode webhook secret set to skip verification, documented in the skill in Task 5):

```json
{
  "id": "evt_test_checkout_completed",
  "object": "event",
  "type": "checkout.session.completed",
  "data": {
    "object": {
      "id": "cs_test_TEST_SESSION",
      "payment_status": "paid",
      "metadata": { "transactionId": "REPLACE_WITH_REAL_TRANSACTION_ID" }
    }
  }
}
```

- [ ] **Step 4: Write the simulator script**

Create `scripts/simulate-webhook.ts`:

```ts
#!/usr/bin/env -S npx tsx
import fs from "node:fs";
import path from "node:path";

/**
 * Simulate an inbound provider webhook against a local (or any) Fernscout
 * instance, without a real WhatsApp/Gelato/Stripe account round-tripping the
 * call. `docs/testing/coverage.ts`'s flows call this rather than waiting on
 * a real provider delivery — the same reasoning `lib/whatsapp/index.ts`'s
 * dry-run backend gives for the outbound half.
 *
 * Usage: npx tsx scripts/simulate-webhook.ts <provider> <fixture> [--base-url <url>]
 */

const ROUTE_PATH: Record<string, string> = {
  whatsapp: "/api/webhooks/whatsapp",
  gelato: "/api/webhooks/gelato",
  stripe: "/api/webhooks/stripe",
};

export function buildWebhookRequest(
  provider: string,
  fixture: string,
  baseUrl: string,
): { url: string; method: "POST"; headers: Record<string, string>; body: string } {
  const route = ROUTE_PATH[provider];
  if (!route) {
    throw new Error(`unknown provider "${provider}" (expected one of: ${Object.keys(ROUTE_PATH).join(", ")})`);
  }
  const file = path.join(process.cwd(), "scripts/fixtures/webhooks", provider, `${fixture}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`no such fixture "${fixture}" for provider "${provider}" (looked for ${file})`);
  }
  const body = fs.readFileSync(file, "utf8");
  return { url: `${baseUrl}${route}`, method: "POST", headers: { "content-type": "application/json" }, body };
}

async function main() {
  const [provider, fixture, ...rest] = process.argv.slice(2);
  if (!provider || !fixture) {
    console.error("usage: simulate-webhook.ts <provider> <fixture> [--base-url <url>]");
    process.exitCode = 1;
    return;
  }
  const baseFlagIndex = rest.indexOf("--base-url");
  const baseUrl = baseFlagIndex >= 0 ? rest[baseFlagIndex + 1] : "http://localhost:3013";

  const request = buildWebhookRequest(provider, fixture, baseUrl);
  const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body });
  const text = await response.text();
  console.log(`${response.status} ${response.statusText}\n${text}`);
  process.exitCode = response.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/simulate-webhook.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Manually verify against a running dev server**

Run: `PORT=3013 npm run dev` in one terminal (dry-run WhatsApp backend is the default, per `lib/whatsapp/index.ts:36`, so no credentials needed), then in another:

```bash
npx tsx scripts/simulate-webhook.ts whatsapp inbound-text
```

Expected: a `200` response body, and — since `WHATSAPP_APP_SECRET`/`WHATSAPP_VERIFY_TOKEN` are unset in a bare dev checkout — the route answering with whatever `app/api/webhooks/whatsapp/route.ts` does when `whatsappInbound` is off (read the route's own refusal to confirm the exact shape; this step is a smoke test of the script, not an assertion about the route's behavior).

- [ ] **Step 7: Commit**

```bash
git add scripts/simulate-webhook.ts scripts/fixtures/webhooks test/simulate-webhook.test.ts
git commit -m "Add webhook fixture simulator for whatsapp/gelato/stripe"
```

---

## Task 3: Role-lifecycle personas

**Files:**
- Create: `docs/testing/personas/owner-new.md`
- Create: `docs/testing/personas/owner-established.md`
- Create: `docs/testing/personas/buddy-invited.md`
- Create: `docs/testing/personas/buddy-established.md`
- Create: `docs/testing/personas/guest-invited.md`
- Create: `docs/testing/personas/guest-established.md`

No test — these are prose a persona-driving session reads, the same as `.claude/skills/test-with-personas/SKILL.md`'s existing five attribute personas. Nothing here is executable.

- [ ] **Step 1: Write `docs/testing/personas/owner-new.md`**

```markdown
# Persona: owner-new

**Role-lifecycle axis.** Owns no journal yet. Has never seen `/agent`, WhatsApp
onboarding, or the API docs before this session.

Cross with an attribute persona from `.claude/skills/test-with-personas/SKILL.md`
(elder-phone, power-desktop, voice-preferring, hu-reader, screen-reader) to
decide *how* they behave; this file only says *what they want and know*.

**Wants:** to start a travel journal for an upcoming or ongoing trip. Has
photos on their phone and a rough idea of the days but no patience for a form.

**Knows:** nothing about Fernscout's content model, frontmatter, or the
draft/publish distinction. Discovers `/agent`, WhatsApp, or a bring-your-own-
agent doc the way a real stranger would — from whatever the flow hands them
(a URL, a WhatsApp number), never from source or a ticket.

**Journal naming for this persona (test runs only):** `test-<something>`,
never a name that reads like a person's (AGENTS.md).
```

- [ ] **Step 2: Write `docs/testing/personas/owner-established.md`**

```markdown
# Persona: owner-established

**Role-lifecycle axis.** Already owns a journal with at least one trip and
several published days. Comfortable with the tool; testing this persona is
about whether an *existing* journal's data still behaves correctly under a
new feature, not about first impressions.

**Wants:** to keep writing — add a day to an existing trip, correct one
already published (`components/EditDay.tsx`), check credits/storage, invite
a buddy or guest, order a postcard or photobook.

**Knows:** the vocabulary (draft vs. published, guest vs. buddy vs. private)
and where things live in the UI. A flow using this persona should exercise
*existing* content — AGENTS.md's own point about B1090: "an existing day, an
existing trip, a page nobody wrote for the test."

**Journal for this persona:** a `test-*` journal seeded with a real trip and
at least two published days, provisioned once and reused across flows rather
than recreated per run.
```

- [ ] **Step 3: Write `docs/testing/personas/buddy-invited.md`**

```markdown
# Persona: buddy-invited

**Role-lifecycle axis.** Holds a buddy-invite link (`/​<user>/invite/buddy/<token>`)
they have not opened yet. Was texted or emailed the link by an owner-established
persona in the same flow, or the flow hands it directly as a starting URL.

**Wants:** to see what they were invited to, prove their address, and land in
the owner's approval queue. Does not yet have write access — that is the
*next* persona, `buddy-established`.

**Knows:** whatever the invitation itself said — AGENTS.md: "a closed trip
does not name itself" in the sign-in gate, so this persona should not know
which trip it is beyond what the invite text told them.
```

- [ ] **Step 4: Write `docs/testing/personas/buddy-established.md`**

```markdown
# Persona: buddy-established

**Role-lifecycle axis.** An approved buddy with write access to one trip —
may hold a trip-scoped agent token. Was on the trip; writes and corrects days
for it, same as the owner can, but scoped to that one trip only (AGENTS.md:
"a trip-scoped token writes days into its trip and cannot put them on the
site").

**Wants:** to add a day for a leg they just finished, or correct one already
there. Never to publish — that stays the owner's call even when this persona
is driving `/agent`: ask in words, wait for an answer, and if the flow is
about a buddy's own agent, "the trip is mine to write, not mine to publish"
is exactly the boundary the flow should prove holds.

**Knows:** the trip they're scoped to and nothing else in the journal.
```

- [ ] **Step 5: Write `docs/testing/personas/guest-invited.md`**

```markdown
# Persona: guest-invited

**Role-lifecycle axis.** Holds a guest-invite link
(`/​<user>/invite/guest/<token>`) they have not opened yet — the family-group-chat
kind, leading to read access on the journal's `guest` trips once approved.

**Wants:** to see what changed, sign up if a signup flow gates it, and land
in the owner's approval queue. Read-only intent throughout; a flow using this
persona should never reach a write endpoint.

**Knows:** only what the invite text said, same caveat as `buddy-invited`.
```

- [ ] **Step 6: Write `docs/testing/personas/guest-established.md`**

```markdown
# Persona: guest-established

**Role-lifecycle axis.** An approved guest, holding either a session cookie
or a year-long identity cookie (AGENTS.md: `fs_identity`). Reads the
journal's `guest` trips; never writes.

**Wants:** to check for a new update — a fresh day, a new photograph — and
to read it in their own language if the journal ships one. Good persona for
proving locale switching and the reader-facing weather/reaction UI, since
they touch nothing an owner or buddy would.

**Knows:** how to sign back in (identity cookie or a fresh code) and which
trips they were let into. Nothing about the owner's editing surface.
```

- [ ] **Step 7: Commit**

```bash
git add docs/testing/personas
git commit -m "Add the six role-lifecycle testing personas"
```

---

## Task 4: Example flows

**Files:**
- Create: `docs/testing/flows/owner-new-onboard-whatsapp.md`
- Create: `docs/testing/flows/buddy-established-add-day-agent.md`
- Create: `docs/testing/flows/guest-invited-signup-see-update.md`

**Interfaces:**
- Consumes: persona files from Task 3 (referenced by filename), fixtures from Task 2 (`scripts/fixtures/webhooks/whatsapp/inbound-photo.json`), the `COVERAGE` entries already written in Task 1 that name these three filenames.

- [ ] **Step 1: Write `docs/testing/flows/owner-new-onboard-whatsapp.md`**

```markdown
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
- The draft renders correctly at `/​<user>/day/<slug>` once published, checked
  in a browser at the requested viewport (graphical check).
```

- [ ] **Step 2: Write `docs/testing/flows/buddy-established-add-day-agent.md`**

```markdown
# Flow: buddy-established-add-day-agent

**Persona:** `buddy-established` (docs/testing/personas/buddy-established.md)
**Interface:** `/agent`
**Capabilities exercised:** `helper`, `auth`
**Device/locale:** run at both desktop and mobile viewports when a ticket
asks for both; language matches whichever locale the seeded journal uses.
**Check type:** technical (correct API calls, correct draft, correct trip
scoping) and graphical (the `/agent` conversation UI itself, at the
requested viewport).

## Setup

1. Local dev server running with `features.helper` on and
   `ANTHROPIC_API_KEY` set — this flow makes a real (small) Anthropic call,
   per the accepted cost in the design's Global Constraints.
2. A `test-buddy-established` journal seeded with one trip and a
   trip-scoped agent token for the buddy persona (`get-token.sh` against the
   local server, scoped to that trip).

## Steps

1. Drive `http://localhost:3013/agent` (not the live site — unlike
   `.claude/skills/test-with-personas/SKILL.md`, which points at
   `https://fernscout.ch/agent` on purpose; this flow needs the local
   dry-run/test-key environment) as the `buddy-established` persona: ask it
   to add a day for "the pass we crossed today", describing only what the
   persona actually said happened.
2. Confirm the agent writes the day as a draft (`POST .../days`, never
   published on create — AGENTS.md) and scoped to the one trip the buddy
   token covers.
3. Ask the agent to publish. Confirm it refuses or defers — a buddy token
   cannot publish (AGENTS.md: "being on the bus is not the same as deciding
   what the journal says").
4. Screenshot the `/agent` conversation at the requested viewport(s).

## Done when

- The draft day exists, scoped to the right trip, containing only what the
  persona said (technical check).
- The agent never calls the publish endpoint on the buddy's behalf, and its
  own words to the persona do not claim the day is published (technical +
  the "claim checked against the turn" rule in AGENTS.md's `lib/helper/model.ts`
  section).
- The conversation reads correctly at each requested viewport (graphical
  check).
```

- [ ] **Step 3: Write `docs/testing/flows/guest-invited-signup-see-update.md`**

```markdown
# Flow: guest-invited-signup-see-update

**Persona:** `guest-invited` (docs/testing/personas/guest-invited.md)
**Interface:** journal UI
**Capabilities exercised:** `signup`, `contacts`, `auth`
**Device/locale:** run at the requested viewport and in each locale the
seeded journal ships, to prove the sign-in gate and the guest trip list both
translate correctly.
**Check type:** graphical primarily (the sign-in gate, the approval-pending
state, the trip list once approved) with one technical check (the approval
row actually exists after the owner approves).

## Setup

1. Local dev server running with `features.contacts` and `features.auth` on
   (`CONTACTS_ENCRYPTION_KEY`, `SESSION_SECRET` set to any test values).
2. A `test-guest-invited` journal with an owner-established persona's
   session, and one `guest` trip.
3. An owner-issued guest-invite link (`POST /api/v1/test-guest-invited/invites`).

## Steps

1. Open the guest-invite link as the `guest-invited` persona. Confirm the
   sign-in gate names the journal only — never the trip
   (AGENTS.md: "a closed trip does not name itself").
2. Complete the identity/code flow. Confirm the persona lands in a
   pending-approval state, not on the trip itself.
3. As the owner-established persona (a second browser session), approve the
   contact.
4. As `guest-invited` (now effectively `guest-established`), reload and
   confirm the `guest` trip is now visible, and every other trip is not.
5. Repeat step 1-4's *visual* checks once per locale the journal ships.

## Done when

- The pending state and the approved state both render correctly at the
  requested viewport, in every locale checked (graphical check).
- After approval, exactly the trips marked `guest` are visible and nothing
  else (technical check, cross-referenced against the trip files' own
  `visibility` frontmatter).
```

- [ ] **Step 4: Commit**

```bash
git add docs/testing/flows
git commit -m "Add three example flows covering whatsapp/agent/ui interfaces"
```

---

## Task 5: The `test-a-feature` harness

**Files:**
- Create: `.claude/skills/test-a-feature/SKILL.md`
- Create: `scripts/test-a-feature.ts`
- Test: `test/test-a-feature.test.ts`

**Interfaces:**
- Consumes: `COVERAGE` from Task 1 (`@/docs/testing/coverage`), the flow filenames it names (Task 4), `.claude/skills/get-a-credential/get-token.sh` (Task's Global Constraints — invoked as a subprocess, not imported).
- Produces: `resolveFlows(capability: FeatureName): { flows: string[]; note?: string }`, exported from `scripts/test-a-feature.ts`, plus the CLI `npx tsx scripts/test-a-feature.ts <capability> [--device desktop,mobile] [--locale en,de,hu]`.

- [ ] **Step 1: Write the failing test**

Create `test/test-a-feature.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { resolveFlows } from "@/scripts/test-a-feature";

describe("resolveFlows", () => {
  test("returns the flows a covered capability names", () => {
    const result = resolveFlows("helper");
    expect(result.flows).toEqual(["buddy-established-add-day-agent"]);
    expect(result.note).toBeUndefined();
  });

  test("returns no flows and a note for a todo capability", () => {
    const result = resolveFlows("credits");
    expect(result.flows).toEqual([]);
    expect(result.note).toMatch(/no flow yet/i);
  });

  test("throws for a capability name that does not exist", () => {
    expect(() => resolveFlows("acme" as never)).toThrow(/unknown capability/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/test-a-feature.test.ts`
Expected: FAIL — `Cannot find module '@/scripts/test-a-feature'`

- [ ] **Step 3: Write the harness script**

Create `scripts/test-a-feature.ts`:

```ts
#!/usr/bin/env -S npx tsx
import { FEATURE_NAMES, type FeatureName } from "@/lib/config";
import { COVERAGE } from "@/docs/testing/coverage";

/**
 * The entry point docs/testing/coverage.ts exists to serve: given a
 * capability, say which flows exercise it (and, when there are none yet,
 * say why) — so "test this feature on desktop and mobile" is a lookup
 * rather than a person hand-assembling personas each time.
 *
 * Deliberately does not drive a browser or an agent conversation itself —
 * that orchestration differs per interface (WhatsApp: scripts/simulate-webhook.ts;
 * /agent and the journal UI: an interactive session following the flow file's
 * own steps, same as .claude/skills/test-in-a-browser already does). This
 * script's job stops at "here is what to run and why," which is printed for
 * a session to carry out; automating the drive-it-yourself half is future
 * work once more than three flows exist to learn a pattern from.
 */

export function resolveFlows(capability: FeatureName): { flows: string[]; note?: string } {
  if (!(FEATURE_NAMES as readonly string[]).includes(capability)) {
    throw new Error(`unknown capability "${capability}" (see lib/config.ts FEATURE_NAMES)`);
  }
  const entry = COVERAGE[capability];
  if ("todo" in entry) return { flows: [], note: entry.todo };
  return { flows: [...entry.flows] };
}

function parseList(value: string | undefined): string[] | undefined {
  return value ? value.split(",").map((v) => v.trim()).filter(Boolean) : undefined;
}

function main() {
  const [capability, ...rest] = process.argv.slice(2);
  if (!capability) {
    console.error("usage: test-a-feature.ts <capability> [--device desktop,mobile] [--locale en,de,hu]");
    process.exitCode = 1;
    return;
  }
  const deviceIndex = rest.indexOf("--device");
  const localeIndex = rest.indexOf("--locale");
  const devices = parseList(deviceIndex >= 0 ? rest[deviceIndex + 1] : undefined) ?? ["desktop"];
  const locales = parseList(localeIndex >= 0 ? rest[localeIndex + 1] : undefined) ?? ["en"];

  const { flows, note } = resolveFlows(capability as FeatureName);
  if (flows.length === 0) {
    console.log(`No flows cover "${capability}" yet.${note ? ` (${note})` : ""}`);
    return;
  }
  console.log(`Flows covering "${capability}":`);
  for (const flow of flows) {
    console.log(`  - docs/testing/flows/${flow}.md, across devices [${devices.join(", ")}] and locales [${locales.join(", ")}]`);
  }
  console.log("\nOpen each flow file and follow its Setup/Steps/Done-when sections.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/test-a-feature.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the skill**

Create `.claude/skills/test-a-feature/SKILL.md`:

```markdown
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
npx tsx scripts/test-a-feature.ts <capability> --device desktop,mobile --locale en,de
```

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
  against the running local server, per the flow's own Steps section. Add a
  new fixture under `scripts/fixtures/webhooks/<provider>/` if the flow needs
  a payload shape that does not exist yet.
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
```

- [ ] **Step 6: Manual verification**

Run: `npx tsx scripts/test-a-feature.ts helper --device desktop,mobile`
Expected: prints the `buddy-established-add-day-agent` flow path and the requested devices/locales.

Run: `npx tsx scripts/test-a-feature.ts credits`
Expected: prints the `todo` note for `credits` from Task 1's matrix.

Run: `npx tsx scripts/test-a-feature.ts not-a-real-capability`
Expected: throws / non-zero exit with "unknown capability".

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/test-a-feature scripts/test-a-feature.ts test/test-a-feature.test.ts
git commit -m "Add the test-a-feature skill and harness script"
```

---

## Task 6: File the Stannp-webhook gap as a backlog ticket

Not a code task — a task-file capture, per AGENTS.md ("anything you notice
goes into backlog, always"). Task files are committed directly to `main`,
never through a worktree.

- [ ] **Step 1: Capture the ticket**

From the main checkout (not this worktree):

```bash
npm run tasks -- new --type ISSUE --priority medium --complexity medium \
  --area "postcards" \
  --title "Stannp has no inbound webhook route, unlike every other print/message provider"
```

- [ ] **Step 2: Fill in the task body**

Edit the newly created file under `docs/tasks/backlog/issue/` to read:

```markdown
## Why

`app/api/webhooks/` has routes for gelato, stripe, twilio, and whatsapp, but
none for stannp — confirmed by directory listing during the managed-instance
testing-framework plan (docs/superpowers/plans/2026-09-11-managed-instance-testing-framework.md).
`app/api/webhooks/gelato/route.ts` is the shape a Stannp equivalent would
take: a shared-secret header (Stannp offers no signature, same as Gelato),
settling terminal failures and recording tracking/dispatch status, mailing
the owner once. Without it, a postcard order's status can only be checked by
polling Stannp directly (if such a poll exists — check `lib/postcard/orders.ts`
and `lib/postcard/reconcile.ts` for whether one does), and the
managed-instance testing framework has no inbound postcard flow to add to
`docs/testing/coverage.ts` until this ships (see the `postcards` `todo` entry
there).

## Work

Mirror `app/api/webhooks/gelato/route.ts`'s shape for Stannp's own webhook
payload and status vocabulary (check Stannp's API docs for their webhook
event names and shared-secret mechanism — likely a custom header the same
way Gelato's `x-fernscout-webhook` is). Add `STANNP_WEBHOOK_SECRET` to
`lib/capabilities.ts`'s postcards requirement the way `GELATO_WEBHOOK_SECRET`
would need to be (check it is not already silently expected somewhere).

Not doing: building a fixture-driven flow for it yet — that is
`docs/testing/coverage.ts`'s `postcards` entry, updated once this route
exists.

## Acceptance

A `POST /api/webhooks/stannp` route exists, refuses an unauthenticated
delivery the way `app/api/webhooks/gelato/route.ts` does, and
`test/openapi-contract.test.ts` / the equivalent webhook test coverage passes.
```

- [ ] **Step 3: Commit** (from the main checkout)

```bash
git add docs/tasks/backlog/issue/*.md docs/tasks/INDEX.md
git commit -m "Capture: Stannp has no inbound webhook route"
```

---

## Final verification

- [ ] Run `npm run verify` from a worktree with `node_modules` cloned via
  `cp -Rc` from the shared checkout (AGENTS.md — a worktree has no
  `node_modules` of its own). Expected: build, tsc, eslint, vitest, and
  `npm run unused` all pass, including the new
  `test/coverage-contract.test.ts`, `test/simulate-webhook.test.ts`, and
  `test/test-a-feature.test.ts`.
- [ ] Manually run the three commands in Task 5 Step 6 once more after every
  task is merged, since Task 1's matrix and Task 5's script are read
  together.
- [ ] Confirm no file under this plan writes anything to `content/`, calls
  Stripe/Gelato/Stannp with a live key, or reaches `fernscout.ch` — grep the
  diff for `sk_live_`, `fernscout.ch`, and any provider URL outside the ones
  already named in the Global Constraints.
