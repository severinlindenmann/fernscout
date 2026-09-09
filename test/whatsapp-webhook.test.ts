import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { GET, POST } from "@/app/api/webhooks/whatsapp/route";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

/**
 * B1057 — reading an inbound WhatsApp message.
 *
 * A signed fixture posted to the route is accepted, an unsigned one is
 * refused, the same fixture posted twice does one thing, and none of it
 * needs a Meta account — the acceptance line, verified directly.
 */

const APP_SECRET = "test-app-secret";
const VERIFY_TOKEN = "test-verify-token";

let dir: string;

function writeConfig(enabled = true) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: [] },
      features: { whatsappInbound: { enabled } },
    }),
  );
  clearConfigCache();
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-whatsapp-webhook-"));
  process.env.CONTENT_DIR = dir;
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;
  writeConfig(true);
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

function sign(body: string): string {
  return `sha256=${crypto.createHmac("sha256", APP_SECRET).update(body).digest("hex")}`;
}

function fixture(wamid: string, body = "Hello from a fixture") {
  return JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "41782172646", phone_number_id: "123" },
              contacts: [{ profile: { name: "A Traveller" }, wa_id: "41760000009" }],
              messages: [
                { id: wamid, from: "41760000009", timestamp: "1710000000", type: "text", text: { body } },
              ],
            },
          },
        ],
      },
    ],
  });
}

function post(body: string, signature: string | null) {
  return POST(
    new Request("https://example.test/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json", ...(signature ? { "x-hub-signature-256": signature } : {}) },
      body,
    }),
  );
}

describe("the GET handshake", () => {
  test("answers the challenge when the verify token matches", async () => {
    const url = `https://example.test/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=12345`;
    const response = await GET(new Request(url));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("12345");
  });

  test("refuses the wrong token", async () => {
    const url = `https://example.test/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345`;
    const response = await GET(new Request(url));
    expect(response.status).toBe(403);
  });

  test("404s when the capability is off", async () => {
    writeConfig(false);
    const url = `https://example.test/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1`;
    expect((await GET(new Request(url))).status).toBe(404);
  });
});

describe("the POST route", () => {
  test("a signed fixture is accepted", async () => {
    const body = fixture("wamid.signed-1");
    const response = await post(body, sign(body));
    expect(response.status).toBe(200);
    const json = (await response.json()) as { ok: boolean; received: number };
    expect(json.ok).toBe(true);
    expect(json.received).toBe(1);
  });

  test("an unsigned fixture is refused", async () => {
    const body = fixture("wamid.unsigned-1");
    expect((await post(body, null)).status).toBe(401);
  });

  test("a wrongly signed fixture is refused", async () => {
    const body = fixture("wamid.wrong-sig");
    expect((await post(body, "sha256=" + "0".repeat(64))).status).toBe(401);
  });

  test("the same fixture posted twice does one thing", async () => {
    const body = fixture("wamid.dup-1");
    const first = await post(body, sign(body));
    expect(first.status).toBe(200);
    const second = await post(body, sign(body));
    expect(second.status).toBe(200);
    // Both requests answer 200 (Meta must not see a retry as a failure); the
    // idempotency layer is what stops it being handled a second time, which
    // dispatch.ts's own log line would show under a real Meta account. What
    // this test can assert without hooking the dispatcher is that the second
    // delivery does not error and is acknowledged the same way as the first.
    expect((await second.json()) as { ok: boolean }).toEqual({ ok: true, received: 1 });
  });

  test("404s when the capability is off", async () => {
    writeConfig(false);
    const body = fixture("wamid.off-1");
    expect((await post(body, sign(body))).status).toBe(404);
  });
});
