#!/usr/bin/env -S npx tsx
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Simulate an inbound provider webhook against a local (or any) Fernscout
 * instance, without a real WhatsApp/Gelato/Stripe account round-tripping the
 * call. `docs/testing/coverage.ts`'s flows call this rather than waiting on
 * a real provider delivery — the same reasoning `lib/whatsapp/index.ts`'s
 * dry-run backend gives for the outbound half.
 *
 * Every real route verifies a provider-specific credential before it does
 * anything, so an unsigned POST only ever reaches the capability-off or
 * no-secret refusal, never the authenticated path. This script signs
 * best-effort, from its own environment, the same three ways the routes
 * verify:
 *
 * - **whatsapp**: `x-hub-signature-256: sha256=<hex hmac-sha256>` over the raw
 *   body, keyed on `WHATSAPP_APP_SECRET` — `app/api/webhooks/whatsapp/route.ts`.
 * - **gelato**: `x-fernscout-webhook: <secret>` verbatim (no HMAC — Gelato
 *   signs nothing, so the header itself is the credential), from
 *   `GELATO_WEBHOOK_SECRET` — `app/api/webhooks/gelato/route.ts`.
 * - **stripe**: `stripe-signature: t=<ts>,v1=<hex hmac-sha256 of "ts.body">`,
 *   keyed on `STRIPE_WEBHOOK_SECRET` — the scheme `stripe().webhooks.
 *   constructEvent` verifies in `app/api/webhooks/stripe/route.ts`.
 *
 * With the matching secret absent from this process's own environment, the
 * request goes out unsigned exactly as before — this still works, unsigned,
 * against a bare dev server with no secret configured; it just cannot get
 * past a route that requires one.
 *
 * Usage: npx tsx scripts/simulate-webhook.ts <provider> <fixture> [--base-url <url>]
 */

const ROUTE_PATH: Record<string, string> = {
  whatsapp: "/api/webhooks/whatsapp",
  gelato: "/api/webhooks/gelato",
  stripe: "/api/webhooks/stripe",
};

/** One signature header per provider, or none if its secret is not set in
 * this process's own environment — signing is best-effort, never required. */
function signatureHeader(provider: string, body: string): Record<string, string> {
  if (provider === "whatsapp") {
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret) return {};
    const hex = crypto.createHmac("sha256", secret).update(body).digest("hex");
    return { "x-hub-signature-256": `sha256=${hex}` };
  }
  if (provider === "gelato") {
    const secret = process.env.GELATO_WEBHOOK_SECRET;
    if (!secret) return {};
    return { "x-fernscout-webhook": secret };
  }
  if (provider === "stripe") {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return {};
    const timestamp = Math.floor(Date.now() / 1000);
    const signed = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    return { "stripe-signature": `t=${timestamp},v1=${signed}` };
  }
  return {};
}

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
  return {
    url: `${baseUrl}${route}`,
    method: "POST",
    headers: { "content-type": "application/json", ...signatureHeader(provider, body) },
    body,
  };
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
