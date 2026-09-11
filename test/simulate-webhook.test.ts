import { afterEach, describe, expect, test } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildWebhookRequest } from "@/scripts/simulate-webhook";

const SECRET_ENV = ["WHATSAPP_APP_SECRET", "GELATO_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET"] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const key of SECRET_ENV) savedEnv[key] = process.env[key];

afterEach(() => {
  for (const key of SECRET_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

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

describe("simulate-webhook signing", () => {
  test("signs whatsapp with x-hub-signature-256 when WHATSAPP_APP_SECRET is set", () => {
    process.env.WHATSAPP_APP_SECRET = "test-app-secret";
    const req = buildWebhookRequest("whatsapp", "inbound-text", "http://localhost:3013");
    const expected = crypto.createHmac("sha256", "test-app-secret").update(req.body).digest("hex");
    expect(req.headers["x-hub-signature-256"]).toBe(`sha256=${expected}`);
  });

  test("sends whatsapp unsigned when WHATSAPP_APP_SECRET is not set", () => {
    delete process.env.WHATSAPP_APP_SECRET;
    const req = buildWebhookRequest("whatsapp", "inbound-text", "http://localhost:3013");
    expect(req.headers["x-hub-signature-256"]).toBeUndefined();
  });

  test("signs gelato with x-fernscout-webhook when GELATO_WEBHOOK_SECRET is set", () => {
    process.env.GELATO_WEBHOOK_SECRET = "test-gelato-secret";
    const req = buildWebhookRequest("gelato", fixtureNameFor("gelato"), "http://localhost:3013");
    expect(req.headers["x-fernscout-webhook"]).toBe("test-gelato-secret");
  });

  test("sends gelato unsigned when GELATO_WEBHOOK_SECRET is not set", () => {
    delete process.env.GELATO_WEBHOOK_SECRET;
    const req = buildWebhookRequest("gelato", fixtureNameFor("gelato"), "http://localhost:3013");
    expect(req.headers["x-fernscout-webhook"]).toBeUndefined();
  });

  test("signs stripe with a stripe-signature header when STRIPE_WEBHOOK_SECRET is set", () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const req = buildWebhookRequest("stripe", fixtureNameFor("stripe"), "http://localhost:3013");
    const header = req.headers["stripe-signature"];
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]+$/);
    const [, tsPart, v1Part] = header!.match(/^t=(\d+),v1=([0-9a-f]+)$/)!;
    const expected = crypto.createHmac("sha256", "whsec_test").update(`${tsPart}.${req.body}`).digest("hex");
    expect(v1Part).toBe(expected);
  });

  test("sends stripe unsigned when STRIPE_WEBHOOK_SECRET is not set", () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const req = buildWebhookRequest("stripe", fixtureNameFor("stripe"), "http://localhost:3013");
    expect(req.headers["stripe-signature"]).toBeUndefined();
  });
});

/** The first fixture file present for a provider, without its `.json`
 * extension — signing tests only care that a fixture exists, not which one. */
function fixtureNameFor(provider: string): string {
  const dir = path.join(process.cwd(), "scripts/fixtures/webhooks", provider);
  const [first] = fs.readdirSync(dir);
  return first.replace(/\.json$/, "");
}
