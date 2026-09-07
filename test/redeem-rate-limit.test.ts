import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

/** No session on any of these calls — a link followed from a mail, same as
 * `test/trip-place-revival.test.ts`. */
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * B237 — a mistyped name or address on the redeem form used to spend one of
 * five slots per fifteen minutes, the same bucket a completed redemption
 * spent, before anything about the submission had been looked at. Two typed
 * addresses and a name corrected was three of the five, from one shared
 * router — a household following the same invitation within minutes of each
 * other, which this route exists to let through.
 *
 * Fixed by splitting the bucket the way B217 already splits journal
 * creation: `REDEEMED` (five per fifteen minutes) is spent only where a
 * redemption actually completes; `REFUSED` (twenty) is spent by everything
 * else, so a run of invented tokens still costs.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";

let dir: string;
let token: string;

/** Every call within one `describe` below comes from the same address on
 * purpose — that is the scenario the ticket is about. The two blocks use
 * different addresses so that one does not spend the other's budget:
 * `lib/rateLimit.ts` is a module-level map for the whole file. */
function headers(ip: string): Record<string, string> {
  return { "content-type": "application/json", "x-forwarded-for": ip };
}

async function redeem(
  ip: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: { status?: string; error?: string } }> {
  const { POST } = await import("@/app/api/contacts/redeem/route");
  const response = await POST(
    new Request("https://example.test/api/contacts/redeem", {
      method: "POST",
      headers: headers(ip),
      body: JSON.stringify({ user: OWNER, kind: "guest", token, ...body }),
    }),
  );
  return { status: response.status, body: (await response.json()) as { status?: string } };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-redeem-limit-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "77".repeat(32);
  process.env.SESSION_SECRET = "66".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        mail: { enabled: true, transport: "file" },
      },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        mail: { enabled: true, transport: "file" },
      },
    }),
  );

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());

  const { createInvite } = await import("@/lib/contacts/invites");
  const issued = await createInvite(OWNER, { kind: "guest" });
  token = issued.token;
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("correcting a mistake does not spend the completion budget", () => {
  const ip = "10.44.0.7";

  test("two mistyped addresses and a corrected one all go through, from one address", async () => {
    const bad1 = await redeem(ip, { email: "not-an-email", name: "Robin" });
    expect(bad1.status).toBe(400);
    expect(bad1.body.error).toBe("invalid_email");

    const bad2 = await redeem(ip, { email: "still-not-one", name: "Robin" });
    expect(bad2.status).toBe(400);
    expect(bad2.body.error).toBe("invalid_email");

    // The fix: this is the third call from the same address and it still
    // works — before B237 it would have been the third of five attempts
    // spent, one wrong code away from the limit.
    const good = await redeem(ip, { email: "robin@example.test", name: "Robin" });
    expect(good.status).toBe(202);
    expect(good.body.status).toBe("code");
  });

  test("real redemptions still run out, and the message says why", async () => {
    // One completion already spent by the previous test, from this same
    // address — four more reaches the five-per-window ceiling exactly.
    for (let i = 0; i < 4; i += 1) {
      const result = await redeem(ip, { email: `guest${i}@example.test`, name: `Guest ${i}` });
      expect(result.status).toBe(202);
    }
    const sixth = await redeem(ip, { email: "guest5@example.test", name: "Guest 5" });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toBe("too_many_requests");
  });
});

describe("a run of guessed tokens is still stopped", () => {
  const ip = "10.44.0.8";

  test("twenty invented tokens from one address exhaust the refusal budget", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 20; i += 1) {
      const result = await redeem(ip, { token: `invented-${i}`, email: "x@example.test", name: "X" });
      lastStatus = result.status;
    }
    expect(lastStatus).toBe(202); // "expired" — still not distinguishing a bad token

    const next = await redeem(ip, { token: "invented-final", email: "x@example.test", name: "X" });
    expect(next.status).toBe(429);
  });
});
