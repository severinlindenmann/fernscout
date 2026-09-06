import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { getTrip } from "@/lib/trips";
import { POST as createTripRoute } from "@/app/api/v1/[user]/trips/route";
import { POST as createDayRoute } from "@/app/api/v1/[user]/trips/[trip]/days/route";
import { GET as readDayRoute, PATCH as editDayRoute } from "@/app/api/v1/[user]/trips/[trip]/days/[slug]/route";

/**
 * B540 — `countryCode` was accepted, answered 201, and thrown away.
 *
 * The field has been on `Entry` since the flag was added, and every entry
 * written by ingest carries one. Nothing on the write side ever read it out of
 * a request body, so an agent copying a journal onto a hosted instance sent
 * `countryCode: "PT"` fourteen times, was told each time that the day had been
 * created, and got fourteen days with no flag. That is the shape of failure
 * this repository keeps finding: not a refusal, a success that quietly did
 * less than it said.
 */

let dir: string;
const OWNER_EMAIL = "alex@example.test";

async function token(): Promise<string> {
  const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
  const verified = await verifyCode("alex", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error("no token");
  return verified.token;
}

async function createTrip(body: unknown) {
  const response = await createTripRoute(
    new Request("https://t.test/api/v1/alex/trips", {
      method: "POST",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "alex" }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-day-countrycode-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "day-countrycode-test-secret-b540";
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
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});


async function createDay(body: unknown) {
  const response = await createDayRoute(
    new Request("https://t.test/api/v1/alex/trips/reise/days", {
      method: "POST",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "alex", trip: "reise" }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function readDay(slug: string) {
  const response = await readDayRoute(
    new Request(`https://t.test/api/v1/alex/trips/reise/days/${slug}`, {
      headers: { authorization: `Bearer ${await token()}` },
    }),
    { params: Promise.resolve({ user: "alex", trip: "reise", slug }) },
  );
  return (await response.json()) as Record<string, unknown>;
}

async function editDay(slug: string, patch: unknown) {
  const response = await editDayRoute(
    new Request(`https://t.test/api/v1/alex/trips/reise/days/${slug}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
    { params: Promise.resolve({ user: "alex", trip: "reise", slug }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** A trip that asks nothing of its days, so these tests are about one field. */
async function trip() {
  await createTripRoute(
    new Request("https://t.test/api/v1/alex/trips", {
      method: "POST",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify({
        id: "reise",
        title: "Reise",
        start: "2026-09-01",
        end: "2026-09-05",
        tracks: { costs: false, coordinates: false, photos: false },
      }),
    }),
    { params: Promise.resolve({ user: "alex" }) },
  );
}

const day = { title: "Lissabon", date: "2026-09-01", content: "Ein Tag." };

describe("countryCode on a day", () => {
  /**
   * Deliberately a country whose name `countryCodeFor` (lib/flags.ts) cannot
   * turn into a code by itself, and then a day with no `country` at all.
   * "Portugal" would have passed this test with the bug still in place — the
   * guess supplies PT — which is exactly how a field can look like it works
   * while never being read.
   */
  test("survives the write, where nothing could have guessed it", async () => {
    await trip();
    const created = await createDay({ ...day, country: "Kosovo", countryCode: "XK" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(await readDay("lissabon")).toMatchObject({ country: "Kosovo", countryCode: "XK" });
  });

  test("survives with no country name to guess from", async () => {
    await trip();
    await createDay({ ...day, countryCode: "PT" });
    expect(await readDay("lissabon")).toMatchObject({ countryCode: "PT" });
  });

  test("wins over the name, when the two disagree", async () => {
    await trip();
    await createDay({ ...day, country: "Portugal", countryCode: "ES" });
    expect(await readDay("lissabon")).toMatchObject({ countryCode: "ES" });
  });

  test("is uppercased, so a caller need not know which case the flag table wants", async () => {
    await trip();
    await createDay({ ...day, countryCode: "xk" });
    expect(await readDay("lissabon")).toMatchObject({ countryCode: "XK" });
  });

  test("is refused when it is not two letters, rather than written and ignored", async () => {
    await trip();
    const created = await createDay({ ...day, countryCode: "PRT" });
    expect(created.status).toBe(400);
    expect(JSON.stringify(created.body)).toContain("countryCode");
  });

  test("can be corrected afterwards — a field that can be written can be edited", async () => {
    await trip();
    await createDay({ ...day, countryCode: "PT" });
    const patched = await editDay("lissabon", { countryCode: "ES" });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(await readDay("lissabon")).toMatchObject({ countryCode: "ES" });
  });
});
