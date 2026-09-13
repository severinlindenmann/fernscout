import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";

/**
 * B1622, phase 2 step 4 — the money long tail: the purchase door, the
 * credit ledger read, and the storage read, per
 * docs/plans/2026-09-12-api-v2/money.md §2.2, §2.3, §2.6.
 *
 * Fixture shape copied from test/api-v2-figures.test.ts and
 * test/api-v2-auth.test.ts: a throwaway CONTENT_DIR and sqlite db per test,
 * real tokens minted through the actual /api/auth/codes doors.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] }),
    set: (name: string, value: string) => {
      jar.cookies[name] = value;
    },
  }),
  headers: async () => ({ get: () => null }),
}));

const OWNER = "roams";
const CODE = "123456";
const TRIP = "alps-2026";
const TRAVELLER_EMAIL = "traveller@example.test";

let dir: string;
let calls = 0;
let OWNER_EMAIL: string;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.2.${calls % 250}`, ...extra };
}

async function ownerToken(): Promise<string> {
  const { POST: ask } = await import("@/app/api/auth/codes/route");
  await ask(
    new Request("https://example.test/api/auth/codes", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: OWNER, email: OWNER_EMAIL, for: "write" }),
    }),
  );
  const { POST: redeem } = await import("@/app/api/auth/codes/redeem/route");
  const response = await redeem(
    new Request("https://example.test/api/auth/codes/redeem", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: OWNER, email: OWNER_EMAIL, code: CODE, for: "write" }),
    }),
  );
  const body = (await response.json()) as { token: string };
  return body.token;
}

/** A trip-scoped token, for somebody who is not the owner. */
async function tripToken(): Promise<string> {
  const { POST: ask } = await import("@/app/api/auth/codes/route");
  await ask(
    new Request("https://example.test/api/auth/codes", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: OWNER, email: TRAVELLER_EMAIL, for: "write", scope: { trip: TRIP } }),
    }),
  );
  const { POST: redeem } = await import("@/app/api/auth/codes/redeem/route");
  const response = await redeem(
    new Request("https://example.test/api/auth/codes/redeem", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: OWNER, email: TRAVELLER_EMAIL, code: CODE, for: "write", scope: { trip: TRIP } }),
    }),
  );
  const body = (await response.json()) as { token: string };
  return body.token;
}

/** A cookie-based owner session, for the /api/web doors that refuse a
 *  bearer token outright. */
async function ownerCookie(): Promise<void> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "guest");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "guest");
  if (!result.ok) throw new Error("no owner cookie");
  jar.cookies.fs_session = result.token;
}

function req(url: string, init: RequestInit & { token?: string } = {}): Request {
  const { token, ...rest } = init;
  const h = new Headers(rest.headers);
  h.set("content-type", "application/json");
  // A fresh address per call — the routes rate-limit by IP, and a shared
  // (unset) address would make one test's calls exhaust a later test's
  // budget in this file's single process.
  h.set("x-forwarded-for", `10.9.3.${(calls += 1) % 250}`);
  if (token) h.set("authorization", `Bearer ${token}`);
  return new Request(url, { ...rest, headers: h });
}

function mailFiles(): string[] {
  const d = path.join(dir, "mail", OWNER);
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".eml")) : [];
}

beforeEach(async () => {
  jar.cookies = {};
  OWNER_EMAIL = `owner-${process.hrtime.bigint()}@example.test`;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-v2-money-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "44".repeat(32);
  process.env.AUTH_DEV_CODE = CODE;

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
  fs.mkdirSync(path.join(dir, OWNER, "trips", TRIP, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "trips", TRIP, "trip.md"),
    [
      "---",
      `id: "${TRIP}"`,
      'title: "Alps"',
      'start: "2026-01-01"',
      'end: "2026-01-05"',
      'status: "past"',
      'visibility: "private"',
      "people:",
      '  - name: "Robin"',
      `    email: "${OWNER_EMAIL}"`,
      '  - name: "Traveller"',
      `    email: "${TRAVELLER_EMAIL}"`,
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Roams's journal",
      owner: { name: "Robin Traveller", nickname: "Robin", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { auth: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  for (const k of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "SESSION_SECRET", "AUTH_DEV_CODE"]) {
    delete process.env[k];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("PUT /api/v2/{user}/purchases/{id} — the purchase door", () => {
  test("files a pending row and answers a URL, charging nothing", async () => {
    const token = await ownerToken();
    const { balanceOf } = await import("@/lib/credits");
    const before = (await balanceOf(OWNER)) ?? 0;
    const mailBefore = mailFiles().length;

    const { PUT } = await import("@/app/api/v2/[user]/purchases/[id]/route");
    const response = await PUT(
      req(`https://example.test/api/v2/${OWNER}/purchases/top-up-1`, {
        method: "PUT",
        token,
        body: JSON.stringify({ credits: 100 }),
      }),
      { params: Promise.resolve({ user: OWNER, id: "top-up-1" }) },
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe("pending");
    expect(body.credits).toBe(100);
    expect(typeof body.paymentUrl).toBe("string");
    expect((body.paymentUrl as string).startsWith("https://example.test/")).toBe(true);
    expect(response.headers.get("etag")).toBeTruthy();

    // Nothing bought — the whole point.
    expect(await balanceOf(OWNER)).toBe(before);
    expect(mailFiles().length).toBe(mailBefore + 1);
  });

  test("a retried PUT with the same id and amount is a no-op re-read — no second mail", async () => {
    const token = await ownerToken();
    const mailBefore = mailFiles().length;
    const { PUT } = await import("@/app/api/v2/[user]/purchases/[id]/route");
    const call = () =>
      PUT(
        req(`https://example.test/api/v2/${OWNER}/purchases/top-up-2`, {
          method: "PUT",
          token,
          body: JSON.stringify({ credits: 50 }),
        }),
        { params: Promise.resolve({ user: OWNER, id: "top-up-2" }) },
      );

    const first = await call();
    expect(first.status).toBe(201);
    expect(mailFiles().length).toBe(mailBefore + 1);

    const second = await call();
    expect(second.status).toBe(200);
    expect(mailFiles().length).toBe(mailBefore + 1);
  });

  test("the same id with a different amount is a conflict naming the stored document", async () => {
    const token = await ownerToken();
    const { PUT } = await import("@/app/api/v2/[user]/purchases/[id]/route");
    await PUT(
      req(`https://example.test/api/v2/${OWNER}/purchases/top-up-3`, {
        method: "PUT",
        token,
        body: JSON.stringify({ credits: 50 }),
      }),
      { params: Promise.resolve({ user: OWNER, id: "top-up-3" }) },
    );

    const again = await PUT(
      req(`https://example.test/api/v2/${OWNER}/purchases/top-up-3`, {
        method: "PUT",
        token,
        body: JSON.stringify({ credits: 200 }),
      }),
      { params: Promise.resolve({ user: OWNER, id: "top-up-3" }) },
    );
    expect(again.status).toBe(409);
    const body = (await again.json()) as { error: string; details?: { current?: { credits: number } } };
    expect(body.error).toBe("conflict");
    expect(body.details?.current?.credits).toBe(50);
  });

  test("dryRun writes nothing — no row, no mail", async () => {
    const token = await ownerToken();
    const mailBefore = mailFiles().length;
    const { PUT } = await import("@/app/api/v2/[user]/purchases/[id]/route");
    const response = await PUT(
      req(`https://example.test/api/v2/${OWNER}/purchases/preview-1?dryRun=true`, {
        method: "PUT",
        token,
        body: JSON.stringify({ credits: 100 }),
      }),
      { params: Promise.resolve({ user: OWNER, id: "preview-1" }) },
    );
    expect(response.status).toBe(201);
    expect(mailFiles().length).toBe(mailBefore);

    const { getPayment } = await import("@/lib/payments");
    expect(await getPayment(OWNER, "preview-1")).toBeNull();
  });

  test("a trip-scoped token cannot propose a purchase", async () => {
    const token = await tripToken();
    const { PUT } = await import("@/app/api/v2/[user]/purchases/[id]/route");
    const response = await PUT(
      req(`https://example.test/api/v2/${OWNER}/purchases/top-up-4`, {
        method: "PUT",
        token,
        body: JSON.stringify({ credits: 100 }),
      }),
      { params: Promise.resolve({ user: OWNER, id: "top-up-4" }) },
    );
    expect(response.status).toBe(403);
    const { getPayment } = await import("@/lib/payments");
    expect(await getPayment(OWNER, "top-up-4")).toBeNull();
  });

  test("no bearer token at all is refused", async () => {
    const { PUT } = await import("@/app/api/v2/[user]/purchases/[id]/route");
    const response = await PUT(
      req(`https://example.test/api/v2/${OWNER}/purchases/top-up-5`, {
        method: "PUT",
        body: JSON.stringify({ credits: 100 }),
      }),
      { params: Promise.resolve({ user: OWNER, id: "top-up-5" }) },
    );
    expect(response.status).toBe(401);
  });
});

describe("GET /api/v2/{user}/purchases — reading the history", () => {
  test("the list carries what PUT filed, and the single GET matches with an ETag", async () => {
    const token = await ownerToken();
    const { PUT } = await import("@/app/api/v2/[user]/purchases/[id]/route");
    await PUT(
      req(`https://example.test/api/v2/${OWNER}/purchases/hist-1`, { method: "PUT", token, body: JSON.stringify({ credits: 30 }) }),
      { params: Promise.resolve({ user: OWNER, id: "hist-1" }) },
    );

    const { GET: listGet } = await import("@/app/api/v2/[user]/purchases/route");
    const listResponse = await listGet(req(`https://example.test/api/v2/${OWNER}/purchases`, { token }), {
      params: Promise.resolve({ user: OWNER }),
    });
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as { purchases: { id: string }[] };
    expect(list.purchases.some((p) => p.id === "hist-1")).toBe(true);

    const { GET: oneGet } = await import("@/app/api/v2/[user]/purchases/[id]/route");
    const oneResponse = await oneGet(req(`https://example.test/api/v2/${OWNER}/purchases/hist-1`, { token }), {
      params: Promise.resolve({ user: OWNER, id: "hist-1" }),
    });
    expect(oneResponse.status).toBe(200);
    expect(oneResponse.headers.get("etag")).toBeTruthy();
    const one = (await oneResponse.json()) as { credits: number };
    expect(one.credits).toBe(30);
  });

  test("a trip-scoped token may not read the journal's own purchase history", async () => {
    const token = await tripToken();
    const { GET } = await import("@/app/api/v2/[user]/purchases/route");
    const response = await GET(req(`https://example.test/api/v2/${OWNER}/purchases`, { token }), {
      params: Promise.resolve({ user: OWNER }),
    });
    expect(response.status).toBe(403);
  });
});

describe("GET /api/v2/{user}/credits/ledger — reads back what was filed", () => {
  test("a grant appears on the ledger the owner reads", async () => {
    const token = await ownerToken();
    const { grant } = await import("@/lib/credits");
    await grant(OWNER, 25, "welcome");

    const { GET } = await import("@/app/api/v2/[user]/credits/ledger/route");
    const response = await GET(req(`https://example.test/api/v2/${OWNER}/credits/ledger`, { token }), {
      params: Promise.resolve({ user: OWNER }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ledger: { reason: string; delta: number }[] };
    expect(body.ledger.some((row) => row.reason === "grant" && row.delta === 25)).toBe(true);
  });

  test("a trip-scoped token may not read the ledger", async () => {
    const token = await tripToken();
    const { GET } = await import("@/app/api/v2/[user]/credits/ledger/route");
    const response = await GET(req(`https://example.test/api/v2/${OWNER}/credits/ledger`, { token }), {
      params: Promise.resolve({ user: OWNER }),
    });
    expect(response.status).toBe(403);
  });
});

describe("GET /api/v2/{user}/storage — real numbers, narrowed by scope", () => {
  test("an owner token sees the full breakdown", async () => {
    const token = await ownerToken();
    const { GET } = await import("@/app/api/v2/[user]/storage/route");
    const response = await GET(req(`https://example.test/api/v2/${OWNER}/storage`, { token }), {
      params: Promise.resolve({ user: OWNER }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      usedBytes: number;
      limitBytes: number | null;
      extension: { credits: number; addsBytes: number };
      breakdown: { key: string }[];
    };
    expect(typeof body.usedBytes).toBe("number");
    expect(body.extension.credits).toBeGreaterThan(0);
    expect(body.breakdown.some((row) => row.key === `trip:${TRIP}`)).toBe(true);
  });

  test("a trip-scoped token sees its own trip and an `other` catch-all, never another trip's row", async () => {
    fs.mkdirSync(path.join(dir, OWNER, "trips", "other-trip", "entries"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, OWNER, "trips", "other-trip", "trip.md"),
      [
        "---",
        'id: "other-trip"',
        'title: "Other"',
        'start: "2026-02-01"',
        'end: "2026-02-05"',
        'status: "past"',
        'visibility: "private"',
        "people:",
        '  - name: "Robin"',
        `    email: "${OWNER_EMAIL}"`,
        "---",
        "",
        "Some prose so the file is not zero bytes.",
        "",
      ].join("\n"),
    );
    const token = await tripToken();
    const { GET } = await import("@/app/api/v2/[user]/storage/route");
    const response = await GET(req(`https://example.test/api/v2/${OWNER}/storage`, { token }), {
      params: Promise.resolve({ user: OWNER }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { breakdown: { key: string }[] };
    expect(body.breakdown.some((row) => row.key === "trip:other-trip")).toBe(false);
  });
});

describe("PUT /api/web/{user}/storage/purchases/{id} — the owner's own spend", () => {
  test("a bearer token is refused outright, whatever it is scoped to", async () => {
    const token = await ownerToken();
    const { PUT } = await import("@/app/api/web/[user]/storage/purchases/[id]/route");
    const response = await PUT(
      req(`https://example.test/api/web/${OWNER}/storage/purchases/s-1`, { method: "PUT", token }),
      { params: Promise.resolve({ user: OWNER, id: "s-1" }) },
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("not_for_agents");
  });

  test("the owner's own cookie spends once per id, and a retry does not spend again", async () => {
    await ownerCookie();
    const { grant, balanceOf } = await import("@/lib/credits");
    await grant(OWNER, 200);
    const before = (await balanceOf(OWNER)) ?? 0;

    const { PUT } = await import("@/app/api/web/[user]/storage/purchases/[id]/route");
    const call = () =>
      PUT(new Request(`https://example.test/api/web/${OWNER}/storage/purchases/s-2`, { method: "PUT" }), {
        params: Promise.resolve({ user: OWNER, id: "s-2" }),
      });

    const first = await call();
    expect(first.status).toBe(200);
    const { EXTRA_STORAGE_CREDITS } = await import("@/lib/credits/pricing");
    expect(await balanceOf(OWNER)).toBe(before - EXTRA_STORAGE_CREDITS);

    const second = await call();
    expect(second.status).toBe(200);
    expect(await balanceOf(OWNER)).toBe(before - EXTRA_STORAGE_CREDITS);
  });
});

describe("the invariant: no route in this area can raise a balance", () => {
  test("none of the v2/web money routes import grant from lib/credits", async () => {
    const files = [
      "app/api/v2/[user]/purchases/route.ts",
      "app/api/v2/[user]/purchases/[id]/route.ts",
      "app/api/v2/[user]/credits/ledger/route.ts",
      "app/api/v2/[user]/storage/route.ts",
      "app/api/web/[user]/purchases/[id]/route.ts",
      "app/api/web/[user]/purchases/[id]/pay/route.ts",
      "app/api/web/[user]/storage/purchases/[id]/route.ts",
      "app/api/web/[user]/storage/cleanup/route.ts",
      "app/api/web/admin/grants/route.ts",
    ];
    for (const rel of files) {
      const source = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
      for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*credits["']/g)) {
        const named = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim());
        expect(named, `${rel} must not import grant`).not.toContain("grant");
      }
    }
    // The one file in this area allowed to — the approve door, mailed only
    // to the operator, spending a single-use token atomically claimed. This
    // mirrors test/credits.test.ts's GRANT_ALLOWED rather than duplicating
    // its reasoning.
    const approve = fs.readFileSync(
      path.join(process.cwd(), "app/api/web/[user]/purchases/[id]/approve/[token]/route.ts"),
      "utf8",
    );
    expect(approve).toMatch(/import\s*\{[^}]*\bgrant\b[^}]*\}\s*from\s*["'][^"']*credits["']/);
  });
});
