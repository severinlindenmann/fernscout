import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

/**
 * B1663 — `sendDayWhatsapp` is triggered automatically by a publish, not by
 * somebody pressing a button, so "retry" here means something different from
 * a double-tap: `writeDayFile` flips the day out of `draft` synchronously,
 * before the send, so an ordinary retried publish call already 409s on
 * `already_published` before it ever reaches `sendDayWhatsapp` again. The
 * risk that remains is two genuinely concurrent publish calls — two Node
 * processes behind a load balancer, or two racing requests inside one — both
 * reading the day as still `draft` before either's write has landed, and both
 * reaching the send. That is exactly the race the owner's own manual resend
 * button (`app/[user]/trips/[trip]/day/[slug]/notify/route.ts`) already
 * guards against with `claimChannel`'s database-level compare-and-swap. The
 * publish route did not use that guard at all before this ticket.
 *
 * A single Node test process cannot reliably *reproduce* that race —
 * `readDayFile`/`writeDayFile` are synchronous, so two `Promise.all`-driven
 * calls in one process serialize through them without ever actually
 * overlapping, which would make a test built that way pass whether or not
 * the guard exists (an assertion that passes either way is worth nothing).
 * So this pins the mechanism directly instead: that the route now asks
 * `claimChannel` before it will send, and refuses to call `sendDayWhatsapp`
 * at all when the claim is lost — which is exactly the call this ticket
 * added and the old code never made.
 */

const { claimChannel } = vi.hoisted(() => ({ claimChannel: vi.fn(async () => true) }));
vi.mock("@/lib/digest/dayNotify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/digest/dayNotify")>()),
  claimChannel,
}));

const OWNER = "concurrentpublisher";
const OWNER_EMAIL = "concurrentpublisher@example.test";
const TRIP_ID = "utah-2026";
const TEMPLATE = "fernscout_day_published";

let dir: string;

function fullDayBody(slug: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug,
    title: "Arrival",
    date: slug.slice(0, 10),
    content: "We arrived and found the hostel without trouble.",
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
    ...overrides,
  };
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

let callCount = 0;
function headers(token: string): Record<string, string> {
  callCount += 1;
  return {
    "content-type": "application/json",
    "x-forwarded-for": `10.9.5.${callCount % 250}`,
    authorization: `Bearer ${token}`,
  };
}

async function putDay(slug: string, body: unknown, token: string) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await PUT(
    new Request(`https://example.test/api/v2/${OWNER}/trips/${TRIP_ID}/days/${slug}`, {
      method: "PUT",
      headers: headers(token),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP_ID, slug }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function publishDay(slug: string, token: string, body: unknown = { sendWhatsapp: true }) {
  const { POST } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/publish/route");
  const response = await POST(
    new Request(`https://example.test/api/v2/${OWNER}/trips/${TRIP_ID}/days/${slug}/publish`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP_ID, slug }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-publish-whatsapp-idem-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "77".repeat(32);
  process.env.CONTACTS_ENCRYPTION_KEY = "33".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        whatsapp: { enabled: true, backend: "dry-run", templates: { en: TEMPLATE } },
        credits: { enabled: false },
      },
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

  // The owner's own free copy (B614) is the simplest recipient to give this
  // journal — a proven number in `config.json`, no contacts feature wiring
  // needed beyond the switch itself.
  const created = createJournal({
    username: OWNER,
    title: "A Journal",
    ownerEmail: OWNER_EMAIL,
    ownerName: "Owner",
    ownerNickname: "Owner",
    ownerTel: "41760099999",
    ownerTelProvenAt: new Date().toISOString(),
    ownerTelProvenMethod: "sms",
  });
  if (!created.ok) throw new Error(created.message);
  // No setJournalFeatures here: decision 5 landed (B1666) and `contacts` is
  // decided by the instance for every journal on it. The server config above
  // already enables it, which is now the only place that can.

  const { writeTripFile } = await import("@/lib/api/v2/store");
  const { tripCreate } = await import("@/lib/api/v2/schemas");
  const parsedTrip = tripCreate.parse({
    id: TRIP_ID,
    title: "Utah",
    dates: { from: "2026-06-01", to: "2026-06-20" },
    visibility: "public",
    listed: false,
    people: [{ name: "Owner", email: OWNER_EMAIL }],
    declined: {
      rates: "no foreign currency tracked on this trip at all",
      costs: "no budget tracked for this trip currently",
      plan: "no planned route recorded for this trip",
      days: "no days written for this trip at create time",
      translations: "single-language journal, nothing to translate",
      accent: "default accent left as the renderer's choice",
      figures: "no walking figures drawn for this trip",
      tagline: "no one-line subtitle written for this trip",
      intro: "no opening prose written for this trip yet",
      buddies: "travelling solo, nobody else was on this trip",
    },
  });
  const { days: _ignored, ...tripFields } = parsedTrip;
  writeTripFile(OWNER, TRIP_ID, tripFields as never);
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("POST .../publish, sendWhatsapp — the double-press guard", () => {
  test("a lost claim means nothing is sent, and no outcome is invented for it", async () => {
    claimChannel.mockResolvedValueOnce(false);
    const token = await ownerToken();
    const slug = "2026-06-01-race";
    await putDay(slug, fullDayBody(slug), token);
    const { status, body } = await publishDay(slug, token);

    // The publish itself still goes through — losing the channel claim is
    // never a reason to refuse publishing the day.
    expect(status, JSON.stringify(body)).toBe(200);
    expect(claimChannel).toHaveBeenCalledWith(OWNER, TRIP_ID, "race", "whatsapp");
    // Nothing invented for a send this call never made — the same silence
    // `notify/route.ts` gives for a channel already spoken for.
    expect(body.whatsapp).toBeUndefined();

    const { getDatabase } = await import("@/lib/db");
    const { db } = (await getDatabase())!;
    const rows = await db
      .selectFrom("day_notifications")
      .selectAll()
      .where("owner_id", "=", OWNER)
      .where("trip_id", "=", TRIP_ID)
      .where("slug", "=", "race")
      .where("channel", "=", "whatsapp")
      .execute();
    // Nobody claimed the channel in this test (the mock said no), so nothing
    // recorded it as sent either.
    expect(rows).toHaveLength(0);
  });

  test("a lone publish still sends, exactly as before this guard existed", async () => {
    const token = await ownerToken();
    const slug = "2026-06-02-solo";
    await putDay(slug, fullDayBody(slug), token);

    const { status, body } = await publishDay(slug, token);
    expect(status, JSON.stringify(body)).toBe(200);
    expect((body.whatsapp as Record<string, unknown>).attempted).toBe(true);
    expect((body.whatsapp as Record<string, unknown>).sent).toBe(1);
  });
});
