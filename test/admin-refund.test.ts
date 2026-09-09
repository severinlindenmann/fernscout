import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * B878 — the operator records a refund, and three things follow.
 *
 * The money is not one of them: this route never calls a payment provider, and
 * the properties worth holding are about the row, the balance and the second
 * press. In particular the *floor*: a journal that has spent what it bought
 * gives back what is left and never goes negative, because `spend`'s
 * `balance >= n` guard is the only thing standing between a balance and a
 * free send, and a negative balance would put it in charge of a state nobody
 * wrote it for.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const ADMIN_EMAIL = "operator@example.test";

const jar: { cookies: Record<string, string> } = { cookies: {} };
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
    set: () => {},
  }),
}));

let dir: string;
let calls = 0;

async function refundRoute(body: Record<string, unknown>) {
  calls += 1;
  const { POST } = await import("@/app/api/admin/refunds/route");
  const response = await POST(
    new Request("https://example.test/api/admin/refunds", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.3.0.${calls % 250}` },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** A settled purchase, the way the approval path leaves one. */
async function paidPurchase(credits: number): Promise<string> {
  const { createPayment, submitRequest, claimApproval } = await import("@/lib/payments");
  const { priceRappen } = await import("@/lib/credits/pricing");
  const payment = await createPayment(OWNER, credits, priceRappen(credits));
  if (!payment) throw new Error("no payment");
  const submitted = await submitRequest(OWNER, payment.id, "twint");
  if (!submitted.ok) throw new Error("submit failed");
  const claim = await claimApproval(OWNER, payment.id, submitted.token);
  if (!claim.ok) throw new Error("claim failed");
  const { grant } = await import("@/lib/credits");
  await grant(OWNER, claim.credits, `purchase ${payment.id}`);
  return payment.id;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-admin-refund-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "77".repeat(32);
  process.env.FERNSCOUT_ADMIN_EMAIL = ADMIN_EMAIL;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER, operatorEmail: ADMIN_EMAIL },
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
      owner: { name: "Ana A", nickname: "Ana", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
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

  // The operator's own browser: an identity cookie bound to the admin address.
  const { openIdentitySession } = await import("@/lib/auth");
  const identity = await openIdentitySession(ADMIN_EMAIL);
  jar.cookies.fs_identity = identity.token;
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.FERNSCOUT_ADMIN_EMAIL;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("recording a refund", () => {
  test("takes the credits back, marks the row, mails the buyer, and does nothing twice", async () => {
    const { balanceOf, ledgerFor } = await import("@/lib/credits");
    const { getPayment } = await import("@/lib/payments");
    const id = await paidPurchase(50);
    const before = (await balanceOf(OWNER)) ?? 0;

    const first = await refundRoute({ user: OWNER, payment: id });
    expect(first.status).toBe(200);
    expect(first.body.creditsTaken).toBe(50);
    expect(first.body.shortfall).toBe(0);
    expect((await balanceOf(OWNER)) ?? 0).toBe(before - 50);
    expect((await getPayment(OWNER, id))?.status).toBe("refunded");

    // One ledger row, and it is not a spend.
    const rows = await ledgerFor(OWNER, 5);
    expect(rows[0]).toMatchObject({ delta: -50, reason: "purchase_refund", ref: `refund ${id}` });

    // The buyer is told, in their own mailbox.
    const box = path.join(dir, "mail", OWNER);
    expect(fs.readdirSync(box).some((f) => f.includes("refunded"))).toBe(true);

    // A second press changes nothing at all.
    const balance = await balanceOf(OWNER);
    const again = await refundRoute({ user: OWNER, payment: id });
    expect(again.status).toBe(409);
    expect(await balanceOf(OWNER)).toBe(balance);
  });

  test("never takes a balance below zero — it gives back what is left", async () => {
    const { balanceOf, spend } = await import("@/lib/credits");
    const id = await paidPurchase(100);
    const balance = (await balanceOf(OWNER)) ?? 0;
    // Spend everything, so the refund has less than it sold to take back.
    expect(await spend(OWNER, balance - 10, "day_whatsapp", "ana/t/x")).toBe(true);

    const result = await refundRoute({ user: OWNER, payment: id });
    expect(result.body.creditsTaken).toBe(10);
    expect(result.body.shortfall).toBe(90);
    expect(await balanceOf(OWNER)).toBe(0);
  });

  test("a browser that is not the operator's is told there is no such route", async () => {
    const kept = jar.cookies.fs_identity;
    delete jar.cookies.fs_identity;
    const id = await paidPurchase(50);
    const result = await refundRoute({ user: OWNER, payment: id });
    expect(result.status).toBe(404);
    jar.cookies.fs_identity = kept;
    const { getPayment } = await import("@/lib/payments");
    expect((await getPayment(OWNER, id))?.status).toBe("paid");
  });
});
