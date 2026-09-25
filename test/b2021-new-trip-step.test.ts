import { afterEach, beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { readTripFile } from "@/lib/api/v2/store";
import { tripCreate } from "@/lib/api/v2/schemas/trip";

/**
 * B2021 — the new-trip studio step's own acceptance line: a trip made
 * through the full flow with every default accepted validates against
 * `tripCreate` with no `incomplete` issue, and a one-field PATCH lands.
 *
 * Three locales — so `translations` is a real question here, not exempt
 * (B1667) — and a private trip, so the locked-card question exists. The
 * studio step's own default is "Show nothing" (B2185); this test opts a
 * trip in to a locked card instead, to prove the explicit choice still
 * reaches the wire.
 */

const OWNER_EMAIL = "traveler-b2021@example.test";
const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

let dir: string;
const params = { params: Promise.resolve({ user: "b2021trav" }) };

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-b2021-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.ANTHROPIC_API_KEY = "not-a-real-key";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "F", url: "https://example.test" },
      features: { auth: { enabled: true }, credits: { enabled: true }, helper: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, "b2021trav", "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "b2021trav", "config.json"),
    JSON.stringify({
      title: "B2021 traveller",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en", "de", "hu"],
      baseCurrency: "CHF",
      features: { helper: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a private trip with every 'rest' default accepted is complete under tripCreate, and a one-field PATCH lands", async () => {
  const { POST: createTripRoute } = await import("@/app/api/helper/[user]/trip/route");
  const created = await createTripRoute(
    new Request("https://t.test/api/helper/b2021trav/trip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Asien 2027",
        start: "2027-02-12",
        end: "2027-03-28",
        visibility: "private",
        accent: "none",
        tagline: "none",
        intro: "none",
        rates: "none",
        // "the rest", every default:
        costsBudget: "none", // Money: not tracked yet
        translations: "none", // Other languages: leave in the first language
        figuresMode: { mode: "journal" }, // Walking figures: the journal's own
        company: "later", // Who is coming: add them later
        teaser: true, // Locked card: "Show nothing" is the studio step's own default (B2185) — this trip's owner opted in instead
      }),
    }),
    params,
  );
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };

  const doc = readTripFile("b2021trav", id);
  expect(doc).not.toBeNull();
  const parsed = tripCreate.safeParse(doc);
  expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  const incompleteIssues = parsed.success
    ? []
    : parsed.error.issues.filter((issue) => (issue as { params?: { v2?: string } }).params?.v2 === "missing");
  expect(incompleteIssues).toEqual([]);

  // Every deferred section really is `declined`, with the neutral reason,
  // not a decline dressed up as something the person said — and `plan`
  // never has to be asked at all.
  expect(doc?.declined).toMatchObject({
    costs: "not entered during setup",
    translations: "not entered during setup",
    plan: "not entered during setup",
  });
  expect(doc?.figures).toEqual({ mode: "journal" });
  expect(doc?.teaser).toBe(true);

  const { applyTripPatch } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const { getUser } = await import("@/lib/users");
  const journal = getUser("b2021trav")!;
  const patchResponse = await applyTripPatch(
    "b2021trav",
    id,
    journal,
    new Request(`https://t.test/api/v2/b2021trav/trips/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tagline: "A borrowed estate car, three passes, too much cheese" }),
    }),
  );
  expect(patchResponse.status).toBe(200);
});

test("a public trip never carries a teaser", async () => {
  const { POST: createTripRoute } = await import("@/app/api/helper/[user]/trip/route");
  const created = await createTripRoute(
    new Request("https://t.test/api/helper/b2021trav/trip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Alps 2027",
        start: "2027-06-01",
        end: "2027-06-10",
        visibility: "public",
        accent: "none",
        tagline: "none",
        intro: "none",
        rates: "none",
        costsBudget: "none",
        translations: "none",
        figuresMode: { mode: "off" },
        company: "solo",
        // No teaser sent at all — a public trip is never asked.
      }),
    }),
    params,
  );
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };

  const doc = readTripFile("b2021trav", id);
  expect(doc).not.toBeNull();
  expect(doc && "teaser" in doc).toBe(false);
});

test("sending teaser on a public trip is refused, not silently written", async () => {
  const { POST: createTripRoute } = await import("@/app/api/helper/[user]/trip/route");
  const created = await createTripRoute(
    new Request("https://t.test/api/helper/b2021trav/trip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Alps 2028",
        start: "2028-06-01",
        end: "2028-06-10",
        visibility: "public",
        accent: "none",
        tagline: "none",
        intro: "none",
        rates: "none",
        costsBudget: "none",
        translations: "none",
        figuresMode: { mode: "off" },
        company: "solo",
        teaser: true,
      }),
    }),
    params,
  );
  expect(created.status).toBe(400);
  const body = (await created.json()) as { error?: string };
  expect(body.error).toBe("invalid_teaser");
});
