import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * B792 — Stripe settles a purchase, and the webhook is the only new thing that
 * can raise a balance. The properties worth a test are the ones that would
 * cost real money to get wrong:
 *
 *   - an unsigned or badly-signed body grants nothing, whatever it claims;
 *   - a properly signed event grants exactly the row's credits, **once** —
 *     Stripe delivers at least once and retries, so a replay must be free;
 *   - a paid session whose total does not match our row grants nothing;
 *   - with no key configured the route does not exist, and the hand-approval
 *     path is untouched.
 *
 * The mode switch is asserted here too, because it is one `startsWith` between
 * a sandbox and somebody's actual card.
 */

const OWNER = "ana";
const SECRET = "whsec_test_secret_for_signing_only";

let dir: string;

function writeServerConfig() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { credits: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );
}

function writeJournal(user: string) {
  fs.mkdirSync(path.join(dir, user, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, user, "config.json"),
    JSON.stringify({
      title: `${user}'s journal`,
      tagline: "t",
      owner: { name: "A A", nickname: "A", email: `${user}@example.test` },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
    }),
  );
}

/** A payment that has been through Pay and is waiting to settle. */
async function requested(): Promise<{ id: string; credits: number; amount: number }> {
  const { createPayment, submitRequest } = await import("@/lib/payments");
  const { priceRappen } = await import("@/lib/credits/pricing");
  const credits = 200;
  const amount = priceRappen(credits);
  const p = await createPayment(OWNER, credits, amount);
  if (!p) throw new Error("no payment");
  const r = await submitRequest(OWNER, p.id, null);
  if (!r.ok) throw new Error("submit failed");
  return { id: p.id, credits, amount };
}

function sessionEvent(paymentId: string, amount: number, over: Record<string, unknown> = {}) {
  return {
    id: `evt_${paymentId}`,
    object: "event",
    type: "checkout.session.completed",
    // A test-mode key signs test-mode events; the route (B830) refuses an
    // event whose livemode does not match the key's mode.
    livemode: false,
    data: {
      object: {
        id: `cs_test_${paymentId}`,
        object: "checkout.session",
        payment_status: "paid",
        amount_total: amount,
        currency: "chf",
        payment_method_types: ["card", "twint"],
        client_reference_id: paymentId,
        metadata: { owner: OWNER, paymentId },
        ...over,
      },
    },
  };
}

/** Post a body to the webhook, signed unless `signature` says otherwise. */
async function hook(event: unknown, signature?: string | null) {
  const raw = JSON.stringify(event);
  const Stripe = (await import("stripe")).default;
  const header =
    signature === undefined
      ? Stripe.webhooks.generateTestHeaderString({ payload: raw, secret: SECRET })
      : signature;
  const { POST } = await import("@/app/api/webhooks/stripe/route");
  const r = await POST(
    new Request("https://example.test/api/webhooks/stripe", {
      method: "POST",
      headers: header ? { "stripe-signature": header } : {},
      body: raw,
    }),
  );
  return { status: r.status, text: await r.text() };
}

async function balance(): Promise<number> {
  const { balanceOf } = await import("@/lib/credits");
  return (await balanceOf(OWNER)) ?? 0;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-stripe-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.STRIPE_SECRET_KEY = "sk_test_notarealkey";
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  writeServerConfig();
  writeJournal(OWNER);
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
  for (const k of [
    "CONTENT_DIR",
    "DATA_DIR",
    "DATABASE_URL",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ]) {
    delete process.env[k];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the sandbox switch is the key itself", () => {
  test("a test key is test, a live key is live, no key is no provider", async () => {
    const { stripeMode, stripeEnabled } = await import("@/lib/stripe");
    expect(stripeMode()).toBe("test");

    process.env.STRIPE_SECRET_KEY = "sk_live_notarealkey";
    expect(stripeMode()).toBe("live");
    process.env.STRIPE_SECRET_KEY = "rk_live_notarealkey";
    expect(stripeMode()).toBe("live");

    delete process.env.STRIPE_SECRET_KEY;
    expect(stripeMode()).toBe(null);
    expect(stripeEnabled()).toBe(false);

    process.env.STRIPE_SECRET_KEY = "sk_test_notarealkey";
  });

  test("a secret key without a webhook secret is not a usable provider", async () => {
    const { stripeEnabled, stripeProblem } = await import("@/lib/stripe");
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(stripeEnabled()).toBe(false);
    expect(stripeProblem()).toMatch("STRIPE_WEBHOOK_SECRET");
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    expect(stripeEnabled()).toBe(true);
  });
});

describe("the operator approval queue (B833)", () => {
  test("excludes Stripe rows, which have no approval token, and keeps manual ones", async () => {
    const { createPayment, submitRequest, paymentsAwaiting } = await import("@/lib/payments");
    const { priceRappen } = await import("@/lib/credits/pricing");
    const fifty = [50, priceRappen(50)] as const;

    // A Stripe-path request (method null) mints no token — it settles by
    // webhook — so it must not sit in the operator's queue.
    const stripeRow = await createPayment(OWNER, ...fifty);
    await submitRequest(OWNER, stripeRow!.id, null);

    // A manual request (a named method) does mint a token and does belong.
    const manualRow = await createPayment(OWNER, ...fifty);
    await submitRequest(OWNER, manualRow!.id, "twint");

    const queue = await paymentsAwaiting();
    const ids = queue.map((p) => p.id);
    expect(ids).toContain(manualRow!.id);
    expect(ids).not.toContain(stripeRow!.id);
  });
});

describe("the webhook", () => {
  test("refuses a body with no signature, and grants nothing", async () => {
    const p = await requested();
    const before = await balance();
    expect((await hook(sessionEvent(p.id, p.amount), null)).status).toBe(400);
    expect(await balance()).toBe(before);
  });

  test("refuses a forged signature, and grants nothing", async () => {
    const p = await requested();
    const before = await balance();
    expect((await hook(sessionEvent(p.id, p.amount), "t=1,v1=deadbeef")).status).toBe(400);
    expect(await balance()).toBe(before);
  });

  test("grants the row's credits once, and a replay grants nothing more", async () => {
    const p = await requested();
    const before = await balance();

    const first = await hook(sessionEvent(p.id, p.amount));
    expect(first.status).toBe(200);
    expect(await balance()).toBe(before + p.credits);

    // Stripe delivers at least once. The same event again must be free.
    const replay = await hook(sessionEvent(p.id, p.amount));
    expect(replay.status).toBe(200);
    expect(await balance()).toBe(before + p.credits);

    const { getPayment } = await import("@/lib/payments");
    const row = await getPayment(OWNER, p.id);
    expect(row?.status).toBe("paid");
    // Reading which method was used needs Stripe, and the key here is not a
    // real one — so the lookup fails, and the point of the assertion is that
    // failing it costs nothing: the credits are granted and the row is paid,
    // with the label left null rather than invented (B803). Which method a
    // real purchase records is checked against the live sandbox, not here.
    expect(row?.method).toBe(null);
  });

  test("refuses a paid session in a currency other than chf, and grants nothing", async () => {
    const p = await requested();
    const before = await balance();
    const r = await hook(sessionEvent(p.id, p.amount, { currency: "eur" }));
    expect(r.status).toBe(200);
    expect(r.text).toContain("currency");
    expect(await balance()).toBe(before);
  });

  test("refuses an event whose livemode does not match the test key, and grants nothing", async () => {
    const p = await requested();
    const before = await balance();
    const ev = sessionEvent(p.id, p.amount);
    (ev as { livemode: boolean }).livemode = true; // a live event against a test key
    const r = await hook(ev);
    expect(r.status).toBe(400);
    expect(await balance()).toBe(before);
  });

  test("refuses a paid session whose total is not the row's", async () => {
    const p = await requested();
    const before = await balance();
    const r = await hook(sessionEvent(p.id, 1));
    expect(r.status).toBe(200);
    expect(r.text).toContain("amount_mismatch");
    expect(await balance()).toBe(before);
  });

  test("ignores a session that has not settled", async () => {
    const p = await requested();
    const before = await balance();
    await hook(sessionEvent(p.id, p.amount, { payment_status: "unpaid" }));
    expect(await balance()).toBe(before);
  });

  test("ignores a session naming a journal that does not exist", async () => {
    const p = await requested();
    const before = await balance();
    await hook(sessionEvent(p.id, p.amount, { metadata: { owner: "nobody", paymentId: p.id } }));
    expect(await balance()).toBe(before);
  });

  test("does not exist when no provider is configured", async () => {
    const p = await requested();
    delete process.env.STRIPE_SECRET_KEY;
    const before = await balance();
    expect((await hook(sessionEvent(p.id, p.amount))).status).toBe(404);
    expect(await balance()).toBe(before);
    process.env.STRIPE_SECRET_KEY = "sk_test_notarealkey";
  });
});
