import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { POST as twilioPOST } from "@/app/api/webhooks/twilio/route";
import { POST as journalsPOST } from "@/app/api/v1/journals/route";
import { POST as phoneRequestPOST } from "@/app/api/auth/signup/phone/route";
import { POST as phoneVerifyPOST } from "@/app/api/auth/signup/phone/redeem/route";
import { NO_JOURNAL, issueCode, verifyCode } from "@/lib/auth";
import { clearConfigCache } from "@/lib/config";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { listSms } from "@/lib/sms/store";
import { clearUserCache, getUser } from "@/lib/users";

/**
 * B1316 — the SMS channel: the signed Twilio webhook stores an inbound
 * message once, and the signup phone step's SMS fallback delivers a code
 * without a Twilio account (dry-run) and refuses a number the instance's
 * own number cannot reach.
 */

const AUTH_TOKEN = "test-twilio-auth-token";

let dir: string;

function writeConfig(overrides: { smsInbound?: boolean; sms?: boolean } = {}) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        signup: { enabled: true, phoneBackend: "whatsapp-inbound" },
        whatsapp: { enabled: true, backend: "dry-run", number: "+41 79 111 22 33" },
        whatsappInbound: { enabled: true },
        sms: { enabled: overrides.sms ?? true, backend: "dry-run", allowedPrefixes: ["+41"] },
        smsInbound: { enabled: overrides.smsInbound ?? true },
      },
    }),
  );
  clearConfigCache();
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-b1316-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "sms.db")}`;
  process.env.SESSION_SECRET = "b1316-test-secret-b1316-test-secret";
  process.env.WHATSAPP_APP_SECRET = "test-secret";
  process.env.WHATSAPP_VERIFY_TOKEN = "test-token";
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  writeConfig();
  clearUserCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  delete process.env.TWILIO_AUTH_TOKEN;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Twilio's published scheme: URL + name-sorted params, HMAC-SHA1, base64. */
function sign(params: Record<string, string>): string {
  const base =
    "https://t.test/api/webhooks/twilio" +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  return crypto.createHmac("sha1", AUTH_TOKEN).update(base).digest("base64");
}

function deliver(params: Record<string, string>, signature: string | null) {
  return twilioPOST(
    new Request("http://localhost:3000/api/webhooks/twilio", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(signature ? { "x-twilio-signature": signature } : {}),
      },
      body: new URLSearchParams(params).toString(),
    }),
  );
}

const INBOUND = {
  MessageSid: "SM0000000000000000000000000000001",
  From: "+41760000009",
  To: "+41766014649",
  Body: "Hello from a fixture",
};

describe("the Twilio webhook", () => {
  test("a signed delivery is stored once, and a retry adds no second row", async () => {
    const first = await deliver(INBOUND, sign(INBOUND));
    expect(first.status).toBe(200);
    expect(await first.text()).toContain("<Response/>");

    const retry = await deliver(INBOUND, sign(INBOUND));
    expect(retry.status).toBe(200);

    const rows = await listSms();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      direction: "in",
      from: "41760000009",
      to: "41766014649",
      body: "Hello from a fixture",
      providerSid: INBOUND.MessageSid,
    });
  });

  test("a tampered delivery is refused and stores nothing", async () => {
    const signature = sign(INBOUND);
    const tampered = { ...INBOUND, Body: "Something else" };
    expect((await deliver(tampered, signature)).status).toBe(403);
    expect((await deliver(INBOUND, null)).status).toBe(403);
    expect(await listSms()).toHaveLength(0);
  });

  test("404s when the capability is off", async () => {
    writeConfig({ smsInbound: false });
    expect((await deliver(INBOUND, sign(INBOUND))).status).toBe(404);
  });
});

async function signupToken(email: string): Promise<string> {
  const { code } = await issueCode(NO_JOURNAL, email, "signup");
  const result = await verifyCode(NO_JOURNAL, email, code, "signup");
  if (!result.ok) throw new Error("could not mint a signup token");
  return result.token;
}

function post(route: (r: Request) => Promise<Response>, token: string, body: unknown) {
  return route(
    new Request("https://t.test/x", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
  );
}

/** The one dry-run SMS payload on disk, parsed. */
function dryRunSms(): { to: string; body: string }[] {
  const smsDir = path.join(dir, "sms");
  if (!fs.existsSync(smsDir)) return [];
  return fs
    .readdirSync(smsDir)
    .map((f) => JSON.parse(fs.readFileSync(path.join(smsDir, f), "utf8")) as { to: string; body: string });
}

describe("the SMS fallback beside the inbound proof", () => {
  test("channel sms delivers a code, the code proves, and the journal records how", async () => {
    const token = await signupToken("b1316@example.test");

    // The inbound-mode answer advertises the way out.
    const linked = await post(phoneRequestPOST, token, {});
    expect(((await linked.json()) as { smsFallback: boolean }).smsFallback).toBe(true);

    const requested = await post(phoneRequestPOST, token, {
      channel: "sms",
      tel: "+41 76 000 00 09",
    });
    expect(requested.status).toBe(202);
    const { id } = (await requested.json()) as { id: string };

    const sent = dryRunSms();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("41760000009");
    const code = sent[0].body.match(/\d{6}/)?.[0];
    expect(code).toBeTruthy();

    const verified = await post(phoneVerifyPOST, token, { id, code });
    expect(verified.status).toBe(200);
    expect(((await verified.json()) as { tel: string }).tel).toBe("41760000009");

    const created = await post(journalsPOST, token, {
      title: "Ours",
      username: "b1316-sms",
      ownerName: "B Thirteen",
      ownerNickname: "B",
      visibility: "public",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    });
    expect(created.status).toBe(201);
    const user = getUser("b1316-sms");
    expect(user?.owner.tel).toBe("41760000009");
    // Not "whatsapp-inbound", though that is the configured mode — the
    // session recorded which path actually proved it.
    expect(user?.owner.telProvenMethod).toBe("sms");
  });

  test("a number outside the sender restriction is refused with the reason, before any spend", async () => {
    const token = await signupToken("b1316b@example.test");
    const refused = await post(phoneRequestPOST, token, { channel: "sms", tel: "+49 151 000 00 00" });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toBe("sms_unreachable");
    expect(dryRunSms()).toHaveLength(0);
  });

  test("channel sms with the capability off is refused, and the wa answer says so", async () => {
    writeConfig({ sms: false });
    const token = await signupToken("b1316c@example.test");

    const linked = await post(phoneRequestPOST, token, {});
    expect(((await linked.json()) as { smsFallback: boolean }).smsFallback).toBe(false);

    const refused = await post(phoneRequestPOST, token, { channel: "sms", tel: "+41 76 000 00 09" });
    expect(refused.status).toBe(404);
    expect(((await refused.json()) as { error: string }).error).toBe("sms_disabled");
  });
});
