import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { parsePolarstepsTrip } from "@/importers/trips/polarsteps";
import { tripA, tripB, locationsJsonFor } from "./fixtures/polarsteps";

/**
 * The server half of B2432: a Polarsteps trip.json becomes a draft trip and
 * one draft day per local date, never a coordinate in a day file, and a
 * second import of the same trip refuses rather than duplicates.
 */

describe("parsePolarstepsTrip — grouping and timezones, no server needed", () => {
  test("a step at 23:30 America/New_York lands on that local date, not the UTC one", () => {
    const parsed = parsePolarstepsTrip(tripA);
    const dates = parsed.days.map((d) => d.date);
    expect(dates).toContain("2026-05-01");
    expect(dates).not.toContain("2026-05-02");
  });

  test("a step crossing UTC midnight in Asia/Tokyo lands on its own local date", () => {
    const parsed = parsePolarstepsTrip(tripB);
    const dates = parsed.days.map((d) => d.date);
    expect(dates).toContain("2026-07-11");
    expect(dates).not.toContain("2026-07-10");
  });

  test("all_steps is sorted into time order regardless of input order", () => {
    const parsed = parsePolarstepsTrip(tripA);
    expect(parsed.days.map((d) => d.date)).toEqual(["2026-04-15", "2026-04-16", "2026-05-01"]);
  });

  test("one day per local date that actually has a step — no gaps invented", () => {
    const parsed = parsePolarstepsTrip(tripA);
    expect(parsed.days).toHaveLength(3);
    expect(parsed.start).toBe("2026-04-15");
    expect(parsed.end).toBe("2026-05-01");
  });
});

const OWNER = "pia";
const OWNER_EMAIL = "pia@example.test";
let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "x-forwarded-for": `10.9.0.${calls % 250}`, ...extra };
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

async function importCall(token: string, body: Record<string, unknown>, dryRun = false) {
  const { POST } = await import("@/app/api/v2/[user]/import/route");
  const url = `https://example.test/api/v2/${OWNER}/import${dryRun ? "?dryRun=true" : ""}`;
  const response = await POST(
    new Request(url, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}`, "content-type": "application/json" }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: await response.json() };
}

async function kindsListed(token: string): Promise<string[]> {
  const { GET } = await import("@/app/api/v2/[user]/import/route");
  const response = await GET(
    new Request(`https://example.test/api/v2/${OWNER}/import`, { headers: headers({ authorization: `Bearer ${token}` }) }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  const body = await response.json();
  return (body.kinds as { kind: string }[]).map((k) => k.kind);
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-polarsteps-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "88".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Test Journal",
      owner: { name: "P", nickname: "P", email: OWNER_EMAIL },
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
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/v2/<user>/import, kind polarsteps", () => {
  test("GET lists the kind", async () => {
    const token = await ownerToken();
    expect(await kindsListed(token)).toContain("polarsteps");
  });

  test("?dryRun previews without writing anything", async () => {
    const token = await ownerToken();
    const { status, body } = await importCall(token, { kind: "polarsteps", text: JSON.stringify(tripA) }, true);
    expect(status).toBe(200);
    expect(body.dryRun).toBe(true);
    expect(body.title).toBe("Alpine Loop");
    expect(body.days.map((d: { date: string }) => d.date)).toEqual(["2026-04-15", "2026-04-16", "2026-05-01"]);
    expect(body.tripId).toBeUndefined();
    expect(fs.existsSync(path.join(dir, OWNER, "trips"))).toBe(false);
  });

  test("a real import writes a draft trip with one day per local date, verbatim text, no invented weather", async () => {
    const token = await ownerToken();
    const { status, body } = await importCall(token, { kind: "polarsteps", text: JSON.stringify(tripA) });
    expect(status).toBe(200);
    expect(body.dryRun).toBe(false);
    const tripId = body.tripId as string;
    expect(tripId).toMatch(/^alpine-loop-ps5001$/);

    const tripFile = path.join(dir, OWNER, "trips", tripId, "trip.json");
    const trip = JSON.parse(fs.readFileSync(tripFile, "utf8"));
    expect(trip.title).toBe("Alpine Loop");
    // Never published — createTrip never writes a status, and lib/trips.ts
    // derives past/upcoming/current from dates, never "draft" vs "published"
    // for a trip (that is a day's own field).
    expect(trip.status).toBeUndefined();

    const entriesDir = path.join(dir, OWNER, "trips", tripId, "entries");
    const bergenFile = fs.readdirSync(entriesDir).find((f) => f.startsWith("2026-04-16"))!;
    const bergenDay = JSON.parse(fs.readFileSync(path.join(entriesDir, bergenFile), "utf8"));
    expect(bergenDay.content).toContain("Walked along the quay.");
    // The step's own name titles the day and is not repeated in its text.
    expect(bergenDay.title).toBe("Bergen harbour");
    expect(bergenDay.content).not.toContain("Bergen harbour");
    expect(bergenFile).not.toMatch(/^2026-04-16-2026-04-16/);
    expect(bergenDay.location).toBe("Bergen");
    expect(bergenDay.country).toBe("Norway");
    expect(bergenDay.weather).toEqual({ tempMax: 14, source: "polarsteps", recordedAt: new Date(tripA.all_steps[2].start_time * 1000).toISOString() });

    // The at-sea step: country_code "00" never becomes a country, and the
    // absent weather is absent, never filled in.
    const seaDayFile = fs
      .readdirSync(path.join(dir, OWNER, "trips", tripId, "entries"))
      .find((f) => f.startsWith("2026-04-15"))!;
    const seaDay = JSON.parse(fs.readFileSync(path.join(dir, OWNER, "trips", tripId, "entries", seaDayFile), "utf8"));
    expect(seaDay.country).toBeUndefined();
    expect(seaDay.weather).toBeUndefined();

    // No GPS coordinate from this import ever reaches a day file.
    const allDayText = fs
      .readdirSync(path.join(dir, OWNER, "trips", tripId, "entries"))
      .map((f) => fs.readFileSync(path.join(dir, OWNER, "trips", tripId, "entries", f), "utf8"))
      .join("\n");
    expect(allDayText).not.toContain("60.39");
    expect(allDayText).not.toContain("5.32");
  });

  test("re-importing the same trip refuses rather than duplicates", async () => {
    const token = await ownerToken();
    const { status, body } = await importCall(token, { kind: "polarsteps", text: JSON.stringify(tripA) });
    expect(status).toBe(400);
    expect(body.error).toBe("trip_exists");
  });

  test("a second, different trip imports independently", async () => {
    const token = await ownerToken();
    const { status, body } = await importCall(token, { kind: "polarsteps", text: JSON.stringify(tripB) });
    expect(status).toBe(200);
    expect(body.tripId).toMatch(/^tokyo-nights-ps5002$/);
    expect(body.days.map((d: { date: string }) => d.date)).toEqual(["2026-07-11", "2026-07-12"]);
  });

  test("garbage JSON is refused with a plain message, not a crash", async () => {
    const token = await ownerToken();
    const { status, body } = await importCall(token, { kind: "polarsteps", text: "{not json" });
    expect(status).toBe(400);
    expect(typeof body.message).toBe("string");
  });
});

describe("locations.json goes through kind: gps, never kind: polarsteps", () => {
  test("named locations.json, it is read as Polarsteps, not as Google Records (both have a top-level \"locations\")", async () => {
    const { GPS_IMPORTERS } = await import("@/importers/gps");
    const text = locationsJsonFor("a");
    const picked = GPS_IMPORTERS.find((i) => i.detect(text.slice(0, 64 * 1024), "locations.json"));
    expect(picked?.id).toBe("polarsteps");
    expect(picked?.parse(text)).toHaveLength(3);
  });

  test("the polarsteps gps importer is detected and stores only into gps/, never content", async () => {
    const token = await ownerToken();
    const { POST } = await import("@/app/api/v2/[user]/import/route");
    const response = await POST(
      new Request(`https://example.test/api/v2/${OWNER}/import`, {
        method: "POST",
        headers: headers({ authorization: `Bearer ${token}`, "content-type": "application/json" }),
        body: JSON.stringify({ kind: "gps", text: locationsJsonFor("a") }),
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.format).toBe("polarsteps");
    expect(fs.existsSync(path.join(dir, OWNER, "gps"))).toBe(true);
    // Never written anywhere under trips/ — the content tree.
    const tripsDir = path.join(dir, OWNER, "trips");
    const everything = fs
      .readdirSync(tripsDir)
      .flatMap((t) => fs.readdirSync(path.join(tripsDir, t, "entries")).map((f) => path.join(tripsDir, t, "entries", f)))
      .map((f) => fs.readFileSync(f, "utf8"))
      .join("\n");
    expect(everything).not.toContain("5.1");
  });
});
