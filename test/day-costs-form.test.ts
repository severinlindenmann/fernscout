import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { POST as createTripRoute } from "@/app/api/v1/[user]/trips/route";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { getCostSummary } from "@/lib/costs";
import { tripRef } from "@/lib/trips";

/**
 * One receipt, from the browser — B820.
 *
 * A tester home from a trip with a shoebox of receipts found an excellent
 * costs page and no form: entering a cost was `PATCH /api/v1/…/days/<slug>`
 * with a `costs[]` array, which is an agent or a script. What is asserted here
 * is the half a screenshot cannot show — that a receipt typed into the helper
 * lands on the day it names, is counted on the costs page, defaults to the
 * journal's own currency, and cannot smuggle a category past the closed list.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { PATCH, POST } = await import("@/app/api/helper/[user]/day/route");
const { POST: addCost } = await import("@/app/api/helper/[user]/day/costs/route");

let dir: string;

const params = { params: Promise.resolve({ user: "alex" }) };
const ref = () => tripRef("alex", "a-trip");

function json(body: unknown) {
  return new Request("https://t.test/api/helper/alex/day/costs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** A written day, and its slug. Costs deliberately unanswered — B810 is the
 *  ticket about that, and `unknown` is what the wizard now writes. */
async function day(date: string): Promise<string> {
  const made = await read(
    await POST(
      json({ trip: "a-trip", date, answers: { costs: "unknown", coordinates: "unknown" } }),
      params,
    ),
  );
  const dateSlug = String(made.body.slug);
  // B1276 — a real title renames the day off its date-only slug, so the
  // address used from here on is the one the wizard would actually read
  // back, not the one the day was created under.
  const written = await read(
    await PATCH(json({ trip: "a-trip", slug: dateSlug, title: `Day ${date}`, content: "What happened." }), params),
  );
  return String((written.body.draft as Record<string, unknown>).slug);
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-day-costs-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "day-costs-form-secret-b820";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true } },
    }),
  );
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
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
  const verified = await verifyCode("alex", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error("no token");
  await createTripRoute(
    new Request("https://t.test/api/v1/alex/trips", {
      method: "POST",
      headers: { authorization: `Bearer ${verified.token}`, "content-type": "application/json" },
      body: JSON.stringify({ id: "a-trip", title: "A trip", start: "2026-05-01", end: "2026-05-08" }),
    }),
    params,
  );
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a receipt entered from the browser", () => {
  test("lands on the day it was entered on, and is counted on the costs page", async () => {
    const slug = await day("2026-05-02");
    const added = await read(
      await addCost(
        json({ trip: "a-trip", slug, label: "Dinner", amount: 42, currency: "EUR", category: "food" }),
        params,
      ),
    );
    expect(added.status).toBe(200);

    const entry = getEntryBySlug(ref(), slug, AS_AUTHOR);
    expect(entry?.costs).toEqual([
      { label: "Dinner", amount: 42, currency: "EUR", category: "food" },
    ]);

    const summary = getCostSummary(ref(), new Date("2026-05-09"), AS_AUTHOR);
    expect(summary.items.map((item) => item.label)).toContain("Dinner");
    expect(summary.items.find((item) => item.label === "Dinner")?.date).toBe("2026-05-02");
  });

  test("the currency defaults to the journal's own", async () => {
    const slug = await day("2026-05-02");
    await addCost(json({ trip: "a-trip", slug, label: "Coffee", amount: 4.5, category: "food" }), params);
    expect(getEntryBySlug(ref(), slug, AS_AUTHOR)?.costs[0].currency).toBe("CHF");
  });

  test("a second receipt is added, never a replacement for the first", async () => {
    const slug = await day("2026-05-02");
    await addCost(json({ trip: "a-trip", slug, label: "Dinner", amount: 42, category: "food" }), params);
    await addCost(json({ trip: "a-trip", slug, label: "Bus", amount: 3, category: "transport" }), params);
    expect(getEntryBySlug(ref(), slug, AS_AUTHOR)?.costs.map((c) => c.label)).toEqual(["Dinner", "Bus"]);
  });

  test("writing down what it cost retracts the day's `nobody recorded it`", async () => {
    const slug = await day("2026-05-02");
    expect(getEntryBySlug(ref(), slug, AS_AUTHOR)?.unrecorded).toContain("costs");
    await addCost(json({ trip: "a-trip", slug, label: "Dinner", amount: 42, category: "food" }), params);
    expect(getEntryBySlug(ref(), slug, AS_AUTHOR)?.unrecorded ?? []).not.toContain("costs");
  });

  test("a category outside the closed list is refused", async () => {
    const slug = await day("2026-05-02");
    const refused = await read(
      await addCost(
        json({ trip: "a-trip", slug, label: "Souvenir", amount: 9, category: "shopping" }),
        params,
      ),
    );
    expect(refused.status).toBe(400);
    expect(getEntryBySlug(ref(), slug, AS_AUTHOR)?.costs).toEqual([]);
  });

  test("a receipt for another day goes onto that day, not the one on the screen", async () => {
    const here = await day("2026-05-02");
    const there = await day("2026-05-03");
    const added = await read(
      await addCost(
        json({ trip: "a-trip", slug: here, date: "2026-05-03", label: "Hotel", amount: 120, category: "accommodation" }),
        params,
      ),
    );
    expect(added.status).toBe(200);
    expect(added.body.slug).toBe(there);
    expect(getEntryBySlug(ref(), here, AS_AUTHOR)?.costs).toEqual([]);
    expect(getEntryBySlug(ref(), there, AS_AUTHOR)?.costs.map((c) => c.label)).toEqual(["Hotel"]);
  });

  test("a date nobody has written a day for is refused rather than conjured", async () => {
    const slug = await day("2026-05-02");
    const refused = await read(
      await addCost(
        json({ trip: "a-trip", slug, date: "2026-05-06", label: "Train", amount: 30, category: "transport" }),
        params,
      ),
    );
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("no_day_on_date");
  });
});
