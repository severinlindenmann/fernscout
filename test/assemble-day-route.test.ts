import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { missingForDayFolder } from "@/lib/dayMissing";
import { appendWords, readDayReadiness, writeDayReadiness } from "@/lib/dayReadiness";
import { ALL_TRACKED } from "@/lib/tracks";
import { dayInboxDir, findDayInboxFile, findInboxFile, inboxDir, moveInboxFileToDay, storeInboxFile } from "@/lib/inbox";
import { paintJpeg } from "./support/pictures";

/**
 * `POST /api/helper/<user>/assemble-day` — its "create it" press, Task 3 of
 * the SDD plan: inbox day-assembly Phase 3.
 *
 * Task 2 already built the "record an answer" branch this route carries
 * (`recordAnswer` below, unchanged); this file is the other half, which used
 * to always refuse `not_yet_available`. A press naming nothing but
 * `trip`/`date` is what `propose()` sends once nothing is missing, and it
 * should now create the real entry, attach its staged photographs, and
 * remove the day folder — never a second implementation of what `POST
 * .../day` already does, only reached from a date folder instead of a blank
 * screen.
 */

const OWNER_EMAIL = "alex@example.test";
const TRIP = "reise";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const { POST } = await import("@/app/api/helper/[user]/assemble-day/route");

let dir: string;

const params = { params: Promise.resolve({ user: "alex" }) };

function json(body: unknown) {
  return new Request("https://t.test/api/helper/alex/assemble-day", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-assemble-day-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "assemble-day-route-test-secret";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, "alex", "trips", TRIP, "entries"), { recursive: true });
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
  fs.writeFileSync(
    path.join(dir, "alex", "trips", TRIP, "trip.md"),
    ["---", `id: ${TRIP}`, 'title: "Die Reise"', 'start: "2026-05-01"', 'end: "2026-05-10"', "---", "", "Intro.", ""].join(
      "\n",
    ),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  vi.restoreAllMocks();
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Both halves have to say yes (`lib/capabilities.ts`'s `resolveOne`) — the
 *  server config's own switch, and this journal's own opt-in. Only the
 *  weather tests below need it, so it rewrites both configs rather than
 *  being the default every other test would otherwise have to account for. */
function enableWeather(): void {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true }, weather: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { weather: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();
}

describe("assemble-day: the create press", () => {
  test("creates the day from a ready date folder: words, photos, and readiness answers all land on the new entry", async () => {
    const date = "2026-05-04";

    const bytes = await paintJpeg(400, 300);
    const { entry } = storeInboxFile("alex", "media", "pass.jpg", bytes, { caption: "The pass" });
    moveInboxFileToDay("alex", entry.id, date);

    appendWords("alex", date, "We climbed over the pass and it was cold.");
    writeDayReadiness("alex", date, {
      without: ["costs"],
      location: { lat: 46.5, lon: 8.5, source: "browser" },
    });

    const made = await read(await POST(json({ trip: TRIP, date }), params));
    expect(made.status).toBe(201);
    const slug = String(made.body.slug);
    expect(made.body.attached).toBe(1);

    const day = getEntryBySlug(`alex/${TRIP}`, slug, AS_AUTHOR);
    expect(day).not.toBeNull();
    expect(day?.content).toContain("We climbed over the pass and it was cold.");
    expect(day?.gallery).toHaveLength(1);
    expect(day?.without).toEqual(["costs"]);
    expect(day?.lat).toBe(46.5);
    expect(day?.lng).toBe(8.5);
    expect(day?.draft).toBe(true);

    // The day folder's job was staging; a real entry now holds everything it
    // carried, so it is gone.
    expect(fs.existsSync(dayInboxDir("alex", date))).toBe(false);
  });

  test("refuses if something is still missing — the door asks again, same as POST .../day", async () => {
    const date = "2026-05-05";
    // Nothing staged: the trip tracks costs and coordinates by default, and
    // nobody has answered either.

    const refused = await read(await POST(json({ trip: TRIP, date }), params));
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("incomplete_day");
    expect(refused.body.missing).toEqual(["costs", "coordinates"]);

    // And nothing was written — the folder's own honesty about "nothing
    // decided yet" stands, and no entry appeared in the trip.
    const entries = fs.readdirSync(path.join(dir, "alex", "trips", TRIP, "entries"));
    expect(entries).toHaveLength(0);
  });
});

describe("assemble-day: final-review Fix 1 — captions", () => {
  test("answering a photo's caption clears it from missingForDayFolder, and the day can then be created carrying it", async () => {
    const date = "2026-05-06";
    const bytes = await paintJpeg(200, 150);
    const { entry } = storeInboxFile("alex", "media", "harbour.jpg", bytes, {});
    moveInboxFileToDay("alex", entry.id, date);
    writeDayReadiness("alex", date, {
      without: ["costs"],
      location: { lat: 1, lon: 2, source: "browser" },
    });

    // Before the answer, the caption is what's missing.
    expect(missingForDayFolder("alex", date, ALL_TRACKED).map((m) => m.field)).toContain("caption");

    const recorded = await read(
      await POST(json({ trip: TRIP, date, caption: "The old harbour", caption_photo: entry.id }), params),
    );
    expect(recorded.status).toBe(200);
    expect(recorded.body.recorded).toBe(true);

    // The sidecar carries it, wherever the photo is staged.
    expect(findDayInboxFile("alex", date, entry.id)?.entry.caption).toBe("The old harbour");
    expect(missingForDayFolder("alex", date, ALL_TRACKED).map((m) => m.field)).not.toContain("caption");

    const made = await read(await POST(json({ trip: TRIP, date }), params));
    expect(made.status).toBe(201);
    const day = getEntryBySlug(`alex/${TRIP}`, String(made.body.slug), AS_AUTHOR);
    expect(day?.gallery[0]?.caption).toBe("The old harbour");
  });

  test("a caption question answered with nothing typed records descriptionAsked, and stops asking", async () => {
    const date = "2026-05-07";
    const bytes = await paintJpeg(200, 150);
    const { entry } = storeInboxFile("alex", "media", "street.jpg", bytes, {});
    moveInboxFileToDay("alex", entry.id, date);

    const recorded = await read(await POST(json({ trip: TRIP, date, caption: "", caption_photo: entry.id }), params));
    expect(recorded.status).toBe(200);

    const staged = findDayInboxFile("alex", date, entry.id);
    expect(staged?.entry.descriptionAsked).toBe(true);
    expect(staged?.entry.caption).toBeUndefined();
    expect(missingForDayFolder("alex", date, ALL_TRACKED).map((m) => m.field)).not.toContain("caption");
  });
});

describe("assemble-day: final-review Fix 2 — weather look-up vs decline", () => {
  test('choosing "look it up" requests the archive once the day is created, and the entry carries what came back', async () => {
    enableWeather();
    const date = "2026-05-08";
    writeDayReadiness("alex", date, {
      without: ["costs"],
      location: { lat: 46.5, lon: 8.5, source: "browser" },
    });
    expect(missingForDayFolder("alex", date, ALL_TRACKED).map((m) => m.field)).toContain("weather");

    const recorded = await read(await POST(json({ trip: TRIP, date, weather: "lookup" }), params));
    expect(recorded.status).toBe(200);

    const readiness = readDayReadiness("alex", date);
    expect(readiness.weatherAsked).toBe(true);
    expect(readiness.weatherLookup).toBe(true);
    expect(missingForDayFolder("alex", date, ALL_TRACKED).map((m) => m.field)).not.toContain("weather");

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        daily: {
          time: [date],
          weather_code: [1],
          temperature_2m_max: [22.5],
          temperature_2m_min: [12.1],
          precipitation_sum: [0],
          wind_speed_10m_max: [10],
        },
      }),
    } as unknown as Response);

    const made = await read(await POST(json({ trip: TRIP, date }), params));
    expect(made.status).toBe(201);

    const day = getEntryBySlug(`alex/${TRIP}`, String(made.body.slug), AS_AUTHOR);
    expect(day?.weatherAsked).toBe(true);
    expect(day?.weather?.source).toBe("open-meteo");
    expect(day?.weather?.tempMax).toBe(22.5);
  });

  test('declining ("no, skip it") never asks the archive anything', async () => {
    enableWeather();
    const date = "2026-05-09";
    writeDayReadiness("alex", date, {
      without: ["costs"],
      location: { lat: 46.5, lon: 8.5, source: "browser" },
    });

    await read(await POST(json({ trip: TRIP, date, weather: "decline" }), params));
    const readiness = readDayReadiness("alex", date);
    expect(readiness.weatherAsked).toBe(true);
    expect(readiness.weatherLookup).toBeFalsy();

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const made = await read(await POST(json({ trip: TRIP, date }), params));
    expect(made.status).toBe(201);
    expect(fetchSpy).not.toHaveBeenCalled();

    const day = getEntryBySlug(`alex/${TRIP}`, String(made.body.slug), AS_AUTHOR);
    expect(day?.weatherAsked).toBeFalsy();
    expect(day?.weather).toBeUndefined();
  });
});

describe("assemble-day: final-review Fix 3 — several days from one batch", () => {
  test("choosing a date moves the matching undated content into its folder, and the answer is never a claim that a day was created", async () => {
    const bytes = await paintJpeg(100, 100);
    const { entry } = storeInboxFile("alex", "media", "one.jpg", bytes, { takenAt: "2026-05-10T09:00:00Z" });
    // An item from a different implied date must stay put.
    storeInboxFile("alex", "media", "other.jpg", await paintJpeg(100, 100), { takenAt: "2026-05-12T09:00:00Z" });

    const moved = await read(await POST(json({ trip: TRIP, date: "2026-05-10", chooseDate: "1" }), params));
    expect(moved.status).toBe(200);
    expect(moved.body.moved).toBe(1);
    expect(moved.body.ok).toBe(true);
    expect(moved.body.slug).toBeUndefined(); // never "created"

    expect(findInboxFile("alex", entry.id)).toBeNull();
    expect(findDayInboxFile("alex", "2026-05-10", entry.id)?.entry.id).toBe(entry.id);

    // The other date's own item was left alone.
    const stillFlat = fs.readdirSync(inboxDir("alex", "media")).filter((n) => n.endsWith(".meta.json"));
    expect(stillFlat).toHaveLength(1);
  });
});

describe("assemble-day: final-review Fix 4 — cleanup keeps unattached content", () => {
  test("a contact vCard staged alongside a photo survives the create — it lands back in the flat bucket, never deleted", async () => {
    const date = "2026-05-11";
    const bytes = await paintJpeg(200, 150);
    const { entry: photo } = storeInboxFile("alex", "media", "pass.jpg", bytes, { caption: "The pass" });
    moveInboxFileToDay("alex", photo.id, date);
    const { entry: contact } = storeInboxFile(
      "alex",
      "contact",
      "friend.vcf",
      Buffer.from("BEGIN:VCARD\nEND:VCARD\n"),
      {},
    );
    moveInboxFileToDay("alex", contact.id, date);

    writeDayReadiness("alex", date, {
      without: ["costs"],
      location: { lat: 1, lon: 2, source: "browser" },
    });

    const made = await read(await POST(json({ trip: TRIP, date }), params));
    expect(made.status).toBe(201);

    // The day folder is gone — its job was staging and a real entry now
    // holds what it carried...
    expect(fs.existsSync(dayInboxDir("alex", date))).toBe(false);
    // ...but the contact card was moved back to the flat bucket, not
    // destroyed with the folder.
    const back = findInboxFile("alex", contact.id);
    expect(back?.entry.id).toBe(contact.id);
    expect(fs.existsSync(path.join(inboxDir("alex", "contact"), contact.id))).toBe(true);
  });
});
