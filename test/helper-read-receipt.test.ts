import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { clearIdempotencyStore } from "@/lib/idempotency";
import { resetRateLimitsForTests } from "@/lib/rateLimit";
import { tripMediaDir } from "@/lib/media";
import { paintJpeg } from "./support/pictures";
import { writeTripFixture } from "./fixtures/content";
import { dayToJson } from "@/lib/api/v2/documents";
import { hasPaid } from "./support/openCore";

/**
 * "Read a receipt" — TIX-2's add-a-day flow. **The model is stubbed;
 * nothing here reaches a network**, the same discipline
 * `test/helper-describe-photos.test.ts` uses for `describeImage`.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { readReceipt } = vi.hoisted(() => ({ readReceipt: vi.fn() }));
vi.mock("@/lib/helper/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/helper/model")>()),
  readReceipt,
}));

const { POST } = await import("@/app/api/helper/[user]/day/read-receipt/route");
const { POST: consentRoute } = await import("@/app/api/helper/[user]/consent/route");

let dir: string;
const TRIP = "a-trip";
const REF = `alex/${TRIP}`;
const SLUG = "the-pass";
// Stored trip-relative (`RAW_SRC`, what the day file carries); read back
// owner-prefixed (`SRC`, what `getEntryBySlug`'s gallery actually gives —
// `mediaWithOwner`, `lib/trips.ts`) — the request has to name the second.
const RAW_SRC = `/media/${TRIP}/${SLUG}/01.jpg`;
const SRC = `/@alex${RAW_SRC}`;
const params = { params: Promise.resolve({ user: "alex" }) };

function json(body: unknown) {
  return new Request("https://t.test/api/helper/alex/day/read-receipt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function call(over: Record<string, unknown> = {}) {
  return POST(json({ trip: TRIP, slug: SLUG, src: SRC, idempotency_key: "one", ...over }), params);
}

async function consent(scope: "words" | "photos" = "photos") {
  await consentRoute(
    new Request("https://t.test/api/helper/alex/consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope }),
    }),
    params,
  );
}

function writeConfig(features: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features }),
  );
  clearConfigCache();
  clearUserCache();
}

function entryPath(): string {
  return path.join(dir, "alex", "trips", TRIP, "entries", `2026-05-04-${SLUG}.json`);
}

async function writeDayWithPhoto() {
  writeTripFixture("alex", {
    id: TRIP,
    title: "Over the pass",
    start: "2026-05-01",
    end: "2026-05-31",
    visibility: "public",
    intro: "Trip.",
  });
  const media = tripMediaDir(REF);
  fs.mkdirSync(path.join(media, SLUG), { recursive: true });
  fs.writeFileSync(path.join(media, SLUG, "01.jpg"), await paintJpeg(400, 300, 1));
  fs.writeFileSync(
    entryPath(),
    dayToJson({
      slug: SLUG,
      title: "The pass",
      date: "2026-05-04",
      status: "draft",
      content: "Words.",
      media: [{ src: RAW_SRC, type: "image" as const, width: 400, height: 300 }],
    }),
  );
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-helper-receipt-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-read-receipt-secret-tix2";
  process.env.ANTHROPIC_API_KEY = "not-a-real-key";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  readReceipt.mockReset();
  readReceipt.mockResolvedValue({ amount: 24.5, currency: "CHF", label: "Lunch" });
  clearIdempotencyStore();
  resetRateLimitsForTests();

  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  writeConfig({ auth: { enabled: true }, helper: { enabled: true } });
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("consent, and that words alone is not enough", () => {
  test("is refused with no consent at all", async () => {
    await writeDayWithPhoto();
    const refused = await read(await call());
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("consent_required");
    expect(readReceipt).not.toHaveBeenCalled();
  });

  test("consenting to words alone does not cover photographs", async () => {
    await writeDayWithPhoto();
    await consent("words");
    const refused = await read(await call());
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("consent_required");
  });

  test("consenting to photographs lets the call through", async () => {
    await writeDayWithPhoto();
    await consent("photos");
    const done = await read(await call());
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ ok: true, receipt: { amount: 24.5, currency: "CHF", label: "Lunch" }, provider: "Anthropic" });
  });
});

describe("what the day and src have to be", () => {
  beforeEach(async () => {
    await consent("photos");
  });

  test("an unknown trip is a 404", async () => {
    const refused = await read(await call({ trip: "never-existed" }));
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("unknown_trip");
  });

  test("an unknown day is a 404", async () => {
    writeTripFixture("alex", { id: TRIP, title: "T", start: "2026-05-01", end: "2026-05-31", visibility: "public" });
    const refused = await read(await call());
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("unknown_day");
  });

  test("a src not on the day is a 404", async () => {
    await writeDayWithPhoto();
    const refused = await read(await call({ src: "/media/a-trip/the-pass/not-there.jpg" }));
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("not_on_day");
    expect(readReceipt).not.toHaveBeenCalled();
  });
});

describe("what it answers when the model says nothing", () => {
  test("not a receipt: 200 with receipt: null, and the AI day is still spent", async () => {
    await writeDayWithPhoto();
    await consent("photos");
    readReceipt.mockResolvedValue(null);
    const done = await read(await call());
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ ok: true, receipt: null, provider: "Anthropic" });
  });

  test("a failed model call is a 502 and takes no AI day", async () => {
    await writeDayWithPhoto();
    await consent("photos");
    readReceipt.mockRejectedValueOnce(new Error("provider is unhappy"));
    const failed = await read(await call());
    expect(failed.status).toBe(502);
  });
});

describe("what is sent", () => {
  test("a resized derivative goes to the model, not the raw upload bytes", async () => {
    await writeDayWithPhoto();
    await consent("photos");
    await call();
    expect(readReceipt).toHaveBeenCalledTimes(1);
    const [image, owner] = readReceipt.mock.calls[0] as [{ base64: string; mediaType: string }, string];
    expect(image.mediaType).toBe("image/webp");
    expect(owner).toBe("alex");
    expect(Buffer.from(image.base64, "base64").byteLength).toBeLessThan(200_000);
  });
});

describe("with the capability off", () => {
  test("the route refuses rather than failing", async () => {
    await writeDayWithPhoto();
    writeConfig({ auth: { enabled: true } });
    const refused = await read(await call());
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("helper_unavailable");
    expect(readReceipt).not.toHaveBeenCalled();
  });
});

describe("bearer tokens", () => {
  test("are refused; only the owner's cookie is honoured", async () => {
    await writeDayWithPhoto();
    await consent("photos");
    resolveAccess.mockResolvedValueOnce({ email: null });
    const refused = await read(
      await POST(
        new Request("https://t.test/api/helper/alex/day/read-receipt", {
          method: "POST",
          headers: { authorization: "Bearer not-a-cookie", "content-type": "application/json" },
          body: JSON.stringify({ trip: TRIP, slug: SLUG, src: SRC }),
        }),
        params,
      ),
    );
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("not_your_journal");
  });
});

describe.skipIf(!hasPaid())("B2591 — AI days, with billing on", () => {
  beforeEach(async () => {
    writeConfig({ auth: { enabled: true }, helper: { enabled: true }, billing: { enabled: true } });
    await consent("photos");
  });

  test("reading a receipt takes that date's AI day", async () => {
    await writeDayWithPhoto();
    const done = await read(await call({ idempotency_key: "ai-day-1" }));
    expect(done.status).toBe(200);
    const { getDatabase } = await import("@/lib/db");
    const rows = await (await getDatabase()).db.selectFrom("ai_days").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ owner_id: "alex", trip_id: TRIP, date: "2026-05-04" });
  });

  test("once the plan's AI days are gone, reading a receipt is refused with 402 plan_limit", async () => {
    const { grantPlan } = await import("@paid/billing/lib/entitlements");
    const now = Date.now();
    await grantPlan({
      owner: "alex",
      plan: "pass",
      source: "admin",
      startsAt: new Date(now - 1000).toISOString(),
      endsAt: new Date(now + 100_000).toISOString(),
      periodStart: new Date(now - 1000).toISOString(),
      periodEnd: new Date(now + 100_000).toISOString(),
    });
    const { getDatabase } = await import("@/lib/db");
    const handle = await getDatabase();
    for (let i = 0; i < 21; i++) {
      await handle.db
        .insertInto("ai_days")
        .values({
          id: `seed-${i}`,
          owner_id: "alex",
          trip_id: TRIP,
          date: `2025-01-${String(i + 1).padStart(2, "0")}`,
          first_used_at: new Date(now - 1000).toISOString(),
          plan_period_start: new Date(now - 1000).toISOString(),
        })
        .execute();
    }
    await writeDayWithPhoto();
    const refused = await read(await call({ idempotency_key: "ai-day-2" }));
    expect(refused.status).toBe(402);
    expect(refused.body).toMatchObject({ error: "plan_limit", limit: "aiDays", used: 21, allowed: 21, plan: "pass" });
    expect(readReceipt).not.toHaveBeenCalled();
  });
});
