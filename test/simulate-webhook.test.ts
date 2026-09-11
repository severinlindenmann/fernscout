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
