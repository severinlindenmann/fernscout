import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { clearMatterCache, forgetEntries, getEntryBySlug } from "@/lib/entries";
import { attachGallery, createDraft } from "@/lib/api/entries";
import { fillDayWeather } from "@/lib/api/weather";

/**
 * B643 — photographs, costs and weather disappeared from a published day,
 * hours after a publish run that had uploaded media to it, with every call
 * answering 200 and nothing logged.
 *
 * The strongest lead in the ticket is the upload path: `attachGallery` in
 * lib/api/entries.ts writes a day's whole file back from a read it just took,
 * and so does `writeWeather` in lib/api/weather.ts (via `fillDayWeather`).
 * Neither holds a lock and neither checks, immediately before writing, that
 * the file on disk is still the file it read — so a second writer that reads
 * the same day *before* the first one writes and writes itself *after* is a
 * silent, whole-file lost update: the second write wins in full and carries
 * none of the first one's change, because it was built from a copy taken
 * before that change existed.
 *
 * Every individual writer here is internally synchronous (read, splice,
 * write, no `await` in between), so nothing in *this* process can interrupt
 * one mid-flight — that is what makes B643 hard to catch from inside a
 * single Node process. But nothing here stops a second Node process (a
 * `weather:update` sweep, another agent session, a rolling restart with the
 * old and new process briefly both alive) from doing the same "read this
 * file, compute, write the whole thing back" cycle at an overlapping time.
 * That is reproduced below without any process trickery, by taking the two
 * reads a genuine second writer would take and applying them in the order
 * disk-clock time would allow.
 */

let dir: string;
const REF = "alex/algarve-2026";

const tripPath = () => path.join(dir, "alex", "trips", "algarve-2026");
const entryFile = () => path.join(tripPath(), "entries", "2026-06-02-windy-day.md");

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-b643-"));
  process.env.CONTENT_DIR = dir;
  fs.mkdirSync(path.join(tripPath(), "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "F", url: "https://e.test", defaultUser: "alex" },
      users: {},
      features: { weather: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "EUR",
      displayCurrencies: ["EUR"],
      units: "metric",
      features: { weather: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(tripPath(), "trip.md"),
    [
      "---",
      'id: "algarve-2026"',
      'title: "Algarve"',
      'start: "2026-06-01"',
      'end: "2026-06-14"',
      'status: "current"',
      'visibility: "public"',
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
  clearConfigCache();
  clearUserCache();
  clearMatterCache();
  forgetEntries(REF);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeSettledDay() {
  const result = createDraft(REF, {
    title: "Windy day",
    date: "2026-06-02",
    content: "It was windy at the beach.",
    lat: 37.12,
    lng: -8.53,
    weather: true,
    costs: [{ label: "Lunch", amount: 18, currency: "EUR", category: "food" }],
    translations: { de: { title: "Windiger Tag", content: "Es war windig am Strand." } },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("setup failed");
  return result.slug;
}

describe("the ordinary, sequential publish flow", () => {
  test("a day keeps its costs, weather and translations across a media upload", async () => {
    const slug = writeSettledDay();

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        daily: {
          time: ["2026-06-02"],
          weather_code: [1],
          temperature_2m_max: [24],
          temperature_2m_min: [17],
          precipitation_sum: [0],
          wind_speed_10m_max: [38],
        },
      }),
    } as unknown as Response);
    const outcome = await fillDayWeather(REF, slug);
    expect(outcome).toBe("filled");

    const attached = attachGallery(REF, slug, [
      { src: `/media/algarve-2026/${slug}/01.jpg`, type: "image", width: 2000, height: 1333 },
    ]);
    expect(attached.ok).toBe(true);

    const entry = getEntryBySlug(REF, slug, { includeDrafts: true, reader: "person" });
    expect(entry?.costs).toHaveLength(1);
    expect(entry?.weather).toBeDefined();
    expect(entry?.translations?.de?.title).toBe("Windiger Tag");
    expect(entry?.gallery).toHaveLength(1);
  });
});

describe("a second writer racing the upload — the lost-update B643 describes", () => {
  /**
   * Models exactly the shape the ticket lays out, using the real production
   * function on both sides of the race rather than a hand-rolled stand-in:
   * a second writer (another agent session queuing a batch from a `GET` it
   * took earlier, a retried request, the old half of a rolling restart) is
   * `attachGallery` too — it is just working from a copy of the day it read
   * *before* the weather lookup and the first upload landed, and it only
   * gets around to writing *after* both of them did. `vi.spyOn` on
   * `fs.readFileSync` stands in for that timing: it hands this one call the
   * bytes the second writer actually had, and every other read in the test
   * goes to the real file untouched.
   */
  test("a second attachGallery call built from an earlier read must not erase what landed since", async () => {
    const slug = writeSettledDay();
    const file = entryFile();

    // T0 — the second writer's read, taken before anything else happens to
    // this file. At this point the day already carries its costs and
    // translations (`writeSettledDay` wrote them), and not yet its weather
    // reading or any photograph.
    const staleRaw = fs.readFileSync(file, "utf8");
    expect(staleRaw).toContain("costs:");
    expect(staleRaw).not.toContain("weatherData:");

    // T1 — the real weather lookup lands, and writes its reading back.
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        daily: {
          time: ["2026-06-02"],
          weather_code: [1],
          temperature_2m_max: [24],
          temperature_2m_min: [17],
          precipitation_sum: [0],
          wind_speed_10m_max: [38],
        },
      }),
    } as unknown as Response);
    expect(await fillDayWeather(REF, slug)).toBe("filled");

    // T2 — the real upload for this day, landing and completing in full:
    // this is what a `publish` run's media POST actually does.
    const attached = attachGallery(REF, slug, [
      { src: `/media/algarve-2026/${slug}/01.jpg`, type: "image", width: 2000, height: 1333 },
      { src: `/media/algarve-2026/${slug}/02.jpg`, type: "image", width: 2000, height: 1333 },
      { src: `/media/algarve-2026/${slug}/03.jpg`, type: "image", width: 2000, height: 1333 },
    ]);
    expect(attached.ok).toBe(true);
    forgetEntries(REF);
    expect(getEntryBySlug(REF, slug, { includeDrafts: true, reader: "person" })?.gallery).toHaveLength(3);

    // T3 — the second writer finally calls the real `attachGallery`, but its
    // one internal read of this file returns what it actually had: the copy
    // from T0, with none of what T1 and T2 wrote.
    const originalReadFileSync = fs.readFileSync.bind(fs);
    const readSpy = vi.spyOn(fs, "readFileSync").mockImplementationOnce((p, opts) => {
      if (p === file) return staleRaw;
      return originalReadFileSync(p, opts as never);
    });

    const secondBatch = attachGallery(REF, slug, [
      { src: `/media/algarve-2026/${slug}/09.jpg`, type: "image", width: 2000, height: 1333 },
    ]);
    readSpy.mockRestore();
    forgetEntries(REF);
    clearMatterCache();

    const after = getEntryBySlug(REF, slug, { includeDrafts: true, reader: "person" });

    // This is B643: before the fix, `secondBatch.ok` was `true` — every call
    // involved answered success — and the day on disk was left missing
    // content nobody deleted or asked to remove. After the fix, the second
    // writer is refused loudly instead, and everything the first writer and
    // the upload already put there survives untouched.
    expect(secondBatch.ok, "a write built from a stale read must be refused, not silently applied").toBe(
      false,
    );
    expect(after?.costs, "the recorded cost line survived a write that never saw it").toHaveLength(1);
    expect(after?.weather, "the weather reading survived a write that never saw it").toBeDefined();
    expect(after?.translations?.de?.title, "the translation survived a write that never saw it").toBe(
      "Windiger Tag",
    );
    expect(after?.gallery.length, "every photograph the first upload attached is still there").toBe(3);
  });
});
