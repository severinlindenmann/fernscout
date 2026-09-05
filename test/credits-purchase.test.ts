import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

/**
 * B368's front half of "buy credits" — the route mails, and grants nothing.
 *
 * The property every assertion circles: a `200` from this route is a mail
 * sent, never a balance changed. `test/credits.test.ts` already proves the
 * grant path is unreachable from `app/` at all; this proves the one route
 * that *could* have reached it does not, even indirectly, and behaves the
 * same for every non-owner caller regardless of how they are signed in.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
  }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const GUEST_EMAIL = "guest@example.test";
const TRAVELLER_EMAIL = "traveller@example.test";

let dir: string;
/** One IP per call: `lib/rateLimit.ts` is a module-level map shared by the
 * whole file, so a shared address would make a later call fail for a reason
 * unrelated to what is being tested. */
let calls = 0;
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.0.1.${calls % 250}`, ...extra };
}

function as(token: string | null) {
  jar.cookies = {};
  if (token) jar.cookies.fs_session = token;
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

/** A guest cookie session for somebody who is not the owner. */
async function guestToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, GUEST_EMAIL, "guest");
  const result = await verifyCode(OWNER, GUEST_EMAIL, code, "guest");
  if (!result.ok) throw new Error("no guest session");
  return result.token;
}

/** An agent token scoped to one trip, for somebody who is not the owner. */
async function travellerToken(): Promise<string> {
  const { issueCode, verifyCode, tripWriteScope } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, TRAVELLER_EMAIL, "agent", { trip: "a-trip" });
  const result = await verifyCode(OWNER, TRAVELLER_EMAIL, code, "agent", tripWriteScope("a-trip"));
  if (!result.ok) throw new Error("no traveller token");
  return result.token;
}

async function purchase(
  body: Record<string, unknown>,
  bearer?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { POST } = await import("@/app/api/v1/[user]/credits/purchase/route");
  const response = await POST(
    new Request(`https://example.test/api/v1/${OWNER}/credits/purchase`, {
      method: "POST",
      headers: headers(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function mailFiles(): string[] {
  const mailDir = path.join(dir, OWNER, "mail");
  if (!fs.existsSync(mailDir)) return [];
  return fs.readdirSync(mailDir).filter((f) => f.endsWith(".eml"));
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-credits-purchase-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "88".repeat(32);
  delete process.env.AUTH_DEV_CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        credits: { enabled: true },
        mail: { enabled: true, transport: "file" },
      },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Ana's journal",
      tagline: "t",
      owner: { name: "Ana A", nickname: "Ana", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true } },
    }),
  );

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "SESSION_SECRET", "AUTH_DEV_CODE"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("who may ask", () => {
  test("an unauthenticated caller gets 403 and nothing is sent", async () => {
    as(null);
    const before = mailFiles().length;
    const result = await purchase({ tier: "50" });
    expect(result.status).toBe(403);
    expect(mailFiles()).toHaveLength(before);
  });

  test("a guest (signed in, but not the owner) gets 403", async () => {
    as(await guestToken());
    const before = mailFiles().length;
    const result = await purchase({ tier: "50" });
    expect(result.status).toBe(403);
    expect(mailFiles()).toHaveLength(before);
    as(null);
  });

  test("a traveller (an agent token scoped to a trip, not the owner) gets 403", async () => {
    as(null);
    const before = mailFiles().length;
    const result = await purchase({ tier: "50" }, await travellerToken());
    expect(result.status).toBe(403);
    expect(mailFiles()).toHaveLength(before);
  });

  test("the owner gets 200", async () => {
    as(null);
    const result = await purchase({ tier: "50" }, await ownerToken());
    expect(result.status).toBe(200);
  });
});

describe("what a 200 actually does", () => {
  test("mails exactly one .eml, and leaves the balance and the ledger unchanged", async () => {
    const { grant, balanceOf, ledgerFor } = await import("@/lib/credits");
    await grant(OWNER, 10, "starting balance");
    const balanceBefore = await balanceOf(OWNER);
    const ledgerBefore = await ledgerFor(OWNER);
    const before = mailFiles().length;

    as(null);
    const result = await purchase({ tier: "100" }, await ownerToken());
    expect(result.status).toBe(200);

    expect(mailFiles()).toHaveLength(before + 1);
    expect(await balanceOf(OWNER)).toBe(balanceBefore);
    const ledgerAfter = await ledgerFor(OWNER);
    expect(ledgerAfter).toHaveLength(ledgerBefore.length);
    expect(ledgerAfter).toEqual(ledgerBefore);
  });

  test("an unknown tier is 400 and sends nothing", async () => {
    const before = mailFiles().length;
    as(null);
    const result = await purchase({ tier: "999" }, await ownerToken());
    expect(result.status).toBe(400);
    expect(mailFiles()).toHaveLength(before);
  });

  test("an absent tier is 400 and sends nothing", async () => {
    const before = mailFiles().length;
    as(null);
    const result = await purchase({}, await ownerToken());
    expect(result.status).toBe(400);
    expect(mailFiles()).toHaveLength(before);
  });

  test("the mail goes to config.json's owner address, even when the body names another", async () => {
    const before = mailFiles();
    as(null);
    const result = await purchase(
      { tier: "50", email: "somebody-else@example.test" },
      await ownerToken(),
    );
    expect(result.status).toBe(200);
    expect(result.body.mailedTo).toBe(OWNER_EMAIL);

    const written = mailFiles().filter((f) => !before.includes(f));
    expect(written).toHaveLength(1);
    const contents = fs.readFileSync(path.join(dir, OWNER, "mail", written[0]), "utf8");
    expect(contents).toContain(`To: ${OWNER_EMAIL}`);
    expect(contents).not.toContain("somebody-else@example.test");
  });
});
