import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * B425 — a payment is a request the operator approves, and approving grants
 * the credits. The properties that matter:
 *   - pressing Pay grants nothing; it files a request and mails the OPERATOR
 *     (never the buying journal's owner) a single-use approval link.
 *   - approving with the token grants exactly the tier's credits, once; a
 *     second approve, or a wrong token, grants nothing.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const OPERATOR_EMAIL = "operator@example.test";

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
function readMail(user: string, file: string): string {
  return fs.readFileSync(path.join(dir, user, "mail", file), "utf8");
}

async function payRoute(user: string, id: string, body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/v1/[user]/payments/[id]/pay/route");
  const r = await POST(
    new Request(`https://example.test/api/v1/${user}/payments/${id}/pay`, {
      method: "POST",
      headers: ip(),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user, id }) },
  );
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}
async function approveRoute(user: string, id: string, body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/v1/[user]/payments/[id]/approve/route");
  const r = await POST(
    new Request(`https://example.test/api/v1/${user}/payments/${id}/approve`, {
      method: "POST",
      headers: ip(),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user, id }) },
  );
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

function writeServerConfig(operatorEmail: string | undefined) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: {
        name: "R",
        url: "https://example.test",
        defaultUser: OWNER,
        ...(operatorEmail ? { operatorEmail } : {}),
      },
      users: { reserved: [] },
      features: { auth: { enabled: true }, credits: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );
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
async function reset(operatorEmail: string | undefined) {
  writeServerConfig(operatorEmail);
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
}

async function requestWithToken(owner = OWNER): Promise<{ id: string; token: string }> {
  const { createPayment, submitRequest } = await import("@/lib/payments");
  const { tierFor } = await import("@/lib/credits/pricing");
  const p = await createPayment(owner, tierFor("100")!);
  if (!p) throw new Error("no payment");
  const r = await submitRequest(owner, p.id, "twint");
  if (!r.ok) throw new Error("submit failed");
  return { id: p.id, token: r.token };
}

async function newPending(owner = OWNER) {
  const { createPayment } = await import("@/lib/payments");
  const { tierFor } = await import("@/lib/credits/pricing");
  const p = await createPayment(owner, tierFor("100")!);
  if (!p) throw new Error("no payment");
  return p;
}


beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-payments-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "88".repeat(32);
  writeServerConfig(OPERATOR_EMAIL);
  writeJournal(OWNER, OWNER_EMAIL);
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

describe("pressing Pay files a request and grants nothing", () => {
  test("moves to requested, mails the operator (not the owner), adds no credits", async () => {
    await reset(OPERATOR_EMAIL);
    const { balanceOf } = await import("@/lib/credits");
    const before = (await balanceOf(OWNER)) ?? 0;
    const p = await newPending(OWNER);
    const mailBefore = mailFiles().length;

    const res = await payRoute(OWNER, p.id, { method: "twint" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("requested");
    expect(res.body.creditsAdded).toBe(0);
    expect(await balanceOf(OWNER)).toBe(before);

    // One mail, and it names the operator, not the owner.
    expect(mailFiles().length).toBe(mailBefore + 1);
    const latest = mailFiles().sort().reverse()[0];
    const body = readMail(OWNER, latest);
    expect(body).toContain(`To: ${OPERATOR_EMAIL}`);
    expect(body).not.toContain(OWNER_EMAIL);
    // The response tells the buyer who the approver is.
    expect(res.body.approver).toBe(OPERATOR_EMAIL);
  });

  test("with no operator configured, records the request and mails nobody", async () => {
    await reset(undefined);
    const p = await newPending(OWNER);
    const mailBefore = mailFiles().length;
    const res = await payRoute(OWNER, p.id, { method: "card" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("requested");
    expect(res.body.approver).toBeNull();
    expect(mailFiles().length).toBe(mailBefore);
    await reset(OPERATOR_EMAIL);
  });

  test("a bad method is refused and files nothing", async () => {
    await reset(OPERATOR_EMAIL);
    const { getPayment } = await import("@/lib/payments");
    const p = await newPending(OWNER);
    const res = await payRoute(OWNER, p.id, { method: "bitcoin" });
    expect(res.status).toBe(400);
    expect((await getPayment(OWNER, p.id))?.status).toBe("pending");
  });
});

describe("approving grants the credits, exactly once", () => {
  test("the token grants the tier's credits and marks it paid", async () => {
    await reset(OPERATOR_EMAIL);
    const { balanceOf, ledgerFor } = await import("@/lib/credits");
    const balanceBefore = (await balanceOf(OWNER)) ?? 0;
    const ledgerBefore = (await ledgerFor(OWNER)).length;

    const { id, token } = await requestWithToken(OWNER);
    const buyerMailBefore = mailFiles().length;

    const res = await approveRoute(OWNER, id, { token });
    expect(res.status).toBe(200);
    expect(res.body.creditsGranted).toBe(100);
    // Balance rose by exactly the tier, one new ledger row (the grant), and the
    // buyer got a confirmation.
    expect(await balanceOf(OWNER)).toBe(balanceBefore + 100);
    expect((await ledgerFor(OWNER)).length).toBe(ledgerBefore + 1);
    expect(mailFiles().length).toBe(buyerMailBefore + 1);

    const { getPayment } = await import("@/lib/payments");
    expect((await getPayment(OWNER, id))?.status).toBe("paid");
  });

  test("a second approve of the same request grants nothing more", async () => {
    await reset(OPERATOR_EMAIL);
    const { balanceOf } = await import("@/lib/credits");
    const { id, token } = await requestWithToken(OWNER);
    await approveRoute(OWNER, id, { token });
    const balanceAfterFirst = (await balanceOf(OWNER)) ?? 0;

    const again = await approveRoute(OWNER, id, { token });
    expect(again.status).toBe(403);
    expect(await balanceOf(OWNER)).toBe(balanceAfterFirst);
  });

  test("a wrong token grants nothing", async () => {
    await reset(OPERATOR_EMAIL);
    const { balanceOf } = await import("@/lib/credits");
    const { id } = await requestWithToken(OWNER);
    const before = (await balanceOf(OWNER)) ?? 0;

    const res = await approveRoute(OWNER, id, { token: "not-the-real-token" });
    expect(res.status).toBe(403);
    expect(await balanceOf(OWNER)).toBe(before);
    const { getPayment } = await import("@/lib/payments");
    expect((await getPayment(OWNER, id))?.status).toBe("requested");
  });

  test("an unknown id is 404", async () => {
    await reset(OPERATOR_EMAIL);
    const res = await approveRoute(OWNER, "no-such-id", { token: "some-token" });
    expect(res.status).toBe(404);
  });
});
