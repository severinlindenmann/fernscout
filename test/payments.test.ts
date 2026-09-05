import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * B405 — the mock payment flow. The property behind every assertion: pressing
 * Pay records a transaction and adds NO credits. `test/credits.test.ts` proves
 * `grant` is unreachable from `app/` at all; this proves the pay route, the one
 * that most looks like it should credit an account, leaves the balance and the
 * ledger exactly where they were.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const OTHER = "bob";

let dir: string;
let calls = 0;
function ip(): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.0.9.${calls % 250}` };
}

function mailFiles(user = OWNER): string[] {
  const d = path.join(dir, user, "mail");
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".eml")) : [];
}

async function payRoute(user: string, id: string, body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/v1/[user]/payments/[id]/pay/route");
  const response = await POST(
    new Request(`https://example.test/api/v1/${user}/payments/${id}/pay`, {
      method: "POST",
      headers: ip(),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user, id }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function writeJournal(user: string, email: string) {
  fs.mkdirSync(path.join(dir, user, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, user, "config.json"),
    JSON.stringify({
      title: `${user}'s journal`,
      tagline: "t",
      owner: { name: "A A", nickname: "A", email },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true } },
    }),
  );
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-payments-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "88".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, credits: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );
  writeJournal(OWNER, OWNER_EMAIL);
  writeJournal(OTHER, "bob@example.test");

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
  for (const k of ["CONTENT_DIR", "DATABASE_URL", "SESSION_SECRET"]) delete process.env[k];
  fs.rmSync(dir, { recursive: true, force: true });
});

async function newPending(owner = OWNER) {
  const { createPayment } = await import("@/lib/payments");
  const { tierFor } = await import("@/lib/credits/pricing");
  const p = await createPayment(owner, tierFor("100")!);
  if (!p) throw new Error("no payment");
  return p;
}

describe("getPayment is scoped to its journal", () => {
  test("another journal's id does not resolve under this journal", async () => {
    const { getPayment } = await import("@/lib/payments");
    const p = await newPending(OWNER);
    expect(await getPayment(OWNER, p.id)).not.toBeNull();
    // Same id, wrong owner → nothing, same as a nonexistent id.
    expect(await getPayment(OTHER, p.id)).toBeNull();
    expect(await getPayment(OWNER, "does-not-exist")).toBeNull();
  });
});

describe("paying records a transaction and adds no credits", () => {
  test("pending → paid, one receipt, balance and ledger untouched", async () => {
    const { grant, balanceOf, ledgerFor } = await import("@/lib/credits");
    await grant(OWNER, 7, "starting");
    const balanceBefore = await balanceOf(OWNER);
    const ledgerBefore = await ledgerFor(OWNER);

    const p = await newPending(OWNER);
    const before = mailFiles().length;
    const res = await payRoute(OWNER, p.id, { method: "twint" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("paid");
    expect(res.body.creditsAdded).toBe(0);
    expect(mailFiles()).toHaveLength(before + 1); // one receipt
    // The whole point:
    expect(await balanceOf(OWNER)).toBe(balanceBefore);
    expect(await ledgerFor(OWNER)).toEqual(ledgerBefore);
  });

  test("paying again sends no second receipt and still adds nothing", async () => {
    const { balanceOf } = await import("@/lib/credits");
    const p = await newPending(OWNER);
    await payRoute(OWNER, p.id, { method: "card" });
    const balanceMid = await balanceOf(OWNER);
    const mailMid = mailFiles().length;

    const again = await payRoute(OWNER, p.id, { method: "card" });
    expect(again.status).toBe(200);
    expect(again.body.alreadyPaid).toBe(true);
    expect(mailFiles()).toHaveLength(mailMid); // no second receipt
    expect(await balanceOf(OWNER)).toBe(balanceMid);
  });

  test("a bad method is refused and pays nothing", async () => {
    const { getPayment } = await import("@/lib/payments");
    const p = await newPending(OWNER);
    const res = await payRoute(OWNER, p.id, { method: "bitcoin" });
    expect(res.status).toBe(400);
    expect((await getPayment(OWNER, p.id))?.status).toBe("pending");
  });

  test("an unknown or foreign id is 404, the same for both", async () => {
    const unknown = await payRoute(OWNER, "no-such-id", { method: "twint" });
    expect(unknown.status).toBe(404);
    const p = await newPending(OTHER);
    // OTHER's id driven under OWNER's path → 404, not a cross-journal pay.
    const foreign = await payRoute(OWNER, p.id, { method: "twint" });
    expect(foreign.status).toBe(404);
    const { getPayment } = await import("@/lib/payments");
    expect((await getPayment(OTHER, p.id))?.status).toBe("pending"); // untouched
  });
});
