import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, tripWriteScope, verifyCode } from "@/lib/auth";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * Taking a day back off the site, over the documented API — B905, repointed
 * onto v2's `POST .../days/{slug}/unpublish` for B1612.
 *
 * `.../publish` has existed since B28. Taking a day down existed only at
 * `POST /api/helper/<user>/day/unpublish` — cookie-only, outside the published
 * contract, added for the browser. So an agent over the network could publish
 * and could not undo it, which is a gate backwards: the **reversible** half of
 * the pair was the half that was missing, and the person most likely to need
 * it is the one whose friend has just asked to come out of a photograph.
 *
 * What is asserted here is that it mirrors publishing rather than merely
 * resembling it — same refusals, same owner rule — and that it is not a
 * delete. Unlike `day-mail.test.ts`'s publish/send parcel, this route never
 * touches `sendDayLetter` or any v1 reader — `writeDayFile`/`readDayFile`
 * (`lib/api/v2/store.ts`) is its whole storage — so there is no B1598
 * read-layer gap here: this repoints cleanly onto the v2 JSON document and
 * the v2 GET route reads it back.
 */

const OWNER = "alex";
const OWNER_EMAIL = "alex@example.test";
const COMPANION_EMAIL = "mara@example.test";
const TRIP_ID = "reise";

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.9.${calls % 250}`, ...extra };
}

async function tokenFor(email: string, trip?: string): Promise<string> {
  const { code } = await issueCode(OWNER, email, "agent", trip ? { trip } : undefined);
  const verified = await verifyCode(OWNER, email, code, "agent", trip ? tripWriteScope(trip) : undefined);
  if (!verified.ok) throw new Error(`no token for ${email}`);
  return verified.token;
}

type Body = Record<string, unknown> & { error?: string; message?: string };

function fullTrip(): Record<string, unknown> {
  return {
    id: TRIP_ID,
    title: "Reise",
    dates: { from: "2026-09-01", to: "2026-09-05" },
    visibility: "public",
    // The owner plus Mara: v2's `people` is the whole party (unlike v1's own
    // `people:`, which listed only the non-owner buddies). Byline only since
    // B2297 — Mara's actual write access, tested below, comes from a real
    // granted `trip_people` place, not from being named here.
    people: [
      { name: "A B", email: OWNER_EMAIL },
      { name: "Mara", email: COMPANION_EMAIL },
    ],
    declined: {
      rates: "no foreign currency tracked",
      costs: "no budget tracked",
      plan: "no planned route recorded",
      days: "days are written one at a time",
      translations: "single-language journal",
      accent: "default accent",
      figures: "no walking figures drawn",
      tagline: "no subtitle written",
      intro: "no opening prose written",
      listed: "not advertised for this fixture",
    },
  };
}

function fullDayBody(slug: string): Record<string, unknown> {
  return {
    slug,
    title: "Ein Tag",
    date: slug.slice(0, 10),
    content: "Etwas ist passiert.",
    status: "draft",
    declined: {
      media: "no photographs attached to this day yet",
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
  };
}

async function putTrip() {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const response = await PUT(
    new Request(`https://t.test/api/v2/${OWNER}/trips/${TRIP_ID}`, {
      method: "PUT",
      headers: headers({ authorization: `Bearer ${await tokenFor(OWNER_EMAIL)}` }),
      body: JSON.stringify(fullTrip()),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP_ID }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

async function write(slug: string) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await PUT(
    new Request(`https://t.test/api/v2/${OWNER}/trips/${TRIP_ID}/days/${slug}`, {
      method: "PUT",
      headers: headers({ authorization: `Bearer ${await tokenFor(OWNER_EMAIL)}` }),
      body: JSON.stringify(fullDayBody(slug)),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP_ID, slug }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

async function publish(slug: string, trip = TRIP_ID) {
  const { POST } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/publish/route");
  const response = await POST(
    new Request(`https://t.test/api/v2/${OWNER}/trips/${trip}/days/${slug}/publish`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${await tokenFor(OWNER_EMAIL)}` }),
      body: "{}",
    }),
    { params: Promise.resolve({ user: OWNER, trip, slug }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

async function unpublish(slug: string, token?: string, trip = TRIP_ID) {
  const { POST } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/unpublish/route");
  const response = await POST(
    new Request(`https://t.test/api/v2/${OWNER}/trips/${trip}/days/${slug}/unpublish`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token ?? (await tokenFor(OWNER_EMAIL))}` }),
    }),
    { params: Promise.resolve({ user: OWNER, trip, slug }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

async function getDay(slug: string, trip = TRIP_ID) {
  const { GET } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await GET(
    new Request(`https://t.test/api/v2/${OWNER}/trips/${trip}/days/${slug}`, {
      headers: headers({ authorization: `Bearer ${await tokenFor(OWNER_EMAIL)}` }),
    }),
    { params: Promise.resolve({ user: OWNER, trip, slug }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-unpublish-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "unpublish-route-secret-b905-b905-b905";
  process.env.CONTACTS_ENCRYPTION_KEY = "b9".repeat(32);
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: { auth: { enabled: true } } }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  const { createJournal } = await import("@/lib/journals");
  const created = createJournal({
    username: OWNER,
    title: "Alex",
    ownerEmail: OWNER_EMAIL,
    ownerName: "A B",
    ownerNickname: "Alex",
  });
  if (!created.ok) throw new Error(created.message);

  await putTrip();
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function aPublishedDay(): Promise<string> {
  const slug = "2026-09-02-ein-tag";
  const written = await write(slug);
  if (written.status !== 201) throw new Error(`the day was not written: ${JSON.stringify(written.body)}`);
  const up = await publish(slug);
  expect(up.status).toBe(200);
  return slug;
}

describe("a day that is on the site", () => {
  test("comes off, and nothing is deleted", async () => {
    const slug = await aPublishedDay();
    const before = (await getDay(slug)).body;

    const down = await unpublish(slug);
    expect(down.status).toBe(200);
    expect(down.body.status).toBe("draft");

    const after = (await getDay(slug)).body;
    expect(after.status).toBe("draft");
    // The whole of what a takedown is: the day is still there.
    expect(after.title).toBe(before.title);
    expect(after.content).toBe(before.content);
    expect(after.date).toBe(before.date);
  });

  test("and can be put back, which is what makes it not a delete", async () => {
    const slug = await aPublishedDay();
    expect((await unpublish(slug)).status).toBe(200);
    expect((await publish(slug)).status).toBe(200);
    expect((await getDay(slug)).body.status).toBe("published");
  });

  test("says what happened in words to repeat, including what it cannot undo", async () => {
    const slug = await aPublishedDay();
    const note = String((await unpublish(slug)).body.note);
    expect(note).toContain("undo");
  });
});

describe("what it refuses", () => {
  test("a day that was never up, rather than a cheerful 200", async () => {
    const slug = "2026-09-03-entwurf";
    await write(slug);
    const down = await unpublish(slug);
    expect(down.status).toBe(409);
    expect(down.body.error).toBe("already_draft");
  });

  test("a day that does not exist", async () => {
    expect((await unpublish("2026-09-04-kein-tag")).status).toBe(404);
  });

  test("a trip that does not exist", async () => {
    const down = await unpublish("2026-09-04-egal", undefined, "keine-reise");
    expect(down.status).toBe(404);
    expect(down.body.error).toBe("unknown_trip");
  });

  test("no token at all", async () => {
    const { POST } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/unpublish/route");
    const response = await POST(
      new Request(`https://t.test/api/v2/${OWNER}/trips/${TRIP_ID}/days/x/unpublish`, { method: "POST" }),
      { params: Promise.resolve({ user: OWNER, trip: TRIP_ID, slug: "x" }) },
    );
    expect(response.status).toBe(401);
  });

  /**
   * The rule publishing sets, mirrored — and it cuts both ways, which is the
   * point. Somebody who came on one trip may write days into it and may
   * neither put them on the site nor take them off: being on the bus is not
   * the same as deciding what the journal says.
   */
  test("a trip-scoped token, which may write days but not take them down", async () => {
    const slug = await aPublishedDay();

    // B2297: a name in `people:` (Mara, above) is the byline only and grants
    // nothing — the companion's write access has to be a real, granted
    // `trip_people` place, the same as Studio › Readers would create.
    const { requestContact, confirmContact, approveContact } = await import("@/lib/contacts");
    const { claimTripPlace, approveTripPlaces } = await import("@/lib/tripPeople");
    const { issueCode: issue } = await import("@/lib/auth");
    const requested = await requestContact(OWNER, {
      name: "Mara",
      email: COMPANION_EMAIL,
      locale: "en",
      address: null,
      wantsEmailDigest: false,
      wantsPostcard: false,
      createdVia: "open",
    });
    if (requested.outcome === "ignored" || !requested.contactId) throw new Error("contact refused");
    const { code } = await issue(OWNER, COMPANION_EMAIL, "guest");
    await confirmContact(OWNER, COMPANION_EMAIL, code);
    await approveContact(OWNER, requested.contactId);
    await claimTripPlace(OWNER, TRIP_ID, requested.contactId, null);
    await approveTripPlaces(OWNER, requested.contactId);

    const companion = await tokenFor(COMPANION_EMAIL, TRIP_ID);
    const down = await unpublish(slug, companion);
    expect(down.status).toBe(403);
    expect(down.body.error).toBe("out_of_scope");
    expect(String(down.body.message)).toMatch(/cannot|only the journal's owner/i);
    // And it really is still up.
    expect((await getDay(slug)).body.status).toBe("published");
  });
});
