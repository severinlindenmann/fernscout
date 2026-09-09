import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { openApiDocument } from "@/lib/api/openapi";
import { POST as createTripRoute } from "@/app/api/v1/[user]/trips/route";
import { GET as readTripRoute } from "@/app/api/v1/[user]/trips/[trip]/route";
import { POST as createDayRoute } from "@/app/api/v1/[user]/trips/[trip]/days/route";
import { GET as readDayRoute } from "@/app/api/v1/[user]/trips/[trip]/days/[slug]/route";

/**
 * Send every field the document offers, then read it back.
 *
 * The rule this enforces is one `…/days/[slug]/route.ts` already states in a
 * comment: **a field the API takes is a field it has to show**. Until B540 it
 * was not true, and the way it failed is the dangerous way — `201 Created`,
 * and the field gone. `countryCode`, `tracks`, `travelScene` and five trip
 * fields were each accepted and unreadable, and every one of them had been
 * read past by people who knew the code.
 *
 * A test that listed the fields itself would rot the same way the document
 * did, so the **field list comes from the document** and the samples are
 * matched against it. Add a field to a request schema and this fails until you
 * either give it a sample or say, in `WRITE_ONLY` below, why it cannot be read
 * back — with a reason, not a shrug.
 */

/**
 * A plausible value per field. Deliberately not generated from the type: half
 * of these have a shape a `string` cannot express (a date, an address, a
 * locale), and a generated `"x"` would test that the field survives without
 * testing that a real one does.
 */
const TRIP_SAMPLES: Record<string, unknown> = {
  id: "roundtrip",
  title: "Rundreise",
  start: "2026-09-01",
  end: "2026-09-05",
  tagline: "Eine Zeile",
  status: "past",
  accent: "green",
  visibility: "guest",
  listed: false,
  // Only meaningful on a closed trip, which the `visibility` above makes this
  // one — B587.
  teaser: true,
  costsVisibility: "guests",
  test: true,
  intro: "Die Einleitung.",
  people: [{ name: "Alex Beispiel", email: "alex@example.test" }],
  travellers: [{ for: "alex@example.test", hair: "brown" }],
  rates: { EUR: 0.94 },
  tracks: { costs: false, coordinates: false, photos: false },
  translations: { en: { title: "Round trip", tagline: "One line" } },
};

const DAY_SAMPLES: Record<string, unknown> = {
  title: "Ein Tag",
  date: "2026-09-02",
  content: "Die Prosa des Tages.",
  time: "14:30",
  location: "Lissabon",
  country: "Portugal",
  countryCode: "PT",
  lat: 38.7223,
  lng: -9.1393,
  tags: ["eins", "zwei"],
  costs: [{ label: "Kaffee", amount: 3, currency: "EUR", category: "food" }],
  transportMode: "train",
  transportFrom: "Porto",
  transportTo: "Lissabon",
  travelScene: "quick",
  test: true,
  visibility: "guest",
  translations: { en: { title: "A day", content: "The day's prose." } },
};

/**
 * Fields that cannot be sent in a body carrying everything else, or cannot be
 * read back — each with the reason, because "it does not round-trip" is a
 * claim that needs one.
 */
const TRIP_WRITE_ONLY: Record<string, string> = {};

const DAY_WRITE_ONLY: Record<string, string> = {
  // A decline is only ever `false`, and it contradicts the positive answer
  // this body also carries: a day cannot both have coordinates and say it has
  // none. Covered by test/day-contract tests instead.
  coordinates: "only ever false, and this body sends lat/lng",
  photos: "only ever false, and photographs are a separate call",
  costs: "sent as a list here; the `false` form is the decline, tested elsewhere",
  // Asks the server to go and look something up, rather than carrying a value.
  weather: "a request for a lookup, not a value — the answer arrives as weatherData",
  weatherData: "needs source and recordedAt, and is refused from an agent's own knowledge",
  idempotency_key: "names the write, and is not part of the day",
  dryRun: "checks the body and writes nothing; covered by test/day-contract.test.ts instead",
};

let dir: string;
const OWNER_EMAIL = "alex@example.test";

async function token(): Promise<string> {
  const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
  const verified = await verifyCode("alex", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error("no token");
  return verified.token;
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function propertiesOf(pathName: string, verb: string): Record<string, unknown> {
  const doc = openApiDocument() as unknown as {
    paths: Record<string, Record<string, { requestBody?: { content?: Record<string, { schema?: { $ref?: string; properties?: Record<string, unknown> } }> } }>>;
    components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
  };
  const schema = doc.paths[pathName]?.[verb]?.requestBody?.content?.["application/json"]?.schema;
  const resolved = schema?.$ref ? doc.components.schemas[schema.$ref.split("/").pop() as string] : schema;
  return (resolved?.properties ?? {}) as Record<string, unknown>;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-roundtrip-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "roundtrip-test-secret-b540";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: { auth: { enabled: true } } }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "de",
      locales: ["de", "en"],
      baseCurrency: "CHF",
      visibility: "public",
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

describe("every field POST .../trips documents", () => {
  const documented = () => Object.keys(propertiesOf("/api/v1/{user}/trips", "post"));

  test("has a sample here, or a written reason it cannot have one", () => {
    const uncovered = documented().filter(
      (field) => !(field in TRIP_SAMPLES) && !(field in TRIP_WRITE_ONLY),
    );
    expect(
      uncovered,
      `add a sample to TRIP_SAMPLES for ${uncovered.join(", ")}, or a reason to TRIP_WRITE_ONLY`,
    ).toEqual([]);
  });

  test("survives being written and read back", async () => {
    const body = Object.fromEntries(
      documented().filter((f) => f in TRIP_SAMPLES).map((f) => [f, TRIP_SAMPLES[f]]),
    );
    const created = await createTripRoute(
      new Request("https://t.test/api/v1/alex/trips", {
        method: "POST",
        headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ user: "alex" }) },
    );
    expect(created.status, JSON.stringify(await json(created.clone()))).toBe(201);

    const read = await json(
      await readTripRoute(
        new Request("https://t.test/api/v1/alex/trips/roundtrip", {
          headers: { authorization: `Bearer ${await token()}` },
        }),
        { params: Promise.resolve({ user: "alex", trip: "roundtrip" }) },
      ),
    );

    const missing = Object.keys(body).filter((field) => field !== "id" && read[field] === undefined);
    expect(
      missing,
      `written and not readable back: ${missing.join(", ")} — a field the API takes is a field it has to show`,
    ).toEqual([]);
  });
});

describe("every field POST .../days documents", () => {
  const documented = () => Object.keys(propertiesOf("/api/v1/{user}/trips/{trip}/days", "post"));

  test("has a sample here, or a written reason it cannot have one", () => {
    const uncovered = documented().filter(
      (field) => !(field in DAY_SAMPLES) && !(field in DAY_WRITE_ONLY),
    );
    expect(
      uncovered,
      `add a sample to DAY_SAMPLES for ${uncovered.join(", ")}, or a reason to DAY_WRITE_ONLY`,
    ).toEqual([]);
  });

  test("survives being written and read back", async () => {
    await createTripRoute(
      new Request("https://t.test/api/v1/alex/trips", {
        method: "POST",
        headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
        body: JSON.stringify({ ...TRIP_SAMPLES, translations: undefined }),
      }),
      { params: Promise.resolve({ user: "alex" }) },
    );

    const body = Object.fromEntries(
      documented().filter((f) => f in DAY_SAMPLES).map((f) => [f, DAY_SAMPLES[f]]),
    );
    const created = await createDayRoute(
      new Request("https://t.test/api/v1/alex/trips/roundtrip/days", {
        method: "POST",
        headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ user: "alex", trip: "roundtrip" }) },
    );
    const madeBody = await json(created.clone());
    expect(created.status, JSON.stringify(madeBody)).toBe(201);

    const read = await json(
      await readDayRoute(
        new Request(`https://t.test/api/v1/alex/trips/roundtrip/days/${madeBody.slug}`, {
          headers: { authorization: `Bearer ${await token()}` },
        }),
        { params: Promise.resolve({ user: "alex", trip: "roundtrip", slug: String(madeBody.slug) }) },
      ),
    );

    // `transportMode`/`From`/`To` come back as one `transport` object, which is
    // the day's own shape rather than the request's — a real answer to "did it
    // survive", just not a same-named one.
    const readable = { ...read, ...(read.transport as object ?? {}) } as Record<string, unknown>;
    const alias: Record<string, string> = {
      transportMode: "mode",
      transportFrom: "from",
      transportTo: "to",
    };
    const missing = Object.keys(body).filter(
      (field) => readable[alias[field] ?? field] === undefined,
    );
    expect(
      missing,
      `written and not readable back: ${missing.join(", ")} — a field the API takes is a field it has to show`,
    ).toEqual([]);
  });
});
