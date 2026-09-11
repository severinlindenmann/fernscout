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
 * This sends a bare, unsigned POST. Every real route verifies a
 * provider-specific credential before it does anything —
 * `app/api/webhooks/whatsapp/route.ts` an HMAC over the raw body,
 * `app/api/webhooks/gelato/route.ts` a shared header, and
 * `app/api/webhooks/stripe/route.ts` a signed `stripe-signature` header — so
 * this script alone will not get past those checks on a dev server with the
 * matching secret configured; it exercises routing, JSON parsing and the
 * capability-off/no-secret refusals, not the authenticated path.
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
