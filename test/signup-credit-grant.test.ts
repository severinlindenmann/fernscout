import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { POST } from "@/app/api/v1/journals/route";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { balanceOf, ledgerFor, SIGNUP_CREDIT_GRANT } from "@/lib/credits";
import { POSTCARD_CREDITS, photobookCredits } from "@/lib/credits/pricing";
import { closeDatabase, getDatabase } from "@/lib/db";
import { NO_JOURNAL, issueCode, verifyCode } from "@/lib/auth";

/**
 * B688 — the free grant on signup, so the first trip costs nothing.
 *
 * Mirrors `test/signup-token.test.ts`'s harness rather than duplicating it: a
 * signup token, spent once, against the real route.
 */

let dir: string;

async function signupToken(email: string): Promise<string> {
  const { code } = await issueCode(NO_JOURNAL, email, "signup");
  const result = await verifyCode(NO_JOURNAL, email, code, "signup");
  if (!result.ok) throw new Error("could not mint a signup token");
  return result.token;
}

let caller = 0;
function create(token: string, body: Record<string, unknown>) {
  caller += 1;
  return POST(
    new Request("https://example.test/api/v1/journals", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-forwarded-for": `203.0.113.${caller}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

const OWNER = "owner@example.test";
const GOOD = {
  title: "A journal",
  ownerName: "Robin Traveller",
  ownerNickname: "Robin",
  visibility: "public",
  defaultLocale: "en",
  locales: ["en"],
};

async function setup(creditsOn: boolean): Promise<void> {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-signup-grant-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "auth.db")}`;
  process.env.SESSION_SECRET = "b688-test-secret-b688-test-secret";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: ["admin"] },
      features: {
        signup: { enabled: true },
        auth: { enabled: true },
        credits: { enabled: creditsOn },
      },
    }),
  );
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
}

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the free grant on signup", () => {
  beforeEach(() => setup(true));

  test("gives a new journal SIGNUP_CREDIT_GRANT credits, once", async () => {
    const token = await signupToken(OWNER);
    const response = await create(token, { ...GOOD, username: "wanderer" });
    expect(response.status).toBe(201);

    expect(await balanceOf("wanderer")).toBe(SIGNUP_CREDIT_GRANT);
    const ledger = await ledgerFor("wanderer");
    expect(ledger.filter((row) => row.reason === "grant")).toHaveLength(1);
  });

  test("grants nothing to a refused creation", async () => {
    const token = await signupToken(OWNER);
    // "admin" is reserved, so this is refused before a journal ever exists.
    const refused = await create(token, { ...GOOD, username: "admin" });
    expect(refused.status).toBe(400);
    expect(await balanceOf("admin")).toBe(0); // no journal, no row, no grant
  });
});

describe("the free grant, with credits off", () => {
  beforeEach(() => setup(false));

  test("writes no ledger row — the switch stays absent rather than broken", async () => {
    const token = await signupToken(OWNER);
    const response = await create(token, { ...GOOD, username: "wanderer" });
    expect(response.status).toBe(201);

    // creditsEnabled() is false, so balanceOf reports "no such number" too.
    expect(await balanceOf("wanderer")).toBe(null);
  });
});

/**
 * The one property that decides how large the welcome may be — B688.
 *
 * Signing up is self-service: an email address and a six-digit code, five an
 * hour per IP. So whatever a new journal is given, anybody willing to hold a
 * throwaway inbox can mint. That is harmless while it buys only things this
 * server computes, and stops being harmless the moment it reaches something a
 * printer sends the operator an invoice for.
 *
 * This test is here because the failure is silent and arrives as a bill: the
 * grant is exactly the number somebody raises to be more welcoming, and
 * nothing about raising it looks like opening a way to spend somebody else's
 * money.
 */
describe("the signup grant cannot buy anything physical", () => {
  test("is strictly less than a posted postcard", () => {
    expect(SIGNUP_CREDIT_GRANT).toBeLessThan(POSTCARD_CREDITS);
  });

  test("is strictly less than the smallest photobook", () => {
    expect(SIGNUP_CREDIT_GRANT).toBeLessThan(photobookCredits(20, "a5"));
  });
});
