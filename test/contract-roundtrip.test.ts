import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { tripCreate, dayWrite } from "@/lib/api/v2/schemas";
import { PUT as putTripRoute, GET as readTripRoute } from "@/app/api/v2/[user]/trips/[trip]/route";
import { PUT as putDayRoute, GET as readDayRoute } from "@/app/api/v2/[user]/trips/[trip]/days/[slug]/route";

/**
 * Send every field the v2 write schema accepts, then read it back.
 *
 * B1612 repoints this from the deleted v1 `POST .../trips` / `POST
 * .../days` onto their v2 replacements, `PUT .../trips/{trip}` and
 * `PUT .../days/{slug}`. The rule is unchanged from B540: **a field the API
 * takes is a field it has to show** — "it was accepted" and "it is there"
 * are the same claim (AGENTS.md). Until B540 that was not true, and the way
 * it failed is the dangerous way: `201 Created`, and the field gone.
 *
 * `/v2/openapi.json` does not exist yet (a later ticket — see
 * `lib/api/v2/schemas/shared.ts`'s own comment), so unlike the v1 version of
 * this file the field list cannot come from a generated document. It comes
 * from the zod write schema instead (`tripCreate`/`dayWrite` themselves,
 * `.def.shape`) — the same source of truth the route validates every
 * request against, so a field added to the schema and forgotten here still
 * fails this test rather than going unwatched until the document exists.
 *
 * A test that listed the fields itself would rot the same way the v1
 * document did, so the **field list comes from the schema** and the samples
 * are matched against it. Add a field to a write schema and this fails until
 * you either give it a sample or say, in `*_WRITE_ONLY` below, why it cannot
 * be read back — with a reason, not a shrug.
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
  dates: { from: "2026-09-01", to: "2026-09-05" },
  visibility: "public",
  listed: false,
  people: [{ name: "Alex Beispiel", email: "alex@example.test" }],
  rates: { currencies: ["EUR"], manual: { VND: 30500 } },
  costs: {
    budget: { total: 1000, days: 5, currency: "CHF" },
    items: [{ label: "Flights", amount: 500, currency: "CHF", category: "transport" }],
    note: "Ein Budget.",
    visibility: "guests",
  },
  plan: {
    route: [{ location: "Lissabon", lat: 38.7223, lng: -9.1393, country: "Portugal", countryCode: "PT", note: "Start" }],
    body: "Die Route.",
  },
  days: [
    {
      slug: "2026-09-02-a-day",
      title: "Ein eingebetteter Tag",
      date: "2026-09-02",
      content: "Am ersten Tag angekommen.",
      status: "draft",
      // B1626 — `cover` (below) is now checked against the trip's own media
      // at the door, so this embedded day carries the photo `cover` names
      // rather than declining media outright.
      media: [{ src: "roundtrip/cover.jpg" }],
      declined: {
        costs: "nothing spent today, tracked elsewhere",
        coordinates: "no position recorded for this day",
        weather: "weather was not asked for this day",
        time: "the exact time of day was not recorded",
        timezone: "no timezone established for this leg",
        location: "no specific location named for this day",
        country: "no country named for this day entry",
        countryCode: "no country code named for this day",
        transportMode: "no transport leg happened this day",
        tags: "no tags applied to this day",
        translations: "single-language journal, nothing to translate",
        visibility: "no narrower visibility set for this day",
      },
    },
  ],
  translations: { en: { title: "Round trip", tagline: "One line", intro: "The introduction." } },
  accent: "green",
  cover: "roundtrip/cover.jpg",
  figures: { mode: "off" },
  tagline: "Eine Zeile",
  intro: "Die Einleitung.",
  test: true,
  declined: { buddies: "travelling solo, nobody else was on this trip" },
};

const DAY_SAMPLES: Record<string, unknown> = {
  slug: "2026-09-10-ein-tag",
  title: "Ein Tag",
  date: "2026-09-10",
  content: "Die Prosa des Tages.",
  // B1612 FINDING: sending `media` currently crashes PUT .../days/{slug}
  // with an uncaught ZodError rather than a 201. `toStoredMedia`
  // (lib/api/v2/days.ts) stamps every item with a placeholder `type:
  // "image"` — deliberately, per that file's own comment, because the v2
  // media door is "a sibling parcel, not built yet as this lands" — and
  // `dayDoc`'s media item schema (lib/api/v2/schemas/day.ts, extending the
  // strict `dayMediaItem`) does not accept `type` at all, so the route's own
  // echo (`dayDoc.parse(dayEchoInput(toWrite))`) throws on the value the
  // route itself just wrote. The same throw would hit `GET` for any day
  // already carrying media. Left in the sample, and this test left failing
  // here, on purpose — this is exactly what this file exists to catch.
  media: [{ src: "roundtrip/a-day/photo.jpg", caption: "Ein Foto" }],
  costs: [{ label: "Kaffee", amount: 3, currency: "EUR", category: "food" }],
  coordinates: { lat: 38.7223, lng: -9.1393 },
  time: "14:30",
  // B42 — the zone `time` is a wall clock in, so a reader elsewhere and the
  // RSS pubDate both know what 14:30 meant.
  timezone: "Asia/Bangkok",
  location: "Lissabon",
  country: "Portugal",
  countryCode: "PT",
  transportMode: "train",
  tags: ["eins", "zwei"],
  translations: { en: { title: "A day", content: "The day's prose." } },
  visibility: "guest",
  status: "draft",
  transportFrom: "Porto",
  transportTo: "Lissabon",
  travelScene: "quick",
  test: true,
};

/**
 * Fields that cannot be sent in a body carrying everything else, or cannot be
 * read back — each with the reason, because "it does not round-trip" is a
 * claim that needs one.
 */
const TRIP_WRITE_ONLY: Record<string, string> = {
  teaser: "only meaningful on a closed trip (guest/private) — this sample is public, where `listed` is the key that decides (B587)",
};

const DAY_WRITE_ONLY: Record<string, string> = {
  // Asks the server to go and look something up, rather than carrying a value.
  weather: "a request for a lookup, not a value — the answer arrives as weatherData",
  // This sample answers every required-or-declined field directly rather
  // than declining any of them, so there is nothing for `declined` itself to
  // carry here — the decline mechanism is covered by test/day-contract.test.ts.
  declined: "this sample answers every declinable directly; the decline mechanism is tested elsewhere",
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

function documentedTripFields(): string[] {
  return Object.keys((tripCreate as unknown as { def: { shape: Record<string, unknown> } }).def.shape);
}

function documentedDayFields(): string[] {
  return Object.keys((dayWrite as unknown as { def: { shape: Record<string, unknown> } }).def.shape);
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

describe("every field PUT .../trips/{trip} accepts", () => {
  test("has a sample here, or a written reason it cannot have one", () => {
    const uncovered = documentedTripFields().filter(
      (field) => !(field in TRIP_SAMPLES) && !(field in TRIP_WRITE_ONLY),
    );
    expect(
      uncovered,
      `add a sample to TRIP_SAMPLES for ${uncovered.join(", ")}, or a reason to TRIP_WRITE_ONLY`,
    ).toEqual([]);
  });

  test("survives being written and read back", async () => {
    const fields = documentedTripFields().filter((f) => f in TRIP_SAMPLES);
    const body = Object.fromEntries(fields.map((f) => [f, TRIP_SAMPLES[f]]));
    const created = await putTripRoute(
      new Request("https://t.test/api/v2/alex/trips/roundtrip", {
        method: "PUT",
        headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ user: "alex", trip: "roundtrip" }) },
    );
    expect(created.status, JSON.stringify(await json(created.clone()))).toBe(201);

    const read = await json(
      await readTripRoute(
        new Request("https://t.test/api/v2/alex/trips/roundtrip", {
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

describe("every field PUT .../days/{slug} accepts", () => {
  const tripBody = {
    ...TRIP_SAMPLES,
    id: "roundtrip-days",
    days: undefined,
    // B1626 — this trip carries no days (and so no media) of its own; a
    // `cover` naming a photo nothing here has would now be refused
    // (`checkCover`, lib/api/v2/write.ts). The day round trip below is what
    // this fixture exists to exercise, not the trip's own `cover`.
    cover: undefined,
    declined: { ...(TRIP_SAMPLES.declined as Record<string, string>), days: "no days written for this trip at create time" },
  };

  async function createTrip() {
    const response = await putTripRoute(
      new Request("https://t.test/api/v2/alex/trips/roundtrip-days", {
        method: "PUT",
        headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
        body: JSON.stringify(tripBody),
      }),
      { params: Promise.resolve({ user: "alex", trip: "roundtrip-days" }) },
    );
    if (response.status >= 300) {
      throw new Error(`trip fixture failed: ${response.status} ${JSON.stringify(await response.clone().json())}`);
    }
  }

  test("has a sample here, or a written reason it cannot have one", () => {
    const uncovered = documentedDayFields().filter(
      (field) => !(field in DAY_SAMPLES) && !(field in DAY_WRITE_ONLY),
    );
    expect(
      uncovered,
      `add a sample to DAY_SAMPLES for ${uncovered.join(", ")}, or a reason to DAY_WRITE_ONLY`,
    ).toEqual([]);
  });

  test("survives being written and read back", async () => {
    await createTrip();

    const fields = documentedDayFields().filter((f) => f in DAY_SAMPLES);
    const body: Record<string, unknown> = Object.fromEntries(fields.map((f) => [f, DAY_SAMPLES[f]]));
    // `weather` is a request, not a value (see DAY_WRITE_ONLY) — declined
    // here so the required-or-declined check has an answer, same as any
    // other day that was not asked to look its weather up.
    body.declined = { weather: "weather was not asked for this day" };
    const created = await putDayRoute(
      new Request(`https://t.test/api/v2/alex/trips/roundtrip-days/days/${DAY_SAMPLES.slug}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ user: "alex", trip: "roundtrip-days", slug: String(DAY_SAMPLES.slug) }) },
    );
    const madeBody = await json(created.clone());
    expect(created.status, JSON.stringify(madeBody)).toBe(201);

    const read = await json(
      await readDayRoute(
        new Request(`https://t.test/api/v2/alex/trips/roundtrip-days/days/${DAY_SAMPLES.slug}`, {
          headers: { authorization: `Bearer ${await token()}` },
        }),
        { params: Promise.resolve({ user: "alex", trip: "roundtrip-days", slug: String(DAY_SAMPLES.slug) }) },
      ),
    );

    const missing = Object.keys(body).filter((field) => read[field] === undefined);
    expect(
      missing,
      `written and not readable back: ${missing.join(", ")} — a field the API takes is a field it has to show`,
    ).toEqual([]);
  });
});
