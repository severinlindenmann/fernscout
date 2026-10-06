import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

/**
 * B-2928 — a stored day whose decline reason is shorter than the 10
 * characters the schema demands used to make every trip read and write
 * answer 500 (an uncaught ZodError out of `tripDoc.parse`). It answers a
 * named 422 now, the list survives, and the day itself can be repaired.
 */

const OWNER = "tess";
const OWNER_EMAIL = "tess@example.test";
const TRIP = "short-reason";
let dir: string;
let token: string;
let calls = 0;

const headers = (extra: Record<string, string> = {}) => {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.8.2.${calls % 250}`, authorization: `Bearer ${token}`, ...extra };
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-stored-day-invalid-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "78".repeat(32);
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { auth: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  const { createJournal } = await import("@/lib/journals");
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
  const created = createJournal({ username: OWNER, title: "Tess's Journal", ownerEmail: OWNER_EMAIL, ownerName: "Tess Traveller", ownerNickname: "Tess" });
  if (!created.ok) throw new Error(created.message);

  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const verified = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error("no owner token");
  token = verified.token;

  const { writeTripFile, writeDayFile } = await import("@/lib/api/v2/store");
  writeTripFile(OWNER, TRIP, {
    title: "Short reason",
    dates: { from: "2026-09-25", to: "2026-11-06" },
    visibility: "private",
    teaser: true,
    people: [{ name: "Tess Traveller", email: OWNER_EMAIL }],
    declined: {
      rates: "no foreign currency tracked on this trip",
      costs: "no budget tracked for this trip currently",
      plan: "no planned route recorded for this trip",
      days: "answered by the day files themselves",
      translations: "single-language journal, nothing to translate",
      accent: "default accent left as the renderer's choice",
      figures: "no walking figures drawn for this trip",
      tagline: "no one-line subtitle written for this trip",
      intro: "no opening prose written for this trip yet",
    },
  } as never);
  // The way a short reason gets onto disk: a hand edit or an old writer.
  writeDayFile(OWNER, TRIP, "2026-09-28-ferry", {
    slug: "2026-09-28-ferry",
    title: "A day",
    date: "2026-09-28",
    content: "",
    status: "draft",
    declined: { transportMode: "n/a" },
  } as never);
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const k of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "SESSION_SECRET"]) delete process.env[k];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a stored day that no longer validates", () => {
  test("PATCHing the trip answers 422 naming the day and field, not 500", async () => {
    const { PATCH } = await import("@/app/api/v2/[user]/trips/[trip]/route");
    const res = await PATCH(
      new Request(`https://example.test/api/v2/${OWNER}/trips/${TRIP}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ title: "Renamed" }) }),
      { params: Promise.resolve({ user: OWNER, trip: TRIP }) },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; details: { problems: { day: string; field: string }[] } };
    expect(body.error).toBe("stored_document_invalid");
    expect(body.details.problems[0]).toMatchObject({ day: "2026-09-28-ferry", field: "declined.transportMode" });
  });

  test("the list still answers, with that trip's days summarised", async () => {
    const { GET } = await import("@/app/api/v2/[user]/trips/route");
    const res = await GET(new Request(`https://example.test/api/v2/${OWNER}/trips`, { headers: headers() }), { params: Promise.resolve({ user: OWNER }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { trips: { id: string }[] };
    expect(body.trips.map((t) => t.id)).toContain(TRIP);
  });

  test("the day can be repaired with a PATCH, after which the trip saves", async () => {
    const day = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
    const fix = await day.PATCH(
      new Request(`https://example.test/api/v2/${OWNER}/trips/${TRIP}/days/2026-09-28`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ declined: { transportMode: "walked everywhere that day" } }),
      }),
      { params: Promise.resolve({ user: OWNER, trip: TRIP, slug: "2026-09-28-ferry" }) },
    );
    expect(fix.status).toBe(200);
    const { PATCH } = await import("@/app/api/v2/[user]/trips/[trip]/route");
    const res = await PATCH(
      new Request(`https://example.test/api/v2/${OWNER}/trips/${TRIP}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ title: "Renamed" }) }),
      { params: Promise.resolve({ user: OWNER, trip: TRIP }) },
    );
    expect(res.status).toBe(200);
  });
});
