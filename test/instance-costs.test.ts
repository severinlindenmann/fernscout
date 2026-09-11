import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache, loadServerConfig, type CostConfig } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { grant } from "@/lib/credits";
import { createAdminGrant, createPayment, getPayment, paymentsAwaiting, submitRequest, takings } from "@/lib/payments";
import { recordUsage, usageSince } from "@/lib/usage";
import { dailyCosts, dashboard, priceUsage } from "@/lib/instanceCosts";
import { clearRatesCache } from "@/lib/rates";
import { recordSms } from "@/lib/sms/store";
import { recordWhatsappSend, WHATSAPP_CATEGORIES } from "@/lib/whatsapp/sends";

/**
 * B746: the operator's bill.
 *
 * Two things are worth testing here and they are unrelated. The first is the
 * arithmetic, which needs no database and is where a costing page is actually
 * wrong: a factor of a million in the wrong direction typechecks. The second
 * is the promise that metering never costs somebody their day — `recordUsage`
 * swallowing every failure is the whole of property 1 in `lib/usage.ts`, and a
 * promise like that is worth an assertion rather than a comment.
 */

// Undefined until a describe block that needs a database calls setup(): the
// pricing block below is pure arithmetic and deliberately sets nothing up.
let dir: string | undefined;

async function setup(): Promise<void> {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-instance-costs-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "costs.db")}`;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", operatorEmail: "op@example.test" },
      users: { reserved: [] },
      features: { credits: { enabled: true } },
      costs: {
        models: { "test-model": { inputPerMillionRappen: 80, outputPerMillionRappen: 400 } },
        transcriptionPerThousandMinutesRappen: 344,
        fixedMonthly: [{ label: "Server", rappen: 5000 }],
        whatsappPerMessageRappen: { marketing: 10 },
      },
    }),
  );
  fs.mkdirSync(path.join(dir, "alice"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alice", "config.json"),
    JSON.stringify({
      title: "Alice",
      owner: { name: "Alice A", nickname: "Alice", email: "a@example.test" },
    }),
  );
  clearConfigCache();
  clearUserCache();
  await getDatabase();
}

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  clearConfigCache();
  clearUserCache();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const PRICES: CostConfig = {
  models: { "test-model": { inputPerMillionRappen: 80, outputPerMillionRappen: 400 } },
  transcriptionPerThousandMinutesRappen: 344,
  fixedMonthly: [],
  whatsappPerMessageRappen: {},
};

function total(provider: string, over: Partial<Parameters<typeof priceUsage>[0][number]> = {}) {
  return {
    provider,
    model: provider === "deepgram" ? "nova-3" : "test-model",
    operation: provider === "deepgram" ? "transcribe" : "write_day",
    calls: 1,
    inputTokens: 0,
    outputTokens: 0,
    seconds: 0,
    ...over,
  };
}

describe("pricing the usage rows", () => {
  test("a million input tokens costs exactly the quoted per-million price", () => {
    const [line] = priceUsage([total("anthropic", { inputTokens: 1_000_000 })], PRICES);
    expect(line.rappen).toBe(80);
    expect(line.unpriced).toBe(false);
  });

  test("input and output are priced separately, and both land in one line", () => {
    const [line] = priceUsage(
      [total("anthropic", { inputTokens: 2_000_000, outputTokens: 500_000 })],
      PRICES,
    );
    // 2 × 80 + 0.5 × 400 = 360.
    expect(line.rappen).toBe(360);
  });

  test("rounding happens once, at the end, rather than per row", () => {
    // A single short call is a fraction of a rappen. Rounded down per row it
    // would vanish; the whole point of pricing per million is that it does not.
    const [line] = priceUsage([total("anthropic", { inputTokens: 3_000, outputTokens: 900 })], PRICES);
    // 3000 × 80/1e6 = 0.24, plus 900 × 400/1e6 = 0.36 → 0.6 → 1 rappen.
    expect(line.rappen).toBe(1);
  });

  test("audio is priced per thousand minutes, from seconds the provider measured", () => {
    // 60_000 seconds is 1000 minutes exactly.
    const [line] = priceUsage([total("deepgram", { seconds: 60_000 })], PRICES);
    expect(line.rappen).toBe(344);
    expect(line.detail).toBe("1000.0 min");
  });

  test("a model with no price says so rather than reporting nothing spent", () => {
    const [line] = priceUsage(
      [{ ...total("anthropic", { inputTokens: 500_000 }), model: "some-new-model" }],
      PRICES,
    );
    expect(line.rappen).toBe(0);
    expect(line.unpriced).toBe(true);
  });

  test("a model with no price and no usage is not flagged — there is nothing to price", () => {
    const [line] = priceUsage([{ ...total("anthropic"), model: "some-new-model" }], PRICES);
    expect(line.unpriced).toBe(false);
  });
});

describe("recording what a call consumed", () => {
  beforeEach(setup);

  test("a recorded call is summed back per provider, model and operation", async () => {
    await recordUsage({
      owner: "alice",
      provider: "anthropic",
      model: "test-model",
      operation: "write_day",
      inputTokens: 1_500,
      outputTokens: 400,
    });
    await recordUsage({
      owner: "alice",
      provider: "anthropic",
      model: "test-model",
      operation: "write_day",
      inputTokens: 500,
      outputTokens: 100,
    });

    const totals = await usageSince("1970-01-01T00:00:00.000Z");
    expect(totals).toHaveLength(1);
    expect(totals[0]).toMatchObject({ calls: 2, inputTokens: 2_000, outputTokens: 500 });
  });

  test("a nonsense count is stored as zero rather than poisoning the sum", async () => {
    await recordUsage({
      owner: "alice",
      provider: "anthropic",
      model: "test-model",
      operation: "write_day",
      inputTokens: Number.NaN,
      outputTokens: -5,
    });
    const totals = await usageSince("1970-01-01T00:00:00.000Z");
    expect(totals[0]).toMatchObject({ calls: 1, inputTokens: 0, outputTokens: 0 });
  });

  test("rows outside the period are left out", async () => {
    await recordUsage({
      owner: "alice",
      provider: "deepgram",
      model: "nova-3",
      operation: "transcribe",
      seconds: 90,
    });
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(await usageSince(future)).toHaveLength(0);
  });

  /**
   * Property 1 of `lib/usage.ts`, and the reason the whole body is inside a
   * `try`. With the database closed every call in here throws; the person's
   * day has already been written by this point and must survive it.
   */
  test("recording never throws, even with no database at all", async () => {
    await closeDatabase();
    delete process.env.DATABASE_URL;
    await expect(
      recordUsage({
        owner: "alice",
        provider: "anthropic",
        model: "test-model",
        operation: "route_ask",
        inputTokens: 10,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("the dashboard", () => {
  beforeEach(setup);

  test("the total is the arithmetic over the rows, plus the fixed lines", async () => {
    await recordUsage({
      owner: "alice",
      provider: "anthropic",
      model: "test-model",
      operation: "write_day",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    const data = await dashboard("1970-01-01T00:00:00.000Z");
    // 80 + 400 for the tokens, 5000 for the one fixed line.
    expect(data.totalRappen).toBe(5_480);
    expect(loadServerConfig().costs.fixedMonthly).toHaveLength(1);
  });

  test("a journal's spend and balance are reported beside its usage", async () => {
    await grant("alice", 50, "test");
    await recordUsage({
      owner: "alice",
      provider: "anthropic",
      model: "test-model",
      operation: "write_day",
      inputTokens: 1_000_000,
    });
    const data = await dashboard("1970-01-01T00:00:00.000Z");
    const alice = data.journals.find((row) => row.username === "alice");
    expect(alice).toMatchObject({ balance: 50, granted: 50, spent: 0, rappen: 80 });
  });
});

describe("granting from the dashboard", () => {
  beforeEach(setup);

  /**
   * The property the whole shape exists for: an admin grant is a *request*.
   * If this ever starts passing with a raised balance, `lib/credits.ts`'s
   * property 1 has been broken and `test/credits.test.ts`'s allowlist is the
   * next thing to read.
   */
  test("filing a grant adds nothing to the balance and mints a single-use token", async () => {
    const before = (await dashboard("1970-01-01T00:00:00.000Z")).journals.find(
      (row) => row.username === "alice",
    );
    expect(before?.balance).toBe(0);

    const created = await createAdminGrant("alice", 50);
    expect(created).not.toBeNull();
    expect(created!.token).not.toBe("");

    const after = (await dashboard("1970-01-01T00:00:00.000Z")).journals.find(
      (row) => row.username === "alice",
    );
    expect(after?.balance).toBe(0);
    expect(after?.granted).toBe(0);

    // It is on file, awaiting the operator, and costs nothing.
    const payment = await getPayment("alice", created!.payment.id);
    expect(payment).toMatchObject({ status: "requested", credits: 50, amountRappen: 0, method: "admin" });
  });

  test("a grant must be a positive whole number", async () => {
    expect(await createAdminGrant("alice", 0)).toBeNull();
    expect(await createAdminGrant("alice", -5)).toBeNull();
    expect(await createAdminGrant("alice", 2.5)).toBeNull();
  });
});

describe("the daily series", () => {
  beforeEach(setup);

  /**
   * The property the chart rests on: a quiet day is a column of zero, not an
   * absent column. Without it a fortnight of silence compresses and one busy
   * afternoon reads as a trend.
   */
  test("every day of the window is present, including the ones with no calls", async () => {
    const since = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
    const days = await dailyCosts(since, 7);
    expect(days).toHaveLength(7);
    expect(days.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date))).toBe(true);
    expect(days.every((day) => day.rappen === 0)).toBe(true);
  });

  test("a call lands on its own day, priced the way every other line is", async () => {
    await recordUsage({
      owner: "alice",
      provider: "anthropic",
      model: "test-model",
      operation: "write_day",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const days = await dailyCosts(since, 3);
    const today = new Date().toISOString().slice(0, 10);
    const row = days.find((day) => day.date === today);
    // 80 for the input million, 400 for the output million — the same
    // arithmetic priceUsage does for the rows below the chart.
    expect(row?.rappen).toBe(480);
    expect(days.reduce((sum, day) => sum + day.rappen, 0)).toBe(480);
  });
});

describe("money coming in", () => {
  beforeEach(setup);

  // An amount and its price, the way the purchase route computes them — B854
  // replaced the fixed tier table with a function.
  const CREDITS = 50;
  const RAPPEN = 1000;

  test("a purchase only joins the queue once the buyer has pressed Pay", async () => {
    const payment = await createPayment("alice", CREDITS, RAPPEN);
    // `pending` is a checkout page somebody opened and may simply have closed.
    expect(await paymentsAwaiting()).toHaveLength(0);

    await submitRequest("alice", payment!.id, "twint");
    const queue = await paymentsAwaiting();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ owner: "alice", credits: 50, amountRappen: 1000 });
    expect(queue[0].requestedAt).not.toBeNull();
  });

  test("the queue reaches the dashboard, and nothing has been granted by being in it", async () => {
    const payment = await createPayment("alice", CREDITS, RAPPEN);
    await submitRequest("alice", payment!.id, "card");

    const data = await dashboard("1970-01-01T00:00:00.000Z");
    expect(data.awaiting).toHaveLength(1);
    // Queued is not paid: no takings, and no balance.
    expect(data.takenRappen).toBe(0);
    expect(data.journals.find((row) => row.username === "alice")?.balance).toBe(0);
  });

  /**
   * The property B774 exists to keep honest. An admin grant rides the same
   * approval machinery with `amount_rappen: 0` and `method: "admin"`, so it
   * belongs in the queue — somebody really is waiting to approve it — and must
   * never be summed as money anybody paid.
   */
  test("an admin grant waits in the queue and is not takings", async () => {
    const created = await createAdminGrant("alice", 50);
    const queue = await paymentsAwaiting();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ id: created!.payment.id, method: "admin", amountRappen: 0 });
    expect(takings(queue)).toBe(0);
  });

  test("takings count real purchases and skip grants made by hand", () => {
    expect(
      takings([
        { id: "a", owner: "alice", credits: 50, amountRappen: 1000, status: "paid", method: "twint", createdAt: "", paidAt: "", requestedAt: null, providerRef: null },
        { id: "b", owner: "alice", credits: 50, amountRappen: 0, status: "paid", method: "admin", createdAt: "", paidAt: "", requestedAt: null, providerRef: null },
        { id: "c", owner: "bob", credits: 100, amountRappen: 1800, status: "paid", method: "card", createdAt: "", paidAt: "", requestedAt: null, providerRef: null },
      ]),
    ).toBe(2800);
  });

  test("nothing waiting is the ordinary state, not an error", async () => {
    expect(await paymentsAwaiting()).toEqual([]);
    const data = await dashboard("1970-01-01T00:00:00.000Z");
    expect(data.awaiting).toEqual([]);
    expect(data.paid).toEqual([]);
    expect(data.takenRappen).toBe(0);
  });
});

/**
 * B1347: the three groups that used to under-count. Print orders now carry
 * what the provider charged and are converted into rappen through the ECB
 * table; WhatsApp sends are counted per Meta category and priced from the
 * config; outbound SMS appear as a counted line.
 */
describe("print, WhatsApp and SMS on the dashboard", () => {
  beforeEach(async () => {
    await setup();
    // The rates the conversion reads. DATA_DIR points into the test dir so
    // nothing outside it is touched; 1 EUR = 0.93 CHF = 0.84 GBP.
    process.env.DATA_DIR = dir;
    fs.mkdirSync(path.join(dir!, "rates"), { recursive: true });
    fs.writeFileSync(
      path.join(dir!, "rates", "ecb.json"),
      JSON.stringify({ date: "2026-09-01", rates: { CHF: 0.93, GBP: 0.84 } }),
    );
    clearRatesCache();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    clearRatesCache();
  });

  test("a print order's provider cost is converted into rappen for the total", async () => {
    const { db } = await getDatabase();
    await db
      .insertInto("print_orders")
      .values({
        id: "order-1",
        owner_id: "alice",
        kind: "postcard",
        provider: "stannp",
        provider_ref: null,
        status: "built",
        payload: "{}",
        cost_minor: 840, // GBP 8.40
        currency: "GBP",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();

    const data = await dashboard("1970-01-01T00:00:00.000Z");
    const line = data.print.find((row) => row.label.includes("Postcards"));
    // 840 pence × (0.93 / 0.84) = 930 rappen.
    expect(line).toMatchObject({ rappen: 930, unpriced: false });
    expect(line!.detail).toContain("GBP 8.40");
  });

  test("a charge in a currency the table cannot convert is flagged, not summed at face value", async () => {
    const { db } = await getDatabase();
    await db
      .insertInto("print_orders")
      .values({
        id: "order-2",
        owner_id: "alice",
        kind: "photobook",
        provider: "gelato",
        provider_ref: null,
        status: "print_submitted",
        payload: "{}",
        cost_minor: 2500,
        currency: "SEK",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();

    const data = await dashboard("1970-01-01T00:00:00.000Z");
    const line = data.print.find((row) => row.label.includes("Photobooks"));
    expect(line).toMatchObject({ rappen: 0, unpriced: true });
  });

  test("WhatsApp sends are counted per category and priced where the config prices them", async () => {
    await recordWhatsappSend({ owner: "alice", category: "marketing", template: "day_de" });
    await recordWhatsappSend({ owner: "alice", category: "marketing", template: "day_de" });
    await recordWhatsappSend({ owner: "alice", category: "utility", template: "reminder" });
    await recordWhatsappSend({ owner: null, category: "service", template: "reply" });

    const data = await dashboard("1970-01-01T00:00:00.000Z");
    const marketing = data.sends.find((row) => row.label === "WhatsApp · marketing");
    const utility = data.sends.find((row) => row.label === "WhatsApp · utility");
    const service = data.sends.find((row) => row.label === "WhatsApp · service");
    // Two sends at the configured 10 rappen; utility is unpriced and says so;
    // service is free by Meta's own rule, never "not priced".
    expect(marketing).toMatchObject({ calls: 2, rappen: 20, unpriced: false });
    expect(utility).toMatchObject({ calls: 1, rappen: 0, unpriced: true });
    expect(service).toMatchObject({ calls: 1, rappen: 0, unpriced: false });
  });

  /**
   * Three places name the categories: the closed list in lib/whatsapp/sends.ts,
   * the literal union on WhatsappMessage.category (which cannot import the
   * list without pulling the db into every message type), and the price-map
   * keys parseCosts accepts in lib/config.ts. This pins the list so a category
   * added to one place fails here until the other two follow.
   */
  test("the category list is closed, and the priced ones are it minus the free one", () => {
    expect(WHATSAPP_CATEGORIES).toEqual(["marketing", "utility", "authentication", "service"]);
  });

  test("outbound SMS are a counted line, and inbound are not", async () => {
    await recordSms({ direction: "out", from: "41790000000", to: "41791111111", body: "hi", providerSid: "s1" });
    await recordSms({ direction: "in", from: "41791111111", to: "41790000000", body: "hello", providerSid: "s2" });

    const data = await dashboard("1970-01-01T00:00:00.000Z");
    const sms = data.sends.find((row) => row.label === "SMS · Twilio");
    expect(sms).toMatchObject({ calls: 1, rappen: 0, unpriced: false });
  });
});
