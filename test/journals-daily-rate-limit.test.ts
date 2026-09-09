import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST } from "@/app/api/v1/journals/route";
import { clearConfigCache } from "@/lib/config";
import { balanceOf } from "@/lib/credits";
import { clearUserCache, getUser } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { NO_JOURNAL, issueCode, markPhoneProven, resolveSession, verifyCode } from "@/lib/auth";
import { checkVerification, startVerification } from "@/lib/phoneVerify";

/**
 * B834 — the hourly budget resets, the daily one does not.
 *
 * `test/journals-rate-limit.test.ts` covers the hourly cap: five journals an
 * hour from one address. That budget is spent per-hour, so an address that
 * simply waits out each window can keep making journals — and each one mints
 * `SIGNUP_CREDIT_GRANT` credits — forever, at five an hour. `CREATED_DAILY`
 * in the route is the second budget that catches exactly that: it shares the
 * same event (a successful creation) but counts over a day instead of an
 * hour, so spacing creations out to dodge the hourly cap still runs into it.
 *
 * Real time cannot be waited out in a test, so the clock is faked: each batch
 * of five journals is followed by advancing just past an hour, which resets
 * `CREATED` but leaves `CREATED_DAILY`'s 24-hour window holding all of them.
 */

let dir: string;
let emailCounter = 0;

async function signupToken(): Promise<string> {
  emailCounter += 1;
  const email = `farmer${emailCounter}@example.test`;
  const { code } = await issueCode(NO_JOURNAL, email, "signup");
  const result = await verifyCode(NO_JOURNAL, email, code, "signup");
  if (!result.ok) throw new Error("could not mint a signup token");

  // B1065 requires a proven number too — driven directly, as in
  // test/signup-token.test.ts, since this suite is not testing that step.
  const tel = `417604${String(emailCounter).padStart(5, "0")}`;
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

function create(ip: string, token: string, username: string) {
  return POST(
    new Request("https://example.test/api/v1/journals", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({
        username,
        title: "A journal",
        ownerName: "Robin Traveller",
        ownerNickname: "Robin",
        visibility: "public",
        defaultLocale: "en",
        locales: ["en"],
        baseCurrency: "CHF",
      }),
    }),
  );
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-journal-daily-limits-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "auth.db")}`;
  process.env.SESSION_SECRET = "b834-test-secret-b834-test-secret";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: [] },
      features: { signup: { enabled: true }, auth: { enabled: true }, credits: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());

  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-08T00:00:00Z"));
});

afterEach(async () => {
  vi.useRealTimers();
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the daily budget on journal creation", () => {
  test("an address that spaces creations out to dodge the hourly cap still runs into the daily one", async () => {
    const ip = "203.0.113.50";
    let made = 0;

    // Three batches of five, an hour and a bit apart, each resetting the
    // hourly cap but staying inside one 24-hour window.
    for (let batch = 0; batch < 3; batch++) {
      for (let i = 0; i < 5; i++) {
        const token = await signupToken();
        const res = await create(ip, token, `farm-${batch}-${i}`);
        expect(res.status, `batch ${batch} #${i}`).toBe(201);
        made += 1;
      }
      vi.advanceTimersByTime(61 * 60 * 1000);
    }

    expect(made).toBe(15);

    // The hourly cap has just reset (61 minutes since the last batch), so
    // without the daily budget this sixteenth creation would succeed too.
    const token = await signupToken();
    const blocked = await create(ip, token, "farm-16th");
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { reason?: string; message?: string };
    expect(body.reason).toBe("journals_created_daily");
    expect(body.message).toContain("created 15 journals in the last day");
    expect(getUser("farm-16th")).toBeNull();
  });

  /**
   * The acceptance line the ticket asks for explicitly: a fix here must not
   * refuse an honest, first-time signup. A single journal from a fresh
   * address, nowhere near either budget, still succeeds and still gets the
   * signup grant.
   */
  test("an honest first-time signup from a fresh address still succeeds and still gets its grant", async () => {
    const token = await signupToken();
    const res = await create("203.0.113.99", token, "first-timer");
    expect(res.status).toBe(201);
    expect(getUser("first-timer")).not.toBeNull();
    expect(await balanceOf("first-timer")).toBeGreaterThan(0);
  });
});
