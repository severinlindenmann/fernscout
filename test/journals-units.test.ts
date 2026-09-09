import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { POST } from "@/app/api/v1/journals/route";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache, getUser } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { NO_JOURNAL, issueCode, markPhoneProven, resolveSession, verifyCode } from "@/lib/auth";
import { checkVerification, startVerification } from "@/lib/phoneVerify";

/**
 * B553 — `units` is documented `metric | imperial`, and the handler used to
 * check only for the literal `"imperial"`: anything else, a typo like
 * `"Metric"` included, silently became `metric`. `visibility` and
 * `defaultLocale` on this same route already refuse an unrecognised value
 * rather than default it (see test/journals-required-fields.test.ts); `units`
 * now does the same.
 */

let dir: string;
let caller = 0;

let phoneCounter = 0;

/** B1065 requires a proven number too — driven directly, as in
 * test/signup-token.test.ts, since this suite is not testing that step. */
async function signupToken(email: string): Promise<string> {
  const { code } = await issueCode(NO_JOURNAL, email, "signup");
  const result = await verifyCode(NO_JOURNAL, email, code, "signup");
  if (!result.ok) throw new Error("could not mint a signup token");

  const tel = `417605${String(phoneCounter++).padStart(5, "0")}`;
  process.env.AUTH_DEV_CODE = "424242";
  const { id } = await startVerification(tel, "en");
  const proof = await checkVerification(id, "424242");
  delete process.env.AUTH_DEV_CODE;
  if (proof.status !== "ok") throw new Error("could not prove a phone number");
  const session = await resolveSession(result.token, "signup");
  if (!session) throw new Error("no session for the token just minted");
  await markPhoneProven(session.id, proof.phone);

  return result.token;
}

function create(token: string, body: Record<string, unknown>) {
  caller += 1;
  return POST(
    new Request("https://example.test/api/v1/journals", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-forwarded-for": `203.0.113.${150 + caller}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

const BASE = {
  title: "A journal",
  ownerName: "Robin Traveller",
  ownerNickname: "Robin",
  visibility: "public",
  defaultLocale: "en",
  locales: ["en"],
  // Required since B839 — the one field a journal can never change.
  baseCurrency: "CHF",
};

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-units-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "auth.db")}`;
  process.env.SESSION_SECRET = "b553-units-test-secret-b553-units-secret";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: [] },
      features: {
        signup: { enabled: true },
        auth: { enabled: true },
        mail: { enabled: true, transport: "file" },
      },
    }),
  );
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("units is refused rather than coerced", () => {
  test("a typo'd value is refused, not silently written as metric", async () => {
    const token = await signupToken("typo-units@example.test");
    const response = await create(token, { ...BASE, username: "typo-units-a", units: "Metric" });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string; message?: string };
    expect(body.error).toBe("invalid_request");
    expect(body.message).toMatch(/units must be "metric" or "imperial"/i);
    expect(getUser("typo-units-a")).toBeNull();
  });

  test("absent still defaults to metric", async () => {
    const token = await signupToken("no-units@example.test");
    const response = await create(token, { ...BASE, username: "no-units-b" });
    expect(response.status).toBe(201);
    expect(getUser("no-units-b")?.units).toBe("metric");
  });

  test("imperial is still accepted", async () => {
    const token = await signupToken("imperial-units@example.test");
    const response = await create(token, {
      ...BASE,
      username: "imperial-units-c",
      units: "imperial",
    });
    expect(response.status).toBe(201);
    expect(getUser("imperial-units-c")?.units).toBe("imperial");
  });
});
