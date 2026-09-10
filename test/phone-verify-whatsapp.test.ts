import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { POST as authRequestPOST } from "@/app/api/auth/request/route";
import { POST as authVerifyPOST } from "@/app/api/auth/verify/route";
import { resolveCapabilities } from "@/lib/capabilities";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { checkVerification, startVerification } from "@/lib/phoneVerify";

/**
 * B1222 — the WhatsApp phone-verification backend, and the WhatsApp channel
 * on `POST /api/auth/request`.
 *
 * What these pin: the code lifecycle stays this repository's own discipline
 * while only the delivery changes; a login code goes to WhatsApp only for
 * the owner's own address with a number proven at signup, and every other
 * address gets the same silent 202 it would get by mail; and a server with
 * WhatsApp off refuses before anything is issued.
 */

const OWNER = "alex";
const OWNER_EMAIL = "alex@example.test";
const TEL = "41790000001";

let dir: string;

function writeServerConfig(opts: { whatsappOn?: boolean } = {}) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        mail: { enabled: true, transport: "file" },
        signup: { enabled: true, phoneBackend: "whatsapp" },
        whatsapp: { enabled: opts.whatsappOn !== false, backend: "dry-run" },
      },
    }),
  );
  clearConfigCache();
}

function writeUserConfig(owner: Record<string, unknown> = {}) {
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      tagline: "one slow loop",
      owner: { name: "Alex B", nickname: "Alex", email: OWNER_EMAIL, ...owner },
      startLocation: "Zurich",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true } },
    }),
  );
  clearUserCache();
}

/** The one dry-run WhatsApp payload under `<root>/<sub>`, parsed. */
function payloads(sub: string): { to: string; template: string; body: string[] }[] {
  const p = path.join(dir, sub);
  if (!fs.existsSync(p)) return [];
  return fs
    .readdirSync(p)
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(p, f), "utf8")));
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-b1222-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "auth.db")}`;
  process.env.SESSION_SECRET = "b1222-test-secret-b1222-test-secret";
  writeServerConfig();
  writeUserConfig();
  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the whatsapp phone-verification backend", () => {
  test("delivers our own code as an authentication template, and checks it ourselves", async () => {
    const { id } = await startVerification(TEL, "de");

    const sent = payloads(".whatsapp");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(TEL);
    expect(sent[0].template).toBe("fernscout_auth_code");
    const code = sent[0].body[0];
    expect(code).toMatch(/^\d{6}$/);

    // Wrong first — the attempt counts and the code survives.
    expect((await checkVerification(id, "000000")).status).toBe("wrong");
    const ok = await checkVerification(id, code);
    expect(ok).toEqual({ status: "ok", phone: TEL });
    // Single use.
    expect((await checkVerification(id, code)).status).toBe("wrong");
  });

  test("the capability says so when whatsapp is off underneath it", () => {
    writeServerConfig({ whatsappOn: false });
    const state = resolveCapabilities().signup;
    expect(state.enabled).toBe(false);
    if (!state.enabled) expect(state.reason).toContain("whatsapp");
  });
});

describe("channel: whatsapp on POST /api/auth/request", () => {
  function request(body: Record<string, unknown>) {
    return authRequestPOST(
      new Request("https://t.test/api/auth/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  test("sends the owner's code over WhatsApp, and the code signs them in", async () => {
    writeUserConfig({ tel: TEL, telProvenAt: "2026-09-10T00:00:00Z" });
    const response = await request({
      user: OWNER,
      email: OWNER_EMAIL,
      kind: "agent",
      channel: "whatsapp",
    });
    expect(response.status).toBe(202);

    const sent = payloads(path.join(OWNER, "whatsapp"));
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(TEL);
    const code = sent[0].body[0];

    const verify = await authVerifyPOST(
      new Request("https://t.test/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: OWNER, email: OWNER_EMAIL, code, kind: "agent" }),
      }),
    );
    expect(verify.status).toBe(200);
  });

  test("anybody else gets the silent 202 and nothing is sent or revoked", async () => {
    writeUserConfig({ tel: TEL, telProvenAt: "2026-09-10T00:00:00Z" });
    const response = await request({
      user: OWNER,
      email: "somebody-else@example.test",
      channel: "whatsapp",
    });
    expect(response.status).toBe(202);
    expect(payloads(path.join(OWNER, "whatsapp"))).toHaveLength(0);
  });

  test("an owner without a proven number gets the same silent 202", async () => {
    // `tel` present but never proven — B1064's distinction.
    writeUserConfig({ tel: TEL });
    const response = await request({
      user: OWNER,
      email: OWNER_EMAIL,
      channel: "whatsapp",
    });
    expect(response.status).toBe(202);
    expect(payloads(path.join(OWNER, "whatsapp"))).toHaveLength(0);
  });

  test("a server without whatsapp refuses before issuing anything", async () => {
    writeServerConfig({ whatsappOn: false });
    writeUserConfig({ tel: TEL, telProvenAt: "2026-09-10T00:00:00Z" });
    const response = await request({
      user: OWNER,
      email: OWNER_EMAIL,
      channel: "whatsapp",
    });
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string }).error).toBe("whatsapp_disabled");
  });
});
